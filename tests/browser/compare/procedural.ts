import type { AcceleratedDataset, SampleCopyLayout, TimeRange, Viewport } from "@/index.ts";
import { sampleY } from "./data.ts";

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

/** Dataset for BlazePlot's accelerated path in the 10M scenario: values are generated on demand, not stored. */
export class ProceduralBenchmarkDataset implements AcceleratedDataset {
  private static readonly minY = -0.95;
  private static readonly maxY = 0.95;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError("Procedural benchmark dataset length must be positive.");
  }

  get range(): TimeRange {
    return { start: 0, end: this.length - 1 };
  }

  getX(index: number): number {
    this.assertValidIndex(index);
    return index;
  }

  getY(index: number): number {
    this.assertValidIndex(index);
    return sampleY(index);
  }

  lowerBoundX(x: number): number {
    return Math.max(0, Math.min(this.length, Math.ceil(x)));
  }

  upperBoundX(x: number): number {
    return Math.max(0, Math.min(this.length, Math.floor(x) + 1));
  }

  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    return to > from ? { minY: ProceduralBenchmarkDataset.minY, maxY: ProceduralBenchmarkDataset.maxY } : null;
  }

  copySamplesRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    return this.copyStridedSamples(Math.max(0, Math.floor(start)), Math.min(this.length, Math.ceil(end)), 1, target, maxPoints, layout, baseline, xOrigin);
  }

  copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const start = this.lowerBoundX(viewport.xMin);
    const end = this.upperBoundX(viewport.xMax);
    const visible = Math.max(0, end - start);
    const stride = Math.max(1, Math.ceil(visible / Math.max(1, maxPoints)));
    const alignedStart = start + positiveModulo(-start, stride);
    return this.copyStridedSamples(alignedStart, end, stride, target, maxPoints, layout, baseline, xOrigin);
  }

  copyMinMaxSegments(
    viewport: Viewport,
    target: Float32Array,
    maxSegments: number,
    xOrigin: number,
  ): number {
    if (maxSegments <= 0 || target.length < maxSegments * 3) return 0;

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

      const representative = Math.max(segmentStart, Math.min(segmentEnd - 1, bucketStart + (stride >> 1)));
      const x = representative - xOrigin;
      const offset = written * 3;
      target[offset] = x;
      target[offset + 1] = ProceduralBenchmarkDataset.minY;
      target[offset + 2] = ProceduralBenchmarkDataset.maxY;
      written++;
    }

    return written;
  }

  private copyStridedSamples(
    from: number,
    to: number,
    stride: number,
    target: Float32Array,
    maxPoints: number,
    layout: SampleCopyLayout,
    baseline: number,
    xOrigin: number,
  ): number {
    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const count = Math.min(maxPoints, Math.max(0, Math.ceil((to - from) / stride)));
    for (let i = 0, index = from; i < count; i++, index += stride) {
      const x = index - xOrigin;
      if (layout === "points") {
        const offset = i * 2;
        target[offset] = x;
        target[offset + 1] = sampleY(index);
      } else {
        const offset = i * 4;
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = sampleY(index);
      }
    }
    return count;
  }

  private assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError(`Procedural benchmark dataset index out of range: ${index}`);
  }
}
