import {
  Chart as ChartJs,
  Decimation,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
} from "chart.js";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Chart, StaticDataset } from "@/index.ts";
import type { AcceleratedDataset, Dataset, MinMaxSegmentLayout, SampleCopyLayout, SeriesStore, TimeRange, Viewport } from "@/index.ts";

ChartJs.register(LineController, LineElement, PointElement, LinearScale, Decimation, Legend, Tooltip);

type LibraryId = "blazeplot" | "uplot" | "chartjs";
type ScenarioOperation = "static" | "pan" | "stream";
type BlazePlotDataPath = "prepared-arrays" | "accelerated-dataset";
type BenchmarkState = "prewarming" | "ready" | "running" | "done" | "error";
type UPlotData = ConstructorParameters<typeof uPlot>[1];
type ChartJsPoint = { x: number; y: number };
type MutableChartJsDataset = ChartDataset<"line", ChartJsPoint[]> & { _data?: ChartJsPoint[] };

interface ScenarioConfig {
  readonly name: string;
  readonly title: string;
  readonly sampleCount: number;
  readonly viewportSamples: number;
  readonly operation: ScenarioOperation;
  readonly measureMs: number;
  readonly warmupMs: number;
  readonly streamBatchSize?: number;
  readonly blazeplotDataPath?: BlazePlotDataPath;
  readonly yMin: number;
  readonly yMax: number;
}

interface BenchmarkData {
  readonly sampleCount: number;
  readonly xFloat?: Float64Array;
  readonly yFloat?: Float32Array;
  readonly xArray?: number[];
  readonly yArray?: number[];
  readonly chartJsPoints?: ChartJsPoint[];
}

