#!/usr/bin/env bun
/**
 * Cross-browser smoke test (Firefox and WebKit through Playwright).
 *
 * The other browser scripts drive headless Chrome over CDP. This one is the lightweight
 * engine-coverage check: for each browser it loads the Vite-served visual and interaction
 * fixture pages and asserts WebGL2 availability, non-blank chart pixels, and basic
 * hover / wheel / pan / box-zoom / reset behavior, once on the WebGL2 engine and once on the Canvas 2D engine
 * (which needs no WebGL, so it runs even where WebGL2 is allowlisted away).
 *
 * WebGL2 availability is never skipped silently. If a browser cannot create a WebGL2 context the
 * run fails, unless that browser is listed in --allow-no-webgl2 (or BLAZEPLOT_CROSS_BROWSER_ALLOW_NO_WEBGL2).
 * An allowlisted browser prints a loud SKIP line, its WebGL2 checks are not run, and its Canvas 2D checks still are.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserType, Page } from "playwright";
import { readPositiveInteger, startVite, waitForHttp } from "./browser-harness.js";

const BROWSERS: Record<string, BrowserType> = { firefox, webkit, chromium };
const DEFAULT_BROWSERS = ["firefox", "webkit"];
const DEFAULT_VISUAL_CASES = ["line", "area", "scatter", "bar", "candlestick", "axes-title-grid", "crosshair", "flamegraph", "context-restore"];
/** The Canvas 2D pass skips cases that need a WebGL context. */
const WEBGL_ONLY_CASES = new Set(["context-restore"]);

/** Engines the fixtures can be asked for with `?renderer=`. */
type Engine = "webgl2" | "canvas2d";

interface Options {
  browsers: string[];
  visualCases: string[];
  allowNoWebgl2: Set<string>;
  headed: Set<string>;
  outDir: string;
  width: number;
  height: number;
  port: number;
  timeoutMs: number;
  url?: string;
}

interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface InteractionSnapshot {
  state: string;
  viewport: Viewport;
  initialViewport: Viewport;
  canvasRect: Rect;
  hoverEvents: number;
  crosshairMoves: number;
  visibleCrosshairs: number;
  error: string | null;
}

interface VisualSnapshot {
  state: string;
  assertions: string[];
  stats: { drawCalls: number; pointsRendered: number; renderMode: string } | null;
  error: string | null;
}

interface WebGl2Info {
  available: boolean;
  renderer: string | null;
  version: string | null;
  creationError?: string;
}

interface PixelStats {
  width: number;
  height: number;
  distinctColors: number;
  nonBackgroundRatio: number;
}

type BrowserOutcome = "passed" | "skipped";

/** Fixture controllers exposed by tests/browser/{visual,interaction}/main.ts. */
interface FixtureWindow {
  __blazeplotVisualTest?: { snapshot(): unknown; screenshot(): Promise<number> };
  __blazeplotInteractionTest?: { snapshot(): unknown; resetViewport(): void };
}

class Skip extends Error {}

await main();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  let viteProc: Bun.Subprocess | null = null;
  const results: Array<{ browser: string; outcome: BrowserOutcome | "failed"; detail: string }> = [];

  try {
    if (!options.url) {
      viteProc = startVite(options.port);
      await waitForHttp(serverUrl, 30_000);
    }

    for (const name of options.browsers) {
      const type = BROWSERS[name];
      if (!type) throw new Error(`Unknown browser "${name}". Expected one of: ${Object.keys(BROWSERS).join(", ")}`);
      console.log(`\n== ${name} ==`);
      try {
        const outcome = await runBrowser(name, type, options, serverUrl);
        results.push({ browser: name, outcome, detail: "" });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`✗ ${name}: ${detail}`);
        results.push({ browser: name, outcome: "failed", detail });
      }
    }
  } finally {
    if (viteProc) viteProc.kill();
  }

  await writeFile(join(options.outDir, "summary.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log("\nCross-browser summary:");
  for (const result of results) {
    const mark = result.outcome === "passed" ? "PASS" : result.outcome === "skipped" ? "SKIP" : "FAIL";
    console.log(`  ${mark} ${result.browser}${result.detail ? ` - ${result.detail}` : ""}`);
  }
  if (results.some((result) => result.outcome === "failed")) process.exit(1);
}

async function runBrowser(name: string, type: BrowserType, options: Options, serverUrl: string): Promise<BrowserOutcome> {
  const browser = await type.launch({ headless: !options.headed.has(name), ...launchOptions(name) });
  try {
    console.log(`  ${name} ${browser.version()}`);
    try {
      await runChecks(name, browser, options, serverUrl);
    } catch (error) {
      if (error instanceof Skip) {
        console.warn(`!! SKIP ${name}: ${error.message}`);
        return "skipped";
      }
      throw error;
    }
    return "passed";
  } finally {
    await browser.close();
  }
}

/** Per-engine flags so CI machines without a GPU fall back to software WebGL2 instead of blocklisting it. */
function launchOptions(name: string): { args?: string[]; firefoxUserPrefs?: Record<string, string | number | boolean> } {
  if (name === "chromium") return { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] };
  if (name === "firefox") {
    return { firefoxUserPrefs: { "webgl.disabled": false, "webgl.enable-webgl2": true, "webgl.force-enabled": true, "gfx.webrender.software": true } };
  }
  return {};
}

