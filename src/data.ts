import type { SeriesMode, SeriesYAxis, Viewport } from "./core/types.js";
import type { SeriesStore } from "./core/SeriesStore.js";
import type { Chart, ChartSeriesState } from "./ui/Chart.js";
import type { SelectionState } from "./ui/Selection.js";

export interface ChartDataSample {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
}

export interface ChartDataSeries {
  readonly seriesIndex: number;
  readonly id?: string;
  readonly name?: string;
  readonly mode: SeriesMode;
  readonly yAxis: SeriesYAxis;
  readonly samples: readonly ChartDataSample[];
  readonly total: number;
  readonly truncated: boolean;
}

export type ChartDataSource = "all" | "visible" | "selection";

export interface ChartDataExport {
  readonly source: ChartDataSource;
  readonly bounds: Viewport | null;
  readonly series: readonly ChartDataSeries[];
}

export interface ChartDataExportOptions {
  /** Limit export to visible chart series. Defaults to true. */
  readonly visibleOnly?: boolean;
  /** Limit export to specific series stores. */
  readonly series?: readonly SeriesStore[];
  /** Maximum rows to keep per series. Omit for no per-series cap. */
  readonly maxRowsPerSeries?: number;
  /** For visible exports, also require samples to overlap each series' y viewport. */
  readonly includeYRange?: boolean;
}

export interface ChartDataCsvOptions {
  readonly header?: boolean;
  readonly delimiter?: string;
  readonly newline?: string;
}

export interface ChartDataJsonOptions {
  readonly space?: number | string;
}

interface DataRange {
  readonly source: ChartDataSource;
  readonly bounds: Viewport | null;
  readonly mode?: SelectionState["mode"];
  readonly yAxis?: SeriesYAxis;
}

export interface XYSample {
  readonly x: number;
  readonly y: number;
}

export type SampleReducer = "mean" | "sum" | "min" | "max" | "first" | "last";
export type ResampleX = "start" | "center" | "end";

export interface ResampleOptions {
  readonly reducer?: SampleReducer;
  readonly align?: number;
  readonly x?: ResampleX;
}

