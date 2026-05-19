import { Chart, OhlcRingBuffer, UniformRingBuffer } from "@/index.ts";
import { ProceduralLineDataset } from "./ProceduralLineDataset.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import {
  DEFAULT_APPEND_RATE,
  LIVE_BATCH_SIZE,
  MAX_VIEW_SAMPLES,
  OHLC_INTERVAL,
  SPARSE_INTERVAL,
  VIEW_SAMPLES,
  Y_VIEW,
  type PreviewDataBatch,
} from "./dataConfig.ts";
import type { ChartFrameStats, ChartPickGroup, ChartPickMode, ChartTheme, SeriesStore, ViewportPolicy } from "@/index.ts";

const chartTarget = requireElement<HTMLElement>("chart");
const overlayText = document.getElementById("overlayText") as HTMLSpanElement | null;
const copyIcon = document.getElementById("copyIcon");
const themeSelect = requireElement<HTMLSelectElement>("themeSelect");
const hoverModeSelect = requireElement<HTMLSelectElement>("hoverModeSelect");
const hoverGroupSelect = requireElement<HTMLSelectElement>("hoverGroupSelect");
const axesSelect = requireElement<HTMLSelectElement>("axesSelect");
const viewSamplesInput = requireElement<HTMLInputElement>("viewSamplesInput");
const appendRateInput = requireElement<HTMLInputElement>("appendRateInput");
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
let appendRate = DEFAULT_APPEND_RATE;
let previewStartTime = Date.now();
let dataGeneration = 0;
let frames = 0;
let appendedSinceStats = 0;
let lastStatsAt = performance.now();
let workerPending = false;
let followLive = true;
let streaming = true;
let streamClockStartedAt = performance.now();
let syncX = true;
let showPerfPanel = true;
let currentTheme: PreviewTheme = "default";
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 2,
});
const numberFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 });
const hoverOptions: { mode: ChartPickMode; group: ChartPickGroup } = { mode: "nearest-x", group: "x" };
const tooltipOptions: { mode: ChartPickMode; group: ChartPickGroup; highlight: boolean; formatter: (item: { readonly x: number; readonly y: number }) => string } = {
  mode: hoverOptions.mode,
  group: hoverOptions.group,
  highlight: true,
  formatter: (item) => `(${dateFormatter.format(new Date(item.x))}, ${numberFormatter.format(item.y)})`,
};
const MAX_APPEND_RATE = 1_000_000;

let lineSeries!: SeriesStore;
let areaSeries!: SeriesStore;
let scatterSeries!: SeriesStore;
let barSeries!: SeriesStore;
let ohlcSeries!: SeriesStore;
let ohlcDataset!: OhlcRingBuffer;

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

installSeries();
configureWorker();
viewSamplesInput.max = String(MAX_VIEW_SAMPLES);
viewSamplesInput.value = String(viewSamples);
appendRateInput.value = String(appendRate);
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
appendRateInput.addEventListener("change", () => setAppendRate(appendRateInput.value));
followToggle.addEventListener("change", () => {
  followLive = followToggle.checked;
});
streamToggle.addEventListener("change", () => {
  const nextStreaming = streamToggle.checked;
  if (nextStreaming === streaming) return;
  streaming = nextStreaming;
  if (streaming) syncStreamClock();
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
  defaultAppendRate: DEFAULT_APPEND_RATE,
  maxAppendRate: MAX_APPEND_RATE,
  liveBatchSize: LIVE_BATCH_SIZE,
});

function installSeries(): void {
  const history = historySamples();
  const xStep = sampleStepMs();
  const lineDataset = new ProceduralLineDataset(history, { xStart: previewStartTime, xStep, tracePeriod: viewSamples });
  lineSeries = chart.addLine(
    { dataset: lineDataset, downsample: "minmax", name: "Wave" },
    { lineWidth: 1 },
  );

  const sparseCapacity = sparseHistoryCapacity();
  const areaDataset = new UniformRingBuffer(sparseCapacity, { xStart: previewStartTime, xStep: SPARSE_INTERVAL * xStep });
  const spikeDataset = new UniformRingBuffer(sparseCapacity, { xStart: previewStartTime, xStep: SPARSE_INTERVAL * xStep });
  const barDataset = new UniformRingBuffer(sparseCapacity, { xStart: previewStartTime, xStep: SPARSE_INTERVAL * xStep, blockSize: 16 });
  areaSeries = chart.addArea(
    { dataset: areaDataset, downsample: "none", name: "Area" },
    { baseline: -0.05, lineWidth: 1 },
  );
  scatterSeries = chart.addScatter(
    { dataset: spikeDataset, downsample: "none", name: "Spikes" },
    { pointSize: 5 },
  );
  barSeries = chart.addBar(
    { dataset: barDataset, downsample: "minmax", name: "Power" },
    { barWidth: SPARSE_INTERVAL * xStep, baseline: -1.1 },
  );

  ohlcDataset = new OhlcRingBuffer(ohlcHistoryCapacity());
  ohlcSeries = chart.addOhlc(
    { dataset: ohlcDataset, downsample: "none", name: "OHLC" },
    { tickWidth: OHLC_INTERVAL * xStep * 0.7, lineWidth: 1 },
  );
}

function removeSeries(): void {
  chart.removeSeries(lineSeries);
  chart.removeSeries(areaSeries);
  chart.removeSeries(scatterSeries);
  chart.removeSeries(barSeries);
  chart.removeSeries(ohlcSeries);
}

function resetDataModel(): void {
  if (lineSeries) removeSeries();
  t = 0;
  appendedSinceStats = 0;
  frames = 0;
  workerPending = false;
  previewStartTime = Date.now();
  streamClockStartedAt = performance.now();
  dataGeneration++;
  installSeries();
  configureWorker();
  chart.setViewport({ ...liveXViewport(), ...Y_VIEW });
  updateOverlay(true);
}

