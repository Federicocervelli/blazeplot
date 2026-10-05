import { beforeAll, describe, expect, it } from "bun:test";
import { Canvas2DRenderer, Canvas2DUnavailableError } from "../../src/render/canvas2d/Canvas2DRenderer.ts";
import { testStyle } from "../helpers.ts";
import type { ChartRenderer, RenderProjection } from "../../src/render/ChartRenderer.ts";
import { FakeContext2D as FakeContext, FakePath, fakeCanvas2d } from "./fake2d.ts";

beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D = FakePath;
});

function setup(): { renderer: Canvas2DRenderer; ctx: FakeContext } {
  const ctx = new FakeContext();
  const canvas = fakeCanvas2d(ctx);
  const renderer = new Canvas2DRenderer(canvas);
  // 100 x 50 device pixels, DPR 1.
  renderer.beginFrame(100, 50, 1);
  ctx.calls.length = 0;
  return { renderer, ctx };
}

/** Maps data [0,10] x [0,5] onto the whole plot. */
const projection: RenderProjection = { scaleX: 0.2, scaleY: 0.4, offsetX: -1, offsetY: -1 };
function upload(_renderer: Canvas2DRenderer, values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("Canvas2DRenderer", () => {
  it("reports its kind and exposes no WebGL context", () => {
    const { renderer } = setup();
    expect(renderer.kind).toBe("canvas2d");
    expect((renderer as ChartRenderer).webglContext).toBeUndefined();
  });

  it("throws when the canvas has no 2D context", () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => new Canvas2DRenderer(canvas)).toThrow(Canvas2DUnavailableError);
  });

  it("clears the full frame", () => {
    const { renderer, ctx } = setup();
    renderer.beginFrame(120, 60, 2);
    expect(ctx.calls).toContainEqual(["clearRect", 0, 0, 120, 60]);
  });

  it("projects line strips to device pixels with y flipped and breaks at NaN", () => {
    const { renderer, ctx } = setup();
    const buffer = upload(renderer, [0, 0, 10, 5, NaN, NaN, 5, 0, 10, 0]);
    renderer.drawLines(buffer, 5, [1, 0, 0, 1], 2, projection);
    const moves = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    expect(moves).toEqual([
      ["moveTo", 0, 50],
      ["lineTo", 100, 0],
      ["moveTo", 50, 50],
      ["lineTo", 100, 50],
    ]);
    expect(ctx.calls.at(-1)).toEqual(["stroke", "rgba(255,0,0,1)", 2]);
  });

  it("scales CSS line width by the pixel ratio and keeps a 1px minimum", () => {
    const { renderer, ctx } = setup();
    renderer.beginFrame(100, 50, 2);
    ctx.calls.length = 0;
    const buffer = upload(renderer, [0, 0, 1, 1]);
    renderer.drawLines(buffer, 2, [1, 1, 1, 1], 1.5, projection);
    renderer.drawLines(buffer, 2, [1, 1, 1, 1], 0.2, projection);
    const strokes = ctx.calls.filter((c) => c[0] === "stroke");
    expect(strokes.map((c) => c[2])).toEqual([3, 1]);
  });

  it("draws independent segments and skips non-finite pairs", () => {
    const { renderer, ctx } = setup();
    const buffer = upload(renderer, [0, 0, 10, 0, NaN, 0, 5, 5, 0, 5, 10, 5]);
    renderer.drawLines(buffer, 6, [1, 1, 1, 1], 1, projection, "lines");
    expect(ctx.calls.filter((c) => c[0] === "moveTo")).toHaveLength(2);
  });

  it("snaps axis-aligned clip lines to pixel centers", () => {
    const { renderer, ctx } = setup();
    const buffer = upload(renderer, [0, -1, 0, 1, -1, 0, 1, 0]);
    renderer.drawClipLines(buffer, 4, [0.5, 0.5, 0.5, 1]);
    const lines = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    expect(lines).toEqual([
      ["moveTo", 50.5, 50],
      ["lineTo", 50.5, 0],
      ["moveTo", 0, 25.5],
      ["lineTo", 100, 25.5],
    ]);
  });

  it("draws round markers whose diameter is pointSize CSS pixels", () => {
    const { renderer, ctx } = setup();
    renderer.beginFrame(100, 50, 2);
    ctx.calls.length = 0;
    renderer.drawPoints(upload(renderer, [5, 2.5, NaN, 1]), 2, [0, 1, 0, 0.5], 4, projection);
    expect(ctx.calls.filter((c) => c[0] === "arc")).toEqual([["arc", 50, 25, 4, 0, Math.PI * 2]]);
  });

  it("draws bars from the baseline and enforces a 1px minimum width", () => {
    const { renderer, ctx } = setup();
    const style = testStyle({ barWidth: 1, baseline: 0, color: [0, 0, 1, 1] });
    renderer.drawBarsInstanced(upload(renderer, [5, 5, 8, 2.5]), 2, style, projection);
    expect(ctx.calls.filter((c) => c[0] === "fillRect")).toEqual([
      ["fillRect", "rgba(0,0,255,1)", 45, 0, 10, 50],
      ["fillRect", "rgba(0,0,255,1)", 75, 25, 10, 25],
    ]);

    ctx.calls.length = 0;
    renderer.drawBarsInstanced(upload(renderer, [5, 5]), 1, testStyle({ barWidth: 0.01 }), projection);
    expect(ctx.calls.filter((c) => c[0] === "fillRect")).toEqual([["fillRect", "rgba(255,255,255,1)", 50, 0, 1, 50]]);
  });

  it("fills rectangle triangle pairs as snapped rects and other triangles as paths", () => {
    const { renderer, ctx } = setup();
    // (x0,y0) (x1,y0) (x0,y1) (x0,y1) (x1,y0) (x1,y1) for [2, 4] x [1, 3], then a free triangle pair.
    const rect = [2, 1, 4, 1, 2, 3, 2, 3, 4, 1, 4, 3];
    const free = [0, 0, 5, 0, 0, 5, 5, 0, 5, 5, 2, 2];
    renderer.drawTriangles(upload(renderer, [...rect, ...free]), 12, [1, 0, 1, 1], projection);
    expect(ctx.calls.filter((c) => c[0] === "fillRect")).toEqual([["fillRect", "rgba(255,0,255,1)", 20, 20, 20, 20]]);
    const fill = ctx.calls.find((c) => c[0] === "fill");
    expect(fill?.[2]).toBe(8);
  });

  it("fills triangle strips as one ribbon polygon", () => {
    const { renderer, ctx } = setup();
    // Area fill: (x, y) / (x, baseline) pairs.
    renderer.drawTriangles(upload(renderer, [0, 5, 0, 0, 5, 5, 5, 0, 10, 2, 10, 0]), 6, [1, 1, 1, 0.25], projection, "triangle_strip");
    const path = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    expect(path).toEqual([
      ["moveTo", 0, 0],
      ["lineTo", 50, 0],
      ["lineTo", 100, 30],
      ["lineTo", 100, 50],
      ["lineTo", 50, 50],
      ["lineTo", 0, 50],
    ]);
    expect(ctx.calls.at(-1)).toEqual(["fill", "rgba(255,255,255,0.25)", -1]);
  });
});
