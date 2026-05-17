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

const BATCH_SIZE = 16;
const VIEW_SAMPLES = 65_536;
const xBuf = new Float64Array(BATCH_SIZE);
const yBuf = new Float32Array(BATCH_SIZE);
let t = 0;
let frames = 0;
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
  { mode: "line", capacity: 10_000_000, downsample: "minmax", name: "Wave" },
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
  batchSize: BATCH_SIZE,
});

function stream(): void {
  // Wave — top band (centered around y = +0.8)
  for (let i = 0; i < BATCH_SIZE; i++) {
    xBuf[i] = t;
    yBuf[i] = Math.sin(t * 0.01) * 0.25 + 0.8 + Math.random() * 0.01;
    t++;
  }
  lineSeries.append(xBuf, yBuf);

  // Spikes — middle band (every 64 samples, one spike)
  if (t % 64 === 0) {
    const spikeX = new Float64Array(1);
    const spikeY = new Float32Array(1);
    spikeX[0] = t - 1;
    spikeY[0] = 0.15 + Math.random() * 0.35;
    scatterSeries.append(spikeX, spikeY);
  }

  // Power — bottom band (every 64 samples, one bar from -0.9 up)
  if (t % 64 === 0) {
    const barX = new Float64Array(1);
    const barY = new Float32Array(1);
    barX[0] = t - 1;
    barY[0] = -0.9 + Math.abs(Math.sin(t * 0.005)) * 0.5 + 0.1;
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
        `batch/frame: ${BATCH_SIZE.toLocaleString()}`,
        `view samples: ${VIEW_SAMPLES.toLocaleString()}`,
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
