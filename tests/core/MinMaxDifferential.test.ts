import { describe, it, expect } from "bun:test";
import { MinMaxTree } from "../../src/core/MinMaxTree.ts";
import type { MinMaxOut } from "../../src/core/MinMaxTree.ts";
import { query } from "./minMaxQuery.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { UniformRingBuffer } from "../../src/core/UniformRingBuffer.ts";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Value generator with gaps and infinities so the finite-only semantics are exercised. */
function sampleValue(random: () => number): number {
  const r = random();
  if (r < 0.05) return NaN;
  if (r < 0.07) return Infinity;
  if (r < 0.09) return -Infinity;
  return Math.round((random() - 0.5) * 2000) / 8;
}

function brute(read: (i: number) => number, start: number, end: number): { minY: number; maxY: number } | null {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = start; i < end; i++) {
    const value = read(i);
    if (!Number.isFinite(value)) continue;
    if (value < minY) minY = value;
    if (value > maxY) maxY = value;
  }
  return minY <= maxY ? { minY, maxY } : null;
}

describe("MinMaxTree lazy summaries (differential)", () => {
  it("matches a brute-force scan through random writes, includes, resets and queries", () => {
    for (const Storage of [Float32Array, Float64Array]) {
      const random = seeded(Storage === Float32Array ? 11 : 12);
      const capacity = 203;
      const values = new Storage(capacity);
      const tree = new MinMaxTree(values, capacity, 8);
      let length = 0;

      for (let step = 0; step < 4000; step++) {
        const op = random();
        if (op < 0.3 && length < capacity) {
          // Append into the unfilled region like RingBuffer.push.
          values[length] = sampleValue(random);
          tree.update(length, length + 1, length + 1);
          length++;
        } else if (op < 0.55) {
          // Overwrite a random run, as a wrapped ring or an in-place edit does.
          const start = Math.floor(random() * Math.max(1, length));
          const end = Math.min(length, start + 1 + Math.floor(random() * 40));
          for (let i = start; i < end; i++) values[i] = sampleValue(random);
          tree.update(start, end, length);
        } else if (op < 0.57) {
          values.fill(0);
          length = 0;
          tree.update(0, capacity, 0);
        } else {
          const a = Math.floor(random() * (length + 1));
          const b = Math.floor(random() * (length + 1));
          const start = Math.min(a, b);
          const end = Math.max(a, b);
          expect(query(tree, start, end)).toEqual(brute((i) => values[i]!, start, end));
        }
      }
    }
  });

  it("queryInto and queryRingInto match brute force and reuse one slot", () => {
    const random = seeded(3);
    const values = Float32Array.from({ length: 150 }, () => sampleValue(random));
    const tree = new MinMaxTree(values, values.length, 16);
    const out: MinMaxOut = { minY: 123, maxY: 456 };
    for (let i = 0; i < 500; i++) {
      const start = Math.floor(random() * 150);
      const count = Math.floor(random() * 150);
      const ring = brute((k) => values[(start + k) % 150]!, 0, count);
      expect(tree.queryRingInto(start, count, out)).toBe(ring !== null);
      if (ring) expect({ minY: out.minY, maxY: out.maxY }).toEqual(ring);
      const end = Math.min(150, start + count);
      const flat = brute((k) => values[k]!, start, end);
      expect(tree.queryInto(start, end, out)).toBe(flat !== null);
      if (flat) expect({ minY: out.minY, maxY: out.maxY }).toEqual(flat);
    }
  });

  it("does not read samples a query does not need", () => {
    const reads = { count: 0 };
    const values = new Proxy(Float64Array.from({ length: 4096 }, (_, i) => i), {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.count++;
        return Reflect.get(target, key);
      },
    });
    const tree = new MinMaxTree(values, 4096, 64);
    expect(query(tree, 0, 128)).toEqual({ minY: 0, maxY: 127 });
    // Only the two blocks under the query were summarized, not all 4096 samples.
    expect(reads.count).toBeLessThanOrEqual(256);
  });
});

describe("dataset range min/max against a brute-force scan", () => {
  function checkRandomQueries<T extends { length: number; getY(i: number): number; rangeMinMaxY(a: number, b: number): unknown; rangeMinMaxInto(a: number, b: number, o: MinMaxOut): boolean }>(
    dataset: T,
    random: () => number,
  ): void {
    const out: MinMaxOut = { minY: 0, maxY: 0 };
    for (let q = 0; q < 6; q++) {
      const a = Math.floor(random() * (dataset.length + 1));
      const b = Math.floor(random() * (dataset.length + 1));
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      const expected = brute((i) => dataset.getY(i), start, end);
      expect(dataset.rangeMinMaxY(start, end)).toEqual(expected);
      expect(dataset.rangeMinMaxInto(start, end, out)).toBe(expected !== null);
      if (expected) expect({ minY: out.minY, maxY: out.maxY }).toEqual(expected);
    }
  }

  it("RingBuffer stays exact through pushes, appends, wraps, updates and clears", () => {
    for (const precision of ["float32", "float64"] as const) {
      const random = seeded(21);
      const buffer = new RingBuffer(300, { valuePrecision: precision });
      let x = 0;
      for (let step = 0; step < 600; step++) {
        const op = random();
        if (op < 0.35) {
          buffer.push(x++, sampleValue(random));
        } else if (op < 0.6) {
          const n = 1 + Math.floor(random() * 200);
          buffer.append(Array.from({ length: n }, () => x++), Array.from({ length: n }, () => sampleValue(random)));
        } else if (op < 0.75 && buffer.length > 0) {
          buffer.updateY(Math.floor(random() * buffer.length), sampleValue(random));
        } else if (op < 0.77) {
          buffer.clear();
        }
        checkRandomQueries(buffer, random);
      }
    }
  });

  it("UniformRingBuffer stays exact through appends, wraps, updates and clears", () => {
    for (const precision of ["float32", "float64"] as const) {
      const random = seeded(22);
      const buffer = new UniformRingBuffer(250, { xStep: 1, valuePrecision: precision });
      for (let step = 0; step < 600; step++) {
        const op = random();
        if (op < 0.35) {
          buffer.appendY([sampleValue(random)]);
        } else if (op < 0.7) {
          const n = 1 + Math.floor(random() * 300);
          buffer.appendY(Array.from({ length: n }, () => sampleValue(random)));
        } else if (op < 0.8 && buffer.length > 0) {
          buffer.updateY(Math.floor(random() * buffer.length), sampleValue(random));
        } else if (op < 0.82) {
          buffer.clear();
        }
        checkRandomQueries(buffer, random);
      }
    }
  });

  it("StaticDataset stays exact through in-place edits (invalidate) and replace", () => {
    const random = seeded(23);
    const n = 1000;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    let y = Float32Array.from({ length: n }, () => sampleValue(random));
    const dataset = new StaticDataset(x, y);
    for (let step = 0; step < 300; step++) {
      const op = random();
      if (op < 0.3) {
        const at = Math.floor(random() * n);
        y[at] = sampleValue(random);
        dataset.invalidate();
      } else if (op < 0.45) {
        y = Float32Array.from({ length: n }, () => sampleValue(random));
        dataset.replace({ y });
      } else if (op < 0.5) {
        for (let i = 0; i < n; i++) y[i] = sampleValue(random);
        dataset.replace({ y });
      }
      checkRandomQueries(dataset, random);
    }
  });
});
