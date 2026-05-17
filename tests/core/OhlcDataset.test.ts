import { describe, expect, it } from "bun:test";
import { StaticOhlcDataset } from "../../src/core/OhlcDataset.ts";
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
});
