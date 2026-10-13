import { MinMaxPyramid } from "./MinMaxPyramid.js";
import type { Dataset } from "./types.js";

/**
 * Level-of-detail bookkeeping for one series: the internal `MinMaxPyramid` (only allocated for
 * downsampled custom datasets that cannot answer `rangeMinMaxY` themselves) and the flags that decide
 * how it is refreshed after data changes. Tail appends update incrementally. When a custom ring is full
 * and drops front samples, the shift is derived from `Dataset.ordinalOffset` (exact) or from the number of
 * appended samples; never from `range.start`, which ties in X leave unchanged. If the shift cannot be
 * known exactly the pyramid is rebuilt, or (shift without `ordinalOffset`) raw scans replace it.
 */
export class SeriesLod {
  readonly pyramid: MinMaxPyramid | null;
  /** Data changed since the last `rebuild`. */
  dirty: boolean = false;
  /** Raw min/max scans replace the pyramid until the next full rebuild (a shift that cannot be tracked exactly). */
  useRawScan: boolean = false;
  private forceRebuild: boolean = false;
  private builtLength: number = 0;
  private lastOrdinal: number | undefined;
  /** Samples appended since the last rebuild; NaN once any mutation did not report a count. */
  private appended: number = 0;

  constructor(dataset: Dataset, downsampled: boolean, datasetAnswersRangeMinMax: boolean) {
    this.pyramid = downsampled && !datasetAnswersRangeMinMax ? new MinMaxPyramid() : null;
    this.reset(dataset);
  }

  /**
   * Record a data change; `force` asks for a full pyramid rebuild instead of an incremental one.
   * `appended` is the number of samples pushed by this change, when known.
   */
  markMutated(force: boolean, appended?: number): void {
    this.dirty = true;
    this.forceRebuild ||= force;
    this.appended += appended ?? NaN;
  }

  /** The dataset was cleared: rebuild immediately and forget pending changes. */
  reset(dataset: Dataset): void {
    this.pyramid?.build(dataset);
    this.builtLength = dataset.length;
    this.lastOrdinal = dataset.ordinalOffset;
    this.useRawScan = this.forceRebuild = this.dirty = false;
    this.appended = 0;
  }

  /** Rebuild or extend LOD state after data changes. Called by the chart before drawing. */
  rebuild(dataset: Dataset): void {
    if (!this.dirty) return;
    const pyramid = this.pyramid;
    if (pyramid) {
      const length = dataset.length;
      const ordinal = dataset.ordinalOffset;
      const exact = ordinal !== undefined && this.lastOrdinal !== undefined;
      // Samples dropped from the front since the last build, or NaN when it cannot be determined.
      const dropped = this.builtLength + this.appended - length;
      let shift = exact ? ordinal - this.lastOrdinal! : dropped;
      // The ordinal advance must agree with the reported append count, else rebuild.
      if (exact && dropped !== shift && !Number.isNaN(dropped)) shift = NaN;

      if (this.forceRebuild || !(shift >= 0)) {
        pyramid.build(dataset);
        this.useRawScan = false;
      } else if (shift > 0 && !exact) {
        // Cannot tell a real shift from dropped appends; scan raw ranges instead of trusting the pyramid.
        this.useRawScan = true;
      } else if (!this.useRawScan) {
        pyramid.incrementalBuild(dataset, shift);
      }
      this.builtLength = length;
      this.lastOrdinal = ordinal;
    }
    this.appended = 0;
    this.forceRebuild = this.dirty = false;
  }
}
