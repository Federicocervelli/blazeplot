import type { MinMaxY } from "./MinMaxTree.js";
import { honorsYOrigin, shiftY, AREA_Y_OFFSETS, MINMAX_Y_OFFSETS, POINT_Y_OFFSETS } from "./datasetCaps.js";
import type { DatasetCaps } from "./datasetCaps.js";
import type { SeriesLod } from "./SeriesLod.js";
import { SeriesSource } from "./SeriesSource.js";
import type { Dataset, Viewport } from "./types.js";

const RAW_SCRATCH_BLOCK = 2048;
const RAW_SCRATCH_X = new Float64Array(RAW_SCRATCH_BLOCK + 1);
const RAW_SCRATCH_Y = new Float64Array(RAW_SCRATCH_BLOCK + 1);

function interpolateY(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}

/**
 * Extracts render-ready line, area, min/max, and OHLC vertices from a series' dataset: raw visible
 * ranges, X-clipped chunks, dense min/max buckets, and stable stride decimation. Scatter points use
 * `ScatterSampler`.
 */
export class SeriesSampler extends SeriesSource {
  constructor(dataset: Dataset, caps: DatasetCaps, lod: SeriesLod, private readonly downsampled: boolean) {
    super(dataset, caps, lod);
  }

  /** @internal Copy stable, viewport-anchored XY samples into a render buffer. */
  copyRawVisible(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "points", 0, xOrigin, yOrigin);
  }

  /** @internal Copy visible XY samples with the line clipped to the viewport's X edges. */
  copyRawVisibleClipped(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.copyRawClippedChunk(viewport, 0, target, maxPoints, xOrigin, yOrigin).count;
  }

  /**
   * @internal Copy one chunk of the X-clipped line starting at logical index `start`.
   * Returns the vertex count and the index to resume from (`done` once the visible range is exhausted).
   * Each chunk holds whole segments, so consecutive chunks join without a seam gap.
   */
  copyRawClippedChunk(
    viewport: Viewport,
    start: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number = 0,
    yOrigin: number = 0,
  ): { count: number; next: number; done: boolean } {
    if (maxPoints < 2 || target.length < maxPoints * 2) return { count: 0, next: start, done: true };

    const range = this.visibleIndexRange(viewport, 1);
    const from = Math.max(range.start, start);
    const end = range.end;
    if (end - from <= 0) return { count: 0, next: end, done: true };

    if (range.end - range.start === 1) {
      const x = this.dataset.getX(from);
      const y = this.dataset.getY(from);
      if (x < viewport.xMin || x > viewport.xMax || this.isGap(from, y)) return { count: 0, next: end, done: true };
      target[0] = x - xOrigin;
      target[1] = y - yOrigin;
      return { count: 1, next: end, done: true };
    }

    // Segments are read in blocks into Float64 scratch arrays (bulk typed-array copies for built-in
    // datasets) so the hot loop below makes no per-sample calls. Gap samples become NaN in the scratch.
    const dataset = this.dataset;
    const reader = this.caps.readXY;
    const gaps = reader ? null : this.caps.gaps;
    const xs = RAW_SCRATCH_X;
    const ys = RAW_SCRATCH_Y;
    const xMin = viewport.xMin;
    const xMax = viewport.xMax;
    let count = 0;
    let lastX = NaN;
    let lastY = NaN;
    let lastWasGap = false;

    let i = from;
    while (i + 1 < end) {
      const blockEnd = Math.min(end, i + RAW_SCRATCH_BLOCK + 1);
      const n = blockEnd - i;
      if (reader) {
        reader.readXYRange(i, blockEnd, xs, ys);
      } else {
        for (let k = 0; k < n; k++) {
          const index = i + k;
          xs[k] = dataset.getX(index);
          ys[k] = gaps !== null && gaps.isGap(index) ? NaN : dataset.getY(index);
        }
      }

      let x0 = xs[0]!;
      let y0 = ys[0]!;
      for (let k = 0; k + 1 < n; k++, i++) {
        // A segment emits at most two points; stop before the buffer could overflow.
        if (count + 2 > maxPoints) return { count, next: i, done: false };
        const x1 = xs[k + 1]!;
        const y1 = ys[k + 1]!;
        const sx0 = x0;
        const sy0 = y0;
        x0 = x1;
        y0 = y1;
        if (x1 < xMin || sx0 > xMax) continue;
        if (!Number.isFinite(sy0) || !Number.isFinite(y1)) {
          if (count !== 0 && !lastWasGap) {
            const offset = count * 2;
            target[offset] = NaN;
            target[offset + 1] = NaN;
            count++;
            lastX = NaN;
            lastY = NaN;
            lastWasGap = true;
          }
          continue;
        }

        const clippedX0 = sx0 > xMin ? sx0 : xMin;
        const clippedX1 = x1 < xMax ? x1 : xMax;
        if (clippedX1 < clippedX0) continue;
        const yA = interpolateY(sx0, sy0, x1, y1, clippedX0);
        const yB = interpolateY(sx0, sy0, x1, y1, clippedX1);
        const outX0 = clippedX0 - xOrigin;
        if (lastWasGap || count === 0 || outX0 !== lastX || yA !== lastY) {
          const offset = count * 2;
          target[offset] = outX0;
          target[offset + 1] = yA - yOrigin;
          count++;
          lastWasGap = false;
        }
        const outX1 = clippedX1 - xOrigin;
        if (outX1 !== outX0 || yB !== yA) {
          const offset = count * 2;
          target[offset] = outX1;
          target[offset + 1] = yB - yOrigin;
          count++;
        }
        lastX = outX1;
        lastY = yB;
      }
    }

    return { count, next: i, done: true };
  }

  /** @internal Copy a logical XY range into a render buffer; gaps are written as NaN. */
  copyRawRange(start: number, end: number, target: Float32Array, maxPoints: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.copySampleRange(start, end, target, maxPoints, "points", 0, xOrigin, yOrigin);
  }

  /** @internal Copy stable, viewport-anchored area strip vertices; returns the vertex count. */
  copyAreaVisible(viewport: Viewport, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "area", baseline, xOrigin, yOrigin) * 2;
  }

  /** @internal Copy an area strip for a logical index range; returns the vertex count. */
  copyAreaRange(start: number, end: number, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.copySampleRange(start, end, target, maxPoints, "area", baseline, xOrigin, yOrigin) * 2;
  }

  /** @internal Copy visible `[x, minY, maxY]` bucket triples into a render buffer. */
  copyMinMaxInstanced(viewport: Viewport, target: Float32Array, maxSegments: number, xOrigin: number = 0, yOrigin: number = 0): number {
    const segments = this.caps.minMaxSegments;
    if (segments) {
      if (honorsYOrigin(segments)) return segments.copyMinMaxSegments(viewport, target, maxSegments, xOrigin, yOrigin);
      const written = segments.copyMinMaxSegments(viewport, target, maxSegments, xOrigin);
      shiftY(target, written, 3, MINMAX_Y_OFFSETS, yOrigin);
      return written;
    }
    if (!this.downsampled || maxSegments <= 0 || target.length < maxSegments * 3) return 0;

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    if (end <= start) return 0;

    const bucketWidth = this.stableSampleBucketWidthForViewport(viewport, maxSegments);
    const alignedStart = this.alignBucketStart(start, bucketWidth);
    let written = 0;
    for (let bucketStart = alignedStart; bucketStart < end && written < maxSegments; bucketStart += bucketWidth) {
      const bucketEnd = Math.min(this.dataset.length, bucketStart + bucketWidth);
      const segmentStart = Math.max(0, bucketStart);
      if (bucketEnd <= start || segmentStart >= end) continue;

      const range = this.minMaxForRange(segmentStart, bucketEnd);
      if (!range) continue;

      const representative = Math.max(segmentStart, Math.min(bucketEnd - 1, bucketStart + (bucketWidth >> 1)));
      const offset = written * 3;
      target[offset] = this.dataset.getX(representative) - xOrigin;
      target[offset + 1] = range.minY - yOrigin;
      target[offset + 2] = range.maxY - yOrigin;
      written++;
    }

    return written;
  }

  /** @internal Copy `[x, open, high, low, close]` tuples for a logical index range; gap candles are written as all-NaN tuples. */
  copyOhlcTuplesRange(start: number, end: number, target: Float32Array, maxCandles: number, xOrigin: number = 0, yOrigin: number = 0): number {
    const ohlc = this.caps.ohlc;
    if (!ohlc || maxCandles <= 0 || target.length < maxCandles * 5) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    const count = Math.min(maxCandles, Math.max(0, to - from));
    const gaps = this.caps.gaps;
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const offset = i * 5;
      if (gaps && gaps.isGap(index)) {
        target.fill(NaN, offset, offset + 5);
        continue;
      }
      target[offset] = ohlc.getX(index) - xOrigin;
      target[offset + 1] = ohlc.getOpen(index) - yOrigin;
      target[offset + 2] = ohlc.getHigh(index) - yOrigin;
      target[offset + 3] = ohlc.getLow(index) - yOrigin;
      target[offset + 4] = ohlc.getClose(index) - yOrigin;
    }

    return count;
  }

  private copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: "points" | "area",
    baseline: number,
    xOrigin: number,
    yOrigin: number,
  ): number {
    const visible = this.caps.copyVisibleSamples;
    if (visible) {
      if (honorsYOrigin(visible)) return visible.copyVisibleSamples(viewport, target, maxPoints, layout, baseline, xOrigin, yOrigin);
      const written = visible.copyVisibleSamples(viewport, target, maxPoints, layout, baseline, xOrigin);
      shiftY(target, written, layout === "points" ? 2 : 4, layout === "points" ? POINT_Y_OFFSETS : AREA_Y_OFFSETS, yOrigin);
      return written;
    }

    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    if (end <= start) return 0;

    const stride = this.stableSampleBucketWidthForViewport(viewport, maxPoints);
    const alignedStart = this.alignBucketStart(start, stride);
    let count = 0;
    let lastIndex = -1;
    let lastWasGap = false;
    const writeGap = (): boolean => {
      if (count === 0 || lastWasGap) return true;
      if (count >= maxPoints) return false;
      const offset = count * floatsPerSample;
      for (let j = 0; j < floatsPerSample; j++) target[offset + j] = NaN;
      count++;
      lastWasGap = true;
      return true;
    };
    const writeSample = (index: number): boolean => {
      const x = this.dataset.getX(index) - xOrigin;
      const y = this.dataset.getY(index);
      if (this.isGap(index, y)) return writeGap();
      if (count >= maxPoints) return false;
      const offset = count * floatsPerSample;
      if (layout === "points") {
        target[offset] = x;
        target[offset + 1] = y - yOrigin;
      } else {
        target[offset] = x;
        target[offset + 1] = baseline - yOrigin;
        target[offset + 2] = x;
        target[offset + 3] = y - yOrigin;
      }
      count++;
      lastWasGap = false;
      return true;
    };

    for (let bucketStart = alignedStart; bucketStart < end; bucketStart += stride) {
      const bucketEnd = Math.min(end, bucketStart + stride);
      const index = Math.max(start, bucketStart);
      if (bucketEnd <= index) continue;
      if (lastIndex >= 0 && index > lastIndex + 1 && this.hasGapInRange(lastIndex + 1, index) && !writeGap()) break;
      if (!writeSample(index)) break;
      lastIndex = index;
    }

    return count;
  }

  private copySampleRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: "points" | "area",
    baseline: number,
    xOrigin: number,
    yOrigin: number,
  ): number {
    const range = this.caps.copySamplesRange;
    if (range) {
      if (honorsYOrigin(range)) return range.copySamplesRange(start, end, target, maxPoints, layout, baseline, xOrigin, yOrigin);
      const written = range.copySamplesRange(start, end, target, maxPoints, layout, baseline, xOrigin);
      shiftY(target, written, layout === "points" ? 2 : 4, layout === "points" ? POINT_Y_OFFSETS : AREA_Y_OFFSETS, yOrigin);
      return written;
    }

    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    const count = Math.min(maxPoints, Math.max(0, to - from));
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const x = this.dataset.getX(index) - xOrigin;
      const y = this.dataset.getY(index);
      const gap = this.isGap(index, y);
      if (layout === "points") {
        const offset = i * 2;
        target[offset] = gap ? NaN : x;
        target[offset + 1] = gap ? NaN : y - yOrigin;
      } else {
        const offset = i * 4;
        target[offset] = gap ? NaN : x;
        target[offset + 1] = gap ? NaN : baseline - yOrigin;
        target[offset + 2] = gap ? NaN : x;
        target[offset + 3] = gap ? NaN : y - yOrigin;
      }
    }

    return count;
  }

  private minMaxForRange(start: number, end: number): MinMaxY | null {
    const rangeMinMax = this.caps.rangeMinMax;
    if (rangeMinMax) return rangeMinMax.rangeMinMaxY(start, end);
    if (this.lod.pyramid && !this.lod.useRawScan) return this.lod.pyramid.rangeMinMax(this.dataset, start, end);

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const y = this.dataset.getY(i);
      if (this.isGap(i, y)) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return minY <= maxY ? { minY, maxY } : null;
  }
}
