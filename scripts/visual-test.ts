#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { compareEngines, CROSS_ENGINE_THRESHOLDS, IDENTICAL_THRESHOLDS } from "./cross-engine.js";
import type { CrossEngineKind, CrossEngineResult } from "./cross-engine.js";
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
  /** Renderer configurations to run; see RENDERER_MODES. */
  renderers: RendererMode[];
  /** Print cross-engine metrics without failing, for recalibrating the thresholds in scripts/cross-engine.ts. */
  crossEngineReportOnly: boolean;
}

/**
 * Renderer configurations. `webgl2` is the primary run and owns the committed pixel baselines.
 * `canvas2d` forces the Canvas 2D renderer. `shared` renders through the shared WebGL2 context (one hidden
 * context, blitted into each chart canvas). When `webgl2` runs in the same invocation, both are compared with
 * its render of the same case (see scripts/cross-engine.ts): `shared` must match to 8-bit rounding, `canvas2d` within the
 * per-kind parity thresholds. Without a `webgl2` run in the invocation they fall back to the committed baselines
 * (`canvas2d` with a looser tolerance, since antialiasing and pixel snapping differ).
 * `auto-no-webgl` launches Chrome with WebGL disabled and checks that the default `"auto"` renderer falls back.
 */
type RendererMode = "webgl2" | "shared" | "canvas2d" | "auto-no-webgl";
const RENDERER_MODES: readonly RendererMode[] = ["webgl2", "shared", "canvas2d", "auto-no-webgl"];
/** Canvas 2D may differ from the WebGL baselines in this many times the baseline's allowed pixel ratio. */
const CANVAS2D_DIFF_FACTOR = 15;
/** Cases that need a real WebGL context and are skipped when it is disabled. */
const WEBGL_ONLY_CASES = new Set(["context-restore"]);

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
  "exact-line-long",
  "exact-line-thin-dense",
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
  "gaps",
  "translucent-overlap",
  "scatter-markers",
  "scatter-markers-dpr2",
  "large-y-offset",
  "dense-area-spike",
  "screenshot-overlays",
  "screenshot-first",
  "annotations-log-reversed",
  "annotations-symlog",
];

/**
 * Per-case checks. Ink ratios are deliberately loose lower bounds (a fraction of what a healthy render
 * produces) so they only fail on blank or near-uniform canvases; the pixel baselines catch subtle changes.
 * Baselined cases are deterministic (no pointer input, static data) and cropped to the WebGL plot area when
 * possible so they do not depend on DOM font rendering.
 */
const CASE_CHECKS: Readonly<Record<string, CaseCheck>> = {
  line: { minInkRatio: 0.004, baseline: { region: "plot" } },
  "exact-line-long": { minInkRatio: 0.004 },
  "exact-line-thin-dense": { minInkRatio: 0.004 },
  area: { minInkRatio: 0.1, baseline: { region: "plot" } },
  scatter: { minInkRatio: 0.01, baseline: { region: "plot" } },
  bar: { minInkRatio: 0.15, baseline: { region: "plot" } },
  histogram: { minInkRatio: 0.2, baseline: { region: "plot" } },
  ohlc: { minInkRatio: 0.004, baseline: { region: "plot" } },
  candlestick: { minInkRatio: 0.012, baseline: { region: "plot" } },
  "axes-title-grid": { minInkRatio: 0.006, baseline: { region: "chart", maxDiffRatio: 0.01 } },
  legend: { minInkRatio: 0.004 },
  tooltip: { minInkRatio: 0.004 },
  crosshair: { minInkRatio: 0.004 },
  annotations: { minInkRatio: 0.1, baseline: { region: "chart", maxDiffRatio: 0.01 } },
  selection: { minInkRatio: 0.004 },
  navigator: { minInkRatio: 0.004 },
  flamegraph: { minInkRatio: 0.25, probe: "flamegraph", baseline: { region: "chart", maxDiffRatio: 0.01 } },
  "scale-options": { minInkRatio: 0.0025, baseline: { region: "plot" } },
  "overlay-layering": { minInkRatio: 0.003 },
  "context-restore": { minInkRatio: 0.004 },
  gaps: { minInkRatio: 0.004 },
  // These cases assert their pixels inside the page (see assertPixelCase in tests/browser/visual/main.ts).
  "translucent-overlap": { minInkRatio: 0.1 },
  "scatter-markers": { minInkRatio: 0.00002 },
  "scatter-markers-dpr2": { minInkRatio: 0.00002 },
  "large-y-offset": { minInkRatio: 0.01 },
  "dense-area-spike": { minInkRatio: 0.01 },
  "screenshot-overlays": { minInkRatio: 0.004 },
  "screenshot-first": { minInkRatio: 0.004 },
  "annotations-log-reversed": { minInkRatio: 0.004 },
  "annotations-symlog": { minInkRatio: 0.004 },
};
const DEFAULT_CASE_CHECK: CaseCheck = { minInkRatio: 0.004 };

