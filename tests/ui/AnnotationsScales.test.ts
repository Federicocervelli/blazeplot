import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { describe, expect, it } from "bun:test";
import { annotationsPlugin } from "../../src/plugins/annotations.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import type { Annotation } from "../../src/plugins/annotations/types.ts";
import { installPlugin, useChartHarness } from "./harness.ts";

const h = useChartHarness();
const groups = (chart: Chart): Element[] => [...(chartInternals(chart).plotElement.querySelector(".blazeplot-annotations") as SVGSVGElement).children];

describe("annotationsPlugin scales and node reuse", () => {
  it("projects through log and reversed axes", () => {
    const chart = h.make({ axes: { x: { scale: "linear", reversed: true }, y: { scale: "log" } } });
    chart.setViewport({ xMin: 0, xMax: 100, yMin: 1, yMax: 10000 });
    const plugin = annotationsPlugin({ annotations: [{ type: "y-line", y: 100 }, { type: "x-line", x: 25 }] });
    const dispose = installPlugin(chart, plugin);
    const [yGroup, xGroup] = groups(chart).slice(-2) as [Element, Element];
    expect(Number(yGroup.querySelector("line")!.getAttribute("y1"))).toBeCloseTo(100, 3);
    expect(Number(xGroup.querySelector("line")!.getAttribute("x1"))).toBeCloseTo(300, 3);
    dispose();
    chart.dispose();
  });

  it("reuses SVG nodes when the viewport changes", () => {
    const chart = h.make({ axes: { x: true, y: true } });
    chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
    const plugin = annotationsPlugin({ annotations: Array.from({ length: 50 }, (_, i) => ({ type: "x-line", x: i }) as Annotation) });
    const dispose = installPlugin(chart, plugin);
    const before = groups(chart);
    chart.setViewport({ xMin: -10, xMax: 70 });
    chart.start();
    h.raf.flush();
    const after = groups(chart);
    expect(after).toHaveLength(50);
    expect(after.every((node, i) => node === before[i])).toBe(true);
    expect(after[20]!.querySelector("line")!.getAttribute("x1")).toBe("150");
    dispose();
    chart.dispose();
  });
});
