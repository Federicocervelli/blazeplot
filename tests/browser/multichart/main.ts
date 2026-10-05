import { Chart } from "@/index.ts";
import type { SeriesStore } from "@/index.ts";

/**
 * Many small live charts on one page, for `bun run bench:multi`. Query parameters:
 * `charts` (default 50), `renderer` (webgl2 | shared | canvas2d), `warmupMs`, `measureMs`.
 * Every chart appends a few samples per frame, so each frame redraws all of them.
 */

interface MultiResult {
  readonly renderer: string;
  readonly charts: number;
  readonly frames: number;
  readonly fps: number;
  readonly rafP95Ms: number;
  readonly frameWorkP50Ms: number;
  readonly frameWorkP95Ms: number;
  /** `webglcontextlost` events seen on chart canvases (the browser evicting contexts over the cap). */
  readonly contextsLost: number;
  /** Charts whose own WebGL context was lost at the end (always 0 with a shared context). */
  readonly chartsWithLostContext: number;
}

declare global {
  interface Window {
    __multi: { state: "running" | "done" | "error"; result: MultiResult | null; error: string | null };
  }
}

const params = new URLSearchParams(window.location.search);
const count = Number(params.get("charts") ?? 50);
const rendererName = params.get("renderer") ?? "webgl2";
const warmupMs = Number(params.get("warmupMs") ?? 1000);
const measureMs = Number(params.get("measureMs") ?? 4000);
window.__multi = { state: "running", result: null, error: null };

const grid = document.getElementById("grid")!;
const charts: Chart[] = [];
const series: SeriesStore[] = [];
let contextsLost = 0;
let renderMsThisFrame = 0;
const renderer = rendererName === "shared" || rendererName === "canvas2d" ? rendererName : "webgl2";

void run().catch((caught: unknown) => {
  window.__multi.state = "error";
  window.__multi.error = caught instanceof Error ? caught.message : String(caught);
});

async function run(): Promise<void> {
  for (let i = 0; i < count; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    grid.appendChild(cell);
    const chart = new Chart(cell, { axes: false, grid: false, renderer, followX: { window: 1000 } });
    chart.canvas.addEventListener("webglcontextlost", () => contextsLost++);
    chart.subscribe("render", () => {
      renderMsThisFrame += chart.getFrameStats().frameMs;
    });
    const line = chart.addLine({ capacity: 4000 }, { lineWidth: 1.5 });
    const x = Float64Array.from({ length: 1000 }, (_, j) => j);
    line.append({ x, y: Float32Array.from(x, (v) => Math.sin(v / 20 + i)) });
    chart.setViewport({ xMin: 0, xMax: 1000, yMin: -1.5, yMax: 1.5 });
    chart.start();
    charts.push(chart);
    series.push(line);
  }

  let nextX = 1000;
  const rafDeltas: number[] = [];
  const work: number[] = [];
  const startedAt = performance.now();
  let last = 0;
  while (performance.now() - startedAt < warmupMs + measureMs) {
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const measuring = performance.now() - startedAt >= warmupMs;
    if (measuring && last > 0) rafDeltas.push(now - last);
    last = now;
    // Charts render in their own animation frame callbacks, which have already run for the previous batch of appends.
    if (measuring) work.push(renderMsThisFrame);
    renderMsThisFrame = 0;
    for (let i = 0; i < charts.length; i++) {
      series[i]!.append({ x: [nextX, nextX + 1, nextX + 2], y: [Math.sin((nextX + i) / 20), Math.sin((nextX + i + 1) / 20), Math.sin((nextX + i + 2) / 20)] });
    }
    nextX += 3;
  }

  const sorted = (values: number[]): number[] => [...values].sort((a, b) => a - b);
  const pct = (values: number[], p: number): number => {
    const s = sorted(values);
    return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
  };
  window.__multi.result = {
    renderer: rendererName,
    charts: count,
    frames: rafDeltas.length,
    fps: rafDeltas.length > 0 ? (rafDeltas.length * 1000) / rafDeltas.reduce((a, b) => a + b, 0) : 0,
    rafP95Ms: pct(rafDeltas, 0.95),
    frameWorkP50Ms: pct(work, 0.5),
    frameWorkP95Ms: pct(work, 0.95),
    contextsLost,
    chartsWithLostContext: charts.filter((chart) => chart.getWebGLContext()?.isContextLost() === true).length,
  };
  window.__multi.state = "done";
  for (const chart of charts) chart.dispose();
}
