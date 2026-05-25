import { Chart, StaticDataset, StaticOhlcDataset } from "@/index.ts";
import type { ChartFrameStats, ChartPlugin } from "@/index.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { buildFlameGraphModel, flameGraphPlugin } from "@/plugins/flamegraph.ts";
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

interface VisualTestController {
  snapshot(): VisualTestSnapshot;
  screenshot(): Promise<number>;
}

declare global {
  interface Window {
    __blazeplotVisualTest: VisualTestController;
  }
}

const CASES = [
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
] as const;

type VisualCase = typeof CASES[number];

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

const chart = new Chart(chartTarget, optionsForCase(caseName));
window.__blazeplotVisualTest = {
  snapshot: () => ({ state, caseName, stats, assertions, error }),
  screenshot: async () => {
    const blob = await chart.screenshot();
    return blob.size;
  },
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
  }
}

async function finalizeCase(): Promise<void> {
  try {
    if (caseName === "context-restore") await exerciseContextRestore(chart);
    stats = chart.getFrameStats();
    assert(stats.drawCalls > 0, "drawCalls > 0");
    assert(stats.pointsRendered > 0, "pointsRendered > 0");
    assert(stats.renderMode !== "none", `renderMode=${stats.renderMode}`);
    assertCaseDom(caseName, chart);
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
  chart.setViewport({ xMin: 1, xMax: 256, yMin: -10, yMax: 10 });
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
  }
}
