import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { navigatorPlugin } from "../../src/plugins/navigator.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import type { NavigatorPluginOptions } from "../../src/plugins/navigator/Navigator.ts";
import { countNodes } from "./fakes.ts";
import { fire, installPlugin, keyEvent, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

// Every element reports a 400px-wide box at the origin, so the navigator track is 400px wide.
type Stubbed = "getBoundingClientRect" | "clientWidth" | "clientHeight";
const saved = new Map<Stubbed, PropertyDescriptor | undefined>();
let proto: Element;
beforeAll(() => {
  proto = window.Element.prototype;
  for (const key of ["getBoundingClientRect", "clientWidth", "clientHeight"] as const) saved.set(key, Object.getOwnPropertyDescriptor(proto, key));
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 56, right: 400, bottom: 56, x: 0, y: 0, toJSON() {} }) as DOMRect;
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 400 });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 56 });
});
afterAll(() => {
  // The harness may already have torn down the window, so use the prototype captured in beforeAll.
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(proto, key, descriptor);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }
});

/** Chart with a line over x 0..1000 viewing x 200..400. */
function make(options: NavigatorPluginOptions = {}, withData = true): { chart: Chart; plugin: ReturnType<typeof navigatorPlugin> } {
  const plugin = navigatorPlugin(options);
  const chart = h.make({ plugins: [plugin] });
  if (withData) {
    const series = chart.addLine({ capacity: 2048 });
    for (let x = 0; x <= 1000; x += 10) series.append({ x, y: x % 100 });
    chart.setViewport({ xMin: 200, xMax: 400 });
  }
  return { chart, plugin };
}

const rootOf = (chart: Chart): HTMLElement => chart.rootElement.querySelector(".blazeplot-navigator") as HTMLElement;
const num = (el: HTMLElement, attr: string): number => Number(el.getAttribute(attr));
/** Root padding as "top right bottom left", normalizing CSS shorthand serialization. */
const padding = (chart: Chart): string => {
  const parts = (chart.rootElement.style.padding || "0px").split(/\s+/);
  const t = parts[0] ?? "0px";
  const r = parts[1] ?? t;
  const b = parts[2] ?? t;
  const l = parts[3] ?? r;
  return `${t} ${r} ${b} ${l}`;
};

describe("navigatorPlugin ARIA and layout", () => {
  it("exposes a labelled, focusable slider with the visible range as its value", () => {
    const { chart } = make();
    const root = rootOf(chart);
    expect(root.getAttribute("role")).toBe("slider");
    expect(root.tabIndex).toBe(0);
    expect(root.getAttribute("aria-label")).toBe("Chart navigator visible X range");
    expect(root.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(num(root, "aria-valuemin")).toBe(0);
    expect(num(root, "aria-valuemax")).toBe(1000);
    expect(num(root, "aria-valuenow")).toBe(300);
    expect(root.getAttribute("aria-valuetext")).toBe("Visible X range 200 to 400");

    chart.setViewport({ xMin: 500, xMax: 700 });
    expect(num(root, "aria-valuenow")).toBe(600);
    expect(root.getAttribute("aria-valuetext")).toBe("Visible X range 500 to 700");
    chart.dispose();
  });

  it("reserves space at the chosen placement and releases it on dispose", () => {
    const bottom = make({ height: 40, margin: 5 });
    expect(padding(bottom.chart)).toBe("0px 0px 50px 0px");
    expect(rootOf(bottom.chart).style.bottom).toBe("5px");
    bottom.chart.dispose();

    const top = make({ placement: "top" });
    expect(padding(top.chart)).toBe("72px 0px 0px 0px");
    expect(rootOf(top.chart).style.top).toBe("8px");
    top.chart.dispose();

    const chart = h.make();
    const before = padding(chart);
    const dispose = installPlugin(chart, navigatorPlugin());
    expect(padding(chart)).not.toBe(before);
    dispose();
    expect(padding(chart)).toBe(before);
    chart.dispose();
  });

  it("does not reserve space when reserveSpace is false", () => {
    const { chart } = make({ reserveSpace: false });
    expect(padding(chart)).toBe("0px 0px 0px 0px");
    chart.dispose();
  });

  it("hides until there is data to overview and draws one path per series", () => {
    const { chart, plugin } = make({}, false);
    expect(rootOf(chart).style.display).not.toBe("block");
    const a = chart.addLine({ capacity: 64 });
    chart.addLine({ capacity: 64 }).append({ x: 0, y: 0 });
    for (let x = 0; x < 10; x++) a.append({ x, y: x });
    chart.setViewport({ xMin: 2, xMax: 5 });
    plugin.refresh();
    const root = rootOf(chart);
    expect(root.style.display).toBe("block");
    const paths = root.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute("d")!.startsWith("M ")).toBe(true);
    expect(paths[0]!.getAttribute("stroke")).toMatch(/^rgb/);
    chart.dispose();
  });

  it("limits the overview to the configured series and applies styling options", () => {
    const plugin = navigatorPlugin({ strokeColor: "red", strokeWidth: 3, fillColor: "blue", className: "nav", zIndex: 9 });
    const chart = h.make({ plugins: [plugin] });
    const a = chart.addLine({ capacity: 16 });
    const b = chart.addLine({ capacity: 16 });
    for (let x = 0; x < 8; x++) {
      a.append({ x, y: x });
      b.append({ x, y: 1 });
    }
    chart.setViewport({ xMin: 1, xMax: 4 });
    const root = chart.rootElement.querySelector(".nav") as HTMLElement;
    expect(root.style.zIndex).toBe("9");
    const path = root.querySelector("path")!;
    expect(path.getAttribute("stroke")).toBe("red");
    expect(path.getAttribute("stroke-width")).toBe("3");
    expect(path.getAttribute("fill")).toBe("blue");

    const only = navigatorPlugin({ series: [b] });
    const chart2 = h.make({ plugins: [only] });
    const b2 = chart2.addLine({ capacity: 16 });
    chart2.addLine({ capacity: 16 }).append({ x: 0, y: 0 });
    for (let x = 0; x < 8; x++) b2.append({ x, y: x });
    chart.dispose();
    chart2.dispose();
  });
});

