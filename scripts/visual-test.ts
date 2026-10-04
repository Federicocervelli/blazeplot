#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { decodePng, diffImages, encodePng, measureInk } from "./png-image.js";
import type { RgbaImage } from "./png-image.js";
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
  baselineDir: string;
  /** compare against committed baselines, rewrite them, or skip the pixel comparison. */
  baselines: "compare" | "update" | "skip";
  /** Compare baselines even on non-Linux platforms. */
  forceCompare: boolean;
}

interface VisualSnapshot {
  state?: string;
  caseName?: string;
  stats?: { drawCalls?: number; pointsRendered?: number; renderMode?: string } | null;
  assertions?: string[];
  error?: string | null;
}

interface VisualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualRects {
  root: VisualRect;
  plot: VisualRect;
  flamegraph: VisualRect | null;
}

interface CaseCheck {
  /**
   * Minimum fraction of series-probe pixels (grid hidden) that must differ from the background.
   * Guards against "draw calls happened but the canvas is blank or uniform".
   */
  minInkRatio: number;
  /** Where to measure ink: the WebGL plot canvas (default) or the flamegraph canvas. */
  probe?: "plot" | "flamegraph";
  /** Present when the case has a committed pixel baseline. */
  baseline?: { region: "plot" | "chart"; maxDiffRatio?: number };
}

interface BaselineSummary {
  status: "match" | "updated" | "skipped";
  diffRatio?: number;
  diffPixels?: number;
  maxChannelDelta?: number;
}

interface CaseResult {
  caseName: string;
  screenshot: string;
  chartScreenshotBytes: number;
  assertions: string[];
  inkRatio: number;
  minInkRatio: number;
  baseline?: BaselineSummary;
}

/** A pixel differs from its baseline when any channel moves by more than this (0..255). */
const BASELINE_PIXEL_THRESHOLD = 32;
/** Default fraction of pixels allowed to differ from the baseline before the case fails. */
const BASELINE_MAX_DIFF_RATIO = 0.002;
/** Differences up to this channel delta do not count as ink when measuring blank canvases. */
const INK_TOLERANCE = 8;
const DEFAULT_BASELINE_DIR = "tests/browser/visual/baselines";
/** Time for the chart to re-render after toggling the grid, before capturing pixels. */
const RENDER_SETTLE_MS = 250;

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

/**
 * Per-case checks. Ink ratios are deliberately loose lower bounds (a fraction of what a healthy render
 * produces) so they only fail on blank or near-uniform canvases; the pixel baselines catch subtle changes.
 * Baselined cases are deterministic (no pointer input, static data) and cropped to the WebGL plot area when
 * possible so they do not depend on DOM font rendering.
 */
