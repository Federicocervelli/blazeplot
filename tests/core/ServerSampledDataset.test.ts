import { describe, expect, it } from "bun:test";
import { ServerSampledDataset } from "../../src/core/ServerSampledDataset.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";

describe("ServerSampledDataset", () => {
  it("stores server-sampled point data", () => {
    const dataset = new ServerSampledDataset({ kind: "points", x: [1, 2, 3], y: [4, 6, 5] });

    expect(dataset.sampleKind).toBe("points");
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
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );
    const target = new Float32Array(9);

    expect(series.hasServerMinMax).toBe(true);
    expect(series.dataBounds()).toEqual({ xMin: 5, xMax: 25, yMin: -2, yMax: 8 });
    const count = series.copyMinMaxInstanced({ xMin: 0, xMax: 30, yMin: -10, yMax: 10 }, target, 3);

    expect(count).toBe(3);
    expect(Array.from(target)).toEqual([5, 1, 5, 15, -2, 3, 25, 4, 8]);
  });

  it("can replace samples in place after a server fetch", () => {
    const dataset = new ServerSampledDataset({ kind: "points", x: [1], y: [2] });
    dataset.replaceBuckets({ xStart: [100], xEnd: [200], minY: [8], maxY: [12] });

    expect(dataset.sampleKind).toBe("minmax");
    expect(dataset.length).toBe(1);
    expect(dataset.getX(0)).toBe(150);
    expect(dataset.getY(0)).toBe(10);
  });
});