interface ViewportRange {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

interface NumericSummary {
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly p50: number;
  readonly p95: number;
}

interface InstanceStats {
  readonly fps?: number;
  readonly frameMs?: number;
  readonly pointsRendered?: number;
  readonly drawCalls?: number;
  readonly uploadBytes?: number;
  readonly renderMode?: string;
}

interface MeasurementResult {
  readonly durationMs: number;
  readonly frames: number;
  readonly rafFps: number;
  readonly rafFrameMs: NumericSummary;
  readonly updateMs: NumericSummary;
  readonly chartFrameMs?: NumericSummary;
  readonly pointsRendered?: NumericSummary;
  readonly drawCalls?: NumericSummary;
  readonly uploadBytes?: NumericSummary;
  readonly samplesAppended: number;
}

interface LibraryResult {
  readonly library: LibraryId;
  readonly ok: boolean;
  readonly readyMs?: number;
  readonly setupWarmupReadyMs?: readonly number[];
  readonly heapBeforeBytes?: number | null;
  readonly heapAfterReadyBytes?: number | null;
  readonly heapAfterMeasureBytes?: number | null;
  readonly firstFrame?: InstanceStats;
  readonly measurement?: MeasurementResult;
  readonly error?: string;
}

interface ScenarioResult {
  readonly name: string;
  readonly title: string;
  readonly operation: ScenarioOperation;
  readonly sampleCount: number;
  readonly viewportSamples: number;
  readonly measureMs: number;
  readonly warmupMs: number;
  readonly streamBatchSize?: number;
  readonly dataPrepMs: number;
  readonly results: LibraryResult[];
}

interface BrowserEnvironment {
  readonly userAgent: string;
  readonly language: string;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb?: number;
  readonly screen: { readonly width: number; readonly height: number; readonly colorDepth: number };
  readonly webglVendor: string | null;
  readonly webglRenderer: string | null;
  readonly webglVersion: string | null;
  readonly headlessUserAgent: boolean;
}

interface PageBenchmarkResult {
  readonly environment: BrowserEnvironment;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly libraries: LibraryId[];
  readonly prewarmMs: number;
  readonly scenarios: ScenarioResult[];
}

interface BenchmarkInstance {
  readonly ready?: () => Promise<void>;
  readonly pan?: (viewport: ViewportRange) => void;
  readonly append?: (startX: number, count: number, viewport: ViewportRange) => void;
  readonly stats?: () => InstanceStats;
  readonly destroy: () => void;
}

interface BenchmarkController {
  state: BenchmarkState;
  progress: number;
  result: PageBenchmarkResult | null;
  error: string | null;
  start: () => Promise<PageBenchmarkResult>;
  snapshot: () => {
    state: BenchmarkState;
    progress: number;
    result: PageBenchmarkResult | null;
    error: string | null;
  };
}

const DEFAULT_LIBRARIES: readonly LibraryId[] = ["blazeplot", "uplot", "chartjs"];
const DEFAULT_SCENARIOS = ["line-100k-static", "line-1m-static", "line-1m-pan", "line-1m-stream", "line-10m-accelerated-pan"] as const;
const SCENARIOS: Record<string, ScenarioConfig> = {
  "line-100k-static": {
    name: "line-100k-static",
    title: "100k point line, initial render",
    sampleCount: 100_000,
    viewportSamples: 100_000,
    operation: "static",
    measureMs: 0,
    warmupMs: 100,
    yMin: -1.25,
    yMax: 1.25,
  },
  "line-1m-static": {
    name: "line-1m-static",
    title: "1M point line, initial render",
    sampleCount: 1_000_000,
    viewportSamples: 1_000_000,
    operation: "static",
    measureMs: 0,
    warmupMs: 100,
    yMin: -1.25,
    yMax: 1.25,
  },
  "line-1m-pan": {
    name: "line-1m-pan",
    title: "1M point line, automated pan over 100k visible samples",
    sampleCount: 1_000_000,
    viewportSamples: 100_000,
    operation: "pan",
    measureMs: 3_000,
    warmupMs: 250,
    yMin: -1.25,
    yMax: 1.25,
  },
  "line-1m-stream": {
    name: "line-1m-stream",
    title: "1M point line, live append while following latest 100k samples",
    sampleCount: 1_000_000,
    viewportSamples: 100_000,
    operation: "stream",
    measureMs: 3_000,
    warmupMs: 250,
    streamBatchSize: 1_024,
    yMin: -1.25,
    yMax: 1.25,
  },
  "line-5m-pan": {
    name: "line-5m-pan",
    title: "5M point line, automated pan over 1M visible samples",
    sampleCount: 5_000_000,
    viewportSamples: 1_000_000,
    operation: "pan",
    measureMs: 3_000,
    warmupMs: 250,
    yMin: -1.25,
    yMax: 1.25,
  },
  "line-10m-accelerated-pan": {
    name: "line-10m-accelerated-pan",
    title: "10M point line, automated pan over 5M visible samples using BlazePlot's accelerated dataset path",
    sampleCount: 10_000_000,
    viewportSamples: 5_000_000,
    operation: "pan",
    measureMs: 3_000,
    warmupMs: 250,
    blazeplotDataPath: "accelerated-dataset",
    yMin: -1.25,
    yMax: 1.25,
  },
};

const params = new URLSearchParams(window.location.search);
const selectedLibraries = readListParam("libraries", DEFAULT_LIBRARIES, isLibraryId);
const selectedScenarioNames = readScenarioNames();
const canvasSize = {
  width: readPositiveIntegerParam("width", 1280),
  height: readPositiveIntegerParam("height", 720),
};
const measureOverrideMs = readOptionalPositiveIntegerParam("measureMs");
const warmupOverrideMs = readOptionalPositiveIntegerParam("warmupMs");
const setupWarmupRuns = readPositiveIntegerParam("setupWarmupRuns", 1);
const mount = document.getElementById("mount");
const statusTarget = document.getElementById("status");
if (!mount) throw new Error("No #mount container found");

let state: BenchmarkState = "prewarming";
let progress = 0;
let result: PageBenchmarkResult | null = null;
let error: string | null = null;
let runPromise: Promise<PageBenchmarkResult> | null = null;
let prewarmMs = 0;

window.__blazeplotCompare = {
  get state() {
    return state;
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

renderStatus("prewarming");
void prepare();

declare global {
  interface Window {
    __blazeplotCompare: BenchmarkController;
    gc?: () => void;
  }

  interface Navigator {
    readonly deviceMemory?: number;
  }

  interface Performance {
    readonly memory?: { readonly usedJSHeapSize: number };
  }
}

function readScenarioNames(): string[] {
  const names = readListParam("scenarios", DEFAULT_SCENARIOS, (value): value is string => value in SCENARIOS);
  if (names.length === 0) throw new Error("At least one benchmark scenario is required.");
  return names;
}

function readListParam<T extends string>(name: string, fallback: readonly T[], predicate: (value: string) => value is T): T[] {
  const raw = params.get(name);
  const values = raw ? raw.split(",").map((value) => value.trim()).filter(Boolean) : [...fallback];
  const invalid = values.filter((value) => !predicate(value));
  if (invalid.length > 0) throw new Error(`Unknown ${name}: ${invalid.join(", ")}`);
  return values as T[];
}

function isLibraryId(value: string): value is LibraryId {
  return value === "blazeplot" || value === "uplot" || value === "chartjs";
}

async function prepare(): Promise<void> {
  try {
    const startedAt = performance.now();
    await prewarmLibraries();
    prewarmMs = performance.now() - startedAt;
    state = "ready";
    renderStatus("ready");
  } catch (caught) {
    state = "error";
    error = caught instanceof Error ? caught.message : String(caught);
    renderStatus("error");
  }
}

async function start(): Promise<PageBenchmarkResult> {
  if (runPromise) return runPromise;
  if (state !== "ready") throw new Error(`Comparison benchmark is not ready; current state is ${state}`);
  runPromise = runComparison();
  return runPromise;
}

async function runComparison(): Promise<PageBenchmarkResult> {
  state = "running";
  error = null;
  progress = 0;
  renderStatus("starting");

  try {
    const scenarioResults: ScenarioResult[] = [];
    const totalSteps = selectedScenarioNames.length * selectedLibraries.length;
    let completedSteps = 0;

    for (const scenarioName of selectedScenarioNames) {
      const scenario = withOverrides(SCENARIOS[scenarioName]!);
      renderStatus(`preparing ${scenario.name}`);
      await settleFrames(1);

      const prepStartedAt = performance.now();
      const data = createBenchmarkData(scenario, selectedLibraries);
      const dataPrepMs = performance.now() - prepStartedAt;
      const libraryResults: LibraryResult[] = [];

      for (const library of selectedLibraries) {
        const setupWarmupReadyMs: number[] = [];
        for (let warmupRun = 0; warmupRun < setupWarmupRuns; warmupRun++) {
          renderStatus(`warming ${scenario.name} on ${library} (${warmupRun + 1}/${setupWarmupRuns})`);
          setupWarmupReadyMs.push(await runLibrarySetupWarmup(library, scenario, data));
          await settleFrames(1);
        }
        renderStatus(`running ${scenario.name} on ${library}`);
        const libraryResult = await runLibraryBenchmark(library, scenario, data, setupWarmupReadyMs);
        libraryResults.push(libraryResult);
        completedSteps += 1;
        progress = totalSteps > 0 ? completedSteps / totalSteps : 1;
        renderStatus(`finished ${scenario.name} on ${library}`);
        await settleFrames(2);
      }

      scenarioResults.push({
        name: scenario.name,
        title: scenario.title,
        operation: scenario.operation,
        sampleCount: scenario.sampleCount,
        viewportSamples: scenario.viewportSamples,
        measureMs: scenario.measureMs,
        warmupMs: scenario.warmupMs,
        streamBatchSize: scenario.streamBatchSize,
        dataPrepMs,
        results: libraryResults,
      });
    }

    result = {
      environment: collectBrowserEnvironment(),
      canvas: canvasSize,
      libraries: selectedLibraries,
      prewarmMs: round(prewarmMs),
      scenarios: scenarioResults,
    };
    state = "done";
    progress = 1;
    renderStatus("done");
    return result;
  } catch (caught) {
    state = "error";
    error = caught instanceof Error ? caught.message : String(caught);
    renderStatus("error");
    throw caught;
  }
}

function withOverrides(scenario: ScenarioConfig): ScenarioConfig {
  return {
    ...scenario,
    measureMs: measureOverrideMs ?? scenario.measureMs,
    warmupMs: warmupOverrideMs ?? scenario.warmupMs,
  };
}

async function prewarmLibraries(): Promise<void> {
  const scenario: ScenarioConfig = {
    name: "prewarm",
    title: "Tiny library prewarm",
    sampleCount: 100_000,
    viewportSamples: 100_000,
    operation: "static",
    measureMs: 0,
    warmupMs: 0,
    yMin: -1.25,
    yMax: 1.25,
  };
  const data = createBenchmarkData(scenario, selectedLibraries);
  for (const library of selectedLibraries) {
    renderStatus(`prewarming ${library}`);
    const host = createHost();
    let instance: BenchmarkInstance | null = null;
    try {
      instance = createInstance(library, host, scenario, data);
      await instance.ready?.();
      await settleFrames(1);
    } finally {
      instance?.destroy();
      host.remove();
    }
  }
  mount!.replaceChildren();
}

async function runLibrarySetupWarmup(library: LibraryId, scenario: ScenarioConfig, data: BenchmarkData): Promise<number> {
  let host: HTMLElement | null = null;
  let instance: BenchmarkInstance | null = null;
  try {
    host = createHost();
    const startedAt = performance.now();
    instance = createInstance(library, host, scenario.operation === "stream" ? { ...scenario, operation: "static", streamBatchSize: undefined } : scenario, data);
    await instance.ready?.();
    return round(performance.now() - startedAt);
  } finally {
    try {
      instance?.destroy();
    } finally {
      host?.remove();
    }
  }
}

async function runLibraryBenchmark(library: LibraryId, scenario: ScenarioConfig, data: BenchmarkData, setupWarmupReadyMs: readonly number[]): Promise<LibraryResult> {
  let host: HTMLElement | null = null;
  let instance: BenchmarkInstance | null = null;
  await collectGarbage();
  const heapBeforeBytes = readHeapBytes();

  try {
    host = createHost();
    const createStartedAt = performance.now();
    instance = createInstance(library, host, scenario, data);
    if (instance.ready) await instance.ready();
    const readyMs = performance.now() - createStartedAt;
    const firstFrame = instance.stats?.();
    const heapAfterReadyBytes = readHeapBytes();
    if (scenario.warmupMs > 0) await waitMs(scenario.warmupMs);

    const measurement = scenario.operation === "static"
      ? undefined
      : await measureInstance(instance, scenario, data);
    const heapAfterMeasureBytes = readHeapBytes();

    return {
      library,
      ok: true,
      readyMs: round(readyMs),
      setupWarmupReadyMs,
      heapBeforeBytes,
      heapAfterReadyBytes,
      heapAfterMeasureBytes,
      firstFrame,
      measurement,
    };
  } catch (caught) {
    return {
      library,
      ok: false,
      setupWarmupReadyMs,
      heapBeforeBytes,
      heapAfterReadyBytes: readHeapBytes(),
      heapAfterMeasureBytes: readHeapBytes(),
      error: caught instanceof Error ? caught.message : String(caught),
    };
  } finally {
    try {
      instance?.destroy();
    } finally {
      host?.remove();
    }
  }
}

function createInstance(library: LibraryId, host: HTMLElement, scenario: ScenarioConfig, data: BenchmarkData): BenchmarkInstance {
  switch (library) {
    case "blazeplot":
      return createBlazePlotInstance(host, scenario, data);
    case "uplot":
      return createUPlotInstance(host, scenario, data);
    case "chartjs":
      return createChartJsInstance(host, scenario, data);
  }
}

function createBlazePlotInstance(host: HTMLElement, scenario: ScenarioConfig, data: BenchmarkData): BenchmarkInstance {
  const chart = new Chart(host, {
    axes: { x: { position: "outside" }, y: { position: "outside" } },
    grid: false,
    renderLoop: "auto",
  });
  const streaming = scenario.operation === "stream";
  const series = streaming
    ? createBlazePlotStreamingSeries(chart, scenario, data)
    : chart.addLine({
        dataset: createBlazePlotDataset(scenario, data),
        downsample: "minmax",
        name: "Benchmark line",
      }, { color: [0.23, 0.45, 0.95, 1], lineWidth: 1 });
  chart.setViewport(initialViewport(scenario, scenario.sampleCount));
  chart.start();

  return {
    ready: () => waitForBlazePlotFrame(chart),
    pan: (viewport) => chart.setViewport(viewport),
    append: (startX, count, viewport) => {
      if (streaming) appendBlazePlotYOnlySamples(series, startX, count);
      else appendBlazePlotSamples(series, startX, count);
      chart.setViewport(viewport);
    },
    stats: () => chartStats(chart),
    destroy: () => chart.dispose(),
  };
}

function createBlazePlotDataset(scenario: ScenarioConfig, data: BenchmarkData): Dataset {
  if (scenario.blazeplotDataPath === "accelerated-dataset") return new ProceduralBenchmarkDataset(scenario.sampleCount);
  return new StaticDataset(requireBenchmarkData(data.xFloat, "BlazePlot x data"), requireBenchmarkData(data.yFloat, "BlazePlot y data"));
}

function createBlazePlotStreamingSeries(chart: Chart, scenario: ScenarioConfig, data: BenchmarkData): SeriesStore {
  const series = chart.addLine({
    capacity: scenario.sampleCount + streamAppendCapacity(scenario),
    xStart: 0,
    xStep: 1,
    downsample: "minmax",
    name: "Benchmark line",
  }, { color: [0.23, 0.45, 0.95, 1], lineWidth: 1 });
  series.append({ y: requireBenchmarkData(data.yFloat, "BlazePlot y data") });
  return series;
}

function createUPlotInstance(host: HTMLElement, scenario: ScenarioConfig, data: BenchmarkData): BenchmarkInstance {
  const sourceX = requireBenchmarkData(data.xArray, "uPlot x data");
  const sourceY = requireBenchmarkData(data.yArray, "uPlot y data");
  const xValues = scenario.operation === "stream" ? sourceX.slice() : sourceX;
  const yValues = scenario.operation === "stream" ? sourceY.slice() : sourceY;
  const viewport = initialViewport(scenario, scenario.sampleCount);
  const plotData = [xValues, yValues] as unknown as NonNullable<UPlotData>;
  const options: ConstructorParameters<typeof uPlot>[0] = {
    width: canvasSize.width,
    height: canvasSize.height,
    legend: { show: false },
    cursor: { show: false, drag: { x: false, y: false } },
    scales: {
      x: { time: false, min: viewport.xMin, max: viewport.xMax },
      y: { auto: false, range: () => [scenario.yMin, scenario.yMax] },
    },
    axes: [
      { show: true, grid: { show: false } },
      { show: true, grid: { show: false } },
    ],
    series: [
      {},
      { label: "Benchmark line", stroke: "#3b73f2", width: 1, points: { show: false } },
    ],
  };
  const plot = new uPlot(options, plotData, host);

  return {
    ready: () => settleFrames(1),
    pan: (nextViewport) => setUPlotViewport(plot, nextViewport),
    append: (startX, count, nextViewport) => {
      appendArraySamples(xValues, yValues, startX, count);
      setUPlotDataAndViewport(plot, plotData, nextViewport);
    },
    destroy: () => plot.destroy(),
  };
}

function createChartJsInstance(host: HTMLElement, scenario: ScenarioConfig, data: BenchmarkData): BenchmarkInstance {
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  canvas.style.width = `${canvasSize.width}px`;
  canvas.style.height = `${canvasSize.height}px`;
  host.append(canvas);

  const viewport = initialViewport(scenario, scenario.sampleCount);
  const chartJsPoints = requireBenchmarkData(data.chartJsPoints, "Chart.js point data");
  const sourceData = scenario.operation === "stream" ? chartJsPoints.slice() : chartJsPoints;
  const dataset: MutableChartJsDataset = {
    label: "Benchmark line",
    data: sourceData,
    borderColor: "#3b73f2",
    borderWidth: 1,
    pointRadius: 0,
    pointHitRadius: 0,
    parsing: false,
    normalized: true,
    tension: 0,
  };
  const config: ChartConfiguration<"line", ChartJsPoint[], unknown> = {
    type: "line",
    data: { datasets: [dataset] },
    options: {
      responsive: false,
      animation: false,
      parsing: false,
      normalized: true,
      events: [],
      devicePixelRatio: window.devicePixelRatio,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      elements: {
        point: { radius: 0, hitRadius: 0, hoverRadius: 0 },
        line: { borderWidth: 1, tension: 0 },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        decimation: {
          enabled: true,
          algorithm: "min-max",
          threshold: Math.max(1_000, canvasSize.width * 4),
        },
      },
      scales: {
        x: {
          type: "linear",
          min: viewport.xMin,
          max: viewport.xMax,
          ticks: { sampleSize: 8, maxRotation: 0 },
          grid: { display: false },
        },
        y: {
          type: "linear",
          min: viewport.yMin,
          max: viewport.yMax,
          ticks: { sampleSize: 8, maxRotation: 0 },
          grid: { display: false },
        },
      },
    },
  };
  const chart = new ChartJs(canvas, config);

  return {
    ready: () => settleFrames(1),
    pan: (nextViewport) => {
      setChartJsViewport(chart, nextViewport);
      chart.update("none");
    },
    append: (startX, count, nextViewport) => {
      appendChartJsSamples(dataset, startX, count);
      setChartJsViewport(chart, nextViewport);
      chart.update("none");
    },
    destroy: () => chart.destroy(),
  };
}

async function measureInstance(instance: BenchmarkInstance, scenario: ScenarioConfig, data: BenchmarkData): Promise<MeasurementResult> {
  const rafFrameMs: number[] = [];
  const updateMs: number[] = [];
  const chartFrameMs: number[] = [];
  const pointsRendered: number[] = [];
  const drawCalls: number[] = [];
  const uploadBytes: number[] = [];
  const startedAt = performance.now();
  let lastRafAt = await animationFrame();
  let nextX = data.sampleCount;
  let samplesAppended = 0;

  while (performance.now() - startedAt < scenario.measureMs) {
    const elapsedMs = performance.now() - startedAt;
    const operationStartedAt = performance.now();

    if (scenario.operation === "pan") {
      instance.pan?.(panViewport(scenario, elapsedMs, data.sampleCount));
    } else if (scenario.operation === "stream") {
      const samplesPerSecond = (scenario.streamBatchSize ?? 1) * 60;
      const targetNextX = data.sampleCount + Math.floor((elapsedMs / 1000) * samplesPerSecond);
      const count = Math.max(0, targetNextX - nextX);
      if (count > 0) {
        nextX += count;
        samplesAppended += count;
        instance.append?.(nextX - count, count, latestViewport(scenario, nextX));
      }
    }

    updateMs.push(performance.now() - operationStartedAt);
    const rafAt = await animationFrame();
    rafFrameMs.push(Math.max(0, rafAt - lastRafAt));
    lastRafAt = rafAt;

    const stats = instance.stats?.();
    if (typeof stats?.frameMs === "number") chartFrameMs.push(stats.frameMs);
    if (typeof stats?.pointsRendered === "number") pointsRendered.push(stats.pointsRendered);
    if (typeof stats?.drawCalls === "number") drawCalls.push(stats.drawCalls);
    if (typeof stats?.uploadBytes === "number") uploadBytes.push(stats.uploadBytes);
  }

  const durationMs = performance.now() - startedAt;
  return {
    durationMs: round(durationMs),
    frames: rafFrameMs.length,
    rafFps: rafFrameMs.length > 0 ? round((rafFrameMs.length * 1000) / sum(rafFrameMs)) : 0,
    rafFrameMs: summarize(rafFrameMs),
    updateMs: summarize(updateMs),
    chartFrameMs: chartFrameMs.length > 0 ? summarize(chartFrameMs) : undefined,
    pointsRendered: pointsRendered.length > 0 ? summarize(pointsRendered) : undefined,
    drawCalls: drawCalls.length > 0 ? summarize(drawCalls) : undefined,
    uploadBytes: uploadBytes.length > 0 ? summarize(uploadBytes) : undefined,
    samplesAppended,
  };
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

function createHost(): HTMLElement {
  mount!.replaceChildren();
  const host = document.createElement("div");
  host.className = "bench-case";
  host.style.width = `${canvasSize.width}px`;
  host.style.height = `${canvasSize.height}px`;
  mount!.append(host);
  return host;
}

class ProceduralBenchmarkDataset implements AcceleratedDataset {
  private static readonly minY = -0.95;
  private static readonly maxY = 0.95;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError("Procedural benchmark dataset length must be positive.");
  }

  get range(): TimeRange {
    return { start: 0, end: this.length - 1 };
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return index;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return sampleY(index);
  }

  lowerBoundX(x: number): number {
    return Math.max(0, Math.min(this.length, Math.ceil(x)));
  }

  upperBoundX(x: number): number {
    return Math.max(0, Math.min(this.length, Math.floor(x) + 1));
  }

  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    return to > from ? { minY: ProceduralBenchmarkDataset.minY, maxY: ProceduralBenchmarkDataset.maxY } : null;
  }

  copySamplesRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    return this.copyStridedSamples(Math.max(0, Math.floor(start)), Math.min(this.length, Math.ceil(end)), 1, target, maxPoints, layout, baseline, xOrigin);
  }

  copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = Math.max(0, end - start);
    const stride = Math.max(1, Math.ceil(visible / Math.max(1, maxPoints)));
    const alignedStart = start + positiveModulo(-start, stride);
    return this.copyStridedSamples(alignedStart, end, stride, target, maxPoints, layout, baseline, xOrigin);
  }

  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    layout: MinMaxSegmentLayout,
    xOrigin: number,
  ): number {
    const floatsPerSegment = layout === "line-list" ? 4 : 3;
    if (maxSegments <= 0 || target.length < maxSegments * floatsPerSegment) return 0;

    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const stride = Math.max(1, Math.ceil(visible / maxSegments));
    const alignedStart = start - (start % stride);
    let written = 0;

    for (let bucketStart = alignedStart; bucketStart < end && written < maxSegments; bucketStart += stride) {
      const segmentStart = Math.max(0, bucketStart);
      const segmentEnd = Math.min(this.length, bucketStart + stride);
      if (segmentEnd <= start || segmentStart >= end) continue;

      const representative = Math.max(segmentStart, Math.min(segmentEnd - 1, bucketStart + (stride >> 1)));
      const x = representative - xOrigin;
      if (layout === "line-list") {
        const offset = written * 4;
        target[offset] = x;
        target[offset + 1] = ProceduralBenchmarkDataset.minY;
        target[offset + 2] = x;
        target[offset + 3] = ProceduralBenchmarkDataset.maxY;
      } else {
        const offset = written * 3;
        target[offset] = x;
        target[offset + 1] = ProceduralBenchmarkDataset.minY;
        target[offset + 2] = ProceduralBenchmarkDataset.maxY;
      }
      written++;
    }

    return written;
  }

  private copyStridedSamples(
    from: number,
    to: number,
    stride: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const count = Math.min(maxPoints, Math.max(0, Math.ceil((to - from) / stride)));
    for (let i = 0, index = from; i < count; i++, index += stride) {
      const x = index - xOrigin;
      if (layout === "points") {
        const offset = i * 2;
        target[offset] = x;
        target[offset + 1] = sampleY(index);
      } else {
        const offset = i * 4;
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = sampleY(index);
      }
    }
    return count;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError(`Procedural benchmark dataset index out of range: ${index}`);
  }
}

