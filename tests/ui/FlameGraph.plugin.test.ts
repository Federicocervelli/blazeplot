import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { flameGraphPlugin } from "../../src/plugins/flamegraph.ts";
import { buildFlameGraphModel } from "../../src/ui/FlameGraph.ts";
import type { FlameGraphPick, FlameGraphPluginOptions } from "../../src/plugins/flamegraph.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import { countNodes, FakeResizeObserver } from "./fakes.ts";
import { fire, installPlugin, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

interface Call {
  readonly name: string;
  readonly args: unknown[];
}

/** Records every method call; WebGL enum names resolve to a number and info queries succeed. */
function recordingContext(canvas: HTMLCanvasElement, extra: Record<string, unknown> = {}): { ctx: unknown; calls: Call[] } {
  const calls: Call[] = [];
  const base: Record<string, unknown> = {
    canvas,
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getAttribLocation: () => 0,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    ...extra,
  };
  const ctx = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop in target) return target[prop];
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return 1;
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return {};
      };
    },
  });
  return { ctx, calls };
}

const gls = new WeakMap<HTMLCanvasElement, { ctx: unknown; calls: Call[] }>();
const labels: string[] = [];
let webgl2 = true;
let canvasProto: { getContext: unknown };
let originalGetContext: unknown;

beforeAll(() => {
  canvasProto = window.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  originalGetContext = canvasProto.getContext;
  canvasProto.getContext = function (this: HTMLCanvasElement, type: string): unknown {
    if (type === "webgl2") {
      if (!webgl2) return null;
      let entry = gls.get(this);
      if (!entry) gls.set(this, (entry = recordingContext(this)));
      return entry.ctx;
    }
    if (type === "2d") {
      return recordingContext(this, {
        measureText: (text: string) => ({ width: text.length * 6 }),
        fillText: (text: string) => { labels.push(text); },
      }).ctx;
    }
    return null;
  };
});
afterAll(() => {
  canvasProto.getContext = originalGetContext;
});
beforeEach(() => {
  webgl2 = true;
  labels.length = 0;
});

const FOLDED = "root;a 6\nroot;b 4";

function make(options: FlameGraphPluginOptions = {}): { chart: Chart; plugin: ReturnType<typeof flameGraphPlugin> } {
  const plugin = flameGraphPlugin({ foldedStacks: FOLDED, ...options });
  const chart = h.make({ plugins: [plugin] });
  return { chart, plugin };
}

const rectCanvas = (chart: Chart): HTMLCanvasElement => chart.plotElement.querySelector(".blazeplot-flamegraph-canvas") as HTMLCanvasElement;
const glCalls = (chart: Chart): Call[] => gls.get(rectCanvas(chart))!.calls;
const tooltip = (): HTMLElement | null => document.body.querySelector(".blazeplot-flamegraph-tooltip");
const frame = (chart: Chart): void => {
  chart.start();
  h.raf.flush();
};

describe("flameGraphPlugin install and rendering", () => {
  it("mounts its canvases, hover marker, and tooltip and fits the viewport to the model", () => {
    const { chart } = make();
    expect(chart.plotElement.querySelector(".blazeplot-flamegraph-labels")).not.toBeNull();
    expect(chart.plotElement.querySelector(".blazeplot-flamegraph-hover")).not.toBeNull();
    const tip = tooltip()!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(tip.parentElement).toBe(document.body);
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 10, yMin: 0, yMax: 2 });
    chart.dispose();
  });

  it("draws one instance per visible frame and labels the wide ones", () => {
    const { chart } = make();
    frame(chart);
    const draw = glCalls(chart).filter((c) => c.name === "drawArraysInstanced").at(-1)!;
    expect(draw.args.at(-1)).toBe(3);
    expect(labels).toEqual(expect.arrayContaining(["root", "a", "b"]));
    chart.dispose();
  });

  it("re-renders only when something it depends on changes", () => {
    const { chart, plugin } = make();
    frame(chart);
    const draws = (): number => glCalls(chart).filter((c) => c.name === "drawArraysInstanced").length;
    const before = draws();
    chart.requestRender();
    h.raf.flush();
    expect(draws()).toBe(before);
    plugin.setSearch("a");
    h.raf.flush();
    expect(draws()).toBeGreaterThan(before);
    chart.dispose();
  });

  it("skips auto-fit when autoFit is false and fits on demand", () => {
    const { chart, plugin } = make({ autoFit: false });
    expect(chart.getViewport()).not.toEqual({ xMin: 0, xMax: 10, yMin: 0, yMax: 2 });
    plugin.fitToData();
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 10, yMin: 0, yMax: 2 });
    chart.dispose();
  });

  it("swaps models from folded stacks, status spans, or a prebuilt model and refits", () => {
    const { chart, plugin } = make();
    plugin.setFoldedStacks("x;y;z 3");
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 3, yMin: 0, yMax: 3 });
    plugin.setStatusSpans([{ name: "up", start: 10, end: 20 }, { name: "down", start: 20, end: 40, depth: 1 }]);
    expect(chart.getViewport()).toEqual({ xMin: 10, xMax: 40, yMin: 0, yMax: 2 });
    plugin.setModel(buildFlameGraphModel("p 5"));
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 5, yMin: 0, yMax: 1 });
    frame(chart);
    expect(glCalls(chart).some((c) => c.name === "drawArraysInstanced")).toBe(true);
    chart.dispose();
  });

  it("initializes from a model or status spans, and renders an empty plugin", () => {
    const model = buildFlameGraphModel("q;r 2");
    const m = make({ foldedStacks: undefined, model });
    expect(m.chart.getViewport().xMax).toBe(2);
    m.chart.dispose();

    const s = make({ foldedStacks: undefined, statusSpans: [{ name: "ok", start: 0, end: 4 }] });
    expect(s.chart.getViewport().xMax).toBe(4);
    s.chart.dispose();

    const empty = make({ foldedStacks: undefined });
    expect(() => frame(empty.chart)).not.toThrow();
    empty.chart.dispose();
  });

  it("refreshes tooltip colors on theme change", () => {
    const { chart } = make();
    chart.setTheme({ tooltipBackgroundColor: "rgb(1, 2, 3)" });
    expect(tooltip()!.style.background).toBe("rgb(1, 2, 3)");
    chart.dispose();
  });

  it("omits the tooltip and hover marker when disabled", () => {
    const { chart } = make({ tooltip: false, hoverHighlight: false });
    expect(tooltip()).toBeNull();
    expect(chart.plotElement.querySelector(".blazeplot-flamegraph-hover")).toBeNull();
    fire(chart.canvas, pointerEvent("pointermove", 100, 50));
    chart.dispose();
  });
});

