import { describe, it, expect } from "bun:test";
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

  it("provides min/max ranges and render segments without upfront LOD builds", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, NaN, 9, 5, 2]),
    );

    expect(ds.rangeMinMaxY(0, 6)).toEqual({ minY: 2, maxY: 9 });
    expect(ds.rangeMinMaxY(2, 3)).toBeNull();

    const target = new Float32Array(12);
    const count = ds.copyMinMaxSegments({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, target, 4, "instanced", 0);
    expect(count).toBeGreaterThan(0);
    expect(Array.from(target.slice(0, count * 3)).some(Number.isNaN)).toBe(false);
  });

  it("works with SeriesStore as a non-appendable dataset", () => {
    const ds = new StaticDataset(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, 1, 9, 5, 2]),
    );

    const store = new SeriesStore(
      ds,
      { mode: "line", capacity: 6, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(store.length).toBe(6);
    expect(store.visible).toBe(true);
    expect(store.dirty).toBe(false);

    expect(() => store.append(new Float64Array([0]), new Float32Array([0])))
      .toThrow(TypeError);

    expect(store.visibleSampleCount({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 })).toBe(6);

    const raw = new Float32Array(12);
    const count = store.copyRawVisible({ xMin: 0, xMax: 5, yMin: -10, yMax: 10 }, raw, 6);
    expect(count).toBe(6);
    expect(Array.from(raw)).toEqual([0, 3, 1, 7, 2, 1, 3, 9, 4, 5, 5, 2]);
  });
});
