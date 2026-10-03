import { MinMaxTree } from "./MinMaxTree.js";
import type { MinMaxY } from "./MinMaxTree.js";
import { lowerBound, upperBound } from "./search.js";
import { createValueArray } from "./valueArray.js";
import type { Dataset, TimeRange, ValuePrecision } from "./types.js";

/** Object-row field selector used by `StaticDataset.fromObjects`. */
export type StaticDatasetField<Row> = keyof Row | ((row: Row, index: number) => number);

/** Options for building a static dataset from object rows. */
export interface StaticDatasetFromObjectsOptions<Row> {
  readonly x: StaticDatasetField<Row>;
  readonly y: StaticDatasetField<Row>;
  /**
   * Sort copied rows by X before constructing the dataset. Enable this when
   * source rows come from APIs that do not guarantee chronological order.
   */
  readonly sort?: boolean;
  /** Y storage for the copied values. Defaults to `"float32"`; use `"float64"` to keep large values exact. */
  readonly valuePrecision?: ValuePrecision;
}

function readNumericField<Row>(row: Row, index: number, field: StaticDatasetField<Row>): number {
  if (typeof field === "function") return field(row, index);
  return Number(row[field]);
}

/** Data accepted by `StaticDataset.replace` and `series.replace(...)`. */
export interface StaticDatasetData {
  /** New sorted X values. Omit to keep the current X array, e.g. a fixed frequency axis. */
  readonly x?: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

/**
 * Sorted XY dataset backed by typed arrays, which are read in place rather than copied.
 *
 * Change the data with `series.replace({ y })`, or overwrite the arrays and call
 * `series.markDirty()`.
 */
export class StaticDataset implements Dataset {
  readonly rangeMinMaxExcludesGaps = true;
  private tree: MinMaxTree | null = null;
  private treeStale = false;
  private count: number;

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

    const y = createValueArray(pairs.length, options.valuePrecision);
    pairs.forEach((pair, index) => {
      y[index] = pair.y;
    });
    return new StaticDataset(Float64Array.from(pairs, (pair) => pair.x), y);
  }

  /** Create an XY dataset from parallel arrays. */
  constructor(
    private xData: ArrayLike<number>,
    private yData: ArrayLike<number>,
  ) {
    this.count = Math.min(xData.length, yData.length);
  }

  /** Number of samples. */
  get length(): number {
    return this.count;
  }

  /** Swap in new arrays without copying them. Prefer `series.replace(...)`, which also redraws. */
  replace(data: StaticDatasetData): void {
    const sameY = data.y === this.yData;
    this.xData = data.x ?? this.xData;
    this.yData = data.y;
    this.count = Math.min(this.xData.length, this.yData.length);
    if (sameY && this.tree?.capacity === this.count) this.invalidate();
    else this.tree = null;
  }

  /** Drop cached min/max summaries after the arrays were mutated in place. Called by `series.markDirty()`. */
  invalidate(): void {
    this.treeStale = true;
  }

  /** X range covered by samples, or `null` when empty. */
  get range(): TimeRange | null {
    if (this.length === 0) return null;
    return { start: this.xData[0]!, end: this.xData[this.length - 1]! };
  }

  /** Return the X value at a logical index. */
  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xData[index]!;
  }

  /** Return the Y value at a logical index. */
  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[index]!;
  }

  /** Return whether the sample should be rendered as a gap. */
  isGap(index: number): boolean {
    return !Number.isFinite(this.getY(index));
  }

  /** Return the first logical index whose X value is at least `x`. */
  lowerBoundX(x: number): number {
    return lowerBound(this.length, (index) => this.xData[index]!, x);
  }

  /** Return the first logical index whose X value is greater than `x`. */
  upperBoundX(x: number): number {
    return upperBound(this.length, (index) => this.xData[index]!, x);
  }

  /** Return min/max Y values for a logical index range. The summary index is built on first use. */
  rangeMinMaxY(start: number, end: number): MinMaxY | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    if (to <= from) return null;
    return this.summary().query(from, to);
  }

  /** Return whether logical `[start, end)` contains a gap (non-finite Y). */
  hasGapInRange(start: number, end: number): boolean {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    if (to <= from) return false;
    if (this.tree && !this.treeStale) return this.tree.hasGap(from, to);
    // No current summary: scan rather than rebuild the whole tree, since data replaced
    // every frame would otherwise pay a full rebuild just for gap checks.
    for (let i = from; i < to; i++) {
      if (!Number.isFinite(this.yData[i]!)) return true;
    }
    return false;
  }

  /** The min/max/gap summary tree, built on first use and refreshed after invalidation. */
  private summary(): MinMaxTree {
    if (!this.tree) {
      this.tree = new MinMaxTree(this.yData, this.length);
      this.treeStale = true;
    }
    if (this.treeStale) {
      this.tree.update(0, this.length);
      this.treeStale = false;
    }
    return this.tree;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticDataset index out of range: ${index}`);
    }
  }
}
