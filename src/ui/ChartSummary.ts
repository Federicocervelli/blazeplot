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
export function buildChartSummary(series: readonly SeriesStore[], format: SummaryValueFormatter, messages: ChartSummaryMessages = DEFAULT_SUMMARY_MESSAGES): ChartSummary {
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
      name: store.config.name ?? store.config.id ?? messages.seriesName(store.config.mode, index),
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
  return { series: summaries, x, text: summaryText(summaries, x, format, messages) };
}

/**
 * Strings and formatters behind the generated chart summary. Override any key through
 * `accessibility.messages.summary`; unset keys keep the English default.
 */
export interface ChartSummaryMessages {
  /** Text when the chart has no series. */
  readonly noSeries: string;
  /** Opening sentence. `mode` is the single shared series mode, or `null` when modes are mixed. */
  readonly intro: (mode: SeriesMode | null, seriesCount: number) => string;
  readonly xRange: (from: string, to: string) => string;
  /** Mode word used when a chart mixes series modes. */
  readonly modeName: (mode: SeriesMode) => string;
  readonly hidden: string;
  readonly points: (count: number) => string;
  readonly valueRange: (from: string, to: string) => string;
  readonly latest: (y: string, x: string) => string;
  /** One series line from its name and facts. */
  readonly seriesLine: (name: string, facts: readonly string[]) => string;
  readonly moreSeries: (count: number) => string;
  /** Fallback series name when it has neither `name` nor `id`. */
  readonly seriesName: (mode: SeriesMode, index: number) => string;
}

/** Create the default English summary messages, counting with `Intl.NumberFormat(locale)`. */
export function createSummaryMessages(locale?: string | readonly string[], overrides: Partial<ChartSummaryMessages> = {}): ChartSummaryMessages {
  const count = (value: number): string => formatCount(value, locale);
  const plural = (value: number, singular: string, pluralForm: string = `${singular}s`): string =>
    `${count(value)} ${value === 1 ? singular : pluralForm}`;
  return {
    noSeries: "Chart with no data series.",
    intro: (mode, seriesCount) => `${mode ? `${capitalize(modeName(mode))} chart` : "Chart"} with ${plural(seriesCount, "series", "series")}.`,
    xRange: (from, to) => `X from ${from} to ${to}.`,
    modeName,
    hidden: "hidden",
    points: (value) => plural(value, "point"),
    valueRange: (from, to) => `values from ${from} to ${to}`,
    latest: (y, x) => `latest ${y} at ${x}`,
    seriesLine: (name, facts) => `${name}: ${facts.join(", ")}.`,
    moreSeries: (value) => `And ${plural(value, "more series", "more series")}.`,
    seriesName: (mode, index) => `${mode} ${index + 1}`,
    ...overrides,
  };
}

/** @internal Format an integer count for `locale` (the runtime default when omitted). */
export function formatCount(value: number, locale?: string | readonly string[]): string {
  try {
    return value.toLocaleString(locale as string | string[] | undefined);
  } catch {
    return value.toLocaleString("en-US");
  }
}

const DEFAULT_SUMMARY_MESSAGES: ChartSummaryMessages = createSummaryMessages("en-US");

function summaryText(series: readonly ChartSeriesSummary[], x: ChartSummaryRange | null, format: SummaryValueFormatter, messages: ChartSummaryMessages): string {
  if (series.length === 0) return messages.noSeries;
  const modes = new Set(series.map((item) => item.mode));
  const parts = [messages.intro(modes.size === 1 ? series[0]!.mode : null, series.length)];
  if (x) parts.push(messages.xRange(format(x.min, "x", "left"), format(x.max, "x", "left")));
  for (const item of series.slice(0, MAX_DESCRIBED_SERIES)) {
    const facts: string[] = [];
    if (modes.size > 1) facts.push(messages.modeName(item.mode));
    if (!item.visible) facts.push(messages.hidden);
    facts.push(messages.points(item.sampleCount));
    if (item.y) facts.push(messages.valueRange(format(item.y.min, "y", item.yAxis), format(item.y.max, "y", item.yAxis)));
    if (item.latest) facts.push(messages.latest(format(item.latest.y, "y", item.yAxis), format(item.latest.x, "x", item.yAxis)));
    parts.push(messages.seriesLine(item.name, facts));
  }
  if (series.length > MAX_DESCRIBED_SERIES) parts.push(messages.moreSeries(series.length - MAX_DESCRIBED_SERIES));
  return parts.join(" ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
