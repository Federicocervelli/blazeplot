import { MinMaxPyramid } from "./MinMaxPyramid.js";
import type { Dataset } from "./types.js";

/**
 * Level-of-detail bookkeeping for one series: the internal `MinMaxPyramid` (only allocated for
 * downsampled custom datasets that cannot answer `rangeMinMaxY` themselves) and the flags that decide
 * how it is refreshed after data changes. Updates incrementally for tail appends and switches to raw
 * scans when a custom ring shifts at fixed capacity.
 */
export class SeriesLod {
  readonly pyramid: MinMaxPyramid | null;
  /** Data changed since the last `rebuild`. */
  dirty: boolean = false;
  /** Raw min/max scans replace the pyramid until the next full rebuild (a wrapping ring shifted every index). */
  useRawScan: boolean = false;
  private forceFullRebuild: boolean = false;
  private lastBuildLength: number;
  private lastBuildRangeStart: number;

  constructor(dataset: Dataset, downsampled: boolean, datasetAnswersRangeMinMax: boolean) {
    this.pyramid = downsampled && !datasetAnswersRangeMinMax ? new MinMaxPyramid() : null;
    if (this.pyramid && dataset.length > 0) this.pyramid.build(dataset);
    this.lastBuildLength = dataset.length;
    this.lastBuildRangeStart = dataset.range?.start ?? NaN;
  }

  /** Record a data change; `force` asks for a full pyramid rebuild instead of an incremental one. */
  markMutated(force: boolean): void {
    this.dirty = true;
    this.forceFullRebuild ||= force;
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
    this.lastBuildRangeStart = dataset.range?.start ?? NaN;
    this.dirty = false;
  }

  /** Rebuild or extend LOD state after data changes. Called by the chart before drawing. */
  rebuild(dataset: Dataset): void {
    if (!this.dirty) return;
    if (this.pyramid) {
      const length = dataset.length;
      const rangeStart = dataset.range?.start ?? NaN;
      const shiftedAtCapacity = length === this.lastBuildLength && rangeStart !== this.lastBuildRangeStart;
      if (this.forceFullRebuild) {
        this.pyramid.build(dataset);
        this.useRawScan = false;
      } else if (shiftedAtCapacity) {
        // A wrapping ring buffer shifted every logical index; scan raw ranges instead of rebuilding per frame.
        this.useRawScan = true;
      } else {
        this.pyramid.incrementalBuild(dataset);
        this.useRawScan = false;
      }
      this.lastBuildLength = length;
      this.lastBuildRangeStart = rangeStart;
    }
    this.forceFullRebuild = false;
    this.dirty = false;
  }
}
