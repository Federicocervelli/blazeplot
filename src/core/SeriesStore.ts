import type { Dataset, AppendableDataset, OhlcDataset, RangeMinMaxDataset, RangeSampleCopyDataset, VisibleSampleCopyDataset, MinMaxSegmentCopyDataset, LODView, Viewport, SeriesConfig, SeriesStyle, SeriesSample } from "./types.js";
import { MinMaxPyramid } from "./MinMaxPyramid.js";

function hasRangeMinMaxY(dataset: Dataset): dataset is RangeMinMaxDataset {
  return "rangeMinMaxY" in dataset;
}

function isOhlcDataset(dataset: Dataset): dataset is OhlcDataset {
  return "getOpen" in dataset && "getHigh" in dataset && "getLow" in dataset && "getClose" in dataset;
}

function hasCopySamplesRange(dataset: Dataset): dataset is RangeSampleCopyDataset {
  return "copySamplesRange" in dataset;
}

function hasCopyMinMaxSegments(dataset: Dataset): dataset is MinMaxSegmentCopyDataset {
  return "copyMinMaxSegments" in dataset;
}

function hasCopyVisibleSamples(dataset: Dataset): dataset is VisibleSampleCopyDataset {
  return "copyVisibleSamples" in dataset;
}

const NEAREST_POINT_LEAF_SIZE = 64;

type PointSearchInterval = {
  readonly start: number;
  readonly end: number;
  readonly lowerBoundSq: number;
};

function interpolateY(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}

export class SeriesStore {
  readonly config: SeriesConfig;
  readonly style: SeriesStyle;
  private readonly dataset: Dataset;
  private readonly pyramid: MinMaxPyramid | null;

  private _dirty: boolean = false;
  private _useDatasetRangeMinMax: boolean = false;
  private _useRawMinMaxScan: boolean = false;
  private _lastBuildLength: number = 0;
  private _lastBuildRangeStart: number = NaN;
  private _visible: boolean = true;

  constructor(dataset: Dataset, config: SeriesConfig, style: SeriesStyle) {
    this.dataset = dataset;
    this.config = config;
    this.pyramid = (config.mode === "line" || config.mode === "bar") && config.downsample !== "none" ? new MinMaxPyramid() : null;
    this._useDatasetRangeMinMax = hasRangeMinMaxY(dataset);
    this.style = style;

    if (this.pyramid && dataset.length > 0 && !this._useDatasetRangeMinMax) {
      this.pyramid.build(dataset);
    }
    this._lastBuildLength = dataset.length;
    this._lastBuildRangeStart = dataset.range?.start ?? NaN;
  }

  get hasLOD(): boolean {
    return this.pyramid !== null;
  }

  get dirty(): boolean {
    return this._dirty;
  }

  get length(): number {
    return this.dataset.length;
  }

  get visible(): boolean {
    return this._visible;
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
  }

  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    if (!("push" in this.dataset)) {
      throw new TypeError("SeriesStore dataset is not appendable.");
    }

