import type { Dataset, AppendableDataset, RangeMinMaxDataset, LODView, Viewport, SeriesConfig, SeriesStyle, SeriesSample } from "./types.js";
import { MinMaxPyramid } from "./MinMaxPyramid.js";

function hasRangeMinMaxY(dataset: Dataset): dataset is RangeMinMaxDataset {
  return "rangeMinMaxY" in dataset;
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
  ): SeriesSample | null {
    const range = this.visibleIndexRange(viewport);
    if (range.start >= range.end || plotWidth <= 0 || plotHeight <= 0) return null;

    const xScale = plotWidth / (viewport.xMax - viewport.xMin);
    const yScale = plotHeight / (viewport.yMax - viewport.yMin);
    let bestIndex = -1;
    let bestDistanceSq = Infinity;

    for (let i = range.start; i < range.end; i++) {
      const dx = (this.dataset.getX(i) - x) * xScale;
      const dy = (this.dataset.getY(i) - y) * yScale;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistanceSq) {
        bestDistanceSq = d2;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) return null;
    const sample = this.sampleAt(bestIndex);
    return sample ? { ...sample, distancePx: Math.sqrt(bestDistanceSq) } : null;
  }

  copyRawVisible(viewport: Viewport, target: Float32Array, maxPoints: number): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "points", 0);
  }

  copyRawRange(start: number, end: number, target: Float32Array, maxPoints: number): number {
    return this.copySampleRange(start, end, target, maxPoints, "points", 0);
  }

  copyAreaVisible(viewport: Viewport, target: Float32Array, maxPoints: number, baseline: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "area", baseline) * 2;
  }

  copyAreaRange(start: number, end: number, target: Float32Array, maxPoints: number, baseline: number = 0): number {
    return this.copySampleRange(start, end, target, maxPoints, "area", baseline) * 2;
  }

  copyMinMaxVisible(viewport: Viewport, target: Float32Array, maxSegments: number): number {
    return this.copyMinMaxSegments(viewport, target, maxSegments, "line-list") * 2;
  }

  copyMinMaxInstanced(viewport: Viewport, target: Float32Array, maxSegments: number): number {
    return this.copyMinMaxSegments(viewport, target, maxSegments, "instanced");
  }

  visibleIndexRange(viewport: Viewport | undefined): { start: number; end: number } {
    if (!viewport) return { start: 0, end: this.dataset.length };
    return {
      start: this.dataset.lowerBoundX(viewport.xMin),
      end: this.dataset.upperBoundX(viewport.xMax),
    };
  }

  private copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: "points" | "area",
    baseline: number,
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const stride = Math.max(1, Math.ceil(visible / maxPoints));
    let count = 0;
    for (let i = start; i < end && count < maxPoints; i += stride) {
      const x = this.dataset.getX(i);
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
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    const count = Math.min(maxPoints, Math.max(0, to - from));
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const x = this.dataset.getX(index);
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
  ): number {
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

      const x = this.dataset.getX(segmentStart + ((clampedEnd - segmentStart) >> 1));
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
