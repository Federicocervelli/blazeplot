import { describe, expect, it } from "bun:test";
import { OhlcRingBuffer } from "../../src/core/OhlcDataset.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { ServerSampledDataset } from "../../src/core/ServerSampledDataset.ts";
import type { Dataset, SeriesConfig, SeriesStyle, Viewport } from "../../src/core/types.ts";
import { AxisController } from "../../src/interaction/AxisController.ts";
import type { AxisControllerOptions } from "../../src/interaction/AxisController.ts";
import { Camera2D } from "../../src/interaction/Camera2D.ts";
import type { ChartRenderer } from "../../src/render/ChartRenderer.ts";
import { SeriesPainter } from "../../src/render/SeriesPainter.ts";
import type { PaintStats } from "../../src/render/SeriesPainter.ts";
import { testStyle } from "../helpers.ts";

/** What the painter handed the engine for one draw call. */
interface Call {
  readonly method: "drawLines" | "drawClipLines" | "drawPoints" | "drawTriangles" | "drawBarsInstanced";
  readonly count: number;
  /** The first `count` vertices as `[x, y]` pairs flattened. */
  readonly data: number[];
  readonly color?: readonly number[];
  readonly projection?: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
  readonly primitive?: string;
  readonly lineWidth?: number;
  readonly pointSize?: number;
}

function recorder(calls: Call[]): ChartRenderer {
  const base = (method: Call["method"], data: Float32Array, count: number, extra: Partial<Call>): void => {
    calls.push({ method, count, data: Array.from(data.subarray(0, count * 2)), ...extra });
  };
  const projectionOf = (value: unknown): Call["projection"] => (typeof value === "object" && value !== null && "scaleX" in value ? { ...(value as NonNullable<Call["projection"]>) } : undefined);
  return {
    kind: "webgl2",
    drawLines: (data: Float32Array, count: number, color: readonly number[], lineWidth: number, projection: unknown, primitive?: string) => base("drawLines", data, count, { color, lineWidth, projection: projectionOf(projection), primitive }),
    drawClipLines: (data: Float32Array, count: number, color: readonly number[]) => base("drawClipLines", data, count, { color }),
    drawPoints: (data: Float32Array, count: number, color: readonly number[], pointSize: number, projection: unknown) => base("drawPoints", data, count, { color, pointSize, projection: projectionOf(projection) }),
    drawTriangles: (data: Float32Array, count: number, color: readonly number[], projection: unknown, primitive?: string) => base("drawTriangles", data, count, { color, projection: projectionOf(projection), primitive }),
    drawBarsInstanced: (data: Float32Array, count: number, _style: SeriesStyle, projection: unknown) => base("drawBarsInstanced", data, count, { projection: projectionOf(projection) }),
  } as unknown as ChartRenderer;
}

interface SetupOptions {
  readonly viewport?: Viewport;
  readonly rightViewport?: Viewport;
  readonly x?: AxisControllerOptions["x"];
  readonly y?: AxisControllerOptions["y"];
  readonly y2?: AxisControllerOptions["y"];
  readonly xReversed?: boolean;
  readonly yReversed?: boolean;
  readonly canvas?: { width: number; height: number; clientWidth: number; clientHeight: number };
  readonly gridCapacity?: number;
}

function setup(options: SetupOptions = {}) {
  const viewport = options.viewport ?? { xMin: 0, xMax: 100, yMin: 0, yMax: 10 };
  const camera = new Camera2D();
  camera.setViewport(viewport);
  camera.setReversed({ x: options.xReversed === true, y: options.yReversed === true });
  const rightCamera = new Camera2D();
  rightCamera.setViewport(options.rightViewport ?? viewport);
  const axis = new AxisController(camera, { x: options.x, y: options.y });
  const rightAxis = new AxisController(rightCamera, { x: options.x, y: options.y2 });
  const stats: PaintStats = { pointsRendered: 0, renderMode: "none" };
  const calls: Call[] = [];
  const painter = new SeriesPainter(stats, options.gridCapacity ?? 64);
  painter.beginFrame({
    renderer: recorder(calls),
    canvas: options.canvas ?? { width: 400, height: 200, clientWidth: 400, clientHeight: 200 },
    camera,
    rightCamera,
    axis,
    rightAxis,
  });
  return { painter, stats, calls };
}

