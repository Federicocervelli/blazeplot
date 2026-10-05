import { describe, expect, it } from "bun:test";
import { AxisController } from "../../src/interaction/AxisController.js";
import { Camera2D } from "../../src/interaction/Camera2D.js";

function ticksFor(xMin: number, xMax: number) {
  const camera = new Camera2D();
  camera.setViewport({ xMin, xMax, yMin: 0, yMax: 1 });
  const axis = new AxisController(camera, { x: { scale: "time", timezone: "utc" } });
  const ticks = axis.getXTickValues(800, 10);
  return { ticks, labels: ticks.map((t) => axis.formatValue(t, "x")) };
}

describe("sub-millisecond time axes", () => {
  const start = Date.UTC(2026, 5, 1, 12, 0, 0);

  it("generates real ticks inside a sub-millisecond span", () => {
    const { ticks, labels } = ticksFor(start + 0.1, start + 0.6);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(start + 0.1 - 1e-6);
      expect(t).toBeLessThanOrEqual(start + 0.6 + 1e-6);
    }
    expect(new Set(labels).size).toBe(labels.length);
    // 100 us step: milliseconds plus one fractional digit.
    expect(labels.every((l) => /:\d\d\.\d{4}$/.test(l))).toBe(true);
    expect(labels[0]).toMatch(/12:00:00\.0001$/);
  });

  it("labels microsecond ticks with a date on the first tick only", () => {
    const { ticks, labels } = ticksFor(start + 0.0005, start + 0.0035);
    expect(ticks.length).toBeGreaterThan(2);
    expect(labels[0]).toContain("Jun 01");
    expect(labels[1]).not.toContain("Jun");
    expect(new Set(labels).size).toBe(labels.length);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
  });

  it("works near t=0 and across a second boundary", () => {
    const near = ticksFor(0, 0.002);
    expect(near.ticks.length).toBeGreaterThan(2);
    expect(new Set(near.labels).size).toBe(near.labels.length);
    const cross = ticksFor(1999.9, 2000.1);
    expect(cross.labels.some((l) => l.includes(":02.000"))).toBe(true);
    expect(cross.labels.every((l) => !/\.1000/.test(l))).toBe(true);
  });

  it("keeps millisecond-and-up behavior unchanged", () => {
    const { labels } = ticksFor(start, start + 10);
    expect(labels.every((l) => /\.\d{3}$/.test(l))).toBe(true);
  });
});
