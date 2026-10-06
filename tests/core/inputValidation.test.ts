import { describe, expect, it, spyOn } from "bun:test";
import { testStyle } from "../helpers.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { UniformRingBuffer } from "../../src/core/UniformRingBuffer.ts";
import { OhlcRingBuffer, StaticOhlcDataset } from "../../src/core/OhlcDataset.ts";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { ServerSampledDataset } from "../../src/core/ServerSampledDataset.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import type { BufferOverflowStrategy, InvalidOhlcSample, InvalidSample } from "../../src/core/types.ts";

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
const SEEDS = Array.from({ length: 40 }, (_, i) => 4200 + i);
const OVERFLOWS: readonly BufferOverflowStrategy[] = ["wrap", "drop-new", "error"];

/** Adversarial X: mostly ascending with duplicates, plus NaN, infinities, and backwards jumps. */
function nextX(r: () => number, cursor: { x: number }): number {
  const p = r();
  if (p < 0.05) return NaN;
  if (p < 0.08) return Infinity;
  if (p < 0.11) return -Infinity;
  if (p < 0.25) return cursor.x - int(r, 1, 20); // backwards
  if (p < 0.27) return undefined as unknown as number; // holes in plain arrays
  cursor.x += int(r, 0, 3);
  return cursor.x;
}

function randomY(r: () => number): number {
  const p = r();
  if (p < 0.05) return NaN;
  if (p < 0.07) return Infinity;
  return int(r, -1000, 1000);
}

interface XDataset {
  readonly length: number;
  getX(index: number): number;
  lowerBoundX(x: number): number;
  upperBoundX(x: number): number;
}

/** The invariant every dataset holds whatever the input: X finite and non-decreasing, searches consistent. */
function expectSortedFinite(ds: XDataset, r: () => number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < ds.length; i++) xs.push(ds.getX(i));
  for (let i = 0; i < xs.length; i++) {
    expect(Number.isFinite(xs[i]!)).toBe(true);
    if (i > 0) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
  }
  for (let q = 0; q < 4; q++) {
    const probe = xs.length ? xs[int(r, 0, xs.length - 1)]! + int(r, -2, 2) : int(r, -5, 5);
    let lower = 0;
    while (lower < xs.length && xs[lower]! < probe) lower++;
    let upper = lower;
    while (upper < xs.length && xs[upper]! <= probe) upper++;
    expect(ds.lowerBoundX(probe)).toBe(lower);
    expect(ds.upperBoundX(probe)).toBe(upper);
  }
  return xs;
}

/** Reference model with `push`-loop semantics: validate first, then apply overflow. */
class Model {
  xs: number[] = [];
  ys: number[] = [];
  rejected = 0;
  constructor(readonly cap: number, readonly overflow: BufferOverflowStrategy) {}

  floor(): number {
    return this.xs.length ? this.xs[this.xs.length - 1]! : -Number.MAX_VALUE;
  }

  valid(x: number, floor: number): boolean {
    return Number.isFinite(x) && x >= floor;
  }

  /** Returns false when a push would throw (error overflow, full). */
  push(x: number, y: number): boolean {
    if (!this.valid(x, this.floor())) {
      this.rejected++;
      return true;
    }
    if (this.xs.length >= this.cap) {
      if (this.overflow === "drop-new") return true;
      if (this.overflow === "error") return false;
      this.xs.shift();
      this.ys.shift();
    }
    this.xs.push(x);
    this.ys.push(y);
    return true;
  }

  /** Returns false when the append throws; error overflow is atomic for valid samples. */
  append(xs: number[], ys: number[]): boolean {
    if (this.overflow !== "error") {
      for (let i = 0; i < xs.length; i++) this.push(xs[i]!, ys[i]!);
      return true;
    }
    let floor = this.floor();
    const keptX: number[] = [];
    const keptY: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      if (!this.valid(xs[i]!, floor)) {
        this.rejected++;
        continue;
      }
      floor = xs[i]!;
      keptX.push(xs[i]!);
      keptY.push(ys[i]!);
    }
    if (this.xs.length + keptX.length > this.cap) return false;
    this.xs.push(...keptX);
    this.ys.push(...keptY);
    return true;
  }
}

