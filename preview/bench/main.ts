import { Chart } from "@/index.ts";
import type { ChartFrameStats, SeriesStore } from "@/index.ts";
import { ProceduralLineDataset } from "../ProceduralLineDataset.ts";

interface ScenarioConfig {
  readonly name: string;
  readonly initialSamples: number;
  readonly viewportSamples: number;
  readonly capacity: number;
  readonly fillBatchSize: number;
  readonly liveBatchSize: number;
  readonly sparseInterval: number;
  readonly includeScatter: boolean;
  readonly includeBars: boolean;
  readonly yMin: number;
  readonly yMax: number;
  readonly measureMs: number;
  readonly warmupMs: number;
  readonly proceduralLine?: boolean;
}

interface NumericSummary {
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly p50: number;
  readonly p95: number;
}

interface BenchmarkResult {
  readonly scenario: string;
  readonly renderer: ChartFrameStats["renderMode"];
  readonly durationMs: number;
  readonly initialSamples: number;
  readonly liveSamplesAppended: number;
  readonly totalLineSamples: number;
  readonly viewportSamples: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly raf: {
    readonly frames: number;
    readonly fps: number;
    readonly frameMs: NumericSummary;
  };
  readonly chart: {
    readonly fps: NumericSummary;
    readonly frameMs: NumericSummary;
    readonly pointsRendered: NumericSummary;
    readonly drawCalls: NumericSummary;
    readonly uploadBytes: NumericSummary;
  };
  readonly finalStats: ChartFrameStats;
  readonly userAgent: string;
}

type BenchmarkState = "loading" | "filling" | "warming" | "ready" | "measuring" | "done" | "error";

interface BenchmarkController {
  state: BenchmarkState;
  scenario: string;
  progress: number;
  result: BenchmarkResult | null;
  error: string | null;
  start: () => Promise<BenchmarkResult>;
  snapshot: () => {
    state: BenchmarkState;
    scenario: string;
    progress: number;
    result: BenchmarkResult | null;
    error: string | null;
  };
}

declare global {
  interface Window {
    __blazeplotBench: BenchmarkController;
  }
}

const SCENARIOS: Record<string, ScenarioConfig> = {
  "ci-smoke": {
    name: "ci-smoke",
    initialSamples: 100_000,
    viewportSamples: 100_000,
    capacity: 200_000,
    fillBatchSize: 32_768,
    liveBatchSize: 8_192,
    sparseInterval: 256,
    includeScatter: true,
    includeBars: true,
    yMin: -1.5,
    yMax: 1.5,
    measureMs: 500,
    warmupMs: 100,
  },
  "mixed-1m-live": {
    name: "mixed-1m-live",
    initialSamples: 1_000_000,
    viewportSamples: 1_000_000,
    capacity: 2_000_000,
    fillBatchSize: 65_536,
    liveBatchSize: 16_384,
    sparseInterval: 512,
    includeScatter: true,
    includeBars: true,
    yMin: -1.5,
    yMax: 1.5,
    measureMs: 5_000,
    warmupMs: 1_000,
  },
  "line-5m-static": {
    name: "line-5m-static",
    initialSamples: 5_000_000,
    viewportSamples: 5_000_000,
    capacity: 5_000_000,
    fillBatchSize: 131_072,
    liveBatchSize: 0,
    sparseInterval: 1_024,
    includeScatter: false,
    includeBars: false,
    yMin: -1.5,
    yMax: 1.5,
    measureMs: 5_000,
    warmupMs: 1_000,
  },
  "mixed-10m-live": {
    name: "mixed-10m-live",
    initialSamples: 10_000_000,
    viewportSamples: 10_000_000,
    capacity: 12_000_000,
    fillBatchSize: 65_536,
    liveBatchSize: 65_536,
    sparseInterval: 512,
    includeScatter: true,
    includeBars: true,
    yMin: -1.5,
    yMax: 1.5,
    measureMs: 5_000,
    warmupMs: 1_000,
  },
  "line-1b-procedural": {
    name: "line-1b-procedural",
    initialSamples: 1_000_000_000,
    viewportSamples: 1_000_000_000,
    capacity: 1_000_000_000,
    fillBatchSize: 1_000_000_000,
    liveBatchSize: 0,
    sparseInterval: 512,
    includeScatter: false,
    includeBars: false,
    yMin: -1.5,
    yMax: 1.5,
    measureMs: 5_000,
    warmupMs: 1_000,
    proceduralLine: true,
  },
};

