import { describe, expect, it } from "bun:test";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import type { Dataset, SeriesConfig, Viewport, VisiblePointCopyDataset } from "../../src/core/types.ts";
import { testStyle } from "../helpers.ts";

function seriesOf(xs: ArrayLike<number>, ys: ArrayLike<number>, config: Partial<SeriesConfig> = {}): SeriesStore {
  const buffer = new RingBuffer(Math.max(1, xs.length));
  buffer.append(xs, ys);
  return new SeriesStore(buffer, { mode: "scatter", capacity: Math.max(1, xs.length), ...config }, testStyle());
}

/** Read the (x, y) pairs the sampler wrote. */
function readPoints(target: Float32Array, count: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, i) => [target[i * 2]!, target[i * 2 + 1]!]);
}

function ramp(count: number, y: (i: number) => number): { xs: Float64Array; ys: Float64Array } {
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = i;
    ys[i] = y(i);
  }
  return { xs, ys };
}

describe("copyScatterVisible exact paths", () => {
  it("returns nothing for empty budgets, undersized targets, and degenerate viewports", () => {
    const series = seriesOf([1, 2, 3], [1, 2, 3]);
    const view: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    expect(series.copyScatterVisible(view, new Float32Array(16), 0, 100, 100, 4)).toBe(0);
    expect(series.copyScatterVisible(view, new Float32Array(2), 4, 100, 100, 4)).toBe(0);
    expect(series.copyScatterVisible({ ...view, xMax: 0 }, new Float32Array(16), 8, 100, 100, 4)).toBe(0);
    expect(series.copyScatterVisible({ ...view, yMax: 0 }, new Float32Array(16), 8, 100, 100, 4)).toBe(0);
    expect(series.copyScatterVisible({ xMin: 50, xMax: 60, yMin: 0, yMax: 10 }, new Float32Array(16), 8, 100, 100, 4)).toBe(0);
  });

  it("culls by Y with a point-size margin, skips gaps, and shifts by the origins", () => {
    // Plot is 100 px tall over 10 units, so a 20 px point reaches 1 unit beyond the viewport.
    const series = seriesOf([0, 1, 2, 3, 4], [5, NaN, 10.5, 12, 5.5]);
    const target = new Float32Array(32);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, target, 16, 100, 100, 20, 100, 4);
    expect(readPoints(target, count)).toEqual([[-100, 1], [-98, 6.5], [-96, 1.5]]);
  });

  it("uses the exact interval walk when the visible count slightly exceeds the budget but Y culling fits it", () => {
    // 300 samples, only every third one inside the Y band: 100 points fit a budget of 120.
    const { xs, ys } = ramp(300, (i) => (i % 3 === 0 ? 5 : 500));
    const series = seriesOf(xs, ys);
    const target = new Float32Array(240);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 300, yMin: 0, yMax: 10 }, target, 120, 400, 100, 0);
    expect(count).toBe(100);
    expect(readPoints(target, count).every(([, y]) => y === 5)).toBe(true);
  });

  it("falls back to bucket sampling when the exact walk overflows the budget", () => {
    const { xs, ys } = ramp(300, () => 5);
    const series = seriesOf(xs, ys);
    const target = new Float32Array(240);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 300, yMin: 0, yMax: 10 }, target, 120, 400, 100, 0);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(120);
  });

  it("walks exact points without interval bounds for a dataset that cannot answer min/max", () => {
    const { xs, ys } = ramp(300, (i) => (i % 3 === 0 ? 5 : 500));
    const inner = new RingBuffer(300);
    inner.append(xs, ys);
    const plain = {
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
    const series = new SeriesStore(plain, { mode: "scatter", capacity: 300, downsample: "none" }, testStyle());
    const target = new Float32Array(240);
    expect(series.copyScatterVisible({ xMin: 0, xMax: 300, yMin: 0, yMax: 10 }, target, 120, 400, 100, 0)).toBe(100);
  });

  it("skips the whole range when its Y bounds lie outside the viewport", () => {
    const { xs, ys } = ramp(1_000, (i) => 1_000 + (i % 7));
    const series = seriesOf(xs, ys);
    const target = new Float32Array(100);
    expect(series.copyScatterVisible({ xMin: 0, xMax: 1_000, yMin: 0, yMax: 10 }, target, 50, 400, 100, 0)).toBe(0);
  });
});

