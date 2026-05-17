import { Chart, OhlcRingBuffer } from "@/index.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import type { ChartFrameStats, ChartPickMode, ChartTheme, RgbaColor, SeriesStyle, ViewportPolicy } from "@/index.ts";

const chartTarget = requireElement<HTMLElement>("chart");
const overlayText = document.getElementById("overlayText") as HTMLSpanElement | null;
const copyIcon = document.getElementById("copyIcon");
const themeSelect = requireElement<HTMLSelectElement>("themeSelect");
const hoverModeSelect = requireElement<HTMLSelectElement>("hoverModeSelect");
const axesSelect = requireElement<HTMLSelectElement>("axesSelect");
const highlightToggle = requireElement<HTMLInputElement>("highlightToggle");
const gridToggle = requireElement<HTMLInputElement>("gridToggle");
const followToggle = requireElement<HTMLInputElement>("followToggle");
const streamToggle = requireElement<HTMLInputElement>("streamToggle");
const syncXToggle = requireElement<HTMLInputElement>("syncXToggle");
const perfToggleButton = requireElement<HTMLButtonElement>("perfToggleButton");
const resetViewButton = requireElement<HTMLButtonElement>("resetViewButton");
const screenshotButton = requireElement<HTMLButtonElement>("screenshotButton");
function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No #${id} element found`);
  return el as T;
}

const THEMES = {
  dark: {
    backgroundColor: [0.08, 0.10, 0.16, 1],
    gridColor: [0.22, 0.30, 0.44, 0.45],
    axisColor: "#bfd6ff",
    tooltipBackgroundColor: "rgba(4, 8, 16, 0.85)",
    tooltipTextColor: "#bfd6ff",
    legendBackgroundColor: "rgba(4, 8, 16, 0.85)",
    legendTextColor: "#bfd6ff",
    legendMutedTextColor: "#789",
  },
  light: {
    backgroundColor: "#f8fafc",
    gridColor: "rgba(15, 23, 42, 0.16)",
    axisColor: "#334155",
    tooltipBackgroundColor: "rgba(255, 255, 255, 0.94)",
    tooltipTextColor: "#0f172a",
    legendBackgroundColor: "rgba(255, 255, 255, 0.88)",
    legendBorderColor: "rgba(15, 23, 42, 0.16)",
    legendTextColor: "#0f172a",
    legendMutedTextColor: "#64748b",
  },
  terminal: {
    backgroundColor: "#020403",
    gridColor: "rgba(74, 222, 128, 0.20)",
    axisColor: "#86efac",
    tooltipBackgroundColor: "rgba(1, 18, 8, 0.92)",
    tooltipTextColor: "#bbf7d0",
    legendBackgroundColor: "rgba(1, 18, 8, 0.88)",
    legendBorderColor: "rgba(34, 197, 94, 0.45)",
    legendTextColor: "#bbf7d0",
    legendMutedTextColor: "#4ade80",
  },
} satisfies Record<string, ChartTheme>;

type PreviewTheme = keyof typeof THEMES;

const SERIES_PALETTES: Record<PreviewTheme, readonly [RgbaColor, RgbaColor, RgbaColor, RgbaColor, RgbaColor]> = {
  dark: [
    [0.3, 0.6, 1.0, 1.0],
    [0.72, 0.45, 0.95, 0.95],
    [0.95, 0.35, 0.35, 1.0],
    [0.2, 0.8, 0.4, 0.75],
    [0.95, 0.72, 0.25, 1.0],
  ],
  light: [
    [0.1, 0.35, 0.8, 1.0],
    [0.55, 0.25, 0.75, 0.9],
    [0.82, 0.18, 0.18, 1.0],
    [0.05, 0.55, 0.28, 0.75],
    [0.72, 0.42, 0.05, 1.0],
  ],
  terminal: [
    [0.34, 0.90, 0.56, 1.0],
    [0.74, 0.95, 0.44, 0.9],
    [0.25, 0.85, 0.95, 1.0],
    [0.16, 0.70, 0.36, 0.75],
    [0.95, 0.85, 0.35, 1.0],
  ],
};

console.info("[blazeplot] preview starting");

