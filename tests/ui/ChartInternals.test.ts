import { describe, expect, it } from "bun:test";
import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { useChartHarness } from "./harness.ts";

describe("chartInternals", () => {
  const h = useChartHarness();

  it("exposes the canvas, gutters, cameras, and live plugin installation of a chart", () => {
    const chart = h.make();
    const access = chartInternals(chart);
    expect(access.canvas.tagName).toBe("CANVAS");
    expect(chart.rootElement.contains(access.plotElement)).toBe(true);
    expect(chart.rootElement.contains(access.xAxisElement)).toBe(true);
    expect(access.getCamera("left")).not.toBe(access.getCamera("right"));
    let installed = 0;
    const dispose = access.installPlugin({ install: () => { installed++; } });
    expect(installed).toBe(1);
    dispose();
  });

  it("rejects objects that are not charts", () => {
    expect(() => chartInternals({})).toThrow(TypeError);
  });
});
