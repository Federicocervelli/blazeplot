/**
 * Comparison benchmark page. One page load measures exactly one (scenario, library) pair so every
 * sample comes from a fresh browser context with a clean heap and a cold-but-warmed-up JIT; the
 * Node driver (`scripts/benchmark-compare.ts`) repeats pages and aggregates medians.
 *
 * Run `window.__blazeplotCompare.start()` once `snapshot().state === "ready"`.
 */
import { installRafWorkAccounting } from "./common.ts";

installRafWorkAccounting();

import officialConfig from "../../../scripts/benchmark-config.json";
import { BOTTOM_GUTTER, LEFT_GUTTER, RIGHT_GUTTER, createChart } from "./adapters.ts";
import {
  animationFrame,
  nextFrameDone,
  round,
  settleFrames,
  settledHeapBytes,
  summarize,
  sum,
  takeRafCallbackWorkMs,
  type ChartHandle,
  type ChartSpec,
  type LibraryId,
  type ViewportRange,
} from "./common.ts";
import { buildData, type LibraryData } from "./data.ts";
import { SCENARIOS, THROUGHPUT_RATES, latestViewport, panViewport, staticViewport, type ScenarioImpl } from "./scenarios.ts";

type BenchmarkState = "prewarming" | "ready" | "running" | "done" | "error";
type DetailValue = number | string | boolean | null;

interface BrowserEnvironment {
  readonly userAgent: string;
  readonly language: string;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb?: number;
  readonly screen: { readonly width: number; readonly height: number; readonly colorDepth: number };
  readonly webglVendor: string | null;
  readonly webglRenderer: string | null;
  readonly webglVersion: string | null;
  readonly headlessUserAgent: boolean;
  readonly gcExposed: boolean;
}

export interface RunResult {
  readonly scenario: string;
  readonly library: LibraryId;
  readonly ok: boolean;
  readonly error?: string;
  readonly metrics: Record<string, number>;
  readonly details: Record<string, DetailValue>;
  readonly params: { readonly width: number; readonly height: number; readonly points: number; readonly visible: number; readonly seriesCount: number; readonly scale: number };
  readonly environment: BrowserEnvironment;
}

interface LoopResult {
  readonly rafFrameMs: number[];
  readonly workMs: number[];
  readonly internalFrameMs: number[];
  readonly points: number[];
  readonly draws: number[];
  readonly appended: number;
  readonly nextX: number;
}

interface Mounted {
  readonly host: HTMLElement;
  readonly handle: ChartHandle;
  readonly constructMs: number;
  readonly readyMs: number;
}

const params = new URLSearchParams(window.location.search);
const scenarioName = params.get("scenario") ?? "line-100k-static";
const library = (params.get("library") ?? "blazeplot") as LibraryId;
if (!(scenarioName in SCENARIOS)) throw new Error(`Unknown scenario: ${scenarioName}`);
if (!(officialConfig.libraries as readonly string[]).includes(library)) throw new Error(`Unknown library: ${library}`);

const canvasSize = { width: readIntParam("width", 1280), height: readIntParam("height", 720) };
const scale = Number(params.get("scale") ?? "1") || 1;
const setupWarmupRuns = readIntParam("setupWarmupRuns", 1);
const measureOverrideMs = readOptionalIntParam("measureMs");
const warmupOverrideMs = readOptionalIntParam("warmupMs");
const scenario = scaleScenario(SCENARIOS[scenarioName]!);
const fullSpec: ChartSpec = { ...scenario.spec, width: canvasSize.width, height: canvasSize.height };
const mount = document.getElementById("mount");
const statusTarget = document.getElementById("status");
if (!mount) throw new Error("No #mount container found");

let state: BenchmarkState = "prewarming";
let result: RunResult | null = null;
let error: string | null = null;
let runPromise: Promise<RunResult> | null = null;

