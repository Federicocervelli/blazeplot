import { describe, it, expect } from "bun:test";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { OhlcRingBuffer } from "../../src/core/OhlcDataset.ts";
import { UniformRingBuffer } from "../../src/core/UniformRingBuffer.ts";
import { histogramDataset } from "../../src/core/Histogram.ts";
import type { Dataset, RangeMinMaxDataset, TimeRange } from "../../src/core/types.ts";

function makeSeries(): SeriesStore {
  return new SeriesStore(
    new RingBuffer(8),
    { mode: "line", capacity: 8, downsample: "minmax" },
    { color: [1, 1, 1, 1], lineWidth: 1 },
  );
}

class ExplicitGapDataset implements Dataset {
  constructor(
    private readonly xData: readonly number[],
    private readonly yData: readonly number[],
    private readonly gapIndices: ReadonlySet<number>,
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
    return this.yData[index]!;
  }

  isGap(index: number): boolean {
    return this.gapIndices.has(index);
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

class FiniteGapRangeDataset extends TrackingRangeDataset {
  isGap(index: number): boolean {
    return index === 1;
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

  it("reports data bounds with optional x filtering and area/bar baseline inclusion", () => {
    const dataset = new StaticDataset([0, 1, 2, 3], [5, -2, 8, 1]);
    const series = new SeriesStore(
      dataset,
      { mode: "area", dataset, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1, baseline: -4 },
    );

    expect(series.dataBounds()).toEqual({ xMin: 0, xMax: 3, yMin: -4, yMax: 8 });
    expect(series.dataBounds({ xMin: 1.5, xMax: 3 })).toEqual({ xMin: 2, xMax: 3, yMin: -4, yMax: 8 });
    expect(series.dataBounds({ xMin: 10 })).toBeNull();
  });

  it("includes interval-backed sample ranges in data bounds", () => {
    const dataset = histogramDataset([0.2, 0.8, 1.2], { binSize: 1, min: 0, max: 2 });
    const series = new SeriesStore(
      dataset,
      { mode: "bar", dataset, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1, baseline: 0, barWidth: 1 },
    );

    expect(series.dataBounds()).toEqual({ xMin: 0, xMax: 2, yMin: 0, yMax: 2 });
  });

  it("exposes x range even when latest samples are gaps", () => {
    const series = makeSeries();
    series.append({ x: [1, 2, 3], y: [4, NaN, NaN] });

    expect(series.xRange).toEqual({ start: 1, end: 3 });
    expect(series.dataBounds()).toEqual({ xMin: 1, xMax: 1, yMin: 4, yMax: 4 });
  });

  it("appends y-only batches to datasets that support implicit x", () => {
    const series = new SeriesStore(
      new UniformRingBuffer(4, { xStart: 10, xStep: 5 }),
      { mode: "line", capacity: 4, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append({ y: new Float32Array([4, -1, 7]) });

    expect(series.length).toBe(3);
    const raw = new Float32Array(6);
    const count = series.copyRawVisible({ xMin: 10, xMax: 20, yMin: -10, yMax: 10 }, raw, 3);
    expect(count).toBe(3);
    expect(Array.from(raw)).toEqual([10, 4, 15, -1, 20, 7]);
  });

  it("appends XY samples through the generic series API", () => {
    const series = makeSeries();
    series.append({ x: new Float64Array([1, 2, 3]), y: new Float32Array([4, 5, 6]) });
    series.append({ x: 4, y: 7 });

    expect(series.length).toBe(4);
    expect(series.sampleAt(3)).toEqual({ index: 3, x: 4, y: 7 });
  });

  it("appends XY row arrays through the generic series API", () => {
    const series = makeSeries();
    series.append([
      { x: 1, y: 4 },
      { x: 2, y: 5 },
      { x: 3, y: 6 },
    ]);

    expect(series.length).toBe(3);
    expect(series.sampleAt(2)).toEqual({ index: 2, x: 3, y: 6 });
  });

  it("appends implicit-X row arrays through the generic series API", () => {
    const series = new SeriesStore(
      new UniformRingBuffer(4, { xStart: 10, xStep: 5 }),
      { mode: "line", capacity: 4, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    series.append([{ y: 4 }, { y: -1 }, { y: 7 }]);

    expect(series.length).toBe(3);
    expect(series.sampleAt(2)).toEqual({ index: 2, x: 20, y: 7 });
  });

  it("updates XY samples through updateAt and updateLast", () => {
    let dirtyCount = 0;
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "line", capacity: 8, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
      () => { dirtyCount += 1; },
    );
    series.append({ x: [1, 2, 3], y: [4, 5, 6] });

    expect(series.updateAt(1, { y: 50 })).toBe(true);
    expect(series.sampleAt(1)).toEqual({ index: 1, x: 2, y: 50 });
    expect(series.updateLast({ x: 4, y: 7 })).toBe(true);
    expect(series.sampleAt(2)).toEqual({ index: 2, x: 4, y: 7 });
    expect(series.updateAt(99, { y: 1 })).toBe(false);
    expect(dirtyCount).toBe(3);
  });

  it("updates implicit-X samples through updateLast without changing derived X values", () => {
    const series = new SeriesStore(
      new UniformRingBuffer(4, { xStart: 10, xStep: 5 }),
      { mode: "line", capacity: 4, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );
    series.append({ y: [4, -1, 7] });

    expect(series.updateLast({ y: 11 })).toBe(true);
    expect(series.sampleAt(2)).toEqual({ index: 2, x: 20, y: 11 });
    expect(() => series.updateAt(1, { x: 15, y: 12 })).toThrow("mutable XY dataset");
  });

  it("appends and updates OHLC datasets through the generic series API so on-demand charts become dirty", () => {
    let dirtyCount = 0;
    const dataset = new OhlcRingBuffer(8);
    const series = new SeriesStore(
      dataset,
      { mode: "ohlc", capacity: 8, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
      () => { dirtyCount += 1; },
    );

    series.append({ x: 10, open: 1, high: 2, low: 0.5, close: 1.5 });
    series.append([
      { x: 11, open: 2, high: 4, low: 1.5, close: 3 },
      { x: 12, open: 3, high: 5, low: 2.5, close: 4 },
    ]);
    expect(dataset.length).toBe(3);
    expect(dataset.getClose(0)).toBe(1.5);
    expect(dataset.getClose(2)).toBe(4);
    expect(dirtyCount).toBe(2);

    expect(series.updateAt(1, { open: 2.5, high: 4.5, low: 2, close: 3.5 })).toBe(true);
    expect(dataset.getOpen(1)).toBe(2.5);
    expect(dataset.getHigh(1)).toBe(4.5);
    expect(dataset.getLow(1)).toBe(2);
    expect(dataset.getClose(1)).toBe(3.5);

    expect(series.updateLast({ open: 1.5, high: 3, low: 1, close: 2.5 })).toBe(true);
    expect(dataset.getOpen(2)).toBe(1.5);
    expect(dataset.getHigh(2)).toBe(3);
    expect(dataset.getLow(2)).toBe(1);
    expect(dataset.getClose(2)).toBe(2.5);
    expect(dirtyCount).toBe(4);
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

  it("copies instanced min/max segments into an offset target view", () => {
    const series = makeSeries();
    series.append(
      new Float64Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([3, 7, 1, 9, 5, 2]),
    );

    const instances = new Float32Array([-1, -1, -1, 0, 0, 0, 0, 0, 99]);
    const count = series.copyMinMaxInstanced({ xMin: 0, xMax: 5, yMin: 0, yMax: 10 }, instances.subarray(3), 2);

    expect(count).toBe(2);
    expect(Array.from(instances)).toEqual([-1, -1, -1, 1, 1, 7, 4, 2, 9]);
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

  it("uses one range query for accelerated data bounds", () => {
    const dataset = new TrackingRangeDataset([0, 1, 2, 3, 4, 5], [3, 7, 1, 9, 5, 2]);
    const series = new SeriesStore(
      dataset,
      { mode: "line", dataset, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.dataBounds({ xMin: 1, xMax: 4 })).toEqual({ xMin: 1, xMax: 4, yMin: 1, yMax: 9 });
    expect(dataset.rangeCalls).toBe(1);
    expect(dataset.getYCalls).toBe(2);
  });

  it("does not aggregate range bounds across finite explicit gaps without an opt-in", () => {
    const dataset = new FiniteGapRangeDataset([0, 1, 2, 3], [3, 100, 1, 9]);
    const series = new SeriesStore(
      dataset,
      { mode: "line", dataset, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.dataBounds()).toEqual({ xMin: 0, xMax: 3, yMin: 1, yMax: 9 });
    expect(dataset.rangeCalls).toBe(3);
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

  it("encodes non-finite line and area samples as strip-breaking gaps", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([4, NaN, 7, 9]));

    const raw = new Float32Array(8);
    const rawCount = series.copyRawRange(0, 4, raw, 4);
    expect(rawCount).toBe(4);
    expect(raw[0]).toBe(0);
    expect(raw[1]).toBe(4);
    expect(Number.isNaN(raw[2]!)).toBe(true);
    expect(Number.isNaN(raw[3]!)).toBe(true);
    expect(Array.from(raw.subarray(4, 8))).toEqual([2, 7, 3, 9]);

    const area = new Float32Array(16);
    const areaCount = series.copyAreaRange(0, 4, area, 4, -2);
    expect(areaCount).toBe(8);
    expect(Array.from(area.subarray(0, 4))).toEqual([0, -2, 0, 4]);
    expect(Array.from(area.subarray(4, 8)).every(Number.isNaN)).toBe(true);
    expect(Array.from(area.subarray(8, 16))).toEqual([2, -2, 2, 7, 3, -2, 3, 9]);
  });

  it("preserves skipped gaps when visible sampling strides", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3, 4]), new Float32Array([4, NaN, 7, 9, 10]));

    const raw = new Float32Array(4);
    const rawCount = series.copyRawVisible({ xMin: 0, xMax: 4, yMin: -10, yMax: 10 }, raw, 2);
    expect(rawCount).toBe(2);
    expect(Array.from(raw.subarray(0, 2))).toEqual([0, 4]);
    expect(Array.from(raw.subarray(2, 4)).every(Number.isNaN)).toBe(true);
  });

  it("honors dataset-provided finite gaps for extraction and picking", () => {
    const dataset = new ExplicitGapDataset([0, 1, 2, 3], [4, 50, 7, 9], new Set([1]));
    const series = new SeriesStore(
      dataset,
      { mode: "line", dataset, downsample: "none" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    const raw = new Float32Array(8);
    const rawCount = series.copyRawRange(0, 4, raw, 4);
    expect(rawCount).toBe(4);
    expect(Number.isNaN(raw[2]!)).toBe(true);
    expect(Number.isNaN(raw[3]!)).toBe(true);
    expect(series.sampleAt(1)).toBeNull();
    expect(series.nearestSampleByX(1, { xMin: 0, xMax: 3, yMin: 0, yMax: 100 })).toEqual({ index: 0, x: 0, y: 4 });
  });

  it("counts visible samples", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3]), new Float32Array([0, 0, 0, 0]));

    expect(series.visibleSampleCount({ xMin: 1, xMax: 2, yMin: 0, yMax: 1 })).toBe(2);
  });

  it("copies scatter samples clipped to the y viewport", () => {
    const series = new SeriesStore(
      new StaticDataset([0, 1, 2, 3, 4], [0, 100, 1, 200, 2]),
      { mode: "scatter", capacity: 5 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    const raw = new Float32Array(10);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 4, yMin: 0, yMax: 10 }, raw, 5, 100, 100, 0);

    expect(count).toBe(3);
    expect(Array.from(raw.subarray(0, count * 2))).toEqual([0, 0, 2, 1, 4, 2]);
  });

  it("samples dense scatter using both x and y viewport bounds", () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = Array.from({ length: 100 }, (_, i) => (i === 55 ? 100 : 0));
    const series = new SeriesStore(
      new StaticDataset(x, y),
      { mode: "scatter", capacity: 100 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    const raw = new Float32Array(20);
    const count = series.copyScatterVisible({ xMin: 0, xMax: 99, yMin: 90, yMax: 110 }, raw, 10, 100, 100, 0);

    expect(count).toBe(1);
    expect(Array.from(raw.subarray(0, count * 2))).toEqual([55, 100]);
  });

  it("anchors dense min/max buckets to data indices so panning does not resample every segment", () => {
    const series = new SeriesStore(
      new RingBuffer(128),
      { mode: "line", capacity: 128, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );
    const x = Float64Array.from({ length: 64 }, (_, i) => i);
    const y = Float32Array.from({ length: 64 }, (_, i) => i % 11);
    series.append(x, y);

    const a = new Float32Array(12);
    const b = new Float32Array(12);
    const countA = series.copyMinMaxInstanced({ xMin: 0, xMax: 31, yMin: -10, yMax: 20 }, a, 4);
    const countB = series.copyMinMaxInstanced({ xMin: 1, xMax: 32, yMin: -10, yMax: 20 }, b, 4);

    expect(countA).toBe(4);
    expect(countB).toBe(4);
    expect([a[0], a[3], a[6], a[9]]).toEqual([4, 12, 20, 28]);
    expect([b[0], b[3], b[6], b[9]]).toEqual([4, 12, 20, 28]);

    const c = new Float32Array(12);
    const d = new Float32Array(12);
    series.copyMinMaxInstanced({ xMin: 0, xMax: 32, yMin: -10, yMax: 20 }, c, 4);
    series.copyMinMaxInstanced({ xMin: 0.1, xMax: 32.1, yMin: -10, yMax: 20 }, d, 4);
    expect([c[0], c[3], c[6], c[9]]).toEqual([4, 13, 22, 31]);
    expect([d[0], d[3], d[6], d[9]]).toEqual([4, 13, 22, 31]);
  });

  it("anchors dense raw/area samples to data indices so panning does not resample every point", () => {
    const series = new SeriesStore(
      new RingBuffer(128),
      { mode: "line", capacity: 128, downsample: "minmax" },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );
    const x = Float64Array.from({ length: 64 }, (_, i) => i);
    const y = Float32Array.from({ length: 64 }, (_, i) => i);
    series.append(x, y);

    const a = new Float32Array(8);
    const b = new Float32Array(8);
    const countA = series.copyRawVisible({ xMin: 0, xMax: 31, yMin: -10, yMax: 80 }, a, 4);
    const countB = series.copyRawVisible({ xMin: 1, xMax: 32, yMin: -10, yMax: 80 }, b, 4);

    expect(countA).toBe(4);
    expect(countB).toBe(4);
    expect([a[2], a[4], a[6]]).toEqual([8, 16, 24]);
    expect([b[2], b[4], b[6]]).toEqual([8, 16, 24]);

    const c = new Float32Array(8);
    const d = new Float32Array(8);
    series.copyRawVisible({ xMin: 0, xMax: 32, yMin: -10, yMax: 80 }, c, 4);
    series.copyRawVisible({ xMin: 0.1, xMax: 32.1, yMin: -10, yMax: 80 }, d, 4);
    expect([c[2], c[4], c[6]]).toEqual([9, 18, 27]);
    expect([d[2], d[4], d[6]]).toEqual([9, 18, 27]);
  });

  it("anchors dense scatter buckets to data indices so panning does not resample every point", () => {
    const x = Array.from({ length: 120 }, (_, i) => i);
    const y = Array.from({ length: 120 }, () => 1);
    const series = new SeriesStore(
      new StaticDataset(x, y),
      { mode: "scatter", capacity: 120 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    const first = new Float32Array(20);
    const second = new Float32Array(20);
    const firstCount = series.copyScatterVisible({ xMin: 0, xMax: 99, yMin: 0, yMax: 2 }, first, 10, 100, 100, 0);
    const secondCount = series.copyScatterVisible({ xMin: 1, xMax: 100, yMin: 0, yMax: 2 }, second, 10, 100, 100, 0);

    const firstX = Array.from(first.subarray(0, firstCount * 2)).filter((_, index) => index % 2 === 0);
    const secondX = Array.from(second.subarray(0, secondCount * 2)).filter((_, index) => index % 2 === 0);

    expect(firstX.slice(0, 6)).toEqual([5, 15, 25, 35, 45, 55]);
    expect(secondX.slice(0, 6)).toEqual(firstX.slice(0, 6));
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

  it("can copy clipped raw line segments directly in clip space", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 10]), new Float32Array([0, 10]));

    const raw = new Float32Array(4);
    const count = series.copyRawVisibleClipSpace({ xMin: 4, xMax: 6, yMin: 0, yMax: 10 }, raw, 2);

    expect(count).toBe(2);
    expect(raw[0]).toBe(-1);
    expect(raw[1]!).toBeCloseTo(-0.2);
    expect(raw[2]).toBe(1);
    expect(raw[3]!).toBeCloseTo(0.2);
  });

  it("does not connect clipped line extraction across gaps", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2, 3, 4]), new Float32Array([0, 1, NaN, 3, 4]));

    const raw = new Float32Array(12);
    const count = series.copyRawVisibleClipSpace({ xMin: 0, xMax: 4, yMin: 0, yMax: 4 }, raw, 6);

    expect(count).toBe(5);
    expect(Array.from(raw.subarray(0, 4))).toEqual([-1, -1, -0.5, -0.5]);
    expect(Number.isNaN(raw[4]!)).toBe(true);
    expect(Number.isNaN(raw[5]!)).toBe(true);
    expect(Array.from(raw.subarray(6, 10))).toEqual([0.5, 0.5, 1, 1]);
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

  it("respects nearest-point max screen-space distance", () => {
    const series = makeSeries();
    series.append(new Float64Array([0, 1, 2]), new Float32Array([0, 10, 0]));

    const sample = series.nearestSampleByPoint(1.1, 9, { xMin: 0, xMax: 2, yMin: 0, yMax: 10 }, 200, 100, 15);
    const outOfRange = series.nearestSampleByPoint(1.1, 9, { xMin: 0, xMax: 2, yMin: 0, yMax: 10 }, 200, 100, 5);

    expect(sample?.index).toBe(1);
    expect(outOfRange).toBeNull();
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

  it("has pyramid for scatter series when downsample is omitted", () => {
    const series = new SeriesStore(
      new RingBuffer(8),
      { mode: "scatter", capacity: 8 },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.hasLOD).toBe(true);
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
