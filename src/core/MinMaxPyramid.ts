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
  private levelLengths: Uint32Array;
  private levelSampleWidths: Uint32Array;
  private _builtLen: number = 0;
  private _lastRangeStart: number = NaN;

  /** Create a min/max pyramid using fixed-size buckets. */
  constructor(readonly bucketSize: number = 2) {
    if (!Number.isInteger(bucketSize) || bucketSize < 2) {
      throw new RangeError("MinMaxPyramid bucketSize must be an integer >= 2.");
    }

    this.levelLengths = new Uint32Array(MAX_LEVELS);
    this.levelSampleWidths = new Uint32Array(MAX_LEVELS);
  }

  /** Rebuild all pyramid levels from the source dataset. */
  build(source: Dataset): void {
    this.levels = [];
    this._shift = 0;
    this.levelLengths.fill(0);
    this.levelSampleWidths.fill(0);

    let srcLen = source.length;
    if (srcLen === 0) {
      this._builtLen = 0;
      this._lastRangeStart = NaN;
      return;
    }

    let prevLevel: Float64Array | null = null;
    let level = 0;

    while (srcLen > 0 && level < MAX_LEVELS) {
      const nextLen = Math.ceil(srcLen / this.bucketSize);
      const levelData = new Float64Array(nextLen * 2);

      for (let i = 0; i < srcLen; i += this.bucketSize) {
        let minY = Infinity;
        let maxY = -Infinity;
        const end = Math.min(i + this.bucketSize, srcLen);
        for (let j = i; j < end; j++) {
          if (prevLevel) {
            const prevMin = prevLevel[j * 2]!;
            const prevMax = prevLevel[j * 2 + 1]!;
            if (prevMin < minY) minY = prevMin;
            if (prevMax > maxY) maxY = prevMax;
          } else {
            const y = source.getY(j);
            if (isGap(source, j, y)) continue;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        const outIdx = Math.floor(i / this.bucketSize);
        levelData[outIdx * 2] = minY;
        levelData[outIdx * 2 + 1] = maxY;
      }

      this.levels[level] = levelData;
      this.levelLengths[level] = nextLen;
      this.levelSampleWidths[level] = this.bucketSize ** (level + 1);

      if (nextLen === 1) break;

      prevLevel = levelData;
      srcLen = nextLen;
      level++;
    }

    this._builtLen = source.length;
    this._lastRangeStart = source.range?.start ?? NaN;
  }

  /**
   * Extend pyramid levels after new samples are appended. `shiftBy` is the number of samples a full ring
   * dropped from the front since the last build (its ordinal advance); the caller must know it exactly.
   */
  incrementalBuild(source: Dataset, shiftBy: number = 0): void {
    const newLen = source.length;
    const rangeStart = source.range?.start ?? NaN;

    if (newLen === 0) {
      this.levels = [];
      this._shift = 0;
      this.levelLengths.fill(0);
      this.levelSampleWidths.fill(0);
      this._builtLen = 0;
      this._lastRangeStart = NaN;
      return;
    }

    const oldTotal = this._shift + this._builtLen;
    const newShift = this._shift + shiftBy;
    const newTotal = newShift + newLen;
    if (
      shiftBy < 0 ||
      newTotal < oldTotal ||
      (shiftBy === 0 && (newLen < this._builtLen || rangeStart !== this._lastRangeStart)) ||
      newShift > Math.max(newLen, 64)
    ) {
      this.build(source);
      return;
    }

    if (newTotal === oldTotal) {
      this._lastRangeStart = rangeStart;
      return;
    }

    this._shift = newShift;
    this.appendTail(source, oldTotal);
    this._builtLen = newLen;
    this._lastRangeStart = rangeStart;
  }

  /** Recompute buckets from pyramid-space position `fromP` to the end of the data. */
  private appendTail(source: Dataset, fromP: number): void {
    const shift = this._shift;
    const total = shift + source.length;
    const W = this.bucketSize;
    let changedIdx = fromP;

    for (let L = 0; L < MAX_LEVELS; L++) {
      const items: number = L === 0 ? total : this.levelLengths[L - 1]!;
      const first = Math.floor(changedIdx / W);
      const last = Math.ceil(items / W) - 1;

      if (first > last) break;

      this.levelSampleWidths[L] = W ** (L + 1);
      this.ensureLevelData(L, last + 1);

      for (let b = first; b <= last; b++) {
        const start = b * W;
        const end = Math.min((b + 1) * W, items);

        let minY = Infinity;
        let maxY = -Infinity;

        if (L === 0) {
          for (let j = Math.max(start, shift); j < end; j++) {
            const y = source.getY(j - shift);
            if (isGap(source, j - shift, y)) continue;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        } else {
          const prev = this.levels[L - 1]!;
          for (let j = start; j < end; j++) {
            const pMin = prev[j * 2]!;
            const pMax = prev[j * 2 + 1]!;
            if (pMin < minY) minY = pMin;
            if (pMax > maxY) maxY = pMax;
          }
        }

        const dst = this.levels[L]!;
        dst[b * 2] = minY;
        dst[b * 2 + 1] = maxY;
      }

      this.levelLengths[L] = last + 1;
      changedIdx = first;

      if (this.levelLengths[L]! <= 1) break;
    }
  }

  private ensureLevelData(level: number, minBuckets: number): void {
    const needed = minBuckets * 2;
    const current = this.levels[level];
    if (current && current.length >= needed) return;

    let nextLength = current?.length ?? 0;
    if (nextLength <= 0) {
      nextLength = needed;
    } else {
      while (nextLength < needed) {
        nextLength = Math.max(needed, Math.ceil(nextLength * 1.5));
      }
    }

    const next = new Float64Array(nextLength);
    if (current) {
      next.set(current);
    }
    this.levels[level] = next;
  }

  /** Return min/max Y values for a source index range. */
  rangeMinMax(source: Dataset, start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(source.length, Math.ceil(end));
    if (to <= from) return null;

    const shift = this._shift;
    let minY = Infinity;
    let maxY = -Infinity;
    let i = from + shift;
    const stop = to + shift;

    while (i < stop) {
      let level = -1;
      let width = 1;
      for (let L = this.levels.length - 1; L >= 0; L--) {
        const sampleWidth = this.levelSampleWidths[L]!;
        const bucket = Math.floor(i / sampleWidth);
        if (
          sampleWidth > 0 &&
          i % sampleWidth === 0 &&
          i + sampleWidth <= stop &&
          bucket < this.levelLengths[L]!
        ) {
          level = L;
          width = sampleWidth;
          break;
        }
      }

      if (level >= 0) {
        const bucket = Math.floor(i / width);
        const data = this.levels[level]!;
        const pMin = data[bucket * 2]!;
        const pMax = data[bucket * 2 + 1]!;
        if (pMin < minY) minY = pMin;
        if (pMax > maxY) maxY = pMax;
        i += width;
      } else {
        const y = source.getY(i - shift);
        if (!isGap(source, i - shift, y)) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        i++;
      }
    }

    return Number.isFinite(minY) && Number.isFinite(maxY) ? { minY, maxY } : null;
  }
}
