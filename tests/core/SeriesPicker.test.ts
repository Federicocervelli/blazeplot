import { describe, expect, it } from "bun:test";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import type { Dataset, SeriesConfig, SeriesSample, Viewport } from "../../src/core/types.ts";
import { testStyle } from "../helpers.ts";

function seriesOf(xs: number[], ys: number[], config: Partial<SeriesConfig> = {}): SeriesStore {
  const buffer = new RingBuffer(Math.max(1, xs.length));
  buffer.append(xs, ys);
  return new SeriesStore(buffer, { mode: "line", capacity: Math.max(1, xs.length), ...config }, testStyle());
}

const view: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

describe("nearestSampleByX", () => {
  it("returns null for an empty series or a viewport with no samples", () => {
    expect(seriesOf([], []).nearestSampleByX(5)).toBeNull();
    const series = seriesOf([1, 2, 3], [1, 2, 3]);
    expect(series.nearestSampleByX(50, { xMin: 40, xMax: 60, yMin: 0, yMax: 1 })).toBeNull();
  });

  it("finds the closest sample on either side and clamps beyond the ends", () => {
    const series = seriesOf([0, 10, 20, 30], [0, 1, 2, 3]);
    expect(series.nearestSampleByX(11)).toEqual({ index: 1, x: 10, y: 1 });
    expect(series.nearestSampleByX(19)).toEqual({ index: 2, x: 20, y: 2 });
    expect(series.nearestSampleByX(-100)).toEqual({ index: 0, x: 0, y: 0 });
    expect(series.nearestSampleByX(1000)).toEqual({ index: 3, x: 30, y: 3 });
  });

  it("prefers the left sample on an exact tie", () => {
    const series = seriesOf([0, 10], [5, 6]);
    expect(series.nearestSampleByX(5)).toEqual({ index: 0, x: 0, y: 5 });
  });

  it("skips gaps and returns the nearest real sample, or null when everything is a gap", () => {
    const series = seriesOf([0, 10, 20, 30], [1, NaN, NaN, 4]);
    expect(series.nearestSampleByX(11)).toEqual({ index: 0, x: 0, y: 1 });
    expect(series.nearestSampleByX(19)).toEqual({ index: 3, x: 30, y: 4 });
    expect(seriesOf([0, 1], [NaN, NaN]).nearestSampleByX(0.4)).toBeNull();
  });

  it("only considers samples inside the viewport span", () => {
    const series = seriesOf([0, 10, 20, 30], [0, 1, 2, 3]);
    expect(series.nearestSampleByX(0, { xMin: 15, xMax: 35, yMin: 0, yMax: 10 })).toEqual({ index: 2, x: 20, y: 2 });
  });
});

