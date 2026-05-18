import { Chart, OhlcRingBuffer } from "@/index.ts";
import { ContiguousRingDataset } from "./ContiguousRingDataset.ts";
import { ProceduralLineDataset } from "./ProceduralLineDataset.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import {
  FILL_BATCH_SIZE,
  HISTORY_SAMPLES,
  LIVE_BATCH_SIZE,
  OHLC_HISTORY_CAPACITY,
  OHLC_INTERVAL,
  PREVIEW_START_TIME,
  PREVIEW_X_STEP_MS,
  SPARSE_HISTORY_CAPACITY,
  SPARSE_INTERVAL,
  VIEW_SAMPLES,
  Y_VIEW,
  type PreviewDataBatch,
} from "./dataConfig.ts";
import type { ChartFrameStats, ChartPickGroup, ChartPickMode, ChartTheme, ViewportPolicy } from "@/index.ts";

const chartTarget = requireElement<HTMLElement>("chart");
const overlayText = document.getElementById("overlayText") as HTMLSpanElement | null;
const copyIcon = document.getElementById("copyIcon");
const themeSelect = requireElement<HTMLSelectElement>("themeSelect");
const hoverModeSelect = requireElement<HTMLSelectElement>("hoverModeSelect");
const hoverGroupSelect = requireElement<HTMLSelectElement>("hoverGroupSelect");
const axesSelect = requireElement<HTMLSelectElement>("axesSelect");
const viewSamplesInput = requireElement<HTMLInputElement>("viewSamplesInput");
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

type PreviewTheme = "default" | "light";

const LIGHT_THEME: ChartTheme = {
  backgroundColor: "#ffffff",
  gridColor: "rgba(0, 0, 0, 0.14)",
  axisColor: "#222",
  tooltipBackgroundColor: "rgba(255, 255, 255, 0.94)",
  tooltipTextColor: "#111",
  legendBackgroundColor: "rgba(255, 255, 255, 0.88)",
  legendBorderColor: "rgba(0, 0, 0, 0.16)",
  legendTextColor: "#111",
  legendMutedTextColor: "#666",
};

console.info("[blazeplot] preview starting");

let t = 0;
let viewSamples = VIEW_SAMPLES;
let frames = 0;
let lastBatchSize = 0;
let lastStatsAt = performance.now();
let workerPending = false;
let lastLiveGeneratedAt = PREVIEW_START_TIME + VIEW_SAMPLES * PREVIEW_X_STEP_MS;
let followLive = true;
let streaming = true;
let syncX = true;
let showPerfPanel = true;
let currentTheme: PreviewTheme = "default";
const hoverOptions: { mode: ChartPickMode; group: ChartPickGroup } = { mode: "nearest-x", group: "x" };
const tooltipOptions: { mode: ChartPickMode; group: ChartPickGroup; highlight: boolean } = { mode: hoverOptions.mode, group: hoverOptions.group, highlight: true };
const chartStats: ChartFrameStats = {
  fps: 0,
  frameMs: 0,
  pointsRendered: 0,
  drawCalls: 0,
  uploadBytes: 0,
  renderMode: "none",
};

const dataWorker = new Worker(new URL("./dataWorker.ts", import.meta.url), { type: "module" });
dataWorker.addEventListener("message", (event: MessageEvent<PreviewDataBatch>) => appendGeneratedBatch(event.data));

const annotations = annotationsPlugin({
  annotations: [
    {
      id: "target-band",
      type: "y-range",
      yMin: 0.95,
      yMax: 1.18,
      fillColor: "rgba(96, 165, 250, 0.10)",
      borderColor: "rgba(147, 197, 253, 0.35)",
      label: "target zone",
    },
    {
      id: "release-window",
      type: "x-range",
      xMin: sampleToTime(VIEW_SAMPLES * 0.18),
      xMax: sampleToTime(VIEW_SAMPLES * 0.24),
      fillColor: "rgba(250, 204, 21, 0.10)",
      borderColor: "rgba(250, 204, 21, 0.35)",
      label: "event window",
    },
    {
      id: "threshold",
      type: "y-line",
      y: -0.25,
      color: "rgba(248, 113, 113, 0.85)",
      dash: "5 4",
      label: "spike threshold",
    },
    {
      id: "marker",
      type: "point",
      x: sampleToTime(VIEW_SAMPLES * 0.5),
      y: 0.82,
      radius: 6,
      color: "rgba(34, 211, 238, 0.95)",
      shape: "diamond",
      label: "marker",
    },
  ],
});

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
    camera.setViewport(liveXViewport());
  },
};