/**
 * What each case mostly draws, which picks its cross-engine threshold (see scripts/cross-engine.ts): rectangles
 * are compared per pixel, everything with antialiased edges after a blur. `null` skips the comparison.
 */
const CROSS_ENGINE_KINDS: Readonly<Record<string, CrossEngineKind | null>> = {
  bar: "fill",
  histogram: "fill",
  "translucent-overlap": "fill",
  "exact-line-long": "dense-stroke",
  "exact-line-thin-dense": "dense-stroke",
  "dense-area-spike": "fill",
  // Needs a real WebGL context that Canvas 2D cannot offer.
  "context-restore": null,
};
const DEFAULT_CROSS_ENGINE_KIND: CrossEngineKind = "stroke";

/** Plot-area crops (grid hidden) per renderer mode and case, kept in memory for the cross-engine comparison. */
type ModeCaptures = Map<string, RgbaImage>;

await main();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  let viteProc: Bun.Subprocess | null = null;

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
    const failures: string[] = [];
    const captures = new Map<RendererMode, ModeCaptures>();
    for (const [index, mode] of options.renderers.entries()) {
      const run = await runMode(mode, index, options, serverUrl, chromePath);
      failures.push(...run.failures);
      captures.set(mode, run.captures);
    }
    const parity = await compareRenderers(captures, options);
    if (options.crossEngineReportOnly) {
      if (parity.length > 0) console.warn(`cross-engine report: ${parity.length} comparison(s) would fail (not enforced)`);
    } else {
      failures.push(...parity);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} visual case(s) failed:\n  - ${failures.join("\n  - ")}`);
    }
    if (options.baselines === "update") console.log(`Baselines written to ${options.baselineDir}`);
  } finally {
    if (viteProc) viteProc.kill();
  }
}

interface CrossEngineRow {
  readonly renderer: RendererMode;
  readonly caseName: string;
  readonly kind: CrossEngineKind | "identical";
  readonly result: CrossEngineResult;
}

/**
 * Compare every other renderer's plot crop with the `webgl2` crop of the same case: `shared` must match to the
 * bit, `canvas2d` within the thresholds for the case's kind. Failures keep both crops under `cross-engine/`.
 */
async function compareRenderers(captures: ReadonlyMap<RendererMode, ModeCaptures>, options: Options): Promise<string[]> {
  const reference = captures.get("webgl2");
  if (!reference) return [];
  const failures: string[] = [];
  const rows: CrossEngineRow[] = [];
  for (const mode of ["shared", "canvas2d"] as const) {
    const images = captures.get(mode);
    if (!images) continue;
    for (const [caseName, image] of images) {
      const expected = reference.get(caseName);
      if (!expected) continue;
      const kind = mode === "shared" ? "identical" : CROSS_ENGINE_KINDS[caseName] === undefined ? DEFAULT_CROSS_ENGINE_KIND : CROSS_ENGINE_KINDS[caseName];
      if (kind === null) continue;
      const thresholds = kind === "identical" ? IDENTICAL_THRESHOLDS : CROSS_ENGINE_THRESHOLDS[kind];
      const result = compareEngines(expected, image, thresholds);
      rows.push({ renderer: mode, caseName, kind, result });
      const note = `${(result.diffRatio * 100).toFixed(3)}% differ (${result.diffPixels}px, max delta ${result.maxChannelDelta}), ink ratio ${result.inkRatio.toFixed(3)}`;
      if (result.ok) {
        console.log(`✓ [crossEngine ${mode}] ${caseName} (${kind}): ${note}`);
        continue;
      }
      const dir = join(options.outDir, "cross-engine", mode);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${caseName}.webgl2.png`), encodePng(expected));
      await writeFile(join(dir, `${caseName}.${mode}.png`), encodePng(image));
      const message = `[crossEngine ${mode}] ${caseName} (${kind}): ${result.failures.join("; ")}`;
      failures.push(message);
      console.error(`✗ ${message}; ${note}. Crops: ${dir}`);
    }
  }
  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, "cross-engine.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), rows: rows.map((row) => ({ renderer: row.renderer, case: row.caseName, kind: row.kind, ok: row.result.ok, diffRatio: row.result.diffRatio, diffPixels: row.result.diffPixels, maxChannelDelta: row.result.maxChannelDelta, inkRatio: row.result.inkRatio, referenceBounds: row.result.referenceBounds, otherBounds: row.result.otherBounds })) }, null, 2)}\n`);
  return failures;
}

