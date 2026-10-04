import { describe, it, expect, spyOn } from "bun:test";
import { testStyle } from "../helpers.ts";
import { MinMaxTree } from "../../src/core/MinMaxTree.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { UniformRingBuffer } from "../../src/core/UniformRingBuffer.ts";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import type { Dataset, TimeRange } from "../../src/core/types.ts";

/** Seeded PRNG (mulberry32) so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i);

type MM = { minY: number; maxY: number } | null;

function bruteMinMax(values: ArrayLike<number>, from: number, to: number): MM {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = Math.max(0, from); i < Math.min(values.length, to); i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }
  return minY <= maxY ? { minY, maxY } : null;
}

/** Integer values (exact in float32) with occasional gaps. */
function randomY(r: () => number): number {
  const p = r();
  if (p < 0.04) return NaN;
  if (p < 0.06) return Infinity;
  if (p < 0.08) return -Infinity;
  return int(r, -1000, 1000);
}

interface Model {
  xs: number[];
  ys: number[];
}

/** Reference model of a wrapping/dropping ring. Returns whether the sample was stored. */
function modelPush(m: Model, cap: number, overflow: "wrap" | "drop-new", x: number, y: number): boolean {
  if (m.xs.length >= cap) {
    if (overflow === "drop-new") return false;
    m.xs.shift();
    m.ys.shift();
  }
  m.xs.push(x);
  m.ys.push(y);
  return true;
}

function lowerRef(xs: number[], x: number): number {
  let i = 0;
  while (i < xs.length && xs[i]! < x) i++;
  return i;
}
function upperRef(xs: number[], x: number): number {
  let i = 0;
  while (i < xs.length && xs[i]! <= x) i++;
  return i;
}

describe("MinMaxTree vs brute force", () => {
  for (const seed of SEEDS) {
    it(`random ranges, include/update, odd block sizes (seed ${seed})`, () => {
      const r = rng(seed);
      const capacity = int(r, 1, 700);
      const blockSize = [1, 2, 3, 7, 64][int(r, 0, 4)]!;
      const values = new Float64Array(capacity);
      const tree = new MinMaxTree(values, capacity, blockSize);
      let filled = 0;
      for (let step = 0; step < 60; step++) {
        const op = r();
        if (op < 0.4 && filled < capacity) {
          values[filled] = randomY(r);
          tree.include(filled, values[filled]!);
          filled++;
        } else if (filled > 0) {
          const a = int(r, 0, filled - 1);
          const b = Math.min(filled, a + int(r, 1, 100));
          for (let i = a; i < b; i++) values[i] = randomY(r);
          tree.update(a, b, filled);
        }
        for (let q = 0; q < 8; q++) {
          const from = int(r, -5, filled + 5);
          const to = int(r, from - 2, filled + 10);
          const expected = bruteMinMax(values.subarray(0, filled), from, to);
          // Unfilled slots are not summarized; callers only query the filled prefix.
          expect(tree.query(Math.max(0, from), Math.min(filled, to))).toEqual(expected);
        }
      }
    });
  }

  it("queryRing wraps and matches brute force", () => {
    const r = rng(7);
    const capacity = 100;
    const values = new Float64Array(capacity);
    for (let i = 0; i < capacity; i++) values[i] = randomY(r);
    const tree = new MinMaxTree(values, capacity, 8);
    tree.update(0, capacity);
    for (let q = 0; q < 300; q++) {
      const start = int(r, 0, capacity - 1);
      const count = int(r, 1, capacity);
      const idx: number[] = [];
      for (let i = 0; i < count; i++) idx.push(values[(start + i) % capacity]!);
      expect(tree.queryRing(start, count)).toEqual(bruteMinMax(idx, 0, idx.length));
    }
  });
});

