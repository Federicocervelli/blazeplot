import { chartInternals } from "@/ui/ChartInternals.ts";
import { Chart, HistogramDataset, StaticDataset, StaticOhlcDataset } from "@/index.ts";
import type { ChartFrameStats, ChartPlugin } from "@/index.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import type { AnnotationsPlugin } from "@/plugins/annotations.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { flameGraphPlugin } from "@/plugins/flamegraph.ts";
import { buildFlameGraphModel } from "@/plugins/flamegraph/model.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { navigatorPlugin } from "@/plugins/navigator.ts";
import { selectionPlugin } from "@/plugins/selection.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";

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
let annotationsHandle: AnnotationsPlugin | null = null;
let firstScreenshot: Promise<Blob> | null = null;

if (caseName === "scatter-markers-dpr2") Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
// `?renderer=` selects the backend: webgl2 (default), canvas2d, or auto (WebGL2 with Canvas 2D fallback).
// `?expectRenderer=` asserts which backend ended up in use (e.g. canvas2d when WebGL is disabled).
const rendererParam = params.get("renderer") ?? "webgl2";
const expectedRenderer = params.get("expectRenderer");
const chart = new Chart(chartTarget, {
  ...optionsForCase(caseName),
  renderer: rendererParam === "canvas2d" || rendererParam === "auto" || rendererParam === "shared" ? rendererParam : "webgl2",
});
/** Last rendered frame, copied while the drawing buffer is still valid (it is cleared after compositing). */
let lastFrame: ImageData | null = null;
const captureCanvas = document.createElement("canvas");
chart.subscribe("render", () => {
  const { width, height } = chartInternals(chart).canvas;
  captureCanvas.width = width;
  captureCanvas.height = height;
  const ctx = captureCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(chartInternals(chart).canvas, 0, 0);
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
    plot: toRect(chartInternals(chart).canvas),
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
  if (name === "screenshot-overlays") {
    return {
      title: "Screenshot overlays",
      subtitle: "legend and rotated axis titles",
      axes: {
        x: { position: "outside", title: "sample index" },
        y: { position: "outside", title: "left value" },
        y2: { visible: true, position: "outside", title: "right value" },
      },
      grid: true,
      plugins: [legendPlugin()],
    };
  }
  if (name === "screenshot-first") {
    return { axes: { x: { position: "outside" }, y: { position: "outside", title: "value" } }, grid: true, plugins };
  }
  if (name === "annotations-log-reversed" || name === "annotations-symlog") {
    annotationsHandle = annotationsPlugin({});
    plugins.push(annotationsHandle);
    return {
      axes: name === "annotations-log-reversed"
        ? { x: { position: "outside", reversed: true }, y: { position: "outside", scale: "log" } }
        : { x: { position: "outside" }, y: { position: "outside", scale: "symlog", symlogConstant: 1 } },
      grid: true,
      plugins,
    };
  }
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
    case "exact-line-thin-dense":
      addExactLineThinDense(chart);
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
    case "screenshot-overlays": {
      const { x, y } = wave(300);
      chart.addLine({ dataset: new StaticDataset(x, y), name: "left series" }, { lineWidth: 2 });
      chart.addLine({ dataset: new StaticDataset(x, Float32Array.from(y, (v) => 50 + v * 20)), yAxis: "right", name: "right series" }, { lineWidth: 2 });
      chart.setViewport({ xMin: 0, xMax: 299, yMin: -1.6, yMax: 1.6 });
      chart.setViewport({ yMin: 10, yMax: 90 }, "right");
      break;
    }
    case "screenshot-first": {
      addLine(chart);
      // No frame has been rendered and the screenshot chunk has not been imported yet.
      firstScreenshot = chart.screenshot();
      break;
    }
    case "annotations-log-reversed": {
      const x = Float64Array.from({ length: 200 }, (_, i) => i / 2);
      chart.addLine({ dataset: new StaticDataset(x, Float32Array.from(x, (v) => 10 ** (1 + 2 * Math.abs(Math.sin(v * 0.06))))), name: "log line" }, { lineWidth: 2 });
      chart.setViewport({ xMin: 0, xMax: 100, yMin: 1, yMax: 10_000 });
      break;
    }
    case "annotations-symlog": {
      const x = Float64Array.from({ length: 200 }, (_, i) => i / 2);
      chart.addLine({ dataset: new StaticDataset(x, Float32Array.from(x, (v) => 800 * Math.sin(v * 0.1))), name: "symlog line" }, { lineWidth: 2 });
      chart.setViewport({ xMin: 0, xMax: 100, yMin: -1000, yMax: 1000 });
      break;
    }
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
  const ratio = lastFrame.width / Math.max(1, chartInternals(chart).canvas.clientWidth);
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
    const ratio = lastFrame.width / Math.max(1, chartInternals(chart).canvas.clientWidth);
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

async function decodeBlob(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D context to decode the screenshot");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

interface InkBox { readonly count: number; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** Pixels in a region (image pixels) that differ from `bg` by more than `tolerance` on any channel. */
function inkIn(image: ImageData, bg: Pixel, x0: number, y0: number, x1: number, y1: number, tolerance = 40): InkBox {
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(image.width, Math.ceil(x1));
  const bottom = Math.min(image.height, Math.ceil(y1));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * image.width + x) * 4;
      const d = image.data;
      if (Math.max(Math.abs(d[i]! - bg.r), Math.abs(d[i + 1]! - bg.g), Math.abs(d[i + 2]! - bg.b)) > tolerance) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { count, minX, minY, maxX, maxY };
}

function parseCssRgb(value: string): Pixel | null {
  const match = /rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)(?:[,\s/]+([\d.]+%?))?/.exec(value);
  if (!match) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 255 : 255 * Number.parseFloat(match[4]) / (match[4].endsWith("%") ? 100 : 1) };
}

async function assertAsyncCase(name: VisualCase): Promise<void> {
  if (name === "screenshot-first") {
    if (!firstScreenshot) throw new Error("screenshot-first did not start a screenshot");
    const image = await decodeBlob(await firstScreenshot);
    const root = chart.rootElement.getBoundingClientRect();
    const plot = chartInternals(chart).canvas.getBoundingClientRect();
    const sx = image.width / root.width;
    const sy = image.height / root.height;
    const bg = { r: image.data[0]!, g: image.data[1]!, b: image.data[2]!, a: 255 };
    const ink = inkIn(image, bg, (plot.left - root.left) * sx, (plot.top - root.top) * sy, (plot.right - root.left) * sx, (plot.bottom - root.top) * sy);
    const area = (plot.width * sx) * (plot.height * sy);
    assert(ink.count / area > 0.004, `first screenshot, taken before any frame, contains the plot (${(ink.count / area * 100).toFixed(2)}% ink)`);
  }
  if (name === "screenshot-overlays") await assertScreenshotOverlays();
  if (name === "annotations-log-reversed" || name === "annotations-symlog") await assertAnnotationsOnTicks(name);
}

async function assertScreenshotOverlays(): Promise<void> {
  const image = await decodeBlob(await chart.screenshot());
  const root = chart.rootElement.getBoundingClientRect();
  const sx = image.width / root.width;
  const sy = image.height / root.height;
  const bg = { r: image.data[0]!, g: image.data[1]!, b: image.data[2]!, a: 255 };
  const rel = (rect: DOMRect): { x0: number; y0: number; x1: number; y1: number } => ({
    x0: (rect.left - root.left) * sx,
    y0: (rect.top - root.top) * sy,
    x1: (rect.right - root.left) * sx,
    y1: (rect.bottom - root.top) * sy,
  });
  const el = (selector: string): HTMLElement => {
    const found = chart.rootElement.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };

  // Legend: swatches painted in their series color, and text ink next to each.
  const swatches = [...chart.rootElement.querySelectorAll<HTMLElement>(".blazeplot-legend-swatch")];
  assert(swatches.length === 2, "legend has a swatch per series");
  for (const swatch of swatches) {
    const style = getComputedStyle(swatch);
    const expected = parseCssRgb(style.backgroundColor)?.a ? parseCssRgb(style.backgroundColor)! : parseCssRgb(style.color);
    if (!expected) throw new Error("Could not resolve the legend swatch color");
    const box = rel(swatch.getBoundingClientRect());
    const cx = Math.round((box.x0 + box.x1) / 2);
    const cy = Math.round((box.y0 + box.y1) / 2);
    const i = (cy * image.width + cx) * 4;
    const delta = Math.max(Math.abs(image.data[i]! - expected.r), Math.abs(image.data[i + 1]! - expected.g), Math.abs(image.data[i + 2]! - expected.b));
    assert(delta <= 24, `legend swatch is drawn in the series color (delta ${delta})`);
  }
  const legend = rel(el(".blazeplot-legend").getBoundingClientRect());
  const legendInk = inkIn(image, bg, legend.x0, legend.y0, legend.x1, legend.y1);
  assert(legendInk.count > 60, `legend panel and text have ink (${legendInk.count} px)`);

  // Rotated axis titles: ink is taller than wide, inside the rotated bounding box.
  for (const selector of [".blazeplot-axis-title-y", ".blazeplot-axis-title-y2"]) {
    const rect = el(selector).getBoundingClientRect();
    assert(rect.height > rect.width * 2, `${selector} is rotated in the DOM (${rect.width.toFixed(0)}x${rect.height.toFixed(0)})`);
    const box = rel(rect);
    const ink = inkIn(image, bg, box.x0 - 2, box.y0 - 2, box.x1 + 2, box.y1 + 2);
    assert(ink.count > 30, `${selector} has ink in the screenshot`);
    assert((ink.maxY - ink.minY) > (ink.maxX - ink.minX) * 2, `${selector} is drawn rotated (ink ${ink.maxX - ink.minX + 1}x${ink.maxY - ink.minY + 1})`);
  }
  const xTitle = el(".blazeplot-axis-title-x").getBoundingClientRect();
  const xBox = rel(xTitle);
  const xInk = inkIn(image, bg, xBox.x0 - 2, xBox.y0 - 2, xBox.x1 + 2, xBox.y1 + 2);
  assert(xInk.count > 30 && (xInk.maxX - xInk.minX) > (xInk.maxY - xInk.minY), "x axis title is drawn horizontally");

  // Title row does not overlap the plot, and Y titles center on the plot, not the whole chart.
  const plot = chartInternals(chart).canvas.getBoundingClientRect();
  const title = el(".blazeplot-subtitle").getBoundingClientRect();
  assert(title.bottom <= plot.top + 0.5, `subtitle (bottom ${title.bottom.toFixed(1)}) stays above the plot (top ${plot.top.toFixed(1)})`);
  for (const selector of [".blazeplot-axis-title-y", ".blazeplot-axis-title-y2"]) {
    const rect = el(selector).getBoundingClientRect();
    const offset = Math.abs((rect.top + rect.bottom) / 2 - (plot.top + plot.bottom) / 2);
    assert(offset <= 1.5, `${selector} is centered on the plot area (off by ${offset.toFixed(1)}px)`);
  }
}

interface LabelTick { readonly value: number; readonly center: number }

/** Numeric tick labels of an outside axis gutter with their center on the cross-axis, in client pixels. */
function tickLabels(axis: "x" | "y"): LabelTick[] {
  const gutter = axis === "x" ? chartInternals(chart).xAxisElement : chartInternals(chart).yAxisElement;
  const ticks: LabelTick[] = [];
  for (const label of gutter.querySelectorAll<HTMLElement>("div")) {
    if (getComputedStyle(label).display === "none") continue;
    const value = Number((label.textContent ?? "").replace(/,/g, "").replace("−", "-"));
    if (!Number.isFinite(value) || label.textContent === "") continue;
    const rect = label.getBoundingClientRect();
    ticks.push({ value, center: axis === "x" ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2 });
  }
  return ticks;
}

/** Annotations drawn, hit-tested, and focus-targeted at the same pixel as the axis tick label of their value. */
async function assertAnnotationsOnTicks(name: VisualCase): Promise<void> {
  if (!annotationsHandle) throw new Error("No annotations plugin");
  const plot = chartInternals(chart).canvas.getBoundingClientRect();
  const interior = (ticks: LabelTick[], lo: number, hi: number): LabelTick[] => ticks.filter((t) => t.center > lo + 18 && t.center < hi - 18);
  const yTicks = interior(tickLabels("y"), plot.top, plot.bottom).filter((t) => t.value !== 0);
  const xTicks = interior(tickLabels("x"), plot.left, plot.right).filter((t) => t.value !== 0);
  if (name === "annotations-log-reversed") assert(yTicks.some((t) => t.value === 100), "log axis has a 100 tick label");
  assert(yTicks.length >= 2 && xTicks.length >= 2, `interior tick labels found (${yTicks.length} y, ${xTicks.length} x)`);
  const yPicks = name === "annotations-symlog"
    ? [yTicks.find((t) => t.value > 0), yTicks.find((t) => t.value < 0)].filter((t): t is LabelTick => !!t)
    : [yTicks.find((t) => t.value === 100) ?? yTicks[0]!];
  const xPicks = [xTicks[0]!, xTicks[xTicks.length - 1]!];
  assert(yPicks.length >= 1, "picked y ticks to annotate");

  annotationsHandle.setAnnotations([
    ...yPicks.map((t, i) => ({ type: "y-line", y: t.value, id: `y${i}`, label: `y ${t.value}` }) as const),
    ...xPicks.map((t, i) => ({ type: "x-line", x: t.value, id: `x${i}`, label: `x ${t.value}` }) as const),
  ]);
  await new Promise((resolve) => window.setTimeout(resolve, 120));

  const groups = [...chart.rootElement.querySelectorAll<SVGGElement>(".blazeplot-annotations > g")];
  assert(groups.length === yPicks.length + xPicks.length, `drew ${groups.length} annotation groups`);
  const lines = groups.map((group) => group.querySelector("line")!.getBoundingClientRect());
  // Y labels are centered with a canvas-measured text height, so their DOM box can sit a few px off the tick; a linear
  // projection on a log or reversed axis would be off by tens to hundreds of px.
  const tolerance = 5;
  yPicks.forEach((tick, i) => {
    const line = lines[i]!;
    const drawn = (line.top + line.bottom) / 2;
    assert(Math.abs(drawn - tick.center) <= tolerance, `y-line at ${tick.value} lines up with its tick (drawn ${drawn.toFixed(1)}, label ${tick.center.toFixed(1)})`);
    // Hit-testing at the tick position finds this annotation.
    const hit = annotationsHandle!.pick(plot.left + plot.width * 0.5, drawn);
    assert(hit?.annotation.id === `y${i}`, `hit-test at the ${tick.value} tick finds the y-line (${hit?.annotation.id ?? "none"})`);
  });
  xPicks.forEach((tick, i) => {
    const line = lines[yPicks.length + i]!;
    const drawn = (line.left + line.right) / 2;
    assert(Math.abs(drawn - tick.center) <= tolerance, `x-line at ${tick.value} lines up with its tick (drawn ${drawn.toFixed(1)}, label ${tick.center.toFixed(1)})`);
    const hit = annotationsHandle!.pick(drawn, plot.top + plot.height * 0.5);
    assert(hit?.annotation.id === `x${i}`, `hit-test at the ${tick.value} tick finds the x-line (${hit?.annotation.id ?? "none"})`);
  });
  // Keyboard focus targets sit on the drawn lines.
  const targets = [...chart.rootElement.querySelectorAll<HTMLElement>(".blazeplot-annotation-focus")];
  assert(targets.length === groups.length, "one focus target per annotation");
  yPicks.forEach((tick, i) => {
    const rect = targets[i]!.getBoundingClientRect();
    assert(tick.center >= rect.top - tolerance && tick.center <= rect.bottom + tolerance, `focus target of the y-line at ${tick.value} covers its tick`);
  });
  xPicks.forEach((tick, i) => {
    const rect = targets[yPicks.length + i]!.getBoundingClientRect();
    assert(tick.center >= rect.left - tolerance && tick.center <= rect.right + tolerance, `focus target of the x-line at ${tick.value} covers its tick`);
  });
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
    await assertAsyncCase(caseName);
    state = "ready";
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    state = "error";
  }
  renderStatus();
}