function configureWorker(): void {
  dataWorker.postMessage({ type: "reset", generation: dataGeneration, xStart: previewStartTime, xStepMs: sampleStepMs() });
}

function historySamples(): number {
  return Math.max(1, viewSamples);
}

function sparseHistoryCapacity(): number {
  return Math.ceil(historySamples() / SPARSE_INTERVAL) + 2;
}

function ohlcHistoryCapacity(): number {
  return Math.ceil(historySamples() / OHLC_INTERVAL) + 2;
}

function sampleStepMs(): number {
  return 1000 / appendRate;
}

function appendGeneratedBatch(batch: PreviewDataBatch): void {
  const release = batchBuffers(batch);
  if (batch.generation !== dataGeneration) {
    if (release.length > 0) dataWorker.postMessage({ type: "release", buffers: release }, release);
    return;
  }

  lineSeries.appendY({ length: batch.batchSize });

  if (batch.sparseCount > 0 && batch.areaY && batch.spikeY && batch.barY) {
    areaSeries.appendY(new Float32Array(batch.areaY));
    scatterSeries.appendY(new Float32Array(batch.spikeY));
    barSeries.appendY(new Float32Array(batch.barY));
  }

  if (batch.ohlcCount > 0 && batch.ohlcX && batch.ohlcOpen && batch.ohlcHigh && batch.ohlcLow && batch.ohlcClose) {
    ohlcDataset.append(
      new Float64Array(batch.ohlcX),
      new Float32Array(batch.ohlcOpen),
      new Float32Array(batch.ohlcHigh),
      new Float32Array(batch.ohlcLow),
      new Float32Array(batch.ohlcClose),
    );
  }

  t = batch.end;
  appendedSinceStats += batch.batchSize;
  frames++;
  workerPending = false;
  dataWorker.postMessage({ type: "release", buffers: release }, release);
  updateOverlay();
}

function batchBuffers(batch: PreviewDataBatch): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  if (batch.areaY) buffers.push(batch.areaY);
  if (batch.spikeY) buffers.push(batch.spikeY);
  if (batch.barY) buffers.push(batch.barY);
  if (batch.ohlcX) buffers.push(batch.ohlcX);
  if (batch.ohlcOpen) buffers.push(batch.ohlcOpen);
  if (batch.ohlcHigh) buffers.push(batch.ohlcHigh);
  if (batch.ohlcLow) buffers.push(batch.ohlcLow);
  if (batch.ohlcClose) buffers.push(batch.ohlcClose);
  return buffers;
}

function stream(): void {
  if (streaming) {
    const batchSize = nextBatchSize();
    if (!workerPending && batchSize !== 0) {
      workerPending = true;
      dataWorker.postMessage({ type: "generate", batchSize, generation: dataGeneration });
    }
  } else {
    frames++;
    updateOverlay();
  }
  requestAnimationFrame(stream);
}

function nextBatchSize(): number {
  const targetSamples = Math.floor(((performance.now() - streamClockStartedAt) * appendRate) / 1000);
  const due = targetSamples - t;
  if (due <= 0) return 0;

  return Math.min(maxBatchSize(), due);
}

function maxBatchSize(): number {
  return Math.max(LIVE_BATCH_SIZE, Math.ceil(appendRate / 20));
}

function syncStreamClock(now: number = performance.now()): void {
  streamClockStartedAt = now - (t * 1000) / appendRate;
}

function updateOverlay(force: boolean = false): void {
  const now = performance.now();
  if (!force && now - lastStatsAt < 500) return;

  const elapsedMs = now - lastStatsAt;
  const actualAppendRate = (appendedSinceStats * 1000) / elapsedMs;
  chart.getFrameStats(chartStats);
  if (overlayText) {
    overlayText.parentElement?.toggleAttribute("hidden", !showPerfPanel);
    if (!showPerfPanel) {
      frames = 0;
      appendedSinceStats = 0;
      lastStatsAt = now;
      return;
    }
    overlayText.textContent = [
      `status: ${streaming ? workerPending ? "worker pending" : "streaming" : "paused"}`,
      `renderer: ${chartStats.renderMode}`,
      `samples: ${t.toLocaleString()}`,
      `sample rate: ${appendRate.toLocaleString()}/sec target, ${actualAppendRate.toFixed(0)}/sec actual`,
      `view samples: ${viewSamples.toLocaleString()}`,
      `render fps: ${chartStats.fps.toFixed(1)}`,
      `render ms/frame: ${chartStats.frameMs.toFixed(2)}`,
      `points rendered/frame: ${chartStats.pointsRendered.toLocaleString()}`,
      `draw calls/frame: ${chartStats.drawCalls}`,
    ].join("\n");
  }
  frames = 0;
  appendedSinceStats = 0;
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
  viewSamples = Number.isFinite(parsed) ? Math.round(Math.min(MAX_VIEW_SAMPLES, Math.max(1_000, parsed))) : VIEW_SAMPLES;
  viewSamplesInput.value = String(viewSamples);
  resetDataModel();
}

function setAppendRate(value: string): void {
  const parsed = Number(value.replaceAll(",", ""));
  appendRate = Number.isFinite(parsed) ? Math.round(Math.min(MAX_APPEND_RATE, Math.max(1, parsed))) : DEFAULT_APPEND_RATE;
  appendRateInput.value = String(appendRate);
  resetDataModel();
}

function liveXViewport(): { xMin: number; xMax: number } {
  const xMax = sampleToTime(t);
  return {
    xMin: xMax - viewSamples * sampleStepMs(),
    xMax,
  };
}

function sampleToTime(sample: number): number {
  return previewStartTime + sample * sampleStepMs();
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
