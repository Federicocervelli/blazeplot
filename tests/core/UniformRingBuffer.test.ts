import { describe, it, expect } from "bun:test";
import { UniformRingBuffer } from "../../src/core/UniformRingBuffer.ts";

describe("UniformRingBuffer", () => {
  it("derives x values from xStart and xStep", () => {
    const buf = new UniformRingBuffer(5, { xStart: 100, xStep: 10 });
    buf.appendY([1, 2, 3]);

    expect(buf.length).toBe(3);
    expect(buf.range).toEqual({ start: 100, end: 120 });
    expect(Array.from({ length: buf.length }, (_, i) => [buf.getX(i), buf.getY(i)])).toEqual([
      [100, 1],
      [110, 2],
      [120, 3],
    ]);
  });

  it("wraps appended y batches at capacity", () => {
    const buf = new UniformRingBuffer(3, { xStart: 0, xStep: 2 });
    buf.appendY([10, 20, 30, 40, 50]);

    expect(buf.length).toBe(3);
    expect(buf.range).toEqual({ start: 4, end: 8 });
    expect(Array.from({ length: buf.length }, (_, i) => [buf.getX(i), buf.getY(i)])).toEqual([
      [4, 30],
      [6, 40],
      [8, 50],
    ]);
  });

  it("uses the first explicit x value when appended through the generic dataset API", () => {
    const buf = new UniformRingBuffer(4, { xStep: 5 });
    buf.append([50, 55, 60], [1, 2, 3]);

    expect(buf.range).toEqual({ start: 50, end: 60 });
    expect(buf.getX(1)).toBe(55);
  });

  it("searches logical x values after wrapping", () => {
    const buf = new UniformRingBuffer(4, { xStart: 10, xStep: 10 });
    buf.appendY([1, 2, 3, 4, 5, 6]);

    expect(buf.range).toEqual({ start: 30, end: 60 });
    expect(buf.lowerBoundX(45)).toBe(2);
    expect(buf.upperBoundX(50)).toBe(3);
  });

  it("returns min/max y over wrapped logical ranges", () => {
    const buf = new UniformRingBuffer(4, { blockSize: 2 });
    buf.appendY([10, 20, -5, 7, 4, 12]);

    expect(Array.from({ length: buf.length }, (_, i) => buf.getY(i))).toEqual([-5, 7, 4, 12]);
    expect(buf.rangeMinMaxY(0, 4)).toEqual({ minY: -5, maxY: 12 });
    expect(buf.rangeMinMaxY(1, 3)).toEqual({ minY: 4, maxY: 7 });
  });

  it("copies stable visible samples and min/max segments", () => {
    const buf = new UniformRingBuffer(8, { xStart: 0, xStep: 1, blockSize: 2 });
    buf.appendY([5, -1, 8, 3, 2, 7, 4, 6]);

    const samples = new Float32Array(8);
    const sampleCount = buf.copyVisibleSamples({ xMin: 1, xMax: 6, yMin: 0, yMax: 10 }, samples, 4, "points", 0, 0);
    expect(sampleCount).toBe(3);
    expect(Array.from(samples.slice(0, sampleCount * 2))).toEqual([2, 8, 4, 2, 6, 4]);

    const segments = new Float32Array(6);
    const segmentCount = buf.copyMinMaxSegments({ xMin: 0, xMax: 7, yMin: 0, yMax: 10 }, segments, 2, "instanced", 0);
    expect(segmentCount).toBe(2);
    expect(Array.from(segments)).toEqual([2, -1, 8, 6, 2, 7]);
  });
});
