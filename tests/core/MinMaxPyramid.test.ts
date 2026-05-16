import { describe, it, expect } from "bun:test";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { MinMaxPyramid } from "../../src/core/MinMaxPyramid.ts";

function makeSource(points: [number, number][]): RingBuffer {
  const buf = new RingBuffer(points.length);
  for (const [x, y] of points) buf.push(x, y);
  return buf;
}

describe("MinMaxPyramid", () => {
  it("builds single bucket from two points", () => {
    const buf = makeSource([[0, 1], [1, 5]]);
    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    const result = pyramid.query(
      { xMin: 0, xMax: 2, yMin: 0, yMax: 10 },
      100,
      { start: 0, length: 2 },
    );
    expect(result.bucketCount).toBe(1);
    const b = result.buckets;
    expect(b[0]).toBe(1);
    expect(b[1]).toBe(5);
  });

  it("returns correct min/max for each bucket", () => {
    const buf = makeSource([[0, 3], [1, 7], [2, 1], [3, 9], [4, 5]]);
    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    const result = pyramid.query(
      { xMin: 0, xMax: 5, yMin: 0, yMax: 10 },
      100,
      { start: 0, length: 5 },
    );
    expect(result.bucketCount).toBe(3);
    // bucket 0: points [0,1] → min=3, max=7
    expect(result.buckets[0]).toBe(3);
    expect(result.buckets[1]).toBe(7);
    // bucket 1: points [2,3] → min=1, max=9
    expect(result.buckets[2]).toBe(1);
    expect(result.buckets[3]).toBe(9);
    // bucket 2: point [4] only → min=5, max=5
    expect(result.buckets[4]).toBe(5);
    expect(result.buckets[5]).toBe(5);
  });

  it("returns empty for empty source", () => {
    const buf = new RingBuffer(10);
    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    const result = pyramid.query(
      { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
      100,
      { start: 0, length: 0 },
    );
    expect(result.bucketCount).toBe(0);
  });

  it("selects higher LOD level for dense viewport", () => {
    const buf = makeSource(
      Array.from({ length: 256 }, (_, i) => [i, Math.sin(i * 0.1)] as [number, number]),
    );
    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    // narrow viewport → low samplesPerPixel → lower level (more detail)
    const narrow = pyramid.query(
      { xMin: 0, xMax: 10, yMin: -2, yMax: 2 },
      100,
      { start: 0, length: 256 },
    );
    // wide viewport → high samplesPerPixel → higher level (less data)
    const wide = pyramid.query(
      { xMin: 0, xMax: 256, yMin: -2, yMax: 2 },
      100,
      { start: 0, length: 256 },
    );
    expect(narrow.level).toBeLessThanOrEqual(wide.level);
    expect(narrow.samplesPerPixel).toBeLessThanOrEqual(wide.samplesPerPixel);
  });

  it("handles empty query range", () => {
    const buf = makeSource([[0, 1], [1, 2]]);
    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    const result = pyramid.query(
      { xMin: 100, xMax: 200, yMin: 0, yMax: 1 },
      100,
      { start: 2, length: 0 },
    );
    expect(result.bucketCount).toBe(0);
  });

  it("rebuild after clear", () => {
    const buf = makeSource([[0, 1], [1, 2]]);
    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    expect(pyramid.query({ xMin: 0, xMax: 2, yMin: 0, yMax: 3 }, 100, { start: 0, length: 2 }).bucketCount).toBe(1);
    buf.clear();
    pyramid.build(buf);
    expect(pyramid.query({ xMin: 0, xMax: 2, yMin: 0, yMax: 3 }, 100, { start: 0, length: 0 }).bucketCount).toBe(0);
  });

  it("combines min/max pairs correctly at higher levels", () => {
    const buf = makeSource([[0, 10], [1, 1], [2, 5], [3, 6], [4, 3], [5, 7], [6, 9], [7, 2]]);
    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    const result = pyramid.query(
      { xMin: 0, xMax: 8, yMin: 0, yMax: 10 },
      2,
      { start: 0, length: 8 },
    );
    expect(result.level).toBe(1);
    expect(result.bucketCount).toBe(2);
    expect(Array.from(result.buckets)).toEqual([1, 10, 2, 9]);
  });

  it("builds from logical ring order after wrap", () => {
    const buf = new RingBuffer(4);
    buf.push(0, 100);
    buf.push(1, 200);
    buf.push(2, 10);
    buf.push(3, 20);
    buf.push(4, 30);
    buf.push(5, 40);

    const pyramid = new MinMaxPyramid(2);
    pyramid.build(buf);
    const result = pyramid.query(
      { xMin: 2, xMax: 5, yMin: 0, yMax: 50 },
      100,
      { start: 0, length: 4 },
    );

    expect(result.bucketCount).toBe(2);
    expect(Array.from(result.buckets)).toEqual([10, 20, 30, 40]);
  });

  it("rejects invalid bucket size", () => {
    expect(() => new MinMaxPyramid(1)).toThrow(RangeError);
    expect(() => new MinMaxPyramid(2.5)).toThrow(RangeError);
  });
});
