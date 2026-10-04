import { MinMaxTree } from "./MinMaxTree.js";
import type { MinMaxY } from "./MinMaxTree.js";
import { createValueArray } from "./valueArray.js";
import type { AcceleratedDataset, AppendableDataset, SampleCopyLayout, TimeRange, ValuePrecision, Viewport } from "./types.js";

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

/** Options for implicit-X streaming buffers. */
export interface UniformRingBufferOptions {
  /** X value for the first appended sample. Defaults to 0. */
  readonly xStart?: number;
  /** Distance between consecutive X values. Defaults to 1. */
  readonly xStep?: number;
  /** Y storage. Defaults to `"float32"`; use `"float64"` to keep large values exact. */
  readonly valuePrecision?: ValuePrecision;
}

/**
 * High-throughput ring buffer for uniformly spaced X values.
 *
 * Store only Y samples and derive X as `xStart + index * xStep`. This is the
 * fastest built-in dataset for live telemetry, signals, and other fixed-rate
 * streams because appends copy a single typed array and min/max extraction uses
 * a block segment tree over the physical ring.
 */
export class UniformRingBuffer implements AppendableDataset, AcceleratedDataset {
  /** Maximum number of retained samples. */
  readonly capacity: number;
  readonly rangeMinMaxExcludesGaps = true;
  /** Distance between consecutive derived X values. */
  readonly xStep: number;
  private readonly yData: Float32Array | Float64Array;
  private readonly tree: MinMaxTree;
  private _length = 0;
  private _head = 0;
  private _nextX: number;

  /** Create an implicit-X ring buffer with fixed spacing. */
  constructor(capacity: number, options: UniformRingBufferOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("UniformRingBuffer capacity must be a positive integer.");
    }

    const xStep = options.xStep ?? 1;
    if (!Number.isFinite(xStep) || xStep <= 0) {
      throw new RangeError("UniformRingBuffer xStep must be a positive finite number.");
    }

