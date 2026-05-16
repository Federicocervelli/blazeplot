import { Chart } from "@/index.ts";
import type { ChartFrameStats, ViewportPolicy } from "@/index.ts";

const canvas = document.getElementById("chart") as HTMLCanvasElement;
if (!canvas) throw new Error("No #chart canvas found");

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

const chart = new Chart(canvas, { viewportPolicy: previewPolicy });

const series = chart.addSeries(
  { mode: "line", capacity: 10_000_000, downsample: "minmax" },
  { color: [0.3, 0.6, 1.0, 1.0], lineWidth: 1 },
);

chart.setViewport({ xMin: 0, xMax: VIEW_SAMPLES, yMin: -1, yMax: 1 });
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

  series.append(xBuf, yBuf);

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
