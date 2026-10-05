#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, attachConsoleLogging, createTarget, evaluate, readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, waitForHttp } from "./browser-harness.js";

/**
 * Many-small-charts benchmark: N live charts on one page rendered with each renderer, to compare
 * one WebGL context per chart (hits the browser context cap), a shared WebGL context, and Canvas 2D.
 * Usage: bun run bench:multi [--charts 50] [--renderers webgl2,shared,canvas2d] [--measure-ms 4000]
 */

interface MultiResult {
  renderer: string;
  charts: number;
  frames: number;
  fps: number;
  rafP95Ms: number;
  frameWorkP50Ms: number;
  frameWorkP95Ms: number;
  contextsLost: number;
  chartsWithLostContext: number;
}

interface Options {
  charts: number;
  renderers: string[];
  measureMs: number;
  port: number;
  debugPort: number;
  chrome?: string;
}

const options = parseArgs(process.argv.slice(2));
const serverUrl = `http://127.0.0.1:${options.port}`;
const viteProc = startVite(options.port);
const results: MultiResult[] = [];

try {
  await waitForHttp(serverUrl, 30_000);
  const chromePath = resolveChrome(options.chrome);
  for (const [index, renderer] of options.renderers.entries()) {
    results.push(await runRenderer(chromePath, renderer, options.debugPort + index));
  }
} finally {
  viteProc.kill();
}

console.log(`\n${options.charts} live charts, ${options.measureMs} ms measured per renderer\n`);
console.log("| Renderer | FPS | rAF p95 ms | Chart render work p50 / p95 ms per frame | Contexts lost | Charts with lost context |");
console.log("|---|---:|---:|---:|---:|---:|");
for (const r of results) {
  console.log(`| ${r.renderer} | ${r.fps.toFixed(1)} | ${r.rafP95Ms.toFixed(1)} | ${r.frameWorkP50Ms.toFixed(1)} / ${r.frameWorkP95Ms.toFixed(1)} | ${r.contextsLost} | ${r.chartsWithLostContext} |`);
}
console.log(`\nChrome ${chromePath()} (software WebGL unless run on a real GPU; do not compare against numbers from another machine)`);

function chromePath(): string {
  return resolveChrome(options.chrome);
}

async function runRenderer(chrome: string, renderer: string, debugPort: number): Promise<MultiResult> {
  const userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-multi-chrome-"));
  const proc = spawnChrome([
    chrome,
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1700,1100",
    "--force-device-scale-factor=1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "about:blank",
  ]);
  try {
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 30_000);
    const url = new URL("/multichart/", serverUrl);
    url.searchParams.set("charts", String(options.charts));
    url.searchParams.set("renderer", renderer);
    url.searchParams.set("measureMs", String(options.measureMs));
    const target = await createTarget(debugPort, url.toString());
    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      attachConsoleLogging(cdp, []);
      const deadline = Date.now() + options.measureMs + 120_000;
      while (Date.now() < deadline) {
        const state = await evaluate(cdp, "JSON.stringify(window.__multi ?? null)", false) as string;
        const snapshot = JSON.parse(state) as { state: string; result: MultiResult | null; error: string | null } | null;
        if (snapshot?.state === "done" && snapshot.result) return snapshot.result;
        if (snapshot?.state === "error") throw new Error(`${renderer}: ${snapshot.error}`);
        await sleep(250);
      }
      throw new Error(`${renderer}: timed out`);
    } finally {
      cdp.close();
    }
  } finally {
    proc.kill();
    await sleep(300);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
}

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = { charts: 50, renderers: ["webgl2", "shared", "canvas2d"], measureMs: 4000, port: 41773, debugPort: 9260 };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = (args[i] ?? "").split("=", 2) as [string, string?];
    const value = (): string => inline ?? args[++i] ?? "";
    switch (flag) {
      case "--charts":
        parsed.charts = readPositiveInteger(flag, value());
        break;
      case "--renderers":
        parsed.renderers = value().split(",").map((entry) => entry.trim()).filter(Boolean);
        break;
      case "--measure-ms":
        parsed.measureMs = readPositiveInteger(flag, value());
        break;
      case "--chrome":
        parsed.chrome = value();
        break;
      default:
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
  return parsed;
}
