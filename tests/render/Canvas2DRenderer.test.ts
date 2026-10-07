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

/**
 * The pixel-column reduction as it was written before the points were staged: it records each call while
 * scanning. The renderer must emit exactly these `moveTo`/`lineTo` calls.
 */
function referencePolyline(d: Float32Array, n: number, sx: number, ox: number, sy: number, oy: number, reduce: boolean): Array<readonly [string, number, number]> {
  const calls: Array<readonly [string, number, number]> = [];
  let pen = false;
  let i = 0;
  while (i < n) {
    const fx = d[i * 2]!;
    const fy = d[i * 2 + 1]!;
    i++;
    if (!Number.isFinite(fx + fy)) {
      pen = false;
      continue;
    }
    const firstX = fx * sx + ox;
    const firstY = fy * sy + oy;
    const key = Math.floor(firstX);
    let lastX = firstX;
    let lastY = firstY;
    let minY = firstY;
    let maxY = firstY;
    let minAt = 0;
    let maxAt = 0;
    let count = 1;
    for (; i < n; i++) {
      const dx = d[i * 2]!;
      const dy = d[i * 2 + 1]!;
      if (!Number.isFinite(dx + dy)) break;
      const x = dx * sx + ox;
      if (!reduce || Math.floor(x) !== key) break;
      const y = dy * sy + oy;
      lastX = x;
      lastY = y;
      if (y < minY) {
        minY = y;
        minAt = count;
      }
      if (y > maxY) {
        maxY = y;
        maxAt = count;
      }
      count++;
    }
    calls.push([pen ? "lineTo" : "moveTo", firstX, firstY]);
    pen = true;
    if (count === 1) continue;
    const lowFirst = minAt < maxAt;
    const firstAt = lowFirst ? minAt : maxAt;
    const secondAt = lowFirst ? maxAt : minAt;
    if (firstAt > 0 && firstAt < count - 1) calls.push(["lineTo", key + 0.5, lowFirst ? minY : maxY]);
    if (secondAt > 0 && secondAt < count - 1) calls.push(["lineTo", key + 0.5, lowFirst ? maxY : minY]);
    calls.push(["lineTo", lastX, lastY]);
  }
  return calls;
}

/** Device pixels covered by the whole-pixel `rect` calls in `calls`. */
function coverage(calls: readonly (readonly unknown[])[], width: number, height: number): Set<number> {
  const covered = new Set<number>();
  for (const c of calls) {
    if (c[0] !== "rect") continue;
    const [x, y, w, h] = c.slice(1) as number[];
    // The canvas clips what hangs over its edges.
    for (let px = Math.max(0, x!); px < Math.min(width, x! + w!); px++) for (let py = Math.max(0, y!); py < Math.min(height, y! + h!); py++) covered.add(px * 1000 + py);
  }
  return covered;
}