function store(config: Partial<SeriesConfig> & Pick<SeriesConfig, "mode">, dataset: Dataset, style: Partial<SeriesStyle> = {}): SeriesStore {
  return new SeriesStore(dataset, { capacity: 1, ...config } as SeriesConfig, testStyle(style));
}

function ring(xs: ArrayLike<number>, ys: ArrayLike<number>, capacity = xs.length): RingBuffer {
  const buffer = new RingBuffer(capacity);
  buffer.append(xs, ys);
  return buffer;
}

function sequence(count: number, fn: (i: number) => number): { xs: Float64Array; ys: Float64Array } {
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = i;
    ys[i] = fn(i);
  }
  return { xs, ys };
}

const pairs = (data: readonly number[]): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < data.length; i += 2) out.push([data[i]!, data[i + 1]!]);
  return out;
};

describe("SeriesPainter raw lines", () => {
  it("splits a long exact line into chunks that share their seam vertex", () => {
    const { xs, ys } = sequence(40_000, (i) => i % 10);
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 40_000, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "line", downsample: "none" }, ring(xs, ys)));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((call) => call.method === "drawLines" && call.count <= 16_384)).toBe(true);
    // Chunk N ends where chunk N + 1 begins, so the seam draws without a gap.
    for (let i = 1; i < calls.length; i++) {
      const previous = calls[i - 1]!.data;
      expect(calls[i]!.data.slice(0, 2)).toEqual(previous.slice(previous.length - 2));
    }
    expect(stats.renderMode).toBe("raw");
    expect(stats.pointsRendered).toBe(calls.reduce((sum, call) => sum + call.count, 0));
  });

  it("breaks the line at a non-finite Y instead of connecting across the gap", () => {
    const ys = [1, 2, NaN, 4, 5];
    const { painter, calls } = setup({ viewport: { xMin: 0, xMax: 4, yMin: 0, yMax: 6 } });
    painter.drawSeries(store({ mode: "line", downsample: "none" }, ring([0, 1, 2, 3, 4], ys)));
    // Either two separate draws or one draw whose vertex stream carries the break, but never one finite connected run.
    const vertices = calls.flatMap((call) => pairs(call.data));
    const connected = calls.length === 1 && vertices.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    expect(connected).toBe(false);
  });

  it("uploads values relative to the camera origin on linear axes and absolute scale on log axes", () => {
    const linear = setup({ viewport: { xMin: 1_000_000, xMax: 1_000_010, yMin: 500, yMax: 510 } });
    linear.painter.drawSeries(store({ mode: "line", downsample: "none" }, ring([1_000_000, 1_000_005, 1_000_010], [500, 505, 510])));
    expect(pairs(linear.calls[0]!.data)).toEqual([[0, 0], [5, 5], [10, 10]]);

    const log = setup({ viewport: { xMin: 0, xMax: 10, yMin: 1, yMax: 1000 }, y: { scale: "log" } });
    log.painter.drawSeries(store({ mode: "line", downsample: "none" }, ring([0, 5, 10], [1, 10, 1000])));
    const ys = pairs(log.calls[0]!.data).map(([, y]) => y);
    expect(ys[0]).toBeCloseTo(0);
    expect(ys[1]).toBeCloseTo(1);
    expect(ys[2]).toBeCloseTo(3);
  });

  it("projects the right axis series with the right camera", () => {
    const { painter, calls } = setup({ viewport: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, rightViewport: { xMin: 0, xMax: 10, yMin: 0, yMax: 100 } });
    painter.drawSeries(store({ mode: "line", downsample: "none", yAxis: "left" }, ring([0, 10], [0, 10])));
    painter.drawSeries(store({ mode: "line", downsample: "none", yAxis: "right" }, ring([0, 10], [0, 10])));
    expect(calls[0]!.projection!.scaleY).toBeCloseTo(0.2);
    expect(calls[1]!.projection!.scaleY).toBeCloseTo(0.02);
  });

  it("flips the projection sign for reversed axes", () => {
    const normal = setup();
    normal.painter.drawSeries(store({ mode: "line", downsample: "none" }, ring([0, 100], [0, 10])));
    const reversed = setup({ xReversed: true, yReversed: true });
    reversed.painter.drawSeries(store({ mode: "line", downsample: "none" }, ring([0, 100], [0, 10])));
    expect(reversed.calls[0]!.projection!.scaleX).toBeCloseTo(-normal.calls[0]!.projection!.scaleX);
    expect(reversed.calls[0]!.projection!.scaleY).toBeCloseTo(-normal.calls[0]!.projection!.scaleY);
    expect(reversed.calls[0]!.projection!.offsetX).toBeCloseTo(-normal.calls[0]!.projection!.offsetX);
  });

  it("draws nothing for an empty series or a viewport with no samples", () => {
    const { painter, calls, stats } = setup();
    painter.drawSeries(store({ mode: "line", downsample: "none" }, new RingBuffer(8)));
    painter.drawSeries(store({ mode: "line", downsample: "none" }, ring([500, 600], [1, 2])));
    expect(calls).toHaveLength(0);
    expect(stats.pointsRendered).toBe(0);
    expect(stats.renderMode).toBe("none");
  });
});

