/**
 * Cross-engine parity checks for the visual suite: the same chart rendered by two engines must show the
 * same picture. Pure functions over decoded images, unit-tested in `tests/scripts/crossEngine.test.ts`;
 * `scripts/visual-test.ts` feeds them the plot crops it captures from each renderer run.
 *
 * The engines are allowed to differ the way their primitives differ (Canvas 2D antialiases and snaps
 * rectangles to whole pixels, WebGL does not), and no more: the thresholds are per case kind, and
 * `shared` must match `webgl2` exactly because it is the same GL output blitted through a 2D canvas.
 * Pixel-level output is not a semver promise; the feature set is. See docs/browser-support.md.
 */
import { measureInk } from "./png-image.js";
import type { RgbaImage } from "./png-image.js";

/**
 * What a case mostly draws, which decides how strict the pixel comparison is. `fill` is rectangles (bars, bins),
 * where Canvas 2D snaps to whole pixels as the GPU rasterizes them; `stroke` is everything with antialiased
 * edges (lines, areas with outlines, candles, markers, text); `dense-stroke` is a stroke so long and curvy that
 * join and cap differences between the engines add up (a 100k-sample sine at wide zoom).
 */
export type CrossEngineKind = "fill" | "stroke" | "dense-stroke";

export interface CrossEngineThresholds {
  /** A pixel counts as different when any channel moves by more than this (0..255). */
  readonly pixelThreshold: number;
  /** Fraction of pixels allowed to differ. */
  readonly maxDiffRatio: number;
  /**
   * Both images are box-blurred with this radius before the pixel comparison, so antialiasing (a line covering
   * 70% of a pixel instead of all or nothing) does not count as a difference while a moved or missing shape does.
   */
  readonly blur: number;
  /** Allowed range of `ink(other) / ink(reference)`, where ink is coverage-weighted (see {@link inkMass}), so antialiasing does not count as extra ink. */
  readonly inkRatio: readonly [number, number];
  /** Allowed per-edge difference, in pixels, between the two ink bounding boxes. */
  readonly bboxTolerancePx: number;
}

/**
 * Thresholds calibrated from the visual suite on a real GPU and on CI's SwiftShader (see
 * docs/internal/local-development.md): roughly twice the worst case measured per kind. The design's starting
 * point was fills 0.5% and strokes 1.5% after a 1px dilation with an exact ink bounding box and a 5% ink ratio;
 * pixel dilation does not forgive antialiasing, so strokes are compared after a 3x3 box blur instead, and the
 * bounding box may move by one pixel because the engines break rasterization ties differently.
 */
export const CROSS_ENGINE_THRESHOLDS: Readonly<Record<CrossEngineKind, CrossEngineThresholds>> = {
  fill: { pixelThreshold: 32, maxDiffRatio: 0.008, blur: 0, inkRatio: [0.96, 1.04], bboxTolerancePx: 1 },
  stroke: { pixelThreshold: 32, maxDiffRatio: 0.01, blur: 1, inkRatio: [0.93, 1.07], bboxTolerancePx: 1 },
  "dense-stroke": { pixelThreshold: 32, maxDiffRatio: 0.03, blur: 1, inkRatio: [0.88, 1.12], bboxTolerancePx: 1 },
};

/**
 * `shared` against `webgl2`: the same GL output, only copied through a 2D canvas, so no pixel may move by more
 * than 8-bit rounding (a real GPU is bit-identical, SwiftShader differs by one count in a pixel or two).
 */
export const IDENTICAL_THRESHOLDS: CrossEngineThresholds = { pixelThreshold: 2, maxDiffRatio: 0, blur: 0, inkRatio: [0.999, 1.001], bboxTolerancePx: 0 };

export interface InkBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface CrossEngineResult {
  readonly ok: boolean;
  /** Fraction of pixels that differ by more than the pixel threshold, after blurring. */
  readonly diffRatio: number;
  readonly diffPixels: number;
  readonly maxChannelDelta: number;
  /** `ink(other) / ink(reference)`; 1 when both are blank. */
  readonly inkRatio: number;
  readonly referenceBounds: InkBounds | null;
  readonly otherBounds: InkBounds | null;
  /** Why the check failed; empty when it passed. */
  readonly failures: readonly string[];
}

/**
 * Total ink in an image: the sum over pixels of how far each differs from the border background, in units of
 * one fully inked pixel. Coverage-weighted, so a line drawn antialiased and the same line drawn aliased weigh
 * about the same, while a missing or doubled shape does not.
 */
export function inkMass(image: RgbaImage, tolerance = 2): number {
  const { data } = image;
  const { background } = measureInk(image, tolerance);
  let mass = 0;
  for (let i = 0; i < data.length; i += 4) {
    const delta = Math.max(Math.abs(data[i]! - background[0]), Math.abs(data[i + 1]! - background[1]), Math.abs(data[i + 2]! - background[2]), Math.abs(data[i + 3]! - background[3]));
    if (delta > tolerance) mass += delta / 255;
  }
  return mass;
}