async function exerciseContextRestore(chart: Chart): Promise<void> {
  const gl = chartInternals(chart).getWebGLContext();
  const extension = gl?.getExtension("WEBGL_lose_context");
  if (!extension) {
    assertions.push("WEBGL_lose_context unavailable; context restore smoke skipped");
    return;
  }

  const lost = waitForCanvasEvent(chartInternals(chart).canvas, "webglcontextlost", 1_000);
  const restored = waitForCanvasEvent(chartInternals(chart).canvas, "webglcontextrestored", 2_000);
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

/** 1px line with about 48 samples per pixel column and a +-0.025 alternation and a spike every 997 samples: Canvas 2D reduces such lines to pixel columns. */
function addExactLineThinDense(chart: Chart): void {
  const count = 40_000;
  const x = Float64Array.from({ length: count }, (_, i) => i);
  const y = Float32Array.from({ length: count }, (_, i) => Math.sin(i * 0.002) + (i % 2 === 0 ? 0.025 : -0.025) + (i % 997 === 0 ? 0.3 : 0));
  chart.addLine({ dataset: new StaticDataset(x, y), downsample: "none", name: "thin dense line" }, { lineWidth: 1 });
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
  chart.addBar({ name: "histogram", dataset: HistogramDataset.from(values, { binSize: 4 }) }, { baseline: 0 });
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
    assert(chartInternals(chart).getCamera().xReversed, "x axis reversed");
    assert(chartInternals(chart).getCamera().yReversed, "y axis reversed");
    const [plotX, plotY] = chart.dataToPlot(8, 3);
    const rect = chartInternals(chart).canvas.getBoundingClientRect();
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
