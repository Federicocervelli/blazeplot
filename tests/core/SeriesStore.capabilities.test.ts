import { describe, expect, it } from "bun:test";
import { testStyle } from "../helpers.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import type { Dataset } from "../../src/core/types.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";

class GapRing extends RingBuffer {
  gapAt = 1;
  override isGap(index: number): boolean {
    return index === this.gapAt;
  }
}

function filled<T extends RingBuffer>(buffer: T): T {
  for (let i = 0; i < 3; i++) buffer.push(i, i);
  return buffer;
}

describe("SeriesStore dataset capabilities", () => {
  it("captures the gap predicate once at construction", () => {
    const dataset = filled(new GapRing(4));
    const series = new SeriesStore(dataset, { mode: "line", capacity: 4, downsample: "none" }, testStyle());
    expect(series.sampleAt(1)).toBeNull();
    expect(series.sampleAt(0)).not.toBeNull();
    dataset.gapAt = 2;
    expect(series.sampleAt(1)).not.toBeNull();
    expect(series.sampleAt(2)).toBeNull();
  });

  it("does not pick up capabilities added after construction", () => {
    const xs = [0, 1, 2];
    const plain: Dataset = {
      length: 3,
      range: { start: 0, end: 2 },
      getX: (i) => xs[i]!,
      getY: (i) => xs[i]!,
      lowerBoundX: (x) => xs.findIndex((v) => v >= x),
      upperBoundX: (x) => xs.filter((v) => v <= x).length,
    };
    const series = new SeriesStore(plain, { mode: "line", capacity: 3, downsample: "none" }, testStyle());
    (plain as { isGap?: (index: number) => boolean }).isGap = () => true;
    expect(series.sampleAt(1)).not.toBeNull();
  });

  it("resolves downsampling flags once", () => {
    const series = new SeriesStore(new RingBuffer(4), { mode: "line", capacity: 4, downsample: "minmax" }, testStyle());
    expect(series.downsampled).toBe(true);
    expect(series.hasServerMinMax).toBe(false);
    const raw = new SeriesStore(new RingBuffer(4), { mode: "line", capacity: 4, downsample: "none" }, testStyle());
    expect(raw.downsampled).toBe(false);
  });
});