describe("navigatorPlugin keyboard", () => {
  it("pans the visible range with arrow keys (Shift for larger steps) and reports range changes", () => {
    const ranges: Array<{ xMin: number; xMax: number }> = [];
    const { chart } = make({ onRangeChange: (r) => ranges.push(r) });
    const root = rootOf(chart);
    const right = keyEvent("ArrowRight");
    fire(root, right);
    expect(right.defaultPrevented).toBe(true);
    expect(chart.getViewport().xMin).toBeCloseTo(220, 5);
    expect(chart.getViewport().xMax).toBeCloseTo(420, 5);
    fire(root, keyEvent("ArrowLeft", { shiftKey: true }));
    expect(chart.getViewport().xMin).toBeCloseTo(170, 5);
    expect(chart.getViewport().xMax).toBeCloseTo(370, 5);
    expect(ranges.at(-1)!.xMin).toBeCloseTo(170, 5);
    expect(ranges).toHaveLength(2);
    chart.dispose();
  });

  it("jumps to the start or end of the domain with Home and End", () => {
    const { chart } = make();
    const root = rootOf(chart);
    fire(root, keyEvent("End"));
    expect(chart.getViewport()).toMatchObject({ xMin: 800, xMax: 1000 });
    fire(root, keyEvent("Home"));
    expect(chart.getViewport()).toMatchObject({ xMin: 0, xMax: 200 });
    chart.dispose();
  });

  it("clamps panning at the domain edges and leaves other keys alone", () => {
    const { chart } = make();
    const root = rootOf(chart);
    for (let i = 0; i < 20; i++) fire(root, keyEvent("ArrowLeft", { shiftKey: true }));
    expect(chart.getViewport().xMin).toBe(0);
    expect(chart.getViewport().xMax).toBe(200);
    const other = keyEvent("a");
    fire(root, other);
    expect(other.defaultPrevented).toBe(false);
    chart.dispose();
  });

  it("does not let the chart's own keyboard pan consume the slider's arrow keys twice", () => {
    // The navigator root is inside the chart root, so keys bubble to the chart's handler as well.
    // The navigator preventDefaults first, and the chart skips defaultPrevented events.
    const { chart } = make();
    fire(rootOf(chart), keyEvent("ArrowRight"));
    expect(chart.getViewport().xMin).toBeCloseTo(220, 5);
    chart.dispose();
  });
});

