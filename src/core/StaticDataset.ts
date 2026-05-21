import { lowerBound, upperBound } from "./search.js";
import type { Dataset, TimeRange } from "./types.js";

export type StaticDatasetField<Row> = keyof Row | ((row: Row, index: number) => number);

export interface StaticDatasetFromObjectsOptions<Row> {
  readonly x: StaticDatasetField<Row>;
  readonly y: StaticDatasetField<Row>;
  /**
   * Sort copied rows by X before constructing the dataset. Enable this when
   * source rows come from APIs that do not guarantee chronological order.
   */
  readonly sort?: boolean;
}

function readNumericField<Row>(row: Row, index: number, field: StaticDatasetField<Row>): number {
  if (typeof field === "function") return field(row, index);
  return Number(row[field]);
}

export class StaticDataset implements Dataset {
  /**
   * Copy object rows into a static X/Y dataset.
   *
   * Field names are convenient for API responses, while accessor functions cover
   * tuples, Dates, nested values, or computed units. X values must be sorted
   * unless `sort: true` is passed.
   */
  static fromObjects<Row>(
    rows: readonly Row[],
    options: StaticDatasetFromObjectsOptions<Row>,
  ): StaticDataset {
    const pairs = rows.map((row, index) => {
      const x = readNumericField(row, index, options.x);
      if (!Number.isFinite(x)) {
        throw new TypeError(`StaticDataset.fromObjects expected a finite x value at row ${index}.`);
      }
      return { x, y: readNumericField(row, index, options.y) };
    });

    if (options.sort === true) {
      pairs.sort((a, b) => a.x - b.x);
    }

    return new StaticDataset(
      Float64Array.from(pairs, (pair) => pair.x),
      Float32Array.from(pairs, (pair) => pair.y),
    );
  }

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

  isGap(index: number): boolean {
    return !Number.isFinite(this.getY(index));
  }

  lowerBoundX(x: number): number {
    return lowerBound(this.length, (index) => this.xData[index]!, x);
  }

  upperBoundX(x: number): number {
    return upperBound(this.length, (index) => this.xData[index]!, x);
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticDataset index out of range: ${index}`);
    }
  }
}
