import { describe, expect, it } from "bun:test";
import type { RenderProjection, RendererLossState } from "../../src/render/ChartRenderer.ts";
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
      expect(renderer.capabilities.gpu).toBe(expected.gpu);
      expect(renderer.capabilities.shared).toBe(expected.shared);
      expect(renderer.capabilities.contextLoss).toBe(true);
      expect(renderer.capabilities.maxDrawingBufferPixels).toBeGreaterThan(0);
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

    it("reports what a frame cost", () => {
      const h = fixture.create();
      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      expect(h.renderer.endFrame()).toEqual({ uploadBytes: 0, drawCalls: 0 });

      h.renderer.beginFrame(WIDTH, HEIGHT, 1);
      h.renderer.drawLines(new Float32Array([0, 0, 1, 1, 2, 0, 3, 1]), 4, white, 2, projection);
      h.renderer.drawClipLines(new Float32Array([0, -1, 0, 1]), 2, white);
      h.renderer.drawPoints(new Float32Array([1, 1, 2, 2]), 2, white, 4, projection);
      const report = h.renderer.endFrame();
      expect(report.drawCalls).toBe(3);
      // Eight vertices of two floats each are staged for a GPU; Canvas 2D draws immediately.
      expect(report.uploadBytes).toBe(h.expected.gpu ? 8 * 2 * 4 : 0);

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