function createBenchmarkData(scenario: ScenarioConfig, libraries: readonly LibraryId[]): BenchmarkData {
  const sampleCount = scenario.sampleCount;
  const needsBlazePlot = libraries.includes("blazeplot") && scenario.blazeplotDataPath !== "accelerated-dataset";
  const needsUPlot = libraries.includes("uplot");
  const needsChartJs = libraries.includes("chartjs");
  const xFloat = needsBlazePlot ? new Float64Array(sampleCount) : undefined;
  const yFloat = needsBlazePlot ? new Float32Array(sampleCount) : undefined;
  const xArray = needsUPlot ? new Array<number>(sampleCount) : undefined;
  const yArray = needsUPlot ? new Array<number>(sampleCount) : undefined;
  const chartJsPoints = needsChartJs ? new Array<ChartJsPoint>(sampleCount) : undefined;

  for (let i = 0; i < sampleCount; i++) {
    const x = i;
    const y = sampleY(x);
    if (xFloat) xFloat[i] = x;
    if (yFloat) yFloat[i] = y;
    if (xArray) xArray[i] = x;
    if (yArray) yArray[i] = y;
    if (chartJsPoints) chartJsPoints[i] = { x, y };
  }

  return { sampleCount, xFloat, yFloat, xArray, yArray, chartJsPoints };
}

