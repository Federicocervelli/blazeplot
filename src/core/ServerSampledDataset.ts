import type { Dataset, MinMaxSegmentCopyDataset, MinMaxSegmentLayout, RangeMinMaxDataset, SampleCopyLayout, TimeRange, Viewport } from "./types.js";

function stableBucketWidth(length: number, range: TimeRange | null, viewport: Viewport, maxBuckets: number): number {
  const budget = Math.max(1, maxBuckets);
  const xSpan = viewport.xMax - viewport.xMin;
  if (!range || length <= 1 || !(xSpan > 0)) return 1;
  const dataSpan = range.end - range.start;
  if (!(dataSpan > 0)) return Math.max(1, Math.ceil(length / budget));
  const estimatedVisibleSamples = Math.max(1, (xSpan / dataSpan) * (length - 1) + 1);
  return Math.max(1, Math.ceil(estimatedVisibleSamples / budget));
}

export interface ServerSampledPoints {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

export interface ServerSampledBuckets {
  readonly xStart: ArrayLike<number>;
  readonly xEnd: ArrayLike<number>;
  readonly minY: ArrayLike<number>;
  readonly maxY: ArrayLike<number>;
}

export type ServerSampledData =
  | ({ readonly kind: "points" } & ServerSampledPoints)
  | ({ readonly kind: "minmax" } & ServerSampledBuckets);

export type ServerSampledDatasetKind = "points" | "minmax";

/**
 * Mutable dataset for viewport samples that were already reduced by a server.
 * Use point data with `downsample: "none"`, or min/max buckets with
 * `downsample: "server"` so BlazePlot renders the supplied buckets directly
 * instead of applying another client-side sampler.
 */
export class ServerSampledDataset implements Dataset, RangeMinMaxDataset, MinMaxSegmentCopyDataset {
  private kind: ServerSampledDatasetKind = "points";
  private x = new Float64Array(0);
  private y = new Float32Array(0);
  private xStart = new Float64Array(0);
  private xEnd = new Float64Array(0);
  private minY = new Float32Array(0);
  private maxY = new Float32Array(0);

  constructor(data?: ServerSampledData) {
    if (data) this.replace(data);
  }

  get sampleKind(): ServerSampledDatasetKind {
    return this.kind;
  }

  get length(): number {
    return this.kind === "points" ? this.x.length : this.xStart.length;
  }

  get range(): TimeRange | null {
    if (this.length === 0) return null;
    return this.kind === "points"
      ? { start: this.x[0]!, end: this.x[this.x.length - 1]! }
      : { start: this.xStart[0]!, end: this.xEnd[this.xEnd.length - 1]! };
  }

  replace(data: ServerSampledData): void {
    if (data.kind === "points") this.replacePoints(data);
    else this.replaceBuckets(data);
  }

  replacePoints(data: ServerSampledPoints): void {
    const length = Math.min(data.x.length, data.y.length);
    this.kind = "points";
    this.x = Float64Array.from(sliceArrayLike(data.x, length));
    this.y = Float32Array.from(sliceArrayLike(data.y, length));
    this.xStart = new Float64Array(0);
    this.xEnd = new Float64Array(0);
    this.minY = new Float32Array(0);
    this.maxY = new Float32Array(0);
  }

  replaceBuckets(data: ServerSampledBuckets): void {
    const length = Math.min(data.xStart.length, data.xEnd.length, data.minY.length, data.maxY.length);
    this.kind = "minmax";
    this.xStart = Float64Array.from(sliceArrayLike(data.xStart, length));
    this.xEnd = Float64Array.from(sliceArrayLike(data.xEnd, length));
    this.minY = Float32Array.from(sliceArrayLike(data.minY, length));
    this.maxY = Float32Array.from(sliceArrayLike(data.maxY, length));
    this.x = new Float64Array(0);
    this.y = new Float32Array(0);
  }

  clear(): void {
    this.replacePoints({ x: [], y: [] });
  }

  getX(index: number): number {
    this.assertIndex(index);
    return this.kind === "points" ? this.x[index]! : (this.xStart[index]! + this.xEnd[index]!) * 0.5;
  }

