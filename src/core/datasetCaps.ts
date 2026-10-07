/**
 * Optional dataset abilities (append, update, gaps, bulk copy, min/max, Y origin), detected once when a
 * series is created, plus the small helpers that apply them. Internal to the series modules.
 */
import type { MinMaxOut } from "./MinMaxTree.js";
import type { Dataset, AppendableDataset, YAppendableDataset, UpdatableDataset, YUpdatableDataset, OhlcDataset, XRangeDataset, RangeMinMaxDataset, RangeSampleCopyDataset, VisibleSampleCopyDataset, VisiblePointCopyDataset, MinMaxSegmentCopyDataset, SampleCopyLayout, Viewport } from "./types.js";

export function isOhlcDataset(dataset: Dataset): dataset is OhlcDataset {
  return "getOpen" in dataset && "getHigh" in dataset && "getLow" in dataset && "getClose" in dataset;
}

export interface AppendableOhlcDataset extends OhlcDataset {
  append(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
  ): void;
  updateAt?(index: number, open: number, high: number, low: number, close: number): boolean;
}

export function hasAppendXY(dataset: Dataset): dataset is AppendableDataset {
  return "push" in dataset && "append" in dataset;
}

export function hasAppendY(dataset: Dataset): dataset is YAppendableDataset {
  return "appendY" in dataset;
}

export function hasOhlcAppend(dataset: Dataset): dataset is AppendableOhlcDataset {
  return isOhlcDataset(dataset) && "append" in dataset;
}

export function hasUpdate(dataset: Dataset): dataset is UpdatableDataset {
  return typeof (dataset as Partial<UpdatableDataset>).update === "function";
}

export function hasUpdateY(dataset: Dataset): dataset is YUpdatableDataset {
  return typeof (dataset as Partial<YUpdatableDataset>).updateY === "function";
}

/** Built-in datasets that bulk-read raw X/Y (gap = non-finite Y) into Float64 arrays. */
export interface XYRangeReader extends Dataset {
  readXYRange(start: number, end: number, xOut: Float64Array, yOut: Float64Array): void;
}

/** Dataset with an explicit per-index gap predicate. */
export type GapDataset = Dataset & { isGap(index: number): boolean };

/** Built-in datasets: `rangeMinMaxY` that writes into `out` and returns whether the range holds a finite value. */
export interface RangeMinMaxIntoDataset extends RangeMinMaxDataset {
  rangeMinMaxInto(start: number, end: number, out: MinMaxOut): boolean;
}

/**
 * Built-in datasets backed by a `MinMaxTree`: Y extents of consecutive buckets in one call plus an
 * unchecked X read, so the dense min/max loop makes no per-bucket dataset calls.
 */
export interface MinMaxBucketDataset extends Dataset {
  /** Extents (`minOut`/`maxOut`, `Infinity`/`-Infinity` when empty) of `count` buckets of `width` samples from logical `first`, clamped to `[0, length)`. */
  minMaxBucketsInto(first: number, width: number, count: number, minOut: Float64Array, maxOut: Float64Array): void;
  /** X at a logical index known to be valid (no range check). */
  xAtUnchecked(index: number): number;
}

/**
 * Optional dataset abilities, detected once when the series is created. A dataset's capabilities are
 * fixed for its lifetime: methods added to a dataset after construction are not picked up.
 */
export interface DatasetCaps {
  readonly gaps: GapDataset | null;
  readonly readXY: XYRangeReader | null;
  readonly ohlc: OhlcDataset | null;
  readonly xRange: XRangeDataset | null;
  readonly rangeMinMax: RangeMinMaxDataset | null;
  /** Built-in datasets also answer `rangeMinMax` into a caller-owned slot, so bucket loops allocate nothing. */
  readonly rangeMinMaxInto: RangeMinMaxIntoDataset | null;
  readonly minMaxBuckets: MinMaxBucketDataset | null;
  readonly minMaxSegments: MinMaxSegmentCopyDataset | null;
  readonly copyVisibleSamples: VisibleSampleCopyDataset | null;
  readonly copySamplesRange: RangeSampleCopyDataset | null;
  readonly copyVisiblePoints: VisiblePointCopyDataset | null;
}

/**
 * Built-in datasets set this and accept a trailing `yOrigin` argument on their copy methods, so Y is
 * shifted in float64 before the float32 render-buffer write. Custom datasets keep the public
 * signatures and are shifted in place after the copy.
 */
export interface YOriginDataset {
  readonly supportsYOrigin: true;
  copySamplesRange(start: number, end: number, target: Float32Array, maxPoints: number, layout: SampleCopyLayout, baseline: number, xOrigin: number, yOrigin: number): number;
  copyVisibleSamples(viewport: Viewport, target: Float32Array, maxPoints: number, layout: SampleCopyLayout, baseline: number, xOrigin: number, yOrigin: number): number;
  copyMinMaxSegments(viewport: Viewport, target: Float32Array, maxSegments: number, xOrigin: number, yOrigin: number): number;
}

export function honorsYOrigin<T extends Dataset>(dataset: T): dataset is T & YOriginDataset {
  return (dataset as Partial<YOriginDataset>).supportsYOrigin === true;
}

export const POINT_Y_OFFSETS: readonly number[] = [1];
export const AREA_Y_OFFSETS: readonly number[] = [1, 3];
export const MINMAX_Y_OFFSETS: readonly number[] = [1, 2];

/** Subtract `yOrigin` from the Y components of `count` packed samples (best effort, after the float32 write). */
export function shiftY(target: Float32Array, count: number, floatsPerSample: number, offsets: readonly number[], yOrigin: number): void {
  if (yOrigin === 0) return;
  for (let i = 0; i < count; i++) {
    for (const offset of offsets) target[i * floatsPerSample + offset]! -= yOrigin;
  }
}

export function resolveCaps(dataset: Dataset): DatasetCaps {
  return Object.freeze({
    readXY: typeof (dataset as Partial<XYRangeReader>).readXYRange === "function" ? (dataset as XYRangeReader) : null,
    gaps: typeof dataset.isGap === "function" ? (dataset as GapDataset) : null,
    ohlc: isOhlcDataset(dataset) ? dataset : null,
    xRange: "getXRange" in dataset ? (dataset as XRangeDataset) : null,
    rangeMinMax: "rangeMinMaxY" in dataset ? (dataset as RangeMinMaxDataset) : null,
    rangeMinMaxInto: "rangeMinMaxInto" in dataset ? (dataset as RangeMinMaxIntoDataset) : null,
    minMaxBuckets: "minMaxBucketsInto" in dataset ? (dataset as MinMaxBucketDataset) : null,
    minMaxSegments: "copyMinMaxSegments" in dataset ? (dataset as MinMaxSegmentCopyDataset) : null,
    copyVisibleSamples: "copyVisibleSamples" in dataset ? (dataset as VisibleSampleCopyDataset) : null,
    copySamplesRange: "copySamplesRange" in dataset ? (dataset as RangeSampleCopyDataset) : null,
    copyVisiblePoints: "copyVisiblePoints" in dataset ? (dataset as VisiblePointCopyDataset) : null,
  });
}

/** Error for a series call the backing dataset does not support: `"<call> requires <requirement>."`. */
export function unsupported(call: string, requirement: string): TypeError {
  return new TypeError(`${call} requires ${requirement}.`);
}