async function runChecks(name: string, browser: Browser, options: Options, serverUrl: string): Promise<void> {
  let skippedWebGl: Skip | null = null;
  try {
    const webgl2 = await checkWebGl2(name, browser, options);
    console.log(`✓ WebGL2 available (${webgl2.version ?? "unknown version"}; renderer: ${webgl2.renderer ?? "unknown"})`);
    for (const caseName of options.visualCases) await runVisualCase(name, browser, options, serverUrl, caseName, "webgl2");
    await runInteractionCase(name, browser, options, serverUrl, "webgl2");
  } catch (error) {
    if (!(error instanceof Skip)) throw error;
    skippedWebGl = error;
  }

  // The Canvas 2D engine is the fallback for exactly the browsers where WebGL2 is missing, so it is always checked.
  console.log("  -- Canvas 2D engine --");
  for (const caseName of options.visualCases.filter((value) => !WEBGL_ONLY_CASES.has(value))) await runVisualCase(name, browser, options, serverUrl, caseName, "canvas2d");
  await runInteractionCase(name, browser, options, serverUrl, "canvas2d");
  if (skippedWebGl) throw skippedWebGl;
}

async function newPage(browser: Browser, options: Options, caseName: string, label: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: options.width, height: options.height } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(`[${label}:${caseName}:exception] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[${label}:${caseName}:console] ${message.text()}`);
    // Deleting objects from a lost context (WebKit) is logged as a warning; it must fail the case.
    if (/INVALID_OPERATION/i.test(message.text())) {
      errors.push(`WebGL ${message.type()}: ${message.text()}`);
      console.error(`[${label}:${caseName}:webgl] ${message.text()}`);
    }
  });
  return { page, errors, close: () => context.close() };
}

async function checkWebGl2(name: string, browser: Browser, options: Options): Promise<WebGl2Info> {
  const { page, close } = await newPage(browser, options, "webgl2", name);
  try {
    await page.goto("about:blank");
    const info = await page.evaluate((): WebGl2Info => {
      const canvas = document.createElement("canvas");
      let creationError = "";
      canvas.addEventListener("webglcontextcreationerror", (event) => { creationError = (event as WebGLContextEvent).statusMessage; });
      const gl = canvas.getContext("webgl2");
      if (!gl) return { available: false, renderer: null, version: null, creationError };
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
      return { available: true, renderer, version: String(gl.getParameter(gl.VERSION)) };
    });
    if (!info.available) {
      const message = `${name} cannot create a WebGL2 context in this environment${info.creationError ? ` (${info.creationError})` : ""}`;
      if (options.allowNoWebgl2.has(name)) throw new Skip(`${message} (allowlisted via --allow-no-webgl2; remaining ${name} checks are NOT run)`);
      throw new Error(`${message}. Fix the environment, or list the browser in --allow-no-webgl2 / BLAZEPLOT_CROSS_BROWSER_ALLOW_NO_WEBGL2 to skip it explicitly.`);
    }
    return info;
  } finally {
    await close();
  }
}

