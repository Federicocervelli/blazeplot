import { describe, expect, it } from "bun:test";
import { crosshairPlugin } from "../../src/plugins/crosshair.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import type { CrosshairPluginOptions, CrosshairPosition, RulerMeasurement } from "../../src/ui/Crosshair.ts";
import { countNodes } from "./fakes.ts";
import { fire, installPlugin, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function seed(chart: Chart, scale = 10): void {
  const series = chart.addLine({ capacity: 32, name: "A" });
  for (let x = 0; x <= 10; x++) series.append({ x, y: x * scale });
  chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
}

function make(options: CrosshairPluginOptions = {}): { chart: Chart; plugin: ReturnType<typeof crosshairPlugin>; moves: Array<CrosshairPosition | null> } {
  const moves: Array<CrosshairPosition | null> = [];
  const plugin = crosshairPlugin({ ...options, onMove: (p) => { moves.push(p); options.onMove?.(p); } });
  const chart = h.make({ plugins: [plugin] });
  seed(chart);
  return { chart, plugin, moves };
}

const rootOf = (chart: Chart): HTMLElement => chart.plotElement.querySelector(".blazeplot-crosshair") as HTMLElement;
const lines = (chart: Chart): { v: HTMLElement; hz: HTMLElement; label: HTMLElement } => {
  const layer = chart.plotElement.querySelector(".blazeplot-crosshair-lines") as HTMLElement;
  const overlay = chart.plotElement.querySelector(".blazeplot-crosshair-overlay") as HTMLElement;
  return { v: layer.children[0] as HTMLElement, hz: layer.children[1] as HTMLElement, label: overlay.children[1] as HTMLElement };
};
const move = (chart: Chart, x: number, y: number): void => {
  fire(chart.canvas, pointerEvent("pointermove", x, y));
};

describe("crosshairPlugin crosshair mode", () => {
  it("mounts hidden, then follows the pointer with lines and a value label", () => {
    const { chart, plugin, moves } = make();
    expect(rootOf(chart).style.display).toBe("none");
    expect(plugin.getPosition()).toBeNull();

    move(chart, 200, 100);
    const { v, hz, label } = lines(chart);
    expect(rootOf(chart).style.display).toBe("block");
    expect(v.style.left).toBe("200px");
    expect(hz.style.top).toBe("100px");
    expect(label.style.display).toBe("block");
    expect(label.textContent).toBe("x 5  y 50");
    const position = plugin.getPosition()!;
    expect(position.dataX).toBeCloseTo(5, 5);
    expect(position.dataY).toBeCloseTo(50, 5);
    expect(position.items).toEqual([]);
    expect(moves.at(-1)).toBe(position);
    chart.dispose();
  });

  it("hides when the pointer leaves or moves outside the plot and reports null", () => {
    const { chart, plugin, moves } = make();
    move(chart, 200, 100);
    fire(chart.canvas, pointerEvent("pointerleave", 200, 100));
    expect(rootOf(chart).style.display).toBe("none");
    expect(plugin.getPosition()).toBeNull();
    expect(moves.at(-1)).toBeNull();

    move(chart, 200, 100);
    move(chart, 900, 900);
    expect(rootOf(chart).style.display).toBe("none");
    expect(moves.at(-1)).toBeNull();
    chart.dispose();
  });

  it("draws a single axis and can hide the label", () => {
    const x = make({ axis: "x", label: false });
    move(x.chart, 200, 100);
    expect(lines(x.chart).v.style.display).toBe("block");
    expect(lines(x.chart).hz.style.display).toBe("none");
    expect(lines(x.chart).label.style.display).toBe("none");
    x.chart.dispose();

    const y = make({ axis: "y" });
    move(y.chart, 200, 100);
    expect(lines(y.chart).v.style.display).toBe("none");
    expect(lines(y.chart).hz.style.display).toBe("block");
    y.chart.dispose();
  });

  it("formats labels with formatX/formatY or a custom render function", () => {
    const f = make({ formatX: (v) => `X${v.toFixed(1)}`, formatY: (v) => `Y${v.toFixed(1)}` });
    move(f.chart, 200, 100);
    expect(lines(f.chart).label.textContent).toBe("x X5.0  y Y50.0");
    f.chart.dispose();

    const r = make({ render: (position, container) => { container.textContent = `at ${position.dataX.toFixed(0)}`; } });
    move(r.chart, 200, 100);
    expect(lines(r.chart).label.textContent).toBe("at 5");
    r.chart.dispose();
  });

  it("snaps to the nearest sample and highlights it with a marker", () => {
    const { chart, plugin } = make({ snap: "nearest-x" });
    move(chart, 190, 20);
    const position = plugin.getPosition()!;
    expect(position.dataX).toBe(5);
    expect(position.dataY).toBe(50);
    expect(position.items).toHaveLength(1);
    expect(lines(chart).label.textContent).toContain("(5, 50)");
    const markers = chart.plotElement.querySelector(".blazeplot-crosshair-markers") as HTMLElement;
    expect(markers.children).toHaveLength(1);
    expect(lines(chart).v.style.left).toBe("200px");
    chart.dispose();

    const point = make({ snap: "nearest-point", highlight: false });
    move(point.chart, 190, 100);
    expect(point.plugin.getPosition()!.items).toHaveLength(1);
    expect(point.chart.plotElement.querySelector(".blazeplot-crosshair-markers")!.children).toHaveLength(0);
    point.chart.dispose();
  });

  it("uses a custom highlight renderer and a formatter for picked items", () => {
    const seen: number[] = [];
    const { chart } = make({
      snap: "nearest-x",
      renderHighlight: (position, container) => { seen.push(position.items.length); container.textContent = "hl"; },
      formatter: (item) => `v=${item.y}`,
    });
    move(chart, 200, 100);
    expect(seen.length).toBeGreaterThan(0);
    expect(chart.plotElement.querySelector(".blazeplot-crosshair-markers")!.textContent).toBe("hl");
    expect(lines(chart).label.textContent).toContain("v=50");
    chart.dispose();
  });

  it("highlights histogram bins as an X interval", () => {
    const plugin = crosshairPlugin({ snap: "nearest-x" });
    const chart = h.make({ plugins: [plugin] });
    chart.addHistogram({ values: [1, 1.2, 7], binSize: 1, min: 0, max: 10 });
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 5 });
    move(chart, 60, 100);
    const markers = chart.plotElement.querySelector(".blazeplot-crosshair-markers") as HTMLElement;
    expect(markers.children).toHaveLength(1);
    expect((markers.children[0] as HTMLElement).style.width).toBe("40px");
    expect((markers.children[0] as HTMLElement).style.left).toBe("40px");
    chart.dispose();
  });

  it("re-resolves its position on render while the pointer rests on the chart", () => {
    const { chart, plugin } = make();
    move(chart, 200, 100);
    chart.setViewport({ xMin: 0, xMax: 20 });
    chart.start();
    h.raf.flush();
    expect(plugin.getPosition()!.dataX).toBeCloseTo(10, 5);
    fire(chart.canvas, pointerEvent("pointerleave", 200, 100));
    const count = plugin.getPosition();
    chart.requestRender();
    h.raf.flush();
    expect(plugin.getPosition()).toBe(count);
    chart.dispose();
  });

  it("mirrors the pointer X in charts sharing a syncGroup", () => {
    const a = make({ syncGroup: "s1" });
    const b = make({ syncGroup: "s1" });
    const c = make();
    move(a.chart, 200, 100);
    expect(rootOf(b.chart).style.display).toBe("block");
    expect(lines(b.chart).v.style.left).toBe("200px");
    expect(b.plugin.getPosition()!.dataX).toBeCloseTo(5, 5);
    expect(rootOf(c.chart).style.display).toBe("none");
    fire(a.chart.canvas, pointerEvent("pointerleave", 200, 100));
    expect(rootOf(b.chart).style.display).toBe("none");
    for (const x of [a, b, c]) x.chart.dispose();
  });

  it("shows after a touch long press and ignores plain touch moves", async () => {
    const { chart, plugin } = make({ longPressMs: 1 });
    fire(chart.canvas, pointerEvent("pointerdown", 200, 100, { pointerType: "touch" }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(plugin.getPosition()!.dataX).toBeCloseTo(5, 5);
    fire(chart.canvas, pointerEvent("pointermove", 240, 100, { pointerType: "touch" }));
    expect(plugin.getPosition()!.dataX).toBeCloseTo(6, 5);
    fire(chart.canvas, pointerEvent("pointerup", 240, 100, { pointerType: "touch" }));
    chart.dispose();
  });
});

describe("crosshairPlugin ruler mode", () => {
  it("measures between press and release and emits start, change, and end", () => {
    const started: CrosshairPosition[] = [];
    const changes: RulerMeasurement[] = [];
    const ended: RulerMeasurement[] = [];
    const { chart, plugin } = make({
      mode: "ruler",
      onMeasureStart: (p) => started.push(p),
      onMeasureChange: (m) => changes.push(m),
      onMeasureEnd: (m) => ended.push(m),
    });
    const down = pointerEvent("pointerdown", 100, 50);
    fire(chart.canvas, down);
    expect(down.defaultPrevented).toBe(true);
    expect(started).toHaveLength(1);

    move(chart, 300, 150);
    const svg = chart.plotElement.querySelector("svg") as SVGSVGElement;
    expect(svg.style.display).toBe("block");
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("x1")).toBe("100");
    expect(line.getAttribute("x2")).toBe("300");
    const change = changes.at(-1)!;
    expect(change.deltaX).toBeCloseTo(5, 5);
    expect(change.deltaY).toBeCloseTo(-50, 5);
    expect(change.slope).toBeCloseTo(-10, 5);
    // x 2.5..7.5 covers samples 3..7.
    expect(change.sampleCount).toBe(5);

    fire(chart.canvas, pointerEvent("pointerup", 300, 150));
    expect(ended).toHaveLength(1);
    expect(plugin.getMeasurement()).toBe(ended[0]!);
    plugin.clearMeasurement();
    expect(plugin.getMeasurement()).toBeNull();
    expect(svg.style.display).toBe("none");
    chart.dispose();
  });

  it("keeps the ruler line when the pointer leaves mid-measure, and reports infinite slope for vertical drags", () => {
    const { chart, plugin } = make({ mode: "ruler" });
    fire(chart.canvas, pointerEvent("pointerdown", 200, 50));
    move(chart, 200, 150);
    expect(plugin.getMeasurement()!.slope).toBe(Infinity);
    fire(chart.canvas, pointerEvent("pointerleave", 200, 150));
    expect(rootOf(chart).style.display).toBe("block");
    chart.dispose();
  });

  it("starts a measurement only when the configured modifier is held", () => {
    const started: CrosshairPosition[] = [];
    const { chart } = make({ mode: "ruler", rulerModifier: "shift", onMeasureStart: (p) => started.push(p) });
    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    expect(started).toHaveLength(0);
    fire(chart.canvas, pointerEvent("pointerup", 100, 50));
    fire(chart.canvas, pointerEvent("pointerdown", 100, 50, { shiftKey: true }));
    expect(started).toHaveLength(1);
    chart.dispose();

    for (const modifier of ["ctrl", "alt", "meta"] as const) {
      const n: CrosshairPosition[] = [];
      const m = make({ mode: "ruler", rulerModifier: modifier, onMeasureStart: (p) => n.push(p) });
      fire(m.chart.canvas, pointerEvent("pointerdown", 100, 50));
      expect(n).toHaveLength(0);
      fire(m.chart.canvas, pointerEvent("pointerdown", 100, 50, { [`${modifier}Key`]: true }));
      expect(n).toHaveLength(1);
      m.chart.dispose();
    }
  });

  it("does not start a measurement on a secondary button", () => {
    const started: CrosshairPosition[] = [];
    const { chart } = make({ mode: "ruler", onMeasureStart: (p) => started.push(p) });
    fire(chart.canvas, pointerEvent("pointerdown", 100, 50, { button: 2 }));
    expect(started).toHaveLength(0);
    chart.dispose();
  });
});

describe("crosshairPlugin lifecycle", () => {
  it("removes its DOM and listeners when disposed alone, then stops reacting", () => {
    const chart = h.make();
    seed(chart);
    const nodes = countNodes(chart.rootElement);
    const listeners = h.ledger().reachable();
    const plugin = crosshairPlugin({ syncGroup: "x", mode: "ruler" });
    const dispose = installPlugin(chart, plugin);
    move(chart, 200, 100);
    dispose();
    expect(h.ledger().reachable()).toBe(listeners);
    expect(countNodes(chart.rootElement)).toBe(nodes);
    expect(() => move(chart, 100, 100)).not.toThrow();
    expect(() => plugin.clearMeasurement()).not.toThrow();
    chart.dispose();
  });

  it("leaves no listeners reachable after the chart is disposed", () => {
    const { chart } = make();
    chart.dispose();
    expect(h.ledger().reachable()).toBe(0);
  });
});
