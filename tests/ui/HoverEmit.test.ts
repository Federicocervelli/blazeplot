import { describe, expect, it } from "bun:test";
import { crosshairPlugin } from "../../src/plugins/crosshair.ts";
import { tooltipPlugin } from "../../src/plugins/tooltip.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import { fire, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function seeded(chart: Chart) {
  const series = chart.addLine({ capacity: 64, name: "A" });
  for (let x = 0; x <= 10; x++) series.append({ x, y: x * 10 });
  chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
  return series;
}

const tooltipOf = (): HTMLElement => document.body.querySelector(".blazeplot-tooltip") as HTMLElement;

describe("hover emission", () => {
  it("emits hover once for a still pointer over static data in continuous mode", () => {
    const chart = h.make({ renderLoop: "continuous" });
    seeded(chart);
    let hovers = 0;
    chart.subscribe("hover", () => hovers++);
    chart.start();
    fire(chart.canvas, pointerEvent("pointermove", 200, 100));
    for (let frame = 0; frame < 10; frame++) h.raf.flush();
    expect(hovers).toBe(1);
    expect(chart.getHoverState()?.items[0]?.y).toBe(50);
    chart.dispose();
  });

  it("emits again when the pointer moves, the hovered value changes, or the pointer leaves", () => {
    const chart = h.make({ renderLoop: "continuous" });
    const series = seeded(chart);
    const states: Array<number | null> = [];
    chart.subscribe("hover", (state) => states.push(state?.items[0]?.y ?? null));
    chart.start();
    fire(chart.canvas, pointerEvent("pointermove", 200, 100));
    h.raf.flush();
    h.raf.flush();
    series.updateAt(5, { x: 5, y: 55 });
    h.raf.flush();
    h.raf.flush();
    fire(chart.canvas, pointerEvent("pointermove", 240, 100));
    h.raf.flush();
    h.raf.flush();
    fire(chart.canvas, pointerEvent("pointerleave", 240, 100));
    h.raf.flush();
    expect(states).toEqual([50, 55, 60, null]);
    chart.dispose();
  });

  it("does not rebuild the tooltip DOM while a still pointer sees unchanged values", () => {
    const chart = h.make({ renderLoop: "continuous", plugins: [tooltipPlugin()] });
    seeded(chart);
    chart.start();
    fire(chart.canvas, pointerEvent("pointermove", 200, 100));
    h.raf.flush();
    h.raf.flush();
    const content = tooltipOf().firstChild;
    expect(content).not.toBeNull();
    for (let frame = 0; frame < 5; frame++) h.raf.flush();
    expect(tooltipOf().firstChild).toBe(content);
    chart.dispose();
  });

  it("keeps updating the tooltip on a live-follow chart with a still pointer", () => {
    const chart = h.make({ followX: { window: 10 }, plugins: [tooltipPlugin()] });
    const series = chart.addLine({ capacity: 256, name: "A" });
    for (let x = 0; x < 20; x++) series.append({ x, y: x });
    chart.start();
    h.raf.flush();
    fire(chart.canvas, pointerEvent("pointermove", 400, 100));
    h.raf.flush();
    h.raf.flush();
    const before = tooltipOf().textContent;
    for (let x = 20; x < 25; x++) {
      series.append({ x, y: x });
      h.raf.flush();
      h.raf.flush();
    }
    expect(tooltipOf().style.display).toBe("block");
    expect(tooltipOf().textContent).not.toBe(before);
    chart.dispose();
  });

  it("renders the tooltip in the same frame as the hover event, without an extra animation frame", () => {
    const chart = h.make({ plugins: [tooltipPlugin()] });
    seeded(chart);
    let tooltipAtHover = "";
    chart.subscribe("hover", () => { tooltipAtHover = tooltipOf().textContent ?? ""; });
    fire(chart.canvas, pointerEvent("pointermove", 200, 100));
    h.raf.flush();
    expect(tooltipOf().style.display).toBe("block");
    expect(tooltipOf().textContent).toContain("(5, 50)");
    // The plugin subscribed first, so by the time later subscribers run the tooltip is already current.
    expect(tooltipAtHover).toContain("(5, 50)");
    chart.dispose();
  });

  it("reuses crosshair marker nodes across updates", () => {
    const chart = h.make({ plugins: [crosshairPlugin({ snap: "nearest-x" })] });
    seeded(chart);
    fire(chart.canvas, pointerEvent("pointermove", 200, 100));
    h.raf.flush();
    const layer = chart.plotElement.querySelector(".blazeplot-crosshair-markers") as HTMLElement;
    const first = layer.querySelector(".blazeplot-pick-marker");
    expect(first).not.toBeNull();
    fire(chart.canvas, pointerEvent("pointermove", 240, 100));
    h.raf.flush();
    expect(layer.querySelector(".blazeplot-pick-marker")).toBe(first);
    chart.dispose();
  });
});
