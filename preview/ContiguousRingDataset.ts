import { PREVIEW_START_TIME, PREVIEW_X_STEP_MS } from "./dataConfig.ts";
import type { AcceleratedDataset, AppendableDataset, MinMaxSegmentLayout, SampleCopyLayout, TimeRange, Viewport } from "@/index.ts";

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

export interface ContiguousRingDatasetOptions {
  readonly blockSize?: number;
  readonly xStep?: number;
}

type SampleLayout = SampleCopyLayout;
type MinMaxLayout = MinMaxSegmentLayout;

export class ContiguousRingDataset implements AppendableDataset, AcceleratedDataset {
  readonly capacity: number;
  private readonly blockSize: number;
  private readonly xStep: number;
  private readonly yData: Float32Array;
  private readonly blockMin: Float32Array;
  private readonly blockMax: Float32Array;
  private readonly blockTreeBase: number;
  private readonly minTree: Float32Array;
  private readonly maxTree: Float32Array;
  private _length = 0;
  private _head = 0;
  private _nextX = 0;

  constructor(capacity: number, options: ContiguousRingDatasetOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("ContiguousRingDataset capacity must be a positive integer.");
    }

    this.capacity = capacity;
    this.blockSize = options.blockSize ?? 64;
    this.xStep = options.xStep ?? 1;
    this.yData = new Float32Array(capacity);
    const blockCount = Math.ceil(capacity / this.blockSize);
    this.blockMin = new Float32Array(blockCount);
    this.blockMax = new Float32Array(blockCount);
    this.blockTreeBase = ContiguousRingDataset.nextPowerOfTwo(blockCount);
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
    return { start: this.toTime(this.firstX()), end: this.getX(this._length - 1) };
  }

  push(_x: number, y: number): void {
    this.append({ length: 1 }, [y]);
  }

  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    const requested = Math.min(x.length, y.length);
    if (requested <= 0) return;

    if (requested >= this.capacity) {
      const sourceOffset = requested - this.capacity;
      for (let i = 0; i < this.capacity; i++) this.yData[i] = y[sourceOffset + i]!;
      this._head = 0;
      this._length = this.capacity;
      this._nextX += requested * this.xStep;
      this.recomputeAllBlocks();
      return;
    }

    let sourceOffset = 0;
    let remaining = requested;
    while (remaining > 0) {
      const chunkCount = Math.min(remaining, this.capacity - this._head);
      for (let i = 0; i < chunkCount; i++) this.yData[this._head + i] = y[sourceOffset + i]!;
      this._length = Math.min(this.capacity, this._length + chunkCount);
      this.recomputePhysicalBlockRange(this._head, this._head + chunkCount);
      this._head = (this._head + chunkCount) % this.capacity;
      sourceOffset += chunkCount;
      remaining -= chunkCount;
    }

    this._nextX += requested * this.xStep;
  }

  clear(): void {
    this._length = 0;
    this._head = 0;
    this._nextX = 0;
    this.blockMin.fill(Infinity);
    this.blockMax.fill(-Infinity);
    this.minTree.fill(Infinity);
    this.maxTree.fill(-Infinity);
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.toTime(this.firstX() + index * this.xStep);
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
  }

  lowerBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.ceil((this.fromTime(x) - this.firstX()) / this.xStep)));
  }

  upperBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.floor((this.fromTime(x) - this.firstX()) / this.xStep) + 1));
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
    const firstOrdinal = this.firstX();

    if (layout === "points") {
      for (let i = 0, index = from; i < count; i++, index += stride) {
        const offset = i * 2;
        target[offset] = this.toTime(firstOrdinal + index * this.xStep) - xOrigin;
        target[offset + 1] = this.yData[this.logicalToPhysical(index)]!;
      }
    } else {
      for (let i = 0, index = from; i < count; i++, index += stride) {
        const offset = i * 4;
        const x = this.toTime(firstOrdinal + index * this.xStep) - xOrigin;
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = this.yData[this.logicalToPhysical(index)]!;
      }
    }

    return count;
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
    const firstOrdinal = this.firstX();
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

      const x = this.toTime(firstOrdinal + (segmentStart + ((segmentEnd - segmentStart) >> 1)) * this.xStep) - xOrigin;
      if (layout === "line-list") {
        const offset = segment * 4;
        target[offset] = x;
        target[offset + 1] = range.minY;
        target[offset + 2] = x;
        target[offset + 3] = range.maxY;
      } else {
        const offset = segment * 3;
        target[offset] = x;
        target[offset + 1] = range.minY;
        target[offset + 2] = range.maxY;
      }
    }

    return segmentCount;
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

  private toTime(ordinal: number): number {
    return PREVIEW_START_TIME + ordinal * PREVIEW_X_STEP_MS;
  }

  private fromTime(time: number): number {
    return (time - PREVIEW_START_TIME) / PREVIEW_X_STEP_MS;
  }

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this._length) {
      throw new RangeError(`ContiguousRingDataset index out of range: ${index}`);
    }
  }

  private static nextPowerOfTwo(value: number): number {
    return 2 ** Math.ceil(Math.log2(value));
  }
}