    this.capacity = capacity;
    this.xStep = xStep;
    this._nextX = options.xStart ?? 0;
    this.yData = createValueArray(capacity, options.valuePrecision);
    this.tree = new MinMaxTree(this.yData, capacity);
  }

  /** Number of retained samples. */
  get length(): number {
    return this._length;
  }

  /** X range covered by retained samples, or `null` when empty. */
  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.firstX(), end: this.getX(this._length - 1) };
  }

  /** Append one sample, using `x` to seed the stream when empty. */
  push(x: number, y: number): void {
    if (this._length === 0 && Number.isFinite(x)) this._nextX = x;
    const physical = this._head;
    this.yData[physical] = y;
    this._head = (physical + 1) % this.capacity;
    if (this._length < this.capacity) {
      this._length++;
      this.tree.include(physical, this.yData[physical]!);
    } else {
      this.tree.update(physical, physical + 1);
    }
    this._nextX += this.xStep;
  }

  /**
   * Append Y samples. X is derived as `xStart + index * xStep`, so `x` is only read to seed
   * the stream: its first value when the buffer is empty, or the first retained value when
   * a batch replaces the whole buffer. Otherwise `x` is ignored and X continues from the
   * previous sample, even if the passed values differ; use `RingBuffer` for irregular X.
   */
  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    const requested = Math.min(x.length, y.length);
    if (requested <= 0) return;

    if (this._length === 0) {
      const first = x[0];
      if (Number.isFinite(first)) this._nextX = first!;
    }

    if (requested >= this.capacity) {
      const sourceOffset = requested - this.capacity;
      const retainedFirst = x[sourceOffset];
      const hasRetainedFirst = Number.isFinite(retainedFirst);
      if (hasRetainedFirst) this._nextX = retainedFirst!;
      this.replaceAll(y, sourceOffset, hasRetainedFirst ? this.capacity : requested);
      return;
    }

    this.appendValues(y, 0, requested);
  }

  /** Append Y samples using the next derived X values. */
  appendY(y: ArrayLike<number>): void {
    const requested = y.length;
    if (requested <= 0) return;

    if (requested >= this.capacity) {
      this.replaceAll(y, requested - this.capacity, requested);
      return;
    }

    this.appendValues(y, 0, requested);
  }

  /** Remove all retained samples. */
  clear(): void {
    this._length = 0;
    this._head = 0;
    this.tree.reset();
  }

  /** Replace the Y value at a logical index. */
  updateY(index: number, y: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const physical = this.logicalToPhysical(index);
    this.yData[physical] = y;
    this.tree.update(physical, physical + 1, this.validEnd());
    return true;
  }

  /** Return the derived X value at a logical index. */
  getX(index: number): number {
    this.assertValidIndex(index);
    return this.firstX() + index * this.xStep;
  }

  /** Return the Y value at a logical index. */
  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
  }

  /** Return whether the sample should be rendered as a gap. */
  isGap(index: number): boolean {
    return !Number.isFinite(this.getY(index));
  }

  /** Return the first logical index whose derived X value is at least `x`. */
  lowerBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.ceil((x - this.firstX()) / this.xStep)));
  }

  /** Return the first logical index whose derived X value is greater than `x`. */
  upperBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.floor((x - this.firstX()) / this.xStep) + 1));
  }

  /** Return min/max Y values for a logical index range. */
  rangeMinMaxY(start: number, end: number): MinMaxY | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    if (to <= from) return null;
    return this.tree.queryRing(this.logicalToPhysical(from), to - from);
  }

  /** Ordinal of logical index 0 on the X grid, so `ordinalOffset + index` is stable while the buffer wraps. */
  get ordinalOffset(): number {
    return Math.round(this.firstX() / this.xStep);
  }

  /** Copy visible samples into a packed render buffer. */
  copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    if (end <= start) return 0;

    const viewportSamples = Math.max(1, Math.ceil((viewport.xMax - viewport.xMin) / this.xStep));
    const stride = Math.max(1, Math.ceil(viewportSamples / maxPoints));
    const remainder = positiveModulo(this.ordinalOffset + start, stride);
    const alignedStart = start + positiveModulo(-remainder, stride);
    return this.copyStridedSamples(alignedStart, end, stride, target, maxPoints, layout, baseline, xOrigin);
  }

  /** Copy a logical sample range into a packed render buffer. */
  copySamplesRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    return this.copyStridedSamples(Math.max(0, Math.floor(start)), Math.min(this._length, Math.ceil(end)), 1, target, maxPoints, layout, baseline, xOrigin);
  }

  /** Copy `[x, minY, maxY]` buckets anchored to absolute sample ordinals, so streaming does not jitter them. */
  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    xOrigin: number,
  ): number {
    if (maxSegments <= 0 || target.length < maxSegments * 3) return 0;

    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const viewportSamples = Math.max(1, Math.ceil((viewport.xMax - viewport.xMin) / this.xStep) + 1);
    const stride = Math.max(1, Math.ceil(viewportSamples / maxSegments));
    const alignedStart = start - positiveModulo(this.ordinalOffset + start, stride);

    let written = 0;
    for (let bucketStart = alignedStart; bucketStart < end && written < maxSegments; bucketStart += stride) {
      const segmentStart = Math.max(0, bucketStart);
      const segmentEnd = Math.min(this._length, bucketStart + stride);
      if (segmentEnd <= start || segmentStart >= end) continue;

      const range = this.rangeMinMaxY(segmentStart, segmentEnd);
      if (!range) continue;

      const representative = Math.max(segmentStart, Math.min(segmentEnd - 1, bucketStart + (stride >> 1)));
      const offset = written * 3;
      target[offset] = this.firstX() + representative * this.xStep - xOrigin;
      target[offset + 1] = range.minY;
      target[offset + 2] = range.maxY;
      written++;
    }

    return written;
  }

  private replaceAll(y: ArrayLike<number>, sourceOffset: number, requested: number): void {
    for (let i = 0; i < this.capacity; i++) this.yData[i] = y[sourceOffset + i]!;
    this._head = 0;
    this._length = this.capacity;
    this._nextX += requested * this.xStep;
    this.tree.update(0, this.capacity);
  }

  private appendValues(y: ArrayLike<number>, sourceOffset: number, count: number): void {
    let nextSourceOffset = sourceOffset;
    let remaining = count;
    while (remaining > 0) {
      const chunkCount = Math.min(remaining, this.capacity - this._head);
      for (let i = 0; i < chunkCount; i++) this.yData[this._head + i] = y[nextSourceOffset + i]!;
      this._length = Math.min(this.capacity, this._length + chunkCount);
      this.tree.update(this._head, this._head + chunkCount, this.validEnd());
      this._head = (this._head + chunkCount) % this.capacity;
      nextSourceOffset += chunkCount;
      remaining -= chunkCount;
    }

    this._nextX += count * this.xStep;
  }

  private copyStridedSamples(
    from: number,
    to: number,
    stride: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const firstX = this.firstX();
    let count = 0;
    let lastIndex = -1;
    let lastWasGap = false;
    const writeGap = (): boolean => {
      if (count === 0 || lastWasGap) return true;
      if (count >= maxPoints) return false;
      const offset = count * floatsPerSample;
      for (let j = 0; j < floatsPerSample; j++) target[offset + j] = NaN;
      count++;
      lastWasGap = true;
      return true;
    };
    const writeSample = (index: number): boolean => {
      const y = this.yData[this.logicalToPhysical(index)]!;
      if (!Number.isFinite(y)) return writeGap();
      if (count >= maxPoints) return false;
      const offset = count * floatsPerSample;
      const x = firstX + index * this.xStep - xOrigin;
      if (layout === "points") {
        target[offset] = x;
        target[offset + 1] = y;
      } else {
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = y;
      }
      count++;
      lastWasGap = false;
      return true;
    };

    for (let index = from; index < to; index += stride) {
      if (lastIndex >= 0 && index > lastIndex + 1 && this.hasGapInLogicalRange(lastIndex + 1, index) && !writeGap()) break;
      if (!writeSample(index)) break;
      lastIndex = index;
    }

    return count;
  }

  private hasGapInLogicalRange(start: number, end: number): boolean {
    const from = Math.max(0, start);
    const to = Math.min(this._length, end);
    for (let i = from; i < to; i++) {
      if (!Number.isFinite(this.yData[this.logicalToPhysical(i)]!)) return true;
    }
    return false;
  }

  /** Physical samples below this index hold live data; the ring fills from index 0. */
  private validEnd(): number {
    return this._length === this.capacity ? this.capacity : this._length;
  }

  private firstX(): number {
    return this._nextX - this._length * this.xStep;
  }

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private isValidIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this._length;
  }

  private assertValidIndex(index: number): void {
    if (!this.isValidIndex(index)) {
      throw new RangeError(`UniformRingBuffer index out of range: ${index}`);
    }
  }

}
