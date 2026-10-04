import type { SeriesMode, SeriesYAxis, Viewport } from "./core/types.js";
import type { SeriesStore } from "./core/SeriesStore.js";
import type { Chart, ChartSeriesState } from "./ui/Chart.js";
import type { SelectionState } from "./ui/Selection.js";

/** Exported representation of one chart data sample. */
export interface ChartDataSample {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
}

/** Exported samples and metadata for one chart series. */
export interface ChartDataSeries {
  readonly seriesIndex: number;
  readonly id?: string;
  readonly name?: string;
  readonly mode: SeriesMode;
  readonly yAxis: SeriesYAxis;
  readonly samples: readonly ChartDataSample[];
  /** Matching samples before `maxRowsPerSeries` truncation. */
  readonly total: number;
  readonly truncated: boolean;
}

/** Which samples an export covered. */
export type ChartDataSource = "all" | "visible" | "selection";

/** Chart data collected for serialization or custom processing. Plain data: safe to `JSON.stringify`. */
export interface ChartDataExport {
  readonly source: ChartDataSource;
  readonly bounds: Viewport | null;
  readonly series: readonly ChartDataSeries[];
}

/** Options for `exportChartData`. */
export interface ChartDataExportOptions {
  /**
   * Samples to collect: `"all"` (default), `"visible"` for the current viewport,
   * or a selection plugin state (`selection.getSelection()`); a `null` selection exports nothing.
   */
  readonly range?: "all" | "visible" | SelectionState | null;
  /** Include hidden series. Defaults to false. */
  readonly includeHidden?: boolean;
  /** Limit export to specific series. */
  readonly series?: readonly SeriesStore[];
  /** Maximum rows to keep per series. Omit for no cap. */
  readonly maxRowsPerSeries?: number;
  /** For `"visible"` exports, also require samples to overlap each series' Y viewport. */
  readonly includeYRange?: boolean;
}

/** CSV serialization options for chart data exports. */
export interface ChartDataCsvOptions {
  readonly header?: boolean;
  readonly delimiter?: string;
  readonly newline?: string;
  /**
   * Prefix text cells that start with `=`, `+`, `-`, `@`, tab, or carriage return with `'`, so
   * spreadsheet apps show series ids and names as text instead of running them as formulas.
   * Numeric cells are never changed. Defaults to true.
   */
  readonly escapeFormulas?: boolean;
}

/** Simple X/Y sample used by data resampling helpers. */
export interface XYSample {
  readonly x: number;
  readonly y: number;
}

/** Reducer used when multiple samples fall into one output bucket. */
export type SampleReducer = "mean" | "sum" | "min" | "max" | "first" | "last";
/** X position assigned to a resampled bucket. */
export type ResampleX = "start" | "center" | "end";

/** Options for `binSamples`. */
export interface ResampleOptions {
  /** How to combine Y values in a bucket. Defaults to `"mean"`. */
  readonly reducer?: SampleReducer;
  /** Bucket origin; buckets are `[align + k * binSize, align + (k + 1) * binSize)`. Defaults to 0. */
  readonly align?: number;
  /** X reported for each bucket. Defaults to `"center"`. */
  readonly x?: ResampleX;
}

/** Output sample produced by fixed-width X binning. */
export interface BinnedSample extends XYSample {
  readonly xStart: number;
  readonly xEnd: number;
  readonly count: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Output sample produced by rolling mean smoothing. */
export interface RollingMeanSample extends XYSample {
  readonly count: number;
}

interface DataRange {
  readonly source: ChartDataSource;
  readonly bounds: Viewport | null;
  readonly selection?: SelectionState;
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

/** Chart-like object accepted by `exportChartData`: any `Chart`, or anything exposing these two methods. */
export type ExportableChart = Pick<Chart, "getSeriesState" | "getViewport">;

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

/** Collect raw samples from chart series: all of them, the visible viewport, or a selection. */
export function exportChartData(chart: ExportableChart, options: ChartDataExportOptions = {}): ChartDataExport {
  const range = options.range === undefined ? "all" : options.range;
  if (range === "all") return collectChartData(chart, { source: "all", bounds: null }, options);
  if (range === "visible") return collectChartData(chart, { source: "visible", bounds: mergeChartViewports(chart) }, options);
  if (range === null) return { source: "selection", bounds: null, series: [] };
  return collectChartData(chart, { source: "selection", bounds: range.bounds, selection: range }, options);
}

/** Serialize collected chart data as row-oriented CSV. */
export function chartDataToCSV(data: ChartDataExport, options: ChartDataCsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  const newline = options.newline ?? "\n";
  const escapeFormulas = options.escapeFormulas !== false;
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
      ].map((value) => csvCell(value, delimiter, newline, escapeFormulas)).join(delimiter));
    }
  }

  return rows.join(newline);
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

/** Rolling mean over the previous `windowSize` finite samples, preserving each input x coordinate. */
export function rollingMean(samples: readonly XYSample[], windowSize: number): RollingMeanSample[] {
  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    throw new RangeError("windowSize must be a positive integer.");
  }

  const output: RollingMeanSample[] = [];
  const window = new Float64Array(windowSize);
  let head = 0;
  let count = 0;
  let sum = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    if (count === windowSize) sum -= window[head]!;
    else count++;
    window[head] = sample.y;
    sum += sample.y;
    head = (head + 1) % windowSize;
    output.push({ x: sample.x, y: sum / count, count });
  }
  return output;
}

function collectChartData(chart: ExportableChart, range: DataRange, options: ChartDataExportOptions): ChartDataExport {
  const maxRows = normalizeMaxRows(options.maxRowsPerSeries);
  const allowedSeries = options.series ? new Set(options.series) : null;
  const selection = range.selection;
  const filterY = selection ? selection.mode !== "x-range" : range.source === "visible" && options.includeYRange === true;
  const series: ChartDataSeries[] = [];

  for (const state of chart.getSeriesState()) {
    if (!options.includeHidden && !state.visible) continue;
    if (allowedSeries && !allowedSeries.has(state.series)) continue;
    if (selection && selection.mode !== "x-range" && state.yAxis !== selection.yAxis) continue;

    const viewport = range.source === "all" ? null : selection ? selection.bounds : chart.getViewport(state.yAxis);
    const entry = collectSeriesData(state, viewport, filterY, maxRows);
    if (entry.total > 0) series.push(entry);
  }

  return { source: range.source, bounds: range.bounds, series };
}

function collectSeriesData(state: ChartSeriesState, viewport: Viewport | null, filterY: boolean, maxRows: number): ChartDataSeries {
  const range = state.series.visibleIndexRange(viewport ?? undefined);
  const ohlc = state.mode === "ohlc" || state.mode === "candlestick";
  const samples: ChartDataSample[] = [];
  let total = 0;

  for (let index = range.start; index < range.end; index++) {
    const sample = ohlc ? state.series.ohlcAt(index) : state.series.sampleAt(index);
    if (!sample) continue;
    if (filterY && viewport && !sampleOverlapsY(sample, viewport)) continue;
    total++;
    if (samples.length < maxRows) samples.push({ ...sample });
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

function sampleOverlapsY(sample: ChartDataSample, viewport: Viewport): boolean {
  const low = sample.low ?? sample.y;
  const high = sample.high ?? sample.y;
  return high >= viewport.yMin && low <= viewport.yMax;
}

function mergeChartViewports(chart: ExportableChart): Viewport {
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

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: string | number, delimiter: string, newline: string, escapeFormulas: boolean): string {
  const text = typeof value === "string" && escapeFormulas && FORMULA_PREFIX.test(value) ? `'${value}` : String(value);
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
