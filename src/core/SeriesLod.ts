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
  private forceFullRebuild: boolean = false;
  private lastBuildLength: number;
  private lastOrdinal: number | undefined;
  /** Samples appended since the last rebuild; `undefined` once any mutation did not report a count. */
  private pendingAppended: number | undefined = 0;

  constructor(dataset: Dataset, downsampled: boolean, datasetAnswersRangeMinMax: boolean) {
    this.pyramid = downsampled && !datasetAnswersRangeMinMax ? new MinMaxPyramid() : null;
    if (this.pyramid && dataset.length > 0) this.pyramid.build(dataset);
    this.lastBuildLength = dataset.length;
    this.lastOrdinal = dataset.ordinalOffset;
  }

  /**
   * Record a data change; `force` asks for a full pyramid rebuild instead of an incremental one.
   * `appended` is the number of samples pushed by this change, when known.
   */
  markMutated(force: boolean, appended?: number): void {
    this.dirty = true;
    this.forceFullRebuild ||= force;
    this.pendingAppended =
      appended === undefined || this.pendingAppended === undefined ? undefined : this.pendingAppended + appended;
  }

  /** The dataset was replaced wholesale: leave raw-scan mode (the next rebuild is forced by `markMutated`). */
  resetRawScan(): void {
    this.useRawScan = false;
  }

  /** The dataset was cleared: rebuild immediately and forget pending changes. */
  reset(dataset: Dataset): void {
    this.useRawScan = false;
    this.forceFullRebuild = false;
    this.pyramid?.build(dataset);
    this.lastBuildLength = dataset.length;
    this.lastOrdinal = dataset.ordinalOffset;
    this.pendingAppended = 0;
    this.dirty = false;
  }

  /** Rebuild or extend LOD state after data changes. Called by the chart before drawing. */
  rebuild(dataset: Dataset): void {
    if (!this.dirty) return;
    if (this.pyramid) {
      const length = dataset.length;
      const ordinal = dataset.ordinalOffset;
      const appended = this.pendingAppended;
      const exact = ordinal !== undefined && this.lastOrdinal !== undefined;
      // Samples dropped from the front since the last build, or null when it cannot be determined.
      let shift: number | null = null;
      if (exact) {
        shift = ordinal - this.lastOrdinal!;
        // The ordinal advance must agree with the reported append count, else rebuild.
        if (appended !== undefined && this.lastBuildLength + appended - length !== shift) shift = null;
      } else if (appended !== undefined) {
        shift = this.lastBuildLength + appended - length;
      }

      if (this.forceFullRebuild || shift === null || shift < 0) {
        this.pyramid.build(dataset);
        this.useRawScan = false;
      } else if (shift > 0 && !exact) {
        // Cannot tell a real shift from dropped appends; scan raw ranges instead of trusting the pyramid.
        this.useRawScan = true;
      } else if (!this.useRawScan) {
        this.pyramid.incrementalBuild(dataset, shift);
      }
      this.lastBuildLength = length;
      this.lastOrdinal = ordinal;
    }
    this.pendingAppended = 0;
    this.forceFullRebuild = false;
    this.dirty = false;
  }
}
