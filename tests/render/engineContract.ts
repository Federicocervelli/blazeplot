import { describe, expect, it } from "bun:test";
import type { RenderProjection, RendererLossState } from "../../src/render/ChartRenderer.ts";
import { SegmentSet } from "../../src/render/SegmentSet.ts";
import { testStyle } from "../helpers.ts";
import type { DrawObs, EngineFixture } from "./engineHarness.ts";

/** Maps data [0,10] x [0,5] onto a 100 x 50 device-pixel frame. */
const projection: RenderProjection = { scaleX: 0.2, scaleY: 0.4, offsetX: -1, offsetY: -1 };
const WIDTH = 100;
const HEIGHT = 50;
const white = [1, 1, 1, 1] as const;

/** Device-pixel tolerance: Canvas 2D snaps fills to whole pixels, GPU engines do not. */
const TOLERANCE = 1;

function close(actual: readonly number[], expected: readonly number[], tolerance = TOLERANCE): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(Math.abs(actual[index]! - value)).toBeLessThanOrEqual(tolerance));
}

function only<K extends DrawObs["kind"]>(draws: readonly DrawObs[], kind: K): Extract<DrawObs, { kind: K }>[] {
  return draws.filter((draw): draw is Extract<DrawObs, { kind: K }> => draw.kind === kind);
}

/**
 * Behavior every engine must share. Engines differ in how they put pixels on the canvas, so the
 * suite observes draws through each fixture's probe, normalized to device-pixel geometry.
 */
