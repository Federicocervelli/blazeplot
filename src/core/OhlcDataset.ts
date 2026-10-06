import { lowerBoundRing, lowerBoundTyped, upperBoundRing, upperBoundTyped } from "./search.js";
import { createValueArray } from "./valueArray.js";
import type { BufferOverflowStrategy, InvalidOhlcSample, OhlcDataset, TimeRange, ValuePrecision } from "./types.js";
import { assertEqualLengths, MAX_X, MIN_X, assertSortedFiniteX, firstInvalidX, invalidSampleWarning, invalidXReason, stableFiniteXOrder } from "./validation.js";

const STATIC_OHLC_HINT =
  "Use StaticOhlcDataset.sorted(x, open, high, low, close) to sort and drop non-finite X, or pass { assumeSorted: true } to skip this check for data you trust.";

/** Options for `StaticOhlcDataset`. */
export interface StaticOhlcDatasetOptions {
  /**
   * Skip the O(n) construction check that X is finite and non-decreasing. Only for large
   * data you already trust; unsorted X then makes searches, culling, and picking unreliable.
   */
  readonly assumeSorted?: boolean;
}

/** Options for `StaticOhlcDataset.sorted`. */
export interface StaticOhlcDatasetSortedOptions {
  /** Open/high/low/close storage for the copied values. Defaults to `"float32"`. */
  readonly valuePrecision?: ValuePrecision;
}

/**
 * Immutable OHLC dataset backed by parallel arrays.
 *
 * X must be finite and non-decreasing; the constructor checks it and throws a `RangeError`
 * naming the first bad index. A candle with any non-finite price is a gap.
 */
export class StaticOhlcDataset implements OhlcDataset {
  /** Number of OHLC samples. */
  readonly length: number;
  private readonly xs: ArrayLike<number>;
  private readonly opens: ArrayLike<number>;
  private readonly highs: ArrayLike<number>;
  private readonly lows: ArrayLike<number>;
  private readonly closes: ArrayLike<number>;

  /**
   * Copy parallel arrays into a dataset sorted by X. Candles with a non-finite X are dropped;
   * candles with equal X keep their input order.
   */
  static sorted(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
    options: StaticOhlcDatasetSortedOptions = {},
  ): StaticOhlcDataset {
    assertEqualLengths("StaticOhlcDataset.sorted", { x, open, high, low, close });
    const count = x.length;
    const order = stableFiniteXOrder(x, count);
    const n = order.length;
    const xs = new Float64Array(n);
    const opens = createValueArray(n, options.valuePrecision);
    const highs = createValueArray(n, options.valuePrecision);
    const lows = createValueArray(n, options.valuePrecision);
    const closes = createValueArray(n, options.valuePrecision);
    for (let i = 0; i < n; i++) {
      const source = order[i]!;
      xs[i] = x[source]!;
      opens[i] = open[source]!;
      highs[i] = high[source]!;
      lows[i] = low[source]!;
      closes[i] = close[source]!;
    }
    return new StaticOhlcDataset(xs, opens, highs, lows, closes, { assumeSorted: true });
  }