describe("SeriesPainter min/max columns", () => {
  it("draws dense lines as min/max columns at least one line width tall", () => {
    const { xs, ys } = sequence(100_000, (i) => (i % 2000 === 0 ? 8 : 5));
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 100_000, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "line" }, ring(xs, ys), { lineWidth: 2 }));
    expect(calls.every((call) => call.method === "drawTriangles" && call.primitive === "triangles")).toBe(true);
    expect(stats.renderMode).toBe("minmax");
    const call = calls[0]!;
    expect(call.count % 6).toBe(0);
    expect(call.count).toBeLessThanOrEqual(4_096 * 6);
    // 2 CSS px of a 200 px, 10 unit viewport is 0.1 units: even flat columns are that tall.
    const heights: number[] = [];
    for (let v = 0; v < call.count; v += 6) {
      const ysOfColumn = pairs(call.data.slice(v * 2, (v + 6) * 2)).map(([, y]) => y);
      heights.push(Math.max(...ysOfColumn) - Math.min(...ysOfColumn));
    }
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(0.1 - 1e-6);
    // Columns tile the viewport: the first starts at the viewport edge.
    expect(call.data[0]).toBeCloseTo(0, 1);
  });

  it("renders server min/max buckets directly, even when few", () => {
    const dataset = new ServerSampledDataset({ kind: "minmax", xStart: [0, 10, 20], xEnd: [10, 20, 30], minY: [1, 2, 3], maxY: [4, 6, 5] });
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 30, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "line", downsample: "server" }, dataset));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("drawTriangles");
    expect(calls[0]!.count).toBe(18);
    expect(stats.renderMode).toBe("minmax");
  });

  it("a single bucket spans the viewport width", () => {
    const dataset = new ServerSampledDataset({ kind: "minmax", xStart: [40], xEnd: [60], minY: [2], maxY: [8] });
    const { painter, calls } = setup({ viewport: { xMin: 0, xMax: 100, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "line", downsample: "server" }, dataset));
    const xsOfColumn = pairs(calls[0]!.data).map(([x]) => x);
    expect(Math.min(...xsOfColumn)).toBeCloseTo(0);
    expect(Math.max(...xsOfColumn)).toBeCloseTo(100);
  });
});

