export { histogramBins } from "./core/histogramBins.js";

/** Simple X/Y sample used by data resampling helpers. */
export interface XYSample {
  readonly x: number;
  readonly y: number;
}

/** Reducer used when multiple samples fall into one output bucket. */
export type SampleReducer = "mean" | "sum" | "min" | "max" | "first" | "last";
/** X position assigned to a resampled bucket. */
export type ResampleX = "start" | "center" | "end";

/** Options for `binSamples`. */
export interface ResampleOptions {
  /** How to combine Y values in a bucket. Defaults to `"mean"`. */
  readonly reducer?: SampleReducer;
  /** Bucket origin; buckets are `[align + k * binSize, align + (k + 1) * binSize)`. Defaults to 0. */
  readonly align?: number;
  /** X reported for each bucket. Defaults to `"center"`. */
  readonly x?: ResampleX;
}

/** Output sample produced by fixed-width X binning. */
export interface BinnedSample extends XYSample {
  readonly xStart: number;
  readonly xEnd: number;
  readonly count: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Output sample produced by rolling mean smoothing. */
export interface RollingMeanSample extends XYSample {
  readonly count: number;
}

interface MutableBin {
  key: number;
  xStart: number;
  xEnd: number;
  count: number;
  sumY: number;
  minY: number;
  maxY: number;
  firstY: number;
  lastY: number;
}

/** Bin irregular x/y samples into fixed-width x buckets. Non-finite samples are skipped. */
export function binSamples(samples: readonly XYSample[], binSize: number, options: ResampleOptions = {}): BinnedSample[] {
  if (!Number.isFinite(binSize) || binSize <= 0) {
    throw new RangeError("binSize must be a positive finite number.");
  }

  const align = Number.isFinite(options.align) ? options.align! : 0;
  const bins = new Map<number, MutableBin>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    const key = Math.floor((sample.x - align) / binSize);
    const existing = bins.get(key);
    if (existing) {
      existing.count++;
      existing.sumY += sample.y;
      existing.minY = Math.min(existing.minY, sample.y);
      existing.maxY = Math.max(existing.maxY, sample.y);
      existing.lastY = sample.y;
    } else {
      bins.set(key, {
        key,
        xStart: align + key * binSize,
        xEnd: align + (key + 1) * binSize,
        count: 1,
        sumY: sample.y,
        minY: sample.y,
        maxY: sample.y,
        firstY: sample.y,
        lastY: sample.y,
      });
    }
  }

  const reducer = options.reducer ?? "mean";
  const xMode = options.x ?? "center";
  return Array.from(bins.values())
    .sort((a, b) => a.key - b.key)
    .map((bin) => ({
      x: resampledX(bin, xMode),
      y: reducedY(bin, reducer),
      xStart: bin.xStart,
      xEnd: bin.xEnd,
      count: bin.count,
      minY: bin.minY,
      maxY: bin.maxY,
    }));
}

/** Rolling mean over the previous `windowSize` finite samples, preserving each input x coordinate. */
export function rollingMean(samples: readonly XYSample[], windowSize: number): RollingMeanSample[] {
  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    throw new RangeError("windowSize must be a positive integer.");
  }

  const output: RollingMeanSample[] = [];
  const window = new Float64Array(windowSize);
  let head = 0;
  let count = 0;
  let sum = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    if (count === windowSize) sum -= window[head]!;
    else count++;
    window[head] = sample.y;
    sum += sample.y;
    head = (head + 1) % windowSize;
    output.push({ x: sample.x, y: sum / count, count });
  }
  return output;
}

function reducedY(bin: MutableBin, reducer: SampleReducer): number {
  switch (reducer) {
    case "sum":
      return bin.sumY;
    case "min":
      return bin.minY;
    case "max":
      return bin.maxY;
    case "first":
      return bin.firstY;
    case "last":
      return bin.lastY;
    default:
      return bin.sumY / bin.count;
  }
}

function resampledX(bin: MutableBin, mode: ResampleX): number {
  switch (mode) {
    case "start":
      return bin.xStart;
    case "end":
      return bin.xEnd;
    default:
      return (bin.xStart + bin.xEnd) * 0.5;
  }
}
