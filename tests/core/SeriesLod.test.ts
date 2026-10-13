import { describe, it, expect } from "bun:test";
import { SeriesLod } from "../../src/core/SeriesLod.ts";
import { MinMaxPyramid } from "../../src/core/MinMaxPyramid.ts";
import type { Dataset } from "../../src/core/types.ts";

/** Minimal wrapping ring without `rangeMinMaxY`, so the pyramid is the only min/max accelerator. */
class CustomRing implements Dataset {
  private xs: number[] = [];
  private ys: number[] = [];
  private dropped = 0;

  constructor(
    private readonly capacity: number,
    private readonly exposeOrdinal: boolean,
  ) {}

  get length(): number {
    return this.xs.length;
  }
  get range() {
    return this.xs.length ? { start: this.xs[0]!, end: this.xs[this.xs.length - 1]! } : null;
  }
  get ordinalOffset(): number | undefined {
    return this.exposeOrdinal ? this.dropped : undefined;
  }
  push(x: number, y: number): void {
    if (this.xs.length === this.capacity) {
      this.xs.shift();
      this.ys.shift();
      this.dropped++;
    }
    this.xs.push(x);
    this.ys.push(y);
  }
  getX(i: number): number {
    return this.xs[i]!;
  }
  getY(i: number): number {
    return this.ys[i]!;
  }
  lowerBoundX(x: number): number {
    let i = 0;
    while (i < this.xs.length && this.xs[i]! < x) i++;
    return i;
  }
  upperBoundX(x: number): number {
    let i = 0;
    while (i < this.xs.length && this.xs[i]! <= x) i++;
    return i;
  }
}

function naive(ds: Dataset, start: number, end: number): { minY: number; maxY: number } | null {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = Math.max(0, start); i < Math.min(ds.length, end); i++) {
    const y = ds.getY(i);
    if (!Number.isFinite(y)) continue;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return minY <= maxY ? { minY, maxY } : null;
}

/** Same selection the sampler makes: pyramid unless the LOD fell back to raw scans. */
function lodAnswer(lod: SeriesLod, ds: Dataset, start: number, end: number) {
  return lod.pyramid && !lod.useRawScan ? lod.pyramid.rangeMinMax(ds, start, end) : naive(ds, start, end);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("SeriesLod wrap handling", () => {
  it("sees new extremes after a wrap when the leading X values tie", () => {
    for (const exposeOrdinal of [false, true]) {
      const ds = new CustomRing(4, exposeOrdinal);
      for (let i = 0; i < 4; i++) ds.push(1, 0);
      const lod = new SeriesLod(ds, true, false);
      ds.push(1, 100);
      lod.markMutated(false, 1);
      lod.rebuild(ds);
      expect(lodAnswer(lod, ds, 0, ds.length)).toEqual({ minY: 0, maxY: 100 });
    }
  });

  it("stays correct when the append count is unknown", () => {
    const ds = new CustomRing(4, false);
    for (let i = 0; i < 4; i++) ds.push(1, 0);
    const lod = new SeriesLod(ds, true, false);
    ds.push(1, 100);
    lod.markMutated(false);
    lod.rebuild(ds);
    expect(lodAnswer(lod, ds, 0, ds.length)).toEqual({ minY: 0, maxY: 100 });
  });

  it("keeps the pyramid in use while a ring with ordinalOffset is full", () => {
    const ds = new CustomRing(64, true);
    for (let i = 0; i < 64; i++) ds.push(i, i);
    const lod = new SeriesLod(ds, true, false);
    for (let i = 64; i < 400; i++) {
      ds.push(i, i);
      lod.markMutated(false, 1);
      lod.rebuild(ds);
      expect(lod.useRawScan).toBe(false);
    }
    expect(lod.pyramid!.rangeMinMax(ds, 0, ds.length)).toEqual({ minY: 336, maxY: 399 });
  });

  it("falls back to raw scans for an untracked shift without ordinalOffset", () => {
    const ds = new CustomRing(8, false);
    for (let i = 0; i < 8; i++) ds.push(i, i);
    const lod = new SeriesLod(ds, true, false);
    ds.push(8, -5);
    lod.markMutated(false, 1);
    lod.rebuild(ds);
    expect(lod.useRawScan).toBe(true);
    expect(lodAnswer(lod, ds, 0, ds.length)).toEqual({ minY: -5, maxY: 7 });
  });
});

describe("SeriesLod differential fuzz", () => {
  for (const exposeOrdinal of [true, false]) {
    for (const knownCount of [true, false]) {
      it(`matches a naive scan while wrapping (ordinal=${exposeOrdinal}, counted=${knownCount})`, () => {
        const rand = mulberry32(0xb1a2e + (exposeOrdinal ? 1 : 0) + (knownCount ? 2 : 0));
        const capacity = 100;
        const ds = new CustomRing(capacity, exposeOrdinal);
        const lod = new SeriesLod(ds, true, false);
        let x = 0;
        let pyramidWhileFull = 0;

        for (let step = 0; step < 400; step++) {
          const batch = 1 + Math.floor(rand() * (rand() < 0.1 ? 150 : 7));
          for (let k = 0; k < batch; k++) {
            if (rand() < 0.3) x += 0; // ties in X
            else x += 1;
            const r = rand();
            const y = r < 0.12 ? NaN : r < 0.2 ? 1e9 + rand() : (rand() - 0.5) * 1000;
            ds.push(x, y);
          }
          lod.markMutated(false, knownCount ? batch : undefined);
          lod.rebuild(ds);
          if (ds.length === capacity && !lod.useRawScan) pyramidWhileFull++;

          for (let q = 0; q < 12; q++) {
            const a = Math.floor(rand() * (ds.length + 2)) - 1;
            const b = a + Math.floor(rand() * (ds.length + 2));
            expect(lodAnswer(lod, ds, a, b)).toEqual(naive(ds, a, b));
          }
          expect(lodAnswer(lod, ds, 0, ds.length)).toEqual(naive(ds, 0, ds.length));
        }
        // Only a ring that reports ordinalOffset keeps the pyramid across shifts.
        if (exposeOrdinal) expect(pyramidWhileFull).toBeGreaterThan(100);
      });
    }
  }
});

describe("MinMaxPyramid precision", () => {
  it("keeps exact min/max for large-magnitude Y values", () => {
    const ds = new CustomRing(64, false);
    for (let i = 0; i < 64; i++) ds.push(i, 1e10 + 0.5 + (i % 5) * 0.25);
    const pyramid = new MinMaxPyramid();
    pyramid.build(ds);
    expect(pyramid.rangeMinMax(ds, 0, 64)).toEqual({ minY: 1e10 + 0.5, maxY: 1e10 + 1.5 });
    expect(pyramid.rangeMinMax(ds, 0, 16)).toEqual(naive(ds, 0, 16));
  });
});
