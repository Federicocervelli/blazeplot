import { Chart } from "@/index.ts";
import type { ChartPlugin, SeriesStore } from "@/index.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import { flameGraphPlugin } from "@/plugins/flamegraph.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { navigatorPlugin } from "@/plugins/navigator.ts";
import { selectionPlugin } from "@/plugins/selection.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";

/**
 * Page-side workloads for `scripts/stability-test.ts`.
 *
 * The page only drives chart lifecycles and reports cheap, deterministic counters (DOM element
 * count, live WebGL objects). Heap and DOM-counter measurements that need a forced GC are taken
 * from outside the page over the Chrome DevTools Protocol, so nothing here forces or waits for GC.
 */

type GlKind = "buffer" | "program" | "shader" | "vertexArray" | "texture" | "framebuffer" | "renderbuffer";

export interface GlCounts {
  readonly buffer: number;
  readonly program: number;
  readonly shader: number;
  readonly vertexArray: number;
  readonly texture: number;
  readonly framebuffer: number;
  readonly renderbuffer: number;
  /** Number of `getContext("webgl2")` calls that created a new context. */
  readonly contextsCreated: number;
  /**
   * WebGL contexts that have not been lost, among those not yet garbage collected. Browsers cap live
   * contexts (about 16 per page) and evict the oldest when the cap is hit, so a disposed chart must
   * not keep its context alive while it waits for GC.
   */
  readonly liveContexts: number;
}

export interface PageProbe {
  /** Every element in the document. Exact, unlike the engine's DOM counters, so it can be compared strictly. */
  readonly elements: number;
  readonly canvases: number;
  readonly stageChildren: number;
  readonly gl: GlCounts;
}

export interface WorkloadResult {
  readonly iterations: number;
  readonly renders: number;
  readonly ms: number;
}

export interface StreamingConfig {
  readonly series: number;
  readonly capacity: number;
  /** Samples appended per series on every tick. */
  readonly batch: number;
  readonly tickMs: number;
  /** Interactive plugins on top of the stream, so hover/tooltip paths run while data flows. */
  readonly plugins: boolean;
}

export interface StreamingStats {
  readonly running: boolean;
  readonly ticks: number;
  /** Samples appended per series so far, including the initial prefill. */
  readonly appendedPerSeries: number;
  readonly capacity: number;
  readonly renders: number;
  readonly retainedSamples: number;
}

export interface ContextLossResult {
  readonly cycles: number;
  readonly lostEvents: number;
  readonly restoredEvents: number;
  readonly rendersAfterRestore: number;
  readonly drawCallsAfterRestore: number;
  readonly litPixelsAfterRestore: number;
  readonly disposedWhileLost: boolean;
}

export interface StabilityController {
  ready: boolean;
  probe(): PageProbe;
  mountUnmount(count: number): Promise<WorkloadResult>;
  /** Negative control: mounts charts and keeps them alive so the harness can prove it detects growth. */
  mountRetained(count: number): Promise<WorkloadResult>;
  releaseRetained(): number;
  resizeChurn(count: number): Promise<WorkloadResult>;
  seriesChurn(count: number): Promise<WorkloadResult>;
  startStreaming(config: StreamingConfig): Promise<StreamingStats>;
  streamingStats(): StreamingStats;
  stopStreaming(): StreamingStats;
  contextLoss(cycles: number): Promise<ContextLossResult>;
}

declare global {
  interface Window {
    __blazeplotStability: StabilityController;
  }
}

const stage = requireElement("stage");
const statusEl = requireElement("status");
const glLive: Record<GlKind, number> = { buffer: 0, program: 0, shader: 0, vertexArray: 0, texture: 0, framebuffer: 0, renderbuffer: 0 };
let contextsCreated = 0;
let contextRefs: Array<WeakRef<WebGL2RenderingContext>> = [];
installGlTracking();

const retained: Array<{ chart: Chart; host: HTMLElement }> = [];
let renderCount = 0;