/** Bounding box of the pixels that differ from the border background by more than `tolerance`; `null` when there is none. */
export function inkBounds(image: RgbaImage, tolerance = 8): InkBounds | null {
  const { width, height, data } = image;
  const { background } = measureInk(image, tolerance);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const delta = Math.max(Math.abs(data[i]! - background[0]), Math.abs(data[i + 1]! - background[1]), Math.abs(data[i + 2]! - background[2]), Math.abs(data[i + 3]! - background[3]));
      if (delta <= tolerance) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Box-blur every channel with a (2r+1) x (2r+1) window, clamping at the edges. Radius 0 returns the pixels unchanged. */
export function boxBlur(image: RgbaImage, radius: number): Uint8Array {
  if (radius <= 0) return image.data;
  const { width, height, data } = image;
  const horizontal = new Float32Array(data.length);
  const window = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dx = -radius; dx <= radius; dx++) sum += data[(y * width + Math.min(width - 1, Math.max(0, x + dx))) * 4 + c]!;
        horizontal[(y * width + x) * 4 + c] = sum / window;
      }
    }
  }
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = -radius; dy <= radius; dy++) sum += horizontal[(Math.min(height - 1, Math.max(0, y + dy)) * width + x) * 4 + c]!;
        out[(y * width + x) * 4 + c] = Math.round(sum / window);
      }
    }
  }
  return out;
}

/** Count pixels whose blurred colors differ by more than `threshold` in any channel. */
function differingPixels(a: RgbaImage, b: RgbaImage, threshold: number, blur: number): { count: number; maxDelta: number } {
  const left = boxBlur(a, blur);
  const right = boxBlur(b, blur);
  let count = 0;
  let maxDelta = 0;
  for (let i = 0; i < left.length; i += 4) {
    const delta = Math.max(Math.abs(left[i]! - right[i]!), Math.abs(left[i + 1]! - right[i + 1]!), Math.abs(left[i + 2]! - right[i + 2]!), Math.abs(left[i + 3]! - right[i + 3]!));
    if (delta > maxDelta) maxDelta = delta;
    if (delta > threshold) count++;
  }
  return { count, maxDelta };
}

/** Compare one engine's render of a case with the reference engine's render of the same case. */
export function compareEngines(reference: RgbaImage, other: RgbaImage, thresholds: CrossEngineThresholds): CrossEngineResult {
  const failures: string[] = [];
  if (reference.width !== other.width || reference.height !== other.height) {
    return {
      ok: false,
      diffRatio: 1,
      diffPixels: reference.width * reference.height,
      maxChannelDelta: 255,
      inkRatio: 0,
      referenceBounds: null,
      otherBounds: null,
      failures: [`sizes differ: ${reference.width}x${reference.height} vs ${other.width}x${other.height}`],
    };
  }
  const total = reference.width * reference.height;
  const { count: diffPixels, maxDelta } = differingPixels(reference, other, thresholds.pixelThreshold, thresholds.blur);
  const diffRatio = total === 0 ? 0 : diffPixels / total;
  if (diffRatio > thresholds.maxDiffRatio) {
    failures.push(`${diffPixels} px (${(diffRatio * 100).toFixed(3)}%) differ by more than ${thresholds.pixelThreshold}/255${thresholds.blur > 0 ? ` after a ${2 * thresholds.blur + 1}px box blur` : ""}, limit ${(thresholds.maxDiffRatio * 100).toFixed(3)}%`);
  }

  const referenceInk = inkMass(reference);
  const otherInk = inkMass(other);
  const inkRatio = referenceInk === 0 ? (otherInk === 0 ? 1 : Infinity) : otherInk / referenceInk;
  if (inkRatio < thresholds.inkRatio[0] || inkRatio > thresholds.inkRatio[1]) {
    failures.push(`ink ratio ${inkRatio.toFixed(3)} is outside ${thresholds.inkRatio[0]}..${thresholds.inkRatio[1]}`);
  }

  const referenceBounds = inkBounds(reference);
  const otherBounds = inkBounds(other);
  if ((referenceBounds === null) !== (otherBounds === null)) {
    failures.push("only one engine drew ink");
  } else if (referenceBounds && otherBounds) {
    const edges = (["minX", "minY", "maxX", "maxY"] as const).filter((edge) => Math.abs(referenceBounds[edge] - otherBounds[edge]) > thresholds.bboxTolerancePx);
    if (edges.length > 0) {
      failures.push(`ink bounds differ (${edges.map((edge) => `${edge} ${referenceBounds[edge]} vs ${otherBounds[edge]}`).join(", ")})`);
    }
  }

  return { ok: failures.length === 0, diffRatio, diffPixels, maxChannelDelta: maxDelta, inkRatio, referenceBounds, otherBounds, failures };
}