const chart = new Chart(chartTarget, {
  viewportPolicy: previewPolicy,
  axes: { x: { position: "outside", scale: "time", timezone: "local" }, y: { position: "outside" } },
  hover: hoverOptions,
  plugins: [
    interactionsPlugin({ axis: () => syncX ? "y" : "xy", viewportPolicy: previewPolicy }),
    annotations,
    legendPlugin({ toggleOnClick: true }),
    tooltipPlugin(tooltipOptions),
  ],
});
const canvas = chart.canvas;

const lineDataset = new ProceduralLineDataset(HISTORY_SAMPLES);
const lineSeries = chart.addLine(
  { capacity: HISTORY_SAMPLES, dataset: lineDataset, downsample: "minmax", name: "Wave" },
  { lineWidth: 1 },
);
const areaDataset = new ContiguousRingDataset(SPARSE_HISTORY_CAPACITY, { xStep: SPARSE_INTERVAL });
const spikeDataset = new ContiguousRingDataset(SPARSE_HISTORY_CAPACITY, { xStep: SPARSE_INTERVAL });
const barDataset = new ContiguousRingDataset(SPARSE_HISTORY_CAPACITY, { blockSize: 16, xStep: SPARSE_INTERVAL });
const areaSeries = chart.addArea(
  { capacity: SPARSE_HISTORY_CAPACITY, dataset: areaDataset, downsample: "none", name: "Area" },
  { baseline: -0.05, lineWidth: 1 },
);
const scatterSeries = chart.addScatter(
  { capacity: SPARSE_HISTORY_CAPACITY, dataset: spikeDataset, downsample: "none", name: "Spikes" },
  { pointSize: 5 },
);
const barSeries = chart.addBar(
  { capacity: SPARSE_HISTORY_CAPACITY, dataset: barDataset, downsample: "minmax", name: "Power" },
  { barWidth: SPARSE_INTERVAL * PREVIEW_X_STEP_MS, baseline: -1.1 },
);
const ohlcDataset = new OhlcRingBuffer(OHLC_HISTORY_CAPACITY);
chart.addOhlc(
  { capacity: OHLC_HISTORY_CAPACITY, dataset: ohlcDataset, downsample: "none", name: "OHLC" },
  { tickWidth: OHLC_INTERVAL * PREVIEW_X_STEP_MS * 0.7, lineWidth: 1 },
);
viewSamplesInput.max = String(HISTORY_SAMPLES);
viewSamplesInput.value = String(viewSamples);
applyTheme("default");
chart.setViewport({ ...liveXViewport(), ...Y_VIEW });
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
hoverGroupSelect.addEventListener("change", () => {
  const group = asHoverGroup(hoverGroupSelect.value);
  hoverOptions.group = group;
  tooltipOptions.group = group;
  chart.setViewport({});
});
viewSamplesInput.addEventListener("change", () => setViewSamples(viewSamplesInput.value));
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
    chart.setAxes({ x: { position, scale: "time", timezone: "local" }, y: { position } });
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

function appendGeneratedBatch(batch: PreviewDataBatch): void {
  const release: ArrayBuffer[] = [];
  lineSeries.append({ length: batch.batchSize }, { length: batch.batchSize });

  if (batch.sparseCount > 0 && batch.areaY && batch.spikeY && batch.barY) {
    const sparseLength = { length: batch.sparseCount };
    areaSeries.append(sparseLength, new Float32Array(batch.areaY));
    scatterSeries.append(sparseLength, new Float32Array(batch.spikeY));
    barSeries.append(sparseLength, new Float32Array(batch.barY));
    release.push(batch.areaY, batch.spikeY, batch.barY);
  }

  if (batch.ohlcCount > 0 && batch.ohlcX && batch.ohlcOpen && batch.ohlcHigh && batch.ohlcLow && batch.ohlcClose) {
    ohlcDataset.append(
      new Float64Array(batch.ohlcX),
      new Float32Array(batch.ohlcOpen),
      new Float32Array(batch.ohlcHigh),
      new Float32Array(batch.ohlcLow),
      new Float32Array(batch.ohlcClose),
    );
    release.push(batch.ohlcX, batch.ohlcOpen, batch.ohlcHigh, batch.ohlcLow, batch.ohlcClose);
  }

  t = batch.end;
  if (batch.start < VIEW_SAMPLES && t >= VIEW_SAMPLES) {
    lastLiveGeneratedAt = PREVIEW_START_TIME + VIEW_SAMPLES * PREVIEW_X_STEP_MS;
  }
  lastBatchSize = batch.batchSize;
  frames++;
  workerPending = false;
  dataWorker.postMessage({ type: "release", buffers: release }, release);
  updateOverlay();
}

