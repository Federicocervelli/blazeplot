export interface Viewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface LODBucket {
  readonly xStart: number;
  readonly xEnd: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface LODView {
  readonly buckets: Float32Array;
  readonly bucketCount: number;
  readonly level: number;
  readonly samplesPerPixel: number;
}

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

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

export type SeriesMode = "line" | "area" | "envelope" | "scatter" | "bar" | "ohlc" | "candlestick";
export type SeriesYAxis = "left" | "right";

export interface Dataset {
  readonly length: number;
  readonly range: TimeRange | null;
  getX(index: number): number;
  getY(index: number): number;
  lowerBoundX(x: number): number;
  upperBoundX(x: number): number;
}

export interface RangeMinMaxDataset extends Dataset {
  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null;
}

export type SampleCopyLayout = "points" | "area";
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

export interface OhlcDataset extends Dataset {
  getOpen(index: number): number;
  getHigh(index: number): number;
  getLow(index: number): number;
  getClose(index: number): number;
}

export interface AppendableDataset extends Dataset {
  push(x: number, y: number): void;
  append(x: ArrayLike<number>, y: ArrayLike<number>): void;
  clear(): void;
}

export interface YAppendableDataset extends Dataset {
  appendY(y: ArrayLike<number>): void;
  clear(): void;
}

export type LODStrategy = "minmax" | "none" | "server";
export type BufferOverflowStrategy = "wrap" | "drop-new" | "error";

export interface SeriesSample {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly distancePx?: number;
}

export interface SeriesConfig {
  readonly mode: SeriesMode;
  readonly capacity?: number;
  readonly downsample?: LODStrategy;
  readonly overflow?: BufferOverflowStrategy;
  readonly dataset?: Dataset;
  readonly yAxis?: SeriesYAxis;
  readonly id?: string;
  readonly name?: string;
}
