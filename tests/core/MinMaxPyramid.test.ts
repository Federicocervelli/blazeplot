import { describe, it, expect } from "bun:test";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { MinMaxPyramid } from "../../src/core/MinMaxPyramid.ts";
import type { Dataset } from "../../src/core/types.ts";

function bruteMinMax(source: Dataset, start: number, end: number): { minY: number; maxY: number } | null {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = Math.max(0, start); i < Math.min(source.length, end); i++) {
    const y = source.getY(i);
    if (!Number.isFinite(y)) continue;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return minY <= maxY ? { minY, maxY } : null;
}

function expectMatchesBruteForce(pyramid: MinMaxPyramid, source: Dataset): void {
  for (let start = 0; start < source.length; start += 3) {
    for (let end = start + 1; end <= source.length; end += 5) {
      expect(pyramid.rangeMinMax(source, start, end)).toEqual(bruteMinMax(source, start, end));
    }
  }
}

function fill(buffer: RingBuffer, from: number, to: number, value: (i: number) => number): void {
  for (let i = from; i < to; i++) buffer.push(i, value(i));
}

describe("MinMaxPyramid", () => {
  it("answers range min/max queries like a brute-force scan", () => {
    const buffer = new RingBuffer(300);
    fill(buffer, 0, 300, (i) => Math.sin(i * 0.37) * 100 + (i % 7));
    const pyramid = new MinMaxPyramid();
    pyramid.build(buffer);

    expectMatchesBruteForce(pyramid, buffer);
  });

  it("skips gaps and returns null for all-gap ranges", () => {
    const buffer = new RingBuffer(8);
    for (const [x, y] of [[0, 5], [1, NaN], [2, NaN], [3, -2]] as const) buffer.push(x, y);
    const pyramid = new MinMaxPyramid();
    pyramid.build(buffer);

    expect(pyramid.rangeMinMax(buffer, 0, 4)).toEqual({ minY: -2, maxY: 5 });
    expect(pyramid.rangeMinMax(buffer, 1, 3)).toBeNull();
    expect(pyramid.rangeMinMax(buffer, 3, 3)).toBeNull();
  });

  it("extends incrementally to the same result as a full build", () => {
    const buffer = new RingBuffer(1000);
    fill(buffer, 0, 213, (i) => Math.sin(i * 0.05));
    const incremental = new MinMaxPyramid();
    incremental.build(buffer);

    fill(buffer, 213, 417, (i) => Math.cos(i * 0.11) * 3);
    incremental.incrementalBuild(buffer);
    fill(buffer, 417, 418, () => 9);
    incremental.incrementalBuild(buffer);

    expectMatchesBruteForce(incremental, buffer);
  });

  it("rebuilds when the source wraps or shrinks", () => {
    const buffer = new RingBuffer(64);
    fill(buffer, 0, 64, (i) => i);
    const pyramid = new MinMaxPyramid();
    pyramid.build(buffer);

    fill(buffer, 64, 80, (i) => -i);
    pyramid.incrementalBuild(buffer);
    expectMatchesBruteForce(pyramid, buffer);

    buffer.clear();
    fill(buffer, 0, 10, (i) => i * 2);
    pyramid.incrementalBuild(buffer);
    expectMatchesBruteForce(pyramid, buffer);
  });

  it("rejects invalid bucket sizes", () => {
    expect(() => new MinMaxPyramid(1)).toThrow(RangeError);
    expect(() => new MinMaxPyramid(2.5)).toThrow(RangeError);
  });
});