describe("SeriesPainter area", () => {
  it("draws a sparse area as a triangle strip fill plus an outline", () => {
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 4, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "area" }, ring([0, 1, 2, 3, 4], [2, 5, 3, 8, 4]), { baseline: 1 }));
    expect(calls.map((call) => call.method)).toEqual(["drawTriangles", "drawLines"]);
    expect(calls[0]!.primitive).toBe("triangle_strip");
    expect(calls[0]!.count).toBe(10);
    // The strip alternates the baseline with the value.
    const strip = pairs(calls[0]!.data);
    expect(strip.filter((_, i) => i % 2 === 0).every(([, y]) => y === strip[0]![1])).toBe(true);
    expect(calls[1]!.count).toBe(5);
    expect(stats.renderMode).toBe("area");
  });

  it("needs two visible samples", () => {
    const { painter, calls } = setup({ viewport: { xMin: 0, xMax: 4, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "area" }, ring([2], [5])));
    expect(calls).toHaveLength(0);
  });

  it("draws dense downsampled areas as filled min/max columns plus an envelope", () => {
    const { xs, ys } = sequence(60_000, (i) => 5 + 3 * Math.sin(i / 50));
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 60_000, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "area" }, ring(xs, ys), { baseline: 0 }));
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.method === "drawTriangles" && call.primitive === "triangles")).toBe(true);
    // One bucket per drawing-buffer column at most (400 px wide).
    expect(calls[0]!.count).toBeLessThanOrEqual(400 * 6);
    // The fill reaches the baseline (y = 0), the envelope does not.
    expect(Math.min(...pairs(calls[0]!.data).map(([, y]) => y))).toBeCloseTo(0);
    expect(Math.min(...pairs(calls[1]!.data).map(([, y]) => y))).toBeGreaterThan(1);
    expect(stats.renderMode).toBe("area");
  });

  it("decimates an exact area with downsample none when it has more samples than the strip buffer", () => {
    const { xs, ys } = sequence(30_000, (i) => i % 7);
    const { painter, calls } = setup({ viewport: { xMin: 0, xMax: 30_000, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "area", downsample: "none" }, ring(xs, ys)));
    expect(calls.map((call) => call.method)).toEqual(["drawTriangles", "drawLines"]);
    expect(calls[0]!.primitive).toBe("triangle_strip");
    expect(calls[0]!.count).toBeLessThanOrEqual(16_384);
  });

  it("chunks an exact area that fits the visible budget but not one strip upload", () => {
    const { xs, ys } = sequence(8_000, (i) => 1 + (i % 5));
    const { painter, calls } = setup({ viewport: { xMin: 0, xMax: 8_000, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "area" }, ring(xs, ys)));
    expect(calls.filter((call) => call.primitive === "triangle_strip").length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((call) => call.method === "drawLines").length).toBeGreaterThanOrEqual(1);
  });
});

describe("SeriesPainter bars", () => {
  it("draws sparse bars as instances, with the origin shifted off the positions", () => {
    const { painter, calls } = setup({ viewport: { xMin: 10, xMax: 20, yMin: 5, yMax: 15 } });
    painter.drawSeries(store({ mode: "bar", downsample: "none" }, ring([12, 15], [7, 9])));
    expect(calls.map((call) => call.method)).toEqual(["drawBarsInstanced"]);
    expect(pairs(calls[0]!.data)).toEqual([[2, 2], [5, 4]]);
  });

  it("expands bars into triangles on a log X axis, from the baseline to the value", () => {
    const { painter, calls } = setup({ viewport: { xMin: 1, xMax: 1000, yMin: 0, yMax: 10 }, x: { scale: "log" } });
    painter.drawSeries(store({ mode: "bar", downsample: "none" }, ring([10, 100], [4, 8]), { barWidth: 2, baseline: 1 }));
    expect(calls.map((call) => call.method)).toEqual(["drawTriangles"]);
    expect(calls[0]!.count).toBe(12);
    const first = pairs(calls[0]!.data).slice(0, 6);
    expect(Math.min(...first.map(([, y]) => y))).toBeCloseTo(1 - 0);
    expect(Math.max(...first.map(([, y]) => y))).toBeCloseTo(4);
  });

  it("draws dense downsampled bars as columns that include the baseline", () => {
    const { xs, ys } = sequence(40_000, (i) => 6 + 3 * Math.sin(i / 100));
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 40_000, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "bar" }, ring(xs, ys), { baseline: 0 }));
    expect(calls.every((call) => call.method === "drawTriangles")).toBe(true);
    expect(stats.renderMode).toBe("bars");
    // Every column spans from the baseline (0), never floating at the data value.
    const columns = pairs(calls[0]!.data);
    expect(Math.min(...columns.map(([, y]) => y))).toBeCloseTo(0);
  });
});

