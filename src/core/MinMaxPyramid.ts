import type { Dataset } from "./types.js";

const MAX_LEVELS = 16;

function isGap(source: Dataset, index: number, y: number): boolean {
  return !Number.isFinite(y) || source.isGap?.(index) === true;
}

/**
 * Incremental min/max pyramid used for dense line and bar downsampling.
 *
 * Levels are stored as Float64 so large-magnitude Y values keep their exact min/max (Float32 would round
 * values such as `1e10 + 0.5`); the cost is twice the level memory, about 2 * 8 bytes per source sample
 * in total.
 *
 * Buckets are addressed in a "pyramid space" `p = index + shift`. When a full ring drops `k` samples from
 * the front the pyramid does not rebuild: `shift` grows by `k`, bucket alignment is untouched, and only the
 * tail is recomputed. Buckets that straddle the front edge hold stale expired samples, but `rangeMinMax`
 * only reads buckets fully inside the queried (live) range, so they are never used. A full rebuild resets
 * `shift` once it exceeds the live length, which keeps the cost amortized O(1) per dropped sample.
 */
export class MinMaxPyramid {
  private levels: Float64Array[] = [];
  private _shift: number = 0;
  private lengths: number[] = [];
  private _builtLen: number = 0;
  private _rangeStart: number = NaN;

  /** Create a min/max pyramid using fixed-size buckets. */
  constructor(readonly bucketSize: number = 2) {
    if (!Number.isInteger(bucketSize) || bucketSize < 2) {
      throw new RangeError("MinMaxPyramid bucketSize must be an integer >= 2.");
    }
  }

  /** Rebuild all pyramid levels from the source dataset. */
  build(source: Dataset): void {
    this.levels = [];
    this.lengths = [];
    this._shift = 0;
    this._builtLen = source.length;
    this._rangeStart = source.length > 0 ? (source.range?.start ?? NaN) : NaN;
    if (source.length > 0) this.appendTail(source, 0);
  }

  /**
   * Extend pyramid levels after new samples are appended. `shiftBy` is the number of samples a full ring
   * dropped from the front since the last build (its ordinal advance); the caller must know it exactly.
   */
  incrementalBuild(source: Dataset, shiftBy: number = 0): void {
    const newLen = source.length;
    const rangeStart = source.range?.start ?? NaN;
    const oldTotal = this._shift + this._builtLen;
    const newShift = this._shift + shiftBy;
    const newTotal = newShift + newLen;
    if (
      newLen === 0 ||
      shiftBy < 0 ||
      newTotal < oldTotal ||
      (shiftBy === 0 && (newLen < this._builtLen || rangeStart !== this._rangeStart)) ||
      newShift > Math.max(newLen, 64)
    ) {
      this.build(source);
      return;
    }

    if (newTotal !== oldTotal) {
      this._shift = newShift;
      this.appendTail(source, oldTotal);
      this._builtLen = newLen;
    }
    this._rangeStart = rangeStart;
  }

  /** Recompute buckets from pyramid-space position `fromP` to the end of the data. */
  private appendTail(source: Dataset, fromP: number): void {
    const shift = this._shift;
    const W = this.bucketSize;
    let changedIdx = fromP;

    for (let L = 0; L < MAX_LEVELS; L++) {
      const items = L === 0 ? shift + source.length : this.lengths[L - 1]!;
      const first = Math.floor(changedIdx / W);
      const last = Math.ceil(items / W) - 1;
      if (first > last) break;

      const needed = (last + 1) * 2;
      let dst = this.levels[L];
      if (!dst || dst.length < needed) {
        const next = new Float64Array(Math.max(needed, Math.ceil((dst?.length ?? 0) * 1.5)));
        if (dst) next.set(dst);
        dst = this.levels[L] = next;
      }
      const prev = this.levels[L - 1];

      for (let b = first; b <= last; b++) {
        let minY = Infinity;
        let maxY = -Infinity;
        for (let j = Math.max(b * W, L === 0 ? shift : 0); j < Math.min((b + 1) * W, items); j++) {
          let lo = NaN;
          let hi = NaN;
          if (prev) {
            lo = prev[j * 2]!;
            hi = prev[j * 2 + 1]!;
          } else {
            lo = hi = source.getY(j - shift);
            if (isGap(source, j - shift, lo)) continue;
          }
          if (lo < minY) minY = lo;
          if (hi > maxY) maxY = hi;
        }
        dst[b * 2] = minY;
        dst[b * 2 + 1] = maxY;
      }

      this.lengths[L] = last + 1;
      changedIdx = first;
      if (last <= 0) break;
    }
  }

  /** Return min/max Y values for a source index range. */
  rangeMinMax(source: Dataset, start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(source.length, Math.ceil(end));
    if (to <= from) return null;

    const shift = this._shift;
    let minY = Infinity;
    let maxY = -Infinity;
    const stop = to + shift;

    for (let i = from + shift; i < stop; ) {
      let width = 1;
      let lo = NaN;
      let hi = NaN;
      for (let L = this.levels.length - 1; L >= 0; L--) {
        const w = this.bucketSize ** (L + 1);
        if (i % w === 0 && i + w <= stop && i / w < this.lengths[L]!) {
          width = w;
          lo = this.levels[L]![(i / w) * 2]!;
          hi = this.levels[L]![(i / w) * 2 + 1]!;
          break;
        }
      }
      if (width === 1) {
        lo = hi = source.getY(i - shift);
        if (isGap(source, i - shift, lo)) lo = hi = NaN;
      }
      if (lo < minY) minY = lo;
      if (hi > maxY) maxY = hi;
      i += width;
    }

    return Number.isFinite(minY) && Number.isFinite(maxY) ? { minY, maxY } : null;
  }
}
