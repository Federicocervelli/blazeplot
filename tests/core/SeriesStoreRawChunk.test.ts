import { describe, it, expect } from "bun:test";
import { testStyle } from "../helpers.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { UniformRingBuffer } from "../../src/core/UniformRingBuffer.ts";
import type { Dataset, Viewport } from "../../src/core/types.ts";

/** Hides the bulk `readXYRange` fast path so the store takes the generic getX/getY/isGap path. */
function generic(dataset: Dataset): Dataset {
  return {
    get length() {
      return dataset.length;
    },
    get range() {
      return dataset.range;
    },
    getX: (i) => dataset.getX(i),
    getY: (i) => dataset.getY(i),
    isGap: (i) => dataset.isGap?.(i) === true,
    lowerBoundX: (x) => dataset.lowerBoundX(x),
    upperBoundX: (x) => dataset.upperBoundX(x),
  };
}

function store(dataset: Dataset): SeriesStore {
  return new SeriesStore(dataset, { mode: "line", capacity: dataset.length, downsample: "none" }, testStyle({ color: [1, 1, 1, 1], lineWidth: 1 }));
}

function drain(series: SeriesStore, viewport: Viewport, maxPoints: number, xOrigin: number, yOrigin: number): number[][] {
  const chunks: number[][] = [];
  const target = new Float32Array(maxPoints * 2);
  let start = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    const chunk = series.copyRawClippedChunk(viewport, start, target, maxPoints, xOrigin, yOrigin);
    chunks.push(Array.from(target.subarray(0, chunk.count * 2)));
    if (chunk.done) break;
    start = chunk.next;
  }
  return chunks;
}

function yAt(i: number): number {
  if (i % 97 === 5 || i % 331 === 100 || i % 331 === 101) return i % 2 === 0 ? NaN : Infinity;
  return Math.sin(i * 0.05) * 3 + (i % 7 === 0 ? 0 : 0.25);
}

describe("SeriesStore raw line extraction fast path", () => {
  const viewports: Viewport[] = [
    { xMin: 0, xMax: 1e9, yMin: -10, yMax: 10 },
    { xMin: 120.5, xMax: 5000.25, yMin: -10, yMax: 10 },
    { xMin: -50, xMax: 30, yMin: -10, yMax: 10 },
    { xMin: 2500, xMax: 2500.5, yMin: -10, yMax: 10 },
  ];

  const builders: Record<string, () => Dataset> = {
    "wrapped RingBuffer with gaps": () => {
      const ring = new RingBuffer(6000);
      const n = 9000; // wraps: only the last 6000 samples remain, spanning more than one scratch block
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        x[i] = i * 1.5;
        y[i] = yAt(i);
      }
      ring.append(x, y);
      return ring;
    },
    "UniformRingBuffer with gaps": () => {
      const ring = new UniformRingBuffer(5000, { xStep: 0.7, xStart: 3 });
      const y = new Float64Array(7000);
      for (let i = 0; i < y.length; i++) y[i] = yAt(i);
      ring.appendY(y);
      return ring;
    },
    "StaticDataset with gaps and repeated points": () => {
      const n = 4500;
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        x[i] = Math.floor(i / 3) * 2; // repeated X values
        y[i] = i % 11 === 0 ? 1 : yAt(i);
      }
      return new StaticDataset(x, y);
    },
  };

  for (const [name, build] of Object.entries(builders)) {
    it(`matches the generic path: ${name}`, () => {
      const fast = store(build());
      const slow = store(generic(build()));
      for (const viewport of viewports) {
        for (const maxPoints of [2, 10, 257, 100_000]) {
          for (const [xOrigin, yOrigin] of [
            [0, 0],
            [100, 0.5],
          ] as const) {
            expect(drain(fast, viewport, maxPoints, xOrigin, yOrigin)).toEqual(drain(slow, viewport, maxPoints, xOrigin, yOrigin));
          }
        }
      }
    }, 30_000);
  }

  it("emits a NaN seam for gaps and keeps chunks joined", () => {
    const ring = new RingBuffer(8);
    ring.append([0, 1, 2, 3, 4], [0, 1, NaN, 3, 4]);
    const chunks = drain(store(ring), { xMin: 0, xMax: 4, yMin: -1, yMax: 5 }, 100, 0, 0);
    expect(chunks).toEqual([[0, 0, 1, 1, NaN, NaN, 3, 3, 4, 4]]);
  });
});
