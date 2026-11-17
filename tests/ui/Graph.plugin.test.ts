import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { graphPlugin } from "../../src/plugins/graph.ts";
import type { GraphNode, GraphPluginOptions } from "../../src/plugins/graph.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { itRecorded } from "./engines.ts";
import type { RecordingRenderer } from "./fakes.ts";
import { fire, keyEvent, pointerEvent, useChartHarness, wheelEvent } from "./harness.ts";

const h = useChartHarness();

/** What the label layer drew, through its own 2D context. */
const drawn: string[] = [];
let canvasProto: { getContext: unknown };
let originalGetContext: unknown;

beforeAll(() => {
  canvasProto = window.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  originalGetContext = canvasProto.getContext;
  canvasProto.getContext = function (this: HTMLCanvasElement, type: string): unknown {
    if (type === "2d" && this.classList.contains("blazeplot-graph-labels")) {
      return new Proxy(
        {
          canvas: this,
          measureText: (text: string) => ({ width: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
          fillText: (text: string) => void drawn.push(text),
        },
        {
          get: (target, key) => (key in target ? target[key as keyof typeof target] : () => {}),
          set: () => true,
        },
      );
    }
    return (originalGetContext as (this: HTMLCanvasElement, type: string) => unknown).call(this, type);
  };
});
afterAll(() => {
  canvasProto.getContext = originalGetContext;
});
beforeEach(() => {
  drawn.length = 0;
});

const NODES: GraphNode[] = [
  { id: "a", x: 0, y: 0, label: "Alpha" },
  { id: "b", x: 200, y: 0, label: "Beta" },
  { id: "c", x: 100, y: 100, label: "Gamma" },
];
const EDGES = [
  { source: "a", target: "b", label: "1 MB/s" },
  { source: "b", target: "c" },
];

function make(options: GraphPluginOptions = {}): { chart: Chart; plugin: ReturnType<typeof graphPlugin> } {
  const plugin = graphPlugin({ nodes: NODES, edges: EDGES, nodeStyle: { width: 40 }, fitOnLoad: { padding: 20 }, ...options });
  const chart = h.make({ plugins: [plugin], axes: false, grid: false });
  return { chart, plugin };
}

/** Run one animation frame 16 ms after the last, on a clock the test owns. */
let clock = 0;
const tick = (): void => {
  const original = performance.now;
  clock += 16;
  performance.now = () => clock;
  try {
    h.raf.flush();
  } finally {
    performance.now = original;
  }
};
const engineOf = (): RecordingRenderer => h.backends().at(-1)!;
const surfaceDraws = (method: string): number[] => engineOf().surfaces[0]!.draws.filter((d) => d.method === method).map((d) => d.count);
/** The plot surface: the chart canvas, which receives input and carries the plugin's attributes. */
const plot = (chart: Chart): HTMLElement => chartInternals(chart).canvas;
const layers = (chart: Chart): HTMLElement => chartInternals(chart).plotElement;
const frame = (chart: Chart): void => {
  chart.start();
  h.raf.flush();
};
/** Plot point (CSS px) of a node, on the harness's 400 x 200 plot at the client origin. */
const at = (plugin: ReturnType<typeof graphPlugin>, id: string): [number, number] => plugin.nodeToPlot(id)!;

describe("graphPlugin", () => {
  it("mounts its layers and an accessible, focusable plot, and fits the graph with one zoom for both axes", () => {
    const { chart, plugin } = make();
    expect(layers(chart).querySelector(".blazeplot-graph-shapes")).not.toBeNull();
    expect(layers(chart).querySelector(".blazeplot-graph-labels")).not.toBeNull();
    expect(plot(chart).getAttribute("tabindex")).toBe("0");
    expect(plot(chart).getAttribute("aria-roledescription")).toBe("graph");
    frame(chart);
    const view = plugin.getView();
    // 240 x 140 graph units (with node boxes) in a 360 x 160 padded area: height decides.
    expect(view.zoom).toBeCloseTo(160 / 140, 5);
    expect([view.centerX, view.centerY]).toEqual([100, 50]);
    const viewport = chart.getViewport();
    expect((viewport.xMax - viewport.xMin) / (viewport.yMax - viewport.yMin)).toBeCloseTo(2, 5);
    chart.dispose();
    expect(layers(chart).querySelector(".blazeplot-graph-shapes")).toBeNull();
  });

  itRecorded("draws every node in one shape call and every edge in one segment call, with arrows as triangles", () => {
    const { chart } = make({ edgeStyle: { arrow: "end" } });
    frame(chart);
    expect(surfaceDraws("fillShapes").at(-1)).toBe(3);
    expect(surfaceDraws("strokeSegments").at(-1)).toBe(2);
    expect(surfaceDraws("fillTriangles").at(-1)).toBe(6);
    expect(drawn).toEqual(expect.arrayContaining(["Alpha", "Beta", "Gamma", "1 MB/s"]));
    chart.dispose();
  });

  it("calls node and background clicks, and drags a draggable node", () => {
    const clicks: string[] = [];
    const ends: Array<[string, number, number]> = [];
    const { chart, plugin } = make({
      draggable: (node) => node.id !== "c",
      onNodeClick: (node) => clicks.push(node.id),
      onBackgroundClick: () => clicks.push("background"),
      onNodeDragEnd: (node, x, y) => ends.push([node.id, Math.round(x), Math.round(y)]),
    });
    frame(chart);
    const [ax, ay] = at(plugin, "a");
    fire(plot(chart), pointerEvent("pointerdown", ax, ay));
    fire(plot(chart), pointerEvent("pointerup", ax, ay));
    fire(plot(chart), pointerEvent("pointerdown", 5, 195));
    fire(plot(chart), pointerEvent("pointerup", 5, 195));
    expect(clicks).toEqual(["a", "background"]);

    const zoom = plugin.getView().zoom;
    fire(plot(chart), pointerEvent("pointerdown", ax, ay));
    fire(plot(chart), pointerEvent("pointermove", ax + 20, ay + 10));
    fire(plot(chart), pointerEvent("pointermove", ax + 40, ay + 20));
    fire(plot(chart), pointerEvent("pointerup", ax + 40, ay + 20));
    expect(ends).toEqual([["a", Math.round(40 / zoom), Math.round(20 / zoom)]]);
    expect(clicks).toEqual(["a", "background"]);
    chart.dispose();
  });

  it("pans by dragging the background and zooms around the pointer with the wheel", () => {
    const views: number[] = [];
    const { chart, plugin } = make({ onViewChange: (view) => views.push(view.zoom) });
    frame(chart);
    const before = plugin.getView();
    fire(plot(chart), pointerEvent("pointerdown", 10, 190));
    fire(plot(chart), pointerEvent("pointermove", 30, 190));
    fire(plot(chart), pointerEvent("pointermove", 60, 190));
    fire(plot(chart), pointerEvent("pointerup", 60, 190));
    expect(plugin.getView().centerX).toBeCloseTo(before.centerX - 50 / before.zoom, 5);

    const [bx, by] = at(plugin, "b");
    fire(plot(chart), wheelEvent(bx, by, { deltaY: -100 }));
    expect(plugin.getView().zoom).toBeGreaterThan(before.zoom);
    // The node under the pointer stays under it.
    const [nx, ny] = at(plugin, "b");
    expect(nx).toBeCloseTo(bx, 3);
    expect(ny).toBeCloseTo(by, 3);
    expect(views.length).toBeGreaterThan(1);
    chart.dispose();
  });

  it("moves keyboard focus between nodes, announces them, and opens the focused one", () => {
    const clicks: string[] = [];
    const { chart, plugin } = make({ onNodeClick: (node) => clicks.push(node.id), messages: { describeNode: (node) => `${node.label} node` } });
    frame(chart);
    const live = h.target().querySelector("[aria-live]")!;
    fire(plot(chart), keyEvent("ArrowRight"));
    expect(live.textContent).toBe("Gamma node");
    fire(plot(chart), keyEvent("ArrowRight"));
    expect(live.textContent).toBe("Beta node");
    fire(plot(chart), keyEvent("Enter"));
    expect(clicks).toEqual(["b"]);
    plugin.focusNode("a");
    expect(live.textContent).toBe("Alpha node");
    chart.dispose();
  });

  it("restyles only what changed state, and keeps state on ids across setGraph", () => {
    const calls: string[] = [];
    const { chart, plugin } = make({
      nodeStyle: (node, state) => {
        calls.push(node.id);
        return { width: 40, fill: state.hovered ? "#ff0000" : "#00ff00" };
      },
    });
    frame(chart);
    calls.length = 0;
    const [cx, cy] = at(plugin, "c");
    fire(plot(chart), pointerEvent("pointermove", cx, cy));
    expect(calls).toEqual(["c"]);
    expect(plugin.pick(cx, cy)).toEqual({ kind: "node", node: NODES[2]! });

    plugin.focusNode("b");
    const result = plugin.setGraph([...NODES, { id: "d", x: 300, y: 300 }], [...EDGES, { source: "c", target: "zz" }]);
    expect(result).toEqual({ nodes: 4, edges: 2, skippedEdges: 1 });
    expect(() => plugin.setGraph([{ id: "x", x: Number.POSITIVE_INFINITY, y: 0 }], [])).toThrow(RangeError);
    chart.dispose();
  });

  it("enforces its limits and survives renderers that throw", () => {
    expect(() => graphPlugin({ nodes: NODES, limits: { maxNodes: 2 } })).toThrow(RangeError);
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const { chart } = make({
        drawNode: () => {
          throw new Error("boom");
        },
      });
      frame(chart);
      expect(errors).toHaveLength(1);
      chart.dispose();
    } finally {
      console.error = original;
    }
  });
});

describe("graphPlugin view and selection API", () => {
  it("fits some nodes, zooms, sets the view, and animates when asked", () => {
    const { chart, plugin } = make({ minZoom: 0.5, maxZoom: 4 });
    frame(chart);
    plugin.fit({ nodes: ["c"], padding: { top: 10, bottom: 10 }, maxZoom: 3 });
    expect(plugin.getView()).toEqual({ centerX: 100, centerY: 100, zoom: 3 });
    plugin.zoomBy(10);
    expect(plugin.getView().zoom).toBe(4);
    plugin.zoomBy(Number.NaN);
    plugin.setView({ centerX: 5, zoom: 0.01 });
    expect(plugin.getView()).toEqual({ centerX: 5, centerY: 100, zoom: 0.5 });
    plugin.setView({ centerY: Number.NaN, zoom: -1 });
    expect(plugin.getView()).toEqual({ centerX: 5, centerY: 100, zoom: 0.5 });

    plugin.setView({ centerX: 50, centerY: 50, zoom: 2 }, { duration: 100 });
    // Animated: nothing moves until frames run, then it lands exactly.
    expect(plugin.getView().zoom).toBe(0.5);
    for (let i = 0; i < 20; i++) tick();
    expect(plugin.getView()).toEqual({ centerX: 50, centerY: 50, zoom: 2 });
    expect(plugin.nodeToPlot("missing")).toBeNull();
    chart.dispose();
  });

  itRecorded("selects nodes and edges, hovers and clicks pickable edges, and moves nodes by id", () => {
    const hovered: Array<string | null> = [];
    const clicked: string[] = [];
    const { chart, plugin } = make({
      edgeStyle: (_edge, state) => ({ width: state.hovered || state.selected ? 3 : 1, curvature: 0 }),
      onEdgeHover: (edge) => hovered.push(edge ? `${edge.source}${edge.target}` : null),
      onEdgeClick: (edge) => clicked.push(`${edge.source}${edge.target}`),
    });
    frame(chart);
    const [ax, ay] = at(plugin, "a");
    const [bx] = at(plugin, "b");
    const mid: [number, number] = [(ax + bx) / 2, ay];
    fire(plot(chart), pointerEvent("pointermove", ...mid));
    expect(hovered).toEqual(["ab"]);
    expect(plugin.pick(...mid)).toEqual({ kind: "edge", edge: EDGES[0]! });
    fire(plot(chart), pointerEvent("pointerdown", ...mid));
    fire(plot(chart), pointerEvent("pointerup", ...mid));
    expect(clicked).toEqual(["ab"]);
    fire(plot(chart), pointerEvent("pointerleave", ...mid));
    expect(hovered).toEqual(["ab", null]);

    plugin.select({ node: "c", edge: "b->c" });
    plugin.select(null);
    plugin.setPositions({ a: { x: 50, y: 50 }, zz: { x: 0, y: 0 } });
    expect(plugin.nodeToPlot("a")).not.toEqual([ax, ay]);
    expect(() => plugin.setPositions({ a: { x: Number.NaN, y: 0 } })).toThrow(RangeError);
    plugin.setPositions({});
    plugin.restyle();
    h.raf.flush();
    expect(engineOf().surfaces[0]!.draws.length).toBeGreaterThan(0);
    chart.dispose();
  });

  it("keeps a node under the pointer when setGraph lands mid-drag, and ends the drag on cancel", () => {
    const ends: string[] = [];
    const { chart, plugin } = make({ draggable: true, onNodeDragEnd: (node) => ends.push(node.id) });
    frame(chart);
    const [ax, ay] = at(plugin, "a");
    fire(plot(chart), pointerEvent("pointerdown", ax, ay));
    fire(plot(chart), pointerEvent("pointermove", ax + 30, ay));
    const moved = plugin.nodeToPlot("a")!;
    plugin.setGraph(NODES, EDGES);
    expect(plugin.nodeToPlot("a")).toEqual(moved);
    fire(plot(chart), pointerEvent("pointercancel", ax + 30, ay));
    expect(ends).toEqual(["a"]);
    // A drag whose node disappears ends quietly.
    fire(plot(chart), pointerEvent("pointerdown", ax + 30, ay));
    fire(plot(chart), pointerEvent("pointermove", ax + 60, ay));
    plugin.setGraph(NODES.slice(1), []);
    fire(plot(chart), pointerEvent("pointerup", ax + 60, ay));
    expect(ends).toEqual(["a"]);
    chart.dispose();
  });

  it("pinches to zoom, double-clicks to zoom, and handles the keyboard's zoom, pan, fit, and escape", () => {
    const focus: Array<string | null> = [];
    const { chart, plugin } = make({ onNodeFocus: (node) => focus.push(node?.id ?? null) });
    frame(chart);
    const start = plugin.getView().zoom;
    fire(plot(chart), pointerEvent("pointerdown", 100, 150, { pointerId: 1, pointerType: "touch" }));
    fire(plot(chart), pointerEvent("pointerdown", 140, 150, { pointerId: 2, pointerType: "touch" }));
    fire(plot(chart), pointerEvent("pointermove", 180, 150, { pointerId: 2, pointerType: "touch" }));
    expect(plugin.getView().zoom).toBeCloseTo(start * 2, 5);
    fire(plot(chart), pointerEvent("pointerup", 100, 150, { pointerId: 1, pointerType: "touch" }));
    fire(plot(chart), pointerEvent("pointerup", 180, 150, { pointerId: 2, pointerType: "touch" }));

    const zoom = plugin.getView().zoom;
    fire(plot(chart), new window.MouseEvent("dblclick", { bubbles: true, clientX: 5, clientY: 195 }));
    expect(plugin.getView().zoom).toBeCloseTo(Math.min(8, zoom * 2), 5);
    fire(plot(chart), new window.MouseEvent("dblclick", { bubbles: true, clientX: 5, clientY: 195, shiftKey: true }));
    expect(plugin.getView().zoom).toBeCloseTo(zoom, 5);

    const before = plugin.getView();
    fire(plot(chart), keyEvent("ArrowLeft", { shiftKey: true }));
    expect(plugin.getView().centerX).toBeLessThan(before.centerX);
    fire(plot(chart), keyEvent("+"));
    fire(plot(chart), keyEvent("-"));
    fire(plot(chart), keyEvent("0"));
    for (let i = 0; i < 30; i++) tick();
    expect(plugin.getView().zoom).toBeCloseTo(start, 5);
    fire(plot(chart), keyEvent("ArrowDown"));
    fire(plot(chart), keyEvent("Escape"));
    fire(plot(chart), keyEvent("x", { ctrlKey: true }));
    expect(focus).toEqual(["c", null]);
    // Focus with nothing focused announces the instructions.
    fire(plot(chart), new window.FocusEvent("focus"));
    expect(h.target().querySelector("[aria-live]")!.textContent).toContain("Arrow keys");
    chart.dispose();
  });

  it("follows outside viewport changes, resizes, and theme changes, and stays off when navigation is off", () => {
    const { chart, plugin } = make({ navigation: false, background: { kind: "grid" }, layer: undefined } as GraphPluginOptions);
    frame(chart);
    chart.setViewport({ xMin: 0, xMax: 400, yMin: -200, yMax: 0 });
    expect(plugin.getView()).toEqual({ centerX: 200, centerY: 100, zoom: 1 });
    const view = plugin.getView();
    fire(plot(chart), wheelEvent(100, 100, { deltaY: -100 }));
    fire(plot(chart), pointerEvent("pointerdown", 5, 195));
    fire(plot(chart), pointerEvent("pointermove", 60, 195));
    fire(plot(chart), pointerEvent("pointerup", 60, 195));
    expect(plugin.getView()).toEqual(view);
    chart.setTheme({ axisColor: "#123456" });
    chart.resize();
    h.raf.flush();
    chart.dispose();
  });

  it("draws nodes in layer order and picks the top one", () => {
    const { chart, plugin } = make({
      nodes: [
        { id: "under", x: 0, y: 0 },
        { id: "over", x: 0, y: 0 },
      ],
      edges: [],
      nodeStyle: (node) => ({ width: 40, shape: "rect", cornerRadius: 6, layer: node.id === "over" ? 0 : 1, ring: { color: "#fff" } }),
    });
    frame(chart);
    const [x, y] = at(plugin, "under");
    expect(plugin.pick(x, y)).toEqual({ kind: "node", node: { id: "under", x: 0, y: 0 } });
    chart.dispose();
  });
});

describe("createGraphIcon", () => {
  it("strokes or fills its paths scaled to the requested size", async () => {
    const { createGraphIcon } = await import("../../src/plugins/graph.ts");
    const calls: string[] = [];
    const globals = globalThis as { Path2D?: unknown };
    const original = globals.Path2D;
    globals.Path2D = class {
      constructor(readonly d: string) {}
    };
    try {
      const ctx = new Proxy({} as CanvasRenderingContext2D, { get: (_t, key) => (...args: unknown[]) => void calls.push(`${String(key)}${args.length ? `:${args.length}` : ""}`), set: () => true });
      createGraphIcon(["M0 0L24 24", "M24 0L0 24"])(ctx, 10, 10, 12, "red");
      createGraphIcon(["M0 0h8v8z"], { mode: "fill", viewBox: 8 })(ctx, 0, 0, 16, "blue");
      createGraphIcon(["M0 0"])(ctx, 0, 0, 0, "red");
      expect(calls.filter((c) => c.startsWith("stroke"))).toHaveLength(2);
      expect(calls.filter((c) => c.startsWith("fill"))).toHaveLength(1);
      expect(calls.filter((c) => c.startsWith("scale"))).toHaveLength(2);
    } finally {
      globals.Path2D = original;
    }
  });
});
