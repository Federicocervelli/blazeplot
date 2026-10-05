import { describe, expect, it } from "bun:test";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { testStyle } from "../helpers.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

function ramp(n: number, x0 = 0): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = x0 + i;
    y[i] = Math.sin(i / 50);
  }
  return { x, y };
}

describe("downsample: none draws every visible sample", () => {
  it("draws a line past the 16,384-vertex upload buffer", () => {
    const chart = h.make();
    const n = 40_000;
    const series = chart.addLine({ capacity: n, downsample: "none" });
    series.append(ramp(n));
    chart.setViewport({ xMin: 0, xMax: n - 1, yMin: -1, yMax: 1 });
    chart.start();
    h.raf.flush();
    const stats = chart.getFrameStats();
    expect(stats.renderMode).toBe("raw");
    // One vertex per sample plus at most one repeated seam vertex per chunk.
    expect(stats.pointsRendered).toBeGreaterThanOrEqual(n);
    expect(stats.pointsRendered).toBeLessThanOrEqual(n + 8);
    chart.dispose();
  });

  it("draws every instanced bar past 16,384", () => {
    const chart = h.make();
    const n = 40_000;
    const series = chart.addBar({ capacity: n, downsample: "none" });
    series.append(ramp(n));
    chart.setViewport({ xMin: 0, xMax: n - 1, yMin: -1, yMax: 1 });
    chart.start();
    h.raf.flush();
    expect(chart.getFrameStats().pointsRendered).toBe(n);
    chart.dispose();
  });

  it("draws every bar on the non-instanced path past 4,096", () => {
    const chart = h.make({ axes: { x: { scale: "log" } } });
    const n = 12_000;
    const series = chart.addBar({ capacity: n, downsample: "none" });
    series.append(ramp(n, 1));
    chart.setViewport({ xMin: 1, xMax: n, yMin: -1, yMax: 1 });
    chart.start();
    h.raf.flush();
    expect(chart.getFrameStats().pointsRendered).toBe(n * 6);
    chart.dispose();
  });
});

describe("SeriesStore.copyRawClippedChunk", () => {
  it("joins chunks without dropping vertices, including across NaN gaps", () => {
    const n = 500;
    const buffer = new RingBuffer(n);
    const { x, y } = ramp(n);
    for (let i = 20; i < n; i += 37) y[i] = NaN;
    buffer.append(x, y);
    const store = new SeriesStore(buffer, { mode: "line", capacity: n, downsample: "none" }, testStyle());
    const viewport = { xMin: 10, xMax: 480.5, yMin: -2, yMax: 2 };

    const whole = new Float32Array(2 * 4096);
    const wholeCount = store.copyRawClippedChunk(viewport, 0, whole, 4096).count;
    const expected: number[] = [];
    for (let i = 0; i < wholeCount; i++) expected.push(whole[i * 2]!, whole[i * 2 + 1]!);

    const joined: number[] = [];
    const chunk = new Float32Array(2 * 9);
    let chunks = 0;
    for (let start = 0, done = false; !done;) {
      const r = store.copyRawClippedChunk(viewport, start, chunk, 9);
      chunks++;
      for (let i = 0; i < r.count; i++) {
        const px = chunk[i * 2]!;
        const py = chunk[i * 2 + 1]!;
        const last = joined.length;
        const seam = i === 0 && last >= 2 && Object.is(joined[last - 2], px) && Object.is(joined[last - 1], py);
        // A chunk boundary on a gap drops the marker (separate draw calls already break the line).
        if (i === 0 && last >= 2 && !seam && !Number.isNaN(joined[last - 2]!)) joined.push(NaN, NaN);
        // Skip the shared seam vertex.
        if (!seam) joined.push(px, py);
      }
      start = r.next;
      done = r.done || r.count === 0;
    }

    expect(chunks).toBeGreaterThan(10);
    expect(joined).toEqual(expected);
  });
});
