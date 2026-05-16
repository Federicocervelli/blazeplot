import type { Dataset, TimeRange } from "./types.js";

export class StaticDataset implements Dataset {
  constructor(
    private readonly xData: ArrayLike<number>,
    private readonly yData: ArrayLike<number>,
  ) {}

  get length(): number {
    return Math.min(this.xData.length, this.yData.length);
  }

  get range(): TimeRange | null {
    if (this.length === 0) return null;
    return { start: this.xData[0]!, end: this.xData[this.length - 1]! };
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xData[index]!;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[index]!;
  }

  lowerBoundX(x: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.xData[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  upperBoundX(x: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.xData[mid]! <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticDataset index out of range: ${index}`);
    }
  }
}
