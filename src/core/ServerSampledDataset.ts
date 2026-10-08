import type { MinMaxY } from "./MinMaxTree.js";
import { lowerBoundTyped, upperBoundTyped } from "./search.js";
import type { Dataset, MinMaxSegmentCopyDataset, RangeMinMaxDataset, SampleCopyLayout, TimeRange, Viewport, XRange, XRangeDataset } from "./types.js";
import { assertEqualLengths, assertSortedFiniteX } from "./validation.js";

const SERVER_HINT = "Sort server samples by X and drop non-finite X before passing them.";

/** Server-provided point samples. */
export interface ServerSampledPoints {
  readonly kind: "points";
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

/** Server-provided min/max buckets, each covering `[xStart, xEnd]`. */
export interface ServerSampledBuckets {
  readonly kind: "minmax";
  readonly xStart: ArrayLike<number>;
  readonly xEnd: ArrayLike<number>;
  readonly minY: ArrayLike<number>;
  readonly maxY: ArrayLike<number>;
}

/** Data accepted by `ServerSampledDataset` and `series.replace(...)`. */
export type ServerSampledData = ServerSampledPoints | ServerSampledBuckets;

function copyFloat64(values: ArrayLike<number>, length: number): Float64Array {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = values[i] ?? NaN;
  return out;
}

function copyFloat32(values: ArrayLike<number>, length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = values[i] ?? NaN;
  return out;
}

/**
 * Mutable dataset for viewport samples that were already reduced by a server.
 * Use point data with `downsample: "none"`, or min/max buckets with
 * `downsample: "server"` so BlazePlot renders the supplied buckets directly
 * instead of applying another client-side sampler. Swap in fresh data after
 * each fetch with `series.replace(data)`.
 *
 * Point X, bucket `xStart`, and bucket `xEnd` must each be finite and non-decreasing, and
 * every bucket needs `xEnd >= xStart` (buckets may overlap). The constructor and `replace`
 * throw a `RangeError` naming the first bad index and keep the current data.
 */
export class ServerSampledDataset implements Dataset, RangeMinMaxDataset, MinMaxSegmentCopyDataset, XRangeDataset {
  readonly rangeMinMaxExcludesGaps = true;
  private _kind: ServerSampledData["kind"] = "points";
  /** Point X values, or bucket centers. */
  private x: Float64Array = new Float64Array(0);
  /** Point Y values (empty for buckets). */
  private y: Float32Array = new Float32Array(0);
  private xStart: Float64Array = new Float64Array(0);
  private xEnd: Float64Array = new Float64Array(0);
  private minY: Float32Array = new Float32Array(0);
  private maxY: Float32Array = new Float32Array(0);

  /** Create a dataset, optionally seeded with server-sampled points or buckets. */
  constructor(data?: ServerSampledData) {
    if (data) this.replace(data);
  }

  /** Whether the dataset currently holds `"points"` or `"minmax"` buckets. */
  get kind(): ServerSampledData["kind"] {
    return this._kind;
  }

  /** Number of server-sampled points or buckets. */
  get length(): number {
    return this.x.length;
  }

  /** X range covered by samples, or `null` when empty. */
  get range(): TimeRange | null {
    const length = this.length;
    if (length === 0) return null;
    return this._kind === "points"
      ? { start: this.x[0]!, end: this.x[length - 1]! }
      : { start: this.xStart[0]!, end: this.xEnd[length - 1]! };
  }

  /** Replace all samples with point or bucket data. Throws a `RangeError` for non-finite or decreasing X. */
  replace(data: ServerSampledData): void {
    if (data.kind === "points") {
      assertEqualLengths("ServerSampledDataset.replace", { x: data.x, y: data.y });
      const length = data.x.length;
      assertSortedFiniteX("ServerSampledDataset", data.x, length, SERVER_HINT);
      this._kind = data.kind;
      this.x = copyFloat64(data.x, length);
      this.y = copyFloat32(data.y, length);
      this.xStart = this.xEnd = new Float64Array(0);
      this.minY = this.maxY = new Float32Array(0);
      return;
    }

    assertEqualLengths("ServerSampledDataset.replace", { xStart: data.xStart, xEnd: data.xEnd, minY: data.minY, maxY: data.maxY });
    const length = data.xStart.length;
    assertSortedFiniteX("ServerSampledDataset xStart", data.xStart, length, SERVER_HINT, "bucket");
    assertSortedFiniteX("ServerSampledDataset xEnd", data.xEnd, length, SERVER_HINT, "bucket");
    for (let i = 0; i < length; i++) {
      if (data.xEnd[i]! < data.xStart[i]!) {
        throw new RangeError(
          `ServerSampledDataset: bucket ${i} ends at ${data.xEnd[i]} before it starts at ${data.xStart[i]} (inverted-bucket). Each bucket needs xEnd >= xStart.`,
        );
      }
    }
    this._kind = data.kind;
    this.xStart = copyFloat64(data.xStart, length);
    this.xEnd = copyFloat64(data.xEnd, length);
    this.minY = copyFloat32(data.minY, length);
    this.maxY = copyFloat32(data.maxY, length);
    this.x = new Float64Array(length);
    for (let i = 0; i < length; i++) this.x[i] = (this.xStart[i]! + this.xEnd[i]!) * 0.5;
    this.y = new Float32Array(0);
  }

  /** Remove all samples. */
  clear(): void {
    this.replace({ kind: "points", x: [], y: [] });
  }

  /** Return the X value (bucket center for min/max data) at a logical index. */
  getX(index: number): number {
    this.assertIndex(index);
    return this.x[index]!;
  }

  /** Return the Y value, or the bucket midpoint for min/max data. */
  getY(index: number): number {
    this.assertIndex(index);
    return this._kind === "points" ? this.y[index]! : (this.minY[index]! + this.maxY[index]!) * 0.5;
  }

