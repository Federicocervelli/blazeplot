import type { SeriesConfig, SeriesStyle, LODView, Viewport } from "./types.js";
import { RingBuffer } from "./RingBuffer.js";
import { MinMaxPyramid } from "./MinMaxPyramid.js";

export class SeriesStore {
  readonly config: SeriesConfig;
  readonly style: SeriesStyle;
  private readonly buffer: RingBuffer;
  private readonly pyramid: MinMaxPyramid;

  private _dirty: boolean = false;
  private _visible: boolean = true;

  constructor(config: SeriesConfig, style: SeriesStyle) {
    this.config = config;
    this.buffer = new RingBuffer(config.capacity);
    this.pyramid = new MinMaxPyramid();
    this.style = style;
  }

  get dirty(): boolean {
    return this._dirty;
  }

  get length(): number {
    return this.buffer.length;
  }

  get visible(): boolean {
    return this._visible;
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
  }

  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) {
      this.buffer.push(x[i]!, y[i]!);
    }
    this._dirty = true;
  }

  clear(): void {
    this.buffer.clear();
    this.pyramid.build(this.buffer);
    this._dirty = false;
  }

  rebuildPyramid(): void {
    if (!this._dirty) return;
    this.pyramid.build(this.buffer);
    this._dirty = false;
  }

  query(viewport: Viewport, pixelWidth: number): LODView {
    const range = this.buffer.range;
    if (!range) {
      return { buckets: new Float32Array(0), bucketCount: 0, level: 0, samplesPerPixel: 0 };
    }

    const start = this.buffer.lowerBoundX(viewport.xMin);
    const end = this.buffer.upperBoundX(viewport.xMax);

    return this.pyramid.query(viewport, pixelWidth, {
      start,
      length: Math.max(0, end - start),
    });
  }

  visibleSampleCount(viewport: Viewport): number {
    const start = this.buffer.lowerBoundX(viewport.xMin);
    const end = this.buffer.upperBoundX(viewport.xMax);
    return Math.max(0, end - start);
  }

  copyRawVisible(viewport: Viewport, target: Float32Array, maxPoints: number): number {
    if (maxPoints <= 0 || target.length < maxPoints * 2) return 0;

    const start = this.buffer.lowerBoundX(viewport.xMin);
    const end = this.buffer.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const stride = Math.max(1, Math.ceil(visible / maxPoints));
    let count = 0;
    for (let i = start; i < end && count < maxPoints; i += stride) {
      target[count * 2] = this.buffer.getX(i);
      target[count * 2 + 1] = this.buffer.getY(i);
      count++;
    }

    return count;
  }

  copyMinMaxVisible(viewport: Viewport, target: Float32Array, maxSegments: number): number {
    if (maxSegments <= 0 || target.length < maxSegments * 4) return 0;

    const start = this.buffer.lowerBoundX(viewport.xMin);
    const end = this.buffer.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const segmentCount = Math.min(maxSegments, visible);
    let vertexCount = 0;
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
        const y = this.buffer.getY(i);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const x = this.buffer.getX(segmentStart + ((clampedEnd - segmentStart) >> 1));
      target[vertexCount * 2] = x;
      target[vertexCount * 2 + 1] = minY;
      vertexCount++;
      target[vertexCount * 2] = x;
      target[vertexCount * 2 + 1] = maxY;
      vertexCount++;
    }

    return vertexCount;
  }
}