describe("copyScatterVisible bucket sampling", () => {
  it("samples a dense range down to the point budget with stable representatives", () => {
    const { xs, ys } = ramp(50_000, (i) => 1 + (i % 5));
    const series = seriesOf(xs, ys);
    const first = new Float32Array(200);
    const second = new Float32Array(200);
    const a = series.copyScatterVisible({ xMin: 0, xMax: 50_000, yMin: 0, yMax: 10 }, first, 100, 400, 100, 0);
    const b = series.copyScatterVisible({ xMin: 0, xMax: 50_000, yMin: 0, yMax: 10 }, second, 100, 400, 100, 0);
    expect(a).toBeGreaterThan(10);
    expect(a).toBeLessThanOrEqual(100);
    expect(b).toBe(a);
    expect(second.slice(0, a * 2)).toEqual(first.slice(0, a * 2));
  });

  it("uses a neighboring sample when a bucket's representative is a gap", () => {
    const { xs, ys } = ramp(20_000, (i) => (i % 2 === 0 ? NaN : 3));
    const series = seriesOf(xs, ys);
    const target = new Float32Array(200);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 20_000, yMin: 0, yMax: 10 }, target, 100, 400, 100, 0);
    expect(count).toBeGreaterThan(10);
    expect(readPoints(target, count).every(([, y]) => y === 3)).toBe(true);
  });

  it("prunes buckets outside the Y band using interval bounds and keeps those fully inside", () => {
    // Mostly in-band data with one stretch far above it and a lone out-of-band spike.
    const { xs, ys } = ramp(200_000, (i) => (i >= 60_000 && i < 90_000 ? 5_000 : i === 150_000 ? 5_000 : 2));
    const series = seriesOf(xs, ys);
    const target = new Float32Array(400);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 200_000, yMin: 0, yMax: 10 }, target, 100, 800, 100, 0);
    expect(count).toBeGreaterThan(10);
    const points = readPoints(target, count);
    expect(points.every(([, y]) => y === 2)).toBe(true);
    // Nothing is drawn from the stretch that is entirely above the band.
    expect(points.some(([x]) => x >= 60_000 && x < 90_000)).toBe(false);
  });

  it("scans a bucket for its first in-band sample when interval bounds say it is mixed", () => {
    const { xs, ys } = ramp(100_000, (i) => (i % 10 === 0 ? 5 : 5_000));
    const series = seriesOf(xs, ys);
    const target = new Float32Array(200);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 100_000, yMin: 0, yMax: 10 }, target, 100, 400, 100, 0);
    expect(count).toBeGreaterThan(10);
    expect(readPoints(target, count).every(([, y]) => y === 5)).toBe(true);
  });
});

describe("copyScatterVisible with a dataset that copies visible points itself", () => {
  it("delegates to the dataset and shifts Y by the origin", () => {
    const seen: unknown[][] = [];
    const dataset: VisiblePointCopyDataset = {
      length: 2,
      range: { start: 0, end: 1 },
      getX: (i: number) => i,
      getY: (i: number) => i,
      lowerBoundX: () => 0,
      upperBoundX: () => 2,
      copyVisiblePoints: (viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number, pixelWidth: number, pixelHeight: number, pointSize: number) => {
        seen.push([viewport, maxPoints, xOrigin, pixelWidth, pixelHeight, pointSize]);
        target.set([1, 10, 2, 20]);
        return 2;
      },
    } as unknown as VisiblePointCopyDataset;
    const series = new SeriesStore(dataset, { mode: "scatter", capacity: 2 }, testStyle());
    const target = new Float32Array(8);
    const view: Viewport = { xMin: 0, xMax: 2, yMin: 0, yMax: 30 };
    const count = series.copyScatterVisible(view, target, 4, 300, 100, 5, 7, 5);
    expect(count).toBe(2);
    expect(seen).toEqual([[view, 4, 7, 300, 100, 5]]);
    // Custom datasets keep the public signature and are shifted in place afterwards.
    expect(readPoints(target, count)).toEqual([[1, 5], [2, 15]]);
  });
});

describe("copyScatterRange", () => {
  const view: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

  it("returns nothing for empty budgets, small targets, and empty or inverted ranges", () => {
    const series = seriesOf([0, 1, 2, 3], [1, 2, 3, 4]);
    expect(series.copyScatterRange(0, 4, view, new Float32Array(16), 0)).toBe(0);
    expect(series.copyScatterRange(0, 4, view, new Float32Array(2), 4)).toBe(0);
    expect(series.copyScatterRange(3, 3, view, new Float32Array(16), 8)).toBe(0);
    expect(series.copyScatterRange(10, 20, view, new Float32Array(16), 8)).toBe(0);
  });

  it("clamps the index range, culls Y with the point margin, and skips gaps", () => {
    const series = seriesOf([0, 1, 2, 3, 4, 5], [5, 20, NaN, 10.4, -0.4, 5]);
    const target = new Float32Array(32);
    // 10 px points on a 100 px plot reach 0.5 units beyond the viewport.
    const count = series.copyScatterRange(-3, 99, view, target, 16, 0, 100, 10);
    expect(readPoints(target, count).map(([x, y]) => [x, Number(y.toFixed(3))])).toEqual([[0, 5], [3, 10.4], [4, -0.4], [5, 5]]);
    // Non-finite or negative sizes and a missing pixel height add no margin.
    const exact = new Float32Array(32);
    const strict = series.copyScatterRange(0, 6, view, exact, 16, 0, 0, Number.NaN);
    expect(readPoints(exact, strict).map(([x]) => x)).toEqual([0, 5]);
  });

  it("stops at the point budget", () => {
    const { xs, ys } = ramp(50, () => 5);
    const series = seriesOf(xs, ys);
    const target = new Float32Array(20);
    expect(series.copyScatterRange(0, 50, { xMin: 0, xMax: 50, yMin: 0, yMax: 10 }, target, 10)).toBe(10);
  });
});