  getY(index: number): number {
    this.assertIndex(index);
    return this.kind === "points" ? this.y[index]! : (this.minY[index]! + this.maxY[index]!) * 0.5;
  }

  isGap(index: number): boolean {
    if (this.kind === "points") return !Number.isFinite(this.getY(index));
    this.assertIndex(index);
    return !Number.isFinite(this.minY[index]!) || !Number.isFinite(this.maxY[index]!);
  }

  lowerBoundX(value: number): number {
    const values = this.kind === "points" ? this.x : this.xEnd;
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (values[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  upperBoundX(value: number): number {
    const values = this.kind === "points" ? this.x : this.xStart;
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (values[mid]! <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    if (to <= from) return null;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const lo = this.kind === "points" ? this.y[i]! : this.minY[i]!;
      const hi = this.kind === "points" ? lo : this.maxY[i]!;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      minY = Math.min(minY, lo, hi);
      maxY = Math.max(maxY, lo, hi);
    }
    return Number.isFinite(minY) && Number.isFinite(maxY) ? { minY, maxY } : null;
  }

  copySamplesRange(start: number, end: number, target: Float32Array, maxPoints: number, layout: SampleCopyLayout, baseline: number, xOrigin: number): number {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    const count = Math.min(maxPoints, Math.max(0, to - from));
    const stride = Math.max(1, Math.ceil(Math.max(0, to - from) / Math.max(1, count)));
    const floats = layout === "points" ? 2 : 4;
    if (count <= 0 || target.length < count * floats) return 0;

    let written = 0;
    for (let index = from; index < to && written < count; index += stride) {
      const x = this.getX(index) - xOrigin;
      const y = this.getY(index);
      const gap = this.isGap(index);
      const offset = written * floats;
      if (layout === "points") {
        target[offset] = gap ? NaN : x;
        target[offset + 1] = gap ? NaN : y;
      } else {
        target[offset] = gap ? NaN : x;
        target[offset + 1] = gap ? NaN : baseline;
        target[offset + 2] = gap ? NaN : x;
        target[offset + 3] = gap ? NaN : y;
      }
      written++;
    }
    return written;
  }

  copyMinMaxSegments(viewport: Viewport, target: Float32Array, maxSegments: number, layout: MinMaxSegmentLayout, xOrigin: number): number {
    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = Math.max(0, end - start);
    const count = Math.min(maxSegments, visible);
    const floats = layout === "line-list" ? 4 : 3;
    if (count <= 0 || target.length < count * floats) return 0;

    const bucketWidth = stableBucketWidth(this.length, this.range, viewport, maxSegments);
    const alignedStart = Math.floor(start / bucketWidth) * bucketWidth;

    let written = 0;
    for (let bucketStart = alignedStart; bucketStart < end && written < count; bucketStart += bucketWidth) {
      const segmentStart = Math.max(0, bucketStart);
      const segmentEnd = Math.min(this.length, bucketStart + bucketWidth);
      if (segmentEnd <= start || segmentStart >= end) continue;

      const range = this.rangeMinMaxY(segmentStart, segmentEnd);
      if (!range) continue;
      const x = this.bucketX(segmentStart, segmentEnd) - xOrigin;
      if (layout === "line-list") {
        const offset = written * 4;
        target[offset] = x;
        target[offset + 1] = range.minY;
        target[offset + 2] = x;
        target[offset + 3] = range.maxY;
      } else {
        const offset = written * 3;
        target[offset] = x;
        target[offset + 1] = range.minY;
        target[offset + 2] = range.maxY;
      }
      written++;
    }

    return written;
  }

  private bucketX(start: number, end: number): number {
    if (this.kind === "points") return this.getX(start + ((end - start) >> 1));
    return (this.xStart[start]! + this.xEnd[Math.max(start, end - 1)]!) * 0.5;
  }

  private assertIndex(index: number): void {
    if (index < 0 || index >= this.length) throw new RangeError(`ServerSampledDataset index out of range: ${index}`);
  }
}

function sliceArrayLike(values: ArrayLike<number>, length: number): number[] {
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) out[i] = values[i] ?? NaN;
  return out;
}