function silenceWarnings<T>(run: () => T): T {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    return run();
  } finally {
    warn.mockRestore();
  }
}

describe("property: streaming datasets stay sorted and finite in X whatever the input", () => {
  for (const overflow of OVERFLOWS) {
    for (const seed of SEEDS) {
      it(`RingBuffer ${overflow} (seed ${seed})`, () => {
        const r = rng(seed);
        const cap = int(r, 1, 24);
        const reported: InvalidSample[] = [];
        const buf = new RingBuffer(cap, { overflow, valuePrecision: "float64", onInvalidSample: (s) => reported.push(s) });
        const model = new Model(cap, overflow);
        const cursor = { x: int(r, -50, 50) };

        for (let step = 0; step < 80; step++) {
          const op = r();
          if (op < 0.4) {
            const x = nextX(r, cursor);
            const y = randomY(r);
            if (model.push(x, y)) buf.push(x, y);
            else expect(() => buf.push(x, y)).toThrow(RangeError);
          } else if (op < 0.8) {
            const n = int(r, 0, cap * 3);
            const xs = Array.from({ length: n }, () => nextX(r, cursor));
            const ys = xs.map(() => randomY(r));
            const typed = r() < 0.5;
            const xIn = typed ? Float64Array.from(xs) : xs;
            if (model.append(xs, ys)) buf.append(xIn, ys);
            else expect(() => buf.append(xIn, ys)).toThrow(RangeError);
          } else if (op < 0.93 && model.xs.length > 0) {
            const i = int(r, 0, model.xs.length - 1);
            const x = r() < 0.5 ? nextX(r, { x: model.xs[i]! }) : model.xs[i]! + int(r, -2, 2);
            const y = randomY(r);
            const prev = i > 0 ? model.xs[i - 1]! : -Number.MAX_VALUE;
            const next = i < model.xs.length - 1 ? model.xs[i + 1]! : Number.MAX_VALUE;
            const ok = Number.isFinite(x) && x >= prev && x <= next;
            expect(buf.update(i, x, y)).toBe(ok);
            if (ok) {
              model.xs[i] = x;
              model.ys[i] = y;
            } else {
              model.rejected++;
            }
          } else if (op >= 0.97) {
            buf.clear();
            model.xs = [];
            model.ys = [];
          }

          const xs = expectSortedFinite(buf, r);
          expect(xs).toEqual(model.xs);
          for (let i = 0; i < model.ys.length; i++) expect(buf.getY(i)).toBe(model.ys[i]!);
          expect(buf.length).toBeLessThanOrEqual(cap);
          expect(buf.rejectedSamples).toBe(model.rejected);
          expect(reported).toHaveLength(model.rejected);
        }
      });

      it(`OhlcRingBuffer ${overflow} (seed ${seed})`, () => {
        const r = rng(seed);
        const cap = int(r, 1, 24);
        const reported: InvalidOhlcSample[] = [];
        const buf = new OhlcRingBuffer(cap, { overflow, valuePrecision: "float64", onInvalidSample: (s) => reported.push(s) });
        const model = new Model(cap, overflow);
        const cursor = { x: int(r, -50, 50) };

        for (let step = 0; step < 80; step++) {
          const op = r();
          if (op < 0.45) {
            const x = nextX(r, cursor);
            const close = randomY(r);
            if (model.push(x, close)) buf.push(x, close, close, close, close);
            else expect(() => buf.push(x, close, close, close, close)).toThrow(RangeError);
          } else if (op < 0.92) {
            const n = int(r, 0, cap * 3);
            const xs = Array.from({ length: n }, () => nextX(r, cursor));
            const cs = xs.map(() => randomY(r));
            if (model.append(xs, cs)) buf.append(xs, cs, cs, cs, cs);
            else expect(() => buf.append(xs, cs, cs, cs, cs)).toThrow(RangeError);
          } else if (op >= 0.97) {
            buf.clear();
            model.xs = [];
            model.ys = [];
          }

          const xs = expectSortedFinite(buf, r);
          expect(xs).toEqual(model.xs);
          for (let i = 0; i < model.ys.length; i++) expect(buf.getClose(i)).toBe(model.ys[i]!);
          expect(buf.rejectedSamples).toBe(model.rejected);
          expect(reported).toHaveLength(model.rejected);
        }
      });
    }
  }

  for (const seed of SEEDS) {
    it(`UniformRingBuffer derives sorted finite X from any seed (seed ${seed})`, () => {
      silenceWarnings(() => {
        const r = rng(seed);
        const cap = int(r, 1, 24);
        const buf = new UniformRingBuffer(cap, { xStart: int(r, -10, 10), xStep: [1, 0.5, 2][int(r, 0, 2)]! });
        const cursor = { x: 0 };
        for (let step = 0; step < 60; step++) {
          const op = r();
          if (op < 0.35) buf.push(nextX(r, cursor), randomY(r));
          else if (op < 0.7) {
            const n = int(r, 0, cap * 3);
            buf.append(Array.from({ length: n }, () => nextX(r, cursor)), Array.from({ length: n }, () => randomY(r)));
          } else if (op < 0.95) buf.appendY(Array.from({ length: int(r, 0, cap * 3) }, () => randomY(r)));
          else buf.clear();
          expectSortedFinite(buf, r);
          expect(buf.length).toBeLessThanOrEqual(cap);
        }
      });
    });
  }
});

