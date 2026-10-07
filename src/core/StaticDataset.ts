import { StaticMinMaxTree } from "./StaticMinMaxTree.js";
import type { MinMaxOut, MinMaxY } from "./MinMaxTree.js";
import { lowerBoundTyped, upperBoundTyped } from "./search.js";
import type { Dataset, TimeRange, ValuePrecision } from "./types.js";
import { createValueArray } from "./valueArray.js";
import { assertEqualLengths, assertSortedFiniteX, invalidXError, stableFiniteXOrder } from "./validation.js";

const STATIC_HINT =
  "Use StaticDataset.sorted(x, y) to sort and drop non-finite X, or pass { assumeSorted: true } to skip this check for data you trust.";

/** Series at least this long may summarize their whole min/max tree in one pass (see `StaticDataset.createTree`). */
const ONE_PASS_SUMMARY_MIN_SAMPLES = 262_144;

/** Object-row field selector used by `StaticDataset.fromObjects`. */
export type StaticDatasetField<Row> = keyof Row | ((row: Row, index: number) => number);

/** Options for building a static dataset from object rows. */
export interface StaticDatasetFromObjectsOptions<Row> {
  readonly x: StaticDatasetField<Row>;
  readonly y: StaticDatasetField<Row>;
  /**
   * Sort copied rows by X before constructing the dataset. Enable this when
   * source rows come from APIs that do not guarantee chronological order.
   * Rows with equal X keep their input order.
   */
  readonly sort?: boolean;
  /** Y storage for the copied values. Defaults to `"float32"`; use `"float64"` to keep large values exact. */
  readonly valuePrecision?: ValuePrecision;
}

/** Options for the `StaticDataset` constructor. */
export interface StaticDatasetOptions {
  /**
   * Skip the O(n) check that X is finite and non-decreasing, at construction and on
   * `replace`. Only for large data you already trust; unsorted X then makes searches,
   * culling, and picking unreliable.
   */
  readonly assumeSorted?: boolean;
}

/** Options for `StaticDataset.sorted`. */
export interface StaticDatasetSortedOptions {
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
 * X must be finite and non-decreasing: the constructor and `replace` check it in one pass and
 * throw a `RangeError` naming the first bad index. Use `StaticDataset.sorted(x, y)` for
 * unsorted input, or `{ assumeSorted: true }` to skip the check. Non-finite Y is a gap.
 *
 * Change the data with `series.replace({ y })`, or overwrite the arrays and call
 * `series.markDirty()` (in-place edits are not re-checked).
 */
export class StaticDataset implements Dataset {
  readonly rangeMinMaxExcludesGaps = true;
  private tree: StaticMinMaxTree | null = null;
  private count: number;
  private readonly assumeSorted: boolean;
  /** Leading samples of the current X array already checked, so Y-only replaces skip the X check. */
  private checkedLength = 0;

  /**
   * Copy object rows into a static X/Y dataset.
   *
   * Field names are convenient for API responses, while accessor functions cover
   * tuples, Dates, nested values, or computed units. Throws a `RangeError` naming the
   * row when an X is non-finite, or when X decreases and `sort: true` is not passed.
   */
  static fromObjects<Row>(
    rows: readonly Row[],
    options: StaticDatasetFromObjectsOptions<Row>,
  ): StaticDataset {
    const pairs = rows.map((row, index) => {
      const x = readNumericField(row, index, options.x);
      if (!Number.isFinite(x)) throw invalidXError("StaticDataset.fromObjects", x, index, NaN, "Filter out rows without a valid X.", "row");
      return { x, y: readNumericField(row, index, options.y) };
    });

    if (options.sort === true) {
      pairs.sort((a, b) => a.x - b.x);
    } else {
      for (let i = 1; i < pairs.length; i++) {
        if (pairs[i]!.x < pairs[i - 1]!.x) {
          throw invalidXError("StaticDataset.fromObjects", pairs[i]!.x, i, pairs[i - 1]!.x, "Pass { sort: true } to sort rows by X.", "row");
        }
      }
    }

    const y = createValueArray(pairs.length, options.valuePrecision);
    pairs.forEach((pair, index) => {
      y[index] = pair.y;
    });
    return new StaticDataset(Float64Array.from(pairs, (pair) => pair.x), y);
  }

  /**
   * Copy X/Y arrays into a dataset sorted by X. Samples with a non-finite X are dropped;
   * samples with equal X keep their input order. Non-finite Y values are kept as gaps.
   */
  static sorted(x: ArrayLike<number>, y: ArrayLike<number>, options: StaticDatasetSortedOptions = {}): StaticDataset {
    assertEqualLengths("StaticDataset.sorted", { x, y });
    const order = stableFiniteXOrder(x, x.length);
    const xs = new Float64Array(order.length);
    const ys = createValueArray(order.length, options.valuePrecision);
    for (let i = 0; i < order.length; i++) {
      xs[i] = x[order[i]!]!;
      ys[i] = y[order[i]!]!;
    }
    return new StaticDataset(xs, ys);
  }

