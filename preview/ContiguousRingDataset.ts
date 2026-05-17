import type { AppendableDataset, RangeMinMaxDataset, TimeRange, Viewport } from "@/index.ts";

export interface ContiguousRingDatasetOptions {
  readonly blockSize?: number;
  readonly xStep?: number;
}

type SampleLayout = "points" | "area";
type MinMaxLayout = "line-list" | "instanced";

export class ContiguousRingDataset implements AppendableDataset, RangeMinMaxDataset {
  readonly capacity: number;
  private readonly blockSize: number;
  private readonly xStep: number;
  private readonly yData: Float32Array;
  private readonly blockMin: Float32Array;
  private readonly blockMax: Float32Array;
  private _length = 0;
  private _head = 0;
  private _nextX = 0;

  constructor(capacity: number, options: ContiguousRingDatasetOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("ContiguousRingDataset capacity must be a positive integer.");
    }

    this.capacity = capacity;
    this.blockSize = options.blockSize ?? 1024;
    this.xStep = options.xStep ?? 1;
    this.yData = new Float32Array(capacity);
    const blockCount = Math.ceil(capacity / this.blockSize);
    this.blockMin = new Float32Array(blockCount);
    this.blockMax = new Float32Array(blockCount);
    this.blockMin.fill(Infinity);
    this.blockMax.fill(-Infinity);
  }

  get length(): number {
    return this._length;
  }

  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.firstX(), end: this.getX(this._length - 1) };
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
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.firstX() + index * this.xStep;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
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

  copySamplesRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    const count = Math.min(maxPoints, Math.max(0, to - from));
    const firstX = this.firstX() - xOrigin;
    let physical = this.logicalToPhysical(from);

    if (layout === "points") {
      for (let i = 0; i < count; i++) {
        const offset = i * 2;
        target[offset] = firstX + (from + i) * this.xStep;
        target[offset + 1] = this.yData[physical]!;
        physical = physical + 1 === this.capacity ? 0 : physical + 1;
      }
    } else {
      for (let i = 0; i < count; i++) {
        const offset = i * 4;
        const x = firstX + (from + i) * this.xStep;
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = this.yData[physical]!;
        physical = physical + 1 === this.capacity ? 0 : physical + 1;
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
    const firstX = this.firstX() - xOrigin;
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

      const x = firstX + (segmentStart + ((segmentEnd - segmentStart) >> 1)) * this.xStep;
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
    while (i < end) {
      if (i % this.blockSize === 0 && i + this.blockSize <= end) {
        const block = i / this.blockSize;
        const bMin = this.blockMin[block]!;
        const bMax = this.blockMax[block]!;
        if (bMin < minY) minY = bMin;
        if (bMax > maxY) maxY = bMax;
        i += this.blockSize;
      } else {
        const value = this.yData[i]!;
        if (value < minY) minY = value;
        if (value > maxY) maxY = value;
        i++;
      }
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
      throw new RangeError(`ContiguousRingDataset index out of range: ${index}`);
    }
  }
}