describe("RingBuffer vs reference model", () => {
  for (const overflow of ["wrap", "drop-new"] as const) {
    for (const seed of SEEDS) {
      it(`${overflow} push/append/updateY/clear (seed ${seed})`, () => {
        const r = rng(seed);
        const cap = int(r, 1, 40);
        const buf = new RingBuffer(cap, { overflow, valuePrecision: "float64" });
        const model: Model = { xs: [], ys: [] };
        let x = int(r, -50, 50);

        for (let step = 0; step < 80; step++) {
          const op = r();
          if (op < 0.4) {
            x += int(r, 0, 3); // duplicates allowed, never decreasing
            const y = randomY(r);
            buf.push(x, y);
            modelPush(model, cap, overflow, x, y);
          } else if (op < 0.75) {
            const n = int(r, 0, cap * 3);
            const xs: number[] = [];
            const ys: number[] = [];
            for (let i = 0; i < n; i++) {
              x += int(r, 0, 3);
              xs.push(x);
              ys.push(randomY(r));
            }
            buf.append(xs, ys);
            for (let i = 0; i < n; i++) modelPush(model, cap, overflow, xs[i]!, ys[i]!);
          } else if (op < 0.92 && model.ys.length > 0) {
            const i = int(r, 0, model.ys.length - 1);
            const y = randomY(r);
            expect(buf.updateY(i, y)).toBe(true);
            model.ys[i] = y;
          } else if (op >= 0.97) {
            buf.clear();
            model.xs = [];
            model.ys = [];
          }

          expect(buf.length).toBe(model.xs.length);
          for (let i = 0; i < model.xs.length; i++) {
            expect(buf.getX(i)).toBe(model.xs[i]!);
            expect(buf.getY(i)).toBe(model.ys[i]!);
          }
          expect(buf.range).toEqual(
            model.xs.length ? { start: model.xs[0]!, end: model.xs[model.xs.length - 1]! } : null,
          );
          for (let q = 0; q < 6; q++) {
            const probe = x + int(r, -60, 10);
            expect(buf.lowerBoundX(probe)).toBe(lowerRef(model.xs, probe));
            expect(buf.upperBoundX(probe)).toBe(upperRef(model.xs, probe));
            const a = int(r, -2, model.ys.length + 2);
            const b = int(r, a - 1, model.ys.length + 3);
            expect(buf.rangeMinMaxY(a, b)).toEqual(bruteMinMax(model.ys, a, b));
          }
        }
      });
    }
  }

  it("error overflow throws atomically and leaves contents unchanged", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const cap = int(r, 1, 20);
      const buf = new RingBuffer(cap, { overflow: "error", valuePrecision: "float64" });
      const model: Model = { xs: [], ys: [] };
      let x = 0;
      for (let step = 0; step < 30; step++) {
        const n = int(r, 1, cap + 3);
        const xs = Array.from({ length: n }, () => (x += 1));
        const ys = xs.map(() => randomY(r));
        if (model.xs.length + n > cap) {
          expect(() => buf.append(xs, ys)).toThrow(RangeError);
        } else {
          buf.append(xs, ys);
          model.xs.push(...xs);
          model.ys.push(...ys);
        }
        expect(buf.length).toBe(model.xs.length);
        for (let i = 0; i < model.xs.length; i++) {
          expect(buf.getX(i)).toBe(model.xs[i]!);
          expect(buf.getY(i)).toBe(model.ys[i]!);
        }
        expect(buf.rangeMinMaxY(0, cap)).toEqual(bruteMinMax(model.ys, 0, cap));
      }
      if (model.xs.length === cap) expect(() => buf.push(x + 1, 0)).toThrow(RangeError);
    }
  });
});

