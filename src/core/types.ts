/** Visible data-domain bounds for one chart camera. */
export interface Viewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** Inclusive data X range. */
export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

/** RGBA color tuple with 0-1 channel values. */
export type RgbaColor = readonly [number, number, number, number];
/** Any CSS color string (`"#3b82f6"`, `"rgb(59 130 246)"`, `"var(--accent)"`) or an RGBA tuple. */
export type ThemeColor = RgbaColor | string;

/** Series styling accepted by `chart.addLine(config, style)` and the other `add*` helpers. */
export interface SeriesStyleOptions {
  /** Stroke/marker color. Defaults to the next theme series color. */
  readonly color?: ThemeColor;
  /** Line width in CSS pixels for line, area outline, and OHLC series. Defaults to 1. */
  readonly lineWidth?: number;
  /** Scatter point diameter in device pixels. Defaults to 4. */
  readonly pointSize?: number;
  /** Bar and candlestick body width in data X units. Defaults to 0.8. */
  readonly barWidth?: number;
  /** Y value bars and areas grow from. Defaults to 0. */
  readonly baseline?: number;
  /** Area fill color. Defaults to `color` at 25% opacity. */
  readonly fillColor?: ThemeColor;
  /** OHLC open/close tick width in data X units. Defaults to `barWidth`. */
  readonly tickWidth?: number;
  /** Color for rising OHLC/candlestick samples. Defaults to `color`. */
  readonly upColor?: ThemeColor;
  /** Color for falling OHLC/candlestick samples. Defaults to `color` at 45% opacity. */
  readonly downColor?: ThemeColor;
  /** Candlestick wick color. Defaults to `color`. */
  readonly wickColor?: ThemeColor;
}

/** Fully resolved series style used by the renderer. */
export interface SeriesStyle {
  readonly color: RgbaColor;
  readonly lineWidth: number;
  readonly pointSize: number;
  readonly barWidth: number;
  readonly baseline: number;
  readonly fillColor: RgbaColor;
  readonly tickWidth: number;
  readonly upColor: RgbaColor;
  readonly downColor: RgbaColor;
  readonly wickColor: RgbaColor;
}

/** Built-in renderer mode for a series. */
export type SeriesMode = "line" | "area" | "envelope" | "scatter" | "bar" | "ohlc" | "candlestick";
/** Y axis used to scale and render a series. */
export type SeriesYAxis = "left" | "right";

/** Sorted XY data source consumed by chart series. */
export interface Dataset {
  readonly length: number;
  readonly range: TimeRange | null;
  getX(index: number): number;
  getY(index: number): number;
  /**
   * Optional explicit missing-data marker. Gap samples are skipped by picks and
   * break line/area strips on both sides. X values must remain sorted even when
   * a sample is marked as a gap.
   */
  isGap?(index: number): boolean;
  lowerBoundX(x: number): number;
  upperBoundX(x: number): number;
  /** Drop cached summaries; called by `series.markDirty()` after the data was mutated in place. */
  invalidate?(): void;
}

/** Data-domain X interval represented by one dataset sample. */
export interface XRange {
  readonly xStart: number;
  readonly xEnd: number;
}

/** Dataset whose sample X values represent intervals rather than points. */
export interface XRangeDataset extends Dataset {
  getXRange(index: number): XRange | null;
}

/** Dataset that can answer min/max Y queries for index ranges. */
export interface RangeMinMaxDataset extends Dataset {
  /** Set when range queries exclude samples marked by `isGap()`. */
  readonly rangeMinMaxExcludesGaps?: boolean;
  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null;
}

/**
 * Vertex layout requested when copying raw samples into a render buffer:
 * `"points"` writes `[x, y]` pairs, `"area"` writes `[x, baseline, x, y]` strip pairs.
 */
export type SampleCopyLayout = "points" | "area";

/**
 * Optional high-performance extraction capability for datasets that can copy raw
 * samples without going through repeated getX/getY calls. Implement this for
 * very large datasets, implicit-X datasets, or remote/memory-mapped sources.
 */
