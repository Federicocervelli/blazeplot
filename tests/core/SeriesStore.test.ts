import { describe, it, expect } from "bun:test";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import type { RangeMinMaxDataset, TimeRange } from "../../src/core/types.ts";

function makeSeries(): SeriesStore {
  return new SeriesStore(
    new RingBuffer(8),
    { mode: "line", capacity: 8, downsample: "minmax" },
    { color: [1, 1, 1, 1], lineWidth: 1 },
  );
}

class TrackingRangeDataset implements RangeMinMaxDataset {
  rangeCalls = 0;
  getYCalls = 0;

  constructor(
    private readonly xData: readonly number[],
    private readonly yData: readonly number[],
  ) {}

  get length(): number {
    return Math.min(this.xData.length, this.yData.length);
  }

  get range(): TimeRange | null {
    if (this.length === 0) return null;
    return { start: this.xData[0]!, end: this.xData[this.length - 1]! };
  }

  getX(index: number): number {
    return this.xData[index]!;
  }

  getY(index: number): number {
    this.getYCalls++;
    return this.yData[index]!;
  }

  lowerBoundX(x: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.xData[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  upperBoundX(x: number): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (this.xData[mid]! <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  rangeMinMaxY(start: number, end: number): { minY: number; maxY: number } | null {
    this.rangeCalls++;
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.length, Math.ceil(end));
    if (to <= from) return null;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const y = this.yData[i]!;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minY, maxY };
  }
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

  it("copies visible min/max segments in instanced layout", () => {
    const series = makeSeries();
    series.append(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, 1, 9, 5, 2]),
    );

    const instances = new Float32Array(6);
    const count = series.copyMinMaxInstanced({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, instances, 2);

    expect(count).toBe(2);
    expect(Array.from(instances)).toEqual([1, 1, 7, 4, 2, 9]);
  });

  it("uses dataset range min/max aggregation when available", () => {
    const dataset = new TrackingRangeDataset([0, 1, 2, 3, 4, 5], [3, 7, 1, 9, 5, 2]);
    const series = new SeriesStore(
      dataset,
      { mode: "line", capacity: 6, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    const instances = new Float32Array(6);
    const count = series.copyMinMaxInstanced({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, instances, 2);

    expect(count).toBe(2);
    expect(Array.from(instances)).toEqual([1, 1, 7, 4, 2, 9]);
    expect(dataset.rangeCalls).toBe(2);
    expect(dataset.getYCalls).toBe(0);
  });

  it("queries LOD buckets through dataset range min/max aggregation when available", () => {
    const dataset = new TrackingRangeDataset([0, 1, 2, 3, 4, 5], [3, 7, 1, 9, 5, 2]);
    const series = new SeriesStore(
      dataset,
      { mode: "line", capacity: 6, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    const lod = series.query({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, 2);

    expect(lod.bucketCount).toBe(2);
    expect(Array.from(lod.buckets)).toEqual([1, 9, 2, 5]);
    expect(dataset.rangeCalls).toBe(2);
    expect(dataset.getYCalls).toBe(0);
  });

  it("uses equivalent buckets for line-list and instanced min/max layouts", () => {
    const series = makeSeries();
    series.append(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, 1, 9, 5, 2]),
    );

    const lineList = new Float32Array(8);
    const instances = new Float32Array(6);
    const vertexCount = series.copyMinMaxVisible({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, lineList, 2);
    const instanceCount = series.copyMinMaxInstanced({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, instances, 2);

    expect(vertexCount).toBe(instanceCount * 2);
    for (let i = 0; i < instanceCount; i++) {
      expect(instances[i * 3]).toBe(lineList[i * 4]);
      expect(instances[i * 3 + 1]).toBe(lineList[i * 4 + 1]);
      expect(instances[i * 3 + 2]).toBe(lineList[i * 4 + 3]);
    }
  });

  it("copies visible samples as an area strip", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2]), new Float32Array([4, -1, 7]));

    const area = new Float32Array(12);
    const count = series.copyAreaVisible({ xMin: 0, xMax: 2, yMin: -10, yMax: 10 }, area, 3, -2);

    expect(count).toBe(6);
    expect(Array.from(area)).toEqual([0, -2, 0, 4, 1, -2, 1, -1, 2, -2, 2, 7]);
  });

  it("counts visible samples", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([0, 0, 0, 0]));

    expect(series.visibleSampleCount({ xMin: 1, xMax: 2, yMin: 0, yMax: 1 })).toBe(2);
  });

