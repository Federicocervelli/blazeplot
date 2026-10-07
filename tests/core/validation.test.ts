import { describe, it, expect } from "bun:test";
import { firstInvalidX, isSortedFiniteX } from "../../src/core/validation.ts";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("isSortedFiniteX", () => {
  it("accepts empty, single, repeated, and ordered input", () => {
    expect(isSortedFiniteX([], 0)).toBe(true);
    expect(isSortedFiniteX([5], 1)).toBe(true);
    expect(isSortedFiniteX([1, 1, 1], 3)).toBe(true);
    expect(isSortedFiniteX(Float64Array.from([-Number.MAX_VALUE, 0, Number.MAX_VALUE]), 3)).toBe(true);
  });

  it("rejects a decrease, NaN, and infinities anywhere", () => {
    expect(isSortedFiniteX([1, 3, 2], 3)).toBe(false);
    for (const bad of [NaN, Infinity, -Infinity]) {
      for (let at = 0; at < 6; at++) {
        const x = [0, 1, 2, 3, 4, 5];
        x[at] = bad;
        expect(isSortedFiniteX(x, 6)).toBe(false);
      }
    }
  });

  it("honors count, ignoring samples past it", () => {
    expect(isSortedFiniteX([1, 2, 3, NaN, 0], 3)).toBe(true);
    expect(isSortedFiniteX([1, 2, 3, NaN, 0], 4)).toBe(false);
  });

  it("agrees with firstInvalidX on random ordered, decreasing, and non-finite input", () => {
    const random = seeded(11);
    const specials = [NaN, Infinity, -Infinity, -0, 0];
    for (let round = 0; round < 2000; round++) {
      const length = Math.floor(random() * 12);
      const x = new Float64Array(length);
      let value = (random() - 0.5) * 10;
      for (let i = 0; i < length; i++) {
        value += random() < 0.15 ? -random() * 3 : random() * 3;
        x[i] = value;
      }
      if (random() < 0.4 && length > 0) x[Math.floor(random() * length)] = specials[Math.floor(random() * specials.length)]!;
      expect(isSortedFiniteX(x, length)).toBe(firstInvalidX(x, length) >= length);
    }
  });
});