export interface RangeSampleCopyDataset extends Dataset {
  copySamplesRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number;
}

/**
 * Optional high-performance stable visible sampling capability. Unlike
 * copySamplesRange, this method may stride/downsample, but should choose samples
 * anchored to data coordinates so streamed appends do not make existing sampled
 * points jitter.
 */
export interface VisibleSampleCopyDataset extends Dataset {
  copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number;
}

/**
 * Optional high-performance extraction capability for point/scatter datasets.
 * Implementations should cull against the full 2D viewport and may sample in
 * screen space so dense point clouds respond to both X and Y zoom.
 */
export interface VisiblePointCopyDataset extends Dataset {
  copyVisiblePoints(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
    pixelWidth: number,
    pixelHeight: number,
    pointSize: number,
  ): number;
}

/**
 * Optional high-performance min/max extraction capability for dense rendering.
 * Implementations can use pyramids, segment trees, database aggregates, or
 * analytic/procedural envelopes. Write up to `maxSegments` `[x - xOrigin, minY, maxY]`
 * triples into `target` and return how many were written.
 */
export interface MinMaxSegmentCopyDataset extends Dataset {
  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    xOrigin: number,
  ): number;
}

/**
 * Convenience contract for maximum-performance custom datasets. Implement this
 * when a dataset can provide fast exact sample copies, stable viewport sampling,
 * range min/max queries, and renderer-ready min/max buckets.
 */
export interface AcceleratedDataset extends
  Dataset,
  RangeMinMaxDataset,
  RangeSampleCopyDataset,
  VisibleSampleCopyDataset,
  MinMaxSegmentCopyDataset {}

/** Dataset that provides open, high, low, and close values per sample. */
export interface OhlcDataset extends Dataset {
  getOpen(index: number): number;
  getHigh(index: number): number;
  getLow(index: number): number;
  getClose(index: number): number;
}

/** Dataset that accepts appended X/Y samples; implementations may store X values explicitly or use them to seed implicit X spacing. */
export interface AppendableDataset extends Dataset {
  push(x: number, y: number): void;
  append(x: ArrayLike<number>, y: ArrayLike<number>): void;
  clear(): void;
}

/** Dataset that accepts appended Y samples with implicit X values. */
export interface YAppendableDataset extends Dataset {
  appendY(y: ArrayLike<number>): void;
  clear(): void;
}

/** Dataset that supports updating existing X/Y samples. */
export interface UpdatableDataset extends Dataset {
  update(index: number, x: number, y: number): boolean;
}

/** Dataset that supports updating existing Y values. */
export interface YUpdatableDataset extends Dataset {
  updateY(index: number, y: number): boolean;
}

/** Downsampling strategy used when a series is denser than the plot. */
export type LODStrategy = "minmax" | "none" | "server";
/** Behavior when a fixed-capacity streaming buffer is full. */
export type BufferOverflowStrategy = "wrap" | "drop-new" | "error";

/** One data sample returned by picking and dataset queries. */
export interface SeriesSample {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly distancePx?: number;
}

/** Configuration for adding a series to a chart. */
export interface SeriesConfig {
  readonly mode: SeriesMode;
  readonly capacity?: number;
  /**
   * Optional X value for the first sample when BlazePlot creates an implicit-X
   * dataset for this series. Only used when `dataset` is omitted and `xStep` is
   * provided.
   */
  readonly xStart?: number;
  /**
   * Optional fixed X spacing for live streams. When `dataset` is omitted,
   * `{ capacity, xStep }` creates a `UniformRingBuffer`, so callers can append
   * with `series.append({ y })` without manually constructing a dataset.
   */
  readonly xStep?: number;
  readonly downsample?: LODStrategy;
  readonly overflow?: BufferOverflowStrategy;
  readonly dataset?: Dataset;
  readonly yAxis?: SeriesYAxis;
  readonly id?: string;
  readonly name?: string;
}
