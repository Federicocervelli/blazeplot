/** Visible data-domain bounds for one chart camera. */
export interface Viewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** Min/max aggregate for a contiguous X range. */
export interface LODBucket {
  readonly xStart: number;
  readonly xEnd: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Renderer-ready level-of-detail bucket buffer. */
export interface LODView {
  readonly buckets: Float32Array;
  readonly bucketCount: number;
  readonly level: number;
  readonly samplesPerPixel: number;
}

/** Inclusive data X range. */
export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

/** Visual styling shared by built-in series renderers. */
export interface SeriesStyle {
  readonly color: readonly [number, number, number, number];
  readonly lineWidth: number;
  readonly pointSize?: number;
  readonly barWidth?: number;
  readonly baseline?: number;
  readonly fillColor?: readonly [number, number, number, number];
  readonly tickWidth?: number;
  readonly upColor?: readonly [number, number, number, number];
  readonly downColor?: readonly [number, number, number, number];
  readonly wickColor?: readonly [number, number, number, number];
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
  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null;
}

/** Vertex layout requested when copying raw samples into a render buffer. */
export type SampleCopyLayout = "points" | "area";
/** Vertex layout requested when copying min/max segments into a render buffer. */
export type MinMaxSegmentLayout = "line-list" | "instanced";

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
 * analytic/procedural envelopes to emit renderer-ready min/max buckets.
 */
export interface MinMaxSegmentCopyDataset extends Dataset {
  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    layout: MinMaxSegmentLayout,
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
