import type { MinMaxY } from "./MinMaxTree.js";
import type { DatasetCaps } from "./datasetCaps.js";
import type { SeriesLod } from "./SeriesLod.js";
import type { Dataset, SeriesSample, Viewport } from "./types.js";

/**
 * Read access shared by the series query helpers (`SeriesSampler`, `ScatterSampler`, `SeriesPicker`):
 * the backing dataset, its resolved capabilities, gap handling, logical index ranges, and the
 * viewport-stable bucket width used by decimation. Subclasses add one family of queries each.
 */
export class SeriesSource {
  constructor(
    protected readonly dataset: Dataset,
    /** Capabilities resolved once at construction; no duck typing runs per frame or per sample. */
    protected readonly caps: DatasetCaps,
    protected readonly lod: SeriesLod,
  ) {}

  /** Return the XY sample at a logical index, or `null` for gaps and out-of-range indexes. */
  sampleAt(index: number): SeriesSample | null {
    if (index < 0 || index >= this.dataset.length) return null;
    const y = this.dataset.getY(index);
    if (this.isGap(index, y)) return null;
    return { index, x: this.dataset.getX(index), y };
  }

  /** @internal Return the logical index range overlapping a viewport's X span (all samples when omitted). */
  visibleIndexRange(viewport: Viewport | undefined, outerPadding: number = 0): { start: number; end: number } {
    if (!viewport) return { start: 0, end: this.dataset.length };
    const pad = Math.max(0, Math.floor(outerPadding));
    return {
      start: Math.max(0, this.dataset.lowerBoundX(viewport.xMin) - pad),
      end: Math.min(this.dataset.length, this.dataset.upperBoundX(viewport.xMax) + pad),
    };
  }

  isGap(index: number, y?: number): boolean {
    const value = y ?? this.dataset.getY(index);
    if (!Number.isFinite(value)) return true;
    const gaps = this.caps.gaps;
    return gaps !== null && gaps.isGap(index);
  }

  /** Whether `pointIntervalMinMaxY` can answer without scanning raw samples. */
  protected hasPointIntervalBounds(): boolean {
    return this.caps.rangeMinMax !== null || (this.lod.pyramid !== null && !this.lod.dirty && !this.lod.useRawScan);
  }

  protected pointIntervalMinMaxY(start: number, end: number): MinMaxY | null {
    const rangeMinMax = this.caps.rangeMinMax;
    if (rangeMinMax) return rangeMinMax.rangeMinMaxY(start, end);
    if (this.lod.pyramid && !this.lod.dirty && !this.lod.useRawScan) return this.lod.pyramid.rangeMinMax(this.dataset, start, end);
    return null;
  }

  protected estimatedVisibleSamplesForViewport(viewport: Viewport): number {
    const xSpan = viewport.xMax - viewport.xMin;
    const range = this.dataset.range;
    if (!range || this.dataset.length <= 1 || !(xSpan > 0)) return Math.max(1, this.dataset.length);

    const dataSpan = range.end - range.start;
    if (!(dataSpan > 0)) return Math.max(1, this.dataset.length);

    return Math.max(1, (xSpan / dataSpan) * (this.dataset.length - 1) + 1);
  }

  /**
   * First bucket start at or before `start`, aligned to absolute sample ordinals when the
   * dataset reports them (`Dataset.ordinalOffset`). Aligning to logical indexes instead
   * would move every bucket edge each time a full ring buffer drops its oldest sample.
   */
  protected alignBucketStart(start: number, width: number): number {
    const ordinalOffset = this.dataset.ordinalOffset ?? 0;
    // Only the remainder is needed, which stays exact even for very large ordinals.
    return start - ((((start + ordinalOffset) % width) + width) % width);
  }

  protected stableSampleBucketWidthForViewport(viewport: Viewport, maxPoints: number): number {
    return Math.max(1, Math.ceil(this.estimatedVisibleSamplesForViewport(viewport) / Math.max(1, maxPoints)));
  }

  protected hasGapInRange(start: number, end: number): boolean {
    const from = Math.max(0, start);
    const to = Math.min(this.dataset.length, end);
    for (let i = from; i < to; i++) {
      if (this.isGap(i)) return true;
    }
    return false;
  }
}