  /**
   * Create an XY dataset from parallel arrays, read in place. Throws a `RangeError` when an
   * X is non-finite or decreasing, unless `assumeSorted` is set.
   */
  constructor(
    private xData: ArrayLike<number>,
    private yData: ArrayLike<number>,
    options: StaticDatasetOptions = {},
  ) {
    this.assumeSorted = options.assumeSorted === true;
    assertEqualLengths("StaticDataset", { x: xData, y: yData });
    this.count = xData.length;
    this.checkX(xData, this.count);
  }

  /** Number of samples. */
  get length(): number {
    return this.count;
  }

  /**
   * Swap in new arrays without copying them. Prefer `series.replace(...)`, which also redraws.
   * Throws a `RangeError` and keeps the current data when the new X is non-finite or decreasing.
   */
  replace(data: StaticDatasetData): void {
    const xData = data.x ?? this.xData;
    assertEqualLengths("StaticDataset.replace", { x: xData, y: data.y });
    const count = xData.length;
    if (data.x !== undefined) this.checkedLength = 0;
    this.checkX(xData, count);
    const sameY = data.y === this.yData;
    this.xData = xData;
    this.yData = data.y;
    this.count = count;
    if (sameY && this.tree?.capacity === this.count) this.invalidate();
    else this.tree = null;
  }

  /** Drop cached min/max summaries after the arrays were mutated in place. Called by `series.markDirty()`. */
  invalidate(): void {
    this.tree?.update(0, this.count);
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

  /** @internal Bulk-read logical samples `[start, end)` into Float64 scratch arrays (indices must be valid). */
  readXYRange(start: number, end: number, xOut: Float64Array, yOut: Float64Array): void {
    const xs = this.xData;
    const ys = this.yData;
    for (let i = start; i < end; i++) {
      xOut[i - start] = xs[i]!;
      yOut[i - start] = ys[i]!;
    }
  }

  /** Return whether the sample should be rendered as a gap. */
  isGap(index: number): boolean {
    return !Number.isFinite(this.getY(index));
  }

  /** Return the first logical index whose X value is at least `x`. */
  lowerBoundX(x: number): number {
    return lowerBoundTyped(this.xData, this.length, x);
  }

  /** Return the first logical index whose X value is greater than `x`. */
  upperBoundX(x: number): number {
    return upperBoundTyped(this.xData, this.length, x);
  }

  /** Return min/max Y values for a logical index range. Summaries are built lazily, only for the blocks queried. */
  rangeMinMaxY(start: number, end: number): MinMaxY | null {
    const out = { minY: 0, maxY: 0 };
    return this.rangeMinMaxInto(start, end, out) ? out : null;
  }

  /** @internal Allocation-free `rangeMinMaxY`: writes into `out` and returns whether the range holds a finite value. */
  rangeMinMaxInto(start: number, end: number, out: MinMaxOut): boolean {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    if (to <= from) return false;
    if (!this.tree) this.tree = this.createTree(to - from);
    return this.tree.queryInto(from, to, out);
  }

  /**
   * The summary tree. On a large series, a first query that covers a quarter of it or more (a full-range
   * first view is queried in chunks of about a third) summarizes it in one pass. Small series keep the lazy
   * walk: it is cheap there, and a chart mounted per route or tab then pays nothing extra.
   */
  private createTree(firstSpan: number): StaticMinMaxTree {
    const tree = new StaticMinMaxTree(this.yData, this.length);
    if (this.count >= ONE_PASS_SUMMARY_MIN_SAMPLES && firstSpan * 4 >= this.count) tree.summarizeAll();
    return tree;
  }

  /** @internal Extents of consecutive buckets in one call (see `MinMaxTree.bucketExtentsInto`). */
  minMaxBucketsInto(first: number, width: number, count: number, minOut: Float64Array, maxOut: Float64Array): void {
    if (!this.tree) this.tree = this.createTree(count * width);
    this.tree.bucketExtentsInto(first, width, count, 0, this.count, 0, minOut, maxOut);
  }

  /** @internal X at an index known to be valid. */
  xAtUnchecked(index: number): number {
    return this.xData[index]!;
  }

  /** Check the first `count` X values unless trusted or already checked for this array. */
  private checkX(x: ArrayLike<number>, count: number): void {
    if (this.assumeSorted || count <= this.checkedLength) return;
    assertSortedFiniteX("StaticDataset", x, count, STATIC_HINT);
    this.checkedLength = count;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticDataset index out of range: ${index}`);
    }
  }
}
