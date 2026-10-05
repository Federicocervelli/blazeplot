import { Chart, StaticDataset, StaticOhlcDataset } from "@/index.ts";
import type { ChartFrameStats, ChartPlugin } from "@/index.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { flameGraphPlugin } from "@/plugins/flamegraph.ts";
import { buildFlameGraphModel } from "@/ui/FlameGraph.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { navigatorPlugin } from "@/plugins/navigator.ts";
import { selectionPlugin } from "@/plugins/selection.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import { autoRenderer, canvas2dRenderer } from "@/renderers/canvas2d.ts";
import { sharedRenderer } from "@/renderers/shared.ts";

interface VisualTestSnapshot {
  readonly state: "booting" | "ready" | "error";
  readonly caseName: string;
  readonly stats: ChartFrameStats | null;
  readonly assertions: readonly string[];
  readonly error: string | null;
}

interface VisualRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface VisualTestController {
  snapshot(): VisualTestSnapshot;
  screenshot(): Promise<number>;
  /** Toggle grid lines so pixel probes can measure series ink without grid. */
  setGridVisible(visible: boolean): void;
  /** Page-space (CSS px) rectangles used to crop browser screenshots. */
  rects(): { readonly root: VisualRect; readonly plot: VisualRect; readonly flamegraph: VisualRect | null };
}

declare global {
  interface Window {
    __blazeplotVisualTest: VisualTestController;
  }
}

const CASES = [
  "line",
  "exact-line-long",
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
] as const;

type VisualCase = typeof CASES[number];

const OVERLAP_Y = 0.3;
const MARKER_X = 50;
const MARKER_Y = 0;
const MARKER_SIZE = 6;
const Y_OFFSET = 1_000_000;
const SPIKE_COUNT = 1_000_000;
const SPIKE_INDEX = 500_000;

const params = new URLSearchParams(window.location.search);
const requestedCase = params.get("case") ?? "line";
const caseName: VisualCase = isVisualCase(requestedCase) ? requestedCase : "line";
const chartTarget = requireElement<HTMLElement>("chart");
const statusTarget = requireElement<HTMLElement>("status");
const caseTarget = requireElement<HTMLElement>("caseName");
caseTarget.textContent = caseName;

let state: VisualTestSnapshot["state"] = "booting";
let stats: ChartFrameStats | null = null;
let error: string | null = null;
const assertions: string[] = [];

if (caseName === "scatter-markers-dpr2") Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
// `?renderer=` selects the backend: webgl2 (default), canvas2d, or auto (WebGL2 with Canvas 2D fallback).
// `?expectRenderer=` asserts which backend ended up in use (e.g. canvas2d when WebGL is disabled).
const rendererParam = params.get("renderer") ?? "webgl2";
const expectedRenderer = params.get("expectRenderer");
const chart = new Chart(chartTarget, {
  ...optionsForCase(caseName),
  renderer: rendererParam === "canvas2d" ? canvas2dRenderer() : rendererParam === "auto" ? autoRenderer() : rendererParam === "shared" ? sharedRenderer() : "webgl2",
});
/** Last rendered frame, copied while the drawing buffer is still valid (it is cleared after compositing). */
let lastFrame: ImageData | null = null;
const captureCanvas = document.createElement("canvas");
chart.subscribe("render", () => {
  const { width, height } = chart.canvas;
  captureCanvas.width = width;
  captureCanvas.height = height;
  const ctx = captureCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(chart.canvas, 0, 0);
  lastFrame = ctx.getImageData(0, 0, width, height);
});
window.__blazeplotVisualTest = {
  snapshot: () => ({ state, caseName, stats, assertions, error }),
  screenshot: async () => {
    const blob = await chart.screenshot();
    return blob.size;
  },
  setGridVisible: (visible) => chart.setGridVisible(visible),
  rects: () => ({
    root: toRect(chart.rootElement),
    plot: toRect(chart.canvas),
    flamegraph: toRectOrNull(chart.rootElement.querySelector(".blazeplot-flamegraph-canvas")),
  }),
};

try {
  setupCase(caseName, chart);
  chart.start();
  window.setTimeout(() => {
    void finalizeCase();
  }, 120);
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
  state = "error";
  renderStatus();
}