function requireBenchmarkData<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} was not prepared for this benchmark run.`);
  return value;
}

function initialViewport(scenario: ScenarioConfig, totalSamples: number): ViewportRange {
  if (scenario.operation === "stream") return latestViewport(scenario, totalSamples);
  return {
    xMin: 0,
    xMax: Math.max(1, scenario.viewportSamples - 1),
    yMin: scenario.yMin,
    yMax: scenario.yMax,
  };
}

function latestViewport(scenario: ScenarioConfig, nextX: number): ViewportRange {
  const xMax = Math.max(1, nextX - 1);
  const xMin = Math.max(0, xMax - scenario.viewportSamples + 1);
  return { xMin, xMax, yMin: scenario.yMin, yMax: scenario.yMax };
}

function panViewport(scenario: ScenarioConfig, elapsedMs: number, totalSamples: number): ViewportRange {
  const span = Math.max(1, Math.min(scenario.viewportSamples, totalSamples));
  const maxStart = Math.max(0, totalSamples - span);
  const t = elapsedMs / Math.max(1, scenario.measureMs);
  const xMin = maxStart * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
  return { xMin, xMax: xMin + span - 1, yMin: scenario.yMin, yMax: scenario.yMax };
}

function streamAppendCapacity(scenario: ScenarioConfig): number {
  if (scenario.operation !== "stream") return 0;
  const batchSize = scenario.streamBatchSize ?? 1;
  return Math.ceil((Math.max(1, scenario.measureMs) / 1000) * batchSize * 90) + batchSize;
}

async function waitForBlazePlotFrame(chart: Chart): Promise<void> {
  for (let i = 0; i < 120; i++) {
    await animationFrame();
    const stats = chart.getFrameStats();
    if (stats.renderMode !== "none" && stats.drawCalls > 0) return;
  }
}

function chartStats(chart: Chart): InstanceStats {
  const stats = chart.getFrameStats();
  return {
    fps: round(stats.fps),
    frameMs: round(stats.frameMs),
    pointsRendered: stats.pointsRendered,
    drawCalls: stats.drawCalls,
    uploadBytes: stats.uploadBytes,
    renderMode: stats.renderMode,
  };
}

function appendBlazePlotSamples(series: SeriesStore, startX: number, count: number): void {
  const xValues = new Float64Array(count);
  const yValues = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = startX + i;
    xValues[i] = x;
    yValues[i] = sampleY(x);
  }
  series.append(xValues, yValues);
}

function appendBlazePlotYOnlySamples(series: SeriesStore, startX: number, count: number): void {
  const yValues = new Float32Array(count);
  for (let i = 0; i < count; i++) yValues[i] = sampleY(startX + i);
  series.append({ y: yValues });
}

function appendArraySamples(xValues: number[], yValues: number[], startX: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = startX + i;
    xValues.push(x);
    yValues.push(sampleY(x));
  }
}

function appendChartJsSamples(dataset: MutableChartJsDataset, startX: number, count: number): void {
  const source = dataset._data ?? dataset.data;
  for (let i = 0; i < count; i++) {
    const x = startX + i;
    source.push({ x, y: sampleY(x) });
  }
}

function setUPlotViewport(plot: uPlot, viewport: ViewportRange): void {
  plot.batch(() => {
    applyUPlotViewport(plot, viewport);
  }, true);
}

function setUPlotDataAndViewport(plot: uPlot, data: NonNullable<UPlotData>, viewport: ViewportRange): void {
  plot.batch(() => {
    plot.setData(data, false);
    applyUPlotViewport(plot, viewport);
  }, true);
}

function applyUPlotViewport(plot: uPlot, viewport: ViewportRange): void {
  plot.setScale("x", { min: viewport.xMin, max: viewport.xMax });
  plot.setScale("y", { min: viewport.yMin, max: viewport.yMax });
}

function setChartJsViewport(chart: ChartJs<"line", ChartJsPoint[], unknown>, viewport: ViewportRange): void {
  const scales = chart.options.scales;
  const xScale = scales?.x;
  const yScale = scales?.y;
  if (xScale) {
    xScale.min = viewport.xMin;
    xScale.max = viewport.xMax;
  }
  if (yScale) {
    yScale.min = viewport.yMin;
    yScale.max = viewport.yMax;
  }
}

function sampleY(x: number): number {
  return Math.sin(x * 0.004) * 0.62 + Math.sin(x * 0.00037) * 0.28 + (noise01(x) - 0.5) * 0.04;
}

function noise01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function collectBrowserEnvironment(): BrowserEnvironment {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
  const webglVendor = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : gl ? String(gl.getParameter(gl.VENDOR)) : null;
  const webglRenderer = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : gl ? String(gl.getParameter(gl.RENDERER)) : null;
  const webglVersion = gl ? String(gl.getParameter(gl.VERSION)) : null;

  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: navigator.deviceMemory,
    screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    webglVendor,
    webglRenderer,
    webglVersion,
    headlessUserAgent: /HeadlessChrome/i.test(navigator.userAgent),
  };
}

function snapshot(): ReturnType<BenchmarkController["snapshot"]> {
  return { state, progress, result, error };
}

function renderStatus(message: string): void {
  if (!statusTarget) return;
  statusTarget.textContent = [
    "BlazePlot comparison benchmark",
    `state: ${state}`,
    `progress: ${(progress * 100).toFixed(1)}%`,
    `canvas: ${canvasSize.width}x${canvasSize.height}`,
    `setup warmup runs: ${setupWarmupRuns}`,
    `libraries: ${selectedLibraries.join(", ")}`,
    `scenarios: ${selectedScenarioNames.join(", ")}`,
    `message: ${message}`,
    error ? `error: ${error}` : "",
  ].filter(Boolean).join("\n");
}

function readPositiveIntegerParam(name: string, fallback: number): number {
  const raw = params.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && Math.floor(value) === value ? value : fallback;
}

function readOptionalPositiveIntegerParam(name: string): number | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && Math.floor(value) === value ? value : undefined;
}

function readHeapBytes(): number | null {
  return performance.memory?.usedJSHeapSize ?? null;
}

async function collectGarbage(): Promise<void> {
  window.gc?.();
  await settleFrames(1);
}

function summarize(values: readonly number[]): NumericSummary {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: round(sorted[0] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    avg: round(sum(sorted) / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function animationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function settleFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await animationFrame();
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