window.__blazeplotStability = {
  ready: true,
  probe,
  mountUnmount,
  mountRetained,
  releaseRetained,
  resizeChurn,
  seriesChurn,
  startStreaming,
  streamingStats,
  stopStreaming,
  contextLoss,
};
setStatus("ready");

function installGlTracking(): void {
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const kinds: Array<[string, GlKind]> = [
    ["Buffer", "buffer"],
    ["Program", "program"],
    ["Shader", "shader"],
    ["VertexArray", "vertexArray"],
    ["Texture", "texture"],
    ["Framebuffer", "framebuffer"],
    ["Renderbuffer", "renderbuffer"],
  ];
  for (const [suffix, kind] of kinds) {
    const create = proto[`create${suffix}`];
    const remove = proto[`delete${suffix}`];
    if (!create || !remove) continue;
    // A deleted object must not be counted twice if a caller deletes it again.
    const deleted = new WeakSet<object>();
    proto[`create${suffix}`] = function patchedCreate(this: unknown, ...args: unknown[]): unknown {
      const object = create.apply(this, args);
      if (object) glLive[kind]++;
      return object;
    };
    proto[`delete${suffix}`] = function patchedDelete(this: unknown, ...args: unknown[]): unknown {
      const object = args[0];
      if (object && typeof object === "object" && !deleted.has(object)) {
        deleted.add(object);
        glLive[kind]--;
      }
      return remove.apply(this, args);
    };
  }

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const seen = new WeakSet<HTMLCanvasElement>();
  HTMLCanvasElement.prototype.getContext = function patchedGetContext(this: HTMLCanvasElement, ...args: unknown[]): unknown {
    const context = (originalGetContext as (...a: unknown[]) => unknown).apply(this, args);
    if (args[0] === "webgl2" && context && !seen.has(this)) {
      seen.add(this);
      contextsCreated++;
      contextRefs.push(new WeakRef(context as WebGL2RenderingContext));
    }
    return context;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

function countLiveContexts(): number {
  let live = 0;
  const alive: Array<WeakRef<WebGL2RenderingContext>> = [];
  for (const ref of contextRefs) {
    const gl = ref.deref();
    if (!gl) continue;
    alive.push(ref);
    if (!gl.isContextLost()) live++;
  }
  contextRefs = alive;
  return live;
}

function probe(): PageProbe {
  return {
    elements: document.getElementsByTagName("*").length,
    canvases: document.getElementsByTagName("canvas").length,
    stageChildren: stage.childElementCount,
    gl: { ...glLive, contextsCreated, liveContexts: countLiveContexts() },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fullPlugins(): ChartPlugin[] {
  return [
    interactionsPlugin(),
    legendPlugin(),
    tooltipPlugin({ mode: "nearest-x", group: "x" }),
    crosshairPlugin(),
    selectionPlugin(),
    annotationsPlugin({ annotations: [{ type: "x-line", x: 50, label: "marker" }] }),
    navigatorPlugin(),
  ];
}

function createHost(width: number, height: number): HTMLElement {
  const host = document.createElement("div");
  host.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px`;
  stage.appendChild(host);
  return host;
}

function newChart(host: HTMLElement, plugins: boolean): Chart {
  return new Chart(host, {
    axes: { x: true, y: true, y2: true },
    title: "stability",
    plugins: plugins ? fullPlugins() : [],
  });
}

function addSampleSeries(chart: Chart, points = 200): SeriesStore[] {
  const x = Float64Array.from({ length: points }, (_, i) => i);
  const wave = (phase: number): Float32Array => Float32Array.from(x, (v) => Math.sin(v / 12 + phase) * 40 + 50);
  const line = chart.addLine({ capacity: points, name: "line" });
  line.append({ x, y: wave(0) });
  const area = chart.addArea({ capacity: points, name: "area" });
  area.append({ x, y: wave(1) });
  const scatter = chart.addScatter({ capacity: points, name: "scatter" });
  scatter.append({ x, y: wave(2) });
  const bars = chart.addBar({ capacity: points, name: "bars", yAxis: "right" });
  bars.append({ x, y: wave(3) });
  return [line, area, scatter, bars];
}

function hover(chart: Chart): void {
  const rect = chart.canvas.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const init: PointerEventInit = { clientX, clientY, pointerId: 1, pointerType: "mouse", bubbles: true };
  chart.canvas.dispatchEvent(new PointerEvent("pointermove", init));
  chart.canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, button: 0, buttons: 1 }));
  chart.canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, button: 0, buttons: 0 }));
  chart.canvas.dispatchEvent(new PointerEvent("pointerleave", init));
}

/** Resolve after the next completed chart render, or fail after `timeoutMs`. */
function nextRender(chart: Chart, timeoutMs = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(`chart did not render within ${timeoutMs}ms`));
    }, timeoutMs);
    const unsubscribe = chart.subscribe("render", () => {
      window.clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const tick = (): void => (--remaining <= 0 ? resolve() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function countRenders(chart: Chart): () => number {
  let renders = 0;
  chart.subscribe("render", () => {
    renders++;
    renderCount++;
  });
  return () => renders;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// ---------------------------------------------------------------------------
// (1) Mount / unmount
// ---------------------------------------------------------------------------

let mountCounter = 0;
const FLAME_STACKS = ["main;render;draw 12", "main;render;layout 7", "main;io;read 4"].join("\n");

/** Every fourth mount is a flame graph, which owns a second WebGL context on top of the chart's. */
async function mountOnce(): Promise<number> {
  const flame = ++mountCounter % 4 === 0;
  const host = createHost(480, 280);
  const chart = flame
    ? new Chart(host, { axes: { x: true, y: false }, plugins: [flameGraphPlugin({ foldedStacks: FLAME_STACKS })] })
    : newChart(host, true);
  const renders = countRenders(chart);
  if (!flame) {
    addSampleSeries(chart);
    chart.fitToData({ padding: 0.05 });
  }
  chart.start();
  await nextRender(chart);
  hover(chart);
  await frames(1);
  chart.dispose();
  host.remove();
  return renders();
}

async function mountUnmount(count: number): Promise<WorkloadResult> {
  const startedAt = performance.now();
  let renders = 0;
  for (let i = 0; i < count; i++) renders += await mountOnce();
  return { iterations: count, renders, ms: performance.now() - startedAt };
}

async function mountRetained(count: number): Promise<WorkloadResult> {
  const startedAt = performance.now();
  let renders = 0;
  for (let i = 0; i < count; i++) {
    const host = createHost(200, 120);
    const chart = newChart(host, true);
    const counter = countRenders(chart);
    addSampleSeries(chart);
    chart.start();
    await nextRender(chart);
    renders += counter();
    retained.push({ chart, host });
  }
  return { iterations: count, renders, ms: performance.now() - startedAt };
}

function releaseRetained(): number {
  const released = retained.length;
  for (const { chart, host } of retained.splice(0)) {
    chart.dispose();
    host.remove();
  }
  return released;
}

// ---------------------------------------------------------------------------
// (2) Resize churn
// ---------------------------------------------------------------------------

async function resizeChurn(count: number): Promise<WorkloadResult> {
  const startedAt = performance.now();
  const host = createHost(480, 280);
  const chart = newChart(host, true);
  const renders = countRenders(chart);
  addSampleSeries(chart);
  chart.start();
  await nextRender(chart);
  const dprs = [1, 1.5, 2, 1.25];
  const sizes: Array<[number, number]> = [[480, 280], [320, 200], [600, 340], [240, 160], [560, 300]];
  for (let i = 0; i < count; i++) {
    const [width, height] = sizes[i % sizes.length]!;
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    // Explicit resize covers device-pixel-ratio changes; the ResizeObserver covers the layout change.
    chart.resize(dprs[i % dprs.length]);
    chart.requestRender();
    await frames(1);
  }
  chart.dispose();
  host.remove();
  return { iterations: count, renders: renders(), ms: performance.now() - startedAt };
}

// ---------------------------------------------------------------------------
// (3) Series add / remove
// ---------------------------------------------------------------------------

async function seriesChurn(count: number): Promise<WorkloadResult> {
  const startedAt = performance.now();
  const host = createHost(480, 280);
  const chart = newChart(host, true);
  const renders = countRenders(chart);
  chart.addLine({ capacity: 64, name: "anchor" }).append({ x: [0, 1, 2], y: [1, 2, 3] });
  chart.start();
  await nextRender(chart);
  for (let i = 0; i < count; i++) {
    const added = addSampleSeries(chart, 256);
    chart.fitToData({ padding: 0.05 });
    chart.requestRender();
    await frames(1);
    for (const series of added) chart.removeSeries(series);
  }
  chart.requestRender();
  await frames(1);
  chart.dispose();
  host.remove();
  return { iterations: count, renders: renders(), ms: performance.now() - startedAt };
}

// ---------------------------------------------------------------------------
// (4) Streaming at ring-buffer capacity
// ---------------------------------------------------------------------------

interface StreamState {
  chart: Chart;
  host: HTMLElement;
  series: SeriesStore[];
  timer: number;
  ticks: number;
  appended: number;
  x: number;
  capacity: number;
  renders: () => number;
}

let stream: StreamState | null = null;

async function startStreaming(config: StreamingConfig): Promise<StreamingStats> {
  if (stream) stopStreaming();
  const host = createHost(640, 360);
  const chart = new Chart(host, {
    axes: { x: true, y: true },
    followX: { window: 20_000 },
    autoFitY: true,
    plugins: config.plugins ? fullPlugins() : [],
  });
  const renders = countRenders(chart);
  const series: SeriesStore[] = [];
  for (let i = 0; i < config.series; i++) series.push(chart.addLine({ capacity: config.capacity, name: `stream-${i}` }));

  const state: StreamState = { chart, host, series, timer: 0, ticks: 0, appended: 0, x: 0, capacity: config.capacity, renders };
  stream = state;

  // Prefill to capacity so the measured window only sees steady-state wrap-around appends.
  const chunk = 10_000;
  for (let offset = 0; offset < config.capacity; offset += chunk) {
    appendBatch(state, Math.min(chunk, config.capacity - offset));
  }
  chart.start();
  await nextRender(chart);
  state.timer = window.setInterval(() => {
    state.ticks++;
    appendBatch(state, config.batch);
    if (config.plugins && state.ticks % 8 === 0) hover(chart);
  }, config.tickMs);
  return streamingStats();
}

function appendBatch(state: StreamState, batch: number): void {
  const x = new Float64Array(batch);
  for (let i = 0; i < batch; i++) x[i] = state.x + i;
  for (let s = 0; s < state.series.length; s++) {
    const y = new Float32Array(batch);
    for (let i = 0; i < batch; i++) y[i] = Math.sin((state.x + i) / (30 + s * 7)) * 40 + 50 + s * 3;
    state.series[s]!.append({ x, y });
  }
  state.x += batch;
  state.appended += batch;
}

function streamingStats(): StreamingStats {
  if (!stream) return { running: false, ticks: 0, appendedPerSeries: 0, capacity: 0, renders: 0, retainedSamples: 0 };
  const retainedSamples = stream.series.reduce((total, series) => total + series.length, 0);
  return {
    running: stream.timer !== 0,
    ticks: stream.ticks,
    appendedPerSeries: stream.appended,
    capacity: stream.capacity,
    renders: stream.renders(),
    retainedSamples,
  };
}

function stopStreaming(): StreamingStats {
  const stats = streamingStats();
  if (stream) {
    window.clearInterval(stream.timer);
    stream.chart.dispose();
    stream.host.remove();
    stream = null;
  }
  return { ...stats, running: false };
}

// ---------------------------------------------------------------------------
// (5) WebGL context loss and restore
// ---------------------------------------------------------------------------

function waitForCanvasEvent(canvas: HTMLCanvasElement, type: "webglcontextlost" | "webglcontextrestored", timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      canvas.removeEventListener(type, handle);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const handle = (): void => {
      window.clearTimeout(timer);
      resolve();
    };
    canvas.addEventListener(type, handle, { once: true });
  });
}

/** Count pixels in the current drawing buffer that differ from the clear color. Must run inside a render event. */
function countLitPixels(chart: Chart): number {
  const gl = chart.getWebGLContext();
  if (!gl) return 0;
  const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const r = pixels[0] ?? 0;
  const g = pixels[1] ?? 0;
  const b = pixels[2] ?? 0;
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== r || pixels[i + 1] !== g || pixels[i + 2] !== b) lit++;
  }
  return lit;
}

async function contextLoss(cycles: number): Promise<ContextLossResult> {
  const host = createHost(480, 280);
  const chart = newChart(host, true);
  const renders = countRenders(chart);
  const series = addSampleSeries(chart);
  chart.fitToData({ padding: 0.05 });
  chart.start();
  await nextRender(chart);

  const extension = chart.getWebGLContext()?.getExtension("WEBGL_lose_context");
  if (!extension) throw new Error("WEBGL_lose_context is unavailable in this browser");

  let lostEvents = 0;
  let restoredEvents = 0;
  chart.canvas.addEventListener("webglcontextlost", () => lostEvents++);
  chart.canvas.addEventListener("webglcontextrestored", () => restoredEvents++);

  let rendersAfterRestore = 0;
  let drawCallsAfterRestore = 0;
  let litPixelsAfterRestore = 0;
  for (let cycle = 0; cycle < cycles; cycle++) {
    const lost = waitForCanvasEvent(chart.canvas, "webglcontextlost", 2_000);
    extension.loseContext();
    await lost;

    // The chart must tolerate state changes, appends, hover, and render requests while it has no GPU.
    const rendersWhileLost = renders();
    series[0]!.append({ x: [1_000 + cycle], y: [50] });
    chart.setViewport({ xMin: cycle, xMax: 200 + cycle });
    chart.requestRender();
    hover(chart);
    await frames(3);
    if (renders() !== rendersWhileLost) throw new Error("chart reported a render while the WebGL context was lost");

    const restored = waitForCanvasEvent(chart.canvas, "webglcontextrestored", 3_000);
    extension.restoreContext();
    await restored;

    const before = renders();
    let lit = 0;
    const unsubscribe = chart.subscribe("render", () => {
      if (lit === 0) lit = countLitPixels(chart);
    });
    chart.requestRender();
    try {
      await nextRender(chart);
    } finally {
      unsubscribe();
    }
    rendersAfterRestore += renders() - before;
    drawCallsAfterRestore += chart.getFrameStats().drawCalls;
    litPixelsAfterRestore += lit;
    if (lit === 0) throw new Error(`cycle ${cycle}: restored chart rendered a blank frame`);
  }

  // Taken before dispose: releasing the context on dispose fires one more (expected) lost event.
  const lostDuringCycles = lostEvents;
  const restoredDuringCycles = restoredEvents;

  // A chart disposed while its context is still lost must clean up without throwing, and a later restore must be harmless.
  const secondHost = createHost(320, 200);
  const second = newChart(secondHost, true);
  addSampleSeries(second);
  second.start();
  await nextRender(second);
  const secondExtension = second.getWebGLContext()?.getExtension("WEBGL_lose_context");
  let disposedWhileLost = false;
  if (secondExtension) {
    const lost = waitForCanvasEvent(second.canvas, "webglcontextlost", 2_000);
    secondExtension.loseContext();
    await lost;
    second.dispose();
    secondHost.remove();
    secondExtension.restoreContext();
    await delay(100);
    disposedWhileLost = true;
  } else {
    second.dispose();
    secondHost.remove();
  }

  chart.dispose();
  host.remove();
  await frames(2);
  return { cycles, lostEvents: lostDuringCycles, restoredEvents: restoredDuringCycles, rendersAfterRestore, drawCallsAfterRestore, litPixelsAfterRestore, disposedWhileLost };
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

// Keeps the counter referenced so tooling can read it from the page while debugging.
Object.defineProperty(window, "__blazeplotStabilityRenders", { get: () => renderCount });