const params = new URLSearchParams(window.location.search);
const scenarioName = params.get("scenario") ?? "mixed-1m-live";
const scenario = SCENARIOS[scenarioName];
if (!scenario) throw new Error(`Unknown benchmark scenario '${scenarioName}'. Available: ${Object.keys(SCENARIOS).join(", ")}`);

const config: ScenarioConfig = {
  ...scenario,
  measureMs: readPositiveNumberParam("measureMs", scenario.measureMs),
  warmupMs: readPositiveNumberParam("warmupMs", scenario.warmupMs),
};

const chartTarget = document.getElementById("chart") as HTMLElement | null;
const statusTarget = document.getElementById("status") as HTMLElement | null;
if (!chartTarget) throw new Error("No #chart container found");

const chart = new Chart(chartTarget, {
  axes: { x: { position: "outside" }, y: { position: "outside" } },
});

const lineDataset = config.proceduralLine ? new ProceduralLineDataset(config.capacity) : undefined;
const lineSeries = chart.addSeries(
  { mode: "line", capacity: config.capacity, dataset: lineDataset, downsample: "minmax", name: "Benchmark wave" },
  { color: [0.3, 0.6, 1.0, 1.0], lineWidth: 1 },
);

const scatterSeries = config.includeScatter
  ? chart.addSeries(
      { mode: "scatter", capacity: Math.ceil(config.capacity / config.sparseInterval) + 1, downsample: "none", name: "Benchmark spikes" },
      { color: [0.95, 0.35, 0.35, 1.0], pointSize: 5 },
    )
  : null;

const barSeries = config.includeBars
  ? chart.addSeries(
      { mode: "bar", capacity: Math.ceil(config.capacity / config.sparseInterval) + 1, downsample: "minmax", name: "Benchmark bars" },
      { color: [0.2, 0.8, 0.4, 0.7], barWidth: config.sparseInterval, baseline: -0.9 },
    )
  : null;

const frameStats: ChartFrameStats = {
  fps: 0,
  frameMs: 0,
  pointsRendered: 0,
  drawCalls: 0,
  uploadBytes: 0,
  renderMode: "none",
};

let state: BenchmarkState = "loading";
let progress = 0;
let result: BenchmarkResult | null = null;
let error: string | null = null;
let nextX = 0;
let measurePromise: Promise<BenchmarkResult> | null = null;

window.__blazeplotBench = {
  get state() {
    return state;
  },
  get scenario() {
    return config.name;
  },
  get progress() {
    return progress;
  },
  get result() {
    return result;
  },
  get error() {
    return error;
  },
  start,
  snapshot,
};

chart.setViewport({ xMin: 0, xMax: config.viewportSamples, yMin: config.yMin, yMax: config.yMax });
chart.start();
void prepare();

async function prepare(): Promise<void> {
  try {
    state = "filling";
    renderStatus();

    while (nextX < config.initialSamples) {
      const batchSize = Math.min(config.fillBatchSize, config.initialSamples - nextX);
      appendRange(nextX, batchSize);
      nextX += batchSize;
      progress = nextX / config.initialSamples;
      updateViewport();
      renderStatus();
      await animationFrame();
    }

    state = "warming";
    progress = 1;
    renderStatus();
    await waitMs(config.warmupMs);

    chart.getFrameStats(frameStats);
    state = "ready";
    renderStatus();
  } catch (caught) {
    state = "error";
    error = caught instanceof Error ? caught.message : String(caught);
    renderStatus();
    throw caught;
  }
}

async function start(): Promise<BenchmarkResult> {
  if (measurePromise) return measurePromise;
  if (state !== "ready") throw new Error(`Benchmark is not ready; current state is ${state}`);
  measurePromise = measure();
  return measurePromise;
}

