import { describe, it, expect } from "bun:test";
import { AxisController } from "../../src/interaction/AxisController.ts";
import { Camera2D } from "../../src/interaction/Camera2D.ts";

describe("AxisController step-aware labels", () => {
  it("keeps every linear tick label distinct at any zoom level", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 300; i++) {
      const center = (rand() - 0.5) * 10 ** (rand() * 9);
      const span = 10 ** (rand() * 8 - 6) * Math.max(1e-9, Math.abs(center) * 1e-3 + 1e-3);
      const camera = new Camera2D();
      camera.setViewport({ xMin: 0, xMax: 1, yMin: center, yMax: center + span });
      const axis = new AxisController(camera);
      const ticks = axis.getYTickValues(400, 10);
      const labels = ticks.map((t) => axis.formatValue(t, "y"));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("formats zoomed-in and large values readably", () => {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 1, yMin: 1_000_000, yMax: 1_000_010 });
    const axis = new AxisController(camera);
    const labels = axis.getYTickValues(400, 6).map((t) => axis.formatValue(t, "y"));
    expect(labels.every((l) => !l.includes("e"))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);

    camera.setViewport({ yMin: 1000, yMax: 1000.5 });
    const zoomed = axis.getYTickValues(400, 6).map((t) => axis.formatValue(t, "y"));
    expect(zoomed).toContain("1000.1");
  });

  it("adds date context on midnight and first ticks of time axes", () => {
    const camera = new Camera2D();
    const start = Date.UTC(2026, 11, 31, 22, 0, 0);
    camera.setViewport({ xMin: start, xMax: start + 5 * 3600_000, yMin: 0, yMax: 1 });
    const axis = new AxisController(camera, { x: { scale: "time", timezone: "utc" } });
    const ticks = axis.getXTickValues(800, 10);
    const labels = ticks.map((t) => axis.formatValue(t, "x"));
    expect(labels[0]).toContain("Dec 31");
    const midnight = ticks.findIndex((t) => t === Date.UTC(2027, 0, 1));
    expect(midnight).toBeGreaterThan(0);
    expect(labels[midnight]).toBe("2027-01-01");
    expect(labels[midnight + 1]).not.toContain("Jan");
  });
});
