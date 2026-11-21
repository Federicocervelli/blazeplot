import { describe, expect, it } from "bun:test";
import { Canvas2DRenderer } from "../../src/render/canvas2d/Canvas2DRenderer.ts";
import { toRenderSurface } from "../../src/render/ChartRenderer.ts";
import type { ChartRenderer } from "../../src/render/ChartRenderer.ts";
import { FakeContext2D, fakeCanvas2d } from "./fake2d.ts";

/** An engine double that records `fillTriangles`, with or without its own `fillField`. */
function engine(withField: boolean) {
  const triangles: Float32Array[] = [];
  const fields: unknown[][] = [];
  const base = {
    fillTriangles: (vertices: Float32Array, count: number) => void triangles.push(vertices.slice(0, count * 6)),
    ...(withField ? { fillField: (...args: unknown[]) => void fields.push(args) } : {}),
  };
  return { engine: base as unknown as ChartRenderer, triangles, fields };
}

describe("fillField", () => {
  it("falls back to per-vertex colored triangles, two per cell, leaving out cells with nothing to shade", () => {
    const { engine: e, triangles } = engine(false);
    // 3 x 2 vertices, so 2 x 1 cells: the right cell is all transparent.
    toRenderSurface(e).fillField(Float32Array.of(0.5, 0, 0, 1, 0, 0), 3, 2, 10, 20, 8, 1, 0.5, 0);
    expect(triangles).toHaveLength(1);
    const v = triangles[0]!;
    expect(v.length).toBe(6 * 6);
    // First vertex: the top-left grid vertex, in the color, at its opacity; the others at theirs.
    expect([...v.subarray(0, 6)]).toEqual([10, 20, 1, 0.5, 0, 0.5]);
    expect([v[6], v[7], v[11]]).toEqual([18, 20, 0]);
    expect([v[12], v[13], v[17]]).toEqual([10, 28, 1]);
    expect([v[24], v[25], v[29]]).toEqual([18, 28, 0]);
  });

  it("hands the grid to an engine that shades it itself", () => {
    const { engine: e, triangles, fields } = engine(true);
    const alpha = Float32Array.of(0.1, 0.2, 0.3, 0.4);
    toRenderSurface(e).fillField(alpha, 2, 2, 0, 0, 4, 0, 0, 1);
    expect(triangles).toHaveLength(0);
    expect(fields).toEqual([[alpha, 2, 2, 0, 0, 4, 0, 0, 1]]);
  });

  it("draws on Canvas 2D through one image a pixel per vertex, scaled up with smoothing, reused while its size holds", () => {
    const ctx = new FakeContext2D() as FakeContext2D & { imageSmoothingEnabled?: boolean };
    const created: { width: number; height: number; image: { data: Uint8ClampedArray }; puts: number }[] = [];
    const doc = {
      createElement: () => {
        const entry = { width: 0, height: 0, image: { data: new Uint8ClampedArray(0) }, puts: 0 };
        created.push(entry);
        const canvas = {
          get width() {
            return entry.width;
          },
          set width(v: number) {
            entry.width = v;
          },
          get height() {
            return entry.height;
          },
          set height(v: number) {
            entry.height = v;
          },
          getContext: () => ({
            createImageData: (w: number, h: number) => (entry.image = { data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: () => void entry.puts++,
          }),
        };
        return canvas;
      },
    };
    const canvas = Object.assign(fakeCanvas2d(ctx), { ownerDocument: doc });
    const renderer = new Canvas2DRenderer(canvas);
    renderer.beginFrame(100, 50, 1);
    renderer.fillField(Float32Array.of(0, 0.5, 1, 2), 2, 2, 10, 20, 8, 1, 0, 0.5);
    expect(created).toHaveLength(1);
    const field = created[0]!;
    expect([field.width, field.height, field.puts]).toEqual([2, 2, 1]);
    // Straight color in every pixel, opacity clamped to 1.
    expect([...field.image.data]).toEqual([255, 0, 128, 0, 255, 0, 128, 128, 255, 0, 128, 255, 255, 0, 128, 255]);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    const draw = ctx.calls.find((c) => c[0] === "drawImage")!;
    // Pixel centers on the vertices: the image starts half a step before the first one.
    expect(draw.slice(2)).toEqual([6, 16, 16, 16]);
    renderer.fillField(Float32Array.of(1, 1, 1, 1), 2, 2, 0, 0, 8, 0, 0, 0);
    expect(created).toHaveLength(1);
    expect(field.puts).toBe(2);
    // Nothing to draw: no cells, a bad step, too few opacities, a coordinate that is not finite.
    const before = ctx.calls.filter((c) => c[0] === "drawImage").length;
    renderer.fillField(new Float32Array(0), 0, 0, 0, 0, 8, 0, 0, 0);
    renderer.fillField(Float32Array.of(1), 1, 1, 0, 0, 0, 0, 0, 0);
    renderer.fillField(Float32Array.of(1), 2, 2, 0, 0, 8, 0, 0, 0);
    renderer.fillField(Float32Array.of(1), 1, 1, Number.NaN, 0, 8, 0, 0, 0);
    expect(ctx.calls.filter((c) => c[0] === "drawImage").length).toBe(before);
  });
});

describe("Canvas 2D strokeSegments", () => {
  it("strokes crossing translucent segments one by one, so they add up where they cross, and joins a polyline", () => {
    const ctx = new FakeContext2D();
    const renderer = new Canvas2DRenderer(fakeCanvas2d(ctx));
    renderer.beginFrame(100, 100, 1);
    const seg = (x0: number, y0: number, x1: number, y1: number, a: number) => [x0, y0, x1, y1, 1, 0, 0, 0, 1, 1, 1, a];
    const strokes = () => ctx.calls.filter((c) => c[0] === "stroke").length;
    // Two crossing translucent lines: two strokes.
    renderer.strokeSegments(Float32Array.from([...seg(0, 0, 100, 100, 0.5), ...seg(0, 100, 100, 0, 0.5)]), 2);
    expect(strokes()).toBe(2);
    // A translucent polyline (each segment starts where the last ended): one stroke, no overlap at the joints.
    renderer.strokeSegments(Float32Array.from([...seg(0, 0, 50, 50, 0.5), ...seg(50, 50, 100, 0, 0.5)]), 2);
    expect(strokes()).toBe(3);
    // Opaque lines share one stroke: painting a crossing twice looks the same.
    renderer.strokeSegments(Float32Array.from([...seg(0, 0, 100, 100, 1), ...seg(0, 100, 100, 0, 1)]), 2);
    expect(strokes()).toBe(4);
  });
});