  /** Return the X interval a min/max bucket covers; `null` for point data. */
  getXRange(index: number): XRange | null {
    if (this._kind === "points" || index < 0 || index >= this.length) return null;
    return { xStart: this.xStart[index]!, xEnd: this.xEnd[index]! };
  }

  /** Return whether the sample should be rendered as a gap. */
  isGap(index: number): boolean {
    this.assertIndex(index);
    return this._kind === "points"
      ? !Number.isFinite(this.y[index]!)
      : !Number.isFinite(this.minY[index]!) || !Number.isFinite(this.maxY[index]!);
  }

  /** Return the first index whose sample (or bucket end) reaches `value`. */
  lowerBoundX(value: number): number {
    const edges = this._kind === "points" ? this.x : this.xEnd;
    return lowerBoundTyped(edges, edges.length, value);
  }

  /** Return the first index whose sample (or bucket start) is past `value`. */
  upperBoundX(value: number): number {
    const edges = this._kind === "points" ? this.x : this.xStart;
    return upperBoundTyped(edges, edges.length, value);
  }

  /** Return min/max Y values for a logical index range. */
  rangeMinMaxY(start: number, end: number): MinMaxY | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    const low = this._kind === "points" ? this.y : this.minY;
    const high = this._kind === "points" ? this.y : this.maxY;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const lo = low[i]!;
      const hi = high[i]!;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      if (lo < minY) minY = lo;
      if (hi > maxY) maxY = hi;
    }
    return minY <= maxY ? { minY, maxY } : null;
  }

  /** @internal Copy methods accept a trailing `yOrigin` that is subtracted in float64 before the render-buffer write. */
  readonly supportsYOrigin = true;

  /** Copy sampled points for a logical range into a render buffer, striding when the range exceeds `maxPoints`. */
  copySamplesRange(start: number, end: number, target: Float32Array, maxPoints: number, layout: SampleCopyLayout, baseline: number, xOrigin: number, yOrigin: number = 0): number {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    const count = Math.min(maxPoints, Math.max(0, to - from));
    const stride = Math.max(1, Math.ceil(Math.max(0, to - from) / Math.max(1, count)));
    const floats = layout === "points" ? 2 : 4;
    if (count <= 0 || target.length < count * floats) return 0;

    let written = 0;
    for (let index = from; index < to && written < count; index += stride) {
      const gap = this.isGap(index);
      const x = gap ? NaN : this.x[index]! - xOrigin;
      const y = gap ? NaN : this.getY(index) - yOrigin;
      const offset = written * floats;
      if (layout === "points") {
        target[offset] = x;
        target[offset + 1] = y;
      } else {
        target[offset] = x;
        target[offset + 1] = gap ? NaN : baseline - yOrigin;
        target[offset + 2] = x;
        target[offset + 3] = y;
      }
      written++;
    }
    return written;
  }

  /** Copy `[x, minY, maxY]` buckets for a viewport, merging neighbors when more than `maxSegments` are visible. */
  copyMinMaxSegments(viewport: Viewport, target: Float32Array, maxSegments: number, xOrigin: number, yOrigin: number = 0): number {
    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const limit = Math.min(Math.floor(maxSegments), Math.floor(target.length / 3));
    if (end <= start || limit <= 0) return 0;

    // Buckets are anchored to multiples of their width, so the first one starts at or before `start` and the
    // visible range can span one bucket more than the budget. Widen until every overlapping bucket fits,
    // otherwise the newest (rightmost) bucket would be the one dropped.
    let bucketWidth = this.stableBucketWidth(viewport, limit);
    while (bucketWidth < end && Math.ceil((end - Math.floor(start / bucketWidth) * bucketWidth) / bucketWidth) > limit) bucketWidth++;
    const alignedStart = Math.floor(start / bucketWidth) * bucketWidth;

    let written = 0;
    for (let bucketStart = alignedStart; bucketStart < end && written < limit; bucketStart += bucketWidth) {
      const segmentStart = Math.max(0, bucketStart);
      const segmentEnd = Math.min(this.length, bucketStart + bucketWidth);
      if (segmentEnd <= start || segmentStart >= end) continue;

      const range = this.rangeMinMaxY(segmentStart, segmentEnd);
      if (!range) continue;
      const offset = written * 3;
      target[offset] = this.bucketX(segmentStart, segmentEnd) - xOrigin;
      target[offset + 1] = range.minY - yOrigin;
      target[offset + 2] = range.maxY - yOrigin;
      written++;
    }

    return written;
  }

  /** Samples per output bucket, anchored to data indexes so panning does not reshuffle buckets. */
  private stableBucketWidth(viewport: Viewport, maxBuckets: number): number {
    const budget = Math.max(1, maxBuckets);
    const xSpan = viewport.xMax - viewport.xMin;
    const range = this.range;
    if (!range || this.length <= 1 || !(xSpan > 0)) return 1;
    const dataSpan = range.end - range.start;
    if (!(dataSpan > 0)) return Math.max(1, Math.ceil(this.length / budget));
    const estimatedVisibleSamples = Math.max(1, (xSpan / dataSpan) * (this.length - 1) + 1);
    return Math.max(1, Math.ceil(estimatedVisibleSamples / budget));
  }

  private bucketX(start: number, end: number): number {
    if (this._kind === "points") return this.x[start + ((end - start) >> 1)]!;
    return (this.xStart[start]! + this.xEnd[Math.max(start, end - 1)]!) * 0.5;
  }

  private assertIndex(index: number): void {
    if (index < 0 || index >= this.length) throw new RangeError(`ServerSampledDataset index out of range: ${index}`);
  }
}