async function runVisualCase(name: string, browser: Browser, options: Options, serverUrl: string, caseName: string, engine: Engine): Promise<void> {
  const { page, errors, close } = await newPage(browser, options, caseName, name);
  const tag = engine === "webgl2" ? "" : ` [${engine}]`;
  try {
    await page.goto(new URL(`/visual/?case=${encodeURIComponent(caseName)}${engine === "webgl2" ? "" : `&renderer=${engine}&expectRenderer=${engine}`}`, serverUrl).toString());
    const snapshot = await waitFor(page, options.timeoutMs, async () => {
      const value = await page.evaluate(() => (window as unknown as FixtureWindow).__blazeplotVisualTest?.snapshot() as VisualSnapshot | undefined);
      if (value?.state === "error") throw new Error(`visual case ${caseName} reported error: ${value.error ?? "unknown"}`);
      return value?.state === "ready" ? value : null;
    }, `visual case ${caseName} to become ready`);
    if (errors.length > 0) throw new Error(`page errors in ${caseName}: ${errors[0]}`);
    assert(snapshot.stats !== null && snapshot.stats.drawCalls > 0 && snapshot.stats.pointsRendered > 0, `${caseName} issued draw calls`);

    // chart.screenshot() composites the WebGL canvas and DOM overlays; readback must work.
    const screenshotBytes = await page.evaluate(() => (window as unknown as FixtureWindow).__blazeplotVisualTest!.screenshot());
    assert(Number.isFinite(screenshotBytes) && screenshotBytes > 1_000, `chart.screenshot() returned ${screenshotBytes} bytes`);

    // Browser-level screenshot of the plot area: proves the compositor shows non-blank WebGL output.
    const png = await page.locator("#chart").screenshot();
    await writeFile(join(options.outDir, `${name}-${caseName}${engine === "webgl2" ? "" : `-${engine}`}.png`), png);
    const pixels = await analyzePng(page, png);
    assert(pixels.distinctColors >= 3, `${caseName} screenshot has ${pixels.distinctColors} distinct colors (blank?)`);
    assert(pixels.nonBackgroundRatio > 0.002, `${caseName} screenshot is ${(pixels.nonBackgroundRatio * 100).toFixed(3)}% non-background pixels (blank?)`);
    // Re-check after the screenshots: late context-restore warnings must fail the case too.
    if (errors.length > 0) throw new Error(`page errors in ${caseName}: ${errors[0]}`);
    console.log(`✓ visual ${caseName}${tag}: ${pixels.distinctColors} colors, ${(pixels.nonBackgroundRatio * 100).toFixed(2)}% drawn, screenshot ${screenshotBytes}B`);
  } catch (error) {
    await page.screenshot({ path: join(options.outDir, `${name}-${caseName}${engine === "webgl2" ? "" : `-${engine}`}-FAILED.png`) }).catch(() => undefined);
    throw error;
  } finally {
    await close();
  }
}

async function runInteractionCase(name: string, browser: Browser, options: Options, serverUrl: string, engine: Engine): Promise<void> {
  const { page, errors, close } = await newPage(browser, options, "interactions", name);
  try {
    await page.goto(new URL(`/interaction/?case=interactions${engine === "webgl2" ? "" : `&renderer=${engine}`}`, serverUrl).toString());
    let snapshot = await waitForInteractionReady(page, options.timeoutMs);
    const read = async (): Promise<InteractionSnapshot> => page.evaluate(() => (window as unknown as FixtureWindow).__blazeplotInteractionTest!.snapshot() as InteractionSnapshot);
    const rect = snapshot.canvasRect;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    await page.mouse.move(cx - 20, cy);
    await page.mouse.move(cx, cy, { steps: 4 });
    snapshot = await waitFor(page, options.timeoutMs, async () => {
      const value = await read();
      return value.hoverEvents > 0 && value.crosshairMoves > 0 ? value : null;
    }, "hover and crosshair events");
    assert(snapshot.visibleCrosshairs > 0, "crosshair is visible while hovering");

    const initialSpan = spanX(snapshot.viewport);
    await page.mouse.wheel(0, -400);
    snapshot = await waitFor(page, options.timeoutMs, async () => {
      const value = await read();
      return spanX(value.viewport) < initialSpan * 0.95 ? value : null;
    }, "wheel zoom to shrink the x span");

    const beforePan = snapshot.viewport.xMin;
    await page.keyboard.down("Shift");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    snapshot = await waitFor(page, options.timeoutMs, async () => {
      const value = await read();
      return Math.abs(value.viewport.xMin - beforePan) > 1 ? value : null;
    }, "shift-drag pan to change the viewport");

    await page.evaluate(() => (window as unknown as FixtureWindow).__blazeplotInteractionTest!.resetViewport());
    snapshot = await read();
    await page.mouse.move(rect.left + rect.width * 0.25, rect.top + rect.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(rect.left + rect.width * 0.75, rect.top + rect.height * 0.75, { steps: 8 });
    await page.mouse.up();
    snapshot = await waitFor(page, options.timeoutMs, async () => {
      const value = await read();
      return spanX(value.viewport) < spanX(value.initialViewport) * 0.7 ? value : null;
    }, "box zoom to shrink the x span");

    await page.mouse.dblclick(cx, cy);
    await waitFor(page, options.timeoutMs, async () => {
      const value = await read();
      return Math.abs(spanX(value.viewport) - spanX(value.initialViewport)) < 1 ? value : null;
    }, "double-click to reset the viewport");

    if (errors.length > 0) throw new Error(`page errors in interactions: ${errors[0]}`);
    console.log(`✓ interactions${engine === "webgl2" ? "" : ` [${engine}]`}: hover, crosshair, wheel zoom, shift pan, box zoom, double-click reset`);
  } catch (error) {
    await page.screenshot({ path: join(options.outDir, `${name}-interactions${engine === "webgl2" ? "" : `-${engine}`}-FAILED.png`) }).catch(() => undefined);
    throw error;
  } finally {
    await close();
  }
}

async function waitForInteractionReady(page: Page, timeoutMs: number): Promise<InteractionSnapshot> {
  return waitFor(page, timeoutMs, async () => {
    const value = await page.evaluate(() => (window as unknown as FixtureWindow).__blazeplotInteractionTest?.snapshot() as InteractionSnapshot | undefined);
    if (value?.state === "error") throw new Error(`interaction page reported error: ${value.error ?? "unknown"}`);
    return value?.state === "ready" ? value : null;
  }, "interaction page to become ready");
}

/** Decode a PNG in the page (no decoder dependency) and report how much of it differs from its corner color. */
async function analyzePng(page: Page, png: Buffer): Promise<PixelStats> {
  return page.evaluate(async (base64): Promise<PixelStats> => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable for pixel analysis");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      // Quantize to 4 bits per channel so antialiasing noise does not inflate the color count.
      const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let background = 0;
    for (const count of counts.values()) background = Math.max(background, count);
    const total = data.length / 4;
    return { width: bitmap.width, height: bitmap.height, distinctColors: counts.size, nonBackgroundRatio: (total - background) / total };
  }, png.toString("base64"));
}

