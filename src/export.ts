import type { SeriesMode, SeriesYAxis, Viewport } from "./core/types.js";
import type { SeriesStore } from "./core/SeriesStore.js";
import type { Chart, ChartScreenshotOptions, ChartSeriesState } from "./ui/Chart.js";
import type { SelectionState } from "./ui/Selection.js";

/** Options for downloading a chart screenshot. */
export interface ChartDownloadOptions extends ChartScreenshotOptions {
  /** Defaults to `blazeplot.png` (or `.jpg`/`.webp` to match `type`). */
  readonly filename?: string;
}

/** Options for copying a chart screenshot to the clipboard. */
export interface ChartClipboardOptions extends ChartScreenshotOptions {
  /** Defaults to `navigator.clipboard`. */
  readonly clipboard?: Clipboard;
}

/**
 * Trigger a browser download for a blob. The link is attached to `doc` (default: the global
 * `document`); pass the chart's `ownerDocument` when it lives in an iframe or popup window.
 */
export function downloadBlob(blob: Blob, filename = "blazeplot.png", doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Capture a chart screenshot, download it, and return the created blob. */
export async function downloadChartScreenshot(chart: Chart, options: ChartDownloadOptions = {}): Promise<Blob> {
  const { filename = defaultScreenshotFilename(options.type), ...screenshotOptions } = options;
  const blob = await chart.screenshot(screenshotOptions);
  downloadBlob(blob, filename, chart.canvas.ownerDocument);
  return blob;
}

/** Capture a chart screenshot, copy it to the clipboard, and return the blob. */
export async function copyChartScreenshotToClipboard(chart: Chart, options: ChartClipboardOptions = {}): Promise<Blob> {
  const { clipboard, ...screenshotOptions } = options;
  const blob = await chart.screenshot(screenshotOptions);
  if (typeof ClipboardItem === "undefined") {
    throw new Error("ClipboardItem is not available in this browser.");
  }
  const target = clipboard ?? (typeof navigator === "undefined" ? undefined : navigator.clipboard);
  if (!target) throw new Error("Clipboard API is not available in this environment.");
  await target.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
  return blob;
}

function defaultScreenshotFilename(type: string | undefined): string {
  switch (type) {
    case "image/jpeg":
      return "blazeplot.jpg";
    case "image/webp":
      return "blazeplot.webp";
    default:
      return "blazeplot.png";
  }
}

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

interface DataRange {
  readonly source: ChartDataSource;
  readonly bounds: Viewport | null;
  readonly selection?: SelectionState;
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
export function chartDataToCsv(data: ChartDataExport, options: ChartDataCsvOptions = {}): string {
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