describe("UniformRingBuffer vs reference model", () => {
  for (const seed of SEEDS) {
    it(`wraparound, X derivation, bounds, min/max (seed ${seed})`, () => {
      const r = rng(seed);
      const cap = int(r, 1, 40);
      const xStep = [1, 0.5, 2, 4][int(r, 0, 3)]!; // exactly representable steps
      const xStart = int(r, -10, 10);
      const buf = new UniformRingBuffer(cap, { xStart, xStep, valuePrecision: "float64" });
      let all: number[] = [];

      for (let step = 0; step < 60; step++) {
        const n = r() < 0.5 ? 1 : int(r, 0, cap * 3);
        const ys = Array.from({ length: n }, () => randomY(r));
        if (n === 1) buf.push(buf.length === 0 ? xStart : 0, ys[0]!); // x only seeds an empty buffer
        else buf.appendY(ys);
        all = all.concat(ys);
        const ret = all.slice(-cap);
        const firstOrdinal = all.length - ret.length;
        const xs = ret.map((_, i) => xStart + (firstOrdinal + i) * xStep);

        expect(buf.length).toBe(ret.length);
        for (let i = 0; i < ret.length; i++) {
          expect(buf.getY(i)).toBe(ret[i]!);
          expect(buf.getX(i)).toBe(xs[i]!);
        }
        for (let q = 0; q < 6; q++) {
          const probe = xStart + int(r, -4, all.length + 4) * xStep + (r() < 0.5 ? 0 : xStep / 4);
          expect(buf.lowerBoundX(probe)).toBe(lowerRef(xs, probe));
          expect(buf.upperBoundX(probe)).toBe(upperRef(xs, probe));
          const a = int(r, -2, ret.length + 2);
          const b = int(r, a - 1, ret.length + 3);
          expect(buf.rangeMinMaxY(a, b)).toEqual(bruteMinMax(ret, a, b));
        }
      }
    });
  }
});

describe("LOD min/max extraction preserves peaks", () => {
  /** Custom dataset without rangeMinMaxY so SeriesStore uses its MinMaxPyramid. */
  class PlainDataset implements Dataset {
    constructor(
      readonly xs: number[],
      readonly ys: number[],
    ) {}
    get length(): number {
      return this.xs.length;
    }
    get range(): TimeRange | null {
      return this.xs.length ? { start: this.xs[0]!, end: this.xs[this.xs.length - 1]! } : null;
    }
    getX(i: number): number {
      return this.xs[i]!;
    }
    getY(i: number): number {
      return this.ys[i]!;
    }
    isGap(i: number): boolean {
      return !Number.isFinite(this.ys[i]!);
    }
    lowerBoundX(x: number): number {
      return lowerRef(this.xs, x);
    }
    upperBoundX(x: number): number {
      return upperRef(this.xs, x);
    }
  }

  function check(series: SeriesStore, xs: number[], ys: number[], r: () => number, maxSegments: number): void {
    const lo = xs[0]!;
    const hi = xs[xs.length - 1]!;
    const finiteAll = ys.filter(Number.isFinite);
    for (let q = 0; q < 6; q++) {
      const a = lo + r() * (hi - lo);
      const b = a + r() * (hi - a);
      const viewport = { xMin: a, xMax: b, yMin: -2000, yMax: 2000 };
      const out = new Float32Array(maxSegments * 3);
      series.rebuildPyramid();
      const n = series.copyMinMaxInstanced(viewport, out, maxSegments);
      expect(n).toBeLessThanOrEqual(maxSegments);

      const visible: number[] = [];
      for (let i = 0; i < xs.length; i++) if (xs[i]! >= a && xs[i]! <= b) visible.push(ys[i]!);
      const expected = bruteMinMax(visible, 0, visible.length);
      if (!expected) continue;

      // Buckets are aligned to a stable grid, so they may extend past the viewport edges:
      // the visible extent must be covered, and no bucket may invent values that do not exist.
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        expect(out[i * 3 + 1]!).toBeLessThanOrEqual(out[i * 3 + 2]!);
        minY = Math.min(minY, out[i * 3 + 1]!);
        maxY = Math.max(maxY, out[i * 3 + 2]!);
      }
      expect(n).toBeGreaterThan(0);
      expect(minY).toBeLessThanOrEqual(expected.minY);
      expect(maxY).toBeGreaterThanOrEqual(expected.maxY);
      expect(minY).toBeGreaterThanOrEqual(Math.min(...finiteAll));
      expect(maxY).toBeLessThanOrEqual(Math.max(...finiteAll));
    }
  }

  for (const seed of SEEDS) {
    it(`StaticDataset, RingBuffer, UniformRingBuffer, custom dataset (seed ${seed})`, () => {
      const r = rng(seed);
      const n = int(r, 50, 3000);
      const xs: number[] = [];
      let x = 0;
      for (let i = 0; i < n; i++) xs.push((x += int(r, 1, 3)));
      // Spiky data with a few isolated extreme peaks that decimation must not lose.
      const ys = xs.map(() => int(r, -100, 100));
      for (let k = 0; k < 5; k++) ys[int(r, 0, n - 1)] = r() < 0.5 ? 900 : -900;
      for (let k = 0; k < n / 40; k++) ys[int(r, 0, n - 1)] = NaN;
      const maxSegments = int(r, 4, 120);
      const style = testStyle();

      const stat = new StaticDataset(Float64Array.from(xs), Float64Array.from(ys));
      check(new SeriesStore(stat, { mode: "line", capacity: n, downsample: "minmax" }, style), xs, ys, r, maxSegments);

      const ring = new RingBuffer(n, { valuePrecision: "float64" });
      ring.append(xs, ys);
      check(new SeriesStore(ring, { mode: "line", capacity: n, downsample: "minmax" }, style), xs, ys, r, maxSegments);

      const plain = new PlainDataset(xs, ys);
      check(new SeriesStore(plain, { mode: "line", dataset: plain, downsample: "minmax" }, style), xs, ys, r, maxSegments);

      const uni = new UniformRingBuffer(n, { valuePrecision: "float64" });
      uni.appendY(ys);
      const uxs = ys.map((_, i) => i);
      check(new SeriesStore(uni, { mode: "line", capacity: n, downsample: "minmax" }, style), uxs, ys, r, maxSegments);
    });
  }

  it("full wrapping ring still covers the global peak after streaming past capacity", () => {
    const r = rng(99);
    const cap = 500;
    const ring = new RingBuffer(cap, { valuePrecision: "float64" });
    const series = new SeriesStore(ring, { mode: "line", capacity: cap, downsample: "minmax" }, testStyle());
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 2000; i++) {
      xs.push(i);
      ys.push(int(r, -50, 50));
      ring.push(i, ys[i]!);
      if (i % 37 === 0) {
        series.markDirty();
        series.rebuildPyramid();
      }
    }
    ys[1900] = 777;
    ring.updateY(1900 - (2000 - cap), 777);
    series.markDirty();
    check(series, xs.slice(-cap), ys.slice(-cap), r, 25);
  });
});

