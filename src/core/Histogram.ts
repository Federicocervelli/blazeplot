import { histogramBins } from "./histogramBins.js";
import type { HistogramOptions, HistogramResult } from "./histogramBins.js";
import { StaticDataset } from "./StaticDataset.js";
import type { XRange, XRangeDataset } from "./types.js";

/** Static histogram dataset that preserves each bucket's X interval for picks and tooltips. */
export class HistogramDataset extends StaticDataset implements XRangeDataset {
  /** Create a static dataset from precomputed histogram buckets. */
  constructor(readonly result: HistogramResult) {
    super(result.x, result.y);
  }

  /** Bin one-dimensional `values` and wrap the result: `chart.addBar({ dataset: HistogramDataset.from(values, options) })`. */
  static from(values: ArrayLike<number>, options: HistogramOptions = {}): HistogramDataset {
    return new HistogramDataset(histogramBins(values, options));
  }

  /** Bar width `addBar` uses when `style.barWidth` is omitted: the bin width, or `null` for variable-width bins. */
  get defaultBarWidth(): number | null {
    return this.result.binWidth;
  }

  /** Return the value interval represented by a histogram bucket. */
  getXRange(index: number): XRange | null {
    const bin = this.result.bins[index];
    return bin ? { xStart: bin.xStart, xEnd: bin.xEnd } : null;
  }
}