function toRect(element: Element): VisualRect {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  // Clamp to the viewport: browser screenshots cannot see past it (some cases overflow a 900px-wide page).
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(window.innerWidth, right);
  const y1 = Math.min(window.innerHeight, bottom);
  return { x: x0 + window.scrollX, y: y0 + window.scrollY, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

function toRectOrNull(element: Element | null): VisualRect | null {
  return element ? toRect(element) : null;
}

function isVisualCase(value: string): value is VisualCase {
  return (CASES as readonly string[]).includes(value);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`Visual assertion failed: ${label}`);
  assertions.push(label);
}

function renderStatus(): void {
  statusTarget.textContent = state === "error"
    ? `error: ${error ?? "unknown"}`
    : `${state}: ${assertions.join("; ")}`;
}

function optionsForCase(name: VisualCase): ConstructorParameters<typeof Chart>[1] {
  const plugins: ChartPlugin[] = [];
  if (name === "legend") plugins.push(legendPlugin());
  if (name === "tooltip") plugins.push(tooltipPlugin());
  if (name === "crosshair") plugins.push(crosshairPlugin({ snap: "nearest-x", label: true }));
  if (name === "overlay-layering") plugins.push(legendPlugin(), tooltipPlugin(), crosshairPlugin({ snap: "nearest-x", label: true }));
  if (name === "annotations") plugins.push(annotationsPlugin({ annotations: [
    { type: "x-line", x: 64, label: "x marker" },
    { type: "y-range", yMin: -0.4, yMax: 0.4, label: "range" },
    { type: "point", x: 96, y: 0.8, label: "point" },
  ] }));
  if (name === "selection") plugins.push(selectionPlugin({ mode: "xy" }));
  if (name === "navigator") plugins.push(navigatorPlugin({ height: 72 }));
  if (name === "flamegraph") plugins.push(flameGraphPlugin({
    model: buildFlameGraphModel([
      { stack: ["root", "parse", "tokenize"], value: 28 },
      { stack: ["root", "parse", "ast"], value: 18 },
      { stack: ["root", "render", "layout"], value: 22 },
      { stack: ["root", "render", "paint"], value: 16 },
      { stack: ["root", "idle"], value: 12 },
    ]),
    search: "render",
  }));
  if (name === "scale-options") {
    return {
      axes: {
        x: { position: "outside", scale: "log", logBase: 2, reversed: true, title: "log2 reversed" },
        y: { position: "outside", scale: "symlog", symlogConstant: 2, reversed: true, title: "symlog reversed" },
        y2: { visible: true, position: "outside", scale: "log", title: "log right" },
      },
      grid: true,
    };
  }
  if (name === "axes-title-grid") {
    return {
      title: "Visual axes test",
      subtitle: "title, subtitle, outside axes, grid",
      axes: { x: { position: "outside", title: "sample" }, y: { position: "outside", title: "value" } },
      grid: true,
      plugins: [interactionsPlugin()],
    };
  }
  return { axes: { x: { position: "outside" }, y: { position: "outside" } }, grid: true, plugins };
}

function setupCase(name: VisualCase, chart: Chart): void {
  switch (name) {
    case "line":
      addLine(chart);
      break;
    case "exact-line-long":
      addExactLineLong(chart);
      break;
    case "area":
      addArea(chart);
      break;
    case "scatter":
      addScatter(chart);
      break;
    case "bar":
      addBar(chart);
      break;
    case "histogram":
      addHistogram(chart);
      break;
    case "ohlc":
      addOhlc(chart, "ohlc");
      break;
    case "candlestick":
      addOhlc(chart, "candlestick");
      break;
    case "axes-title-grid":
    case "legend":
    case "tooltip":
    case "crosshair":
    case "annotations":
    case "selection":
    case "navigator":
    case "overlay-layering":
      addLine(chart);
      break;
    case "flamegraph":
      addFlameGraphBaseline(chart);
      break;
    case "scale-options":
      addScaleOptions(chart);
      break;
    case "context-restore":
      addLine(chart);
      break;
    case "gaps":
      addGaps(chart);
      break;
    case "translucent-overlap":
      addTranslucentOverlap(chart);
      break;
    case "scatter-markers":
    case "scatter-markers-dpr2":
      addMarkerProbe(chart);
      break;
    case "large-y-offset":
      addLargeYOffset(chart);
      break;
    case "dense-area-spike":
      addDenseAreaSpike(chart);
      break;
  }
}

function addTranslucentOverlap(chart: Chart): void {
  const flat = (x0: number, x1: number): StaticDataset => new StaticDataset(Float64Array.of(x0, x1), Float32Array.of(0.8, 0.8));
  chart.addArea({ dataset: flat(0, 60), name: "A", downsample: "none" }, { fillColor: [1, 0, 0, 0.4], color: [0, 0, 0, 0], baseline: 0 });
  chart.addArea({ dataset: flat(40, 100), name: "B", downsample: "none" }, { fillColor: [0, 0, 1, 0.4], color: [0, 0, 0, 0], baseline: 0 });
  chart.setViewport({ xMin: 0, xMax: 100, yMin: -1, yMax: 1 });
}

function addMarkerProbe(chart: Chart): void {
  chart.addScatter(
    { dataset: new StaticDataset(Float64Array.of(MARKER_X), Float32Array.of(MARKER_Y)), name: "marker", downsample: "none" },
    { color: [1, 1, 1, 1], pointSize: MARKER_SIZE },
  );
  chart.setViewport({ xMin: 0, xMax: 100, yMin: -1, yMax: 1 });
  chart.setGridVisible(false);
}

function addLargeYOffset(chart: Chart): void {
  const count = 400;
  const x = Float64Array.from({ length: count }, (_, i) => i);
  const y = Float64Array.from({ length: count }, (_, i) => Y_OFFSET + Math.sin(i * 0.05) * 0.01);
  const dataset = new StaticDataset(x, y);
  chart.addArea({ dataset, name: "offset", downsample: "none" }, { color: [1, 1, 1, 1], fillColor: [0, 0.6, 1, 0.5], lineWidth: 2, baseline: Y_OFFSET - 0.012 });
  chart.setViewport({ xMin: 0, xMax: count - 1, yMin: Y_OFFSET - 0.012, yMax: Y_OFFSET + 0.012 });
  chart.setGridVisible(false);
}

function addDenseAreaSpike(chart: Chart): void {
  const x = Float64Array.from({ length: SPIKE_COUNT }, (_, i) => i);
  const y = new Float32Array(SPIKE_COUNT).fill(1);
  y[SPIKE_INDEX] = 10;
  chart.addArea({ dataset: new StaticDataset(x, y), name: "dense" }, { color: [1, 1, 1, 1], fillColor: [0, 0.6, 1, 0.5], lineWidth: 1, baseline: 0 });
  chart.setViewport({ xMin: 0, xMax: SPIKE_COUNT - 1, yMin: 0, yMax: 11 });
  chart.setGridVisible(false);
}

interface Pixel { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

/** Read the last frame at a data coordinate. */
function pixelAt(dataX: number, dataY: number, dx = 0, dy = 0): Pixel {
  if (!lastFrame) throw new Error("No captured frame");
  const [px, py] = chart.dataToPlot(dataX, dataY);
  const ratio = lastFrame.width / Math.max(1, chart.canvas.clientWidth);
  const x = Math.min(lastFrame.width - 1, Math.max(0, Math.round(px * ratio) + dx));
  const y = Math.min(lastFrame.height - 1, Math.max(0, Math.round(py * ratio) + dy));
  const i = (y * lastFrame.width + x) * 4;
  const d = lastFrame.data;
  return { r: d[i]!, g: d[i + 1]!, b: d[i + 2]!, a: d[i + 3]! };
}

function inkAt(x: number, y: number): boolean {
  if (!lastFrame || x < 0 || y < 0 || x >= lastFrame.width || y >= lastFrame.height) return false;
  return lastFrame.data[(y * lastFrame.width + x) * 4 + 3]! > 127;
}

function assertPixelCase(name: VisualCase): void {
  if (name === "translucent-overlap") {
    const aOnly = pixelAt(20, OVERLAP_Y);
    const overlap = pixelAt(50, OVERLAP_Y);
    const bOnly = pixelAt(80, OVERLAP_Y);
    assert(aOnly.r > aOnly.b + 20, `series A tints its own region ${JSON.stringify(aOnly)}`);
    assert(bOnly.b > bOnly.r + 20, `series B tints its own region ${JSON.stringify(bOnly)}`);
    assert(overlap.r > bOnly.r + 10 && overlap.b > aOnly.b + 10, `overlapping translucent fills blend instead of replacing ${JSON.stringify(overlap)}`);
    const colors = new Set<string>();
    for (let dy = -60; dy <= 60; dy++) {
      const p = pixelAt(20, OVERLAP_Y, 0, dy);
      colors.add(`${p.r},${p.g},${p.b},${p.a}`);
    }
    assert(colors.size >= 2, `grid lines stay visible under the area fill (${[...colors].join(" | ")})`);
  }
  if (name === "scatter-markers" || name === "scatter-markers-dpr2") {
    if (!lastFrame) throw new Error("No captured frame");
    const ratio = lastFrame.width / Math.max(1, chart.canvas.clientWidth);
    assert(Math.abs(ratio - (name === "scatter-markers" ? 1 : 2)) < 0.01, `pixel ratio ${ratio}`);
    const [px, py] = chart.dataToPlot(MARKER_X, MARKER_Y);
    const cx = Math.round(px * ratio);
    const cy = Math.round(py * ratio);
    let left = cx;
    while (inkAt(left - 1, cy)) left--;
    let right = cx;
    while (inkAt(right + 1, cy)) right++;
    const width = right - left + 1;
    const expected = MARKER_SIZE * ratio;
    assert(Math.abs(width - expected) <= 1.5, `marker is ${width}px across, expected ${expected}`);
    // Round: the corner of the bounding box is empty, a square would fill it.
    const half = Math.floor(expected / 2) - 1;
    assert(!inkAt(cx + half, cy + half) || expected < 6, "marker corners are empty (round marker)");
    assert(inkAt(cx, cy), "marker center is filled");
  }
  if (name === "large-y-offset") {
    if (!lastFrame) throw new Error("No captured frame");
    const rows = new Set<number>();
    let columns = 0;
    for (let x = 0; x < lastFrame.width; x++) {
      let top = -1;
      for (let y = 0; y < lastFrame.height; y++) {
        const i = (y * lastFrame.width + x) * 4;
        if (lastFrame.data[i]! > 200 && lastFrame.data[i + 1]! > 200 && lastFrame.data[i + 2]! > 200 && lastFrame.data[i + 3]! > 200) { top = y; break; }
      }
      if (top >= 0) { rows.add(top); columns++; }
    }
    assert(columns > lastFrame.width * 0.9, "offset line is drawn across the plot");
    assert(rows.size > 60, `offset line is smooth (${rows.size} distinct rows, a float32 staircase has 1 to 2)`);
    const baseline = pixelAt(100, Y_OFFSET - 0.011);
    assert(baseline.a > 0, "area fill starts at the baseline with a large Y offset");
  }
  if (name === "dense-area-spike") {
    const near = (dataX: number): number => Math.max(...[-2, -1, 0, 1, 2].map((dx) => pixelAt(dataX, 6, dx).a));
    assert(near(SPIKE_INDEX) > 0, "isolated spike survives dense area LOD");
    assert(near(SPIKE_INDEX - 300_000) === 0, "no fill away from the spike at the same height");
  }
}

/** Lines, area, and scatter with NaN gaps, so every renderer has to break paths at missing samples. */
function addGaps(chart: Chart): void {
  const { x, y } = wave(240);
  for (const gap of [40, 41, 42, 100, 101, 170, 171, 172, 173]) y[gap] = Number.NaN;
  chart.addLine({ dataset: new StaticDataset(x, y), name: "gappy line" }, { lineWidth: 3 });
  chart.addArea({ dataset: new StaticDataset(x, Float32Array.from(y, (v) => v - 2.2)), name: "gappy area" }, { fillColor: [0.2, 0.7, 1, 0.28], lineWidth: 2, baseline: -3.4 });
  chart.setViewport({ xMin: 0, xMax: 239, yMin: -3.6, yMax: 1.6 });
}

async function finalizeCase(): Promise<void> {
  try {
    if (caseName === "context-restore") await exerciseContextRestore(chart);
    // The first page load of a browser launch can be slow enough that no frame has run after the settle delay.
    for (let waited = 0; waited < 3000 && chart.getFrameStats().drawCalls === 0; waited += 50) await new Promise((resolve) => window.setTimeout(resolve, 50));
    stats = chart.getFrameStats();
    // Checked without recording a label: the status line width feeds the page layout, which the pixel baselines depend on.
    if (expectedRenderer && chart.renderer !== expectedRenderer) throw new Error(`Expected renderer ${expectedRenderer}, got ${chart.renderer}`);
    assert(stats.drawCalls > 0, "drawCalls > 0");
    assert(stats.pointsRendered > 0, "pointsRendered > 0");
    assert(stats.renderMode !== "none", `renderMode=${stats.renderMode}`);
    assertCaseDom(caseName, chart);
    assertPixelCase(caseName);
    state = "ready";
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    state = "error";
  }
  renderStatus();
}

async function exerciseContextRestore(chart: Chart): Promise<void> {
  const gl = chart.getWebGLContext();
  const extension = gl?.getExtension("WEBGL_lose_context");
  if (!extension) {
    assertions.push("WEBGL_lose_context unavailable; context restore smoke skipped");
    return;
  }

  const lost = waitForCanvasEvent(chart.canvas, "webglcontextlost", 1_000);
  const restored = waitForCanvasEvent(chart.canvas, "webglcontextrestored", 2_000);
  extension.loseContext();
  await lost;
  await delay(50);
  extension.restoreContext();
  await restored;
  await delay(180);
  assertions.push("webgl context restored");
}

function waitForCanvasEvent(canvas: HTMLCanvasElement, type: "webglcontextlost" | "webglcontextrestored", timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      canvas.removeEventListener(type, handleEvent);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const handleEvent = (): void => {
      window.clearTimeout(timeoutId);
      resolve();
    };
    canvas.addEventListener(type, handleEvent, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function addLine(chart: Chart): void {
  const { x, y } = wave(512);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "line" }, { lineWidth: 2 });
  chart.setViewport({ xMin: 0, xMax: 511, yMin: -1.4, yMax: 1.4 });
}

/** More visible samples than the raw line upload buffer holds; the line must still reach the right edge. */
function addExactLineLong(chart: Chart): void {
  const count = 40_000;
  const x = Float64Array.from({ length: count }, (_, i) => i);
  const y = Float32Array.from({ length: count }, (_, i) => Math.sin(i * 0.002) + (i % 2 === 0 ? 0.05 : -0.05));
  chart.addLine({ dataset: new StaticDataset(x, y), downsample: "none", name: "exact line" }, { lineWidth: 2 });
  chart.setViewport({ xMin: 0, xMax: count - 1, yMin: -1.4, yMax: 1.4 });
}

function addArea(chart: Chart): void {
  const { x, y } = wave(512, 0.5);
  chart.addArea({ dataset: new StaticDataset(x, y), name: "area" }, { fillColor: [0.2, 0.7, 1, 0.28], lineWidth: 2 });
  chart.setViewport({ xMin: 0, xMax: 511, yMin: -1.4, yMax: 1.4 });
}

function addScatter(chart: Chart): void {
  const x = Float64Array.from({ length: 420 }, (_, i) => i);
  const y = Float32Array.from({ length: 420 }, (_, i) => Math.sin(i * 0.12) + (i % 9) * 0.035);
  chart.addScatter({ dataset: new StaticDataset(x, y), downsample: "none", name: "scatter" }, { pointSize: 5 });
  chart.setViewport({ xMin: 0, xMax: 419, yMin: -1.2, yMax: 1.5 });
}

function addBar(chart: Chart): void {
  const x = Float64Array.from({ length: 96 }, (_, i) => i);
  const y = Float32Array.from({ length: 96 }, (_, i) => 0.2 + Math.abs(Math.sin(i * 0.17)));
  chart.addBar({ dataset: new StaticDataset(x, y), name: "bar" }, { barWidth: 0.8, baseline: 0 });
  chart.setViewport({ xMin: -1, xMax: 96, yMin: -0.1, yMax: 1.4 });
}

function addHistogram(chart: Chart): void {
  const values = Float64Array.from({ length: 256 }, (_, i) => 50 + Math.sin(i * 0.41) * 18 + Math.cos(i * 0.13) * 8);
  chart.addHistogram({ values, binSize: 4, name: "histogram" }, { baseline: 0 });
  chart.fitToData({ includeZero: true, padding: { x: 0.02, y: 0.08 } });
}

function addOhlc(chart: Chart, mode: "ohlc" | "candlestick"): void {
  const count = 96;
  const x = new Float64Array(count);
  const open = new Float32Array(count);
  const high = new Float32Array(count);
  const low = new Float32Array(count);
  const close = new Float32Array(count);
  let value = 10;
  for (let i = 0; i < count; i++) {
    x[i] = i;
    open[i] = value;
    const delta = Math.sin(i * 0.21) * 0.5;
    close[i] = value + delta;
    high[i] = Math.max(open[i]!, close[i]!) + 0.35;
    low[i] = Math.min(open[i]!, close[i]!) - 0.35;
    value = close[i]!;
  }
  const dataset = new StaticOhlcDataset(x, open, high, low, close);
  if (mode === "ohlc") chart.addOhlc({ dataset, name: "ohlc" }, { tickWidth: 0.7 });
  else chart.addCandlestick({ dataset, name: "candlestick" }, { tickWidth: 0.8 });
  chart.setViewport({ xMin: -1, xMax: count, yMin: 6, yMax: 14 });
}

function addFlameGraphBaseline(chart: Chart): void {
  const x = Float64Array.from({ length: 2 }, (_, i) => i * 96);
  const y = new Float32Array([0, 0]);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "baseline" }, { color: [0, 0, 0, 0], lineWidth: 1 });
  chart.setViewport({ xMin: 0, xMax: 96, yMin: 0, yMax: 4 });
}

