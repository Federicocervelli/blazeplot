import { describe, it, expect } from "bun:test";
import { MinMaxTree } from "../../src/core/MinMaxTree.ts";
import { query, queryRing } from "./minMaxQuery.ts";

function brute(values: ArrayLike<number>, start: number, end: number): { minY: number; maxY: number } | null {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = start; i < end; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) continue;
    minY = Math.min(minY, value);
    maxY = Math.max(maxY, value);
  }
  return minY <= maxY ? { minY, maxY } : null;
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("MinMaxTree", () => {
  it("matches a brute-force scan for every block alignment", () => {
    const random = seeded(7);
    const values = Float64Array.from({ length: 103 }, () => (random() - 0.5) * 1000);
    const tree = new MinMaxTree(values, values.length, 4);
    tree.update(0, values.length);

    for (let start = 0; start < values.length; start++) {
      for (let end = start; end <= values.length; end++) {
        expect(query(tree, start, end)).toEqual(brute(values, start, end));
      }
    }
  });

  it("ignores NaN and infinite values", () => {
    const values = [3, NaN, Infinity, -Infinity, -2, NaN];
    const tree = new MinMaxTree(values, values.length, 2);
    tree.update(0, values.length);

    expect(query(tree, 0, 6)).toEqual({ minY: -2, maxY: 3 });
    expect(query(tree, 1, 4)).toBeNull();
  });

  it("summarizes blocks that mix finite values with gaps and infinities exactly like a brute-force scan", () => {
    const random = seeded(23);
    const specials = [NaN, Infinity, -Infinity];
    for (const Storage of [Float32Array, Float64Array]) {
      const values = new Storage(96);
      for (let i = 0; i < values.length; i++) {
        values[i] = random() < 0.2 ? specials[Math.floor(random() * specials.length)]! : (random() - 0.5) * 100;
      }
      // A whole block of gaps and a whole block of infinities summarize to "no finite value".
      values.fill(NaN, 8, 12);
      values.fill(Infinity, 16, 20);
      const tree = new MinMaxTree(values, values.length, 4);
      tree.update(0, values.length);
      for (let start = 0; start < values.length; start += 3) {
        for (let end = start; end <= values.length; end += 5) {
          expect(query(tree, start, end)).toEqual(brute(values, start, end));
        }
      }
      expect(query(tree, 8, 12)).toBeNull();
      expect(query(tree, 16, 20)).toBeNull();
    }
  });

  it("tracks point updates, incremental includes, and reset", () => {
    const values = new Float32Array(16);
    const tree = new MinMaxTree(values, 16, 4);
    values.set([1, 2, 3, 4, 5, 6]);
    tree.update(0, 6, 6);
    expect(query(tree, 0, 16)).toEqual({ minY: 1, maxY: 6 });

    values[6] = -10;
    tree.update(6, 7, 7);
    expect(query(tree, 0, 7)).toEqual({ minY: -10, maxY: 6 });

    values[5] = 50;
    tree.update(5, 6, 7);
    expect(query(tree, 4, 8)).toEqual({ minY: -10, maxY: 50 });

    tree.update(0, 16, 0);
    expect(query(tree, 0, 16)).toBeNull();
  });

  it("only summarizes indexes below validEnd", () => {
    const values = new Float32Array([100, 100, 100, 100]);
    const tree = new MinMaxTree(values, 4, 4);
    values[0] = 1;
    tree.update(0, 1, 1);

    expect(query(tree, 0, 1)).toEqual({ minY: 1, maxY: 1 });
    // Stale physical samples past validEnd never leak into full-block summaries.
    expect(query(tree, 0, 4)).toEqual({ minY: 1, maxY: 1 });
  });

  it("queries ring ranges that wrap past capacity", () => {
    const values = Float64Array.from([5, 6, 7, 8, 1, 2, 3, 4]);
    const tree = new MinMaxTree(values, 8, 2);
    tree.update(0, 8);

    expect(queryRing(tree, 6, 4)).toEqual({ minY: 3, maxY: 6 });
    expect(queryRing(tree, 3, 0)).toBeNull();
  });
});
