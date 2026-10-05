import { describe, expect, it } from "bun:test";
import { binSamples, rollingMean } from "../../src/data.ts";

const samples = [
  { x: 0.5, y: 2 },
  { x: 1.5, y: 4 },
  { x: 1.9, y: 8 },
  { x: 2.0, y: 6 },
  { x: 3.2, y: -2 },
];

describe("binSamples", () => {
  it("rejects bin sizes that are not positive and finite", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => binSamples(samples, size)).toThrow(RangeError);
    }
  });

  it("reduces with the mean by default and reports bin bounds, counts, and extremes", () => {
    const bins = binSamples(samples, 1);
    expect(bins.map((bin) => [bin.xStart, bin.xEnd, bin.count, bin.y, bin.minY, bin.maxY])).toEqual([
      [0, 1, 1, 2, 2, 2],
      [1, 2, 2, 6, 4, 8],
      [2, 3, 1, 6, 6, 6],
      [3, 4, 1, -2, -2, -2],
    ]);
    // The default X is the bin center.
    expect(bins.map((bin) => bin.x)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it("supports every reducer", () => {
    const y = (reducer: "mean" | "sum" | "min" | "max" | "first" | "last"): number => binSamples(samples, 2, { reducer }).find((bin) => bin.xStart === 0)!.y;
    // Bin [0, 2): 2, 4, 8.
    expect(y("mean")).toBeCloseTo(14 / 3);
    expect(y("sum")).toBe(14);
    expect(y("min")).toBe(2);
    expect(y("max")).toBe(8);
    expect(y("first")).toBe(2);
    expect(y("last")).toBe(8);
  });

  it("places each bin's X at its start, center, or end", () => {
    const xs = (x: "start" | "center" | "end"): number[] => binSamples(samples, 2, { x }).map((bin) => bin.x);
    expect(xs("start")).toEqual([0, 2]);
    expect(xs("center")).toEqual([1, 3]);
    expect(xs("end")).toEqual([2, 4]);
  });

  it("aligns buckets to a custom origin, including negative X, and ignores a non-finite align", () => {
    const aligned = binSamples([{ x: -1.5, y: 1 }, { x: 0.4, y: 3 }, { x: 0.6, y: 5 }], 1, { align: 0.5 });
    expect(aligned.map((bin) => [bin.xStart, bin.xEnd, bin.count])).toEqual([[-1.5, -0.5, 1], [-0.5, 0.5, 1], [0.5, 1.5, 1]]);
    expect(binSamples([{ x: 0.4, y: 1 }], 1, { align: Number.NaN })[0]!.xStart).toBe(0);
  });

  it("returns sorted bins for unsorted input, skips non-finite samples, and returns [] for no usable samples", () => {
    const bins = binSamples([{ x: 5, y: 1 }, { x: Number.NaN, y: 1 }, { x: 1, y: Number.POSITIVE_INFINITY }, { x: 1, y: 2 }, { x: 2, y: Number.NaN }], 1);
    expect(bins.map((bin) => [bin.xStart, bin.y])).toEqual([[1, 2], [5, 1]]);
    expect(binSamples([], 1)).toEqual([]);
    expect(binSamples([{ x: Number.NaN, y: 1 }], 1)).toEqual([]);
  });

  it("keeps fractional bin sizes exact enough to bucket boundary values consistently", () => {
    const bins = binSamples([{ x: 0.1, y: 1 }, { x: 0.2, y: 2 }, { x: 0.3, y: 3 }], 0.1);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
  });
});

describe("rollingMean", () => {
  it("rejects window sizes that are not positive integers", () => {
    for (const size of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rollingMean(samples, size)).toThrow(RangeError);
    }
  });

  it("averages over the previous window, preserving X, with a growing window at the start", () => {
    const smoothed = rollingMean([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }, { x: 4, y: 8 }], 2);
    expect(smoothed).toEqual([
      { x: 1, y: 2, count: 1 },
      { x: 2, y: 3, count: 2 },
      { x: 3, y: 5, count: 2 },
      { x: 4, y: 7, count: 2 },
    ]);
  });

  it("a window of one is the identity, and a window larger than the input is the cumulative mean", () => {
    const identity = rollingMean(samples, 1);
    expect(identity.map((sample) => sample.y)).toEqual(samples.map((sample) => sample.y));
    const cumulative = rollingMean([{ x: 0, y: 3 }, { x: 1, y: 5 }, { x: 2, y: 10 }], 100);
    expect(cumulative.map((sample) => sample.y)).toEqual([3, 4, 6]);
    expect(cumulative.map((sample) => sample.count)).toEqual([1, 2, 3]);
  });

  it("skips non-finite samples without letting them into the window", () => {
    const smoothed = rollingMean([{ x: 0, y: 2 }, { x: 1, y: Number.NaN }, { x: Number.NaN, y: 9 }, { x: 2, y: 4 }], 3);
    expect(smoothed).toEqual([
      { x: 0, y: 2, count: 1 },
      { x: 2, y: 3, count: 2 },
    ]);
    expect(rollingMean([], 3)).toEqual([]);
  });
});
