import type { AcceleratedDataset, AppendableDataset, MinMaxSegmentLayout, SampleCopyLayout, TimeRange, Viewport } from "./types.js";

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

export interface UniformRingBufferOptions {
  /** X value for the first appended sample. Defaults to 0. */
  readonly xStart?: number;
  /** Distance between consecutive X values. Defaults to 1. */
  readonly xStep?: number;
  /** Number of physical samples covered by each min/max tree leaf. Defaults to 64. */
  readonly blockSize?: number;
}

type SampleLayout = SampleCopyLayout;
type MinMaxLayout = MinMaxSegmentLayout;

/**
 * High-throughput ring buffer for uniformly spaced X values.
 *
 * Store only Y samples and derive X as `xStart + index * xStep`. This is the
 * fastest built-in dataset for live telemetry, signals, and other fixed-rate
 * streams because appends copy a single typed array and min/max extraction uses
 * a block segment tree over the physical ring.
 */
export class UniformRingBuffer implements AppendableDataset, AcceleratedDataset {
  readonly capacity: number;
  readonly xStep: number;
  private readonly blockSize: number;
  private readonly yData: Float32Array;
  private readonly blockMin: Float32Array;
  private readonly blockMax: Float32Array;
  private readonly blockTreeBase: number;
  private readonly minTree: Float32Array;
  private readonly maxTree: Float32Array;
  private _length = 0;
  private _head = 0;
  private _nextX: number;

  constructor(capacity: number, options: UniformRingBufferOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("UniformRingBuffer capacity must be a positive integer.");
    }

    const xStep = options.xStep ?? 1;
    if (!Number.isFinite(xStep) || xStep <= 0) {
      throw new RangeError("UniformRingBuffer xStep must be a positive finite number.");
    }

    const blockSize = options.blockSize ?? 64;
    if (!Number.isInteger(blockSize) || blockSize <= 0) {
      throw new RangeError("UniformRingBuffer blockSize must be a positive integer.");
    }