describe("navigatorPlugin pointer", () => {
  it("drags the window to pan and ignores moves after release", () => {
    const { chart } = make();
    const root = rootOf(chart);
    // The window spans 80..160px of the 400px track; 120 is its middle.
    const down = pointerEvent("pointerdown", 120, 10);
    fire(root, down);
    expect(down.defaultPrevented).toBe(true);
    fire(root, pointerEvent("pointermove", 160, 10));
    expect(chart.getViewport().xMin).toBeCloseTo(300, 5);
    expect(chart.getViewport().xMax).toBeCloseTo(500, 5);
    fire(root, pointerEvent("pointerup", 160, 10));
    fire(root, pointerEvent("pointermove", 300, 10));
    expect(chart.getViewport().xMin).toBeCloseTo(300, 5);
    chart.dispose();
  });

  it("resizes from the left and right handles", () => {
    const { chart } = make();
    const root = rootOf(chart);
    fire(root, pointerEvent("pointerdown", 80, 10));
    fire(root, pointerEvent("pointermove", 40, 10));
    fire(root, pointerEvent("pointerup", 40, 10));
    expect(chart.getViewport().xMin).toBeCloseTo(100, 5);
    expect(chart.getViewport().xMax).toBeCloseTo(400, 5);

    // The right edge is now at 160px.
    fire(root, pointerEvent("pointerdown", 160, 10));
    fire(root, pointerEvent("pointermove", 200, 10));
    fire(root, pointerEvent("pointerup", 200, 10));
    expect(chart.getViewport().xMin).toBeCloseTo(100, 5);
    expect(chart.getViewport().xMax).toBeCloseTo(500, 5);
    chart.dispose();
  });

  it("ignores secondary buttons, and cancels like release", () => {
    const { chart } = make();
    const root = rootOf(chart);
    const secondary = pointerEvent("pointerdown", 120, 10, { button: 2 });
    fire(root, secondary);
    expect(secondary.defaultPrevented).toBe(false);
    fire(root, pointerEvent("pointerdown", 120, 10));
    fire(root, pointerEvent("pointercancel", 120, 10));
    fire(root, pointerEvent("pointermove", 200, 10));
    expect(chart.getViewport().xMin).toBe(200);
    chart.dispose();
  });

  it("resets to the full domain on double click", () => {
    const { chart } = make();
    fire(rootOf(chart), new window.MouseEvent("dblclick", { bubbles: true }));
    expect(chart.getViewport()).toMatchObject({ xMin: 0, xMax: 1000 });
    chart.dispose();
  });
});

describe("navigatorPlugin live follow", () => {
  it("does not undo a viewport change that moves the window off the right edge", () => {
    // Regression: with the default followLive, the window starts "at the right edge", and a
    // viewport change away from it (box zoom, pan, setViewport, dragging the navigator) used to be
    // reverted straight back to the newest data by the navigator's own viewportchange handler.
    const { chart } = make();
    chart.setViewport({ xMin: 800, xMax: 1000 });
    chart.setViewport({ xMin: 500, xMax: 700 });
    expect(chart.getViewport()).toMatchObject({ xMin: 500, xMax: 700 });
    chart.pan({ dx: -0.1, dy: 0 });
    expect(chart.getViewport().xMax).toBeLessThan(700);
    chart.dispose();
  });

  it("keeps the window pinned to the newest data while it sits at the right edge", () => {
    const { chart } = make();
    const series = chart.getSeriesState()[0]!.series;
    chart.setViewport({ xMin: 800, xMax: 1000 });
    series.append({ x: 1100, y: 1 });
    chart.start();
    h.raf.flush();
    expect(chart.getViewport()).toMatchObject({ xMin: 900, xMax: 1100 });
    chart.dispose();
  });

  it("does not follow when followLive is false or the window is away from the edge", () => {
    const off = make({ followLive: false });
    off.chart.setViewport({ xMin: 800, xMax: 1000 });
    off.chart.getSeriesState()[0]!.series.append({ x: 1100, y: 1 });
    off.chart.start();
    h.raf.flush();
    expect(off.chart.getViewport()).toMatchObject({ xMin: 800, xMax: 1000 });
    off.chart.dispose();

    const away = make();
    away.chart.getSeriesState()[0]!.series.append({ x: 1100, y: 1 });
    away.chart.start();
    h.raf.flush();
    expect(away.chart.getViewport()).toMatchObject({ xMin: 200, xMax: 400 });
    away.chart.dispose();
  });
});