const CASE_CHECKS: Readonly<Record<string, CaseCheck>> = {
  line: { minInkRatio: 0.002, baseline: { region: "plot" } },
  area: { minInkRatio: 0.05, baseline: { region: "plot" } },
  scatter: { minInkRatio: 0.005, baseline: { region: "plot" } },
  bar: { minInkRatio: 0.1, baseline: { region: "plot" } },
  histogram: { minInkRatio: 0.05, baseline: { region: "plot" } },
  ohlc: { minInkRatio: 0.003, baseline: { region: "plot" } },
  candlestick: { minInkRatio: 0.01, baseline: { region: "plot" } },
  "axes-title-grid": { minInkRatio: 0.002, baseline: { region: "chart", maxDiffRatio: 0.01 } },
  legend: { minInkRatio: 0.002 },
  tooltip: { minInkRatio: 0.002 },
  crosshair: { minInkRatio: 0.002 },
  annotations: { minInkRatio: 0.002, baseline: { region: "chart", maxDiffRatio: 0.01 } },
  selection: { minInkRatio: 0.002 },
  navigator: { minInkRatio: 0.002 },
  flamegraph: { minInkRatio: 0.05, probe: "flamegraph", baseline: { region: "chart", maxDiffRatio: 0.01 } },
  "scale-options": { minInkRatio: 0.002, baseline: { region: "plot" } },
  "overlay-layering": { minInkRatio: 0.002 },
  "context-restore": { minInkRatio: 0.002 },
};
const DEFAULT_CASE_CHECK: CaseCheck = { minInkRatio: 0.002 };

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

    if (options.baselines === "update" && process.platform !== "linux") {
      console.warn("warning: updating baselines on a non-Linux platform; committed baselines should come from the CI environment (see docs/internal/local-development.md).");
    }
    if (options.baselines === "compare" && process.platform !== "linux" && !options.forceCompare) {
      console.warn("note: skipping pixel baselines on a non-Linux platform (GPU/OS rendering differs from CI). Pass --compare-baselines to force the comparison.");
      options.baselines = "skip";
    }

    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-visual-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    const summary: CaseResult[] = [];
    const failures: string[] = [];
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

        const check = CASE_CHECKS[caseName] ?? DEFAULT_CASE_CHECK;
        const rects = await evaluate(cdp, "window.__blazeplotVisualTest.rects()", false) as VisualRects;

        // Blank-canvas guard: draw calls were issued, so pixels must actually have changed. Measure with the
        // grid hidden so grid lines alone cannot satisfy the check.
        await evaluate(cdp, "window.__blazeplotVisualTest.setGridVisible(false)", false);
        await sleep(RENDER_SETTLE_MS);
        const probeRect = check.probe === "flamegraph" ? rects.flamegraph : rects.plot;
        if (!probeRect) throw new Error(`No probe region for ${caseName}`);
        const probeImage = await captureRegion(cdp, probeRect);
        await evaluate(cdp, "window.__blazeplotVisualTest.setGridVisible(true)", false);
        await sleep(RENDER_SETTLE_MS);
        const ink = measureInk(probeImage, INK_TOLERANCE);
        if (ink.ratio < check.minInkRatio) {
          await writeFile(join(options.outDir, `${caseName}.probe.png`), encodePng(probeImage));
          throw new Error(`Blank canvas in ${caseName}: draw calls were issued but only ${(ink.ratio * 100).toFixed(3)}% of pixels differ from the background (minimum ${(check.minInkRatio * 100).toFixed(3)}%)`);
        }

        const result: CaseResult = { caseName, screenshot: screenshotPath, chartScreenshotBytes, assertions: snapshot.assertions ?? [], inkRatio: ink.ratio, minInkRatio: check.minInkRatio };
        summary.push(result);
        let baselineNote = "";
        if (check.baseline) {
          const region = check.baseline.region === "chart" ? rects.root : rects.plot;
          const actual = await captureRegion(cdp, region);
          const outcome = await checkBaseline(caseName, actual, check.baseline.maxDiffRatio ?? BASELINE_MAX_DIFF_RATIO, options);
          result.baseline = outcome.summary;
          baselineNote = `, baseline ${outcome.note}`;
          if (outcome.failure) {
            failures.push(outcome.failure);
            console.error(`✗ ${outcome.failure}`);
            continue;
          }
        }
        console.log(`✓ ${caseName}: ink ${(ink.ratio * 100).toFixed(2)}%${baselineNote}; ${(snapshot.assertions ?? []).join(", ")}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${caseName}: ${message}`);
        console.error(`✗ ${caseName}: ${message}`);
      } finally {
        cdp.close();
      }
    }

    const reportPath = join(options.outDir, "summary.json");
    await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), browser: basename(chromePath), platform: process.platform, baselines: options.baselines, cases: summary }, null, 2)}\n`);
    console.log(`Visual test screenshots written to ${options.outDir}`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} visual case(s) failed:\n  - ${failures.join("\n  - ")}`);
    }
    if (options.baselines === "update") console.log(`Baselines written to ${options.baselineDir}`);
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
    baselineDir: DEFAULT_BASELINE_DIR,
    baselines: "compare",
    forceCompare: false,
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
      case "--update-baselines":
        parsed.baselines = "update";
        break;
      case "--skip-baselines":
        parsed.baselines = "skip";
        break;
      case "--compare-baselines":
        parsed.forceCompare = true;
        break;
      case "--baseline-dir":
        parsed.baselineDir = readValue();
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
  console.log(`Usage: bun run test:visual [options]

Options:
  --cases <a,b>          Comma-separated visual cases
  --out-dir <path>       Screenshot/report output directory
  --width <px>           Browser width
  --height <px>          Browser height
  --port <port>          Vite port
  --debug-port <port>    Chrome DevTools port
  --timeout-ms <ms>      Per-case timeout
  --url <url>            Use already-running server
  --chrome <path>        Chrome/Chromium/Brave executable
  --keep-browser         Keep browser profile/process
  --update-baselines     Rewrite pixel baselines from this run (generate them in the CI environment)
  --skip-baselines       Skip pixel baseline comparison (blank-canvas checks still run)
  --compare-baselines    Compare baselines even on non-Linux platforms (skipped there by default)
  --baseline-dir <path>  Baseline PNG directory (default ${DEFAULT_BASELINE_DIR})
`);
  process.exit(0);
}