describe("nearestSampleByPoint", () => {
  const plot = { width: 200, height: 100 };

  it("returns null for degenerate viewports, plot sizes, and empty ranges", () => {
    const series = seriesOf([1, 2, 3], [1, 2, 3]);
    expect(series.nearestSampleByPoint(2, 2, view, 0, 100)).toBeNull();
    expect(series.nearestSampleByPoint(2, 2, view, 200, 0)).toBeNull();
    expect(series.nearestSampleByPoint(2, 2, { xMin: 5, xMax: 5, yMin: 0, yMax: 10 }, 200, 100)).toBeNull();
    expect(series.nearestSampleByPoint(2, 2, { xMin: 0, xMax: 10, yMin: 5, yMax: 5 }, 200, 100)).toBeNull();
    expect(series.nearestSampleByPoint(50, 2, { xMin: 40, xMax: 60, yMin: 0, yMax: 10 }, 200, 100)).toBeNull();
    expect(seriesOf([], []).nearestSampleByPoint(2, 2, view, 200, 100)).toBeNull();
  });

  it("measures distance in screen pixels, so a closer Y can beat a closer X", () => {
    // Plot is 200 x 100 px over 10 x 10 units: 20 px per X unit, 10 px per Y unit.
    const series = seriesOf([4, 5.6], [0, 9]);
    const hit = series.nearestSampleByPoint(5, 9, view, plot.width, plot.height) as SeriesSample & { distancePx: number };
    expect(hit.index).toBe(1);
    expect(hit.distancePx).toBeCloseTo(12, 5);
  });

  it("honors maxDistancePx, including a negative limit that matches nothing", () => {
    const series = seriesOf([5], [5]);
    expect(series.nearestSampleByPoint(5, 5, view, plot.width, plot.height, 0)).not.toBeNull();
    expect(series.nearestSampleByPoint(6, 5, view, plot.width, plot.height, 19)).toBeNull();
    expect(series.nearestSampleByPoint(6, 5, view, plot.width, plot.height, 21)).not.toBeNull();
    expect(series.nearestSampleByPoint(5, 5, view, plot.width, plot.height, -1)).toBeNull();
  });

  it("ignores gap samples", () => {
    const series = seriesOf([4, 5, 6], [4, NaN, 6]);
    const hit = series.nearestSampleByPoint(5, 5, view, plot.width, plot.height);
    expect([4, 6]).toContain(hit!.x);
    expect(seriesOf([1, 2], [NaN, NaN]).nearestSampleByPoint(1, 1, view, plot.width, plot.height)).toBeNull();
  });

  it("measures in scaled space when given axis transforms (log Y)", () => {
    const series = seriesOf([5, 5.1], [2, 1000]);
    const logView: Viewport = { xMin: 0, xMax: 10, yMin: 1, yMax: 1000 };
    const log = (v: number): number => Math.log10(v);
    // On a log axis, y=40 is far closer to 10^2 than to 10^3 once scaled.
    const hit = series.nearestSampleByPoint(5.05, 40, logView, 200, 100, Infinity, (v) => v, log);
    expect(hit!.y).toBe(2);
    const linear = series.nearestSampleByPoint(5.05, 40, logView, 200, 100);
    expect(linear!.y).toBe(2);
    const nearTop = series.nearestSampleByPoint(5.05, 600, logView, 200, 100, Infinity, (v) => v, log);
    expect(nearTop!.y).toBe(1000);
  });

  /** Brute-force nearest by screen distance, for comparing the pruned search against. */
  function brute(xs: number[], ys: number[], qx: number, qy: number, width: number, height: number, v: Viewport): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i]! < v.xMin || xs[i]! > v.xMax || !Number.isFinite(ys[i]!)) continue;
      const dx = ((xs[i]! - qx) * width) / (v.xMax - v.xMin);
      const dy = ((ys[i]! - qy) * height) / (v.yMax - v.yMin);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  it("matches a brute-force search on large data through the min/max interval pruning", () => {
    const count = 5_000;
    const xs = Array.from({ length: count }, (_, i) => i * 0.002);
    let seed = 7;
    const rand = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const ys = Array.from({ length: count }, (_, i) => (i % 97 === 0 ? NaN : rand() * 10));
    const series = seriesOf(xs, ys);
    for (let q = 0; q < 60; q++) {
      const qx = rand() * 10;
      const qy = rand() * 10;
      const expected = brute(xs, ys, qx, qy, 400, 300, view);
      const hit = series.nearestSampleByPoint(qx, qy, view, 400, 300);
      expect(hit?.index).toBe(expected);
    }
  });

  it("finds the same sample without interval bounds (a custom dataset that cannot answer min/max)", () => {
    const count = 400;
    const xs = Array.from({ length: count }, (_, i) => i * 0.025);
    const ys = Array.from({ length: count }, (_, i) => (i * 37) % 10);
    const inner = new RingBuffer(count);
    inner.append(xs, ys);
    const plain: Dataset = {
      get length() {
        return inner.length;
      },
      get range() {
        return inner.range;
      },
      getX: (i: number) => inner.getX(i),
      getY: (i: number) => inner.getY(i),
      lowerBoundX: (x: number) => inner.lowerBoundX(x),
      upperBoundX: (x: number) => inner.upperBoundX(x),
    } as unknown as Dataset;
    const series = new SeriesStore(plain, { mode: "line", capacity: count, downsample: "none" }, testStyle());
    const reference = seriesOf(xs, ys, { downsample: "none" });
    for (const [qx, qy] of [[1, 3], [5.5, 9], [9.9, 0.2], [0, 5]] as const) {
      expect(series.nearestSampleByPoint(qx, qy, view, 400, 300)?.index).toBe(brute(xs, ys, qx, qy, 400, 300, view));
      expect(reference.nearestSampleByPoint(qx, qy, view, 400, 300)?.index).toBe(brute(xs, ys, qx, qy, 400, 300, view));
    }
  });
});
