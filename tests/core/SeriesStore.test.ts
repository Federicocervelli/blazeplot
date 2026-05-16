import { describe, it, expect } from "bun:test";
import { SeriesStore } from "../../src/core/SeriesStore.ts";

function makeSeries(): SeriesStore {
  return new SeriesStore(
    { mode: "line", capacity: 8, downsample: "minmax" },
    { color: [1, 1, 1, 1], lineWidth: 1 },
  );
}

describe("SeriesStore", () => {
  it("appends numeric typed arrays", () => {
    const series = makeSeries();
    series.append(new Float32Array([0, 1, 2]), new Int16Array([4, -1, 7]));

    expect(series.length).toBe(3);

    const raw = new Float32Array(6);
    const count = series.copyRawVisible({ xMin: 0, xMax: 2, yMin: -10, yMax: 10 }, raw, 3);

    expect(count).toBe(3);
    expect(Array.from(raw)).toEqual([0, 4, 1, -1, 2, 7]);
  });

  it("copies visible min/max segments", () => {
    const series = makeSeries();
    series.append(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, 1, 9, 5, 2]),
    );

    const segments = new Float32Array(8);
    const count = series.copyMinMaxVisible({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, segments, 2);

    expect(count).toBe(4);
    expect(Array.from(segments)).toEqual([1, 1, 1, 7, 4, 2, 4, 9]);
  });

  it("counts visible samples", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([0, 0, 0, 0]));

    expect(series.visibleSampleCount({ xMin: 1, xMax: 2, yMin: 0, yMax: 1 })).toBe(2);
  });

  it("clears buffered data and rebuilt LOD state", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([10, 20, 30, 40]));
    series.rebuildPyramid();

    series.clear();

    expect(series.length).toBe(0);
    expect(series.dirty).toBe(false);
    expect(series.query({ xMin: 0, xMax: 3, yMin: 0, yMax: 50 }, 100).bucketCount).toBe(0);
  });

  it("toggles visibility", () => {
    const series = makeSeries();

    expect(series.visible).toBe(true);

    series.setVisible(false);
    expect(series.visible).toBe(false);

    series.setVisible(true);
    expect(series.visible).toBe(true);
  });
});