function stream(): void {
  if (streaming) {
    const batchSize = nextBatchSize();
    if (!workerPending && batchSize !== 0) {
      workerPending = true;
      dataWorker.postMessage(batchSize === undefined ? { type: "generate" } : { type: "generate", batchSize });
    }
  } else {
    lastBatchSize = 0;
    frames++;
    updateOverlay();
  }
  requestAnimationFrame(stream);
}

function nextBatchSize(): number | undefined {
  if (t < VIEW_SAMPLES) return undefined;

  const now = Date.now();
  const due = Math.floor((now - lastLiveGeneratedAt) / PREVIEW_X_STEP_MS);
  if (due <= 0) return 0;

  const batchSize = Math.min(LIVE_BATCH_SIZE, due);
  lastLiveGeneratedAt += batchSize * PREVIEW_X_STEP_MS;
  return batchSize;
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
    overlayText.textContent = [
      "BlazePlot preview",
      `status: ${streaming ? workerPending ? "worker pending" : "streaming" : "paused"}`,
      `renderer: ${chartStats.renderMode}`,
      `points appended: ${t.toLocaleString()}`,
      `last batch: ${lastBatchSize.toLocaleString()}`,
      `view samples: ${viewSamples.toLocaleString()}`,
      `history span: ${HISTORY_SAMPLES.toLocaleString()}`,
      `sparse capacity: ${SPARSE_HISTORY_CAPACITY.toLocaleString()}`,
      `ohlc capacity: ${OHLC_HISTORY_CAPACITY.toLocaleString()}`,
      `stream ticks/sec: ${fps.toFixed(1)}`,
      `render fps: ${chartStats.fps.toFixed(1)}`,
      `render ms/frame: ${chartStats.frameMs.toFixed(2)}`,
      `points rendered/frame: ${chartStats.pointsRendered.toLocaleString()}`,
      `draw calls/frame: ${chartStats.drawCalls}`,
      `upload bytes/frame: ${chartStats.uploadBytes.toLocaleString()}`,
      `canvas: ${canvas.width} x ${canvas.height}`,
    ].join("\n");
  }
  frames = 0;
  lastStatsAt = now;
}

function applyTheme(name: PreviewTheme): void {
  currentTheme = name;
  document.body.dataset.previewTheme = name;
  chart.setTheme(name === "light" ? LIGHT_THEME : undefined);
}

function resetView(): void {
  followLive = true;
  followToggle.checked = true;
  chart.setViewport({
    ...liveXViewport(),
    ...Y_VIEW,
  });
}

function setViewSamples(value: string): void {
  const parsed = Number(value.replaceAll(",", ""));
  viewSamples = Number.isFinite(parsed) ? Math.round(Math.min(HISTORY_SAMPLES, Math.max(1_000, parsed))) : VIEW_SAMPLES;
  viewSamplesInput.value = String(viewSamples);
  const current = chart.getViewport();
  const xMax = followLive ? sampleToTime(Math.max(viewSamples, t)) : current.xMax;
  chart.setViewport({ xMin: Math.max(sampleToTime(0), xMax - viewSamples * PREVIEW_X_STEP_MS), xMax });
}

function liveXViewport(): { xMin: number; xMax: number } {
  const sampleMax = Math.max(viewSamples, t);
  return {
    xMin: sampleToTime(Math.max(0, sampleMax - viewSamples)),
    xMax: sampleToTime(sampleMax),
  };
}

function sampleToTime(sample: number): number {
  return PREVIEW_START_TIME + sample * PREVIEW_X_STEP_MS;
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
  return value === "light" ? "light" : "default";
}

function asHoverMode(value: string): ChartPickMode {
  return value === "nearest-point" ? "nearest-point" : "nearest-x";
}

function asHoverGroup(value: string): ChartPickGroup {
  return value === "none" ? "none" : "x";
}

requestAnimationFrame(stream);