describe("streaming invalid-sample reporting", () => {
  it("reports push, append, and update rejections with position, values, and reason", () => {
    const reported: InvalidSample[] = [];
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const buf = new RingBuffer(8, { onInvalidSample: (s) => reported.push(s) });
      buf.push(10, 1);
      buf.push(NaN, 2);
      buf.push(9, 3);
      buf.append([11, 5, 12, Infinity], [4, 5, 6, 7]);
      expect(buf.update(1, 20, 8)).toBe(false); // next X is 12
      expect(buf.update(1, 9, 8)).toBe(false); // previous X is 10
      expect(buf.update(1, 10, 8)).toBe(true); // duplicates allowed
      expect(reported).toEqual([
        { reason: "non-finite-x", operation: "push", index: 0, x: NaN, y: 2, neighborX: NaN },
        { reason: "decreasing-x", operation: "push", index: 0, x: 9, y: 3, neighborX: 10 },
        { reason: "decreasing-x", operation: "append", index: 1, x: 5, y: 5, neighborX: 11 },
        { reason: "non-finite-x", operation: "append", index: 3, x: Infinity, y: 7, neighborX: NaN },
        { reason: "decreasing-x", operation: "update", index: 1, x: 20, y: 8, neighborX: 12 },
        { reason: "decreasing-x", operation: "update", index: 1, x: 9, y: 8, neighborX: 10 },
      ]);
      expect(buf.rejectedSamples).toBe(6);
      expect([0, 1, 2].map((i) => buf.getX(i))).toEqual([10, 10, 12]);
      // A callback replaces the console warning.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns once per buffer without a callback, and rejectedSamples survives clear()", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const a = new RingBuffer(4);
      a.push(1, 0);
      a.append([0, NaN, -1], [0, 0, 0]);
      const b = new RingBuffer(4);
      b.push(NaN, 0);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0]![0])).toContain("RingBuffer skipped a sample with X 0 after 1 (decreasing-x)");
      expect(String(warn.mock.calls[1]![0])).toContain("non-finite X NaN (non-finite-x)");
      a.clear();
      expect(a.rejectedSamples).toBe(3);
      a.push(-100, 0); // any finite X is accepted after clear()
      expect(a.getX(0)).toBe(-100);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not allocate a filtered copy on the happy path and keeps typed-array input intact", () => {
    const buf = new RingBuffer(4);
    const x = new Float64Array([1, 2, 2, 3, 4, 5]);
    const y = new Float32Array([1, 2, 3, 4, 5, 6]);
    buf.append(x, y);
    expect(buf.rejectedSamples).toBe(0);
    expect([0, 1, 2, 3].map((i) => buf.getX(i))).toEqual([2, 3, 4, 5]);
  });

  it("OhlcRingBuffer reports full candles and treats non-finite prices as gaps", () => {
    const reported: InvalidOhlcSample[] = [];
    const buf = new OhlcRingBuffer(4, { onInvalidSample: (s) => reported.push(s) });
    buf.push(1, 10, 12, 9, 11);
    buf.push(0, 1, 2, 3, 4);
    buf.append([2, NaN], [10, 1], [NaN, 2], [9, 3], [11, 4]);
    expect(reported).toEqual([
      { reason: "decreasing-x", operation: "push", index: 0, x: 0, y: 4, neighborX: 1, open: 1, high: 2, low: 3, close: 4 },
      { reason: "non-finite-x", operation: "append", index: 1, x: NaN, y: 4, neighborX: NaN, open: 1, high: 2, low: 3, close: 4 },
    ]);
    expect(buf.rejectedSamples).toBe(2);
    expect(buf.length).toBe(2);
    expect(buf.isGap(0)).toBe(false);
    expect(buf.isGap(1)).toBe(true); // NaN high: stored, but a gap

    const series = new SeriesStore(buf, { mode: "candlestick", dataset: buf }, testStyle());
    expect(series.dataBounds()).toEqual({ xMin: 1, xMax: 1, yMin: 9, yMax: 12 });
    const target = new Float32Array(10);
    expect(series.copyOhlcTuplesRange(0, 2, target, 2)).toBe(2);
    expect(Array.from(target.subarray(0, 5))).toEqual([1, 10, 12, 9, 11]);
    expect(Array.from(target.subarray(5)).every(Number.isNaN)).toBe(true);
    expect(series.ohlcAt(1)).not.toBeNull();
    expect(series.sampleAt(1)).toBeNull();
  });

  it("UniformRingBuffer rejects a non-finite xStart", () => {
    expect(() => new UniformRingBuffer(4, { xStart: NaN })).toThrow(RangeError);
    expect(() => new UniformRingBuffer(4, { xStart: Infinity })).toThrow(RangeError);
  });
});

