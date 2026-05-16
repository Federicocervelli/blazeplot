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

  it("wraps around at capacity", () => {
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
});