describe("invalid input: documented current behavior", () => {
  it("non-finite Y values are gaps and excluded from min/max across datasets", () => {
    const ys = [NaN, 3, Infinity, -Infinity, -2, NaN];
    const xs = [0, 1, 2, 3, 4, 5];
    const ring = new RingBuffer(8, { valuePrecision: "float64" });
    ring.append(xs, ys);
    const stat = new StaticDataset(xs, ys);
    const uni = new UniformRingBuffer(8, { valuePrecision: "float64" });
    uni.appendY(ys);
    for (const ds of [ring, stat, uni]) {
      expect(ds.rangeMinMaxY(0, 6)).toEqual({ minY: -2, maxY: 3 });
      expect(ds.isGap(0)).toBe(true);
      expect(ds.isGap(2)).toBe(true);
      expect(ds.isGap(1)).toBe(false);
    }
  });

  it("all-gap and empty ranges yield null min/max", () => {
    const ring = new RingBuffer(4);
    expect(ring.rangeMinMaxY(0, 4)).toBeNull();
    ring.append([1, 2], [NaN, Infinity]);
    expect(ring.rangeMinMaxY(0, 2)).toBeNull();
    expect(new StaticDataset([], []).rangeMinMaxY(0, 1)).toBeNull();
    expect(new UniformRingBuffer(4).rangeMinMaxY(0, 4)).toBeNull();
  });

  it("empty datasets report null range and zero bounds", () => {
    for (const ds of [new RingBuffer(3), new UniformRingBuffer(3), new StaticDataset([], [])]) {
      expect(ds.length).toBe(0);
      expect(ds.range).toBeNull();
      expect(ds.lowerBoundX(5)).toBe(0);
      expect(ds.upperBoundX(5)).toBe(0);
      expect(() => ds.getX(0)).toThrow(RangeError);
      expect(() => ds.getY(0)).toThrow(RangeError);
    }
  });

  it("constructors reject bad capacity/xStep", () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => new RingBuffer(bad)).toThrow(RangeError);
      expect(() => new UniformRingBuffer(bad)).toThrow(RangeError);
    }
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => new UniformRingBuffer(4, { xStep: bad })).toThrow(RangeError);
    }
    expect(() => new MinMaxTree(new Float64Array(4), 4, 0)).toThrow(RangeError);
  });

  it("RingBuffer accepts unsorted X with a one-time warning and keeps the sample", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ring = new RingBuffer(8);
      ring.push(5, 1);
      ring.push(3, 2);
      ring.push(1, 3);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(ring.length).toBe(3);
      expect([ring.getX(0), ring.getX(1), ring.getX(2)]).toEqual([5, 3, 1]);
      // Bounds are binary searches over unsorted data: results are unspecified but stay in [0, length].
      for (const x of [0, 2, 4, 6]) {
        expect(ring.lowerBoundX(x)).toBeGreaterThanOrEqual(0);
        expect(ring.upperBoundX(x)).toBeLessThanOrEqual(3);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("RingBuffer skips NaN X with a one-time warning, so the order check keeps working", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ring = new RingBuffer(8);
      ring.push(1, 1);
      ring.push(NaN, 2);
      expect(ring.length).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      ring.push(0, 3); // genuinely out of order: still detected because NaN was never stored
      expect(warn).toHaveBeenCalledTimes(2);
      expect(ring.length).toBe(2);
      expect(ring.getX(0)).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("RingBuffer skips +/-Infinity X in bulk appends and keeps the finite samples", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ring = new RingBuffer(4);
      ring.append([-Infinity, 0, Infinity], [1, 2, 3]);
      expect(ring.length).toBe(1);
      expect(ring.getX(0)).toBe(0);
      expect(ring.getY(0)).toBe(2);
      expect(ring.lowerBoundX(0)).toBe(0);
      expect(ring.upperBoundX(0)).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("StaticDataset does not validate X order; fromObjects rejects non-finite X", () => {
    const stat = new StaticDataset([3, 1, 2], [1, 2, 3]);
    expect(stat.length).toBe(3);
    expect(stat.range).toEqual({ start: 3, end: 2 }); // first/last, not min/max
    expect(() => StaticDataset.fromObjects([{ x: NaN, y: 1 }], { x: "x", y: "y" })).toThrow(TypeError);
  });

  it("mismatched X/Y lengths use the shorter array", () => {
    expect(new StaticDataset([1, 2, 3], [1, 2]).length).toBe(2);
    const ring = new RingBuffer(8);
    ring.append([1, 2, 3], [1, 2]);
    expect(ring.length).toBe(2);
  });

  it("UniformRingBuffer ignores X passed to append after seeding", () => {
    const buf = new UniformRingBuffer(8, { xStep: 1 });
    buf.append([10, 11], [1, 2]);
    buf.append([999, 1000], [3, 4]);
    expect([0, 1, 2, 3].map((i) => buf.getX(i))).toEqual([10, 11, 12, 13]);
  });

  it("UniformRingBuffer keeps the previous cursor when seeded with a non-finite X", () => {
    const buf = new UniformRingBuffer(4, { xStart: 5 });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      buf.append([NaN], [1]);
      expect(buf.getX(0)).toBe(5);
      expect(buf.length).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("out-of-range or non-integer indices: updateY returns false, getters throw", () => {
    const ring = new RingBuffer(4);
    ring.push(1, 1);
    for (const bad of [-1, 1, 0.5, NaN]) {
      expect(ring.updateY(bad, 0)).toBe(false);
      expect(() => ring.getY(bad)).toThrow(RangeError);
    }
  });

  it("rangeMinMaxY clamps out-of-bounds, fractional and inverted ranges", () => {
    const stat = new StaticDataset([0, 1, 2, 3], [4, 1, 9, 2]);
    expect(stat.rangeMinMaxY(-10, 100)).toEqual({ minY: 1, maxY: 9 });
    expect(stat.rangeMinMaxY(0.5, 1.2)).toEqual({ minY: 1, maxY: 4 }); // floor start, ceil end
    expect(stat.rangeMinMaxY(3, 1)).toBeNull();
  });
});