window.__blazeplotCompare = {
  get state() {
    return state;
  },
  start,
  snapshot: () => ({ state, result, error }),
};

renderStatus("prewarming");
void prepare();

function scaleScenario(base: ScenarioImpl): ScenarioImpl {
  const scaled = (value: number, floor = 1_000): number => (scale === 1 ? value : Math.max(Math.min(value, floor), Math.round(value * scale)));
  return {
    ...base,
    measureMs: measureOverrideMs ?? (scale === 1 ? base.measureMs : Math.max(300, Math.round(base.measureMs * Math.min(1, scale * 10)))),
    warmupMs: warmupOverrideMs ?? (base.warmupMs > 0 && scale !== 1 ? 100 : base.warmupMs),
    count: base.count !== undefined && scale !== 1 ? Math.max(3, Math.round(base.count * Math.min(1, scale * 10))) : base.count,
    spec: { ...base.spec, points: scaled(base.spec.points), visible: scaled(base.spec.visible) },
  };
}

async function prepare(): Promise<void> {
  try {
    // A cold-page scenario must not warm anything up: it measures the first chart this page ever builds.
    if (scenario.kind !== "cold") await prewarmLibrary();
    state = "ready";
    renderStatus("ready");
  } catch (caught) {
    state = "error";
    error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    renderStatus("error");
  }
}

/** Build and destroy small charts of the scenario's series type so library code is compiled before any measurement. */
async function prewarmLibrary(): Promise<void> {
  const spec: ChartSpec = {
    ...fullSpec,
    points: Math.min(fullSpec.points, 20_000),
    visible: Math.min(fullSpec.visible, 20_000),
    seriesCount: Math.min(fullSpec.seriesCount, 3),
    accelerated: false,
    stream: false,
    sharedContext: false,
  };
  const data = buildData(spec, library);
  for (let i = 0; i < 2; i++) {
    const mounted = await mountAndPresent(spec, data, staticViewport(spec));
    mounted.handle.destroy();
    mounted.host.remove();
  }
  mount!.replaceChildren();
}

function start(): Promise<RunResult> {
  if (runPromise) return runPromise;
  if (state !== "ready") return Promise.reject(new Error(`Comparison benchmark is not ready; current state is ${state}`));
  runPromise = run();
  return runPromise;
}

async function run(): Promise<RunResult> {
  state = "running";
  renderStatus(`running ${scenarioName} on ${library}`);
  const metrics: Record<string, number> = {};
  const details: Record<string, DetailValue> = {};
  let ok = true;
  let failure: string | undefined;
  try {
    switch (scenario.kind) {
      case "static":
      case "cold":
        await runStatic(metrics, details);
        break;
      case "pan":
      case "stream":
        await runPanOrStream(metrics, details);
        break;
      case "soak":
        await runSoak(metrics, details);
        break;
      case "hover":
        await runHover(metrics, details);
        break;
      case "resize":
        await runResize(metrics, details);
        break;
      case "many":
        await runMany(metrics, details);
        break;
      case "cycle":
        await runCycle(metrics, details);
        break;
      case "throughput":
        await runThroughput(metrics, details);
        break;
    }
  } catch (caught) {
    ok = false;
    failure = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
  }
  result = {
    scenario: scenarioName,
    library,
    ok,
    ...(failure ? { error: failure } : {}),
    metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, round(value)])),
    details,
    params: { width: canvasSize.width, height: canvasSize.height, points: fullSpec.points, visible: fullSpec.visible, seriesCount: fullSpec.seriesCount, scale },
    environment: collectBrowserEnvironment(),
  };
  state = ok ? "done" : "error";
  error = failure ?? null;
  renderStatus(ok ? "done" : "error");
  return result;
}

// ------------------------------------------------------------------ mounting

function createHost(width: number, height: number, parent: HTMLElement = mount!): HTMLElement {
  const host = document.createElement("div");
  host.className = "bench-case";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  parent.append(host);
  return host;
}

