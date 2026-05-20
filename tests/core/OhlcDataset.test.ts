import { describe, expect, it } from "bun:test";
import { OhlcRingBuffer, StaticOhlcDataset } from "../../src/core/OhlcDataset.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";

describe("StaticOhlcDataset", () => {
  it("stores OHLC tuples and exposes close as generic y", () => {
    const dataset = new StaticOhlcDataset(
      [1, 2],
      [10, 12],
      [14, 15],
      [8, 11],
      [13, 12.5],
    );

    expect(dataset.length).toBe(2);
    expect(dataset.range).toEqual({ start: 1, end: 2 });
    expect(dataset.getOpen(0)).toBe(10);
    expect(dataset.getHigh(0)).toBe(14);
    expect(dataset.getLow(0)).toBe(8);
    expect(dataset.getClose(0)).toBe(13);
    expect(dataset.getY(0)).toBe(13);
  });

  it("searches x values", () => {
    const dataset = new StaticOhlcDataset([1, 3, 5], [0, 0, 0], [1, 1, 1], [-1, -1, -1], [0, 0, 0]);

    expect(dataset.lowerBoundX(2)).toBe(1);
    expect(dataset.upperBoundX(3)).toBe(2);
  });

  it("reports data bounds from high/low values", () => {
    const dataset = new StaticOhlcDataset([1, 2], [10, 12], [14, 15], [8, 11], [13, 12.5]);
    const series = new SeriesStore(
      dataset,
      { mode: "candlestick", capacity: 2, dataset },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.dataBounds()).toEqual({ xMin: 1, xMax: 2, yMin: 8, yMax: 15 });
  });

  it("copies OHLC glyph line vertices", () => {
    const dataset = new StaticOhlcDataset([10], [2], [5], [1], [4]);
    const series = new SeriesStore(
      dataset,
      { mode: "ohlc", capacity: 1, dataset },
      { color: [1, 1, 1, 1], lineWidth: 1, tickWidth: 2 },
    );
    const target = new Float32Array(12);

    const count = series.copyOhlcRange(0, 1, target, 1, 2);

    expect(count).toBe(1);
    expect(Array.from(target)).toEqual([
      10, 1,
      10, 5,
      9, 2,
      10, 2,
      10, 4,
      11, 4,
    ]);
  });

  it("copies OHLC tuples for candlestick rendering", () => {
    const dataset = new StaticOhlcDataset([10], [2], [5], [1], [4]);
    const series = new SeriesStore(
      dataset,
      { mode: "candlestick", capacity: 1, dataset },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );
    const target = new Float32Array(5);

    const count = series.copyOhlcTuplesRange(0, 1, target, 1);

    expect(count).toBe(1);
    expect(Array.from(target)).toEqual([10, 2, 5, 1, 4]);
  });

  it("reads exact OHLC samples for data export", () => {
    const x = 1_700_000_000_001;
    const dataset = new StaticOhlcDataset([x], [2], [5], [1], [4]);
    const series = new SeriesStore(
      dataset,
      { mode: "candlestick", capacity: 1, dataset },
      { color: [1, 1, 1, 1], lineWidth: 1 },
    );

    expect(series.ohlcAt(0)).toEqual({ index: 0, x, y: 4, open: 2, high: 5, low: 1, close: 4 });
    expect(series.ohlcAt(1)).toBeNull();
  });
});

describe("OhlcRingBuffer", () => {
  it("wraps in logical x order", () => {
    const dataset = new OhlcRingBuffer(2);
    dataset.append([1, 2, 3], [10, 20, 30], [11, 21, 31], [9, 19, 29], [10.5, 20.5, 30.5]);

    expect(dataset.length).toBe(2);
    expect(dataset.range).toEqual({ start: 2, end: 3 });
    expect(dataset.getOpen(0)).toBe(20);
    expect(dataset.getClose(1)).toBe(30.5);
    expect(dataset.lowerBoundX(2.5)).toBe(1);
  });

  it("updates the latest candle in place for live bars", () => {
    const dataset = new OhlcRingBuffer(2);
    dataset.append([1, 2], [10, 20], [11, 21], [9, 19], [10.5, 20.5]);

    expect(dataset.updateLast(20, 25, 18, 24)).toBe(true);
    expect(dataset.getX(1)).toBe(2);
    expect(dataset.getOpen(1)).toBe(20);
    expect(dataset.getHigh(1)).toBe(25);
    expect(dataset.getLow(1)).toBe(18);
    expect(dataset.getClose(1)).toBe(24);
  });

  it("supports explicit overflow errors", () => {
    const dataset = new OhlcRingBuffer(1, { overflow: "error" });
    dataset.push(1, 10, 11, 9, 10.5);

    expect(() => dataset.push(2, 20, 21, 19, 20.5)).toThrow(RangeError);
    expect(dataset.length).toBe(1);
    expect(dataset.getX(0)).toBe(1);
  });
});
