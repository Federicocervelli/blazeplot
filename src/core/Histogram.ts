import { upperBoundArray } from "./search.js";
import { StaticDataset } from "./StaticDataset.js";
import type { XRange, XRangeDataset } from "./types.js";

/** Histogram value normalization modes. */
export type HistogramNormalization = "count" | "probability" | "density" | "percent";

/** Explicit bin edges, or a requested number of equal-width bins. */
export type HistogramBinThresholds = number | readonly number[];

/** Options for converting one-dimensional values into histogram bins. */
export interface HistogramOptions {
  /** Fixed bucket width. Mutually exclusive with thresholds/binCount. */
  readonly binSize?: number;
  /** Desired number of equal-width bins. Mutually exclusive with thresholds/binSize. */
  readonly binCount?: number;
  /** Explicit sorted bin edges, or a desired bin count. */
  readonly thresholds?: HistogramBinThresholds;
  /** Inclusive lower bound. Defaults to finite min(values). */
  readonly min?: number;
  /** Inclusive upper bound for data range. Defaults to finite max(values). */
  readonly max?: number;
  /** Align fixed-width bins to this origin. Defaults to 0. */
  readonly align?: number;
  /** Default: "count". */
  readonly normalize?: HistogramNormalization;
  /** Include empty bins between min/max. Default true. */
  readonly includeEmpty?: boolean;
  /** Put values equal to max into the final bin. Default true. */
  readonly includeMax?: boolean;
}

/** One histogram bucket, suitable for rendering as a bar centered at `x`. */
export interface HistogramBin {
  /** Bucket center, for StaticDataset/bar rendering. */
  readonly x: number;
  /** Count/probability/density/percent according to `HistogramOptions.normalize`. */
  readonly y: number;
  /** Inclusive bucket start edge. */
  readonly xStart: number;
  /** Bucket end edge. The final bin includes this edge when includeMax is enabled. */
  readonly xEnd: number;
  /** Raw count regardless of normalization. */
  readonly count: number;
  readonly index: number;
}

/** Result of a histogram transform. */
export interface HistogramResult {
  readonly bins: readonly HistogramBin[];
  readonly x: Float64Array;
  readonly y: Float32Array;
  /** `null` for variable-width explicit edges. */
  readonly binWidth: number | null;
  /** Finite values included in bins. */
  readonly total: number;
  readonly underflow: number;
  readonly overflow: number;
  /** NaN/infinite/non-number values skipped before binning. */
  readonly invalid: number;
  readonly min: number;
  readonly max: number;
}

interface HistogramEdges {
  readonly edges: number[];
  readonly binWidth: number | null;
  readonly min: number;
  readonly max: number;
}

interface FiniteValues {
  readonly values: number[];
  readonly invalid: number;
  readonly min: number;
  readonly max: number;
}

interface CountedBin {
  readonly xStart: number;
  readonly xEnd: number;
  count: number;
  readonly index: number;
}

const DEFAULT_MAX_BINS = 512;
const EDGE_EQUALITY_EPSILON = 1e-9;

/** Convert one-dimensional finite values into histogram bins. */
export function histogram(values: ArrayLike<number>, options: HistogramOptions = {}): HistogramResult {
  const finite = collectFiniteValues(values);
  const includeMax = options.includeMax !== false;
  const normalize = options.normalize ?? "count";
  validateNormalization(normalize);

  if (finite.values.length === 0 && options.min === undefined && options.max === undefined && !hasExplicitEdgeThresholds(options)) {
    return emptyHistogram(finite.invalid, Number.NaN, Number.NaN);
  }

  const edges = buildEdges(finite, options);
  if (edges.edges.length < 2) {
    return emptyHistogram(finite.invalid, Number.NaN, Number.NaN);
  }
  if (finite.values.length === 0) {
    return emptyHistogram(finite.invalid, edges.min, edges.max, edges.binWidth);
  }

  const counted = createCountedBins(edges.edges);
  let underflow = 0;
  let overflow = 0;
  let total = 0;
  const firstEdge = edges.edges[0]!;
  const lastEdge = edges.edges[edges.edges.length - 1]!;
  const equalWidth = edges.binWidth !== null ? edges.binWidth : null;

  for (const value of finite.values) {
    if (value < edges.min) {
      underflow++;
      continue;
    }
    if (value > edges.max || (value === edges.max && !includeMax)) {
      overflow++;
      continue;
    }

    let binIndex: number;
    if (value === lastEdge) {
      binIndex = counted.length - 1;
    } else if (equalWidth !== null) {
      binIndex = Math.floor((value - firstEdge) / equalWidth);
      if (binIndex < 0) binIndex = 0;
      if (binIndex >= counted.length) binIndex = counted.length - 1;
    } else {
      binIndex = upperBoundArray(edges.edges, value) - 1;
    }

    counted[binIndex]!.count++;
    total++;
  }

  const includeEmpty = options.includeEmpty !== false;
  const outputBins = counted.filter((bin) => includeEmpty || bin.count > 0);
  const bins = outputBins.map((bin) => toHistogramBin(bin, total, normalize));
  return {
    bins,
    x: Float64Array.from(bins, (bin) => bin.x),
    y: Float32Array.from(bins, (bin) => bin.y),
    binWidth: edges.binWidth,
    total,
    underflow,
    overflow,
    invalid: finite.invalid,
    min: edges.min,
    max: edges.max,
  };
}