/**
 * Construct a chart in a new host and wait until it is on screen. The clock covers library
 * construction (including layout and axes) through the end of the first frame in which the chart's
 * content has been drawn: libraries that draw synchronously are measured through the next frame
 * boundary, and BlazePlot (which draws in its first animation frame) through the frame that drew it.
 */
async function mountAndPresent(spec: ChartSpec, data: LibraryData, viewport: ViewportRange, parent?: HTMLElement): Promise<Mounted> {
  if (!parent) mount!.replaceChildren();
  const host = createHost(spec.width, spec.height, parent);
  const startedAt = performance.now();
  const handle = createChart(library, host, spec, data, viewport);
  const constructMs = performance.now() - startedAt;
  let presentedAt = await nextFrameDone();
  for (let guard = 0; !handle.hasContent() && guard < 240; guard++) presentedAt = await nextFrameDone();
  if (!handle.hasContent()) throw new Error("Chart never drew content within 240 frames.");
  return { host, handle, constructMs, readyMs: presentedAt - startedAt };
}

async function discardedSetupRuns(spec: ChartSpec, data: LibraryData): Promise<void> {
  const setupSpec: ChartSpec = scenario.kind === "stream" || scenario.kind === "throughput" ? { ...spec, streamExtra: 0 } : spec;
  for (let i = 0; i < setupWarmupRuns; i++) {
    renderStatus(`setup warmup ${i + 1}/${setupWarmupRuns}`);
    const mounted = await mountAndPresent(setupSpec, data, initialViewport(spec));
    mounted.handle.destroy();
    mounted.host.remove();
  }
}

function initialViewport(spec: ChartSpec): ViewportRange {
  return scenario.kind === "stream" || scenario.kind === "throughput" ? latestViewport(spec, spec.points) : staticViewport(spec);
}

function recordSizes(mounted: Mounted, details: Record<string, DetailValue>): void {
  details.plotWidth = round(mounted.handle.plotWidth(), 1);
  details.plotHeight = round(mounted.handle.plotHeight(), 1);
  // Time from the end of the constructor to the produced frame; ready = construct + this.
  details.presentWaitMs = round(mounted.readyMs - mounted.constructMs);
}

// ----------------------------------------------------------------- scenarios

async function runStatic(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const cold = scenario.kind === "cold";
  const heapBefore = cold ? null : await settledHeapBytes();
  const data = buildData(fullSpec, library);
  if (!cold) await discardedSetupRuns(fullSpec, data);
  mount!.replaceChildren();
  if (!cold) await settleFrames(2);
  const mounted = await mountAndPresent(fullSpec, data, staticViewport(fullSpec));
  metrics.readyMs = mounted.readyMs;
  metrics.constructMs = mounted.constructMs;
  recordSizes(mounted, details);
  if (!cold) {
    const heapAfter = await settledHeapBytes();
    if (heapBefore !== null && heapAfter !== null) metrics.heapMiB = (heapAfter - heapBefore) / (1024 * 1024);
  }
  mounted.handle.destroy();
}

async function runPanOrStream(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const rate = scenario.kind === "stream" ? (scenario.streamBatchSize ?? 1_024) * 60 : 0;
  const spec: ChartSpec = scenario.kind === "stream"
    ? { ...fullSpec, streamExtra: Math.ceil(((scenario.measureMs + scenario.warmupMs) / 1000) * rate * 1.8) + 4_096 }
    : fullSpec;
  const heapBefore = await settledHeapBytes();
  const data = buildData(spec, library);
  await discardedSetupRuns(spec, data);
  mount!.replaceChildren();
  await settleFrames(2);
  const mounted = await mountAndPresent(spec, data, initialViewport(spec));
  metrics.readyMs = mounted.readyMs;
  metrics.constructMs = mounted.constructMs;
  recordSizes(mounted, details);
  const heapAfterReady = await settledHeapBytes();
  if (heapBefore !== null && heapAfterReady !== null) metrics.heapMiB = (heapAfterReady - heapBefore) / (1024 * 1024);

  // Warm the update path (JIT, buffer growth) with the same operation, then measure.
  const op = scenario.kind === "stream" ? "stream" : "pan";
  let nextX = spec.points;
  if (scenario.warmupMs > 0) nextX = (await frameLoop(mounted.handle, spec, { op, durationMs: scenario.warmupMs, rate, startX: nextX })).nextX;
  const loop = await frameLoop(mounted.handle, spec, { op, durationMs: scenario.measureMs, rate, startX: nextX });
  recordLoop(loop, metrics, details);
  mounted.handle.destroy();
}