export interface BinnedSample extends XYSample {
  readonly xStart: number;
  readonly xEnd: number;
  readonly count: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface RollingMeanSample extends XYSample {
  readonly count: number;
}

interface MutableBin {
  key: number;
  xStart: number;
  xEnd: number;
  count: number;
  sumY: number;
  minY: number;
  maxY: number;
  firstY: number;
  lastY: number;
}

const CSV_COLUMNS = [
  "seriesIndex",
  "seriesId",
  "seriesName",
  "mode",
  "yAxis",
  "index",
  "x",
  "y",
  "open",
  "high",
  "low",
  "close",
] as const;

/** Collect raw samples from each chart series in its current x viewport. */
export function exportVisibleChartData(chart: Chart, options: ChartDataExportOptions = {}): ChartDataExport {
  return collectChartData(chart, {
    source: "visible",
    bounds: mergeChartViewports(chart),
  }, options);
}

/** Collect raw samples inside a committed selection plugin state. */
export function exportSelectedChartData(
  chart: Chart,
  selection: SelectionState | null,
  options: ChartDataExportOptions = {},
): ChartDataExport {
  if (!selection) return { source: "selection", bounds: null, series: [] };
  return collectChartData(chart, {
    source: "selection",
    bounds: selection.bounds,
    mode: selection.mode,
    yAxis: selection.yAxis,
  }, options);
}

/** Collect all raw samples from chart series, optionally constrained by options.series and visibleOnly. */
export function exportAllChartData(chart: Chart, options: ChartDataExportOptions = {}): ChartDataExport {
  return collectChartData(chart, { source: "all", bounds: null }, options);
}

/** Serialize collected chart data as row-oriented CSV. */
export function chartDataToCSV(data: ChartDataExport, options: ChartDataCsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  const newline = options.newline ?? "\n";
  const rows: string[] = [];
  if (options.header !== false) rows.push(CSV_COLUMNS.join(delimiter));

  for (const series of data.series) {
    for (const sample of series.samples) {
      rows.push([
        series.seriesIndex,
        series.id ?? "",
        series.name ?? "",
        series.mode,
        series.yAxis,
        sample.index,
        sample.x,
        sample.y,
        sample.open ?? "",
        sample.high ?? "",
        sample.low ?? "",
        sample.close ?? "",
      ].map((value) => csvCell(value, delimiter, newline)).join(delimiter));
    }
  }

  return rows.join(newline);
}

/** Serialize collected chart data as JSON without retaining chart or SeriesStore objects. */
export function chartDataToJSON(data: ChartDataExport, options: ChartDataJsonOptions = {}): string {
  return JSON.stringify(data, null, options.space);
}

/** Convert collected chart data to a text Blob for downloads or clipboard workflows. */
export function chartDataToBlob(data: ChartDataExport, type: "csv" | "json", options: ChartDataCsvOptions | ChartDataJsonOptions = {}): Blob {
  if (type === "json") {
    return new Blob([chartDataToJSON(data, options as ChartDataJsonOptions)], { type: "application/json" });
  }
  return new Blob([chartDataToCSV(data, options as ChartDataCsvOptions)], { type: "text/csv" });
}

/** Bin irregular x/y samples into fixed-width x buckets. Non-finite samples are skipped. */
export function binSamples(samples: readonly XYSample[], binSize: number, options: ResampleOptions = {}): BinnedSample[] {
  if (!Number.isFinite(binSize) || binSize <= 0) {
    throw new RangeError("binSize must be a positive finite number.");
  }

  const align = Number.isFinite(options.align) ? options.align! : 0;
  const bins = new Map<number, MutableBin>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    const key = Math.floor((sample.x - align) / binSize);
    const existing = bins.get(key);
    if (existing) {
      existing.count++;
      existing.sumY += sample.y;
      existing.minY = Math.min(existing.minY, sample.y);
      existing.maxY = Math.max(existing.maxY, sample.y);
      existing.lastY = sample.y;
    } else {
      bins.set(key, {
        key,
        xStart: align + key * binSize,
        xEnd: align + (key + 1) * binSize,
        count: 1,
        sumY: sample.y,
        minY: sample.y,
        maxY: sample.y,
        firstY: sample.y,
        lastY: sample.y,
      });
    }
  }

  const reducer = options.reducer ?? "mean";
  const xMode = options.x ?? "center";
  return Array.from(bins.values())
    .sort((a, b) => a.key - b.key)
    .map((bin) => ({
      x: resampledX(bin, xMode),
      y: reducedY(bin, reducer),
      xStart: bin.xStart,
      xEnd: bin.xEnd,
      count: bin.count,
      minY: bin.minY,
      maxY: bin.maxY,
    }));
}

/** Alias for binSamples when you want one representative sample per fixed x interval. */
export function resampleSamples(samples: readonly XYSample[], interval: number, options: ResampleOptions = {}): BinnedSample[] {
  return binSamples(samples, interval, options);
}

/** Rolling mean over the previous windowSize samples, preserving each input x coordinate. */
export function rollingMean(samples: readonly XYSample[], windowSize: number): RollingMeanSample[] {
  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    throw new RangeError("windowSize must be a positive integer.");
  }

  const output: RollingMeanSample[] = [];
  const window: number[] = [];
  let sum = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    window.push(sample.y);
    sum += sample.y;
    if (window.length > windowSize) sum -= window.shift()!;
    output.push({ x: sample.x, y: sum / window.length, count: window.length });
  }
  return output;
}

function collectChartData(chart: Chart, range: DataRange, options: ChartDataExportOptions): ChartDataExport {
  const visibleOnly = options.visibleOnly !== false;
  const maxRows = normalizeMaxRows(options.maxRowsPerSeries);
  const allowedSeries = options.series ? new Set(options.series) : null;
  const series: ChartDataSeries[] = [];

  for (const state of chart.getSeriesState()) {
    if (visibleOnly && !state.visible) continue;
    if (allowedSeries && !allowedSeries.has(state.series)) continue;
    if (range.source === "selection" && range.mode !== "x-range" && state.yAxis !== range.yAxis) continue;

    const viewport = viewportForState(chart, state, range);
    const includeY = shouldFilterY(range, options);
    const entry = collectSeriesData(state, viewport, includeY, maxRows);
    if (entry.total > 0 || entry.samples.length > 0) series.push(entry);
  }

  return { source: range.source, bounds: range.bounds, series };
}