/** Static histogram dataset that preserves each bucket's X interval for picks and tooltips. */
export class HistogramDataset extends StaticDataset implements XRangeDataset {
  /** Create a static dataset from precomputed histogram buckets. */
  constructor(readonly result: HistogramResult) {
    super(result.x, result.y);
  }

  /** Return the value interval represented by a histogram bucket. */
  getXRange(index: number): XRange | null {
    const bin = this.result.bins[index];
    return bin ? { xStart: bin.xStart, xEnd: bin.xEnd } : null;
  }
}

/** Build a StaticDataset from histogram bucket centers and normalized counts. */
export function histogramDataset(values: ArrayLike<number>, options: HistogramOptions = {}): HistogramDataset {
  return new HistogramDataset(histogram(values, options));
}

function collectFiniteValues(values: ArrayLike<number>): FiniteValues {
  const finite: number[] = [];
  let invalid = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalid++;
      continue;
    }
    finite.push(value);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { values: finite, invalid, min, max };
}

function buildEdges(finite: FiniteValues, options: HistogramOptions): HistogramEdges {
  const modeCount = (options.binSize !== undefined ? 1 : 0)
    + (options.binCount !== undefined ? 1 : 0)
    + (options.thresholds !== undefined ? 1 : 0);
  if (modeCount > 1) {
    throw new TypeError("Histogram binSize, binCount, and thresholds are mutually exclusive.");
  }

  if (Array.isArray(options.thresholds)) {
    return explicitEdges(options.thresholds);
  }
  if (isReadonlyNumberArray(options.thresholds)) {
    return explicitEdges(options.thresholds);
  }
  if (options.binSize !== undefined) {
    return fixedSizeEdges(finite, options);
  }

  const desiredCount = options.binCount ?? (typeof options.thresholds === "number" ? options.thresholds : defaultBinCount(finite.values));
  return fixedCountEdges(finite, options, desiredCount);
}

function explicitEdges(thresholds: readonly number[]): HistogramEdges {
  if (thresholds.length < 2) {
    throw new RangeError("Histogram thresholds must contain at least two edges.");
  }
  const edges = Array.from(thresholds);
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index]!;
    if (!Number.isFinite(edge)) {
      throw new TypeError("Histogram thresholds must be finite numbers.");
    }
    if (index > 0 && edge <= edges[index - 1]!) {
      throw new RangeError("Histogram thresholds must be strictly increasing.");
    }
  }
  return { edges, binWidth: inferUniformWidth(edges), min: edges[0]!, max: edges[edges.length - 1]! };
}

function fixedSizeEdges(finite: FiniteValues, options: HistogramOptions): HistogramEdges {
  const binSize = options.binSize!;
  if (!Number.isFinite(binSize) || binSize <= 0) {
    throw new RangeError("Histogram binSize must be a positive finite number.");
  }

  const domain = resolveDomain(finite, options);
  const align = Number.isFinite(options.align) ? options.align! : 0;
  const first = align + Math.floor((domain.min - align) / binSize) * binSize;
  let last = align + Math.ceil((domain.max - align) / binSize) * binSize;
  if (last <= first) last = first + binSize;
  return { edges: buildLinearEdges(first, last, binSize), binWidth: binSize, min: domain.min, max: domain.max };
}