async function runSoak(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const data = buildData(fullSpec, library);
  await discardedSetupRuns(fullSpec, data);
  mount!.replaceChildren();
  await settleFrames(2);
  const mounted = await mountAndPresent(fullSpec, data, staticViewport(fullSpec));
  if (scenario.warmupMs > 0) await frameLoop(mounted.handle, fullSpec, { op: "pan", durationMs: scenario.warmupMs, rate: 0, startX: fullSpec.points });
  const heapBefore = await settledHeapBytes();
  const loop = await frameLoop(mounted.handle, fullSpec, { op: "pan", durationMs: scenario.measureMs, rate: 0, startX: fullSpec.points });
  const heapAfter = await settledHeapBytes();
  if (heapBefore !== null && heapAfter !== null) metrics.heapGrowthMiB = (heapAfter - heapBefore) / (1024 * 1024);
  recordLoop(loop, metrics, details);
  details.frames = loop.rafFrameMs.length;
  mounted.handle.destroy();
}

function recordLoop(loop: LoopResult, metrics: Record<string, number>, details: Record<string, DetailValue>): void {
  const raf = summarize(loop.rafFrameMs);
  const work = summarize(loop.workMs);
  const totalRafMs = sum(loop.rafFrameMs);
  metrics.rafFps = totalRafMs > 0 ? (loop.rafFrameMs.length * 1000) / totalRafMs : 0;
  metrics.rafP95Ms = raf.p95;
  metrics.workP50Ms = work.p50;
  metrics.workP95Ms = work.p95;
  details.frames = loop.rafFrameMs.length;
  details.appended = loop.appended;
  if (loop.internalFrameMs.length > 0) details.internalFrameP50Ms = summarize(loop.internalFrameMs).p50;
  if (loop.points.length > 0) details.pointsRenderedP50 = summarize(loop.points).p50;
  if (loop.draws.length > 0) details.drawCallsP50 = summarize(loop.draws).p50;
}

interface LoopOptions {
  readonly op: "pan" | "stream";
  readonly durationMs: number;
  /** Stream: samples per second. */
  readonly rate: number;
  readonly startX: number;
}

/**
 * Drive one library through an automated pan or live append at one update per animation frame.
 * Frame cost is the synchronous update/redraw call plus whatever the library does in its own
 * animation-frame callbacks (BlazePlot renders there), so libraries that redraw synchronously and
 * libraries that defer to the next frame are charged the same way. Frame cadence is the browser's
 * actual requestAnimationFrame interval, which also reflects raster and GPU back-pressure.
 */
