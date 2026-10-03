import { describe, it, expect } from "bun:test";
import { testStyle } from "../helpers.ts";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";

describe("StaticDataset", () => {
  it("reports zero length for empty arrays", () => {
    const ds = new StaticDataset(new Float64Array(0), new Float32Array(0));
    expect(ds.length).toBe(0);
    expect(ds.range).toBeNull();
  });

  it("stores and retrieves x/y pairs", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1, 2, 3]),
      new Float32Array([10, 20, 30, 40]),
    );

    expect(ds.length).toBe(4);
    expect(ds.getX(0)).toBe(0);
    expect(ds.getY(0)).toBe(10);
    expect(ds.getX(3)).toBe(3);
    expect(ds.getY(3)).toBe(40);
    expect(ds.range).toEqual({ start: 0, end: 3 });
  });

  it("creates datasets from object rows", () => {
    const ds = StaticDataset.fromObjects([
      { time: 10, value: 3 },
      { time: 20, value: 8 },
    ], { x: "time", y: "value" });

    expect(ds.length).toBe(2);
    expect(ds.getX(0)).toBe(10);
    expect(ds.getY(1)).toBe(8);
  });

  it("can sort object rows by x", () => {
    const ds = StaticDataset.fromObjects([
      { time: 30, value: 9 },
      { time: 10, value: 3 },
      { time: 20, value: 8 },
    ], { x: "time", y: "value", sort: true });

    expect(Array.from({ length: ds.length }, (_, index) => ds.getX(index))).toEqual([10, 20, 30]);
    expect(Array.from({ length: ds.length }, (_, index) => ds.getY(index))).toEqual([3, 8, 9]);
  });

  it("supports accessor functions for object rows", () => {
    const ds = StaticDataset.fromObjects([
      [10, 3],
      [20, 8],
    ], {
      x: (row) => row[0]!,
      y: (row) => row[1]!,
    });

    expect(ds.getX(1)).toBe(20);
    expect(ds.getY(1)).toBe(8);
  });

  it("throws when object rows have invalid x values", () => {
    expect(() => StaticDataset.fromObjects([{ time: undefined, value: 3 }], { x: "time", y: "value" }))
      .toThrow(TypeError);
  });

  it("handles mismatched x and y lengths", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1, 2]),
      new Float32Array([10, 20]),
    );

    expect(ds.length).toBe(2);
  });

  it("finds lower bound for x", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 2, 4, 6, 8]),
      new Float32Array([0, 0, 0, 0, 0]),
    );

    expect(ds.lowerBoundX(3)).toBe(2);
    expect(ds.lowerBoundX(4)).toBe(2);
    expect(ds.lowerBoundX(0)).toBe(0);
    expect(ds.lowerBoundX(10)).toBe(5);
    expect(ds.lowerBoundX(-1)).toBe(0);
  });

  it("finds upper bound for x", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 2, 4, 6, 8]),
      new Float32Array([0, 0, 0, 0, 0]),
    );

    expect(ds.upperBoundX(3)).toBe(2);
    expect(ds.upperBoundX(4)).toBe(3);
    expect(ds.upperBoundX(0)).toBe(1);
    expect(ds.upperBoundX(10)).toBe(5);
  });

  it("treats non-finite y values as explicit gaps", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1, 2]),
      new Float32Array([10, NaN, Infinity]),
    );

    expect(ds.isGap(0)).toBe(false);
    expect(ds.isGap(1)).toBe(true);
    expect(ds.isGap(2)).toBe(true);
  });

  it("throws on out-of-range index", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1]),
      new Float32Array([0, 0]),
    );

    expect(() => ds.getX(-1)).toThrow(RangeError);
    expect(() => ds.getX(2)).toThrow(RangeError);
    expect(() => ds.getY(0.5)).toThrow(RangeError);
  });

  it("answers min/max ranges from a lazily built summary", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, NaN, 9, 5, 2]),
    );

    expect(ds.rangeMinMaxY(0, 6)).toEqual({ minY: 2, maxY: 9 });
    expect(ds.rangeMinMaxY(2, 3)).toBeNull();

    expect(ds.rangeMinMaxY(3, 6)).toEqual({ minY: 2, maxY: 9 });
  });

  it("works with SeriesStore as a non-appendable dataset", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, 1, 9, 5, 2]),
    );

    const store = new SeriesStore(
      ds,
      { mode: "line", capacity: 6, downsample: "minmax" },
      testStyle({ color: [1, 1, 1, 1], lineWidth: 1 }),
    );

    expect(store.length).toBe(6);
    expect(store.visible).toBe(true);

    expect(() => store.append({ x: new Float64Array([0]), y: new Float32Array([0]) }))
      .toThrow(TypeError);

    expect(store.visibleSampleCount({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 })).toBe(6);

    const raw = new Float32Array(12);
    const count = store.copyRawVisible({ xMin: 0, xMax: 5, yMin: -10, yMax: 10 }, raw, 6);
    expect(count).toBe(6);
    expect(Array.from(raw)).toEqual([0, 3, 1, 7, 2, 1, 3, 9, 4, 5, 5, 2]);
  });

  describe("changing data after construction", () => {
    const makeSeries = (x: Float64Array, y: Float32Array) => {
      const dataset = new StaticDataset(x, y);
      return { dataset, series: new SeriesStore(dataset, { mode: "line", downsample: "minmax" }, testStyle()) };
    };
    const x = Float64Array.from({ length: 1000 }, (_, i) => i);
    const ramp = () => Float32Array.from({ length: 1000 }, (_, i) => i % 50);

    it("recomputes min/max after in-place mutation plus markDirty", () => {
      const y = ramp();
      const { dataset, series } = makeSeries(x, y);
      expect(dataset.rangeMinMaxY(0, 1000)).toEqual({ minY: 0, maxY: 49 });

      y.fill(50);
      series.markDirty();

      expect(dataset.rangeMinMaxY(0, 1000)).toEqual({ minY: 50, maxY: 50 });
      expect(series.dataBounds()?.yMin).toBe(50);
    });

    it("replace({ y }) keeps X, adopts the new array, and reports its extent", () => {
      const { dataset, series } = makeSeries(x, ramp());
      dataset.rangeMinMaxY(0, 1000);

      const next = Float32Array.from({ length: 1000 }, (_, i) => -i - 1);
      series.replace({ y: next });

      expect(dataset.getX(999)).toBe(999);
      expect(dataset.getY(10)).toBe(-11);
      expect(dataset.rangeMinMaxY(0, 1000)).toEqual({ minY: -1000, maxY: -1 });
    });

    it("replace({ x, y }) handles a different length", () => {
      const { dataset, series } = makeSeries(x, ramp());
      dataset.rangeMinMaxY(0, 1000);

      series.replace({ x: new Float64Array([10, 20, 30]), y: new Float32Array([5, 1, 9]) });

      expect(dataset.length).toBe(3);
      expect(dataset.range).toEqual({ start: 10, end: 30 });
      expect(dataset.rangeMinMaxY(0, 3)).toEqual({ minY: 1, maxY: 9 });
      expect(dataset.rangeMinMaxY(0, 1000)).toEqual({ minY: 1, maxY: 9 });
    });

    it("replacing with the same array and length behaves like markDirty", () => {
      const y = ramp();
      const { dataset, series } = makeSeries(x, y);
      dataset.rangeMinMaxY(0, 1000);

      y[500] = 1000;
      series.replace({ y });

      expect(dataset.rangeMinMaxY(0, 1000)).toEqual({ minY: 0, maxY: 1000 });
    });
  });

  it("copies object rows at float64 precision on request and answers gap ranges", () => {
    const rows = [{ t: 0, v: 16_777_217 }, { t: 1, v: Number.NaN }, { t: 2, v: 3 }];
    expect(StaticDataset.fromObjects(rows, { x: "t", y: "v" }).getY(0)).toBe(16_777_216);
    const wide = StaticDataset.fromObjects(rows, { x: "t", y: "v", valuePrecision: "float64" });
    expect(wide.getY(0)).toBe(16_777_217);
    expect(wide.hasGapInRange(0, 1)).toBe(false);
    expect(wide.hasGapInRange(0, 2)).toBe(true);
    expect(wide.hasGapInRange(2, 3)).toBe(false);
  });
});