function fixedCountEdges(finite: FiniteValues, options: HistogramOptions, countInput: number): HistogramEdges {
  if (!Number.isInteger(countInput) || countInput <= 0) {
    throw new RangeError("Histogram binCount/thresholds count must be a positive integer.");
  }
  const count = Math.min(DEFAULT_MAX_BINS, countInput);
  const domain = expandDegenerateDomain(resolveDomain(finite, options));
  const binWidth = (domain.max - domain.min) / count;
  return { edges: buildLinearEdges(domain.min, domain.max, binWidth), binWidth, min: domain.min, max: domain.max };
}

function resolveDomain(finite: FiniteValues, options: Pick<HistogramOptions, "min" | "max">): { min: number; max: number } {
  const min = options.min ?? finite.min;
  const max = options.max ?? finite.max;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new TypeError("Histogram min/max must be finite numbers when no finite values are available.");
  }
  if (max < min) {
    throw new RangeError("Histogram max must be greater than or equal to min.");
  }
  return { min, max };
}

function expandDegenerateDomain(domain: { min: number; max: number }): { min: number; max: number } {
  if (domain.max > domain.min) return domain;
  const halfSpan = Math.max(0.5, Math.abs(domain.min) * 0.5);
  return { min: domain.min - halfSpan, max: domain.max + halfSpan };
}

function buildLinearEdges(first: number, last: number, step: number): number[] {
  const span = last - first;
  const count = Math.max(1, Math.round(span / step));
  const edges = new Array<number>(count + 1);
  for (let index = 0; index <= count; index++) {
    edges[index] = index === count ? last : first + index * step;
  }
  return edges;
}

function createCountedBins(edges: readonly number[]): CountedBin[] {
  const bins: CountedBin[] = [];
  for (let index = 0; index < edges.length - 1; index++) {
    bins.push({ xStart: edges[index]!, xEnd: edges[index + 1]!, count: 0, index });
  }
  return bins;
}

function toHistogramBin(bin: CountedBin, total: number, normalize: HistogramNormalization): HistogramBin {
  const width = bin.xEnd - bin.xStart;
  let y: number;
  switch (normalize) {
    case "probability":
      y = total > 0 ? bin.count / total : 0;
      break;
    case "percent":
      y = total > 0 ? (bin.count / total) * 100 : 0;
      break;
    case "density":
      y = total > 0 && width > 0 ? bin.count / (total * width) : 0;
      break;
    default:
      y = bin.count;
      break;
  }
  return {
    x: (bin.xStart + bin.xEnd) * 0.5,
    y,
    xStart: bin.xStart,
    xEnd: bin.xEnd,
    count: bin.count,
    index: bin.index,
  };
}

function defaultBinCount(values: readonly number[]): number {
  const n = values.length;
  if (n <= 1) return 1;

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (max > min && iqr > 0) {
    const width = 2 * iqr / Math.cbrt(n);
    if (Number.isFinite(width) && width > 0) {
      return clampBinCount(Math.ceil((max - min) / width));
    }
  }

  return clampBinCount(Math.ceil(Math.log2(n) + 1));
}

function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function clampBinCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(DEFAULT_MAX_BINS, Math.max(1, count));
}

function inferUniformWidth(edges: readonly number[]): number | null {
  const firstWidth = edges[1]! - edges[0]!;
  const scale = Math.max(1, Math.abs(firstWidth));
  for (let index = 2; index < edges.length; index++) {
    const width = edges[index]! - edges[index - 1]!;
    if (Math.abs(width - firstWidth) > scale * EDGE_EQUALITY_EPSILON) return null;
  }
  return firstWidth;
}

function hasExplicitEdgeThresholds(options: HistogramOptions): boolean {
  return Array.isArray(options.thresholds) || isReadonlyNumberArray(options.thresholds);
}

function isReadonlyNumberArray(value: unknown): value is readonly number[] {
  return typeof value === "object" && value !== null && "length" in value && typeof (value as { length: unknown }).length === "number";
}

function validateNormalization(normalize: HistogramNormalization): void {
  switch (normalize) {
    case "count":
    case "probability":
    case "density":
    case "percent":
      return;
    default:
      throw new TypeError(`Unsupported histogram normalization: ${String(normalize)}.`);
  }
}

function emptyHistogram(invalid: number, min: number, max: number, binWidth: number | null = null): HistogramResult {
  return {
    bins: [],
    x: new Float64Array(0),
    y: new Float32Array(0),
    binWidth,
    total: 0,
    underflow: 0,
    overflow: 0,
    invalid,
    min,
    max,
  };
}
