import { describe, expect, it } from "bun:test";
import { lowerBound, lowerBoundRing, lowerBoundTyped, upperBound, upperBoundRing, upperBoundTyped } from "../../src/core/search.ts";

const sorted = [1, 2, 2, 2, 5, 7, 7, 9];
const probes = [0, 1, 1.5, 2, 3, 5, 6, 7, 8, 9, 10, NaN];

describe("typed binary search", () => {
  it("matches the callback form for every probe, including duplicates and out-of-range values", () => {
    for (const x of probes) {
      expect(lowerBoundTyped(sorted, sorted.length, x)).toBe(lowerBound(sorted.length, (i) => sorted[i]!, x));
      expect(upperBoundTyped(sorted, sorted.length, x)).toBe(upperBound(sorted.length, (i) => sorted[i]!, x));
    }
  });

  it("only searches the first `length` entries of a larger array", () => {
    const values = new Float64Array([1, 3, 5, 99, 99]);
    expect(lowerBoundTyped(values, 3, 4)).toBe(2);
    expect(lowerBoundTyped(values, 3, 100)).toBe(3);
    expect(upperBoundTyped(values, 3, 5)).toBe(3);
    expect(lowerBoundTyped(values, 0, 4)).toBe(0);
  });
});

describe("ring binary search", () => {
  it("matches the callback form over the logical order for every start offset", () => {
    for (let capacity = sorted.length; capacity <= sorted.length + 2; capacity++) {
      for (let start = 0; start < capacity; start++) {
        const physical = new Float64Array(capacity);
        for (let i = 0; i < sorted.length; i++) physical[(start + i) % capacity] = sorted[i]!;
        for (const x of probes) {
          expect(lowerBoundRing(physical, start, sorted.length, x)).toBe(lowerBound(sorted.length, (i) => sorted[i]!, x));
          expect(upperBoundRing(physical, start, sorted.length, x)).toBe(upperBound(sorted.length, (i) => sorted[i]!, x));
        }
      }
    }
  });

  it("returns 0 for an empty ring", () => {
    expect(lowerBoundRing(new Float64Array(4), 2, 0, 1)).toBe(0);
    expect(upperBoundRing(new Float64Array(4), 2, 0, 1)).toBe(0);
  });
});