function collectSeriesData(state: ChartSeriesState, viewport: Viewport | null, includeY: boolean, maxRows: number): ChartDataSeries {
  const range = state.series.visibleIndexRange(viewport ?? undefined);
  const samples: ChartDataSample[] = [];
  let total = 0;

  if (state.mode === "ohlc" || state.mode === "candlestick") {
    for (let index = range.start; index < range.end; index++) {
      const sample = state.series.ohlcAt(index);
      if (!sample) continue;
      if (includeY && viewport && !sampleOverlapsY(sample, viewport)) continue;
      total++;
      if (samples.length < maxRows) samples.push({
        index: sample.index,
        x: sample.x,
        y: sample.y,
        open: sample.open,
        high: sample.high,
        low: sample.low,
        close: sample.close,
      });
    }
  } else {
    for (let index = range.start; index < range.end; index++) {
      const sample = state.series.sampleAt(index);
      if (!sample) continue;
      if (includeY && viewport && !sampleOverlapsY(sample, viewport)) continue;
      total++;
      if (samples.length < maxRows) samples.push({ index: sample.index, x: sample.x, y: sample.y });
    }
  }

  return {
    seriesIndex: state.index,
    id: state.id,
    name: state.name,
    mode: state.mode,
    yAxis: state.yAxis,
    samples,
    total,
    truncated: total > samples.length,
  };
}

function viewportForState(chart: Chart, state: ChartSeriesState, range: DataRange): Viewport | null {
  if (range.source === "all") return null;
  if (range.source === "selection") return range.bounds;
  return chart.getViewport(state.yAxis);
}

function shouldFilterY(range: DataRange, options: ChartDataExportOptions): boolean {
  if (range.source === "selection") return range.mode !== "x-range";
  return options.includeYRange === true;
}

function sampleOverlapsY(sample: Pick<ChartDataSample, "y" | "low" | "high">, viewport: Viewport): boolean {
  const low = sample.low ?? sample.y;
  const high = sample.high ?? sample.y;
  return high >= viewport.yMin && low <= viewport.yMax;
}

function mergeChartViewports(chart: Chart): Viewport {
  const left = chart.getViewport("left");
  const right = chart.getViewport("right");
  return {
    xMin: Math.min(left.xMin, right.xMin),
    xMax: Math.max(left.xMax, right.xMax),
    yMin: Math.min(left.yMin, right.yMin),
    yMax: Math.max(left.yMax, right.yMax),
  };
}

function normalizeMaxRows(value: number | undefined): number {
  if (value === undefined) return Infinity;
  if (!Number.isFinite(value)) return value > 0 ? Infinity : 0;
  return Math.max(0, Math.floor(value));
}

function csvCell(value: string | number, delimiter: string, newline: string): string {
  const text = String(value);
  return text.includes(delimiter) || text.includes("\"") || text.includes("\n") || text.includes("\r") || (newline !== "\n" && text.includes(newline))
    ? `"${text.replaceAll("\"", "\"\"")}"`
    : text;
}

function reducedY(bin: MutableBin, reducer: SampleReducer): number {
  switch (reducer) {
    case "sum":
      return bin.sumY;
    case "min":
      return bin.minY;
    case "max":
      return bin.maxY;
    case "first":
      return bin.firstY;
    case "last":
      return bin.lastY;
    default:
      return bin.sumY / bin.count;
  }
}

function resampledX(bin: MutableBin, mode: ResampleX): number {
  switch (mode) {
    case "start":
      return bin.xStart;
    case "end":
      return bin.xEnd;
    default:
      return (bin.xStart + bin.xEnd) * 0.5;
  }
}