  it("can include immediate outer samples in visible ranges", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([0, 0, 0, 0]));

    expect(series.visibleIndexRange({ xMin: 1, xMax: 2, yMin: 0, yMax: 1 }, 1)).toEqual({ start: 0, end: 4 });
  });

  it("clips raw visible line segments to the viewport", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 10]), new Float32Array([0, 10]));

    const raw = new Float32Array(4);
    const count = series.copyRawVisibleClipped({ xMin: 4, xMax: 6, yMin: 0, yMax: 10 }, raw, 2, 4);

    expect(count).toBe(2);
    expect(Array.from(raw)).toEqual([0, 4, 2, 6]);
  });

  it("finds nearest raw sample by x within the viewport", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([10, 20, 30, 40]));

    const sample = series.nearestSampleByX(1.8, { xMin: 0, xMax: 3, yMin: 0, yMax: 50 });

    expect(sample).toEqual({ index: 2, x: 2, y: 30 });
  });

  it("finds nearest raw sample by screen-space point", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2]), new Float32Array([0, 10, 0]));

    const sample = series.nearestSampleByPoint(1.1, 9, { xMin: 0, xMax: 2, yMin: 0, yMax: 10 }, 200, 100);

    expect(sample?.index).toBe(1);
    expect(sample?.x).toBe(1);
    expect(sample?.y).toBe(10);
    expect(sample?.distancePx).toBeGreaterThan(0);
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

describe("SeriesStore no-LOD", () => {
  it("has no pyramid when downsample is none", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "line", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.hasLOD).toBe(false);
  });

  it("has pyramid for line series when downsample is omitted (defaults to minmax)", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "line", capacity: 8 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.hasLOD).toBe(true);
  });

  it("skips pyramid for scatter series when downsample is omitted", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "scatter", capacity: 8 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.hasLOD).toBe(false);
  });

  it("has pyramid for bar series when downsample is omitted", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "bar", capacity: 8 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.hasLOD).toBe(true);
  });

  it("skips pyramid for bar series when downsample is none", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "bar", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.hasLOD).toBe(false);
  });

  it("skips pyramid for area series when downsample is omitted", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "area", capacity: 8 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.hasLOD).toBe(false);
  });

  it("copyMinMaxVisible returns 0 without LOD", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "scatter", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append(new Float64Array([0, 1, 2]), new Float32Array([4, -1, 7]));

    const segs = new Float32Array(8);
    expect(series.copyMinMaxVisible({ xMin: 0, xMax: 2, yMin: -10, yMax: 10 }, segs, 2)).toBe(0);
  });

  it("copyMinMaxInstanced returns 0 without LOD", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "scatter", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append(new Float64Array([0, 1, 2]), new Float32Array([4, -1, 7]));

    const segs = new Float32Array(6);
    expect(series.copyMinMaxInstanced({ xMin: 0, xMax: 2, yMin: -10, yMax: 10 }, segs, 2)).toBe(0);
  });

  it("query returns empty without LOD", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "scatter", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append(new Float64Array([0, 1, 2]), new Float32Array([4, -1, 7]));

    const lod = series.query({ xMin: 0, xMax: 2, yMin: -10, yMax: 10 }, 100);
    expect(lod.bucketCount).toBe(0);
  });

  it("copyRawVisible still works without LOD", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "scatter", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append(new Float64Array([0, 1, 2]), new Float32Array([4, -1, 7]));

    const raw = new Float32Array(6);
    const count = series.copyRawVisible({ xMin: 0, xMax: 2, yMin: -10, yMax: 10 }, raw, 3);

    expect(count).toBe(3);
    expect(Array.from(raw)).toEqual([0, 4, 1, -1, 2, 7]);
  });

  it("copies raw ranges without stride for chunked rendering", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "scatter", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([4, -1, 7, 9]));

    const raw = new Float32Array(4);
    const count = series.copyRawRange(1, 4, raw, 2);

    expect(count).toBe(2);
    expect(Array.from(raw)).toEqual([1, -1, 2, 7]);
  });

  it("copies area ranges without stride for chunked rendering", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "area", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append(new Float64Array([0, 1, 2]), new Float32Array([4, -1, 7]));

    const area = new Float32Array(8);
    const vertexCount = series.copyAreaRange(1, 3, area, 2, -2);

    expect(vertexCount).toBe(4);
    expect(Array.from(area)).toEqual([1, -2, 1, -1, 2, -2, 2, 7]);
  });
});
