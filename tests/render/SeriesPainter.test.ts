import { describe, expect, it } from "bun:test";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { AxisController } from "../../src/interaction/AxisController.ts";
import { Camera2D } from "../../src/interaction/Camera2D.ts";
import type { ChartRenderer } from "../../src/render/ChartRenderer.ts";
import { SeriesPainter } from "../../src/render/SeriesPainter.ts";
import type { PaintStats } from "../../src/render/SeriesPainter.ts";
import { testStyle } from "../helpers.ts";

interface Call {
  readonly method: string;
  readonly count: number;
  readonly data: number[];
  readonly projection?: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
}

/** Records draw calls; the painter only needs the semantic draw methods. */
function recordingRenderer(calls: Call[]): ChartRenderer {
  const record = (method: string) => (data: Float32Array, count: number, ...rest: unknown[]) => {
    const projection = rest.find((arg): arg is Call["projection"] => typeof arg === "object" && arg !== null && "scaleX" in arg);
    calls.push({ method, count, data: Array.from(data.subarray(0, count * 2)), projection });
  };
  return {
    kind: "webgl2",
    drawLines: record("drawLines"),
    drawClipLines: record("drawClipLines"),
    drawPoints: record("drawPoints"),
    drawTriangles: record("drawTriangles"),
    drawBarsInstanced: record("drawBarsInstanced"),
  } as unknown as ChartRenderer;
}

function setup(viewport = { xMin: 100, xMax: 110, yMin: 0, yMax: 10 }) {
  const camera = new Camera2D();
  camera.setViewport(viewport);
  const rightCamera = new Camera2D();
  rightCamera.setViewport(viewport);
  const axis = new AxisController(camera);
  const rightAxis = new AxisController(rightCamera);
  const stats: PaintStats = { pointsRendered: 0, renderMode: "none" };
  const calls: Call[] = [];
  const painter = new SeriesPainter(stats, 64);
  painter.beginFrame({
    renderer: recordingRenderer(calls),
    canvas: { width: 400, height: 200, clientWidth: 400, clientHeight: 200 },
    camera,
    rightCamera,
    axis,
    rightAxis,
  });
  return { painter, stats, calls, camera };
}

function lineSeries(mode: "line" | "scatter" | "bar", points: Array<[number, number]>): SeriesStore {
  const buffer = new RingBuffer(64);
  buffer.append(points.map((p) => p[0]), points.map((p) => p[1]));
  return new SeriesStore(buffer, { mode, capacity: 64, downsample: "none" }, testStyle());
}

describe("SeriesPainter", () => {
  it("draws grid lines in clip space and in a single draw call", () => {
    const { painter, calls } = setup();
    painter.drawGrid([100, 105, 110], [0, 5, 10], [1, 1, 1, 0.2]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("drawClipLines");
    expect(calls[0]!.count).toBe(12);
    // The first vertical line sits on the left clip edge, spanning the full height.
    expect(calls[0]!.data.slice(0, 4)).toEqual([-1, -1, -1, 1]);
  });

  it("skips the draw when there are no ticks", () => {
    const { painter, calls } = setup();
    painter.drawGrid([], [], [1, 1, 1, 1]);
    expect(calls).toHaveLength(0);
  });

  it("subtracts the camera origin before upload and projects with a linear scale", () => {
    const { painter, calls, stats } = setup();
    painter.drawSeries(lineSeries("line", [[100, 0], [105, 5], [110, 10]]));
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("drawLines");
    expect(call.count).toBe(3);
    // Values are relative to xMin/yMin (float64 origin shift), so 100 uploads as 0.
    expect(call.data.slice(0, 2)).toEqual([0, 0]);
    expect(call.projection!.scaleX).toBeCloseTo(0.2);
    expect(call.projection!.offsetX).toBeCloseTo(-1);
    expect(stats.renderMode).toBe("raw");
    expect(stats.pointsRendered).toBe(3);
  });

  it("reports mixed render mode when modes differ within a frame", () => {
    const { painter, stats, calls } = setup();
    painter.drawSeries(lineSeries("line", [[100, 0], [110, 10]]));
    painter.drawSeries(lineSeries("scatter", [[105, 5]]));
    expect(calls.map((call) => call.method)).toEqual(["drawLines", "drawPoints"]);
    expect(stats.renderMode).toBe("mixed");
  });

  it("draws exact bars as instances on linear axes", () => {
    const { painter, calls, stats } = setup();
    painter.drawSeries(lineSeries("bar", [[102, 3], [104, 6]]));
    expect(calls.map((call) => call.method)).toEqual(["drawBarsInstanced"]);
    expect(stats.renderMode).toBe("bars");
  });

  it("expands bars into CPU-transformed triangles on a log Y axis", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 10, yMin: 1, yMax: 1000 });
    const rightCamera = new Camera2D();
    const stats: PaintStats = { pointsRendered: 0, renderMode: "none" };
    const calls: Call[] = [];
    const painter = new SeriesPainter(stats, 64);
    painter.beginFrame({
      renderer: recordingRenderer(calls),
      canvas: { width: 400, height: 200, clientWidth: 400, clientHeight: 200 },
      camera,
      rightCamera,
      axis: new AxisController(camera, { y: { scale: "log" } }),
      rightAxis: new AxisController(rightCamera),
    });
    painter.drawSeries(lineSeries("bar", [[2, 10], [4, 100]]));
    expect(calls.map((call) => call.method)).toEqual(["drawTriangles"]);
    expect(calls[0]!.count).toBe(12);
    // Top of the first bar (value 10) is log10(10) = 1 in scale space.
    const ys = calls[0]!.data.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys.slice(0, 6))).toBeCloseTo(1);
  });
});