    this.capacity = capacity;
    this.xStep = xStep;
    this.blockSize = blockSize;
    this._nextX = options.xStart ?? 0;
    this.yData = new Float32Array(capacity);
    const blockCount = Math.ceil(capacity / this.blockSize);
    this.blockMin = new Float32Array(blockCount);
    this.blockMax = new Float32Array(blockCount);
    this.blockTreeBase = UniformRingBuffer.nextPowerOfTwo(blockCount);
    this.minTree = new Float32Array(this.blockTreeBase * 2);
    this.maxTree = new Float32Array(this.blockTreeBase * 2);
    this.blockMin.fill(Infinity);
    this.blockMax.fill(-Infinity);
    this.minTree.fill(Infinity);
    this.maxTree.fill(-Infinity);
  }

  get length(): number {
    return this._length;
  }

  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.firstX(), end: this.getX(this._length - 1) };
  }

  push(x: number, y: number): void {
    if (this._length === 0 && Number.isFinite(x)) this._nextX = x;
    this.appendY([y]);
  }

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

  appendY(y: ArrayLike<number>): void {
    const requested = y.length;
    if (requested <= 0) return;

    if (requested >= this.capacity) {
      this.replaceAll(y, requested - this.capacity, requested);
      return;
    }

    this.appendValues(y, 0, requested);
  }

  clear(): void {
    this._length = 0;
    this._head = 0;
    this.blockMin.fill(Infinity);
    this.blockMax.fill(-Infinity);
    this.minTree.fill(Infinity);
    this.maxTree.fill(-Infinity);
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.firstX() + index * this.xStep;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
  }

  isGap(index: number): boolean {
    return !Number.isFinite(this.getY(index));
  }

  lowerBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.ceil((x - this.firstX()) / this.xStep)));
  }

  upperBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.floor((x - this.firstX()) / this.xStep) + 1));
  }

  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    if (to <= from) return null;

    const physical = this.logicalToPhysical(from);
    const count = to - from;
    if (physical + count <= this.capacity) return this.queryPhysicalMinMax(physical, physical + count);

    const first = this.queryPhysicalMinMax(physical, this.capacity);
    const second = this.queryPhysicalMinMax(0, (physical + count) % this.capacity);
    if (!first) return second;
    if (!second) return first;
    return { minY: Math.min(first.minY, second.minY), maxY: Math.max(first.maxY, second.maxY) };
  }

  copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: SampleLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    if (end <= start) return 0;

    const viewportSamples = Math.max(1, Math.ceil((viewport.xMax - viewport.xMin) / this.xStep));
    const stride = Math.max(1, Math.ceil(viewportSamples / maxPoints));
    const firstOrdinal = Math.round(this.firstX() / this.xStep);
    const remainder = positiveModulo(firstOrdinal + start, stride);
    const alignedStart = start + positiveModulo(-remainder, stride);
    return this.copyStridedSamples(alignedStart, end, stride, target, maxPoints, layout, baseline, xOrigin);
  }

  copySamplesRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    return this.copyStridedSamples(Math.max(0, Math.floor(start)), Math.min(this._length, Math.ceil(end)), 1, target, maxPoints, layout, baseline, xOrigin);
  }

  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    layout: MinMaxLayout,
    xOrigin: number,
  ): number {
    const floatsPerSegment = layout === "line-list" ? 4 : 3;
    if (maxSegments <= 0 || target.length < maxSegments * floatsPerSegment) return 0;

    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const segmentCount = Math.min(maxSegments, visible);
    let written = 0;
    for (let segment = 0; segment < segmentCount; segment++) {
      const segmentStart = start + Math.floor((segment * visible) / segmentCount);
      const segmentEnd = Math.min(
        end,
        start + Math.max(
          Math.floor(((segment + 1) * visible) / segmentCount),
          Math.floor((segment * visible) / segmentCount) + 1,
        ),
      );
      const range = this.rangeMinMaxY(segmentStart, segmentEnd);
      if (!range) continue;

      const x = this.firstX() + (segmentStart + ((segmentEnd - segmentStart) >> 1)) * this.xStep - xOrigin;
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

  private replaceAll(y: ArrayLike<number>, sourceOffset: number, requested: number): void {
    for (let i = 0; i < this.capacity; i++) this.yData[i] = y[sourceOffset + i]!;
    this._head = 0;
    this._length = this.capacity;
    this._nextX += requested * this.xStep;
    this.recomputeAllBlocks();
  }

  private appendValues(y: ArrayLike<number>, sourceOffset: number, count: number): void {
    let nextSourceOffset = sourceOffset;
    let remaining = count;
    while (remaining > 0) {
      const chunkCount = Math.min(remaining, this.capacity - this._head);
      for (let i = 0; i < chunkCount; i++) this.yData[this._head + i] = y[nextSourceOffset + i]!;
      this._length = Math.min(this.capacity, this._length + chunkCount);
      this.recomputePhysicalBlockRange(this._head, this._head + chunkCount);
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
    layout: SampleLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const count = Math.min(maxPoints, Math.max(0, Math.ceil((to - from) / stride)));
    const firstX = this.firstX();

    if (layout === "points") {
      for (let i = 0, index = from; i < count; i++, index += stride) {
        const offset = i * 2;
        const y = this.yData[this.logicalToPhysical(index)]!;
        const gap = !Number.isFinite(y);
        target[offset] = gap ? NaN : firstX + index * this.xStep - xOrigin;
        target[offset + 1] = gap ? NaN : y;
      }
    } else {
      for (let i = 0, index = from; i < count; i++, index += stride) {
        const offset = i * 4;
        const x = firstX + index * this.xStep - xOrigin;
        const y = this.yData[this.logicalToPhysical(index)]!;
        const gap = !Number.isFinite(y);
        target[offset] = gap ? NaN : x;
        target[offset + 1] = gap ? NaN : baseline;
        target[offset + 2] = gap ? NaN : x;
        target[offset + 3] = gap ? NaN : y;
      }
    }

    return count;
  }

  private queryPhysicalMinMax(start: number, end: number): { minY: number; maxY: number } | null {
    let minY = Infinity;
    let maxY = -Infinity;
    let i = start;

    while (i < end && i % this.blockSize !== 0) {
      const value = this.yData[i]!;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
      i++;
    }

    const blockStart = i / this.blockSize;
    const blockEnd = Math.floor(end / this.blockSize);
    if (blockEnd > blockStart) {
      const blockRange = this.queryBlockMinMax(blockStart, blockEnd);
      if (blockRange) {
        if (blockRange.minY < minY) minY = blockRange.minY;
        if (blockRange.maxY > maxY) maxY = blockRange.maxY;
      }
      i = blockEnd * this.blockSize;
    }

    while (i < end) {
      const value = this.yData[i]!;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
      i++;
    }

    return Number.isFinite(minY) && Number.isFinite(maxY) ? { minY, maxY } : null;
  }

  private recomputePhysicalBlockRange(start: number, end: number): void {
    const firstBlock = Math.floor(start / this.blockSize);
    const lastBlock = Math.floor((end - 1) / this.blockSize);
    for (let block = firstBlock; block <= lastBlock; block++) this.recomputeBlock(block);
  }

  private recomputeAllBlocks(): void {
    for (let block = 0; block < this.blockMin.length; block++) this.recomputeBlock(block);
  }

  private recomputeBlock(block: number): void {
    const start = block * this.blockSize;
    const end = Math.min(this.capacity, start + this.blockSize);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = start; i < end; i++) {
      if (!this.isPhysicalValid(i)) continue;
      const value = this.yData[i]!;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
    this.blockMin[block] = minY;
    this.blockMax[block] = maxY;
    this.updateBlockTreeLeaf(block, minY, maxY);
  }

  private queryBlockMinMax(start: number, end: number): { minY: number; maxY: number } | null {
    let left = this.blockTreeBase + start;
    let right = this.blockTreeBase + end;
    let minY = Infinity;
    let maxY = -Infinity;
    while (left < right) {
      if (left & 1) {
        const yMin = this.minTree[left]!;
        const yMax = this.maxTree[left]!;
        if (yMin < minY) minY = yMin;
        if (yMax > maxY) maxY = yMax;
        left++;
      }
      if (right & 1) {
        right--;
        const yMin = this.minTree[right]!;
        const yMax = this.maxTree[right]!;
        if (yMin < minY) minY = yMin;
        if (yMax > maxY) maxY = yMax;
      }
      left >>= 1;
      right >>= 1;
    }
    return Number.isFinite(minY) && Number.isFinite(maxY) ? { minY, maxY } : null;
  }

  private updateBlockTreeLeaf(block: number, minY: number, maxY: number): void {
    let index = this.blockTreeBase + block;
    this.minTree[index] = minY;
    this.maxTree[index] = maxY;
    index >>= 1;
    while (index >= 1) {
      const left = index << 1;
      const right = left + 1;
      const leftMin = this.minTree[left]!;
      const rightMin = this.minTree[right]!;
      const leftMax = this.maxTree[left]!;
      const rightMax = this.maxTree[right]!;
      this.minTree[index] = leftMin < rightMin ? leftMin : rightMin;
      this.maxTree[index] = leftMax > rightMax ? leftMax : rightMax;
      index >>= 1;
    }
  }

  private isPhysicalValid(index: number): boolean {
    return this._length === this.capacity || index < this._length;
  }

  private firstX(): number {
    return this._nextX - this._length * this.xStep;
  }

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this._length) {
      throw new RangeError(`UniformRingBuffer index out of range: ${index}`);
    }
  }

  private static nextPowerOfTwo(value: number): number {
    return 2 ** Math.ceil(Math.log2(value));
  }
}
