import { Chart, RingBuffer } from "@/index.ts";
import type { ChartFrameStats, Viewport } from "@/index.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { legendPlugin } from "@/plugins/legend.ts";

const target = requireElement<HTMLElement>("chart");
const status = requireElement<HTMLElement>("status");
const resetButton = requireElement<HTMLButtonElement>("resetButton");
const streamButton = requireElement<HTMLButtonElement>("streamButton");
const legendButton = requireElement<HTMLButtonElement>("legendButton");

const SAMPLE_RATE = 20;
const SAMPLE_STEP_MS = 1000 / SAMPLE_RATE;
const HISTORY_SAMPLES = 2_400;
const LIVE_WINDOW_MS = 60_000;
const capacity = 25_000;
const dataset = new RingBuffer(capacity);
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 2,
});

let legendVisible = true;
let streaming = true;
let sampleIndex = 0;
let streamBaseSample = 0;
let streamClockStartedAt = performance.now();
const previewStartTime = Date.now() - HISTORY_SAMPLES * SAMPLE_STEP_MS;

const chart = new Chart(target, {
  axes: {
    x: { position: "outside", scale: "time", timezone: "local", title: "time" },
    y: { position: "outside", title: "signal" },
  },
  title: { text: "Mobile interaction preview" },
  subtitle: { text: "phone-optimized touch gestures" },
  grid: true,
  plugins: [
    interactionsPlugin({ minDragDistancePx: 6, resetViewport: liveViewport }),
    crosshairPlugin({ snap: "nearest-x", label: true, longPressMs: 420, formatX: (value) => dateFormatter.format(new Date(value)) }),
    legendPlugin({ position: "top-left" }),
  ],
});

const series = chart.addLine({ dataset, name: "live signal", capacity }, { lineWidth: 2 });
const frameStats: ChartFrameStats = { fps: 0, frameMs: 0, pointsRendered: 0, drawCalls: 0, uploadBytes: 0, renderMode: "none" };

appendUntil(HISTORY_SAMPLES);
resetToLive();
chart.start();

function tick(now: number): void {
  if (streaming) {
    const targetSample = streamBaseSample + Math.floor(((now - streamClockStartedAt) * SAMPLE_RATE) / 1000);
    appendUntil(targetSample);
    maybeFollowLive();
  }
  const stats = chart.getFrameStats(frameStats);
  const viewport = chart.getViewport();
  status.textContent = `renderer ${stats.renderMode}\npoints ${stats.pointsRendered}\ndraws ${stats.drawCalls}\nx ${dateFormatter.format(new Date(viewport.xMin))}…${dateFormatter.format(new Date(viewport.xMax))}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

resetButton.addEventListener("click", resetToLive);

streamButton.addEventListener("click", () => {
  streaming = !streaming;
  if (streaming) {
    streamBaseSample = sampleIndex;
    streamClockStartedAt = performance.now();
  }
  streamButton.textContent = streaming ? "pause stream" : "resume stream";
});

legendButton.addEventListener("click", () => {
  legendVisible = !legendVisible;
  chart.setSeriesVisible(series, legendVisible);
});

function appendUntil(targetSample: number): void {
  const cappedTarget = Math.max(sampleIndex, Math.floor(targetSample));
  for (; sampleIndex < cappedTarget; sampleIndex++) appendSample(sampleIndex);
}

function appendSample(index: number): void {
  const x = sampleToTime(index);
  const drift = Math.sin(index * 0.006) * 0.7;
  const wave = Math.sin(index * 0.055) * 0.65;
  const detail = Math.sin(index * 0.37) * 0.16;
  dataset.push(x, drift + wave + detail);
}

function sampleToTime(index: number): number {
  return previewStartTime + index * SAMPLE_STEP_MS;
}

function latestTime(): number {
  return sampleToTime(Math.max(0, sampleIndex - 1));
}

function liveViewport(): Viewport {
  const xMax = latestTime();
  return { xMin: xMax - LIVE_WINDOW_MS, xMax, yMin: -1.8, yMax: 1.8 };
}

function resetToLive(): void {
  chart.setViewport(liveViewport());
}

function maybeFollowLive(): void {
  const viewport = chart.getViewport();
  const liveX = latestTime();
  const span = viewport.xMax - viewport.xMin;
  if (viewport.xMax >= liveX - SAMPLE_STEP_MS * 4) chart.setViewport({ xMin: liveX - span, xMax: liveX });
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}