describe("static datasets validate X once at construction", () => {
  it("throws a RangeError naming the first decreasing or non-finite index", () => {
    expect(() => new StaticDataset([0, 2, 1, 0], [0, 0, 0, 0])).toThrow(
      "StaticDataset: X at index 2 is 1, below 2 at index 1 (decreasing-x). X values must be finite and non-decreasing.",
    );
    expect(() => new StaticDataset(new Float64Array([0, NaN, 2]), new Float32Array(3))).toThrow(
      "StaticDataset: X at index 1 is NaN (non-finite-x).",
    );
    expect(() => new StaticDataset([-Infinity], [0])).toThrow("X at index 0 is -Infinity (non-finite-x)");
    expect(() => new StaticDataset([0, 2, 1], [0, 0, 0])).toThrow("StaticDataset.sorted(x, y)");
    // Duplicate X is fine.
    expect(new StaticDataset([0, 1, 1], [0, 0, 0]).length).toBe(3);
  });

  it("assumeSorted skips the check at construction and on replace", () => {
    const ds = new StaticDataset([3, 1, NaN], [0, 0, 0], { assumeSorted: true });
    expect(ds.length).toBe(3);
    ds.replace({ x: [9, 8], y: [0, 0] });
    expect(ds.getX(0)).toBe(9);
  });

  it("replace validates new X and keeps the current data when it throws", () => {
    const ds = new StaticDataset([0, 1, 2], [5, 6, 7]);
    expect(() => ds.replace({ x: [0, 2, 1], y: [1, 1, 1] })).toThrow(RangeError);
    expect([ds.getX(2), ds.getY(2), ds.length]).toEqual([2, 7, 3]);
  });

  it("sorted() stably sorts by X, carries Y, and drops non-finite X", () => {
    const ds = StaticDataset.sorted([3, NaN, 1, 2, 1, Infinity, -Infinity, 2], [30, 99, 10, 20, 11, 98, 97, NaN]);
    expect(Array.from({ length: ds.length }, (_, i) => [ds.getX(i), ds.getY(i)])).toEqual([
      [1, 10],
      [1, 11],
      [2, 20],
      [2, NaN],
      [3, 30],
    ]);
    expect(ds.isGap(3)).toBe(true);
    const exact = StaticDataset.sorted(new Float64Array([2, 1]), new Float64Array([16_777_217, 1]), { valuePrecision: "float64" });
    expect(exact.getY(1)).toBe(16_777_217);
    expect(StaticDataset.sorted([], []).length).toBe(0);
  });

  it("sorted() output always satisfies the X rule (property)", () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const cursor = { x: 0 };
      const n = int(r, 0, 200);
      const xs = Array.from({ length: n }, () => (r() < 0.3 ? int(r, -100, 100) : nextX(r, cursor)));
      const ys = xs.map((_, i) => i);
      const ds = StaticDataset.sorted(xs, ys, { valuePrecision: "float64" });
      expectSortedFinite(ds, r);
      const finite = xs.map((x, i) => ({ x, i })).filter((p) => Number.isFinite(p.x));
      expect(ds.length).toBe(finite.length);
      finite.sort((a, b) => a.x - b.x || a.i - b.i);
      for (let i = 0; i < finite.length; i++) expect(ds.getY(i)).toBe(finite[i]!.i);
    }
  });

  it("fromObjects names the row and points at sort: true", () => {
    const rows = [{ t: 2, v: 1 }, { t: 1, v: 2 }];
    expect(() => StaticDataset.fromObjects(rows, { x: "t", y: "v" })).toThrow(
      "StaticDataset.fromObjects: X at row 1 is 1, below 2 at row 0 (decreasing-x). X values must be finite and non-decreasing. Pass { sort: true } to sort rows by X.",
    );
    expect(() => StaticDataset.fromObjects([{ t: "x", v: 1 }], { x: "t", y: "v" })).toThrow(
      "StaticDataset.fromObjects: X at row 0 is NaN (non-finite-x)",
    );
    const sorted = StaticDataset.fromObjects([{ t: 2, v: 1 }, { t: 1, v: 2 }, { t: 1, v: 3 }], { x: "t", y: "v", sort: true });
    expect([0, 1, 2].map((i) => sorted.getY(i))).toEqual([2, 3, 1]);
  });

  it("StaticOhlcDataset validates, honors assumeSorted, sorts, and marks non-finite prices as gaps", () => {
    expect(() => new StaticOhlcDataset([1, 0], [1, 1], [1, 1], [1, 1], [1, 1])).toThrow(
      "StaticOhlcDataset: X at index 1 is 0, below 1 at index 0 (decreasing-x)",
    );
    expect(new StaticOhlcDataset([1, 0], [1, 1], [1, 1], [1, 1], [1, 1], { assumeSorted: true }).length).toBe(2);
    const ds = StaticOhlcDataset.sorted([3, 1, NaN, 2], [30, 10, 0, 20], [31, 11, 0, 21], [29, 9, 0, NaN], [30.5, 10.5, 0, 20.5]);
    expect(ds.length).toBe(3);
    expect([0, 1, 2].map((i) => [ds.getX(i), ds.getOpen(i)])).toEqual([[1, 10], [2, 20], [3, 30]]);
    expect([0, 1, 2].map((i) => ds.isGap(i))).toEqual([false, true, false]);
  });

  it("ServerSampledDataset rejects unsorted points and malformed buckets and keeps its data", () => {
    const ds = new ServerSampledDataset({ kind: "points", x: [1, 2], y: [3, 4] });
    expect(() => ds.replace({ kind: "points", x: [2, 1], y: [0, 0] })).toThrow("ServerSampledDataset: X at index 1 is 1, below 2 at index 0 (decreasing-x)");
    expect(() => ds.replace({ kind: "points", x: [NaN], y: [0] })).toThrow(RangeError);
    expect(() => ds.replace({ kind: "minmax", xStart: [0, 10], xEnd: [10, 5], minY: [0, 0], maxY: [1, 1] })).toThrow(RangeError);
    expect(() => ds.replace({ kind: "minmax", xStart: [0, 10], xEnd: [5, 8], minY: [0, 0], maxY: [1, 1] })).toThrow(
      "ServerSampledDataset: bucket 1 ends at 8 before it starts at 10 (inverted-bucket)",
    );
    expect(() => ds.replace({ kind: "minmax", xStart: [5, 0], xEnd: [6, 7], minY: [0, 0], maxY: [1, 1] })).toThrow(
      "ServerSampledDataset xStart: X at bucket 1 is 0, below 5 at bucket 0 (decreasing-x)",
    );
    expect(ds.kind).toBe("points");
    expect([ds.length, ds.getX(1), ds.getY(1)]).toEqual([2, 2, 4]);
    // Overlapping buckets are allowed.
    ds.replace({ kind: "minmax", xStart: [0, 4], xEnd: [6, 10], minY: [0, 0], maxY: [1, 1] });
    expect(ds.length).toBe(2);
  });
});

