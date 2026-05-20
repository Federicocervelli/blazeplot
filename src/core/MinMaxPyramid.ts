import type { Dataset, LODView, Viewport } from "./types.js";

const MAX_LEVELS = 16;

function isGap(source: Dataset, index: number, y: number): boolean {
  return !Number.isFinite(y) || source.isGap?.(index) === true;
}

export class MinMaxPyramid {
  private levels: Float32Array[] = [];
  private levelLengths: Uint32Array;
  private levelSampleWidths: Uint32Array;
  private _builtLen: number = 0;
  private _lastRangeStart: number = NaN;

  constructor(readonly bucketSize: number = 2) {
    if (!Number.isInteger(bucketSize) || bucketSize < 2) {
      throw new RangeError("MinMaxPyramid bucketSize must be an integer >= 2.");
    }

    this.levelLengths = new Uint32Array(MAX_LEVELS);
    this.levelSampleWidths = new Uint32Array(MAX_LEVELS);
  }

  build(source: Dataset): void {
    this.levels = [];
    this.levelLengths.fill(0);
    this.levelSampleWidths.fill(0);

    let srcLen = source.length;
    if (srcLen === 0) {
      this._builtLen = 0;
      this._lastRangeStart = NaN;
      return;
    }

    let prevLevel: Float32Array | null = null;
    let level = 0;

    while (srcLen > 0 && level < MAX_LEVELS) {
      const nextLen = Math.ceil(srcLen / this.bucketSize);
      const levelData = new Float32Array(nextLen * 2);

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

  incrementalBuild(source: Dataset): void {
    const newLen = source.length;
    const rangeStart = source.range?.start ?? NaN;

    if (newLen === 0) {
      this.levels = [];
      this.levelLengths.fill(0);
      this.levelSampleWidths.fill(0);
      this._builtLen = 0;
      this._lastRangeStart = NaN;
      return;
    }

    if (newLen < this._builtLen || rangeStart !== this._lastRangeStart) {
      this.build(source);
      return;
    }

    if (newLen === this._builtLen) return;

    this.appendTail(source, newLen - this._builtLen);
    this._builtLen = newLen;
  }

  private appendTail(source: Dataset, appendedCount: number): void {
    const newLen = source.length;
    const W = this.bucketSize;
    let changedIdx = newLen - appendedCount;

    for (let L = 0; L < MAX_LEVELS; L++) {
      const items: number = L === 0 ? newLen : this.levelLengths[L - 1]!;
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
          for (let j = start; j < end; j++) {
            const y = source.getY(j);
            if (isGap(source, j, y)) continue;
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

    const next = new Float32Array(nextLength);
    if (current) {
      next.set(current);
    }
    this.levels[level] = next;
  }

  rangeMinMax(source: Dataset, start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(source.length, Math.ceil(end));
    if (to <= from) return null;

    let minY = Infinity;
    let maxY = -Infinity;
    let i = from;

    while (i < to) {
      let level = -1;
      let width = 1;
      for (let L = this.levels.length - 1; L >= 0; L--) {
        const sampleWidth = this.levelSampleWidths[L]!;
        const bucket = Math.floor(i / sampleWidth);
        if (
          sampleWidth > 0 &&
          i % sampleWidth === 0 &&
          i + sampleWidth <= to &&
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
        const y = source.getY(i);
        if (!isGap(source, i, y)) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        i++;
      }
    }

    return Number.isFinite(minY) && Number.isFinite(maxY) ? { minY, maxY } : null;
  }

  query(_viewport: Viewport, pixelWidth: number, xRange: { start: number; length: number }): LODView {
    if (pixelWidth <= 0 || xRange.length <= 0) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel: 0 };
    }

    const visibleSamples = xRange.length;
    const samplesPerPixel = Math.max(1, visibleSamples / pixelWidth);
    const level = Math.min(
      Math.max(0, Math.ceil(Math.log2(samplesPerPixel)) - 1),
      this.levels.length - 1,
    );

    const levelData = this.levels[level];
    const levelLen = this.levelLengths[level];
    const sampleWidth = this.levelSampleWidths[level];
    if (!levelData || levelLen === undefined || sampleWidth === undefined || levelLen === 0 || sampleWidth === 0) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel };
    }

    const queryStart = Math.max(0, xRange.start);
    const queryEnd = queryStart + xRange.length;
    const bucketStart = Math.max(0, Math.floor(queryStart / sampleWidth));
    const bucketEnd = Math.min(levelLen, Math.ceil(queryEnd / sampleWidth));
    const count = bucketEnd - bucketStart;

    if (count <= 0) {
      return { buckets: new Float32Array(0), bucketCount: 0, level, samplesPerPixel };
    }

    const result = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const j = (bucketStart + i) * 2;
      const minY = levelData[j]!;
      const maxY = levelData[j + 1]!;
      result[i * 2] = Number.isFinite(minY) ? minY : NaN;
      result[i * 2 + 1] = Number.isFinite(maxY) ? maxY : NaN;
    }

    return { buckets: result, bucketCount: count, level, samplesPerPixel };
  }
}
