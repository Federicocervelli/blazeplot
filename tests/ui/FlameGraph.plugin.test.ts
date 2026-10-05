import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { flameGraphPlugin } from "../../src/plugins/flamegraph.ts";
import { buildFlameGraphModel } from "../../src/ui/FlameGraph.ts";
import type { FlameGraphPick, FlameGraphPluginOptions } from "../../src/plugins/flamegraph.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import { countNodes, FakeResizeObserver } from "./fakes.ts";
import type { RecordingRenderer } from "./fakes.ts";
import { describeRecorded, itRecorded, uiEngine } from "./engines.ts";
import { fire, installPlugin, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

/** Text the label layer drew; its 2D context is the plugin's own, not the chart engine's. */
const labels: string[] = [];
let canvasProto: { getContext: unknown };
let originalGetContext: unknown;

beforeAll(() => {
  canvasProto = window.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  originalGetContext = canvasProto.getContext;
  // The label layer draws text through its own 2D context; any other context request goes to the harness's engine doubles.
  canvasProto.getContext = function (this: HTMLCanvasElement, type: string): unknown {
    if (type === "2d" && this.classList.contains("blazeplot-flamegraph-labels")) {
      return {
        measureText: (text: string) => ({ width: text.length * 6 }),
        fillText: (text: string) => { labels.push(text); },
        clearRect() {},
        save() {},
        restore() {},
        scale() {},
        set font(_value: string) {},
        set fillStyle(_value: string) {},
        set textBaseline(_value: string) {},
      };
    }
    return (originalGetContext as (this: HTMLCanvasElement, type: string) => unknown).call(this, type);
  };
});
afterAll(() => {
  canvasProto.getContext = originalGetContext;
});
beforeEach(() => {
  labels.length = 0;
});

const FOLDED = "root;a 6\nroot;b 4";

function make(options: FlameGraphPluginOptions = {}): { chart: Chart; plugin: ReturnType<typeof flameGraphPlugin> } {
  const plugin = flameGraphPlugin({ foldedStacks: FOLDED, ...options });
  const chart = h.make({ plugins: [plugin] });
  return { chart, plugin };
}

const rectCanvas = (chart: Chart): HTMLCanvasElement => chart.plotElement.querySelector(".blazeplot-flamegraph-canvas") as HTMLCanvasElement;
/** The recording engine of the chart under test (the last one the harness built). */
const engineOf = (): RecordingRenderer => h.backends().at(-1)!;
/** What the flame graph asked its render surface to draw. */
const rectDraws = (): number => engineOf().surfaces[0]!.draws.filter((d) => d.method === "fillRects").length;
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

  itRecorded("draws one rectangle per visible frame through the chart's engine and labels the wide ones", () => {
    const { chart } = make();
    frame(chart);
    expect(engineOf().surfaces).toHaveLength(1);
    const draw = engineOf().surfaces[0]!.draws.filter((d) => d.method === "fillRects").at(-1)!;
    expect(draw.count).toBe(3);
    expect(labels).toEqual(expect.arrayContaining(["root", "a", "b"]));
    chart.dispose();
  });

  itRecorded("re-renders only when something it depends on changes", () => {
    const { chart, plugin } = make();
    frame(chart);
    const before = rectDraws();
    chart.requestRender();
    h.raf.flush();
    expect(rectDraws()).toBe(before);
    plugin.setSearch("a");
    h.raf.flush();
    expect(rectDraws()).toBeGreaterThan(before);
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
    if (uiEngine === "fake") expect(rectDraws()).toBeGreaterThan(0);
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

  itRecorded("highlights search matches and accepts regular expressions and null", () => {
    const { chart, plugin } = make({ search: "a" });
    frame(chart);
    const highlight = [0.9, 0.05, 0.75, 0.95].map(Math.fround);
    // Each rectangle is x, y, width, height, then its RGBA color.
    const fills = (): Float32Array[] => engineOf().surfaces[0]!.rectFills;
    const hasHighlight = (fill: Float32Array): boolean => {
      for (let i = 0; i < fill.length; i += 8) if (highlight.every((v, k) => fill[i + 4 + k] === v)) return true;
      return false;
    };
    expect(fills().some(hasHighlight)).toBe(true);

    const before = fills().length;
    plugin.setSearch(/^zzz$/);
    h.raf.flush();
    expect(fills().length).toBeGreaterThan(before);
    expect(fills().slice(before).some(hasHighlight)).toBe(false);
    plugin.setSearch(null);
    h.raf.flush();
    chart.dispose();
  });
});

describeRecorded("flameGraphPlugin context handling", () => {
  it("draws nothing while its surface is lost and redraws once it is restored", () => {
    const { chart } = make();
    frame(chart);
    const surface = engineOf().surfaces[0]!;
    const before = rectDraws();

    surface.lose();
    chart.requestRender();
    h.raf.flush();
    expect(rectDraws()).toBe(before);

    surface.restore();
    h.raf.flush();
    expect(rectDraws()).toBeGreaterThan(before);
    chart.dispose();
  });

  it("follows the chart's engine and leaves nothing behind when the chart is disposed", () => {
    const { chart } = make();
    frame(chart);
    const surface = engineOf().surfaces[0]!;
    expect(surface.info.name).toBe("webgl2");
    chart.dispose();
    expect(surface.disposeCount).toBe(1);
    expect(h.target().children).toHaveLength(0);
    expect(h.ledger().reachable()).toBe(0);
  });
});

describe("flameGraphPlugin lifecycle", () => {
  it("removes its DOM, listeners, render surface, and pending frames when disposed alone", () => {
    const chart = h.make();
    const nodes = countNodes(document.body);
    const listeners = h.ledger().reachable();
    const plugin = flameGraphPlugin({ foldedStacks: FOLDED });
    const dispose = installPlugin(chart, plugin);
    plugin.setSearch("x");
    expect(h.raf.pending.size).toBeGreaterThan(0);
    dispose();
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(listeners);
    expect(h.raf.pending.size).toBe(0);
    if (h.backends().length > 0 && h.backends()[0]!.surfaces.length > 0) expect(h.backends()[0]!.surfaces[0]!.disposeCount).toBe(1);
    // Disposing again, or after the chart is gone, is harmless.
    expect(() => plugin.dispose()).not.toThrow();
    chart.dispose();
  });

  itRecorded("redraws through the chart's onResize hook instead of its own ResizeObserver", () => {
    const observers = FakeResizeObserver.instances.length;
    const { chart } = make();
    expect(FakeResizeObserver.instances.length).toBe(observers + 1); // the chart's own observer only
    frame(chart);
    h.raf.flush();
    const canvas = rectCanvas(chart);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(chart.canvas, "clientWidth", { configurable: true, value: 300 });
    const drawsBefore = rectDraws();
    chart.resize(1);
    h.raf.flush();
    expect(canvas.width).toBe(300);
    expect(rectDraws()).toBeGreaterThan(drawsBefore);
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