async function measure(): Promise<BenchmarkResult> {
  state = "measuring";
  renderStatus();

  const rafDeltas: number[] = [];
  const chartFps: number[] = [];
  const chartFrameMs: number[] = [];
  const pointsRendered: number[] = [];
  const drawCalls: number[] = [];
  const uploadBytes: number[] = [];
  const startMs = performance.now();
  let lastFrameMs: number | null = null;
  let liveSamplesAppended = 0;

  while (performance.now() - startMs < config.measureMs) {
    const now = await animationFrame();
    if (lastFrameMs !== null) rafDeltas.push(Math.max(0, now - lastFrameMs));
    lastFrameMs = now;

    if (config.liveBatchSize > 0) {
      appendRange(nextX, config.liveBatchSize);
      nextX += config.liveBatchSize;
      liveSamplesAppended += config.liveBatchSize;
      updateViewport();
    }

    chart.getFrameStats(frameStats);
    chartFps.push(frameStats.fps);
    chartFrameMs.push(frameStats.frameMs);
    pointsRendered.push(frameStats.pointsRendered);
    drawCalls.push(frameStats.drawCalls);
    uploadBytes.push(frameStats.uploadBytes);
    renderStatus();
  }

  chart.getFrameStats(frameStats);
  result = {
    scenario: config.name,
    renderer: frameStats.renderMode,
    durationMs: performance.now() - startMs,
    initialSamples: config.initialSamples,
    liveSamplesAppended,
    totalLineSamples: nextX,
    viewportSamples: config.viewportSamples,
    canvas: { width: chart.canvas.width, height: chart.canvas.height },
    raf: {
      frames: rafDeltas.length,
      fps: rafDeltas.length > 0 ? (rafDeltas.length * 1000) / sum(rafDeltas) : 0,
      frameMs: summarize(rafDeltas),
    },
    chart: {
      fps: summarize(chartFps),
      frameMs: summarize(chartFrameMs),
      pointsRendered: summarize(pointsRendered),
      drawCalls: summarize(drawCalls),
      uploadBytes: summarize(uploadBytes),
    },
    finalStats: { ...frameStats },
    userAgent: navigator.userAgent,
  };
  state = "done";
  renderStatus();
  return result;
}

function appendRange(startX: number, count: number): void {
  if (config.proceduralLine) {
    lineSeries.append({ length: count }, { length: count });
    return;
  }

  const xValues = new Float64Array(count);
  const yValues = new Float32Array(count);
  const period = config.viewportSamples / 5;
  const tau = Math.PI * 2;

  for (let i = 0; i < count; i++) {
    const x = startX + i;
    xValues[i] = x;
    yValues[i] = Math.sin((x / period) * tau) * 0.25 + 0.8 + noise01(x) * 0.01;
  }
  lineSeries.append(xValues, yValues);

  if (!scatterSeries && !barSeries) return;
  appendSparseSeries(startX, count, period, tau, scatterSeries, barSeries);
}

function appendSparseSeries(
  startX: number,
  count: number,
  period: number,
  tau: number,
  scatter: SeriesStore | null,
  bars: SeriesStore | null,
): void {
  const endExclusive = startX + count;
  const sparseStart = Math.ceil(startX / config.sparseInterval) * config.sparseInterval;
  const sparseCount = sparseStart < endExclusive ? Math.floor((endExclusive - 1 - sparseStart) / config.sparseInterval) + 1 : 0;
  if (sparseCount <= 0) return;

  const sparseX = new Float64Array(sparseCount);
  const scatterY = scatter ? new Float32Array(sparseCount) : null;
  const barY = bars ? new Float32Array(sparseCount) : null;

  for (let i = 0; i < sparseCount; i++) {
    const x = sparseStart + i * config.sparseInterval;
    sparseX[i] = x;
    if (scatterY) scatterY[i] = 0.15 + noise01(x * 17 + 13) * 0.35;
    if (barY) barY[i] = -0.9 + Math.abs(Math.sin((x / period) * tau)) * 0.5 + 0.1;
  }

  if (scatter && scatterY) scatter.append(sparseX, scatterY);
  if (bars && barY) bars.append(sparseX, barY);
}

function updateViewport(): void {
  chart.setViewport({
    xMin: Math.max(0, nextX - config.viewportSamples),
    xMax: Math.max(config.viewportSamples, nextX),
    yMin: config.yMin,
    yMax: config.yMax,
  });
}

function snapshot(): ReturnType<BenchmarkController["snapshot"]> {
  return { state, scenario: config.name, progress, result, error };
}

function renderStatus(): void {
  if (!statusTarget) return;
  chart.getFrameStats(frameStats);
  statusTarget.textContent = [
    "BlazePlot benchmark",
    `scenario: ${config.name}`,
    `state: ${state}`,
    `fill: ${(progress * 100).toFixed(1)}%`,
    `renderer: ${frameStats.renderMode}`,
    `samples: ${nextX.toLocaleString()}`,
    `render fps: ${frameStats.fps.toFixed(1)}`,
    `render ms: ${frameStats.frameMs.toFixed(2)}`,
    `points rendered: ${frameStats.pointsRendered.toLocaleString()}`,
    `draw calls: ${frameStats.drawCalls}`,
  ].join("\n");
}

function summarize(values: readonly number[]): NumericSummary {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    avg: sum(sorted) / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index] ?? 0;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function noise01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function animationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readPositiveNumberParam(name: string, fallback: number): number {
  const raw = params.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
