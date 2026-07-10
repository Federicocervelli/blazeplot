#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CdpClient, attachConsoleLogging, createTarget, evaluate, readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, waitForHttp } from "./browser-harness.js";

interface Options {
  cases: string[];
  outDir: string;
  width: number;
  height: number;
  port: number;
  debugPort: number;
  timeoutMs: number;
  url?: string;
  chrome?: string;
  keepBrowser: boolean;
}

interface VisualSnapshot {
  state?: string;
  caseName?: string;
  stats?: { drawCalls?: number; pointsRendered?: number; renderMode?: string } | null;
  assertions?: string[];
  error?: string | null;
}

const DEFAULT_CASES = [
  "line",
  "area",
  "scatter",
  "bar",
  "histogram",
  "ohlc",
  "candlestick",
  "axes-title-grid",
  "legend",
  "tooltip",
  "crosshair",
  "annotations",
  "selection",
  "navigator",
  "flamegraph",
  "scale-options",
  "overlay-layering",
  "context-restore",
];

await main();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  let viteProc: Bun.Subprocess | null = null;
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;

  try {
    if (!options.url) {
      viteProc = startVite(options.port);
      await waitForHttp(serverUrl, 30_000);
    }

    await rm(options.outDir, { recursive: true, force: true });
    await mkdir(options.outDir, { recursive: true });

    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-visual-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    const summary: Array<{ caseName: string; screenshot: string; chartScreenshotBytes: number; assertions: string[] }> = [];
    for (const caseName of options.cases) {
      const url = new URL("/visual/", serverUrl);
      url.searchParams.set("case", caseName);
      const target = await createTarget(options.debugPort, url.toString());
      const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
      try {
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        const pageErrors: string[] = [];
        attachConsoleLogging(cdp, pageErrors, caseName);
        const snapshot = await waitForVisualReady(cdp, options.timeoutMs);
        if (pageErrors.length > 0) throw new Error(`Page errors in ${caseName}: ${pageErrors[0]}`);
        assertVisualSnapshot(snapshot, caseName);
        const chartScreenshotBytes = await evaluate(cdp, "window.__blazeplotVisualTest.screenshot()", true) as number;
        if (!Number.isFinite(chartScreenshotBytes) || chartScreenshotBytes <= 1_000) {
          throw new Error(`chart.screenshot() for ${caseName} returned ${chartScreenshotBytes} bytes`);
        }
        const screenshotPath = join(options.outDir, `${caseName}.png`);
        await saveScreenshot(cdp, screenshotPath);
        summary.push({ caseName, screenshot: screenshotPath, chartScreenshotBytes, assertions: snapshot.assertions ?? [] });
        console.log(`✓ ${caseName}: ${(snapshot.assertions ?? []).join(", ")}`);
      } finally {
        cdp.close();
      }
    }

    const reportPath = join(options.outDir, "summary.json");
    await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), browser: basename(chromePath), cases: summary }, null, 2)}\n`);
    console.log(`Visual test screenshots written to ${options.outDir}`);
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (viteProc) viteProc.kill();
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true });
  }
}

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = {
    cases: DEFAULT_CASES,
    outDir: "build/visual-tests",
    width: 900,
    height: 520,
    port: 41732,
    debugPort: 9224,
    timeoutMs: 30_000,
    keepBrowser: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    const [flag, inlineValue] = arg.split("=", 2) as [string, string?];
    const readValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[++i];
      if (!next) throw new Error(`Missing value for ${flag}`);
      return next;
    };

    switch (flag) {
      case "--case":
      case "--cases":
        parsed.cases = readValue().split(",").map((value) => value.trim()).filter(Boolean);
        break;
      case "--out-dir":
        parsed.outDir = readValue();
        break;
      case "--width":
        parsed.width = readPositiveInteger(flag, readValue());
        break;
      case "--height":
        parsed.height = readPositiveInteger(flag, readValue());
        break;
      case "--port":
        parsed.port = readPositiveInteger(flag, readValue());
        break;
      case "--debug-port":
        parsed.debugPort = readPositiveInteger(flag, readValue());
        break;
      case "--timeout-ms":
        parsed.timeoutMs = readPositiveInteger(flag, readValue());
        break;
      case "--url":
        parsed.url = readValue();
        break;
      case "--chrome":
        parsed.chrome = readValue();
        break;
      case "--keep-browser":
        parsed.keepBrowser = true;
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run test:visual [options]\n\nOptions:\n  --cases <a,b>          Comma-separated visual cases\n  --out-dir <path>       Screenshot/report output directory\n  --width <px>           Browser width\n  --height <px>          Browser height\n  --port <port>          Vite port\n  --debug-port <port>    Chrome DevTools port\n  --timeout-ms <ms>      Per-case timeout\n  --url <url>            Use already-running server\n  --chrome <path>        Chrome/Chromium/Brave executable\n  --keep-browser         Keep browser profile/process\n`);
  process.exit(0);
}

function launchChrome(chromePath: string, userDataDir: string, opts: Options): Bun.Subprocess {
  const cmd = [
    chromePath,
    "--headless=new",
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${opts.width},${opts.height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "about:blank",
  ];
  return spawnChrome(cmd);
}

async function waitForVisualReady(cdp: CdpClient, timeoutMs: number): Promise<VisualSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate(cdp, "window.__blazeplotVisualTest?.snapshot?.() ?? null", true) as VisualSnapshot | null;
    if (snapshot?.state === "ready") return snapshot;
    if (snapshot?.state === "error") throw new Error(`Visual page failed: ${snapshot.error ?? "unknown error"}`);
    await sleep(150);
  }
  const snapshot = await evaluate(cdp, "window.__blazeplotVisualTest?.snapshot?.() ?? null", true).catch(() => null);
  throw new Error(`Timed out waiting for visual test. Last snapshot: ${JSON.stringify(snapshot)}`);
}

function assertVisualSnapshot(snapshot: VisualSnapshot, caseName: string): void {
  if (snapshot.caseName !== caseName) throw new Error(`Expected case ${caseName}, got ${snapshot.caseName ?? "unknown"}`);
  if (!snapshot.stats) throw new Error(`Missing frame stats for ${caseName}`);
  if ((snapshot.stats.drawCalls ?? 0) <= 0) throw new Error(`No draw calls for ${caseName}`);
  if ((snapshot.stats.pointsRendered ?? 0) <= 0) throw new Error(`No rendered points for ${caseName}`);
  if (snapshot.stats.renderMode === "none") throw new Error(`No render mode for ${caseName}`);
}

async function saveScreenshot(cdp: CdpClient, path: string): Promise<void> {
  const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }) as { data?: string };
  if (!response.data) throw new Error("Page.captureScreenshot returned no data");
  await writeFile(path, Buffer.from(response.data, "base64"));
}