const FILL_BATCH_SIZE = 65_536;
const LIVE_BATCH_SIZE = 65_536;
const VIEW_SAMPLES = 10_000_000;
const TRACE_PERIOD = VIEW_SAMPLES / 5;
const SPARSE_INTERVAL = 512;
const OHLC_INTERVAL = SPARSE_INTERVAL * 8;
// Keep all streaming series at roughly the same X-history span. Sparse series
// append one point every SPARSE_INTERVAL samples, so their point capacity must
// be scaled down or they will stay visible much longer than the dense line.
const HISTORY_SAMPLES = 12_000_000;
const SPARSE_HISTORY_CAPACITY = Math.ceil(HISTORY_SAMPLES / SPARSE_INTERVAL) + 2;
const OHLC_HISTORY_CAPACITY = Math.ceil(HISTORY_SAMPLES / OHLC_INTERVAL) + 2;
const TAU = Math.PI * 2;
const Y_VIEW = { yMin: -1.25, yMax: 1.35 };
const xBuf = new Float64Array(FILL_BATCH_SIZE);
const yBuf = new Float32Array(FILL_BATCH_SIZE);
let t = 0;
let frames = 0;
let lastBatchSize = 0;
let lastStatsAt = performance.now();
let followLive = true;
let streaming = true;
let syncX = true;
let showPerfPanel = true;
let currentTheme: PreviewTheme = "dark";
const hoverOptions: { mode: ChartPickMode } = { mode: "nearest-x" };
const tooltipOptions: { mode: ChartPickMode; highlight: boolean } = { mode: hoverOptions.mode, highlight: true };
const chartStats: ChartFrameStats = {
  fps: 0,
  frameMs: 0,
  pointsRendered: 0,
  drawCalls: 0,
  uploadBytes: 0,
  renderMode: "none",
};

const previewPolicy: ViewportPolicy = {
  beforePan(_camera, intent) {
    if (syncX) return { ...intent, dx: 0 };
    followLive = false;
    followToggle.checked = followLive;
    return intent;
  },
  beforeZoom(_camera, intent) {
    if (syncX) return { ...intent, axis: "y" };
    followLive = false;
    followToggle.checked = followLive;
    return intent;
  },
  beforeRender(camera) {
    if (!followLive) return;
    camera.setViewport({
      xMin: Math.max(0, t - VIEW_SAMPLES),
      xMax: Math.max(VIEW_SAMPLES, t),
    });
  },
};

const chart = new Chart(chartTarget, {
  viewportPolicy: previewPolicy,
  axes: { x: { position: "outside" }, y: { position: "outside" } },
  hover: hoverOptions,
  theme: THEMES.dark,
  plugins: [
    interactionsPlugin({ axis: () => syncX ? "y" : "xy", viewportPolicy: previewPolicy }),
    legendPlugin({ toggleOnClick: true }),
    tooltipPlugin(tooltipOptions),
  ],
});
const canvas = chart.canvas;

const lineSeries = chart.addLine(
  { capacity: HISTORY_SAMPLES, downsample: "minmax", name: "Wave" },
  { lineWidth: 1 },
);
const areaSeries = chart.addArea(
  { capacity: SPARSE_HISTORY_CAPACITY, downsample: "none", name: "Area" },
  { baseline: -0.05, lineWidth: 1 },
);
const scatterSeries = chart.addScatter(
  { capacity: SPARSE_HISTORY_CAPACITY, downsample: "none", name: "Spikes" },
  { pointSize: 5 },
);
const barSeries = chart.addBar(
  { capacity: SPARSE_HISTORY_CAPACITY, downsample: "minmax", name: "Power" },
  { barWidth: SPARSE_INTERVAL, baseline: -1.1 },
);
const ohlcDataset = new OhlcRingBuffer(OHLC_HISTORY_CAPACITY);
const ohlcSeries = chart.addOhlc(
  { capacity: OHLC_HISTORY_CAPACITY, dataset: ohlcDataset, downsample: "none", name: "OHLC" },
  { tickWidth: OHLC_INTERVAL * 0.7, lineWidth: 1 },
);
const previewSeries = [
  { label: "line", series: lineSeries },
  { label: "area", series: areaSeries },
  { label: "scatter", series: scatterSeries },
  { label: "bar", series: barSeries },
  { label: "ohlc", series: ohlcSeries },
] as const;

applyTheme("dark");
chart.setViewport({ xMin: 0, xMax: VIEW_SAMPLES, ...Y_VIEW });
chart.start();

copyIcon?.addEventListener("click", () => {
  if (!overlayText) return;
  navigator.clipboard.writeText(overlayText.textContent?.trim() ?? "").catch(() => {});
});

