import { describe, it, expect } from "bun:test";
import { AxisController } from "../../src/interaction/AxisController.ts";
import { Camera2D } from "../../src/interaction/Camera2D.ts";

function logTicks(yMin: number, yMax: number, logBase?: number, maxTicks = 10): number[] {
  const camera = new Camera2D();
  camera.setViewport({ yMin, yMax });
  const axis = new AxisController(camera, { y: { scale: "log", ...(logBase ? { logBase } : {}) } });
  return axis.getYTickValues(400, maxTicks, []);
}

function linearTicks(min: number, max: number): number[] {
  const camera = new Camera2D();
  camera.setViewport({ yMin: min, yMax: max, xMin: min, xMax: max });
  return new AxisController(camera).getYTickValues(400, 10, []);
}

describe("log ticks within one decade", () => {
  for (const [lo, hi] of [[2, 8], [1.2, 3.5], [20, 90], [2.1, 2.3]] as const) {
    it(`labels [${lo}, ${hi}] with in-domain ticks`, () => {
      const ticks = logTicks(lo, hi);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(lo);
        expect(t).toBeLessThanOrEqual(hi);
      }
    });
  }

  it("uses 1-2-5 multiples for [2, 8]", () => {
    expect(logTicks(2, 8)).toEqual([2, 5]);
  });

  it("respects maxTicks and non-decimal bases", () => {
    expect(logTicks(1.1, 9.9, undefined, 3).length).toBeLessThanOrEqual(3);
    const ticks = logTicks(3, 7, 2);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t >= 3 && t <= 7).toBe(true);
  });

  it("keeps wide-domain behavior", () => {
    expect(logTicks(1, 10)).toEqual([1, 10]);
    expect(logTicks(1, 100)).toEqual([1, 10, 100]);
    expect(logTicks(0.5, 1000)).toEqual([0.1, 1, 10, 100, 1000]);
    expect(logTicks(1, 1e6)).toEqual([1, 10, 100, 1e3, 1e4, 1e5, 1e6]);
    expect(logTicks(0.01, 1e9)).toEqual([0.01, 1, 100, 1e4, 1e6, 1e8]);
  });
});

describe("linear ticks on extreme ranges", () => {
  it("does not throw or hang on subnormal ranges", () => {
    const start = performance.now();
    for (const [a, b] of [[1e-320, 3e-320], [0, 5e-324], [5e-324, 1e-323], [-1e-322, 1e-322]] as const) {
      expect(() => linearTicks(a, b)).not.toThrow();
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("does not hang on huge ranges", () => {
    const start = performance.now();
    expect(() => linearTicks(-1.7e308, 1.7e308)).not.toThrow();
    expect(() => linearTicks(0, 1e308)).not.toThrow();
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("keeps normal outputs unchanged", () => {
    expect(linearTicks(0, 1)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(linearTicks(3, 97)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(linearTicks(12.3, 48.9)).toEqual([10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(linearTicks(-5e6, 7e6)).toEqual([-6e6, -4e6, -2e6, 0, 2e6, 4e6, 6e6, 8e6]);
    expect(linearTicks(1e-9, 3e-9)).toEqual([1e-9, 1.2e-9, 1.4e-9, 1.6e-9, 1.8e-9, 2e-9, 2.2e-9, 2.4e-9, 2.6e-9, 2.8e-9, 3e-9]);
  });
});