describe("SeriesPainter OHLC and candlesticks", () => {
  function candles(): OhlcRingBuffer {
    const buffer = new OhlcRingBuffer(16);
    // Rising (close >= open), falling, rising.
    buffer.append([10, 20, 30], [2, 6, 3], [5, 8, 6], [1, 4, 2], [4, 5, 5]);
    return buffer;
  }

  it("draws OHLC as one rising and one falling batch of wick and tick segments", () => {
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 40, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "ohlc" }, candles(), { upColor: [0, 1, 0, 1], downColor: [1, 0, 0, 1], tickWidth: 4 }));
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.method === "drawLines" && call.primitive === "lines")).toBe(true);
    // Six vertices per candle: wick (2), open tick (2), close tick (2).
    const rising = calls.find((call) => call.color?.[1] === 1)!;
    const falling = calls.find((call) => call.color?.[0] === 1)!;
    expect(rising.count).toBe(12);
    expect(falling.count).toBe(6);
    // The open tick of the first rising candle extends left of its X by half the tick width.
    expect(pairs(rising.data)[2]![0]).toBeCloseTo(10 - 2);
    expect(stats.renderMode).toBe("raw");
  });

  it("draws candlesticks as wicks plus rising and falling bodies", () => {
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 40, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "candlestick" }, candles(), { barWidth: 4, wickColor: [0, 0, 1, 1], upColor: [0, 1, 0, 1], downColor: [1, 0, 0, 1] }));
    expect(calls.map((call) => call.method)).toEqual(["drawLines", "drawTriangles", "drawTriangles"]);
    expect(calls[0]!.count).toBe(6);
    expect(calls[0]!.color).toEqual([0, 0, 1, 1]);
    // Two rising bodies (12 vertices each pair), one falling.
    expect(calls[1]!.count).toBe(12);
    expect(calls[2]!.count).toBe(6);
    const body = pairs(calls[2]!.data);
    expect(Math.min(...body.map(([x]) => x))).toBeCloseTo(20 - 2);
    expect(Math.max(...body.map(([x]) => x))).toBeCloseTo(20 + 2);
    expect(Math.min(...body.map(([, y]) => y))).toBeCloseTo(5);
    expect(Math.max(...body.map(([, y]) => y))).toBeCloseTo(6);
    expect(stats.renderMode).toBe("mixed");
  });

  it("draws no OHLC ticks when no candle is visible, and an empty candlestick series draws nothing", () => {
    const { painter, calls } = setup({ viewport: { xMin: 100, xMax: 200, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "ohlc" }, candles()));
    painter.drawSeries(store({ mode: "candlestick" }, new OhlcRingBuffer(4)));
    expect(calls).toHaveLength(0);
  });

  it("keeps the candle just outside the viewport so its body can reach in", () => {
    const { painter, calls } = setup({ viewport: { xMin: 31, xMax: 40, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "candlestick" }, candles(), { barWidth: 4 }));
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("SeriesPainter scatter", () => {
  it("draws exact points when downsampling is off", () => {
    const { xs, ys } = sequence(50, (i) => i % 10);
    const { painter, calls, stats } = setup({ viewport: { xMin: 0, xMax: 50, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "scatter", downsample: "none" }, ring(xs, ys), { pointSize: 6 }));
    expect(calls.map((call) => call.method)).toEqual(["drawPoints"]);
    expect(calls[0]!.count).toBe(50);
    expect(calls[0]!.pointSize).toBe(6);
    expect(stats.renderMode).toBe("points");
  });

  it("samples a dense scatter down to the point budget", () => {
    const { xs, ys } = sequence(200_000, (i) => (i * 7919) % 10);
    const { painter, calls } = setup({ viewport: { xMin: 0, xMax: 200_000, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "scatter" }, ring(xs, ys)));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === "drawPoints")).toBe(true);
    expect(calls.reduce((sum, call) => sum + call.count, 0)).toBeLessThan(200_000);
  });

  it("scales the culling padding by the device pixel ratio without crashing on a zero client width", () => {
    const { painter, calls } = setup({ canvas: { width: 800, height: 400, clientWidth: 0, clientHeight: 0 }, viewport: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 } });
    painter.drawSeries(store({ mode: "scatter", downsample: "none" }, ring([1, 2, 3], [1, 2, 3])));
    expect(calls[0]!.count).toBe(3);
  });
});

describe("SeriesPainter grid", () => {
  it("stops adding grid lines at the vertex capacity", () => {
    const { painter, calls } = setup({ gridCapacity: 6 });
    painter.drawGrid([0, 25, 50, 75, 100], [0, 5, 10], [1, 1, 1, 1]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.count).toBe(6);
  });

  it("places grid ticks through the axis scale", () => {
    const { painter, calls } = setup({ viewport: { xMin: 1, xMax: 1000, yMin: 0, yMax: 10 }, x: { scale: "log" } });
    painter.drawGrid([1, 10, 1000], [], [1, 1, 1, 1]);
    const clipXs = pairs(calls[0]!.data).filter((_, i) => i % 2 === 0).map(([x]) => x);
    expect(clipXs[0]).toBeCloseTo(-1);
    expect(clipXs[1]).toBeCloseTo(-1 + 2 / 3);
    expect(clipXs[2]).toBeCloseTo(1);
  });
});
