import type { TimeRange } from "./types.js";

export class RingBuffer {
  readonly capacity: number;
  private _length: number = 0;
  private _head: number = 0;

  private readonly xData: Float64Array;
  private readonly yData: Float32Array;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be a positive integer.");
    }

    this.capacity = capacity;
    this.xData = new Float64Array(capacity);
    this.yData = new Float32Array(capacity);
  }

  get length(): number {
    return this._length;
  }

  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.getX(0), end: this.getX(this._length - 1) };
  }

  push(x: number, y: number): void {
    this.xData[this._head] = x;
    this.yData[this._head] = y;
    this._head = (this._head + 1) % this.capacity;
    if (this._length < this.capacity) this._length++;
  }

  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) {
      this.push(x[i]!, y[i]!);
    }
  }

  get(index: number): { x: number; y: number } | null {
    if (index < 0 || index >= this._length) return null;
    return { x: this.getX(index), y: this.getY(index) };
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xData[this.logicalToPhysical(index)]!;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
  }

  lowerBoundX(x: number): number {
    let lo = 0;
    let hi = this._length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.getX(mid) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  upperBoundX(x: number): number {
    let lo = 0;
    let hi = this._length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.getX(mid) <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  minMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    if (to <= from) return null;

    let physical = this.logicalToPhysical(from);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const y = this.yData[physical]!;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      physical++;
      if (physical === this.capacity) physical = 0;
    }

    return { minY, maxY };
  }

  clear(): void {
    this._length = 0;
    this._head = 0;
  }

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this._length) {
      throw new RangeError(`RingBuffer index out of range: ${index}`);
    }
  }
}
