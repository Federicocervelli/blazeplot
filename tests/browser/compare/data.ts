import type { ChartSpec, LibraryId } from "./common.ts";

export interface ChartJsPoint {
  x: number;
  y: number;
}

/** Data in the shape each library takes natively. Only the shape for the library under test is built. */
export type LibraryData =
  | { readonly library: "blazeplot"; readonly x: Float64Array | null; readonly ys: Float32Array[] }
  | { readonly library: "uplot"; readonly x: ArrayLike<number>; readonly ys: Array<Float64Array | number[]> }
  | { readonly library: "chartjs"; readonly points: ChartJsPoint[][] };

export function sampleY(x: number): number {
  return Math.sin(x * 0.004) * 0.62 + Math.sin(x * 0.00037) * 0.28 + (noise01(x) - 0.5) * 0.04;
}

function noise01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

const STREAM_TABLE_SIZE = 1 << 20;
let streamTable: Float32Array | null = null;

/**
 * Value appended at X during streaming scenarios. Reads a precomputed table of the same signal so the
 * benchmark harness itself spends almost no time generating samples, even at tens of millions per second.
 */
export function streamY(x: number): number {
  if (!streamTable) {
    streamTable = new Float32Array(STREAM_TABLE_SIZE);
    for (let i = 0; i < STREAM_TABLE_SIZE; i++) streamTable[i] = sampleY(i);
  }
  return streamTable[x & (STREAM_TABLE_SIZE - 1)] ?? 0;
}

/** Y of series `k` at `x`. Series differ by phase; the right-axis series of a dual-axis chart is 100x larger. */
export function seriesY(spec: Pick<ChartSpec, "dualAxis">, k: number, x: number): number {
  const y = sampleY(x + k * 997);
  return spec.dualAxis === true && k === 1 ? y * 100 : y;
}

/** Evenly spread, distinguishable series colors as [r, g, b] in 0..255. */
export function seriesColor(k: number, count: number): [number, number, number] {
  if (count === 1) return [59, 115, 242];
  const hue = ((k * 360) / count + 215) % 360;
  return hslToRgb(hue / 360, 0.65, 0.5);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)];
}

export function cssColor(rgb: readonly [number, number, number], alpha = 1): string {
  return alpha === 1 ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`;
}

export function buildData(spec: ChartSpec, library: LibraryId): LibraryData {
  if (spec.stream) streamY(0);
  const n = spec.points;
  const count = spec.seriesCount;
  if (library === "blazeplot" || library === "blazeplot-canvas2d") {
    if (spec.accelerated) return { library: "blazeplot", x: null, ys: [] };
    const x = spec.stream ? null : new Float64Array(n);
    if (x) for (let i = 0; i < n; i++) x[i] = i;
    const ys: Float32Array[] = [];
    for (let k = 0; k < count; k++) {
      const y = new Float32Array(n);
      for (let i = 0; i < n; i++) y[i] = seriesY(spec, k, i);
      ys.push(y);
    }
    return { library: "blazeplot", x, ys };
  }
  if (library === "uplot") {
    // uPlot accepts typed arrays; use them whenever the data is static. Streaming needs push(), so it uses plain arrays.
    const typed = !spec.stream;
    const x = typed ? new Float64Array(n) : new Array<number>(n);
    for (let i = 0; i < n; i++) x[i] = i;
    const ys: Array<Float64Array | number[]> = [];
    for (let k = 0; k < count; k++) {
      const y = typed ? new Float64Array(n) : new Array<number>(n);
      for (let i = 0; i < n; i++) y[i] = seriesY(spec, k, i);
      ys.push(y);
    }
    return { library: "uplot", x, ys };
  }
  const points: ChartJsPoint[][] = [];
  for (let k = 0; k < count; k++) {
    const series = new Array<ChartJsPoint>(n);
    for (let i = 0; i < n; i++) series[i] = { x: i, y: seriesY(spec, k, i) };
    points.push(series);
  }
  return { library: "chartjs", points };
}
