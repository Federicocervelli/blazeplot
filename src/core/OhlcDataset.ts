import { lowerBound, upperBound } from "./search.js";
import type { BufferOverflowStrategy, OhlcDataset, TimeRange } from "./types.js";

/** Immutable OHLC dataset backed by parallel arrays. */
export class StaticOhlcDataset implements OhlcDataset {
  /** Number of OHLC samples. */
  readonly length: number;
  private readonly xs: ArrayLike<number>;
  private readonly opens: ArrayLike<number>;
  private readonly highs: ArrayLike<number>;
  private readonly lows: ArrayLike<number>;
  private readonly closes: ArrayLike<number>;

  /** Create an immutable OHLC dataset from parallel arrays. */
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

  /** X range covered by samples, or `null` when empty. */
  get range(): TimeRange | null {
    if (this.length === 0) return null;
    return { start: this.getX(0), end: this.getX(this.length - 1) };
  }

  /** Return the X value at a logical index. */
  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xs[index]!;
  }

  /** Return the close value for dataset-style Y access. */
  getY(index: number): number {
    return this.getClose(index);
  }

  /** Return the open value at a logical index. */
  getOpen(index: number): number {
    this.assertValidIndex(index);
    return this.opens[index]!;
  }

  /** Return the high value at a logical index. */
  getHigh(index: number): number {
    this.assertValidIndex(index);
    return this.highs[index]!;
  }

  /** Return the low value at a logical index. */
  getLow(index: number): number {
    this.assertValidIndex(index);
    return this.lows[index]!;
  }

  /** Return the close value at a logical index. */
  getClose(index: number): number {
    this.assertValidIndex(index);
    return this.closes[index]!;
  }

  /** Return the first logical index whose X value is at least `x`. */
  lowerBoundX(x: number): number {
    return lowerBound(this.length, (index) => this.xs[index]!, x);
  }

  /** Return the first logical index whose X value is greater than `x`. */
  upperBoundX(x: number): number {
    return upperBound(this.length, (index) => this.xs[index]!, x);
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticOhlcDataset index out of range: ${index}`);
    }
  }
}

/** Options for `OhlcRingBuffer`. */
export interface OhlcRingBufferOptions {
  readonly overflow?: BufferOverflowStrategy;
}

/** Fixed-capacity streaming buffer for OHLC/candlestick data. */
export class OhlcRingBuffer implements OhlcDataset {
  /** Maximum number of retained candles. */
  readonly capacity: number;
  private readonly overflow: BufferOverflowStrategy;
  private readonly xData: Float64Array;
  private readonly openData: Float32Array;
  private readonly highData: Float32Array;
  private readonly lowData: Float32Array;
  private readonly closeData: Float32Array;
  private _length = 0;
  private _head = 0;

  /** Create a fixed-capacity streaming OHLC buffer. */
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

  /** Number of retained candles. */
  get length(): number {
    return this._length;
  }

  /** X range covered by retained candles, or `null` when empty. */
  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.getX(0), end: this.getX(this._length - 1) };
  }

  /** Append one OHLC candle. */
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

  /** Replace the latest candle values. */
  updateLast(open: number, high: number, low: number, close: number): boolean {
    return this.updateAt(this._length - 1, open, high, low, close);
  }

  /** Replace candle values at a logical index. */
  updateAt(index: number, open: number, high: number, low: number, close: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const physical = this.logicalToPhysical(index);
    this.openData[physical] = open;
    this.highData[physical] = high;
    this.lowData[physical] = low;
    this.closeData[physical] = close;
    return true;
  }

  /** Append OHLC candles from parallel arrays. */
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

  /** Remove all retained candles. */
  clear(): void {
    this._length = 0;
    this._head = 0;
  }

  /** Return the X value at a logical index. */
  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xData[this.logicalToPhysical(index)]!;
  }

  /** Return the close value for dataset-style Y access. */
  getY(index: number): number {
    return this.getClose(index);
  }

  /** Return the open value at a logical index. */
  getOpen(index: number): number {
    this.assertValidIndex(index);
    return this.openData[this.logicalToPhysical(index)]!;
  }

  /** Return the high value at a logical index. */
  getHigh(index: number): number {
    this.assertValidIndex(index);
    return this.highData[this.logicalToPhysical(index)]!;
  }

  /** Return the low value at a logical index. */
  getLow(index: number): number {
    this.assertValidIndex(index);
    return this.lowData[this.logicalToPhysical(index)]!;
  }

  /** Return the close value at a logical index. */
  getClose(index: number): number {
    this.assertValidIndex(index);
    return this.closeData[this.logicalToPhysical(index)]!;
  }

  /** Return the first logical index whose X value is at least `x`. */
  lowerBoundX(x: number): number {
    return lowerBound(this._length, (index) => this.getX(index), x);
  }

  /** Return the first logical index whose X value is greater than `x`. */
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