themeSelect.addEventListener("change", () => applyTheme(asPreviewTheme(themeSelect.value)));
hoverModeSelect.addEventListener("change", () => {
  const mode = asHoverMode(hoverModeSelect.value);
  hoverOptions.mode = mode;
  tooltipOptions.mode = mode;
  chart.setViewport({});
});
highlightToggle.addEventListener("change", () => {
  tooltipOptions.highlight = highlightToggle.checked;
  chart.setViewport({});
});
gridToggle.addEventListener("change", () => chart.setGridVisible(gridToggle.checked));
followToggle.addEventListener("change", () => {
  followLive = followToggle.checked;
});
streamToggle.addEventListener("change", () => {
  streaming = streamToggle.checked;
});
syncXToggle.addEventListener("change", () => {
  syncX = syncXToggle.checked;
});
perfToggleButton.addEventListener("click", () => {
  showPerfPanel = !showPerfPanel;
  perfToggleButton.textContent = showPerfPanel ? "hide stats" : "show stats";
  if (!showPerfPanel && overlayText) overlayText.textContent = "";
});
axesSelect.addEventListener("change", () => {
  if (axesSelect.value === "off") {
    chart.setAxes(false);
  } else {
    const position = axesSelect.value === "inside" ? "inside" : "outside";
    chart.setAxes({ x: { position }, y: { position } });
  }
});
resetViewButton.addEventListener("click", resetView);
screenshotButton.addEventListener("click", () => {
  void downloadScreenshot();
});

console.info("[blazeplot] chart initialized", {
  canvasWidth: canvas.width,
  canvasHeight: canvas.height,
  fillBatchSize: FILL_BATCH_SIZE,
  liveBatchSize: LIVE_BATCH_SIZE,
});

function appendOhlc(start: number, end: number): void {
  const ohlcStart = Math.ceil(start / OHLC_INTERVAL) * OHLC_INTERVAL;
  const count = ohlcStart < end ? Math.floor((end - 1 - ohlcStart) / OHLC_INTERVAL) + 1 : 0;
  if (count <= 0) return;

  const xs = new Float64Array(count);
  const opens = new Float32Array(count);
  const highs = new Float32Array(count);
  const lows = new Float32Array(count);
  const closes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = ohlcStart + i * OHLC_INTERVAL;
    const index = Math.floor(x / OHLC_INTERVAL);
    const previousX = Math.max(0, x - OHLC_INTERVAL);
    const open = ohlcCloseAt(previousX);
    const close = ohlcCloseAt(x);
    const high = Math.max(open, close) + 0.025 + (index % 5) * 0.003;
    const low = Math.min(open, close) - 0.025 - (index % 7) * 0.002;
    xs[i] = x;
    opens[i] = open;
    highs[i] = high;
    lows[i] = low;
    closes[i] = close;
  }

  ohlcDataset.append(xs, opens, highs, lows, closes);
}

function ohlcCloseAt(x: number): number {
  const index = Math.floor(x / OHLC_INTERVAL);
  return 1.08 + Math.sin((x / TRACE_PERIOD) * TAU) * 0.035 + Math.cos(index * 0.37) * 0.025;
}

function stream(): void {
  if (!streaming) {
    lastBatchSize = 0;
    frames++;
    updateOverlay();
    requestAnimationFrame(stream);
    return;
  }

  const start = t;
  const batchSize = t < VIEW_SAMPLES ? Math.min(FILL_BATCH_SIZE, VIEW_SAMPLES - t) : LIVE_BATCH_SIZE;
  lastBatchSize = batchSize;

  for (let i = 0; i < batchSize; i++) {
    const x = start + i;
    xBuf[i] = x;
    yBuf[i] = Math.sin((x / TRACE_PERIOD) * TAU) * 0.25 + 0.78 + Math.random() * 0.01;
  }
  t += batchSize;
  lineSeries.append(xBuf.subarray(0, batchSize), yBuf.subarray(0, batchSize));
  appendOhlc(start, t);

  const sparseStart = Math.ceil(start / SPARSE_INTERVAL) * SPARSE_INTERVAL;
  const sparseCount = sparseStart < t ? Math.floor((t - 1 - sparseStart) / SPARSE_INTERVAL) + 1 : 0;
  if (sparseCount > 0) {
    const sparseX = new Float64Array(sparseCount);
    const areaY = new Float32Array(sparseCount);
    const spikeY = new Float32Array(sparseCount);
    const barY = new Float32Array(sparseCount);

    for (let i = 0; i < sparseCount; i++) {
      const x = sparseStart + i * SPARSE_INTERVAL;
      sparseX[i] = x;
      areaY[i] = 0.05 + Math.abs(Math.cos((x / TRACE_PERIOD) * TAU)) * 0.35 + Math.random() * 0.025;
      spikeY[i] = -0.35 + Math.random() * 0.35;
      barY[i] = -1.1 + Math.abs(Math.sin((x / TRACE_PERIOD) * TAU)) * 0.48 + 0.08;
    }

    areaSeries.append(sparseX, areaY);
    scatterSeries.append(sparseX, spikeY);
    barSeries.append(sparseX, barY);
  }

  frames++;
  updateOverlay();
  requestAnimationFrame(stream);
}