  /**
   * Create an immutable OHLC dataset from parallel arrays, read in place. Throws a `RangeError`
   * when an X is non-finite or decreasing, unless `assumeSorted` is set.
   */
  constructor(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
    options: StaticOhlcDatasetOptions = {},
  ) {
    assertEqualLengths("StaticOhlcDataset", { x, open, high, low, close });
    this.length = x.length;
    if (options.assumeSorted !== true) assertSortedFiniteX("StaticOhlcDataset", x, this.length, STATIC_OHLC_HINT);
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

  /** Return whether the candle is a gap: any of open, high, low, or close is non-finite. */
  isGap(index: number): boolean {
    return !Number.isFinite(this.getOpen(index) + this.getHigh(index) + this.getLow(index) + this.getClose(index));
  }

  /** Return the first logical index whose X value is at least `x`. */
  lowerBoundX(x: number): number {
    return lowerBoundTyped(this.xs, this.length, x);
  }

  /** Return the first logical index whose X value is greater than `x`. */
  upperBoundX(x: number): number {
    return upperBoundTyped(this.xs, this.length, x);
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
  /** Open/high/low/close storage. Defaults to `"float32"`; use `"float64"` to keep large prices exact. */
  readonly valuePrecision?: ValuePrecision;
  /**
   * Called for each candle skipped because its X is non-finite or below the last accepted X.
   * When set, the one-time console warning is not logged.
   */
  readonly onInvalidSample?: (sample: InvalidOhlcSample) => void;
}

/**
 * Fixed-capacity streaming buffer for OHLC/candlestick data.
 *
 * X must be finite and non-decreasing. A candle that breaks that rule is skipped (never
 * thrown), counted in `rejectedSamples`, reported to `onInvalidSample`, and logged with one
 * console warning per buffer when no callback is set. A candle with a non-finite price is
 * stored and treated as a gap.
 */
export class OhlcRingBuffer implements OhlcDataset {
  /** Maximum number of retained candles. */
  readonly capacity: number;
  private readonly overflow: BufferOverflowStrategy;
  private readonly xData: Float64Array;
  private readonly openData: Float32Array | Float64Array;
  private readonly highData: Float32Array | Float64Array;
  private readonly lowData: Float32Array | Float64Array;
  private readonly closeData: Float32Array | Float64Array;
  private _length = 0;
  private _head = 0;
  private _rejected = 0;
  private readonly onInvalidSample: ((sample: InvalidOhlcSample) => void) | undefined;
  private readonly warnInvalid: ReturnType<typeof invalidSampleWarning>;

  /** Create a fixed-capacity streaming OHLC buffer. */
  constructor(capacity: number, options: OhlcRingBufferOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("OhlcRingBuffer capacity must be a positive integer.");
    }

    this.capacity = capacity;
    this.overflow = options.overflow ?? "wrap";
    this.onInvalidSample = options.onInvalidSample;
    this.warnInvalid = invalidSampleWarning("OhlcRingBuffer", options.onInvalidSample !== undefined);
    this.xData = new Float64Array(capacity);
    this.openData = createValueArray(capacity, options.valuePrecision);
    this.highData = createValueArray(capacity, options.valuePrecision);
    this.lowData = createValueArray(capacity, options.valuePrecision);
    this.closeData = createValueArray(capacity, options.valuePrecision);
  }

  /** Number of retained candles. */
  get length(): number {
    return this._length;
  }

  /** Candles skipped since creation because their X was non-finite or went backwards. Not reset by `clear()`. */
  get rejectedSamples(): number {
    return this._rejected;
  }

  /** X range covered by retained candles, or `null` when empty. */
  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.getX(0), end: this.getX(this._length - 1) };
  }

  /** Append one OHLC candle. A non-finite `x`, or one below the last accepted X, skips the candle. */
  push(x: number, open: number, high: number, low: number, close: number): void {
    const floor = this.acceptFloor();
    if (!(x >= floor && x <= MAX_X)) {
      this.reject("push", 0, x, open, high, low, close, floor);
      return;
    }
    if (this._length >= this.capacity) {
      if (this.overflow === "drop-new") return;
      if (this.overflow === "error") throw new RangeError("OhlcRingBuffer capacity exceeded.");
    }
    this.write(x, open, high, low, close);
  }

  /** Replace candle values at a logical index. X is unchanged; non-finite prices make the candle a gap. */
  updateAt(index: number, open: number, high: number, low: number, close: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const physical = this.logicalToPhysical(index);
    this.openData[physical] = open;
    this.highData[physical] = high;
    this.lowData[physical] = low;
    this.closeData[physical] = close;
    return true;
  }

  /**
   * Append OHLC candles from parallel arrays. Candles whose X is non-finite or below the
   * previous accepted X are skipped and do not count toward capacity or overflow.
   */
  append(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
  ): void {
    assertEqualLengths("OhlcRingBuffer.append", { x, open, high, low, close });
    const requested = x.length;
    if (requested <= 0) return;

    // drop-new stores at most `limit` candles; later valid candles are dropped without
    // moving the X floor, exactly as if each candle were pushed.
    const limit = this.overflow === "drop-new" ? this.capacity - this._length : requested;
    const storable = Math.min(requested, limit);
    const floor = this.acceptFloor();
    const firstInvalid = firstInvalidX(x, storable, floor);
    let indexes: Uint32Array | null = null;
    let count = storable;
    if (firstInvalid < storable) {
      indexes = new Uint32Array(storable);
      count = 0;
      let next = floor;
      for (let i = 0; i < requested; i++) {
        const xi = x[i]!;
        if (!(xi >= next && xi <= MAX_X)) {
          this.reject("append", i, xi, open[i]!, high[i]!, low[i]!, close[i]!, next);
          continue;
        }
        if (count >= limit) continue;
        next = xi;
        indexes[count++] = i;
      }
    } else {
      const frozen = storable > 0 ? x[storable - 1]! : floor;
      for (let i = storable; i < requested; i++) {
        const xi = x[i]!;
        if (!(xi >= frozen && xi <= MAX_X)) this.reject("append", i, xi, open[i]!, high[i]!, low[i]!, close[i]!, frozen);
      }
    }

    let from = 0;
    let to = count;
    if (this.overflow !== "wrap") {
      const available = this.capacity - this._length;
      if (count > available && this.overflow === "error") {
        throw new RangeError("OhlcRingBuffer capacity exceeded.");
      }
      to = Math.min(count, available);
    } else {
      from = Math.max(0, count - this.capacity);
    }
    for (let k = from; k < to; k++) {
      const i = indexes ? indexes[k]! : k;
      this.write(x[i]!, open[i]!, high[i]!, low[i]!, close[i]!);
    }
  }

  /** Remove all retained candles. The next candle may start at any finite X. */
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

  /** Return whether the candle is a gap: any of open, high, low, or close is non-finite. */
  isGap(index: number): boolean {
    this.assertValidIndex(index);
    const physical = this.logicalToPhysical(index);
    return !Number.isFinite(this.openData[physical]! + this.highData[physical]! + this.lowData[physical]! + this.closeData[physical]!);
  }

  /** Return the first logical index whose X value is at least `x`. */
  lowerBoundX(x: number): number {
    return lowerBoundRing(this.xData, this.logicalToPhysical(0), this._length, x);
  }

  /** Return the first logical index whose X value is greater than `x`. */
  upperBoundX(x: number): number {
    return upperBoundRing(this.xData, this.logicalToPhysical(0), this._length, x);
  }

  /** Store an already-validated candle, overwriting the oldest one when full. */
  private write(x: number, open: number, high: number, low: number, close: number): void {
    const physical = this._head;
    this.xData[physical] = x;
    this.openData[physical] = open;
    this.highData[physical] = high;
    this.lowData[physical] = low;
    this.closeData[physical] = close;
    this._head = (physical + 1) % this.capacity;
    if (this._length < this.capacity) this._length++;
  }

  /** Lowest X the next candle may have: the newest retained X, or `MIN_X` when empty. */
  private acceptFloor(): number {
    return this._length > 0 ? this.xData[this._head === 0 ? this.capacity - 1 : this._head - 1]! : MIN_X;
  }

  private reject(
    operation: InvalidOhlcSample["operation"],
    index: number,
    x: number,
    open: number,
    high: number,
    low: number,
    close: number,
    neighborX: number,
  ): void {
    this._rejected++;
    const reason = invalidXReason(x);
    const neighbor = reason === "decreasing-x" ? neighborX : NaN;
    this.warnInvalid(reason, x, neighbor);
    this.onInvalidSample?.({ reason, operation, index, x, y: close, neighborX: neighbor, open, high, low, close });
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
