import { lowerBound, upperBound } from "./search.js";
import type { Dataset, MinMaxSegmentLayout, TimeRange, Viewport } from "./types.js";

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
}

function readNumericField<Row>(row: Row, index: number, field: StaticDatasetField<Row>): number {
  if (typeof field === "function") return field(row, index);
  return Number(row[field]);
}

/** Immutable sorted XY dataset backed by typed arrays. */
export class StaticDataset implements Dataset {
  readonly rangeMinMaxExcludesGaps = true;

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

  /** Create an immutable XY dataset from parallel arrays. */
  constructor(
    private readonly xData: ArrayLike<number>,
    private readonly yData: ArrayLike<number>,
  ) {}

  /** Number of samples. */
  get length(): number {
    return Math.min(this.xData.length, this.yData.length);
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

  /** Return min/max Y values for a logical index range. */
  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    if (to <= from) return null;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = from; index < to; index++) {
      const y = this.yData[index]!;
      if (!Number.isFinite(y)) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return Number.isFinite(minY) && Number.isFinite(maxY) ? { minY, maxY } : null;
  }

  /** Copy min/max segments for the viewport into a render buffer without building an upfront LOD pyramid. */
  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    layout: MinMaxSegmentLayout,
    xOrigin: number,
  ): number {
    const floatsPerSegment = layout === "line-list" ? 4 : 3;
    if (maxSegments <= 0 || target.length < maxSegments * floatsPerSegment) return 0;

    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const stride = Math.max(1, Math.ceil(visible / maxSegments));
    const alignedStart = start - (start % stride);
    let written = 0;

    for (let bucketStart = alignedStart; bucketStart < end && written < maxSegments; bucketStart += stride) {
      const segmentStart = Math.max(0, bucketStart);
      const segmentEnd = Math.min(this.length, bucketStart + stride);
      if (segmentEnd <= start || segmentStart >= end) continue;

      let minY = Infinity;
      let maxY = -Infinity;
      for (let index = segmentStart; index < segmentEnd; index++) {
        const y = this.yData[index]!;
        if (!Number.isFinite(y)) continue;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) continue;

      const representative = Math.max(segmentStart, Math.min(segmentEnd - 1, bucketStart + (stride >> 1)));
      const x = this.xData[representative]! - xOrigin;
      if (layout === "line-list") {
        const offset = written * 4;
        target[offset] = x;
        target[offset + 1] = minY;
        target[offset + 2] = x;
        target[offset + 3] = maxY;
      } else {
        const offset = written * 3;
        target[offset] = x;
        target[offset + 1] = minY;
        target[offset + 2] = maxY;
      }
      written++;
    }

    return written;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`StaticDataset index out of range: ${index}`);
    }
  }
}
