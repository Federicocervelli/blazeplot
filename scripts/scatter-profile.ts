#!/usr/bin/env bun
import { SeriesStore } from "../src/core/SeriesStore.ts";
import { UniformRingBuffer } from "../src/core/UniformRingBuffer.ts";
import type { Viewport } from "../src/core/types.ts";

const SPARSE_INTERVAL = 512;
const POINTS = Number(process.env.POINTS ?? 1_953_127);
const MAX_POINTS = 16_384;
const WIDTH = 1228;
const HEIGHT = 611;
const POINT_SIZE = 5;

function fillDataset(): UniformRingBuffer {
  const dataset = new UniformRingBuffer(POINTS + 2, { xStep: SPARSE_INTERVAL });
  const batch = 65_536;
  let remaining = POINTS;
  let seed = 0x9e3779b9;
  while (remaining > 0) {
    const n = Math.min(batch, remaining);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed += 0x6d2b79f5;
      let value = seed;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      const random01 = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
      y[i] = -0.35 + random01 * 0.35;
    }
    dataset.appendY(y);
    remaining -= n;
  }
  return dataset;
}

function measure(name: string, fn: () => number, iterations = 40): void {
  const times: number[] = [];
  let count = 0;
  for (let i = 0; i < iterations + 5; i++) {
    const t0 = performance.now();
    count = fn();
    const dt = performance.now() - t0;
    if (i >= 5) times.push(dt);
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({
    name,
    count,
    min: times[0],
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    avg: sum / times.length,
  }));
}

const dataset = fillDataset();
const seriesNoLod = new SeriesStore(dataset, { mode: "scatter", capacity: POINTS + 2, downsample: "none" }, { color: [1, 0, 0, 1], lineWidth: 1, pointSize: POINT_SIZE });
const seriesLod = new SeriesStore(dataset, { mode: "scatter", capacity: POINTS + 2, downsample: "minmax" }, { color: [1, 0, 0, 1], lineWidth: 1, pointSize: POINT_SIZE });
const target = new Float32Array(MAX_POINTS * 2);
const viewportBase = { xMin: 0, xMax: (POINTS - 1) * SPARSE_INTERVAL };
const viewports: Record<string, Viewport> = {
  allY: { ...viewportBase, yMin: -0.36, yMax: 0.01 },
  halfY: { ...viewportBase, yMin: -0.18, yMax: 0.01 },
  narrowY: { ...viewportBase, yMin: -0.01, yMax: 0.01 },
  emptyY: { ...viewportBase, yMin: 0.9, yMax: 1.1 },
};

console.log(JSON.stringify({ points: POINTS, maxPoints: MAX_POINTS, width: WIDTH, height: HEIGHT }));
for (const [name, viewport] of Object.entries(viewports)) {
  measure(`noLOD-copyScatterVisible-${name}`, () => seriesNoLod.copyScatterVisible(viewport, target, MAX_POINTS, WIDTH, HEIGHT, POINT_SIZE));
  measure(`LOD-copyScatterVisible-${name}`, () => seriesLod.copyScatterVisible(viewport, target, MAX_POINTS, WIDTH, HEIGHT, POINT_SIZE));
}
