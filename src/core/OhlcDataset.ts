import { lowerBound, upperBound } from "./search.js";
import type { BufferOverflowStrategy, OhlcDataset, TimeRange } from "./types.js";

export class StaticOhlcDataset implements OhlcDataset {
  readonly length: number;
  private readonly xs: ArrayLike<number>;
  private readonly opens: ArrayLike<number>;
  private readonly highs: ArrayLike<number>;
  private readonly lows: ArrayLike<number>;
  private readonly closes: ArrayLike<number>;

  constructor(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
  ) {
    this.length = Math.min(x.length, open.length, high.length, low.length, close.length);
    this.xs = x;
    this.opens = open;
    this.highs = high;
    this.lows = low;
    this.closes = close;
  }

  get range(): TimeRange | null {
    if (this.length === 0) return null;
    return { start: this.getX(0), end: this.getX(this.length - 1) };
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xs[index]!;
  }

  getY(index: number): number {
    return this.getClose(index);
  }

  getOpen(index: number): number {
    this.assertValidIndex(index);
    return this.opens[index]!;
  }

  getHigh(index: number): number {
    this.assertValidIndex(index);
    return this.highs[index]!;
  }

  getLow(index: number): number {
    this.assertValidIndex(index);
    return this.lows[index]!;
  }

  getClose(index: number): number {
    this.assertValidIndex(index);
    return this.closes[index]!;
  }

  lowerBoundX(x: number): number {
    return lowerBound(this.length, (index) => this.xs[index]!, x);
  }

  upperBoundX(x: number): number {
    return upperBound(this.length, (index) => this.xs[index]!, x);
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticOhlcDataset index out of range: ${index}`);
    }
  }
}

export interface OhlcRingBufferOptions {
  readonly overflow?: BufferOverflowStrategy;
}

export class OhlcRingBuffer implements OhlcDataset {
  readonly capacity: number;
  private readonly overflow: BufferOverflowStrategy;
  private readonly xData: Float64Array;
  private readonly openData: Float32Array;
  private readonly highData: Float32Array;
  private readonly lowData: Float32Array;
  private readonly closeData: Float32Array;
  private _length = 0;
  private _head = 0;

  constructor(capacity: number, options: OhlcRingBufferOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("OhlcRingBuffer capacity must be a positive integer.");
    }

    this.capacity = capacity;
    this.overflow = options.overflow ?? "wrap";
    this.xData = new Float64Array(capacity);
    this.openData = new Float32Array(capacity);
    this.highData = new Float32Array(capacity);
    this.lowData = new Float32Array(capacity);
    this.closeData = new Float32Array(capacity);
  }

  get length(): number {
    return this._length;
  }

  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.getX(0), end: this.getX(this._length - 1) };
  }

  push(x: number, open: number, high: number, low: number, close: number): void {
    if (this._length >= this.capacity) {
      if (this.overflow === "drop-new") return;
      if (this.overflow === "error") throw new RangeError("OhlcRingBuffer capacity exceeded.");
    }

    this.xData[this._head] = x;
    this.openData[this._head] = open;
    this.highData[this._head] = high;
    this.lowData[this._head] = low;
    this.closeData[this._head] = close;
    this._head = (this._head + 1) % this.capacity;
    if (this._length < this.capacity) this._length++;
  }

  updateLast(open: number, high: number, low: number, close: number): boolean {
    return this.updateAt(this._length - 1, open, high, low, close);
  }

  updateAt(index: number, open: number, high: number, low: number, close: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const physical = this.logicalToPhysical(index);
    this.openData[physical] = open;
    this.highData[physical] = high;
    this.lowData[physical] = low;
    this.closeData[physical] = close;
    return true;
  }

  append(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
  ): void {
    const requested = Math.min(x.length, open.length, high.length, low.length, close.length);
    if (requested <= 0) return;

    if (this.overflow !== "wrap") {
      const available = this.capacity - this._length;
      if (requested > available && this.overflow === "error") {
        throw new RangeError("OhlcRingBuffer capacity exceeded.");
      }
      const count = Math.min(requested, available);
      for (let i = 0; i < count; i++) this.push(x[i]!, open[i]!, high[i]!, low[i]!, close[i]!);
      return;
    }

    const sourceStart = Math.max(0, requested - this.capacity);
    for (let i = sourceStart; i < requested; i++) this.push(x[i]!, open[i]!, high[i]!, low[i]!, close[i]!);
  }

  clear(): void {
    this._length = 0;
    this._head = 0;
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xData[this.logicalToPhysical(index)]!;
  }

  getY(index: number): number {
    return this.getClose(index);
  }

  getOpen(index: number): number {
    this.assertValidIndex(index);
    return this.openData[this.logicalToPhysical(index)]!;
  }

  getHigh(index: number): number {
    this.assertValidIndex(index);
    return this.highData[this.logicalToPhysical(index)]!;
  }

  getLow(index: number): number {
    this.assertValidIndex(index);
    return this.lowData[this.logicalToPhysical(index)]!;
  }

  getClose(index: number): number {
    this.assertValidIndex(index);
    return this.closeData[this.logicalToPhysical(index)]!;
  }

  lowerBoundX(x: number): number {
    return lowerBound(this._length, (index) => this.getX(index), x);
  }

  upperBoundX(x: number): number {
    return upperBound(this._length, (index) => this.getX(index), x);
  }

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private isValidIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this._length;
  }

  private assertValidIndex(index: number): void {
    if (!this.isValidIndex(index)) {
      throw new RangeError(`OhlcRingBuffer index out of range: ${index}`);
    }
  }
}
