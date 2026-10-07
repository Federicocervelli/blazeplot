import { describe, it, expect } from "bun:test";
import { testStyle } from "../helpers.ts";
import { MinMaxTree } from "../../src/core/MinMaxTree.ts";
import type { MinMaxOut } from "../../src/core/MinMaxTree.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { UniformRingBuffer } from "../../src/core/UniformRingBuffer.ts";
import type { Dataset, Viewport } from "../../src/core/types.ts";

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function noisyValues(count: number, r: () => number, Storage: typeof Float32Array | typeof Float64Array): Float32Array | Float64Array {
  const values = new Storage(count);
  for (let i = 0; i < count; i++) {
    const roll = r();
    values[i] = roll < 0.01 ? NaN : roll < 0.015 ? Infinity : roll < 0.02 ? -Infinity : Math.sin(i * 0.01) * 50 + (r() - 0.5) * 20;
  }
  return values;
}

describe("MinMaxTree.bucketExtentsInto bucket cache", () => {
  it("stays equal to fresh queries while the data is rewritten, shifted, and re-queried at the same buckets", () => {
    const r = rng(23);
    for (const Storage of [Float32Array, Float64Array]) {
      const capacity = 20_000;
      const values = noisyValues(capacity, r, Storage);
      const tree = new MinMaxTree(values, capacity);
      const out: MinMaxOut = { minY: 0, maxY: 0 };
      const minOut = new Float64Array(600);
      const maxOut = new Float64Array(600);
      let shift = 0;
      let length = capacity;
      let cacheHits = 0;
      // The cache only exists after a tree has served many dense passes.
      for (let k = 0; k < 520; k++) tree.bucketExtentsInto(0, 25, 1, 0, capacity, 0, minOut, maxOut);
      for (let step = 0; step < 400; step++) {
        const roll = r();
        if (roll < 0.4) {
          // A write somewhere (single sample, short run, or the whole range), reported like the datasets do.
          const start = Math.floor(r() * (capacity - 1));
          const end = roll < 0.05 ? capacity : Math.min(capacity, start + 1 + Math.floor(r() * 300));
          for (let i = start; i < end; i++) values[i] = r() < 0.05 ? NaN : (r() - 0.5) * 100;
          tree.update(start, end);
        } else if (roll < 0.45) {
          shift = Math.floor(r() * capacity);
          length = 1 + Math.floor(r() * capacity);
        }
        const width = [16, 25, 64, 100, 128][step % 5]!;
        const first = Math.floor(r() * 5) * width - width * 3;
        const count = 1 + Math.floor(r() * 600);
        tree.bucketExtentsInto(first, width, count, 0, length, shift, minOut, maxOut);
        for (let b = 0; b < count; b++) {
          const s = Math.max(0, first + b * width);
          const e = Math.min(length, first + (b + 1) * width);
          const has = e > s && tree.queryRingInto((s + shift) % capacity, e - s, out);
          if (!has) {
            expect(minOut[b]!).toBe(Infinity);
            expect(maxOut[b]!).toBe(-Infinity);
          } else {
            expect(minOut[b]!).toBe(out.minY);
            expect(maxOut[b]!).toBe(out.maxY);
            cacheHits++;
          }
        }
      }
      expect(cacheHits).toBeGreaterThan(1000);
    }
  });
});

describe("MinMaxTree.bucketExtentsInto", () => {
  it("matches one queryRingInto per bucket for every width, offset, and ring shift", () => {
    const r = rng(7);
    for (const Storage of [Float32Array, Float64Array]) {
      const capacity = 5000;
      const values = noisyValues(capacity, r, Storage);
      const tree = new MinMaxTree(values, capacity);
      const out: MinMaxOut = { minY: 0, maxY: 0 };
      const minOut = new Float64Array(64);
      const maxOut = new Float64Array(64);
      for (let trial = 0; trial < 400; trial++) {
        const width = [1, 2, 7, 25, 64, 100, 128, 129, 300, 1000][Math.floor(r() * 10)]!;
        const length = 1 + Math.floor(r() * capacity);
        const shift = Math.floor(r() * capacity);
        const first = Math.floor(r() * length) - Math.floor(r() * width * 2);
        const count = 1 + Math.floor(r() * 64);
        tree.bucketExtentsInto(first, width, count, 0, length, shift, minOut, maxOut);
        for (let b = 0; b < count; b++) {
          const s = Math.max(0, first + b * width);
          const e = Math.min(length, first + (b + 1) * width);
          const has = e > s && tree.queryRingInto((s + shift) % capacity, e - s, out);
          if (!has) {
            expect(minOut[b]!).toBe(Infinity);
            expect(maxOut[b]!).toBe(-Infinity);
          } else {
            expect(minOut[b]!).toBe(out.minY);
            expect(maxOut[b]!).toBe(out.maxY);
          }
        }
      }
    }
  });
});