describe("mismatched parallel array lengths throw instead of truncating", () => {
  it("RingBuffer.append names the owner and both lengths and stores nothing", () => {
    const buf = new RingBuffer(8);
    buf.push(0, 1);
    expect(() => buf.append([1, 2, 3], [1, 2])).toThrow("RingBuffer.append: x has 3 values but y has 2.");
    expect(() => buf.append([1, 2], [1, 2, 3])).toThrow(RangeError);
    expect([buf.length, buf.rejectedSamples]).toEqual([1, 0]);
  });

  it("UniformRingBuffer.append", () => {
    const buf = new UniformRingBuffer(8);
    expect(() => buf.append([0, 1, 2], [1, 2])).toThrow("UniformRingBuffer.append: x has 3 values but y has 2.");
    expect(buf.length).toBe(0);
  });

  it("StaticDataset constructor, sorted, and replace keep the current data", () => {
    expect(() => new StaticDataset([0, 1], [0])).toThrow("StaticDataset: x has 2 values but y has 1.");
    expect(() => StaticDataset.sorted([0, 1], [0])).toThrow("StaticDataset.sorted: x has 2 values but y has 1.");
    const ds = new StaticDataset([0, 1, 2], [5, 6, 7]);
    expect(() => ds.replace({ x: [0, 1], y: [1] })).toThrow("StaticDataset.replace: x has 2 values but y has 1.");
    expect(() => ds.replace({ y: [1] })).toThrow("StaticDataset.replace: x has 3 values but y has 1.");
    expect([ds.length, ds.getX(2), ds.getY(2)]).toEqual([3, 2, 7]);
  });

  it("OHLC datasets name the first array and the mismatched one", () => {
    expect(() => new StaticOhlcDataset([0, 1], [1, 1], [2, 2], [0, 0], [1])).toThrow("StaticOhlcDataset: x has 2 values but close has 1.");
    expect(() => StaticOhlcDataset.sorted([0, 1], [1, 1], [2], [0, 0], [1, 1])).toThrow("StaticOhlcDataset.sorted: x has 2 values but high has 1.");
    const buf = new OhlcRingBuffer(8);
    expect(() => buf.append([0, 1], [1, 1], [2, 2], [0, 0], [1])).toThrow("OhlcRingBuffer.append: x has 2 values but close has 1.");
    expect(buf.length).toBe(0);
  });

  it("ServerSampledDataset.replace keeps its data", () => {
    const ds = new ServerSampledDataset({ kind: "points", x: [1, 2], y: [3, 4] });
    expect(() => ds.replace({ kind: "points", x: [1, 2, 3], y: [3, 4] })).toThrow("ServerSampledDataset.replace: x has 3 values but y has 2.");
    expect(() => ds.replace({ kind: "minmax", xStart: [0, 1], xEnd: [1, 2], minY: [0], maxY: [1, 1] })).toThrow("xStart has 2 values but minY has 1.");
    expect([ds.kind, ds.length]).toEqual(["points", 2]);
  });
});
