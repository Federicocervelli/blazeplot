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

  it("generates UTC time ticks", () => {
    const camera = new Camera2D();
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    camera.setViewport({ xMin: start, xMax: start + 3 * 60 * 60_000, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera, { x: { scale: "time", timezone: "utc" } });

    expect(axis.getXTickValues(800, 10)).toEqual([
      Date.UTC(2026, 0, 1, 0, 0, 0),
      Date.UTC(2026, 0, 1, 0, 30, 0),
      Date.UTC(2026, 0, 1, 1, 0, 0),
      Date.UTC(2026, 0, 1, 1, 30, 0),
      Date.UTC(2026, 0, 1, 2, 0, 0),
      Date.UTC(2026, 0, 1, 2, 30, 0),
      Date.UTC(2026, 0, 1, 3, 0, 0),
    ]);
  });

  it("formats time ticks with built-in patterns", () => {
    const camera = new Camera2D();
    const start = Date.UTC(2026, 4, 18, 12, 34, 56, 789);
    camera.setViewport({ xMin: start, xMax: start + 1_000, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera, { x: { scale: "time", timezone: "utc", tickFormat: "%Y-%m-%d %H:%M:%S.%L" } });

    expect(axis.formatValue(start, "x")).toBe("2026-05-18 12:34:56.789");
  });

  it("uses custom tick formatter callbacks", () => {
    const axis = new AxisController(new Camera2D(), { y: { tickFormat: (value, renderAxis) => `${renderAxis}:${value}` } });

    expect(axis.formatValue(42, "y")).toBe("y:42");
  });

  it("generates log scale ticks", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 1, xMax: 1000, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera, { x: { scale: "log", logBase: 10 } });

    expect(axis.getXTickValues(800, 10)).toEqual([1, 10, 100, 1000]);
  });

  it("formats categorical ticks from labels", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 3, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera, { x: { scale: "categorical", categories: ["A", "B", "C", "D"] } });

    expect(axis.getXTickValues(800, 10)).toEqual([0, 1, 2, 3]);
    expect(axis.formatValue(2, "x")).toBe("C");
  });

  it("uses custom scale tick and format hooks", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 100, yMin: -1, yMax: 1 });

    const axis = new AxisController(camera, {
      x: {
        scale: {
          type: "custom",
          ticks: () => [0, 50, 100],
          formatTick: (value) => `v${value}`,
        },
      },
    });

    expect(axis.getXTickValues(800, 10)).toEqual([0, 50, 100]);
    expect(axis.formatValue(50, "x")).toBe("v50");
  });
});
