import { Chart } from "@/index.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import type { ChartFrameStats, ViewportPolicy } from "@/index.ts";

const chartTarget = document.getElementById("chart") as HTMLElement;
if (!chartTarget) throw new Error("No #chart container found");

const overlayText = document.getElementById("overlayText") as HTMLSpanElement | null;

const copyIcon = document.getElementById("copyIcon");
copyIcon?.addEventListener("click", () => {
  if (!overlayText) return;
  navigator.clipboard.writeText(overlayText.textContent?.trim() ?? "").catch(() => {});
});

console.info("[blazeplot] preview starting");

const FILL_BATCH_SIZE = 65_536;
const LIVE_BATCH_SIZE = 65_536;
const VIEW_SAMPLES = 10_000_000;
const TRACE_PERIOD = VIEW_SAMPLES / 5;
const SPARSE_INTERVAL = 512;
const TAU = Math.PI * 2;
const xBuf = new Float64Array(FILL_BATCH_SIZE);
const yBuf = new Float32Array(FILL_BATCH_SIZE);
let t = 0;
let frames = 0;
let lastBatchSize = 0;
let lastStatsAt = performance.now();
let followLive = true;
const syncX = true;
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
    return intent;
  },
  beforeZoom(_camera, intent) {
    if (syncX) return { ...intent, axis: "y" };
    followLive = false;
    return intent;
  },
  beforeRender(camera) {
    if (!followLive || !syncX) return;
    camera.setViewport({
      xMin: Math.max(0, t - VIEW_SAMPLES),
      xMax: Math.max(VIEW_SAMPLES, t),
    });
  },
};

const chart = new Chart(chartTarget, {
  viewportPolicy: previewPolicy,
  axes: { x: { position: "outside" }, y: { position: "outside" } },
  hover: { mode: "nearest-x" },
  plugins: [
    legendPlugin({ toggleOnClick: true }),
    tooltipPlugin({ mode: "nearest-x" }),
  ],
});
const canvas = chart.canvas;

// line series — top band (y ~0.7–1.3)
const lineSeries = chart.addSeries(
  { mode: "line", capacity: 12_000_000, downsample: "minmax", name: "Wave" },
  { color: [0.3, 0.6, 1.0, 1.0], lineWidth: 1 },
);

// scatter series — middle band (y ~0–0.5)
const scatterSeries = chart.addSeries(
  { mode: "scatter", capacity: 1_000_000, downsample: "none", name: "Spikes" },
  { color: [0.95, 0.35, 0.35, 1.0], pointSize: 5 },
);

// bar series — bottom band (baseline -0.9, bars up to -0.3)
const barSeries = chart.addSeries(
  { mode: "bar", capacity: 1_000_000, downsample: "minmax", name: "Power" },
  { color: [0.2, 0.8, 0.4, 0.7], barWidth: 48, baseline: -0.9 },
);

chart.setViewport({ xMin: 0, xMax: VIEW_SAMPLES, yMin: -1.5, yMax: 1.5 });
chart.start();

console.info("[blazeplot] chart initialized", {
  canvasWidth: canvas.width,
  canvasHeight: canvas.height,
  fillBatchSize: FILL_BATCH_SIZE,
  liveBatchSize: LIVE_BATCH_SIZE,
});

function stream(): void {
  const start = t;
  const batchSize = t < VIEW_SAMPLES ? Math.min(FILL_BATCH_SIZE, VIEW_SAMPLES - t) : LIVE_BATCH_SIZE;
  lastBatchSize = batchSize;

  // Wave — top band. Period is 1/5 of the 10M-sample viewport (~2M samples).
  for (let i = 0; i < batchSize; i++) {
    const x = start + i;
    xBuf[i] = x;
    yBuf[i] = Math.sin((x / TRACE_PERIOD) * TAU) * 0.25 + 0.8 + Math.random() * 0.01;
  }
  t += batchSize;
  lineSeries.append(xBuf.subarray(0, batchSize), yBuf.subarray(0, batchSize));

  const sparseStart = Math.ceil(start / SPARSE_INTERVAL) * SPARSE_INTERVAL;
  const sparseCount = sparseStart < t ? Math.floor((t - 1 - sparseStart) / SPARSE_INTERVAL) + 1 : 0;
  if (sparseCount > 0) {
    const spikeX = new Float64Array(sparseCount);
    const spikeY = new Float32Array(sparseCount);
    const barX = new Float64Array(sparseCount);
    const barY = new Float32Array(sparseCount);

    for (let i = 0; i < sparseCount; i++) {
      const x = sparseStart + i * SPARSE_INTERVAL;
      spikeX[i] = x;
      spikeY[i] = 0.15 + Math.random() * 0.35;

      barX[i] = x;
      // Power — bottom band. Uses the same 1/5-view period as the wave.
      barY[i] = -0.9 + Math.abs(Math.sin((x / TRACE_PERIOD) * TAU)) * 0.5 + 0.1;
    }

    scatterSeries.append(spikeX, spikeY);
    barSeries.append(barX, barY);
  }

  frames++;
  const now = performance.now();
  if (now - lastStatsAt >= 500) {
    const fps = (frames * 1000) / (now - lastStatsAt);
    chart.getFrameStats(chartStats);
    if (overlayText) {
      overlayText.textContent = "\n" + [
        "BlazePlot preview",
        "status: running",
        `renderer: ${chartStats.renderMode}`,
        `sync x: ${syncX}`,
        `follow live: ${followLive}`,
        `points appended: ${t.toLocaleString()}`,
        `batch/frame: ${lastBatchSize.toLocaleString()}`,
        `view samples: ${VIEW_SAMPLES.toLocaleString()}`,
        `trace period: ${TRACE_PERIOD.toLocaleString()}`,
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

  requestAnimationFrame(stream);
}

requestAnimationFrame(stream);