describe("flameGraphPlugin picking and pointer events", () => {
  it("picks frames by client point and reports their share of the total", () => {
    const { chart, plugin } = make();
    const a = plugin.pick(100, 50)!;
    expect(a.frame.name).toBe("a");
    expect(a.percent).toBeCloseTo(0.6, 8);
    expect(a.dataX).toBeCloseTo(2.5, 8);
    expect(plugin.pick(300, 50)!.frame.name).toBe("b");
    expect(plugin.pick(100, 150)!.frame.name).toBe("root");
    expect(plugin.pick(-5, 50)).toBeNull();
    expect(plugin.pick(100, 500)).toBeNull();
    chart.dispose();
    expect(plugin.pick(100, 50)).toBeNull();
  });

  it("flips depth when inverted", () => {
    const { chart, plugin } = make({ inverted: true });
    expect(plugin.pick(100, 50)!.frame.name).toBe("root");
    expect(plugin.pick(100, 150)!.frame.name).toBe("a");
    chart.dispose();
  });

  it("shows the tooltip and hover marker over a frame and hides them on leave", () => {
    const hovered: Array<FlameGraphPick | null> = [];
    const { chart } = make({ onFrameHover: (p) => hovered.push(p) });
    frame(chart);
    fire(chart.canvas, pointerEvent("pointermove", 100, 50));
    const tip = tooltip()!;
    expect(tip.style.display).toBe("block");
    expect(tip.getAttribute("aria-hidden")).toBe("false");
    expect(tip.textContent).toBe("a\n6 samples (60.00%)");
    expect(hovered.at(-1)!.frame.name).toBe("a");
    const marker = chart.plotElement.querySelector(".blazeplot-flamegraph-hover") as HTMLElement;
    expect(marker.style.display).toBe("block");
    expect(marker.style.width).toBe("240px");

    fire(chart.canvas, pointerEvent("pointerleave", 100, 50));
    expect(tip.style.display).toBe("none");
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(marker.style.display).toBe("none");
    expect(hovered.at(-1)).toBeNull();
    chart.dispose();
  });

  it("formats the tooltip with a custom formatter", () => {
    const { chart } = make({ tooltipFormatter: (pick, model) => `${pick.frame.name}/${model.total}`, tooltipClassName: "fg-tip" });
    fire(chart.canvas, pointerEvent("pointermove", 100, 50));
    expect(document.body.querySelector(".fg-tip")!.textContent).toBe("a/10");
    chart.dispose();
  });

  it("reports clicks, but not shift-clicks, drags, or canceled gestures", () => {
    const clicks: string[] = [];
    const { chart } = make({ onFrameClick: (p) => clicks.push(p.frame.name) });
    const click = (x: number, y: number, shift = false): void => {
      fire(chart.canvas, new window.MouseEvent("click", { bubbles: true, clientX: x, clientY: y, shiftKey: shift }));
    };

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointerup", 100, 50));
    click(100, 50);
    expect(clicks).toEqual(["a"]);

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50, { shiftKey: true }));
    fire(chart.canvas, pointerEvent("pointerup", 100, 50, { shiftKey: true }));
    click(100, 50, true);
    expect(clicks).toEqual(["a"]);

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointermove", 130, 50));
    fire(chart.canvas, pointerEvent("pointerup", 130, 50));
    click(130, 50);
    expect(clicks).toEqual(["a"]);

    fire(chart.canvas, pointerEvent("pointerdown", 300, 50));
    fire(chart.canvas, pointerEvent("pointercancel", 300, 50));
    click(300, 50);
    expect(clicks).toEqual(["a"]);

    fire(chart.canvas, pointerEvent("pointerdown", 300, 50, { button: 2 }));
    click(300, 50);
    expect(clicks).toEqual(["a", "b"]);

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50, { pointerType: "touch" }));
    fire(chart.canvas, pointerEvent("pointerup", 100, 50, { pointerType: "touch" }));
    click(100, 50);
    expect(clicks).toEqual(["a", "b", "a"]);
    chart.dispose();
  });

  it("highlights search matches and accepts regular expressions and null", () => {
    const { chart, plugin } = make({ search: "a" });
    frame(chart);
    const highlight = [0.9, 0.05, 0.75, 0.95].map(Math.fround);
    // Per-frame RGBA uploads are the 12-float (3 frames x 4) buffers; bounds share that size.
    const uploads = (): number[][] => glCalls(chart).filter((c) => c.name === "bufferData" && c.args[1] instanceof Float32Array && (c.args[1] as Float32Array).length === 12).map((c) => [...(c.args[1] as Float32Array)]);
    const hasHighlight = (): boolean => uploads().some((u) => highlight.every((v, i) => [0, 4, 8].some((frameOffset) => u[frameOffset + i] === v)));
    expect(hasHighlight()).toBe(true);

    const before = uploads().length;
    plugin.setSearch(/^zzz$/);
    h.raf.flush();
    expect(uploads().length).toBeGreaterThan(before);
    const after = uploads().slice(before);
    expect(after.some((u) => highlight.every((v, i) => [0, 4, 8].some((frameOffset) => u[frameOffset + i] === v)))).toBe(false);
    plugin.setSearch(null);
    h.raf.flush();
    chart.dispose();
  });
});

