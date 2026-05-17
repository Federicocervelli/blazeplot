import type { AppendableDataset, RangeMinMaxDataset, TimeRange } from "@/index.ts";

export interface ContiguousRingDatasetOptions {
  readonly blockSize?: number;
}

export class ContiguousRingDataset implements AppendableDataset, RangeMinMaxDataset {
  readonly capacity: number;
  private readonly blockSize: number;
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
    return { start: this._nextX - this._length, end: this._nextX - 1 };
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
      this._nextX += requested;
      this.recomputeAllBlocks();
      return;
    }

    let sourceOffset = 0;
    let remaining = requested;
    while (remaining > 0) {
      const chunkCount = Math.min(remaining, this.capacity - this._head);
      for (let i = 0; i < chunkCount; i++) this.yData[this._head + i] = y[sourceOffset + i]!;
      this.recomputePhysicalBlockRange(this._head, this._head + chunkCount);
      this._head = (this._head + chunkCount) % this.capacity;
      this._length = Math.min(this.capacity, this._length + chunkCount);
      sourceOffset += chunkCount;
      remaining -= chunkCount;
    }

    this._nextX += requested;
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
    return this._nextX - this._length + index;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
  }

  lowerBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.ceil(x - (this._nextX - this._length))));
  }

  upperBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.floor(x - (this._nextX - this._length)) + 1));
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

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this._length) {
      throw new RangeError(`ContiguousRingDataset index out of range: ${index}`);
    }
  }
}