/** The two triangles of the rectangle `[x0, x1] x [y0, y1]`, in the order the painter writes them. */
function rectVertices(x0: number, x1: number, y0: number, y1: number): number[] {
  return [x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1];
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

  it("draws bars from the baseline in one path and enforces a 1px minimum width", () => {
    const { renderer, ctx } = setup();
    const style = testStyle({ barWidth: 1, baseline: 0, color: [0, 0, 1, 1] });
    renderer.drawBarsInstanced(upload(renderer, [5, 5, 8, 2.5]), 2, style, projection);
    expect(ctx.calls.filter((c) => c[0] === "rect" || c[0] === "fill" || c[0] === "fillRect")).toEqual([
      ["rect", 45, 0, 10, 50],
      ["rect", 75, 25, 10, 25],
      ["fill", "rgba(0,0,255,1)", -1],
    ]);

    ctx.calls.length = 0;
    renderer.drawBarsInstanced(upload(renderer, [5, 5]), 1, testStyle({ barWidth: 0.01 }), projection);
    expect(ctx.calls.filter((c) => c[0] === "rect")).toEqual([["rect", 50, 0, 1, 50]]);
  });

  it("fills rectangle triangle pairs as snapped rects and other triangles as paths", () => {
    const { renderer, ctx } = setup();
    // (x0,y0) (x1,y0) (x0,y1) (x0,y1) (x1,y0) (x1,y1) for [2, 4] x [1, 3], then a free triangle pair.
    const rect = [2, 1, 4, 1, 2, 3, 2, 3, 4, 1, 4, 3];
    const free = [0, 0, 5, 0, 0, 5, 5, 0, 5, 5, 2, 2];
    renderer.drawTriangles(upload(renderer, [...rect, ...free]), 12, [1, 0, 1, 1], projection);
    expect(ctx.calls.filter((c) => c[0] === "rect")).toEqual([["rect", 20, 20, 20, 20]]);
    const fills = ctx.calls.filter((c) => c[0] === "fill");
    expect(fills.map((c) => c[2])).toEqual([-1, 8]);
  });

  it("fills every rectangle of a dense batch with a single fill", () => {
    const { renderer, ctx } = setup();
    const verts: number[] = [];
    for (let i = 0; i < 50; i++) verts.push(i * 0.2, 0, i * 0.2 + 0.2, 0, i * 0.2, 5, i * 0.2, 5, i * 0.2 + 0.2, 0, i * 0.2 + 0.2, 5);
    renderer.drawTriangles(upload(renderer, verts), 300, [0, 0, 0, 1], projection);
    expect(ctx.calls.filter((c) => c[0] === "rect")).toHaveLength(50);
    expect(ctx.calls.filter((c) => c[0] === "fill")).toHaveLength(1);
  });

  it("keeps only the first, extreme, and last vertices of each pixel column", () => {
    const { renderer, ctx } = setup();
    // 100 px wide for x in [0, 10]: x 1.0 .. 1.09 share pixel column 10. Data y 1, 4, 2, 3, 0.5 sit at device y
    // 40, 10, 30, 20, 45 (flipped), so only the second vertex is an interior extreme; it is placed on the column center (10.5).
    const buffer = upload(renderer, [0, 2.5, 1.0, 1, 1.02, 4, 1.04, 2, 1.06, 3, 1.09, 0.5, 5, 2.5]);
    renderer.drawLines(buffer, 7, [1, 0, 0, 1], 1, projection);
    const path = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    expect(path.map((c) => [c[0], Math.round((c[1] as number) * 100) / 100, Math.round((c[2] as number) * 100) / 100])).toEqual([
      ["moveTo", 0, 25],
      ["lineTo", 10, 40],
      ["lineTo", 10.5, 10],
      ["lineTo", 10.9, 45],
      ["lineTo", 50, 25],
    ]);
  });

  it("never merges vertices across a non-finite gap or into a different pixel column", () => {
    const { renderer, ctx } = setup();
    // One vertex in column 10, a NaN, then vertices in columns 10 and 11.
    const buffer = upload(renderer, [1.0, 1, NaN, NaN, 1.05, 2, 1.1, 3]);
    renderer.drawLines(buffer, 4, [1, 0, 0, 1], 1, projection);
    const path = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    expect(path.map((c) => c[0])).toEqual(["moveTo", "moveTo", "lineTo"]);
  });


  it("merges snapped rectangles of one pixel column that touch or overlap, and keeps separated ones apart", () => {
    const { renderer, ctx } = setup();
    // Data x 1.0 .. 1.08 is pixel column 10 (10 px per data unit); y 1..2, 1.5..3, 3..4 chain together, 4.5..5 is separate.
    const verts = [...rectVertices(1.0, 1.04, 1, 2), ...rectVertices(1.04, 1.08, 1.5, 3), ...rectVertices(1.0, 1.04, 3, 4), ...rectVertices(1.0, 1.04, 4.5, 5)];
    renderer.drawTriangles(upload(renderer, verts), 24, [0, 0, 0, 1], projection);
    // y 1..4 is device y 40..10 (flipped); y 4.5..5 is device y 5..0.
    expect(ctx.calls.filter((c) => c[0] === "rect")).toEqual([
      ["rect", 10, 10, 1, 30],
      ["rect", 10, 0, 1, 5],
    ]);
  });

  it("fills exactly the pixels the unmerged rectangles would, for dense and ragged bucket batches", () => {
    let seed = 12345;
    const random = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let trial = 0; trial < 60; trial++) {
      const { renderer, ctx } = setup();
      const verts: number[] = [];
      const expected = new Set<number>();
      const count = 1 + Math.floor(random() * 120);
      const bucketWidth = random() < 0.5 ? 0.025 : 0.15 + random() * 0.4;
      let x = random() * 3;
      for (let i = 0; i < count; i++) {
        const y0 = random() * 5;
        const y1 = y0 + 0.05 + random() * (random() < 0.5 ? 0.3 : 3);
        verts.push(...rectVertices(x, x + bucketWidth, y0, y1));
        // The reference: each rectangle snapped on its own, as before merging existed.
        const left = Math.round(x * 10);
        const right = Math.max(Math.round((x + bucketWidth) * 10), left + 1);
        const top = Math.round(50 - y1 * 10);
        const bottom = Math.max(Math.round(50 - y0 * 10), top + 1);
        for (let px = Math.max(0, left); px < Math.min(100, right); px++) for (let py = Math.max(0, top); py < Math.min(50, bottom); py++) expected.add(px * 1000 + py);
        x += random() < 0.7 ? bucketWidth * random() : bucketWidth * (1 + random());
      }
      renderer.drawTriangles(upload(renderer, verts), count * 6, [0, 0, 0, 1], projection);
      const got = coverage(ctx.calls, 100, 50);
      expect(got.size).toBe(expected.size);
      for (const key of expected) expect(got.has(key)).toBe(true);
      expect(ctx.calls.filter((c) => c[0] === "fill")).toHaveLength(1);
    }
  });

  it("traces the same path as the pixel-column reduction it replaced, across gaps and wide strokes", () => {
    let seed = 987654;
    const random = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let trial = 0; trial < 80; trial++) {
      const { renderer, ctx } = setup();
      const n = 1 + Math.floor(random() * 400);
      const values: number[] = [];
      let x = random() * 2;
      for (let i = 0; i < n; i++) {
        x += random() * (trial % 3 === 0 ? 0.5 : 0.04);
        const gap = random() < 0.05;
        values.push(gap ? NaN : x, gap && random() < 0.5 ? 1 : random() * 5);
      }
      const lineWidth = trial % 4 === 0 ? 3 : 1;
      const data = upload(renderer, values);
      renderer.drawLines(data, n, [1, 0, 0, 1], lineWidth, projection);
      const got = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
      expect(got).toEqual(referencePolyline(data, n, 10, 0, -10, 50, lineWidth <= 1.5));
    }
  });

  it("traces a window with a large offset identically", () => {
    const { renderer, ctx } = setup();
    const values: number[] = [];
    for (let i = 0; i < 200; i++) values.push(5 + i * 0.004, 2.5 + Math.sin(i) * 2);
    const data = upload(renderer, values);
    renderer.drawLines(data, 200, [0, 1, 0, 1], 1, { scaleX: 0.2, scaleY: 0.4, offsetX: -1.00003, offsetY: -1 });
    const got = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    expect(got).toEqual(referencePolyline(data, 200, 0.2 * 100 * 0.5, (-1.00003 + 1) * 100 * 0.5, -0.4 * 50 * 0.5, (1 + 1) * 50 * 0.5, true));
  });

  it("skips tracing when the projection is not finite", () => {
    const { renderer, ctx } = setup();
    renderer.drawLines(upload(renderer, [0, 0, 1, 1, 2, 2]), 3, [1, 0, 0, 1], 1, { scaleX: NaN, scaleY: 1, offsetX: 0, offsetY: 0 });
    expect(ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo")).toEqual([]);
  });

  it("sets context style state only when it changes, and again after each beginFrame", () => {
    const { renderer, ctx } = setup();
    const writes: Record<string, number> = { fillStyle: 0, strokeStyle: 0, lineWidth: 0, lineJoin: 0 };
    for (const key of Object.keys(writes)) {
      let current = (ctx as unknown as Record<string, unknown>)[key];
      Object.defineProperty(ctx, key, {
        get: () => current,
        set: (value) => {
          writes[key]!++;
          current = value;
        },
      });
    }
    const red: [number, number, number, number] = [1, 0, 0, 1];
    const line = upload(renderer, [0, 0, 10, 5]);
    for (let i = 0; i < 3; i++) {
      renderer.drawLines(line, 2, red, 2, projection);
      renderer.drawPoints(line, 2, red, 4, projection);
      renderer.fillRects(new Float32Array([0, 0, 10, 10, 1, 0, 0, 1, 20, 0, 10, 10, 1, 0, 0, 1]), 2);
    }
    expect(writes).toEqual({ fillStyle: 1, strokeStyle: 1, lineWidth: 1, lineJoin: 1 });
    expect(ctx.calls.filter((c) => c[0] === "fillRect").every((c) => c[1] === "rgba(255,0,0,1)")).toBe(true);

    renderer.beginFrame(100, 50, 1);
    renderer.drawLines(line, 2, red, 2, projection);
    expect(writes).toEqual({ fillStyle: 1, strokeStyle: 2, lineWidth: 2, lineJoin: 2 });

    // A fill-style change from a draw call must not leave a stale rect color behind.
    renderer.drawPoints(line, 2, [0, 0, 1, 1], 4, projection);
    ctx.calls.length = 0;
    renderer.fillRects(new Float32Array([0, 0, 10, 10, 1, 0, 0, 1]), 1);
    expect(ctx.calls).toEqual([["fillRect", "rgba(255,0,0,1)", 0, 0, 10, 10]]);
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
