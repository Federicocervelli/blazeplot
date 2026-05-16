import { describe, it, expect } from "bun:test";
import { AxisController } from "../../src/interaction/AxisController.ts";
import { Camera2D } from "../../src/interaction/Camera2D.ts";

describe("AxisController", () => {
  it("generates data-anchored x ticks around the viewport", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 3, xMax: 97, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera);

    expect(axis.getXTickValues(800, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("moves tick positions when the viewport position changes", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 1, yMin: -0.3, yMax: 0.3 });

    const axis = new AxisController(camera);
    const firstTicks = axis.getYTickValues(240, 8);

    camera.setViewport({ yMin: -0.21, yMax: 0.39 });

    expect(axis.getYTickValues(240, 8)).not.toEqual(firstTicks);
  });

  it("limits ticks by available pixels", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 100, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera);

    expect(axis.getXTickValues(160, 10)).toEqual([0, 100]);
  });

  it("reuses target arrays for tick generation", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 20, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera);
    const target = [999];

    expect(axis.getXTickValues(400, 5, target)).toBe(target);
    expect(target).toEqual([0, 5, 10, 15, 20]);
  });

  it("generates fractional y ticks without negative zero", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 1, yMin: -0.3, yMax: 0.3 });

    const axis = new AxisController(camera);

    const ticks = axis.getYTickValues(240, 8);

    expect(ticks).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
    expect(Object.is(ticks[3], -0)).toBe(false);
  });

  it("formats values for compact labels", () => {
    const axis = new AxisController(new Camera2D());

    expect(axis.formatValue(0)).toBe("0");
    expect(axis.formatValue(1234)).toBe("1234");
    expect(axis.formatValue(12.34)).toBe("12.3");
    expect(axis.formatValue(1.234)).toBe("1.23");
    expect(axis.formatValue(0.00012)).toBe("1.20e-4");
  });
});
