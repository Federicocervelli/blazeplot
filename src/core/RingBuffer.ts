import { lowerBound, upperBound } from "./search.js";
import type { TimeRange } from "./types.js";

export type RingBufferOverflow = "wrap" | "drop-new" | "error";

export interface RingBufferOptions {
  readonly overflow?: RingBufferOverflow;
}

export class RingBuffer {
  readonly capacity: number;
  private _length: number = 0;
  private _head: number = 0;

  private readonly xData: Float64Array;
  private readonly yData: Float32Array;
  private readonly treeBase: number;
  private readonly minTree: Float32Array;
  private readonly maxTree: Float32Array;
  private readonly overflow: RingBufferOverflow;

  constructor(capacity: number, options: RingBufferOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be a positive integer.");
    }

    this.capacity = capacity;
    this.overflow = options.overflow ?? "wrap";
    this.xData = new Float64Array(capacity);
    this.yData = new Float32Array(capacity);
    this.treeBase = RingBuffer.nextPowerOfTwo(capacity);
    this.minTree = new Float32Array(this.treeBase * 2);
    this.maxTree = new Float32Array(this.treeBase * 2);
    this.minTree.fill(Infinity);
    this.maxTree.fill(-Infinity);
  }

  get length(): number {
    return this._length;
  }

  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.getX(0), end: this.getX(this._length - 1) };
  }

  push(x: number, y: number): void {
    if (this._length >= this.capacity) {
      if (this.overflow === "drop-new") return;
      if (this.overflow === "error") throw new RangeError("RingBuffer capacity exceeded.");
    }

    this.xData[this._head] = x;
    this.yData[this._head] = y;
    this.setTreeLeaf(this._head, y);
    this._head = (this._head + 1) % this.capacity;
    if (this._length < this.capacity) this._length++;
  }

  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    const requested = Math.min(x.length, y.length);
    if (requested <= 0) return;

    if (this.overflow !== "wrap") {
      const available = this.capacity - this._length;
      if (requested > available && this.overflow === "error") {
        throw new RangeError("RingBuffer capacity exceeded.");
      }

      const n = Math.min(requested, available);
      if (n <= 0) return;
      this.appendNoWrap(x, y, 0, n);
      return;
    }

    if (requested >= this.capacity) {
      const sourceOffset = requested - this.capacity;
      this._head = 0;
      this._length = this.capacity;
      this.copyIntoPhysical(0, x, y, sourceOffset, this.capacity);
      return;
    }

    this.appendNoWrap(x, y, 0, requested);
  }

  get(index: number): { x: number; y: number } | null {
    if (index < 0 || index >= this._length) return null;
    return { x: this.getX(index), y: this.getY(index) };
  }

  update(index: number, x: number, y: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const physical = this.logicalToPhysical(index);
    this.xData[physical] = x;
    this.yData[physical] = y;
    this.setTreeLeaf(physical, y);
    return true;
  }

  updateY(index: number, y: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const physical = this.logicalToPhysical(index);
    this.yData[physical] = y;
    this.setTreeLeaf(physical, y);
    return true;
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xData[this.logicalToPhysical(index)]!;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
  }

  isGap(index: number): boolean {
    return !Number.isFinite(this.getY(index));
  }

  lowerBoundX(x: number): number {
    return lowerBound(this._length, (index) => this.getX(index), x);
  }

  upperBoundX(x: number): number {
    return upperBound(this._length, (index) => this.getX(index), x);
  }

  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    if (to <= from) return null;

    const physical = this.logicalToPhysical(from);
    const count = to - from;
    if (physical + count <= this.capacity) {
      return this.queryPhysicalMinMax(physical, physical + count);
    }

    const first = this.queryPhysicalMinMax(physical, this.capacity);
    const second = this.queryPhysicalMinMax(0, (physical + count) % this.capacity);
    if (!first) return second;
    if (!second) return first;
    return {
      minY: Math.min(first.minY, second.minY),
      maxY: Math.max(first.maxY, second.maxY),
    };
  }

  clear(): void {
    this._length = 0;
    this._head = 0;
    this.minTree.fill(Infinity);
    this.maxTree.fill(-Infinity);
  }

  private appendNoWrap(x: ArrayLike<number>, y: ArrayLike<number>, sourceOffset: number, count: number): void {
    let nextSourceOffset = sourceOffset;
    let remaining = count;
    while (remaining > 0) {
      const chunkCount = Math.min(remaining, this.capacity - this._head);
      this.copyIntoPhysical(this._head, x, y, nextSourceOffset, chunkCount);
      this._head = (this._head + chunkCount) % this.capacity;
      this._length = Math.min(this.capacity, this._length + chunkCount);
      nextSourceOffset += chunkCount;
      remaining -= chunkCount;
    }
  }

  private copyIntoPhysical(
    physicalStart: number,
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    sourceOffset: number,
    count: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const physical = physicalStart + i;
      const value = y[sourceOffset + i]!;
      this.xData[physical] = x[sourceOffset + i]!;
      this.yData[physical] = value;
      const leaf = this.treeBase + physical;
      this.minTree[leaf] = Number.isFinite(value) ? value : Infinity;
      this.maxTree[leaf] = Number.isFinite(value) ? value : -Infinity;
    }
    this.recomputeTreeRange(physicalStart, physicalStart + count);
  }

  private setTreeLeaf(physical: number, value: number): void {
    let index = this.treeBase + physical;
    this.minTree[index] = Number.isFinite(value) ? value : Infinity;
    this.maxTree[index] = Number.isFinite(value) ? value : -Infinity;
    index >>= 1;
    while (index >= 1) {
      this.recomputeTreeNode(index);
      index >>= 1;
    }
  }

  private recomputeTreeRange(start: number, end: number): void {
    let left = (this.treeBase + start) >> 1;
    let right = (this.treeBase + end - 1) >> 1;
    while (left >= 1) {
      for (let index = left; index <= right; index++) {
        this.recomputeTreeNode(index);
      }
      if (left === 1) break;
      left >>= 1;
      right >>= 1;
    }
  }

  private recomputeTreeNode(index: number): void {
    const left = index << 1;
    const right = left + 1;
    const leftMin = this.minTree[left]!;
    const rightMin = this.minTree[right]!;
    const leftMax = this.maxTree[left]!;
    const rightMax = this.maxTree[right]!;
    this.minTree[index] = leftMin < rightMin ? leftMin : rightMin;
    this.maxTree[index] = leftMax > rightMax ? leftMax : rightMax;
  }

  private queryPhysicalMinMax(start: number, end: number): { minY: number; maxY: number } | null {
    if (end <= start) return null;

    let left = this.treeBase + start;
    let right = this.treeBase + end;
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

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private isValidIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this._length;
  }

  private assertValidIndex(index: number): void {
    if (!this.isValidIndex(index)) {
      throw new RangeError(`RingBuffer index out of range: ${index}`);
    }
  }

  private static nextPowerOfTwo(value: number): number {
    return 2 ** Math.ceil(Math.log2(value));
  }
}