async function frameLoop(handle: ChartHandle, spec: ChartSpec, options: LoopOptions): Promise<LoopResult> {
  const rafFrameMs: number[] = [];
  const workMs: number[] = [];
  const internalFrameMs: number[] = [];
  const points: number[] = [];
  const draws: number[] = [];
  let nextX = options.startX;
  let appended = 0;
  let lastRafAt = await animationFrame();
  takeRafCallbackWorkMs();
  const startedAt = performance.now();

  while (performance.now() - startedAt < options.durationMs) {
    const elapsedMs = performance.now() - startedAt;
    const operationStartedAt = performance.now();
    if (options.op === "pan") {
      handle.setViewport(panViewport(spec, elapsedMs, options.durationMs));
    } else {
      const targetX = options.startX + Math.floor((elapsedMs / 1000) * options.rate);
      const count = targetX - nextX;
      if (count > 0) {
        handle.append(nextX, count, latestViewport(spec, targetX));
        nextX = targetX;
        appended += count;
      }
    }
    const syncMs = performance.now() - operationStartedAt;
    const rafAt = await animationFrame();
    rafFrameMs.push(Math.max(0, rafAt - lastRafAt));
    lastRafAt = rafAt;
    workMs.push(syncMs + takeRafCallbackWorkMs());
    const stats = handle.internalStats?.();
    if (stats?.frameMs !== undefined) internalFrameMs.push(stats.frameMs);
    if (stats?.pointsRendered !== undefined) points.push(stats.pointsRendered);
    if (stats?.drawCalls !== undefined) draws.push(stats.drawCalls);
  }
  return { rafFrameMs, workMs, internalFrameMs, points, draws, appended, nextX };
}

