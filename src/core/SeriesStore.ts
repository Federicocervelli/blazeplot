import type { Dataset, AppendableDataset, LODView, Viewport, SeriesConfig, SeriesStyle, SeriesSample } from "./types.js";
import { MinMaxPyramid } from "./MinMaxPyramid.js";

export class SeriesStore {
  readonly config: SeriesConfig;
  readonly style: SeriesStyle;
  private readonly dataset: Dataset;
  private readonly pyramid: MinMaxPyramid | null;

  private _dirty: boolean = false;
  private _visible: boolean = true;

  constructor(dataset: Dataset, config: SeriesConfig, style: SeriesStyle) {
    this.dataset = dataset;
    this.config = config;
    this.pyramid = (config.mode === "line" || config.mode === "bar") && config.downsample !== "none" ? new MinMaxPyramid() : null;
    this.style = style;

    if (this.pyramid && dataset.length > 0) {
      this.pyramid.build(dataset);
    }
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
    if (this.pyramid) this.pyramid.build(this.dataset);
    this._dirty = false;
  }

  rebuildPyramid(): void {
    if (!this._dirty) return;
    if (this.pyramid) this.pyramid.incrementalBuild(this.dataset);
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

    return this.pyramid.query(viewport, pixelWidth, {
      start,
      length: Math.max(0, end - start),
    });
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

  copyAreaVisible(viewport: Viewport, target: Float32Array, maxPoints: number, baseline: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "area", baseline) * 2;
  }

  copyMinMaxVisible(viewport: Viewport, target: Float32Array, maxSegments: number): number {
    return this.copyMinMaxSegments(viewport, target, maxSegments, "line-list") * 2;
  }

  copyMinMaxInstanced(viewport: Viewport, target: Float32Array, maxSegments: number): number {
    return this.copyMinMaxSegments(viewport, target, maxSegments, "instanced");
  }

  private visibleIndexRange(viewport: Viewport | undefined): { start: number; end: number } {
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

      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = segmentStart; i < clampedEnd; i++) {
        const y = this.dataset.getY(i);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const x = this.dataset.getX(segmentStart + ((clampedEnd - segmentStart) >> 1));
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
}