/** The per-bucket loop `copyMinMaxInstanced` used before bulk extents, driven through the dataset's public queries. */
function referenceBuckets(dataset: Dataset & { rangeMinMaxInto(s: number, e: number, o: MinMaxOut): boolean }, viewport: Viewport, maxSegments: number, xOrigin: number, yOrigin: number, uniformStep?: number): number[] {
  const start = dataset.lowerBoundX(viewport.xMin);
  const end = dataset.upperBoundX(viewport.xMax);
  if (end <= start) return [];
  const range = dataset.range!;
  const xSpan = viewport.xMax - viewport.xMin;
  const dataSpan = range.end - range.start;
  const estimated = dataset.length <= 1 || !(xSpan > 0) || !(dataSpan > 0) ? Math.max(1, dataset.length) : Math.max(1, (xSpan / dataSpan) * (dataset.length - 1) + 1);
  const width = uniformStep === undefined ? Math.max(1, Math.ceil(estimated / Math.max(1, maxSegments))) : Math.max(1, Math.ceil(Math.max(1, Math.ceil(xSpan / uniformStep) + 1) / maxSegments));
  const ordinalOffset = dataset.ordinalOffset ?? 0;
  const alignedStart = start - ((((start + ordinalOffset) % width) + width) % width);
  const out: number[] = [];
  const extent = { minY: 0, maxY: 0 };
  let written = 0;
  for (let bucketStart = alignedStart; bucketStart < end && written < maxSegments; bucketStart += width) {
    const bucketEnd = Math.min(dataset.length, bucketStart + width);
    const segmentStart = Math.max(0, bucketStart);
    if (bucketEnd <= start || segmentStart >= end) continue;
    if (!dataset.rangeMinMaxInto(segmentStart, bucketEnd, extent)) continue;
    const representative = Math.max(segmentStart, Math.min(bucketEnd - 1, bucketStart + (width >> 1)));
    out.push(Math.fround(dataset.getX(representative) - xOrigin), Math.fround(extent.minY - yOrigin), Math.fround(extent.maxY - yOrigin));
    written++;
  }
  return out;
}

describe("dense min/max extraction with bulk bucket extents", () => {
  function compare<D extends Dataset & { rangeMinMaxInto(s: number, e: number, o: MinMaxOut): boolean }>(dataset: D, r: () => number, trials: number): void {
    const series = new SeriesStore(dataset, { mode: "line", capacity: dataset.length, downsample: "minmax" }, testStyle({ color: [1, 1, 1, 1], lineWidth: 1 }));
    const range = dataset.range!;
    for (let trial = 0; trial < trials; trial++) {
      const a = range.start + r() * (range.end - range.start) * 0.9;
      const b = a + r() * (range.end - a);
      const viewport = { xMin: a, xMax: b, yMin: -100, yMax: 100 };
      const maxSegments = [3, 17, 100, 1000, 4096][Math.floor(r() * 5)]!;
      const xOrigin = r() < 0.5 ? 0 : a;
      const yOrigin = r() < 0.5 ? 0 : -30;
      const target = new Float32Array(maxSegments * 3);
      const written = series.copyMinMaxInstanced(viewport, target, maxSegments, xOrigin, yOrigin);
      const expected = referenceBuckets(dataset, viewport, maxSegments, xOrigin, yOrigin);
      expect(written * 3).toBe(expected.length);
      expect(Array.from(target.subarray(0, written * 3))).toEqual(expected);
    }
  }

  it("StaticDataset output is identical to the per-bucket loop", () => {
    const r = rng(11);
    const n = 60_000;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = i * 0.5 + (i % 7 === 0 ? 0.1 : 0);
    compare(new StaticDataset(x, noisyValues(n, r, Float32Array)), r, 60);
    compare(new StaticDataset(x, noisyValues(n, r, Float64Array)), r, 20);
  });

  it("RingBuffer output is identical to the per-bucket loop, before and after wrapping", () => {
    const r = rng(13);
    const capacity = 20_000;
    const ring = new RingBuffer(capacity);
    let next = 0;
    for (const total of [12_000, 35_000]) {
      const x = new Float64Array(total - next);
      for (let i = 0; i < x.length; i++) x[i] = (next + i) * 2;
      next = total;
      ring.append(x, noisyValues(x.length, r, Float32Array));
      compare(ring, r, 40);
    }
  });

  it("UniformRingBuffer output is identical to the per-bucket loop, before and after wrapping", () => {
    const r = rng(17);
    const capacity = 20_000;
    const ring = new UniformRingBuffer(capacity, { xStart: 3, xStep: 0.25 });
    let next = 0;
    for (const total of [9_000, 31_000, 45_000]) {
      ring.appendY(noisyValues(total - next, r, Float32Array));
      next = total;
      const series = new SeriesStore(ring, { mode: "line", capacity, downsample: "minmax" }, testStyle({ color: [1, 1, 1, 1], lineWidth: 1 }));
      const range = ring.range!;
      for (let trial = 0; trial < 30; trial++) {
        const a = range.start + r() * (range.end - range.start) * 0.9;
        const viewport = { xMin: a, xMax: a + r() * (range.end - a), yMin: -100, yMax: 100 };
        const maxSegments = [5, 64, 1000, 4096][Math.floor(r() * 4)]!;
        const target = new Float32Array(maxSegments * 3);
        const written = series.copyMinMaxInstanced(viewport, target, maxSegments, 0, 0);
        const expected = referenceBuckets(ring, viewport, maxSegments, 0, 0, 0.25);
        expect(Array.from(target.subarray(0, written * 3))).toEqual(expected);
      }
    }
  });
});