describe("flameGraphPlugin WebGL context handling", () => {
  it("recreates its GL state after a context loss and restore", () => {
    const { chart } = make();
    frame(chart);
    const canvas = rectCanvas(chart);
    const programs = (): number => glCalls(chart).filter((c) => c.name === "createProgram").length;
    const lost = new window.Event("webglcontextlost", { cancelable: true });
    fire(canvas, lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(glCalls(chart).some((c) => ["deleteProgram", "deleteBuffer", "deleteVertexArray"].includes(c.name))).toBe(false); // stale objects must not be deleted after restore
    const created = programs();
    chart.requestRender();
    h.raf.flush();
    fire(canvas, new window.Event("webglcontextrestored"));
    expect(programs()).toBe(created + 1);
    chart.dispose();
  });

  it("fails installation cleanly when WebGL2 is unavailable", () => {
    webgl2 = false;
    const nodes = countNodes(document.body);
    expect(() => make()).toThrow("Flame graph plugin requires WebGL2.");
    expect(h.target().children).toHaveLength(0);
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(0);
  });
});

describe("flameGraphPlugin lifecycle", () => {
  it("removes its DOM, listeners, GL resources, and pending frames when disposed alone", () => {
    const chart = h.make();
    const nodes = countNodes(document.body);
    const listeners = h.ledger().reachable();
    const plugin = flameGraphPlugin({ foldedStacks: FOLDED });
    const dispose = installPlugin(chart, plugin);
    const canvas = rectCanvas(chart);
    const calls = gls.get(canvas)!.calls;
    plugin.setSearch("x");
    expect(h.raf.pending.size).toBeGreaterThan(0);
    const observer = FakeResizeObserver.instances.at(-1)!;
    dispose();
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(listeners);
    expect(h.raf.pending.size).toBe(0);
    expect(observer.disconnected).toBe(true);
    expect(calls.filter((c) => c.name === "deleteBuffer")).toHaveLength(3);
    expect(calls.some((c) => c.name === "deleteVertexArray")).toBe(true);
    expect(calls.some((c) => c.name === "deleteProgram")).toBe(true);
    // Disposing again, or after the chart is gone, is harmless.
    expect(() => plugin.dispose()).not.toThrow();
    chart.dispose();
  });

  it("is disposed with the chart", () => {
    const nodes = countNodes(document.body);
    const { chart } = make();
    frame(chart);
    chart.dispose();
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(0);
    expect(h.raf.pending.size).toBe(0);
  });
});
