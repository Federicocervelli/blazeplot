import { describe, expect, it } from "bun:test";
import { testStyle } from "../helpers.ts";
import { ServerSampledDataset } from "../../src/core/ServerSampledDataset.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";

describe("ServerSampledDataset", () => {
  it("stores server-sampled point data", () => {
    const dataset = new ServerSampledDataset({ kind: "points", x: [1, 2, 3], y: [4, 6, 5] });

    expect(dataset.kind).toBe("points");
    expect(dataset.length).toBe(3);
    expect(dataset.range).toEqual({ start: 1, end: 3 });
    expect(dataset.lowerBoundX(2)).toBe(1);
    expect(dataset.upperBoundX(2)).toBe(2);
    expect(dataset.rangeMinMaxY(0, 3)).toEqual({ minY: 4, maxY: 6 });
  });

  it("copies server min/max buckets directly for line rendering", () => {
    const dataset = new ServerSampledDataset({
      kind: "minmax",
      xStart: [0, 10, 20],
      xEnd: [10, 20, 30],
      minY: [1, -2, 4],
      maxY: [5, 3, 8],
    });
    const series = new SeriesStore(
      dataset,
      { mode: "line", dataset, downsample: "server" },
      testStyle({ color: [1, 1, 1, 1], lineWidth: 1 }),
    );
    const target = new Float32Array(9);

    expect(series.hasServerMinMax).toBe(true);
    expect(series.dataBounds()).toEqual({ xMin: 0, xMax: 30, yMin: -2, yMax: 8 });
    expect(dataset.getXRange(1)).toEqual({ xStart: 10, xEnd: 20 });
    const count = series.copyMinMaxInstanced({ xMin: 0, xMax: 30, yMin: -10, yMax: 10 }, target, 3);

    expect(count).toBe(3);
    expect(Array.from(target)).toEqual([5, 1, 5, 15, -2, 3, 25, 4, 8]);
  });

  it("keeps the rightmost bucket when aligning the first bucket down would need one more than maxSegments", () => {
    const count = 20;
    const dataset = new ServerSampledDataset({
      kind: "minmax",
      xStart: Array.from({ length: count }, (_, i) => i * 10),
      xEnd: Array.from({ length: count }, (_, i) => i * 10 + 10),
      minY: Array.from({ length: count }, () => 0),
      maxY: Array.from({ length: count }, (_, i) => i + 1),
    });
    // Visible buckets 4..19 (16 samples) at width 6 align down to 0, so 0-6, 6-12, 12-18, 18-24 is four buckets for a budget of three.
    const maxSegments = 3;
    const target = new Float32Array(maxSegments * 3);
    const written = dataset.copyMinMaxSegments({ xMin: 45, xMax: 200, yMin: 0, yMax: 1 }, target, maxSegments, 0);

    expect(written).toBeLessThanOrEqual(maxSegments);
    const maxes = Array.from({ length: written }, (_, i) => target[i * 3 + 2]!);
    // The newest bucket (maxY 20) is present, and the output still reaches the first visible one (maxY >= 5).
    expect(maxes[written - 1]).toBe(20);
    expect(maxes[0]!).toBeGreaterThanOrEqual(5);
  });

  it("can replace samples in place after a server fetch", () => {
    const dataset = new ServerSampledDataset({ kind: "points", x: [1], y: [2] });
    dataset.replace({ kind: "minmax", xStart: [100], xEnd: [200], minY: [8], maxY: [12] });

    expect(dataset.kind).toBe("minmax");
    expect(dataset.length).toBe(1);
    expect(dataset.getX(0)).toBe(150);
    expect(dataset.getY(0)).toBe(10);
  });
});
