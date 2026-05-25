import { describe, expect, it } from "bun:test";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { histogram, histogramDataset } from "../../src/core/Histogram.ts";

function counts(result: ReturnType<typeof histogram>): number[] {
  return result.bins.map((bin) => bin.count);
}

describe("histogram", () => {
  it("bins values by fixed bin size", () => {
    const result = histogram([0.1, 0.2, 0.9, 1.1], { binSize: 1, min: 0, max: 2 });
    expect(Array.from(result.x)).toEqual([0.5, 1.5]);
    expect(Array.from(result.y)).toEqual([3, 1]);
    expect(counts(result)).toEqual([3, 1]);
    expect(result.binWidth).toBe(1);
    expect(result.total).toBe(4);
  });

  it("aligns fixed-size bins to zero by default", () => {
    const result = histogram([19.3838, 20.2, 24.9], { binSize: 5 });
    expect(result.bins.map((bin) => [bin.xStart, bin.xEnd, bin.count])).toEqual([
      [15, 20, 1],
      [20, 25, 2],
    ]);
  });

  it("bins values by fixed bin count", () => {
    const result = histogram([0, 1, 2, 3], { binCount: 3, min: 0, max: 3 });
    expect(counts(result)).toEqual([1, 1, 2]);
    expect(result.bins.map((bin) => [bin.xStart, bin.xEnd])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it("supports explicit uniform thresholds", () => {
    const result = histogram([0, 5, 10, 24, 25, 100], { thresholds: [0, 10, 25, 50, 100] });
    expect(counts(result)).toEqual([2, 2, 1, 1]);
    expect(result.binWidth).toBeNull();
    expect(result.min).toBe(0);
    expect(result.max).toBe(100);
  });

  it("uses deterministic default thresholds", () => {
    const result = histogram([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.bins.length).toBeGreaterThan(0);
    expect(result.bins.length).toBeLessThanOrEqual(512);
    expect(result.total).toBe(8);
    expect(result.invalid).toBe(0);
  });

  it("tracks invalid values and underflow/overflow", () => {
    const result = histogram([-1, 0, 1, 2, 3, Number.NaN, Infinity, "bad" as unknown as number], {
      binSize: 1,
      min: 0,
      max: 2,
    });
    expect(counts(result)).toEqual([1, 2]);
    expect(result.underflow).toBe(1);
    expect(result.overflow).toBe(1);
    expect(result.invalid).toBe(3);
    expect(result.total).toBe(3);
  });

  it("can exclude the upper edge", () => {
    const result = histogram([0, 1, 2], { binSize: 1, min: 0, max: 2, includeMax: false });
    expect(counts(result)).toEqual([1, 1]);
    expect(result.overflow).toBe(1);
  });

  it("can omit empty bins while preserving source bin indexes", () => {
    const result = histogram([0.1, 2.1], { binSize: 1, min: 0, max: 3, includeEmpty: false });
    expect(result.bins.map((bin) => bin.index)).toEqual([0, 2]);
    expect(Array.from(result.y)).toEqual([1, 1]);
  });

  it("supports probability, percent, and density normalization", () => {
    const probability = histogram([0.1, 0.2, 1.1, 1.2], { binSize: 1, min: 0, max: 2, normalize: "probability" });
    const percent = histogram([0.1, 0.2, 1.1, 1.2], { binSize: 1, min: 0, max: 2, normalize: "percent" });
    const density = histogram([0.1, 0.2, 1.1, 1.2], { binSize: 0.5, min: 0, max: 2, normalize: "density" });

    expect(Array.from(probability.y)).toEqual([0.5, 0.5]);
    expect(Array.from(percent.y)).toEqual([50, 50]);
    expect(Array.from(density.y)).toEqual([1, 0, 1, 0]);
  });

  it("returns empty arrays for empty input", () => {
    const result = histogram([], { binSize: 1, min: 0, max: 4 });
    expect(result.total).toBe(0);
    expect(result.bins).toEqual([]);
    expect(result.x.length).toBe(0);
    expect(result.y.length).toBe(0);
    expect(result.binWidth).toBe(1);
    expect(result.min).toBe(0);
    expect(result.max).toBe(4);
  });

  it("handles constant-value input", () => {
    const result = histogram([5, 5, 5], { binCount: 4 });
    expect(result.total).toBe(3);
    expect(result.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
    expect(result.min).toBeLessThan(5);
    expect(result.max).toBeGreaterThan(5);
  });

  it("supports negative values and non-zero alignment", () => {
    const result = histogram([-3.5, -1.1, 0.2, 2.9], { binSize: 2, align: 1 });
    expect(result.bins.map((bin) => [bin.xStart, bin.xEnd, bin.count])).toEqual([
      [-5, -3, 1],
      [-3, -1, 1],
      [-1, 1, 1],
      [1, 3, 1],
    ]);
  });

  it("keeps configured min/max as the included data range when bins are aligned outward", () => {
    const result = histogram([-0.2, 0.2, 1.2, 2.2], { binSize: 1, min: 0, max: 2.1, align: -0.5 });
    expect(result.bins.map((bin) => [bin.xStart, bin.xEnd, bin.count])).toEqual([
      [-0.5, 0.5, 1],
      [0.5, 1.5, 1],
      [1.5, 2.5, 0],
    ]);
    expect(result.underflow).toBe(1);
    expect(result.overflow).toBe(1);
    expect(result.min).toBe(0);
    expect(result.max).toBe(2.1);
  });

  it("accepts typed arrays and can produce a StaticDataset", () => {
    const values = new Float64Array([0, 0.2, 1.5]);
    const result = histogram(values, { binSize: 1, min: 0, max: 2 });
    const dataset = histogramDataset(values, { binSize: 1, min: 0, max: 2 });

    expect(result.x).toBeInstanceOf(Float64Array);
    expect(result.y).toBeInstanceOf(Float32Array);
    expect(dataset).toBeInstanceOf(StaticDataset);
    expect(dataset.length).toBe(2);
    expect(dataset.getXRange(0)).toEqual({ xStart: 0, xEnd: 1 });
    expect(dataset.getY(0)).toBe(2);
    expect(dataset.getY(1)).toBe(1);
  });

  it("rejects invalid bin definitions", () => {
    expect(() => histogram([1], { binSize: 0 })).toThrow(RangeError);
    expect(() => histogram([1], { binCount: 0 })).toThrow(RangeError);
    expect(() => histogram([1], { thresholds: [0, 0] })).toThrow(RangeError);
    expect(() => histogram([1], { binSize: 1, binCount: 2 })).toThrow(TypeError);
  });
});