async function runHover(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const data = buildData(fullSpec, library);
  await discardedSetupRuns(fullSpec, data);
  const mounted = await mountAndPresent(fullSpec, data, staticViewport(fullSpec));
  recordSizes(mounted, details);
  const rect = mounted.host.getBoundingClientRect();
  const left = rect.left + LEFT_GUTTER + 12;
  const right = rect.right - 12;
  const top = rect.top + 12;
  const bottom = rect.bottom - BOTTOM_GUTTER - 12;
  const pointAt = (i: number): [number, number] => [left + (right - left) * fraction(i * 0.6180339887), top + (bottom - top) * fraction(i * 0.4142135623 + 0.3)];

  const [firstX, firstY] = pointAt(0);
  const enterTarget = document.elementFromPoint(firstX, firstY) ?? mounted.host;
  for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter"]) dispatchPointer(enterTarget, type, firstX, firstY);

  const latencyMs: number[] = [];
  const handlerMs: number[] = [];
  const warmupMoves = 60;
  const measuredMoves = 300;
  for (let i = 0; i < warmupMoves + measuredMoves; i++) {
    const [x, y] = pointAt(i + 1);
    const target = document.elementFromPoint(x, y) ?? mounted.host;
    const startedAt = performance.now();
    dispatchPointer(target, "pointermove", x, y);
    dispatchPointer(target, "mousemove", x, y);
    const handledAt = performance.now();
    const presentedAt = await nextFrameDone();
    if (i >= warmupMoves) {
      latencyMs.push(presentedAt - startedAt);
      handlerMs.push(handledAt - startedAt);
    }
  }
  const latency = summarize(latencyMs);
  metrics.hoverP50Ms = latency.p50;
  metrics.hoverP95Ms = latency.p95;
  details.handlerP50Ms = summarize(handlerMs).p50;
  details.hoverActive = mounted.handle.hoverActive?.() ?? null;
  mounted.handle.destroy();
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

function dispatchPointer(target: Element, type: string, clientX: number, clientY: number): void {
  const init = { bubbles: true, cancelable: true, composed: true, clientX, clientY, view: window, button: 0, buttons: 0 };
  if (type.startsWith("pointer")) target.dispatchEvent(new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  else target.dispatchEvent(new MouseEvent(type, init));
}

async function runResize(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const data = buildData(fullSpec, library);
  await discardedSetupRuns(fullSpec, data);
  const mounted = await mountAndPresent(fullSpec, data, staticViewport(fullSpec));
  recordSizes(mounted, details);
  const sizes = [
    { width: canvasSize.width, height: canvasSize.height },
    { width: Math.round(canvasSize.width * 0.8), height: Math.round(canvasSize.height * 0.85) },
  ];
  const rightGutter = fullSpec.dualAxis ? RIGHT_GUTTER : 0;
  const latencyMs: number[] = [];
  const warmupResizes = 10;
  const measuredResizes = 60;
  let current = 0;
  for (let i = 0; i < warmupResizes + measuredResizes; i++) {
    current = 1 - current;
    const target = sizes[current]!;
    const expectedWidth = target.width - LEFT_GUTTER - rightGutter;
    const drawsBefore = mounted.handle.drawCount();
    const startedAt = performance.now();
    mounted.host.style.width = `${target.width}px`;
    mounted.host.style.height = `${target.height}px`;
    let guard = 0;
    // Wait for the library to redraw at the new size (each reports draws through its own hook), then for that frame to be produced.
    while (!(mounted.handle.drawCount() > drawsBefore && Math.abs(mounted.handle.plotWidth() - expectedWidth) <= 2) && guard++ < 600) await animationFrame();
    if (guard >= 600) throw new Error(`Chart did not redraw at ${target.width}px (plot width ${mounted.handle.plotWidth()}, expected ${expectedWidth}).`);
    const presentedAt = await nextFrameDone();
    if (i >= warmupResizes) latencyMs.push(presentedAt - startedAt);
  }
  const latency = summarize(latencyMs);
  metrics.resizeP50Ms = latency.p50;
  metrics.resizeP95Ms = latency.p95;
  mounted.handle.destroy();
}

async function runMany(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const count = scenario.count ?? 50;
  const cell = scenario.cell ?? { width: 400, height: 180 };
  const spec: ChartSpec = { ...fullSpec, width: cell.width, height: cell.height };
  const heapBefore = await settledHeapBytes();
  const datasets = Array.from({ length: count }, () => buildData(spec, library));

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = `repeat(3, ${cell.width}px)`;

  const mountAll = async (measure: boolean): Promise<{ handles: ChartHandle[]; hosts: HTMLElement[]; readyMs: number }> => {
    mount!.replaceChildren(grid);
    const handles: ChartHandle[] = [];
    const hosts: HTMLElement[] = [];
    const startedAt = performance.now();
    for (let i = 0; i < count; i++) {
      const host = createHost(cell.width, cell.height, grid);
      hosts.push(host);
      handles.push(createChart(library, host, spec, datasets[i]!, staticViewport(spec)));
    }
    let presentedAt = await nextFrameDone();
    for (let guard = 0; !handles.every((handle) => handle.hasContent()) && guard < 480; guard++) presentedAt = await nextFrameDone();
    if (measure && !handles.every((handle) => handle.hasContent())) throw new Error("Not every chart drew content within 480 frames.");
    return { handles, hosts, readyMs: presentedAt - startedAt };
  };
  const destroyAll = (handles: ChartHandle[], hosts: HTMLElement[]): number => {
    const startedAt = performance.now();
    for (const handle of handles) handle.destroy();
    const elapsed = performance.now() - startedAt;
    for (const host of hosts) host.remove();
    return elapsed;
  };

  // Discarded run: first-time shader compilation, context creation and JIT must not be charged to the measured run.
  for (let i = 0; i < setupWarmupRuns; i++) {
    const warm = await mountAll(false);
    destroyAll(warm.handles, warm.hosts);
    await settleFrames(2);
  }
  await settleFrames(2);
  const measured = await mountAll(true);
  metrics.readyMs = measured.readyMs;
  const heapAfter = await settledHeapBytes();
  if (heapBefore !== null && heapAfter !== null) metrics.heapMiB = (heapAfter - heapBefore) / (1024 * 1024);
  details.charts = count;
  details.plotWidth = round(measured.handles[0]!.plotWidth(), 1);
  details.plotHeight = round(measured.handles[0]!.plotHeight(), 1);
  metrics.destroyMs = destroyAll(measured.handles, measured.hosts);
}

async function runCycle(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const cycles = scenario.count ?? 40;
  const data = buildData(fullSpec, library);
  await discardedSetupRuns(fullSpec, data);
  mount!.replaceChildren();
  await settleFrames(2);
  const heapBefore = await settledHeapBytes();
  const cycleMs: number[] = [];
  for (let i = 0; i < cycles; i++) {
    mount!.replaceChildren();
    const host = createHost(fullSpec.width, fullSpec.height);
    const startedAt = performance.now();
    const handle = createChart(library, host, fullSpec, data, staticViewport(fullSpec));
    await nextFrameDone();
    for (let guard = 0; !handle.hasContent() && guard < 240; guard++) await nextFrameDone();
    handle.destroy();
    host.remove();
    cycleMs.push(performance.now() - startedAt);
  }
  const cycle = summarize(cycleMs);
  metrics.cycleP50Ms = cycle.p50;
  metrics.cycleP95Ms = cycle.p95;
  const heapAfter = await settledHeapBytes();
  if (heapBefore !== null && heapAfter !== null) metrics.leakMiB = (heapAfter - heapBefore) / (1024 * 1024);
  details.cycles = cycles;
}

async function runThroughput(metrics: Record<string, number>, details: Record<string, DetailValue>): Promise<void> {
  const budgetMs = officialConfig.frameBudgetMs;
  const rates: readonly number[] = scale === 1 ? THROUGHPUT_RATES : THROUGHPUT_RATES.slice(0, 4);
  const spec: ChartSpec = fullSpec;
  const data = buildData(spec, library);
  await discardedSetupRuns(spec, data);
  mount!.replaceChildren();
  await settleFrames(2);
  const mounted = await mountAndPresent(spec, data, initialViewport(spec));
  let nextX = spec.points;
  if (scenario.warmupMs > 0) nextX = (await frameLoop(mounted.handle, spec, { op: "stream", durationMs: scenario.warmupMs, rate: rates[0]!, startX: nextX })).nextX;
  let best = 0;
  for (const rate of rates) {
    const loop = await frameLoop(mounted.handle, spec, { op: "stream", durationMs: scenario.measureMs, rate, startX: nextX });
    nextX = loop.nextX;
    const p95 = summarize(loop.rafFrameMs).p95;
    details[`p95FrameMs@${rate / 1000}k`] = p95;
    if (p95 > budgetMs) break;
    best = rate;
  }
  metrics.maxSustainedKsps = best / 1000;
  details.frameBudgetMs = budgetMs;
  mounted.handle.destroy();
}

// --------------------------------------------------------------------- misc

function collectBrowserEnvironment(): BrowserEnvironment {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
  const webglVendor = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : gl ? String(gl.getParameter(gl.VENDOR)) : null;
  const webglRenderer = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : gl ? String(gl.getParameter(gl.RENDERER)) : null;
  const webglVersion = gl ? String(gl.getParameter(gl.VERSION)) : null;
  gl?.getExtension("WEBGL_lose_context")?.loseContext();

  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: navigator.deviceMemory,
    screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    webglVendor,
    webglRenderer,
    webglVersion,
    headlessUserAgent: /HeadlessChrome/i.test(navigator.userAgent),
    gcExposed: typeof window.gc === "function",
  };
}

function renderStatus(message: string): void {
  if (!statusTarget) return;
  statusTarget.textContent = [
    "BlazePlot comparison benchmark",
    `state: ${state}`,
    `scenario: ${scenarioName}`,
    `library: ${library}`,
    `canvas: ${canvasSize.width}x${canvasSize.height}`,
    `message: ${message}`,
    error ? `error: ${error}` : "",
  ].filter(Boolean).join("\n");
}

function readIntParam(name: string, fallback: number): number {
  return readOptionalIntParam(name) ?? fallback;
}

function readOptionalIntParam(name: string): number | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && Math.floor(value) === value ? value : undefined;
}