    const appendable = this.dataset as AppendableDataset;
    appendable.append(x, y);
    this._dirty = true;
  }

  clear(): void {
    if (!("clear" in this.dataset)) {
      throw new TypeError("SeriesStore dataset is not clearable.");
    }

    (this.dataset as AppendableDataset).clear();
    this._useDatasetRangeMinMax = hasRangeMinMaxY(this.dataset);
    this._useRawMinMaxScan = false;
    if (this.pyramid && !this._useDatasetRangeMinMax) this.pyramid.build(this.dataset);
    this._lastBuildLength = this.dataset.length;
    this._lastBuildRangeStart = this.dataset.range?.start ?? NaN;
    this._dirty = false;
  }

  rebuildPyramid(): void {
    if (!this._dirty) return;
    if (this.pyramid) {
      const length = this.dataset.length;
      const rangeStart = this.dataset.range?.start ?? NaN;
      const shiftedAtCapacity = length === this._lastBuildLength && rangeStart !== this._lastBuildRangeStart;
      if (hasRangeMinMaxY(this.dataset)) {
        this._useDatasetRangeMinMax = true;
        this._useRawMinMaxScan = false;
      } else if (shiftedAtCapacity) {
        this._useDatasetRangeMinMax = false;
        this._useRawMinMaxScan = true;
      } else {
        this.pyramid.incrementalBuild(this.dataset);
        this._useDatasetRangeMinMax = false;
        this._useRawMinMaxScan = false;
      }
      this._lastBuildLength = length;
      this._lastBuildRangeStart = rangeStart;
    }
    this._dirty = false;
  }

  query(viewport: Viewport, pixelWidth: number): LODView {
    if (!this.pyramid) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel: 0 };
    }

    const range = this.dataset.range;
    if (!range) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel: 0 };
    }

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);

    const length = Math.max(0, end - start);
    if (this._useDatasetRangeMinMax) {
      return this.queryRangeMinMax(start, length, pixelWidth);
    }

    return this.pyramid.query(viewport, pixelWidth, { start, length });
  }

  visibleSampleCount(viewport: Viewport): number {
    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    return Math.max(0, end - start);
  }

  sampleAt(index: number): SeriesSample | null {
    if (index < 0 || index >= this.dataset.length) return null;
    return { index, x: this.dataset.getX(index), y: this.dataset.getY(index) };
  }

  nearestSampleByX(x: number, viewport?: Viewport): SeriesSample | null {
    const range = this.visibleIndexRange(viewport);
    if (range.start >= range.end) return null;

    const lower = this.dataset.lowerBoundX(x);
    let bestIndex = Math.min(Math.max(lower, range.start), range.end - 1);
    const prevIndex = bestIndex - 1;
    if (prevIndex >= range.start) {
      const bestDx = Math.abs(this.dataset.getX(bestIndex) - x);
      const prevDx = Math.abs(this.dataset.getX(prevIndex) - x);
      if (prevDx <= bestDx) bestIndex = prevIndex;
    }

    return this.sampleAt(bestIndex);
  }

  nearestSampleByPoint(
    x: number,
    y: number,
    viewport: Viewport,
    plotWidth: number,
    plotHeight: number,
    maxDistancePx: number = Infinity,
  ): SeriesSample | null {
    const range = this.visibleIndexRange(viewport);
    const xRange = viewport.xMax - viewport.xMin;
    const yRange = viewport.yMax - viewport.yMin;
    if (range.start >= range.end || plotWidth <= 0 || plotHeight <= 0 || xRange <= 0 || yRange <= 0) return null;

    const xScale = plotWidth / xRange;
    const yScale = plotHeight / yRange;
    let bestIndex = -1;
    let bestDistanceSq = maxDistancePx < 0
      ? -1
      : Number.isFinite(maxDistancePx)
        ? maxDistancePx * maxDistancePx
        : Infinity;

    const visitSample = (index: number): void => {
      const dx = (this.dataset.getX(index) - x) * xScale;
      const dy = (this.dataset.getY(index) - y) * yScale;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistanceSq || (bestIndex < 0 && d2 <= bestDistanceSq)) {
        bestDistanceSq = d2;
        bestIndex = index;
      }
    };

    const lower = this.dataset.lowerBoundX(x);
    const nearest = Math.min(Math.max(lower, range.start), range.end - 1);
    visitSample(nearest);
    if (nearest > range.start) visitSample(nearest - 1);
    if (nearest + 1 < range.end) visitSample(nearest + 1);

    if (this.hasPointIntervalBounds() && range.end - range.start > NEAREST_POINT_LEAF_SIZE) {
      const rootBound = this.pointIntervalDistanceSq(range.start, range.end, x, y, xScale, yScale);
      const stack: PointSearchInterval[] = rootBound <= bestDistanceSq
        ? [{ start: range.start, end: range.end, lowerBoundSq: rootBound }]
        : [];

      while (stack.length > 0) {
        const interval = stack.pop()!;
        if (interval.lowerBoundSq > bestDistanceSq) continue;

        const length = interval.end - interval.start;
        if (length <= NEAREST_POINT_LEAF_SIZE) {
          for (let i = interval.start; i < interval.end; i++) visitSample(i);
          continue;
        }

        const mid = interval.start + (length >> 1);
        const leftBound = this.pointIntervalDistanceSq(interval.start, mid, x, y, xScale, yScale);
        const rightBound = this.pointIntervalDistanceSq(mid, interval.end, x, y, xScale, yScale);
        const left: PointSearchInterval = { start: interval.start, end: mid, lowerBoundSq: leftBound };
        const right: PointSearchInterval = { start: mid, end: interval.end, lowerBoundSq: rightBound };

        if (leftBound < rightBound) {
          if (rightBound <= bestDistanceSq) stack.push(right);
          if (leftBound <= bestDistanceSq) stack.push(left);
        } else {
          if (leftBound <= bestDistanceSq) stack.push(left);
          if (rightBound <= bestDistanceSq) stack.push(right);
        }
      }
    } else {
      let left = Math.min(lower - 1, range.end - 1);
      let right = Math.max(lower, range.start);
      while (left >= range.start || right < range.end) {
        const leftDxSq = left >= range.start ? this.pointXDistanceSq(left, x, xScale) : Infinity;
        const rightDxSq = right < range.end ? this.pointXDistanceSq(right, x, xScale) : Infinity;
        if (leftDxSq > bestDistanceSq && rightDxSq > bestDistanceSq) break;

        if (leftDxSq <= rightDxSq) {
          if (leftDxSq <= bestDistanceSq) visitSample(left);
          left--;
        } else {
          if (rightDxSq <= bestDistanceSq) visitSample(right);
          right++;
        }
      }
    }

    if (bestIndex < 0) return null;
    const sample = this.sampleAt(bestIndex);
    return sample ? { ...sample, distancePx: Math.sqrt(bestDistanceSq) } : null;
  }

  copyRawVisible(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "points", 0, xOrigin);
  }

  copyRawVisibleClipped(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0): number {
    return this.copyClippedVisibleLine(viewport, target, maxPoints, xOrigin, "data");
  }

  copyRawVisibleClipSpace(viewport: Viewport, target: Float32Array, maxPoints: number): number {
    return this.copyClippedVisibleLine(viewport, target, maxPoints, 0, "clip");
  }

  copyRawRange(start: number, end: number, target: Float32Array, maxPoints: number, xOrigin: number = 0): number {
    return this.copySampleRange(start, end, target, maxPoints, "points", 0, xOrigin);
  }

  copyAreaVisible(viewport: Viewport, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "area", baseline, xOrigin) * 2;
  }

  copyAreaRange(start: number, end: number, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0): number {
    return this.copySampleRange(start, end, target, maxPoints, "area", baseline, xOrigin) * 2;
  }

  copyMinMaxVisible(viewport: Viewport, target: Float32Array, maxSegments: number, xOrigin: number = 0): number {
    return this.copyMinMaxSegments(viewport, target, maxSegments, "line-list", xOrigin) * 2;
  }

  copyMinMaxInstanced(viewport: Viewport, target: Float32Array, maxSegments: number, xOrigin: number = 0): number {
    return this.copyMinMaxSegments(viewport, target, maxSegments, "instanced", xOrigin);
  }

  copyOhlcRange(start: number, end: number, target: Float32Array, maxCandles: number, tickWidth: number, xOrigin: number = 0): number {
    if (!isOhlcDataset(this.dataset) || maxCandles <= 0 || target.length < maxCandles * 12) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    const count = Math.min(maxCandles, Math.max(0, to - from));
    const halfTick = tickWidth * 0.5;
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const x = this.dataset.getX(index) - xOrigin;
      const open = this.dataset.getOpen(index);
      const high = this.dataset.getHigh(index);
      const low = this.dataset.getLow(index);
      const close = this.dataset.getClose(index);
      const offset = i * 12;
      target[offset] = x;
      target[offset + 1] = low;
      target[offset + 2] = x;
      target[offset + 3] = high;
      target[offset + 4] = x - halfTick;
      target[offset + 5] = open;
      target[offset + 6] = x;
      target[offset + 7] = open;
      target[offset + 8] = x;
      target[offset + 9] = close;
      target[offset + 10] = x + halfTick;
      target[offset + 11] = close;
    }

    return count;
  }

  copyOhlcTuplesRange(start: number, end: number, target: Float32Array, maxCandles: number, xOrigin: number = 0): number {
    if (!isOhlcDataset(this.dataset) || maxCandles <= 0 || target.length < maxCandles * 5) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    const count = Math.min(maxCandles, Math.max(0, to - from));
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const offset = i * 5;
      target[offset] = this.dataset.getX(index) - xOrigin;
      target[offset + 1] = this.dataset.getOpen(index);
      target[offset + 2] = this.dataset.getHigh(index);
      target[offset + 3] = this.dataset.getLow(index);
      target[offset + 4] = this.dataset.getClose(index);
    }

    return count;
  }

  visibleIndexRange(viewport: Viewport | undefined, outerPadding: number = 0): { start: number; end: number } {
    if (!viewport) return { start: 0, end: this.dataset.length };
    const pad = Math.max(0, Math.floor(outerPadding));
    return {
      start: Math.max(0, this.dataset.lowerBoundX(viewport.xMin) - pad),
      end: Math.min(this.dataset.length, this.dataset.upperBoundX(viewport.xMax) + pad),
    };
  }

  private pointXDistanceSq(index: number, x: number, xScale: number): number {
    const dx = (this.dataset.getX(index) - x) * xScale;
    return dx * dx;
  }

  private pointIntervalDistanceSq(
    start: number,
    end: number,
    x: number,
    y: number,
    xScale: number,
    yScale: number,
  ): number {
    if (end <= start) return Infinity;

    const x0 = this.dataset.getX(start);
    const x1 = this.dataset.getX(end - 1);
    const dx = x < x0 ? (x0 - x) * xScale : x > x1 ? (x - x1) * xScale : 0;

    const range = this.pointIntervalMinMaxY(start, end);
    if (!range) return Infinity;

    const dy = y < range.minY ? (range.minY - y) * yScale : y > range.maxY ? (y - range.maxY) * yScale : 0;
    return dx * dx + dy * dy;
  }

  private hasPointIntervalBounds(): boolean {
    return hasRangeMinMaxY(this.dataset) || (this.pyramid !== null && !this._dirty && !this._useRawMinMaxScan);
  }

  private pointIntervalMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    if (hasRangeMinMaxY(this.dataset)) return this.dataset.rangeMinMaxY(start, end);
    if (this.pyramid && !this._dirty && !this._useRawMinMaxScan) return this.pyramid.rangeMinMax(this.dataset, start, end);
    return null;
  }

  private copyClippedVisibleLine(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
    output: "data" | "clip",
  ): number {
    if (maxPoints <= 0 || target.length < maxPoints * 2) return 0;

    const xRange = viewport.xMax - viewport.xMin;
    const yRange = viewport.yMax - viewport.yMin;
    if (output === "clip" && (xRange <= 0 || yRange <= 0)) return 0;

    const start = Math.max(0, this.dataset.lowerBoundX(viewport.xMin) - 1);
    const end = Math.min(this.dataset.length, this.dataset.upperBoundX(viewport.xMax) + 1);
    if (end - start <= 0) return 0;

    let count = 0;
    let lastX = NaN;
    let lastY = NaN;
    const addPoint = (x: number, y: number): boolean => {
      const outX = output === "clip" ? ((x - viewport.xMin) / xRange) * 2 - 1 : x - xOrigin;
      const outY = output === "clip" ? ((y - viewport.yMin) / yRange) * 2 - 1 : y;
      if (count > 0 && outX === lastX && outY === lastY) return true;
      if (count >= maxPoints) return false;
      const offset = count * 2;
      target[offset] = outX;
      target[offset + 1] = outY;
      count++;
      lastX = outX;
      lastY = outY;
      return true;
    };

    if (end - start === 1) {
      const x = this.dataset.getX(start);
      if (x < viewport.xMin || x > viewport.xMax) return 0;
      return addPoint(x, this.dataset.getY(start)) ? count : 0;
    }

    for (let i = start; i + 1 < end; i++) {
      const x0 = this.dataset.getX(i);
      const y0 = this.dataset.getY(i);
      const x1 = this.dataset.getX(i + 1);
      const y1 = this.dataset.getY(i + 1);
      if (x1 < viewport.xMin || x0 > viewport.xMax) continue;

      const clippedX0 = Math.max(x0, viewport.xMin);
      const clippedX1 = Math.min(x1, viewport.xMax);
      if (clippedX1 < clippedX0) continue;
      const clippedY0 = interpolateY(x0, y0, x1, y1, clippedX0);
      const clippedY1 = interpolateY(x0, y0, x1, y1, clippedX1);
      if (!addPoint(clippedX0, clippedY0) || !addPoint(clippedX1, clippedY1)) break;
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
  ): number {
    if (hasCopyVisibleSamples(this.dataset)) {
      return this.dataset.copyVisibleSamples(viewport, target, maxPoints, layout, baseline, xOrigin);
    }

    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const stride = Math.max(1, Math.ceil(visible / maxPoints));
    let count = 0;
    for (let i = start; i < end && count < maxPoints; i += stride) {
      const x = this.dataset.getX(i) - xOrigin;
      const y = this.dataset.getY(i);
      if (layout === "points") {
        const offset = count * 2;
        target[offset] = x;
        target[offset + 1] = y;
      } else {
        const offset = count * 4;
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = y;
      }
      count++;
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
  ): number {
    if (hasCopySamplesRange(this.dataset)) {
      return this.dataset.copySamplesRange(start, end, target, maxPoints, layout, baseline, xOrigin);
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
      if (layout === "points") {
        const offset = i * 2;
        target[offset] = x;
        target[offset + 1] = y;
      } else {
        const offset = i * 4;
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = y;
      }
    }

    return count;
  }

  private copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    layout: "line-list" | "instanced",
    xOrigin: number,
  ): number {
    if (hasCopyMinMaxSegments(this.dataset)) {
      return this.dataset.copyMinMaxSegments(viewport, target, maxSegments, layout, xOrigin);
    }

    const floatsPerSegment = layout === "line-list" ? 4 : 3;
    if (!this.pyramid || maxSegments <= 0 || target.length < maxSegments * floatsPerSegment) return 0;

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const segmentCount = Math.min(maxSegments, visible);
    for (let segment = 0; segment < segmentCount; segment++) {
      const segmentStart = start + Math.floor((segment * visible) / segmentCount);
      const segmentEnd = start + Math.max(
        Math.floor(((segment + 1) * visible) / segmentCount),
        Math.floor((segment * visible) / segmentCount) + 1,
      );
      const clampedEnd = Math.min(end, segmentEnd);

      const range = this.minMaxForRange(segmentStart, clampedEnd);
      if (!range) continue;

      const x = this.dataset.getX(segmentStart + ((clampedEnd - segmentStart) >> 1)) - xOrigin;
      const { minY, maxY } = range;
      if (layout === "line-list") {
        const offset = segment * 4;
        target[offset] = x;
        target[offset + 1] = minY;
        target[offset + 2] = x;
        target[offset + 3] = maxY;
      } else {
        const offset = segment * 3;
        target[offset] = x;
        target[offset + 1] = minY;
        target[offset + 2] = maxY;
      }
    }

    return segmentCount;
  }

  private minMaxForRange(start: number, end: number): { minY: number; maxY: number } | null {
    if (this._useDatasetRangeMinMax && hasRangeMinMaxY(this.dataset)) {
      return this.dataset.rangeMinMaxY(start, end);
    }
    if (!this.pyramid || this._useRawMinMaxScan) {
      return this.rawMinMaxForRange(start, end);
    }
    return this.pyramid.rangeMinMax(this.dataset, start, end);
  }

  private queryRangeMinMax(start: number, length: number, pixelWidth: number): LODView {
    if (pixelWidth <= 0 || length <= 0 || !hasRangeMinMaxY(this.dataset)) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel: 0 };
    }

    const samplesPerPixel = Math.max(1, length / pixelWidth);
    const level = Math.max(0, Math.ceil(Math.log2(samplesPerPixel)) - 1);
    const bucketSampleWidth = 2 ** (level + 1);
    const queryStart = Math.max(0, start);
    const queryEnd = queryStart + length;
    const maxBucketCount = Math.ceil(this.dataset.length / bucketSampleWidth);
    const bucketStart = Math.max(0, Math.floor(queryStart / bucketSampleWidth));
    const bucketEnd = Math.min(maxBucketCount, Math.ceil(queryEnd / bucketSampleWidth));
    const bucketCount = Math.max(0, bucketEnd - bucketStart);
    const buckets = new Float32Array(bucketCount * 2);

    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const sourceBucket = bucketStart + bucket;
      const rangeStart = sourceBucket * bucketSampleWidth;
      const rangeEnd = Math.min(this.dataset.length, rangeStart + bucketSampleWidth);
      const range = this.dataset.rangeMinMaxY(rangeStart, rangeEnd);
      if (!range) continue;
      buckets[bucket * 2] = range.minY;
      buckets[bucket * 2 + 1] = range.maxY;
    }

    return { buckets, bucketCount, level, samplesPerPixel };
  }

  private rawMinMaxForRange(start: number, end: number): { minY: number; maxY: number } | null {
    if (hasRangeMinMaxY(this.dataset)) return this.dataset.rangeMinMaxY(start, end);

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    if (to <= from) return null;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const y = this.dataset.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minY, maxY };
  }
}