function launchChrome(chromePath: string, userDataDir: string, opts: Options): Bun.Subprocess {
  const cmd = [
    chromePath,
    "--headless=new",
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${opts.width},${opts.height}`,
    "--force-device-scale-factor=1",
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

/** Capture a page region at device scale 1 as decoded RGBA pixels. */
async function captureRegion(cdp: CdpClient, rect: VisualRect): Promise<RgbaImage> {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const width = Math.ceil(rect.x + rect.width) - x;
  const height = Math.ceil(rect.y + rect.height) - y;
  if (width <= 0 || height <= 0) throw new Error(`Empty capture region ${JSON.stringify(rect)}`);
  const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip: { x, y, width, height, scale: 1 } }) as { data?: string };
  if (!response.data) throw new Error("Page.captureScreenshot returned no data");
  return decodePng(Buffer.from(response.data, "base64"));
}

interface BaselineOutcome {
  summary: BaselineSummary;
  note: string;
  failure?: string;
}

/**
 * Compare a render with its committed baseline. The candidate render is always written to
 * `<outDir>/actual/<case>.png` so CI artifacts double as ready-to-commit baselines, and a failing
 * comparison writes a red-highlight diff to `<outDir>/diff/<case>.png`.
 */
async function checkBaseline(caseName: string, actual: RgbaImage, maxDiffRatio: number, options: Options): Promise<BaselineOutcome> {
  const candidatePath = join(options.outDir, "actual", `${caseName}.png`);
  await mkdir(join(options.outDir, "actual"), { recursive: true });
  const actualPng = encodePng(actual);
  await writeFile(candidatePath, actualPng);
  const baselinePath = join(options.baselineDir, `${caseName}.png`);

  if (options.baselines === "skip") return { summary: { status: "skipped" }, note: "skipped" };
  if (options.baselines === "update") {
    await mkdir(options.baselineDir, { recursive: true });
    await writeFile(baselinePath, actualPng);
    return { summary: { status: "updated" }, note: "updated" };
  }
  if (!existsSync(baselinePath)) {
    return {
      summary: { status: "skipped" },
      note: "missing",
      failure: `${caseName}: missing baseline ${baselinePath}. Generate baselines in CI (see docs/internal/local-development.md); the candidate render is ${candidatePath}`,
    };
  }

  const expected = decodePng(await readFile(baselinePath));
  const result = diffImages(expected, actual, { pixelThreshold: BASELINE_PIXEL_THRESHOLD, maxDiffRatio });
  const summary: BaselineSummary = { status: "match", diffRatio: result.diffRatio, diffPixels: result.diffPixels, maxChannelDelta: result.maxChannelDelta };
  if (result.ok) return { summary, note: `match (${result.diffPixels}px, ${(result.diffRatio * 100).toFixed(3)}% differ)` };

  if (result.sizeMismatch) {
    return { summary, note: "size mismatch", failure: `${caseName}: baseline is ${expected.width}x${expected.height} but render is ${actual.width}x${actual.height}. Candidate: ${candidatePath}` };
  }
  const diffPath = join(options.outDir, "diff", `${caseName}.png`);
  await mkdir(join(options.outDir, "diff"), { recursive: true });
  if (result.diffImage) await writeFile(diffPath, encodePng(result.diffImage));
  return {
    summary,
    note: "mismatch",
    failure: `${caseName}: ${result.diffPixels} px (${(result.diffRatio * 100).toFixed(3)}%) differ from baseline by more than ${BASELINE_PIXEL_THRESHOLD}/255, limit ${(maxDiffRatio * 100).toFixed(3)}%. Diff: ${diffPath}, candidate: ${candidatePath}`,
  };
}