export function defineEngineContract(fixture: EngineFixture): void {
  const frame = (pixelRatio = 1) => {
    const harness = fixture.create();
    harness.renderer.beginFrame(WIDTH, HEIGHT, pixelRatio);
    harness.resetDraws();
    return harness;
  };

  describe(`engine contract: ${fixture.name}`, () => {
    it("reports what it is", () => {
      const { renderer, expected } = fixture.create();
      expect(renderer.kind).toBe(expected.name);
      expect(renderer.info).toMatchObject({ name: expected.name, requested: expected.name });
      expect(renderer.info.fallbackFrom).toBeUndefined();
      expect(renderer.info.capabilities.gpu).toBe(expected.gpu);
      expect(renderer.info.capabilities.shared).toBe(expected.shared);
      expect(renderer.info.capabilities.contextLoss).toBe(true);
      expect(renderer.info.capabilities.maxDrawingBufferPixels).toBeGreaterThan(0);
      expect(renderer.isLost).toBe(false);
    });

    it("clears the whole frame at the start of every frame", () => {
      const harness = fixture.create();
      harness.renderer.beginFrame(WIDTH, HEIGHT, 1);
      harness.renderer.beginFrame(120, 60, 2);
      expect(harness.clears().slice(-2)).toEqual([[WIDTH, HEIGHT], [120, 60]]);
    });

    it("projects line strips to device pixels with y flipped and breaks the line at NaN", () => {
      const h = frame();
      h.renderer.drawLines(new Float32Array([0, 0, 10, 5, NaN, NaN, 5, 0, 10, 0]), 5, [1, 0, 0, 1], 2, projection);
      h.renderer.endFrame();
      const [stroke] = only(h.draws(), "stroke");
      expect(stroke!.segments).toHaveLength(2);
      close(stroke!.segments[0]!, [0, 50, 100, 0], 0.01);
      close(stroke!.segments[1]!, [50, 50, 100, 50], 0.01);
    });

    it("draws independent segments and skips pairs with a non-finite end", () => {
      const h = frame();
      h.renderer.drawLines(new Float32Array([0, 0, 10, 0, NaN, 0, 5, 5, 0, 5, 10, 5]), 6, white, 1, projection, "lines");
      h.renderer.endFrame();
      const [stroke] = only(h.draws(), "stroke");
      expect(stroke!.segments).toHaveLength(2);
    });

    it("scales CSS line width by the pixel ratio and draws hairlines one device pixel wide", () => {
      const h = frame(2);
      const data = new Float32Array([0, 0, 1, 1]);
      h.renderer.drawLines(data, 2, white, 1.5, projection);
      h.renderer.drawLines(data, 2, white, 0.2, projection);
      h.renderer.endFrame();
      expect(only(h.draws(), "stroke").map((s) => s.widthPx)).toEqual([3, 1]);
    });

    it("draws 1px clip-space lines, one per vertex pair", () => {
      const h = frame();
      h.renderer.drawClipLines(new Float32Array([0, -1, 0, 1, -1, 0, 1, 0]), 4, white);
      h.renderer.endFrame();
      const [stroke] = only(h.draws(), "stroke");
      expect(stroke!.widthPx).toBe(1);
      expect(stroke!.segments).toHaveLength(2);
      close(stroke!.segments[0]!, [50, 50, 50, 0]);
      close(stroke!.segments[1]!, [0, 25, 100, 25]);
    });

    it("draws round markers whose diameter is the CSS point size times the pixel ratio", () => {
      const h = frame(2);
      h.renderer.drawPoints(new Float32Array([5, 2.5, NaN, 1]), 2, white, 4, projection);
      h.renderer.endFrame();
      const [marker] = only(h.draws(), "marker");
      expect(marker!.diameterPx).toBe(8);
      expect(marker!.centers).toHaveLength(1);
      close(marker!.centers[0]!, [50, 25], 0.01);
    });

    it("draws bars from the baseline, offset by the Y origin, centered on x", () => {
      const h = frame();
      h.renderer.drawBarsInstanced(new Float32Array([5, 5, 8, 2.5]), 2, testStyle({ barWidth: 1, baseline: 1000, color: [0, 0, 1, 1] }), projection, 1000);
      h.renderer.endFrame();
      const rects = only(h.draws(), "rect").flatMap((r) => r.rects);
      expect(rects).toHaveLength(2);
      close(rects[0]!, [45, 0, 55, 50]);
      close(rects[1]!, [75, 25, 85, 50]);
    });

    it("fills axis-aligned triangle pairs as rectangles", () => {
      const h = frame();
      // (x0,y0) (x1,y0) (x0,y1) (x0,y1) (x1,y0) (x1,y1) for [2, 4] x [1, 3].
      h.renderer.drawTriangles(new Float32Array([2, 1, 4, 1, 2, 3, 2, 3, 4, 1, 4, 3]), 6, white, projection);
      h.renderer.endFrame();
      const rects = only(h.draws(), "rect").flatMap((r) => r.rects);
      expect(rects).toHaveLength(1);
      close(rects[0]!, [20, 20, 40, 40]);
    });

    it("fills triangle strips as one ribbon, including the part beyond the frame", () => {
      const h = frame();
      // Area fill: (x, y) / (x, baseline) pairs; the last pair runs past the right edge.
      h.renderer.drawTriangles(new Float32Array([0, 5, 0, 0, 5, 5, 5, 0, 12, 2, 12, 0]), 6, [1, 1, 1, 0.25], projection, "triangle_strip");
      h.renderer.endFrame();
      const polygons = only(h.draws(), "polygon");
      expect(polygons).toHaveLength(1);
      close(polygons[0]!.bbox, [0, 0, 120, 50]);
    });

    it("breaks triangle strips at a non-finite vertex pair instead of bridging the gap", () => {
      const h = frame();
      // Three runs of (x, y) / (x, baseline) pairs: x 0-2, a NaN pair at x = 3, then x 4-6 and x 8-9.
      const nan = Number.NaN;
      h.renderer.drawTriangles(new Float32Array([0, 4, 0, 0, 1, 4, 1, 0, 2, 4, 2, 0, 3, nan, 3, 0, 4, 3, 4, 0, 5, 3, 5, 0, 6, 3, 6, 0, nan, nan, 7, 0, 8, 2, 8, 0, 9, 2, 9, 0]), 20, white, projection, "triangle_strip");
      h.renderer.endFrame();
      const boxes = only(h.draws(), "polygon").map((p) => p.bbox);
      expect(boxes).toHaveLength(3);
      close(boxes[0]!, [0, 10, 20, 50], 0.01);
      close(boxes[1]!, [40, 20, 60, 50], 0.01);
      close(boxes[2]!, [80, 30, 90, 50], 0.01);
    });

    it("fills device-pixel rectangles with their own colors and skips non-finite ones", () => {
      const h = frame();
      const rects = new Float32Array([
        10, 5, 20, 10, 1, 0, 0, 1,
        Number.NaN, 0, 5, 5, 0, 1, 0, 1,
        0, 0, 100, 50, 0, 0, 1, 0.5,
      ]);
      h.renderer.fillRects(rects, 3);
      h.renderer.endFrame();
      const drawn = only(h.draws(), "rect").flatMap((r) => r.rects);
      expect(drawn).toHaveLength(2);
      close(drawn[0]!, [10, 5, 30, 15], 0.01);
      close(drawn[1]!, [0, 0, 100, 50], 0.01);
    });

    it("fills rounded shapes in their device-pixel boxes, with borders, and skips bad ones", () => {
      const h = frame();
      const shapes = new Float32Array([
        // A circle: a square with half-side corners, and a border.
        10, 10, 20, 20, 10, 2, 1, 0, 0, 1, 1, 1, 1, 1,
        // A card: rounded corners, no border.
        40, 5, 50, 20, 4, 0, 0, 1, 0, 1, 0, 0, 0, 0,
        // Skipped: a non-finite coordinate, and a zero width.
        Number.NaN, 0, 5, 5, 2, 0, 1, 1, 1, 1, 0, 0, 0, 0,
        0, 0, 0, 5, 2, 0, 1, 1, 1, 1, 0, 0, 0, 0,
      ]);
      h.renderer.fillShapes(shapes, 4);
      h.renderer.endFrame();
      const drawn = only(h.draws(), "shape");
      const boxes = drawn.flatMap((d) => d.boxes.map((box) => ({ box, bordered: d.bordered })));
      expect(boxes).toHaveLength(2);
      close(boxes[0]!.box, [10, 10, 30, 30], 0.01);
      expect(boxes[0]!.bordered).toBe(true);
      close(boxes[1]!.box, [40, 5, 90, 25], 0.01);
      expect(boxes[1]!.bordered).toBe(false);
    });

    it("strokes segments with their own width and dash, and skips non-finite ones", () => {
      const h = frame();
      const segments = new Float32Array([
        0, 10, 100, 10, 2, 0, 0, 0, 1, 0, 0, 1,
        10, 0, 10, Number.NaN, 2, 0, 0, 0, 1, 0, 0, 1,
        0, 40, 50, 40, 3, 6, 4, 0, 0, 0, 1, 1,
      ]);
      h.renderer.strokeSegments(segments, 3);
      h.renderer.endFrame();
      const drawn = only(h.draws(), "stroke").flatMap((d) => d.segments.map((segment) => ({ segment, width: d.widthPx, dashed: d.dashed === true })));
      expect(drawn).toHaveLength(2);
      close(drawn[0]!.segment, [0, 10, 100, 10], 0.01);
      expect([drawn[0]!.width, drawn[0]!.dashed]).toEqual([2, false]);
      close(drawn[1]!.segment, [0, 40, 50, 40], 0.01);
      expect([drawn[1]!.width, drawn[1]!.dashed]).toEqual([3, true]);
    });

    it("fills per-vertex colored triangles, dropping one with a non-finite vertex", () => {
      const h = frame();
      const vertices = new Float32Array([
        10, 10, 1, 0, 0, 1, 20, 10, 1, 0, 0, 1, 15, 20, 1, 0, 0, 1,
        0, 0, 1, 0, 0, 1, Number.NaN, 0, 1, 0, 0, 1, 5, 5, 1, 0, 0, 1,
        50, 30, 0, 1, 0, 1, 60, 30, 0, 1, 0, 1, 55, 40, 0, 1, 0, 1,
      ]);
      h.renderer.fillTriangles(vertices, 9);
      h.renderer.endFrame();
      const boxes = only(h.draws(), "polygon").map((p) => p.bbox);
      expect(boxes).toHaveLength(2);
      close(boxes[0]!, [10, 10, 20, 20], 0.01);
      close(boxes[1]!, [50, 30, 60, 40], 0.01);
    });

    it("shades a field as one image over its grid plus a half step around it, and skips a bad one", () => {
      const h = frame();
      const alpha = new Float32Array([0, 0.5, 1, 0.25, 0.75, 0]);
      h.renderer.fillField!(alpha, 3, 2, 10, 20, 8, 1, 0, 0);
      // Skipped: no step, a non-finite origin, and too few opacities.
      h.renderer.fillField!(alpha, 3, 2, 10, 20, 0, 1, 0, 0);
      h.renderer.fillField!(alpha, 3, 2, Number.NaN, 20, 8, 1, 0, 0);
      h.renderer.fillField!(alpha, 4, 2, 10, 20, 8, 1, 0, 0);
      h.renderer.endFrame();
      // One image, never per-cell triangles (an engine without fillField would fall back to those).
      expect(only(h.draws(), "polygon")).toHaveLength(0);
      const fields = only(h.draws(), "field");
      expect(fields).toHaveLength(1);
      close(fields[0]!.box, [6, 16, 30, 32], 0.01);
      expect([fields[0]!.cols, fields[0]!.rows]).toEqual([3, 2]);
    });

    it("draws a kept segment set through a transform, a range of it, its moved points, and nothing once disposed", () => {
      const strokes = (draws: readonly DrawObs[]) => only(draws, "stroke").flatMap((s) => s.segments.map((g) => ({ g: [...g], width: s.widthPx, dashed: s.dashed === true })));
      // Point 3 is a hole; the third segment names a point that does not exist.
      const set = new SegmentSet(new Float32Array([0, 0, 10, 0, 10, 5, Number.NaN, 1]), 4, new Uint32Array([0, 1, 1, 2, 2, 9, 0, 3]), 4);
      const style = { scaleX: 2, scaleY: 2, offsetX: 5, offsetY: 3, width: 1.5, color: white };
      let h = frame();
      h.renderer.drawSegmentSet(set, style);
      // Skipped: a non-finite transform and no width.
      h.renderer.drawSegmentSet(set, { ...style, offsetX: Number.NaN });
      h.renderer.drawSegmentSet(set, { ...style, width: 0 });
      h.renderer.endFrame();
      const all = strokes(h.draws());
      expect(all).toHaveLength(2);
      close(all[0]!.g, [5, 3, 25, 3], 0.01);
      close(all[1]!.g, [25, 3, 25, 13], 0.01);
      expect(all[0]!.width).toBeCloseTo(1.5, 5);

      // A range, translucent and dashed; then a moved point, drawn on the next frame from the same set.
      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      h.resetDraws();
      h.renderer.drawSegmentSet(set, { ...style, color: [1, 1, 1, 0.5], dash: 4, gap: 2, first: 1, count: 1 });
      h.renderer.endFrame();
      const ranged = strokes(h.draws());
      expect(ranged).toHaveLength(1);
      close(ranged[0]!.g, [25, 3, 25, 13], 0.01);
      expect(ranged[0]!.dashed).toBe(true);
      set.setPoints(new Float32Array([20, 5]), 2);
      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      h.resetDraws();
      h.renderer.drawSegmentSet(set, { ...style, first: 1 });
      h.renderer.endFrame();
      const moved = strokes(h.draws());
      expect(moved).toHaveLength(1);
      close(moved[0]!.g, [25, 3, 45, 13], 0.01);

      set.dispose();
      expect(() => set.dispose()).not.toThrow();
      h = frame();
      h.renderer.drawSegmentSet(set, style);
      h.renderer.endFrame();
      expect(strokes(h.draws())).toHaveLength(0);
    });

    it("draws a surface on another canvas with the same engine, independent of the chart's frame", () => {
      const h = frame();
      const { surface, draws } = h.createSurface();
      expect(surface.kind).toBe(h.expected.name);
      surface.beginFrame(60, 30, 2);
      surface.fillRects(new Float32Array([6, 3, 12, 9, 1, 1, 1, 1]), 1);
      surface.endFrame();
      const rects = only(draws(), "rect").flatMap((r) => r.rects);
      expect(rects).toHaveLength(1);
      close(rects[0]!, [6, 3, 18, 12], 0.01);

      surface.dispose();
      expect(() => surface.dispose()).not.toThrow();
      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      h.resetDraws();
      h.renderer.drawLines(new Float32Array([0, 0, 10, 5]), 2, white, 2, projection);
      h.renderer.endFrame();
      expect(only(h.draws(), "stroke")).toHaveLength(1);
    });

    it("reports what a frame cost", () => {
      const h = fixture.create();
      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      expect(h.renderer.endFrame()).toEqual({ uploadBytes: 0, drawCalls: 0 });

      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      h.renderer.drawLines(new Float32Array([0, 0, 1, 1, 2, 0, 3, 1]), 4, white, 2, projection);
      h.renderer.drawClipLines(new Float32Array([0, -1, 0, 1]), 2, white);
      h.renderer.drawPoints(new Float32Array([1, 1, 2, 2]), 2, white, 4, projection);
      h.renderer.fillRects(new Float32Array([0, 0, 5, 5, 1, 1, 1, 1]), 1);
      const report = h.renderer.endFrame();
      expect(report.drawCalls).toBe(4);
      // Eight vertices of two floats each and one eight-float rectangle are staged for a GPU; Canvas 2D draws immediately.
      expect(report.uploadBytes).toBe(h.expected.gpu ? (8 * 2 + 8) * 4 : 0);

      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      expect(h.renderer.endFrame()).toEqual({ uploadBytes: 0, drawCalls: 0 });
    });

    it("tells its listener about context loss and restore, and draws again afterwards", () => {
      const h = frame();
      const states: RendererLossState[] = [];
      h.renderer.setLossListener((state) => states.push(state));

      const event = h.lose();
      expect(event.defaultPrevented).toBe(true);
      expect(states).toEqual(["lost"]);
      expect(h.renderer.isLost).toBe(true);

      h.restore();
      expect(states).toEqual(["lost", "restored"]);
      expect(h.renderer.isLost).toBe(false);
      if (h.rebuilds() !== null) expect(h.rebuilds()).toBe(2);

      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      h.resetDraws();
      h.renderer.drawLines(new Float32Array([0, 0, 10, 5]), 2, white, 2, projection);
      h.renderer.endFrame();
      expect(only(h.draws(), "stroke")).toHaveLength(1);
    });

    it("stops reporting once the listener is cleared", () => {
      const h = frame();
      const states: RendererLossState[] = [];
      h.renderer.setLossListener((state) => states.push(state));
      h.renderer.setLossListener(null);
      h.lose();
      h.restore();
      expect(states).toEqual([]);
    });

    it("disposes more than once, and stays quiet afterwards", () => {
      const h = frame();
      const states: RendererLossState[] = [];
      h.renderer.setLossListener((state) => states.push(state));
      h.renderer.dispose();
      expect(() => h.renderer.dispose()).not.toThrow();
      h.lose();
      h.restore();
      expect(states).toEqual([]);
    });
  });
}
