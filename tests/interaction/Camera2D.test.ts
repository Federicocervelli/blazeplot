import { describe, it, expect } from "bun:test";
import { Camera2D } from "../../src/interaction/Camera2D.ts";

describe("Camera2D", () => {
  it("exposes derived scale and offset", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 10, yMin: -5, yMax: 5 });
    expect(camera.xScale).toBe(0.2);
    expect(camera.xOffset).toBe(-1);
    expect(camera.yScale).toBe(0.2);
    expect(camera.yOffset).toBeCloseTo(0);
  });

  it("pans by a fraction of the current viewport", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 20 });
    camera.pan({ dx: 0.1, dy: -0.25 });
    expect(camera.viewport).toEqual({ xMin: 1, xMax: 11, yMin: -5, yMax: 15 });
  });

  it("zooms around a normalized center", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    camera.zoom({ factor: 2, cx: 0.5, cy: 0.5, axis: "xy" });
    expect(camera.viewport).toEqual({ xMin: 2.5, xMax: 7.5, yMin: 2.5, yMax: 7.5 });
  });

  it("zooms one axis when requested", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    camera.zoom({ factor: 2, cx: 0.5, cy: 0.5, axis: "y" });
    expect(camera.viewport).toEqual({ xMin: 0, xMax: 10, yMin: 2.5, yMax: 7.5 });
  });

  it("rejects invalid viewport bounds atomically", () => {
    const camera = new Camera2D();
    expect(() => camera.setViewport({ xMin: 1, xMax: 1 })).toThrow(RangeError);
    expect(camera.viewport).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
  });

  it("rejects invalid zoom factors", () => {
    const camera = new Camera2D();
    expect(() => camera.zoom({ factor: 0, cx: 0.5, cy: 0.5, axis: "xy" })).toThrow(RangeError);
    expect(() => camera.zoom({ factor: -1, cx: 0.5, cy: 0.5, axis: "xy" })).toThrow(RangeError);
  });

  it("clones without sharing state", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 10, xMax: 20, yMin: -1, yMax: 1 });
    const clone = camera.clone();
    clone.pan({ dx: 1, dy: 1 });
    expect(camera.viewport).toEqual({ xMin: 10, xMax: 20, yMin: -1, yMax: 1 });
    expect(clone.viewport).toEqual({ xMin: 20, xMax: 30, yMin: 1, yMax: 3 });
  });
});