function addScaleOptions(chart: Chart): void {
  const x = Float64Array.from({ length: 256 }, (_, i) => 2 ** (i / 32));
  const y = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.12) * 8);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "scale options" }, { lineWidth: 2 });
  chart.addLine({ dataset: new StaticDataset(x, Float32Array.from(y, (value) => Math.abs(value) + 1)), yAxis: "right", name: "right log" }, { lineWidth: 1 });
  chart.setViewport({ xMin: 1, xMax: 256, yMin: -10, yMax: 10 });
  chart.setViewport({ yMin: 1, yMax: 100 }, "right");
}

function wave(count: number, phase = 0): { x: Float64Array; y: Float32Array } {
  const x = new Float64Array(count);
  const y = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = i;
    y[i] = Math.sin(i * 0.035 + phase) + 0.25 * Math.sin(i * 0.11 + phase);
  }
  return { x, y };
}

function assertCaseDom(name: VisualCase, chart: Chart): void {
  const root = chart.rootElement;
  if (name === "axes-title-grid") {
    assert(!!root.querySelector(".blazeplot-title"), "chart title exists");
    assert(!!root.querySelector(".blazeplot-axis-title"), "axis title exists");
  }
  if (name === "legend") assert(!!root.querySelector(".blazeplot-legend"), "legend exists");
  if (name === "tooltip") assert(!!root.ownerDocument.querySelector(".blazeplot-tooltip"), "tooltip layer exists");
  if (name === "crosshair") assert(!!root.querySelector(".blazeplot-crosshair"), "crosshair layer exists");
  if (name === "annotations") assert(!!root.querySelector(".blazeplot-annotations"), "annotations layer exists");
  if (name === "selection") assert(!!root.querySelector(".blazeplot-selection-brush"), "selection layer exists");
  if (name === "navigator") assert(!!root.querySelector(".blazeplot-navigator"), "navigator exists");
  if (name === "flamegraph") {
    assert(!!root.querySelector(".blazeplot-flamegraph-canvas"), "flamegraph webgl canvas exists");
    assert(!!root.querySelector(".blazeplot-flamegraph-labels"), "flamegraph label canvas exists");
  }
  if (name === "overlay-layering") {
    const legend = root.querySelector<HTMLElement>(".blazeplot-legend");
    const tooltipMarkers = root.querySelector<HTMLElement>(".blazeplot-tooltip-markers");
    const crosshair = root.querySelector<HTMLElement>(".blazeplot-crosshair");
    assert(!!legend && !!tooltipMarkers && !!crosshair, "overlay layers exist");
    assert(Number(legend!.style.zIndex) > Number(tooltipMarkers!.style.zIndex), "legend above tooltip markers");
    assert(Number(legend!.style.zIndex) > Number(crosshair!.style.zIndex), "legend above crosshair markers");
  }
  if (name === "scale-options") {
    assert(chart.getCamera().xReversed, "x axis reversed");
    assert(chart.getCamera().yReversed, "y axis reversed");
    const [plotX, plotY] = chart.dataToPlot(8, 3);
    const rect = chart.canvas.getBoundingClientRect();
    const roundTrip = chart.clientToData(rect.left + plotX, rect.top + plotY);
    assert(!!roundTrip && Math.abs(roundTrip[0] - 8) < 1e-5 && Math.abs(roundTrip[1] - 3) < 1e-5, "scaled coordinates round-trip");
    const x1 = chart.dataToPlot(1, 0)[0];
    const x2 = chart.dataToPlot(2, 0)[0];
    const x4 = chart.dataToPlot(4, 0)[0];
    assert(Math.abs((x1 - x2) - (x2 - x4)) < 0.01, "log geometry is evenly spaced");
    const leftBefore = chart.getViewport();
    chart.pan({ dx: 0, dy: 0.5 }, "right");
    assert(Math.abs(chart.getViewport("right").yMin - 10) < 1e-5, "right log axis pans in scale space");
    assert(chart.getViewport().yMin === leftBefore.yMin && chart.getViewport().yMax === leftBefore.yMax, "right pan preserves left axis");
  }
}
