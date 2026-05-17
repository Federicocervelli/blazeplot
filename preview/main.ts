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

// line series (fast streaming)
const lineSeries = chart.addSeries(
  { mode: "line", capacity: 10_000_000, downsample: "minmax", name: "Wave" },
  { color: [0.3, 0.6, 1.0, 1.0], lineWidth: 1 },
);

// scatter series (sparse pulses)
const scatterSeries = chart.addSeries(
  { mode: "scatter", capacity: 1_000_000, downsample: "none", name: "Spikes" },
  { color: [0.95, 0.35, 0.35, 1.0], pointSize: 5 },
);

// bar series (aggregated buckets)
const barSeries = chart.addSeries(
  { mode: "bar", capacity: 1_000_000, downsample: "minmax", name: "Power" },
  { color: [0.2, 0.8, 0.4, 0.7], barWidth: 48, baseline: -1.45 },
);

chart.setViewport({ xMin: 0, xMax: VIEW_SAMPLES, yMin: -1.5, yMax: 1.5 });
chart.start();

console.info("[blazeplot] chart initialized", {
  canvasWidth: canvas.width,
  canvasHeight: canvas.height,
  batchSize: BATCH_SIZE,
});

function stream(): void {
  for (let i = 0; i < BATCH_SIZE; i++) {
    xBuf[i] = t;
    yBuf[i] = Math.sin(t * 0.01) * 0.5 + Math.random() * 0.01;
    t++;
  }

  lineSeries.append(xBuf, yBuf);

  // Append a sparse scatter spike every 64 samples
  if (t % 64 < BATCH_SIZE) {
    const spikeX = new Float64Array(BATCH_SIZE);
    const spikeY = new Float32Array(BATCH_SIZE);
    for (let i = 0; i < BATCH_SIZE; i++) {
      spikeX[i] = t + i - (t % 64);
      spikeY[i] = (t + i) % 64 < BATCH_SIZE ? 0.6 + Math.random() * 0.4 : -1;
    }
    scatterSeries.append(spikeX, spikeY);
  }

  // Append a bar every 64 samples
  if (t % 64 < BATCH_SIZE) {
    const barX = new Float64Array(1);
    const barY = new Float32Array(1);
    barX[0] = t - (t % 64);
    barY[0] = Math.abs(Math.sin(t * 0.005)) * 0.8 + 0.2;
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