async function waitFor<T>(page: Page, timeoutMs: number, probe: () => Promise<T | null>, description: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function spanX(viewport: Viewport): number {
  return viewport.xMax - viewport.xMin;
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function parseArgs(args: readonly string[]): Options {
  const envAllow = (process.env.BLAZEPLOT_CROSS_BROWSER_ALLOW_NO_WEBGL2 ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const parsed: Options = {
    browsers: DEFAULT_BROWSERS,
    visualCases: DEFAULT_VISUAL_CASES,
    allowNoWebgl2: new Set(envAllow),
    headed: new Set(),
    outDir: "build/cross-browser",
    width: 900,
    height: 520,
    port: 41745,
    timeoutMs: 30_000,
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
    const list = (): string[] => readValue().split(",").map((value) => value.trim()).filter(Boolean);

    switch (flag) {
      case "--browser":
      case "--browsers":
        parsed.browsers = list();
        break;
      case "--cases":
        parsed.visualCases = list();
        break;
      case "--allow-no-webgl2":
        for (const value of list()) parsed.allowNoWebgl2.add(value);
        break;
      case "--headed":
        for (const value of list()) parsed.headed.add(value);
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
      case "--timeout-ms":
        parsed.timeoutMs = readPositiveInteger(flag, readValue());
        break;
      case "--url":
        parsed.url = readValue();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return parsed;
}

function printHelp(): void {
  console.log(`Usage: bun run test:cross-browser [options]

Runs WebGL2, non-blank render, and hover/wheel/pan/box-zoom smoke checks in Playwright browsers.

Options:
  --browsers <a,b>        firefox, webkit, chromium (default: firefox,webkit)
  --cases <a,b>           Visual fixture cases (default: ${DEFAULT_VISUAL_CASES.join(",")})
  --allow-no-webgl2 <a,b> Browsers allowed to skip (loudly) when WebGL2 is unavailable.
                          Also read from BLAZEPLOT_CROSS_BROWSER_ALLOW_NO_WEBGL2.
  --headed <a,b>          Browsers to run headed instead of headless. On Linux CI, Firefox only finds a
                          software GL driver under a display, so CI runs: xvfb-run -a bun run test:cross-browser --headed firefox
  --out-dir <path>        Screenshot/report output directory (default: build/cross-browser)
  --width <px>            Viewport width
  --height <px>           Viewport height
  --port <port>           Vite port
  --timeout-ms <ms>       Per-wait timeout
  --url <url>             Use an already-running fixture server

Install browsers first: bunx playwright install firefox webkit (add --with-deps on Linux CI).
`);
}
