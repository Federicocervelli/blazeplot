import { describe, it, expect } from "bun:test";
import { RingBuffer } from "../../src/core/RingBuffer.ts";

describe("RingBuffer", () => {
  it("starts empty", () => {
    const buf = new RingBuffer(10);
    expect(buf.length).toBe(0);
    expect(buf.range).toBeNull();
  });

  it("stores and retrieves pushed values", () => {
    const buf = new RingBuffer(5);
    buf.push(1, 10);
    buf.push(2, 20);
    expect(buf.length).toBe(2);
    expect(buf.get(0)).toEqual({ x: 1, y: 10 });
    expect(buf.get(1)).toEqual({ x: 2, y: 20 });
  });

  it("returns null for out-of-range index", () => {
    const buf = new RingBuffer(5);
    buf.push(1, 10);
    expect(buf.get(-1)).toBeNull();
    expect(buf.get(1)).toBeNull();
    expect(buf.get(100)).toBeNull();
  });

  it("wraps around at capacity by default", () => {
    const buf = new RingBuffer(3);
    buf.push(1, 10);
    buf.push(2, 20);
    buf.push(3, 30);
    buf.push(4, 40);
    expect(buf.length).toBe(3);
    expect(buf.get(0)).toEqual({ x: 2, y: 20 });
    expect(buf.get(1)).toEqual({ x: 3, y: 30 });
    expect(buf.get(2)).toEqual({ x: 4, y: 40 });
  });

  it("drops new samples when overflow is drop-new", () => {
    const buf = new RingBuffer(3, { overflow: "drop-new" });
    buf.append([1, 2, 3, 4], [10, 20, 30, 40]);
    buf.push(5, 50);

    expect(buf.length).toBe(3);
    expect(buf.get(0)).toEqual({ x: 1, y: 10 });
    expect(buf.get(1)).toEqual({ x: 2, y: 20 });
    expect(buf.get(2)).toEqual({ x: 3, y: 30 });
  });

  it("throws atomically when overflow is error", () => {
    const buf = new RingBuffer(3, { overflow: "error" });
    buf.append([1, 2], [10, 20]);

    expect(() => buf.append([3, 4], [30, 40])).toThrow(RangeError);
    expect(buf.length).toBe(2);
    expect(buf.get(0)).toEqual({ x: 1, y: 10 });
    expect(buf.get(1)).toEqual({ x: 2, y: 20 });
  });

  it("handles multiple wraps", () => {
    const buf = new RingBuffer(2);
    for (let i = 0; i < 10; i++) buf.push(i, i * 10);
    expect(buf.length).toBe(2);
    expect(buf.get(0)).toEqual({ x: 8, y: 80 });
    expect(buf.get(1)).toEqual({ x: 9, y: 90 });
  });

  it("reports correct range", () => {
    const buf = new RingBuffer(100);
    buf.push(10, 100);
    buf.push(20, 200);
    const r = buf.range;
    expect(r).not.toBeNull();
    expect(r!.start).toBe(10);
    expect(r!.end).toBe(20);
  });

  it("clears correctly", () => {
    const buf = new RingBuffer(10);
    buf.push(1, 10);
    buf.push(2, 20);
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.range).toBeNull();
  });

  it("handles single element", () => {
    const buf = new RingBuffer(1);
    buf.push(42, 100);
    expect(buf.length).toBe(1);
    expect(buf.get(0)).toEqual({ x: 42, y: 100 });
    buf.push(99, 200);
    expect(buf.length).toBe(1);
    expect(buf.get(0)).toEqual({ x: 99, y: 200 });
  });

  it("rejects invalid capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(-1)).toThrow(RangeError);
    expect(() => new RingBuffer(1.5)).toThrow(RangeError);
  });

  it("searches logical x values after wrapping", () => {
    const buf = new RingBuffer(4);
    for (let i = 0; i < 6; i++) buf.push(i, i * 10);
    expect(buf.get(0)).toEqual({ x: 2, y: 20 });
    expect(buf.get(3)).toEqual({ x: 5, y: 50 });
    expect(buf.lowerBoundX(3.5)).toBe(2);
    expect(buf.upperBoundX(4)).toBe(3);
  });

  it("returns min/max y over logical ranges", () => {
    const buf = new RingBuffer(6);
    buf.append([0, 1, 2, 3, 4, 5], [5, -1, 8, 3, 2, 7]);

    expect(buf.rangeMinMaxY(1, 5)).toEqual({ minY: -1, maxY: 8 });
  });

  it("marks non-finite y values as gaps and excludes them from min/max ranges", () => {
    const buf = new RingBuffer(5);
    buf.append([0, 1, 2, 3, 4], [5, NaN, -2, Infinity, 7]);

    expect(buf.isGap(0)).toBe(false);
    expect(buf.isGap(1)).toBe(true);
    expect(buf.isGap(3)).toBe(true);
    expect(buf.rangeMinMaxY(0, 5)).toEqual({ minY: -2, maxY: 7 });
    expect(buf.rangeMinMaxY(1, 2)).toBeNull();
  });

  it("returns min/max y over wrapped logical ranges", () => {
    const buf = new RingBuffer(4);
    buf.append([0, 1, 2, 3, 4, 5], [10, 20, -5, 7, 4, 12]);

    expect(Array.from({ length: buf.length }, (_, i) => buf.getY(i))).toEqual([-5, 7, 4, 12]);
    expect(buf.rangeMinMaxY(0, 4)).toEqual({ minY: -5, maxY: 12 });
    expect(buf.rangeMinMaxY(1, 3)).toEqual({ minY: 4, maxY: 7 });
  });
});