describe("navigatorPlugin lifecycle", () => {
  it("applies and refreshes theme colors", () => {
    const { chart } = make();
    const root = rootOf(chart);
    expect(root.style.background).not.toBe("");
    chart.setTheme({ legendBackgroundColor: "rgb(1, 2, 3)" });
    expect(root.style.background).toBe("rgb(1, 2, 3)");
    chart.dispose();
  });

  it("removes its DOM, listeners, subscriptions, and reservation when disposed alone", () => {
    const chart = h.make();
    const series = chart.addLine({ capacity: 64 });
    for (let x = 0; x < 20; x++) series.append({ x, y: x });
    const nodes = countNodes(chart.rootElement);
    const listeners = h.ledger().reachable();
    const before = padding(chart);
    const plugin = navigatorPlugin();
    const dispose = installPlugin(chart, plugin);
    dispose();
    expect(countNodes(chart.rootElement)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(listeners);
    expect(padding(chart)).toBe(before);
    expect(() => plugin.refresh()).not.toThrow();
    chart.setViewport({ xMin: 1, xMax: 5 });
    chart.start();
    expect(() => h.raf.flush()).not.toThrow();
    chart.dispose();
  });

  it("leaves no DOM or reachable listeners after repeated install/dispose cycles", () => {
    const nodes = countNodes(document.body);
    for (let i = 0; i < 5; i++) make().chart.dispose();
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(0);
  });
});

describe("navigatorPlugin overview", () => {
  const pathOf = (chart: Chart, index = 0): string => rootOf(chart).querySelectorAll("path")[index]!.getAttribute("d")!;
  /** Y coordinates (svg space, 55 = bottom of a 56px track) of every vertex in a path. */
  const ys = (d: string): number[] => [...d.matchAll(/[ML] [\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]));

  /** happy-dom reports a zero-width track, so give this navigator the 400px the other stubs describe. */
  const track = (chart: Chart): void => {
    Object.defineProperty(rootOf(chart), "clientWidth", { configurable: true, value: 400 });
  };

  it("keeps a series whose first or last sample is a gap", () => {
    const { chart, plugin } = make({}, false);
    const series = chart.addLine({ capacity: 64 });
    series.append({ x: [0, 1, 2, 3, 4, 5], y: [NaN, 1, 5, 2, 4, NaN] });
    plugin.refresh();
    const root = rootOf(chart);
    expect(root.style.display).toBe("block");
    expect(num(root, "aria-valuemin")).toBe(1);
    expect(num(root, "aria-valuemax")).toBe(4);
    expect(pathOf(chart).startsWith("M ")).toBe(true);
    chart.dispose();
  });

  it("includes an isolated spike in the Y domain and the dense overview", () => {
    const { chart, plugin } = make({}, false);
    const n = 20_000;
    const series = chart.addLine({ capacity: n });
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = i;
    y[12_345] = 100;
    series.append({ x, y });
    track(chart);
    plugin.refresh();
    const d = pathOf(chart);
    expect(d.endsWith("Z")).toBe(true);
    // The spike reaches the top of the track (y = 0) while the baseline sits at the bottom (y = 55).
    expect(Math.min(...ys(d))).toBeCloseTo(0, 5);
    expect(Math.max(...ys(d))).toBe(55);
    const path = rootOf(chart).querySelector("path")!;
    expect(path.getAttribute("fill-opacity")).toBe("0.35");
    chart.dispose();
  });

  it("breaks the envelope across X gaps and the polyline across Y gaps", () => {
    const { chart, plugin } = make({}, false);
    const n = 4000;
    const series = chart.addLine({ capacity: n });
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i < n / 2 ? i : i + 4000;
      y[i] = i % 7;
    }
    series.append({ x, y });
    track(chart);
    plugin.refresh();
    expect(pathOf(chart).match(/M /g)!.length).toBeGreaterThanOrEqual(2);
    chart.dispose();

    const sparse = make({}, false);
    const line = sparse.chart.addLine({ capacity: 8 });
    line.append({ x: [0, 1, 2, 3, 4], y: [1, 2, NaN, 3, 4] });
    track(sparse.chart);
    sparse.plugin.refresh();
    expect(pathOf(sparse.chart).match(/M /g)).toHaveLength(2);
    sparse.chart.dispose();
  });

  it("refreshes a 1M-point overview quickly and reuses it for viewport-only renders", () => {
    const { chart, plugin } = make({}, false);
    const n = 1_000_000;
    const series = chart.addLine({ capacity: n });
    const x = new Float64Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i;
      y[i] = Math.sin(i / 1000);
    }
    series.append({ x, y });
    track(chart);
    plugin.refresh();

    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      plugin.refresh();
      best = Math.min(best, performance.now() - start);
    }
    // Typically ~1 ms; the bound leaves headroom for loaded CI runners and coverage instrumentation.
    expect(best).toBeLessThan(5);

    const before = pathOf(chart);
    chart.setViewport({ xMin: 1000, xMax: 5000 });
    expect(pathOf(chart)).toBe(before);
    chart.dispose();
  });
});
