import type { OhlcDataset, TimeRange } from "./types.js";

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
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.xs[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  upperBoundX(x: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.xs[mid]! <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticOhlcDataset index out of range: ${index}`);
    }
  }
}
