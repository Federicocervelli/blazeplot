import type { SeriesStore } from "../core/SeriesStore.js";
import type { SeriesMode, SeriesSample, SeriesYAxis } from "../core/types.js";

/** Inclusive numeric range used by `ChartSummary`. */
export interface ChartSummaryRange {
  readonly min: number;
  readonly max: number;
}

/** Per-series facts in a `ChartSummary`. */
export interface ChartSeriesSummary {
  readonly index: number;
  readonly id?: string;
  /** `name`, else `id`, else `"<mode> <n>"`. */
  readonly name: string;
  readonly mode: SeriesMode;
  readonly visible: boolean;
  readonly yAxis: SeriesYAxis;
  readonly sampleCount: number;
  /** X range of the data, or `null` when the series is empty. */
  readonly x: ChartSummaryRange | null;
  /** Y range of the data (bars and areas include their baseline), or `null` when empty. */
  readonly y: ChartSummaryRange | null;
  /** Last non-gap sample, or `null` when empty. */
  readonly latest: SeriesSample | null;
}

/**
 * Data summary the chart exposes to assistive technology through `aria-describedby`.
 * Pass `accessibility.description` as a function to turn it into your own text.
 */
export interface ChartSummary {
  readonly series: readonly ChartSeriesSummary[];
  /** X range across visible series, or `null` when they hold no data. */
  readonly x: ChartSummaryRange | null;
  /** The default generated description. */
  readonly text: string;
}

/** @internal Formats a value like the axis tick labels for one axis. */
export type SummaryValueFormatter = (value: number, axis: "x" | "y", yAxis: SeriesYAxis) => string;

const MAX_DESCRIBED_SERIES = 20;
/** Samples scanned backwards from the end to skip trailing gaps when finding the latest value. */
const LATEST_SCAN_LIMIT = 64;

/** Series mode as worded in the summary text. */
function modeName(mode: SeriesMode): string {
  return mode === "ohlc" ? "OHLC" : mode;
}

/** @internal Name used for a series in summaries, legends, and announcements. */
export function seriesDisplayName(series: { readonly config: { readonly id?: string; readonly name?: string; readonly mode: SeriesMode } }, index: number): string {
  return series.config.name ?? series.config.id ?? `${series.config.mode} ${index + 1}`;
}

function latestSample(series: SeriesStore): SeriesSample | null {
  const last = series.length - 1;
  for (let index = last; index >= 0 && last - index < LATEST_SCAN_LIMIT; index--) {
    const sample = series.sampleAt(index);
    if (sample) return sample;
  }
  return null;
}

/**
 * @internal Build the chart summary from series state. Costs one `dataBounds()` per series
 * (logarithmic for built-in datasets), so callers throttle it instead of running it per frame.
 */
export function buildChartSummary(series: readonly SeriesStore[], format: SummaryValueFormatter): ChartSummary {
  const summaries: ChartSeriesSummary[] = [];
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let index = 0; index < series.length; index++) {
    const store = series[index]!;
    const bounds = store.length > 0 ? store.dataBounds() : null;
    const yAxis = store.config.yAxis ?? "left";
    if (bounds && store.visible) {
      xMin = Math.min(xMin, bounds.xMin);
      xMax = Math.max(xMax, bounds.xMax);
    }
    summaries.push({
      index,
      ...(store.config.id === undefined ? {} : { id: store.config.id }),
      name: seriesDisplayName(store, index),
      mode: store.config.mode,
      visible: store.visible,
      yAxis,
      sampleCount: store.length,
      x: bounds ? { min: bounds.xMin, max: bounds.xMax } : null,
      y: bounds ? { min: bounds.yMin, max: bounds.yMax } : null,
      latest: latestSample(store),
    });
  }
  const x = Number.isFinite(xMin) && Number.isFinite(xMax) ? { min: xMin, max: xMax } : null;
  return { series: summaries, x, text: summaryText(summaries, x, format) };
}

function plural(count: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

function summaryText(series: readonly ChartSeriesSummary[], x: ChartSummaryRange | null, format: SummaryValueFormatter): string {
  if (series.length === 0) return "Chart with no data series.";
  const modes = new Set(series.map((item) => item.mode));
  const kind = modes.size === 1 ? `${capitalize(modeName(series[0]!.mode))} chart` : "Chart";
  const parts = [`${kind} with ${plural(series.length, "series", "series")}.`];
  if (x) parts.push(`X from ${format(x.min, "x", "left")} to ${format(x.max, "x", "left")}.`);
  for (const item of series.slice(0, MAX_DESCRIBED_SERIES)) {
    const facts: string[] = [];
    if (modes.size > 1) facts.push(modeName(item.mode));
    if (!item.visible) facts.push("hidden");
    facts.push(plural(item.sampleCount, "point"));
    if (item.y) facts.push(`values from ${format(item.y.min, "y", item.yAxis)} to ${format(item.y.max, "y", item.yAxis)}`);
    if (item.latest) facts.push(`latest ${format(item.latest.y, "y", item.yAxis)} at ${format(item.latest.x, "x", item.yAxis)}`);
    parts.push(`${item.name}: ${facts.join(", ")}.`);
  }
  if (series.length > MAX_DESCRIBED_SERIES) parts.push(`And ${plural(series.length - MAX_DESCRIBED_SERIES, "more series", "more series")}.`);
  return parts.join(" ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
