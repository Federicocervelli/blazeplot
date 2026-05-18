import { PREVIEW_START_TIME, PREVIEW_X_STEP_MS, TRACE_PERIOD } from "./dataConfig.ts";
import type { AcceleratedDataset, AppendableDataset, MinMaxSegmentLayout, SampleCopyLayout, TimeRange, Viewport, YAppendableDataset } from "@/index.ts";

const OMEGA = (Math.PI * 2) / TRACE_PERIOD;
const BASELINE = 0.78;
const AMPLITUDE = 0.25;
const NOISE_MAX = 0.01;

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

type SampleLayout = SampleCopyLayout;
type MinMaxLayout = MinMaxSegmentLayout;

export class ProceduralLineDataset implements AppendableDataset, YAppendableDataset, AcceleratedDataset {
  readonly capacity: number;
  private _length = 0;
  private _nextX = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("ProceduralLineDataset capacity must be a positive integer.");
    }
    this.capacity = capacity;
  }

  get length(): number {
    return this._length;
  }

  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.toTime(this.firstX()), end: this.toTime(this._nextX - 1) };
  }

  push(_x: number, _y: number): void {
    this.append({ length: 1 }, { length: 1 });
  }

  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    this.appendCount(Math.min(x.length, y.length));
  }

  appendY(y: ArrayLike<number>): void {
    this.appendCount(y.length);
  }

  private appendCount(requested: number): void {
    if (requested <= 0) return;
    this._nextX += requested;
    this._length = Math.min(this.capacity, this._length + requested);
  }

  clear(): void {
    this._length = 0;
    this._nextX = 0;
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return this.toTime(this.firstX() + index);
  }

  getY(index: number): number {
    return this.yAt(this.firstX() + index);
  }

  lowerBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.ceil(this.fromTime(x) - this.firstX())));
  }

  upperBoundX(x: number): number {
    if (this._length === 0) return 0;
    return Math.max(0, Math.min(this._length, Math.floor(this.fromTime(x) - this.firstX()) + 1));
  }

  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    if (to <= from) return null;
    return this.rangeMinMaxByIndex(from, to);
  }

  copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: SampleLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    if (end <= start) return 0;

    const viewportSamples = Math.max(1, Math.ceil(this.fromTime(viewport.xMax) - this.fromTime(viewport.xMin)));
    const stride = Math.max(1, Math.ceil(viewportSamples / maxPoints));
    const firstOrdinal = this.firstX();
    const remainder = positiveModulo(firstOrdinal + start, stride);
    const alignedStart = start + positiveModulo(-remainder, stride);
    return this.copyStridedSamples(alignedStart, end, stride, target, maxPoints, layout, baseline, xOrigin);
  }

  copySamplesRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    return this.copyStridedSamples(Math.max(0, Math.floor(start)), Math.min(this._length, Math.ceil(end)), 1, target, maxPoints, layout, baseline, xOrigin);
  }

  private copyStridedSamples(
    from: number,
    to: number,
    stride: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const count = Math.min(maxPoints, Math.max(0, Math.ceil((to - from) / stride)));
    const firstOrdinal = this.firstX();

    if (layout === "points") {
      for (let i = 0, index = from; i < count; i++, index += stride) {
        const ordinal = firstOrdinal + index;
        const x = this.toTime(ordinal) - xOrigin;
        const offset = i * 2;
        target[offset] = x;
        target[offset + 1] = this.yAt(ordinal);
      }
    } else {
      for (let i = 0, index = from; i < count; i++, index += stride) {
        const ordinal = firstOrdinal + index;
        const x = this.toTime(ordinal) - xOrigin;
        const offset = i * 4;
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = this.yAt(ordinal);
      }
    }

    return count;
  }

  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    layout: MinMaxLayout,
    xOrigin: number,
  ): number {
    const floatsPerSegment = layout === "line-list" ? 4 : 3;
    if (maxSegments <= 0 || target.length < maxSegments * floatsPerSegment) return 0;

    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = end - start;
    if (visible <= 0) return 0;

    const segmentCount = Math.min(maxSegments, visible);
    const firstOrdinal = this.firstX();
    for (let segment = 0; segment < segmentCount; segment++) {
      const segmentStart = start + Math.floor((segment * visible) / segmentCount);
      const segmentEnd = Math.min(
        end,
        start + Math.max(
          Math.floor(((segment + 1) * visible) / segmentCount),
          Math.floor((segment * visible) / segmentCount) + 1,
        ),
      );
      const range = this.rangeMinMaxByIndex(segmentStart, segmentEnd)!;
      const x = this.toTime(firstOrdinal + segmentStart + ((segmentEnd - segmentStart) >> 1)) - xOrigin;

      if (layout === "line-list") {
        const offset = segment * 4;
        target[offset] = x;
        target[offset + 1] = range.minY;
        target[offset + 2] = x;
        target[offset + 3] = range.maxY;
      } else {
        const offset = segment * 3;
        target[offset] = x;
        target[offset + 1] = range.minY;
        target[offset + 2] = range.maxY;
      }
    }

    return segmentCount;
  }

  private rangeMinMaxByIndex(start: number, end: number): { minY: number; maxY: number } | null {
    if (end <= start) return null;
    const x0 = this.firstX() + start;
    const x1 = this.firstX() + end - 1;
    const phase0 = x0 * OMEGA;
    const phase1 = x1 * OMEGA;
    const sin0 = Math.sin(phase0);
    const sin1 = Math.sin(phase1);
    const minSin = this.containsSineMinimum(phase0, phase1) ? -1 : Math.min(sin0, sin1);
    const maxSin = this.containsSineMaximum(phase0, phase1) ? 1 : Math.max(sin0, sin1);
    return {
      minY: BASELINE + minSin * AMPLITUDE,
      maxY: BASELINE + maxSin * AMPLITUDE + NOISE_MAX,
    };
  }

  private yAt(x: number): number {
    return BASELINE + Math.sin(x * OMEGA) * AMPLITUDE + this.noiseAt(x) * NOISE_MAX;
  }

  private noiseAt(x: number): number {
    let value = (Math.floor(x) + 0x9e3779b9) | 0;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  private containsSineMaximum(phase0: number, phase1: number): boolean {
    return this.containsPhase(phase0, phase1, Math.PI * 0.5);
  }

  private containsSineMinimum(phase0: number, phase1: number): boolean {
    return this.containsPhase(phase0, phase1, Math.PI * 1.5);
  }

  private containsPhase(phase0: number, phase1: number, target: number): boolean {
    const period = Math.PI * 2;
    const first = target + Math.ceil((phase0 - target) / period) * period;
    return first <= phase1;
  }

  private firstX(): number {
    return this._nextX - this._length;
  }

  private toTime(ordinal: number): number {
    return PREVIEW_START_TIME + ordinal * PREVIEW_X_STEP_MS;
  }

  private fromTime(time: number): number {
    return (time - PREVIEW_START_TIME) / PREVIEW_X_STEP_MS;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this._length) {
      throw new RangeError(`ProceduralLineDataset index out of range: ${index}`);
    }
  }
}
