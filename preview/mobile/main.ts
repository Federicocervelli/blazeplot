import { Chart, RingBuffer } from "@/index.ts";
import type { ChartFrameStats } from "@/index.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { legendPlugin } from "@/plugins/legend.ts";

const target = requireElement<HTMLElement>("chart");
const status = requireElement<HTMLElement>("status");
const resetButton = requireElement<HTMLButtonElement>("resetButton");
const streamButton = requireElement<HTMLButtonElement>("streamButton");
const legendButton = requireElement<HTMLButtonElement>("legendButton");

let legendVisible = true;
let streaming = true;
let nextX = 0;
const capacity = 25_000;
const dataset = new RingBuffer(capacity);

const chart = new Chart(target, {
  axes: {
    x: { position: "outside", title: "time" },
    y: { position: "outside", title: "signal" },
  },
  title: { text: "Mobile interaction preview" },
  subtitle: { text: "phone-optimized touch gestures" },
  grid: true,
  plugins: [
    interactionsPlugin({ minDragDistancePx: 6 }),
    crosshairPlugin({ snap: "nearest-x", label: true, longPressMs: 420 }),
    legendPlugin({ position: "top-left" }),
  ],
});

const series = chart.addLine({ dataset, name: "live signal", capacity }, { lineWidth: 2 });
const frameStats: ChartFrameStats = { fps: 0, frameMs: 0, pointsRendered: 0, drawCalls: 0, uploadBytes: 0, renderMode: "none" };

for (let i = 0; i < 1_200; i++) appendSample();
chart.setViewport({ xMin: Math.max(0, nextX - 360), xMax: nextX, yMin: -1.8, yMax: 1.8 });
chart.start();

let lastFrame = performance.now();
function tick(now: number): void {
  const elapsed = now - lastFrame;
  lastFrame = now;
  if (streaming) {
    const count = Math.max(1, Math.floor(elapsed / 16));
    for (let i = 0; i < count; i++) appendSample();
    const viewport = chart.getViewport();
    const span = viewport.xMax - viewport.xMin;
    if (viewport.xMax > nextX - 8) chart.setViewport({ xMin: nextX - span, xMax: nextX });
  }
  const stats = chart.getFrameStats(frameStats);
  status.textContent = `renderer ${stats.renderMode}\npoints ${stats.pointsRendered}\ndraws ${stats.drawCalls}\nx ${Math.round(chart.getViewport().xMin)}…${Math.round(chart.getViewport().xMax)}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

resetButton.addEventListener("click", () => {
  chart.setViewport({ xMin: Math.max(0, nextX - 360), xMax: nextX, yMin: -1.8, yMax: 1.8 });
});

streamButton.addEventListener("click", () => {
  streaming = !streaming;
  streamButton.textContent = streaming ? "pause stream" : "resume stream";
});

legendButton.addEventListener("click", () => {
  legendVisible = !legendVisible;
  chart.setSeriesVisible(series, legendVisible);
});

function appendSample(): void {
  const x = nextX++;
  const drift = Math.sin(x * 0.006) * 0.7;
  const wave = Math.sin(x * 0.055) * 0.65;
  const detail = Math.sin(x * 0.37) * 0.16;
  dataset.push(x, drift + wave + detail);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}
