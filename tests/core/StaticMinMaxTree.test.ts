import { describe, it, expect } from "bun:test";
import { MinMaxTree } from "../../src/core/MinMaxTree.ts";
import { StaticMinMaxTree } from "../../src/core/StaticMinMaxTree.ts";
import { query } from "./minMaxQuery.ts";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("StaticMinMaxTree.summarizeAll", () => {
  it("answers every range like the lazy tree, for float32 and float64 data with gaps and infinities", () => {
    const random = seeded(5);
    const specials = [NaN, Infinity, -Infinity];
    for (const Storage of [Float32Array, Float64Array]) {
      for (const length of [1, 63, 64, 65, 1000, 4099]) {
        const values = new Storage(length);
        for (let i = 0; i < length; i++) values[i] = random() < 0.15 ? specials[Math.floor(random() * specials.length)]! : (random() - 0.5) * 200;
        const lazy = new MinMaxTree(values, length);
        const eager = new StaticMinMaxTree(values, length);
        eager.summarizeAll();
        for (let n = 0; n < 200; n++) {
          const start = Math.floor(random() * length);
          const end = start + Math.floor(random() * (length - start + 1));
          expect(query(eager, start, end)).toEqual(query(lazy, start, end));
        }
        expect(query(eager, 0, length)).toEqual(query(lazy, 0, length));
      }
    }
  });

  it("keeps summaries that are already current and follows later updates", () => {
    const values = new Float32Array(300).map((_, i) => i);
    const tree = new StaticMinMaxTree(values, 300);
    expect(query(tree, 0, 100)).toEqual({ minY: 0, maxY: 99 });
    tree.summarizeAll();
    expect(query(tree, 0, 300)).toEqual({ minY: 0, maxY: 299 });
    values[10] = -5;
    tree.update(10, 11);
    expect(query(tree, 0, 300)).toEqual({ minY: -5, maxY: 299 });
  });
});