function updateOverlay(): void {
  const now = performance.now();
  if (now - lastStatsAt < 500) return;

  const fps = (frames * 1000) / (now - lastStatsAt);
  chart.getFrameStats(chartStats);
  if (overlayText) {
    overlayText.parentElement?.toggleAttribute("hidden", !showPerfPanel);
    if (!showPerfPanel) {
      frames = 0;
      lastStatsAt = now;
      return;
    }
    overlayText.textContent = "\n" + [
      "BlazePlot preview",
      "status: running",
      `theme: ${currentTheme}`,
      `renderer: ${chartStats.renderMode}`,
      `hover: ${hoverOptions.mode}`,
      `axes: ${axesSelect.value}`,
      `grid: ${chart.getGridVisible()}`,
      `sync x: ${syncX}`,
      `follow live: ${followLive}`,
      `streaming: ${streaming}`,
      `points appended: ${t.toLocaleString()}`,
      `batch/frame: ${lastBatchSize.toLocaleString()}`,
      `view samples: ${VIEW_SAMPLES.toLocaleString()}`,
      `history span: ${HISTORY_SAMPLES.toLocaleString()}`,
      `sparse capacity: ${SPARSE_HISTORY_CAPACITY.toLocaleString()}`,
      `ohlc capacity: ${OHLC_HISTORY_CAPACITY.toLocaleString()}`,
      `stream fps: ${fps.toFixed(1)}`,
      `render fps: ${chartStats.fps.toFixed(1)}`,
      `render ms/frame: ${chartStats.frameMs.toFixed(2)}`,
      `points rendered: ${chartStats.pointsRendered.toLocaleString()}`,
      `draw calls: ${chartStats.drawCalls}`,
      `upload bytes: ${chartStats.uploadBytes.toLocaleString()}`,
      `canvas: ${canvas.width} x ${canvas.height}`,
    ].join("\n");
  }
  frames = 0;
  lastStatsAt = now;
}

function applyTheme(name: PreviewTheme): void {
  currentTheme = name;
  document.body.dataset.previewTheme = name;
  applySeriesPalette(name);
  chart.setTheme(THEMES[name]);
}

function applySeriesPalette(name: PreviewTheme): void {
  const [line, area, scatter, bar, ohlc] = SERIES_PALETTES[name];
  setSeriesStyle(lineSeries, { color: line });
  setSeriesStyle(areaSeries, { color: area, fillColor: [area[0], area[1], area[2], 0.20] });
  setSeriesStyle(scatterSeries, { color: scatter });
  setSeriesStyle(barSeries, { color: bar });
  setSeriesStyle(ohlcSeries, { color: ohlc });
}

function setSeriesStyle(series: (typeof previewSeries)[number]["series"], style: Partial<SeriesStyle>): void {
  Object.assign(series.style, style);
}

function resetView(): void {
  followLive = true;
  followToggle.checked = true;
  chart.setViewport({
    xMin: Math.max(0, t - VIEW_SAMPLES),
    xMax: Math.max(VIEW_SAMPLES, t),
    ...Y_VIEW,
  });
}

async function downloadScreenshot(): Promise<void> {
  const blob = await chart.screenshot();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `blazeplot-${currentTheme}.png`;
  link.click();
  URL.revokeObjectURL(url);
}

function asPreviewTheme(value: string): PreviewTheme {
  return value === "light" || value === "terminal" ? value : "dark";
}

function asHoverMode(value: string): ChartPickMode {
  return value === "nearest-point" ? "nearest-point" : "nearest-x";
}

requestAnimationFrame(stream);
