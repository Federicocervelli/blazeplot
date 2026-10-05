import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { describe, expect, it } from "bun:test";
import { annotationsPlugin } from "../../src/plugins/annotations.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import type { Annotation, AnnotationHitEvent, AnnotationsPluginOptions } from "../../src/plugins/annotations/types.ts";
import { countNodes } from "./fakes.ts";
import { fire, installPlugin, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function make(options: AnnotationsPluginOptions = {}): { chart: Chart; plugin: ReturnType<typeof annotationsPlugin> } {
  const plugin = annotationsPlugin(options);
  const chart = h.make({ plugins: [plugin], axes: { x: true, y: true, y2: true } });
  chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
  chart.setViewport({ yMin: 0, yMax: 10 }, "right");
  // The plugin draws on the chart's render event; run one frame now that the viewport is set.
  chart.start();
  h.raf.flush();
  return { chart, plugin };
}

const svgOf = (chart: Chart): SVGSVGElement => chartInternals(chart).plotElement.querySelector(".blazeplot-annotations") as SVGSVGElement;
const groups = (chart: Chart): Element[] => [...svgOf(chart).children];
const click = (chart: Chart, x: number, y: number): void => {
  fire(chartInternals(chart).canvas, new window.MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
};

describe("annotationsPlugin rendering", () => {
  it("mounts an aria-hidden, non-interactive SVG overlay sized to the plot", () => {
    const { chart } = make({ zIndex: 5 });
    const svg = svgOf(chart);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.style.pointerEvents).toBe("none");
    expect(svg.style.zIndex).toBe("5");
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 200");
    chart.dispose();
  });

  it("draws lines at data positions with labels and styling", () => {
    const chart = h.make();
    chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
    const plugin = annotationsPlugin({
      annotations: [
        { type: "x-line", x: 50, label: "deploy", color: "red", widthPx: 3, dash: "4 2", className: "mark" },
        { type: "y-line", y: 25, label: { text: "limit", offsetXPx: -10, offsetYPx: 5, color: "blue" } },
      ],
    });
    const dispose = installPlugin(chart, plugin);
    const [xGroup, yGroup] = groups(chart).slice(-2) as [Element, Element];
    const xLine = xGroup.querySelector("line")!;
    expect(xGroup.getAttribute("class")).toBe("mark");
    expect(xLine.getAttribute("x1")).toBe("200");
    expect(xLine.getAttribute("y2")).toBe("200");
    expect(xLine.getAttribute("stroke")).toBe("red");
    expect(xLine.getAttribute("stroke-width")).toBe("3");
    expect(xLine.getAttribute("stroke-dasharray")).toBe("4 2");
    expect(xGroup.querySelector("text")!.textContent).toBe("deploy");

    const yLine = yGroup.querySelector("line")!;
    expect(yLine.getAttribute("y1")).toBe("150");
    const yText = yGroup.querySelector("text")!;
    expect(yText.getAttribute("fill")).toBe("blue");
    expect(yText.getAttribute("x")).toBe("386");
    expect(yText.getAttribute("y")).toBe("151");
    // `font` is a CSS shorthand, not an SVG attribute: it must be a style or browsers fall back to serif.
    expect(yText.getAttribute("font")).toBeNull();
    expect(yText.style.font).not.toBe("");
    dispose();
    chart.dispose();
  });

  it("draws ranges and boxes clamped to the plot and skips empty ones", () => {
    const { chart, plugin } = make({
      annotations: [
        { type: "x-range", xMin: 25, xMax: 75, label: "window" },
        { type: "y-range", yMin: 50, yMax: 150, borderColor: "red", borderWidthPx: 2 },
        { type: "box", xMin: 90, xMax: 120, yMin: 0, yMax: 50, fillColor: "blue" },
        { type: "x-range", xMin: 200, xMax: 300 },
        { type: "box", xMin: 10, xMax: 10, yMin: 0, yMax: 1 },
      ],
    });
    const rects = groups(chart).map((g) => g.querySelector("rect"));
    expect(groups(chart)).toHaveLength(3);
    expect([rects[0]!.getAttribute("x"), rects[0]!.getAttribute("width"), rects[0]!.getAttribute("height")]).toEqual(["100", "200", "200"]);
    // y 50..150 clamps to 50..100: the top half of the plot.
    expect([rects[1]!.getAttribute("y"), rects[1]!.getAttribute("height")]).toEqual(["0", "100"]);
    expect(rects[1]!.getAttribute("stroke")).toBe("red");
    expect(rects[1]!.getAttribute("stroke-width")).toBe("2");
    // x 90..120 clamps to the plot edge.
    expect([rects[2]!.getAttribute("x"), rects[2]!.getAttribute("width")]).toEqual(["360", "40"]);
    expect(rects[2]!.getAttribute("fill")).toBe("blue");
    expect(plugin.getAnnotations()).toHaveLength(5);
    chart.dispose();
  });

  it("draws point markers in each shape and labels, skipping off-plot points", () => {
    const { chart } = make({
      annotations: [
        { type: "point", x: 10, y: 10, label: "p" },
        { type: "point", x: 20, y: 20, shape: "diamond", radiusPx: 8 },
        { type: "point", x: 30, y: 30, shape: "cross" },
        { type: "point", x: 500, y: 30 },
        { type: "label", x: 40, y: 40, text: "note", backgroundColor: "black", color: "white", font: "10px serif" },
        { type: "label", x: -5, y: 40, text: "gone" },
      ],
    });
    const g = groups(chart);
    expect(g).toHaveLength(4);
    expect(g[0]!.querySelector("circle")!.getAttribute("cx")).toBe("40");
    expect(g[0]!.querySelector("text")!.textContent).toBe("p");
    expect(g[1]!.querySelector("polygon")!.getAttribute("points")).toBe("80,152 88,160 80,168 72,160");
    expect(g[2]!.querySelectorAll("line")).toHaveLength(2);
    expect(g[3]!.querySelector("rect")!.getAttribute("fill")).toBe("black");
    expect(g[3]!.querySelector("text")!.getAttribute("fill")).toBe("white");
    chart.dispose();
  });

  it("skips hidden and off-plot lines, and uses the right axis for yAxis: right", () => {
    const { chart } = make({
      annotations: [
        { type: "x-line", x: 50, visible: false },
        { type: "x-line", x: 500 },
        { type: "y-line", y: -10 },
        { type: "y-line", y: 5, yAxis: "right" },
      ],
    });
    expect(groups(chart)).toHaveLength(1);
    // Right axis spans 0..10, so y=5 is mid-plot.
    expect(groups(chart)[0]!.querySelector("line")!.getAttribute("y1")).toBe("100");
    chart.dispose();
  });

  it("re-renders on the chart render event with the current viewport", () => {
    const { chart } = make({ annotations: [{ type: "x-line", x: 50 }] });
    expect(groups(chart)[0]!.querySelector("line")!.getAttribute("x1")).toBe("200");
    chart.setViewport({ xMin: 0, xMax: 200 });
    chart.start();
    h.raf.flush();
    expect(groups(chart)[0]!.querySelector("line")!.getAttribute("x1")).toBe("100");
    chart.dispose();
  });
});

describe("annotationsPlugin imperative API", () => {
  it("adds, removes, replaces, and clears annotations and re-renders each time", () => {
    const { chart, plugin } = make();
    expect(groups(chart)).toHaveLength(0);
    plugin.add({ id: "a", type: "x-line", x: 10 });
    plugin.add({ id: "b", type: "x-line", x: 20 });
    expect(groups(chart)).toHaveLength(2);
    expect(plugin.remove("a")).toBe(true);
    expect(plugin.remove("a")).toBe(false);
    expect(groups(chart)).toHaveLength(1);
    expect(plugin.getAnnotations().map((a) => a.id)).toEqual(["b"]);
    plugin.setAnnotations([{ type: "y-line", y: 1 }, { type: "y-line", y: 2 }, { type: "y-line", y: 3 }]);
    expect(groups(chart)).toHaveLength(3);
    plugin.clear();
    expect(groups(chart)).toHaveLength(0);
    expect(plugin.getAnnotations()).toEqual([]);
    chart.dispose();
  });

  it("keeps working as a store before install and after dispose", () => {
    const plugin = annotationsPlugin();
    plugin.add({ type: "x-line", x: 1 });
    expect(plugin.getAnnotations()).toHaveLength(1);
    expect(plugin.pick(10, 10)).toBeNull();
    const chart = h.make({ plugins: [plugin] });
    expect(groups(chart)).toHaveLength(1);
    chart.dispose();
    expect(() => plugin.add({ type: "x-line", x: 2 })).not.toThrow();
    expect(() => plugin.clear()).not.toThrow();
    expect(plugin.pick(10, 10)).toBeNull();
  });
});

describe("annotationsPlugin hit testing and events", () => {
  const all: Annotation[] = [
    { id: "xl", type: "x-line", x: 50 },
    { id: "yl", type: "y-line", y: 25 },
    { id: "xr", type: "x-range", xMin: 60, xMax: 70 },
    { id: "yr", type: "y-range", yMin: 80, yMax: 90 },
    { id: "bx", type: "box", xMin: 10, xMax: 20, yMin: 10, yMax: 20 },
    { id: "pt", type: "point", x: 90, y: 10, radiusPx: 5 },
    { id: "lb", type: "label", x: 30, y: 60, text: "hello" },
  ];

  it("picks each annotation type within tolerance and returns data and bounds", () => {
    const { chart, plugin } = make({ annotations: all, hitTolerancePx: 4 });
    const at = (x: number, y: number): string | undefined => plugin.pick(x, y)?.annotation.id;
    expect(at(202, 100)).toBe("xl");
    expect(at(300, 151)).toBe("yl");
    expect(at(252, 100)).toBe("xr");
    expect(at(10, 30)).toBe("yr");
    expect(at(60, 170)).toBe("bx");
    expect(at(360, 180)).toBe("pt");
    expect(at(125, 80 - 4)).toBe("lb");
    expect(at(150, 100)).toBeUndefined();

    const hit = plugin.pick(202, 100)!;
    expect(hit.dataX).toBeCloseTo(50.5, 5);
    expect(hit.plotX).toBe(202);
    expect(hit.bounds).toEqual({ x: 50, xMin: 50, xMax: 50 });
    expect(plugin.pick(60, 170)!.bounds).toEqual({ xMin: 10, xMax: 20, yMin: 10, yMax: 20 });
    expect(plugin.pick(10, 30)!.bounds).toEqual({ yMin: 80, yMax: 90 });
    expect(plugin.pick(252, 100)!.bounds).toEqual({ xMin: 60, xMax: 70 });
    expect(plugin.pick(300, 151)!.bounds).toEqual({ y: 25, yMin: 25, yMax: 25 });
    expect(plugin.pick(360, 180)!.bounds).toEqual({ x: 90, y: 10 });
    chart.dispose();
  });

  it("prefers the most recently added annotation and ignores hidden ones", () => {
    const { chart, plugin } = make({
      annotations: [
        { id: "under", type: "x-range", xMin: 0, xMax: 100 },
        { id: "over", type: "x-line", x: 50 },
        { id: "hidden", type: "x-line", x: 50, visible: false },
      ],
    });
    expect(plugin.pick(200, 100)!.annotation.id).toBe("over");
    chart.dispose();
  });

  it("reports hover transitions to options and subscribers, once per transition out", () => {
    const options: Array<AnnotationHitEvent | null> = [];
    const subscribed: Array<AnnotationHitEvent | null> = [];
    const { chart, plugin } = make({ annotations: [{ id: "xl", type: "x-line", x: 50 }], onHover: (e) => options.push(e) });
    const off = plugin.subscribe("hover", (e) => subscribed.push(e));

    fire(chartInternals(chart).canvas, pointerEvent("pointermove", 200, 100));
    fire(chartInternals(chart).canvas, pointerEvent("pointermove", 201, 100));
    expect(options.map((e) => e?.annotation.id)).toEqual(["xl", "xl"]);
    expect(options[0]!.source?.type).toBe("pointermove");
    fire(chartInternals(chart).canvas, pointerEvent("pointermove", 100, 100));
    fire(chartInternals(chart).canvas, pointerEvent("pointermove", 110, 100));
    expect(options.map((e) => e?.annotation.id ?? null)).toEqual(["xl", "xl", null]);
    expect(subscribed).toHaveLength(3);
    off();
    fire(chartInternals(chart).canvas, pointerEvent("pointermove", 200, 100));
    expect(subscribed).toHaveLength(3);
    chart.dispose();
  });

  it("reports clicks to options and subscribers and ignores empty clicks", () => {
    const clicks: string[] = [];
    const subscribed: string[] = [];
    const { chart, plugin } = make({ annotations: [{ id: "xl", type: "x-line", x: 50 }], onClick: (e) => clicks.push(e.annotation.id!) });
    const off = plugin.subscribe("click", (e) => subscribed.push(e.annotation.id!));
    click(chart, 200, 100);
    click(chart, 100, 100);
    expect(clicks).toEqual(["xl"]);
    expect(subscribed).toEqual(["xl"]);
    off();
    click(chart, 200, 100);
    expect(subscribed).toEqual(["xl"]);
    chart.dispose();
  });
});

describe("annotationsPlugin lifecycle", () => {
  it("removes its overlay and subscriptions when disposed alone", () => {
    const chart = h.make();
    chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
    const nodes = countNodes(chart.rootElement);
    const listeners = h.ledger().reachable();
    const hits: unknown[] = [];
    const plugin = annotationsPlugin({ annotations: [{ type: "x-line", x: 50 }], onHover: (e) => hits.push(e), onClick: (e) => hits.push(e) });
    const dispose = installPlugin(chart, plugin);
    expect(countNodes(chart.rootElement)).toBeGreaterThan(nodes);
    dispose();
    expect(countNodes(chart.rootElement)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(listeners);
    fire(chartInternals(chart).canvas, pointerEvent("pointermove", 200, 100));
    click(chart, 200, 100);
    expect(hits).toEqual([]);
    chart.dispose();
  });

  it("gives visible annotations named, focusable button targets that survive re-renders", () => {
    const { chart, plugin } = make({
      annotations: [
        { type: "x-line", x: 50, label: "Deploy" },
        { type: "y-line", y: 50 },
        { type: "box", xMin: 10, xMax: 20, yMin: 10, yMax: 20, ariaLabel: "Incident window" },
        { type: "point", x: 500, y: 1 },
        { type: "label", x: 80, y: 80, text: "Peak", focusable: false },
      ],
    });
    const targets = (): HTMLElement[] => [...chartInternals(chart).plotElement.querySelectorAll<HTMLElement>(".blazeplot-annotation-focus")];
    expect(targets().map((target) => target.getAttribute("aria-label"))).toEqual(["Deploy", "Horizontal line at y 50", "Incident window"]);
    const [line] = targets();
    expect(line!.tabIndex).toBe(0);
    expect(line!.getAttribute("role")).toBe("button");
    expect(line!.getAttribute("aria-roledescription")).toBe("annotation");
    expect(line!.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(line!.style).toMatchObject({ left: "196px", top: "0px", width: "8px", height: "200px", pointerEvents: "none" });

    line!.focus();
    chart.setViewport({ xMin: 0, xMax: 200 });
    h.raf.flush();
    expect(targets()[0]).toBe(line!);
    expect(document.activeElement).toBe(line!);
    expect(line!.style.left).toBe("96px");
    plugin.setAnnotations([]);
    expect(targets()).toEqual([]);
    chart.dispose();
  });

  it("activates with Enter or Space like a click and removes removable annotations with Delete", () => {
    const clicks: AnnotationHitEvent[] = [];
    const removed: Annotation[] = [];
    const first: Annotation = { type: "x-line", x: 25, id: "a", label: "A", removable: true };
    const second: Annotation = { type: "x-line", x: 75, id: "b", label: "B" };
    const { chart, plugin } = make({ annotations: [first, second], onClick: (event) => clicks.push(event), onRemove: (annotation) => removed.push(annotation) });
    const targets = (): HTMLElement[] => [...chartInternals(chart).plotElement.querySelectorAll<HTMLElement>(".blazeplot-annotation-focus")];
    const [a, b] = targets();
    for (const target of [a!, b!]) target.getBoundingClientRect = () => ({ left: 100, top: 0, width: 8, height: 200, right: 108, bottom: 200, x: 100, y: 0, toJSON() {} }) as DOMRect;

    const enter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    fire(a!, enter);
    expect(enter.defaultPrevented).toBe(true);
    fire(b!, new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(clicks.map((event) => event.annotation)).toEqual([first, second]);
    expect(clicks[0]!.source).toBeUndefined();
    expect(a!.getAttribute("aria-keyshortcuts")).toBe("Enter Delete");

    // Not removable: Delete is ignored.
    const ignored = new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    fire(b!, ignored);
    expect(ignored.defaultPrevented).toBe(false);
    expect(plugin.getAnnotations()).toHaveLength(2);

    a!.focus();
    fire(a!, new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(plugin.getAnnotations()).toEqual([second]);
    expect(removed).toEqual([first]);
    expect(a!.isConnected).toBe(false);
    expect(document.activeElement).toBe(b!);

    plugin.setAnnotations([{ ...second, removable: true }]);
    const only = targets()[0]!;
    only.focus();
    fire(only, new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    expect(plugin.getAnnotations()).toEqual([]);
    expect(document.activeElement).toBe(chart.rootElement);
    chart.dispose();
  });

  it("can opt out of focus targets plugin-wide", () => {
    const { chart } = make({ focusable: false, annotations: [{ type: "x-line", x: 50 }] });
    expect(chartInternals(chart).plotElement.querySelector(".blazeplot-annotation-focus")).toBeNull();
    chart.dispose();
  });

  it("leaves no DOM or listeners behind across install/dispose cycles", () => {
    const nodes = countNodes(document.body);
    for (let i = 0; i < 5; i++) {
      const { chart } = make({ annotations: [{ type: "point", x: 1, y: 1 }] });
      chart.dispose();
    }
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(0);
  });
});