/** Run the selected cases for one renderer configuration in its own browser; returns the failure messages. */
async function runMode(mode: RendererMode, index: number, base: Options, serverUrl: string, chromePath: string): Promise<{ failures: string[]; captures: ModeCaptures }> {
  const options: Options = {
    ...base,
    outDir: mode === "webgl2" ? base.outDir : join(base.outDir, mode),
    debugPort: base.debugPort + index,
    cases: base.cases.filter((name) => mode !== "auto-no-webgl" || !WEBGL_ONLY_CASES.has(name)),
    // Pixel baselines belong to the WebGL run. Other renderers are compared with it directly when it runs in the
    // same invocation; the fallback run only checks ink.
    baselines: mode === "auto-no-webgl" || (mode !== "webgl2" && (base.baselines === "update" || base.renderers.includes("webgl2"))) ? "skip" : base.baselines,
  };
  const diffFactor = mode === "canvas2d" ? CANVAS2D_DIFF_FACTOR : 1;
  const captures: ModeCaptures = new Map();
  const label = mode === "webgl2" ? "" : `[${mode}] `;
  await mkdir(options.outDir, { recursive: true });
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;

  try {
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-visual-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options, mode === "auto-no-webgl" ? ["--disable-3d-apis"] : []);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    const summary: CaseResult[] = [];
    const failures: string[] = [];
    for (const caseName of options.cases) {
      const url = new URL("/visual/", serverUrl);
      url.searchParams.set("case", caseName);
      if (mode === "shared") {
        url.searchParams.set("renderer", "shared");
        url.searchParams.set("expectRenderer", "shared");
      } else if (mode === "canvas2d") {
        url.searchParams.set("renderer", "canvas2d");
        url.searchParams.set("expectRenderer", "canvas2d");
      } else if (mode === "auto-no-webgl") {
        url.searchParams.set("renderer", "auto");
        url.searchParams.set("expectRenderer", "canvas2d");
      }
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

        captures.set(caseName, probeImage);
        const result: CaseResult = { caseName, screenshot: screenshotPath, chartScreenshotBytes, assertions: snapshot.assertions ?? [], inkRatio: ink.ratio, minInkRatio: check.minInkRatio };
        summary.push(result);
        let baselineNote = "";
        if (check.baseline) {
          const region = check.baseline.region === "chart" ? rects.root : rects.plot;
          const actual = await captureRegion(cdp, region);
          const outcome = await checkBaseline(caseName, actual, (check.baseline.maxDiffRatio ?? BASELINE_MAX_DIFF_RATIO) * diffFactor, options);
          result.baseline = outcome.summary;
          baselineNote = `, baseline ${outcome.note}`;
          if (outcome.failure) {
            failures.push(outcome.failure);
            console.error(`✗ ${label}${outcome.failure}`);
            continue;
          }
        }
        console.log(`✓ ${label}${caseName}: ink ${(ink.ratio * 100).toFixed(2)}%${baselineNote}; ${(snapshot.assertions ?? []).join(", ")}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${label}${caseName}: ${message}`);
        console.error(`✗ ${label}${caseName}: ${message}`);
      } finally {
        cdp.close();
      }
    }

    const reportPath = join(options.outDir, "summary.json");
    await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), renderer: mode, browser: basename(chromePath), platform: process.platform, baselines: options.baselines, cases: summary }, null, 2)}\n`);
    console.log(`${label}Visual test screenshots written to ${options.outDir}`);
    return { failures, captures };
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
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
    crossEngineReportOnly: false,
    renderers: [...RENDERER_MODES],
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
      case "--renderer":
      case "--renderers":
        parsed.renderers = readValue().split(",").map((value) => {
          const mode = value.trim() as RendererMode;
          if (!RENDERER_MODES.includes(mode)) throw new Error(`Unknown renderer ${value}; expected one of ${RENDERER_MODES.join(", ")}`);
          return mode;
        });
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
      case "--cross-engine-report":
        parsed.crossEngineReportOnly = true;
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
  --renderer <a,b>       Renderer runs, any of ${RENDERER_MODES.join(", ")} (default: all). canvas2d is compared to the WebGL baselines with a looser tolerance; auto-no-webgl disables WebGL in Chrome and checks the fallback
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
  --cross-engine-report  Print the cross-engine parity metrics without failing (recalibrating scripts/cross-engine.ts)
  --skip-baselines       Skip pixel baseline comparison (blank-canvas checks still run)
  --compare-baselines    Compare baselines even on non-Linux platforms (skipped there by default)
  --baseline-dir <path>  Baseline PNG directory (default ${DEFAULT_BASELINE_DIR})
`);
  process.exit(0);
}

function launchChrome(chromePath: string, userDataDir: string, opts: Options, extraArgs: readonly string[] = []): Bun.Subprocess {
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
    ...extraArgs,
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
