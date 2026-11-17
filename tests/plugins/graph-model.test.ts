import { describe, expect, it } from "bun:test";
import { buildGraphModel } from "../../src/plugins/graph/model.ts";
import { BoxGrid, PointGrid } from "../../src/plugins/graph/grid.ts";
import { AggregateJob, buildAggregate } from "../../src/plugins/graph/aggregate.ts";
import { GraphIndex } from "../../src/plugins/graph/spatial.ts";
import { AUTO_BOW, edgeDistanceSq, edgeMiddle, exit, GraphPainter } from "../../src/plugins/graph/render.ts";
import type { GraphFrameInput, RenderSurface } from "../../src/plugins/graph/render.ts";
import { ColorCache, EDGE_FLOATS, NODE_FLOATS, writeEdgeStyle, writeNodeStyle } from "../../src/plugins/graph/styles.ts";
import type { GraphEdgeStyle, GraphNodeStyle } from "../../src/plugins/graph/types.ts";

const nodes = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 100, y: 0 },
  { id: "c", x: 0, y: 100 },
];

describe("graph model", () => {
  it("indexes nodes and edges, flags reverse pairs, and skips edges it cannot draw", () => {
    const model = buildGraphModel(nodes, [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
      { source: "a", target: "c" },
      { source: "a", target: "missing" },
      { source: "c", target: "c" },
    ]);
    expect(model.nodeIndex.get("c")).toBe(2);
    expect([0, 1, 2].map((i) => model.edgeIdOf(i))).toEqual(["a->b", "b->a", "a->c"]);
    expect(model.edgeIndexOf("b->a")).toBe(1);
    expect(model.edgeIndexOf("nope")).toBe(-1);
    expect([...model.reversed]).toEqual([1, 1, 0]);
    expect(model.skippedEdges).toBe(2);
  });

  it("rejects duplicate or empty ids, bad positions, duplicate edge ids, and graphs over the limits", () => {
    expect(() => buildGraphModel([{ id: "a", x: 0, y: 0 }, { id: "a", x: 1, y: 1 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel([{ id: "", x: 0, y: 0 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel([{ id: "a", x: Number.NaN, y: 0 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel([{ id: "a", x: 1e12, y: 0 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel(nodes, [], { maxNodes: 2 })).toThrow(/limit of 2/);
    expect(() => buildGraphModel(nodes, [{ source: "a", target: "b" }, { source: "b", target: "c" }], { maxEdges: 1 })).toThrow(/limit of 1/);
    expect(() => buildGraphModel("nope" as never, [])).toThrow(TypeError);
  });

  it("keeps the first edge of an id used twice, with a warning, when ids are first looked up", () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      const model = buildGraphModel(nodes, [{ source: "a", target: "b" }, { source: "a", target: "b" }]);
      expect(model.edgeCount).toBe(2);
      expect(model.edgeIndexOf("a->b")).toBe(0);
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = original;
    }
  });

  it("finds nodes in a rectangle through the point grid, and only nearby ones", () => {
    const count = 2500;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      x[i] = (i % 50) * 20;
      y[i] = Math.floor(i / 50) * 20;
    }
    const grid = new PointGrid();
    grid.build(count, x, y);
    const out = { data: new Uint32Array(4) };
    const n = grid.query({ minX: 395, minY: 395, maxX: 405, maxY: 405 }, out);
    expect([...out.data.subarray(0, n)]).toContain(20 * 50 + 20);
    // A small query reads a few cells, not the whole graph, and the count bounds it.
    expect(n).toBeLessThan(40);
    expect(grid.countIn({ minX: 395, minY: 395, maxX: 405, maxY: 405 })).toBe(n);
    expect(grid.query({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }, out)).toBe(count);
  });

  it("finds edges crossing a rectangle through the box grid, each once, with long edges always", () => {
    // A 40 x 25 lattice of nodes 20 apart, each joined to its right neighbor, and one edge across everything.
    const count = 1000;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      x[i] = (i % 40) * 20;
      y[i] = Math.floor(i / 40) * 20;
    }
    const source: number[] = [];
    const target: number[] = [];
    for (let i = 0; i < count; i++) {
      if (i % 40 === 39) continue;
      source.push(i);
      target.push(i + 1);
    }
    source.push(0);
    target.push(count - 1);
    const grid = new BoxGrid();
    grid.build(source.length, Uint32Array.from(source), Uint32Array.from(target), x, y, 2);
    const out = { data: new Uint32Array(2) };
    const n = grid.query({ minX: 395, minY: 195, maxX: 405, maxY: 205 }, out);
    const found = [...out.data.subarray(0, n)];
    // The edge from node 10 * 40 + 20 to its right neighbor is there; one far away is not; the long one always is.
    expect(found).toContain(source.findIndex((s, k) => s === 420 && target[k] === 421));
    expect(found).not.toContain(0);
    expect(found).toContain(source.length - 1);
    expect(new Set(found).size).toBe(found.length);
    expect(n).toBeLessThan(40);
  });
});

/** Records what the painter hands the render surface. */
function recordingSurface(): RenderSurface & { shapes: Float32Array[]; segments: Float32Array[]; triangles: Float32Array[] } {
  const shapes: Float32Array[] = [];
  const segments: Float32Array[] = [];
  const triangles: Float32Array[] = [];
  return {
    shapes,
    segments,
    triangles,
    beginFrame() {},
    endFrame() {},
    fillRects() {},
    fillShapes: (data, count) => void shapes.push(data.slice(0, count * 14)),
    strokeSegments: (data, count) => void segments.push(data.slice(0, count * 12)),
    fillTriangles: (data, count) => void triangles.push(data.slice(0, count * 6)),
    isLost: false,
    setLossListener() {},
    dispose() {},
  };
}

function frameInput(edgeStyle: GraphEdgeStyle, nodeStyle: GraphNodeStyle = { width: 20 }, edges = [{ source: "a", target: "b" }]): GraphFrameInput<unknown, unknown> {
  const model = buildGraphModel(nodes, edges);
  const colors = new ColorCache(() => undefined);
  const defaults = { nodeFill: [1, 0, 0, 1] as const, edgeColor: [0, 0, 1, 1] as const };
  const nodeStyles = new Float32Array(model.nodes.length * NODE_FLOATS);
  model.nodes.forEach((_, i) => writeNodeStyle(nodeStyles, i * NODE_FLOATS, nodeStyle, colors, defaults));
  const edgeStyles = new Float32Array(model.edgeCount * EDGE_FLOATS);
  for (let i = 0; i < model.edgeCount; i++) writeEdgeStyle(edgeStyles, i * EDGE_FLOATS, edgeStyle, colors, defaults, false);
  return {
    model,
    nodeStyles,
    edgeStyles,
    order: Uint32Array.from(model.nodes.keys()),
    centerX: 50,
    centerY: 50,
    zoom: 1,
    width: 200,
    height: 200,
    pixelRatio: 2,
    time: 0,
    animate: true,
    minNodePx: 2,
    background: null,
  };
}

describe("graph painter", () => {
  it("draws nodes at their screen box in device pixels, and edges from outline to outline", () => {
    const surface = recordingSurface();
    const painter = new GraphPainter();
    painter.paint(surface, frameInput({ width: 1 }));
    const [shapes] = surface.shapes;
    // Node a: center (0,0) in graph units is (50,50) CSS px on a 200x200 plot centered at (50,50), so (100,100) device px.
    expect(Array.from(shapes!.subarray(0, 6))).toEqual([80, 80, 40, 40, 20, 0]);
    const [segment] = surface.segments;
    // Straight a->b, 10 CSS px circles plus the 2 px gap: from x=62 to x=138 CSS px at y=50.
    expect(Array.from(segment!.subarray(0, 5)).map((v) => Math.round(v))).toEqual([124, 100, 276, 100, 2]);
    expect(painter.moving).toBe(false);
  });

  it("bows only the edges that have a reverse twin, when curvature is auto", () => {
    const painter = new GraphPainter();
    const surface = recordingSurface();
    painter.paint(surface, frameInput({}, { width: 20 }, [{ source: "a", target: "b" }, { source: "b", target: "a" }, { source: "a", target: "c" }]));
    const geometry = painter.edgeScreen;
    // Nodes a and b are both at y = 50 CSS px; the control point sits off that line by the bow.
    const bow = (g: number): number => geometry[g + 3]! - 50;
    expect(Math.abs(bow(0))).toBeCloseTo(AUTO_BOW * 100, 3);
    // The two directions bow to opposite sides.
    expect(Math.sign(bow(0))).toBe(-Math.sign(bow(7)));
    expect(geometry[14 + 2]).toBeCloseTo((geometry[14]! + geometry[14 + 4]!) / 2, 3);
  });

  it("adds arrowheads, keeps dashes continuous along a bow, and animates flows only when allowed", () => {
    const painter = new GraphPainter();
    const surface = recordingSurface();
    const input = frameInput({ arrow: "end", curvature: 0.3, dash: [4, 4], flow: { speed: 10 } });
    painter.paint(surface, input);
    expect(surface.triangles[0]!.length).toBe(18);
    const segments = surface.segments[0]!;
    const count = segments.length / 12;
    expect(count).toBeGreaterThan(2);
    // Each piece's dash offset is where the previous one ended.
    const firstLength = Math.hypot(segments[2]! - segments[0]!, segments[3]! - segments[1]!);
    expect(segments[12 + 7]!).toBeCloseTo(segments[7]! + firstLength, 2);
    // The flow is collected, not drawn, by the still pass; its own pass draws it and asks for more frames.
    expect(surface.segments).toHaveLength(1);
    expect(painter.hasFlows).toBe(true);
    const flows = recordingSurface();
    painter.paintFlows(flows, input);
    expect(flows.segments[0]!.length / 12).toBe(count);
    expect(painter.moving).toBe(true);
    painter.paintFlows(recordingSurface(), { ...input, animate: false });
    expect(painter.moving).toBe(false);
  });

  it("redraws only the flows on an animation frame, and clears their layer once when they stop", () => {
    const painter = new GraphPainter();
    const input = frameInput({ flow: { speed: 10 } });
    painter.paint(recordingSurface(), input);
    const later = recordingSurface();
    painter.paintFlows(later, { ...input, time: 0.25 });
    const earlier = recordingSurface();
    painter.paintFlows(earlier, input);
    expect(later.segments[0]![7]).not.toBe(earlier.segments[0]![7]);
    painter.paint(recordingSurface(), frameInput({}));
    expect(painter.hasFlows).toBe(false);
    let frames = 0;
    const clear = { ...recordingSurface(), beginFrame: () => void frames++ };
    painter.paintFlows(clear, input);
    painter.paintFlows(clear, input);
    expect(frames).toBe(1);
  });

  it("culls what is off screen and keeps tiny nodes at the minimum size", () => {
    const painter = new GraphPainter();
    const surface = recordingSurface();
    painter.paint(surface, { ...frameInput({}), centerX: 5000, centerY: 5000 });
    expect(surface.shapes).toHaveLength(0);
    expect(surface.segments).toHaveLength(0);
    const tiny = recordingSurface();
    painter.paint(tiny, { ...frameInput({}), zoom: 0.01, minNodePx: 3 });
    // 20 graph units at zoom 0.01 is 0.2 px; drawn 3 CSS px wide, 6 device px.
    expect(tiny.shapes[0]![2]).toBeCloseTo(6, 5);
  });

  it("draws a dot background that coarsens when zoomed out", () => {
    const painter = new GraphPainter();
    const near = recordingSurface();
    painter.paint(near, { ...frameInput({}), background: { kind: "dots", gap: 20, size: 1, color: [1, 1, 1, 1] } });
    const far = recordingSurface();
    painter.paint(far, { ...frameInput({}), zoom: 0.05, background: { kind: "dots", gap: 20, size: 1, color: [1, 1, 1, 1] } });
    const nearDots = near.shapes[0]!.length / 14;
    const farDots = far.shapes[0]!.length / 14;
    expect(nearDots).toBeGreaterThan(50);
    // At zoom 0.05 the 20-unit gap is 1 px; doubled to 16 px, never under 10, so a 200 px plot has at most 21 x 21 dots.
    expect(farDots).toBeLessThanOrEqual(21 * 21);
    const spacing = (far.shapes[0]![14]! - far.shapes[0]![0]!) / 2;
    expect(spacing).toBeGreaterThanOrEqual(10);
  });

  it("measures distance to a drawn edge and finds its middle", () => {
    const geometry = new Float32Array([0, 0, 50, 0, 100, 0, 1]);
    expect(edgeDistanceSq(geometry, 0, 50, 3)).toBeCloseTo(9, 5);
    const middle = edgeMiddle(geometry, 0);
    expect([middle.x, middle.y, middle.angle]).toEqual([50, 0, 0]);
    const screen = new Float32Array([0, 0, 10, 5, 1]);
    expect(exit(screen, 0, 1, 0, 2)).toEqual([12, 0]);
    expect(exit(screen, 0, 0, 1, 0)).toEqual([0, 5]);
    expect(exit(screen, 0, 0, 0, 0)).toBeNull();
  });
});

describe("graph painter extras", () => {
  it("draws dashed node borders over the fill and round flow dots between edges and arrows", () => {
    const painter = new GraphPainter();
    const surface = recordingSurface();
    const order: string[] = [];
    const spy: RenderSurface = {
      ...surface,
      fillShapes: (data, count) => {
        order.push(`shapes:${count}`);
        surface.fillShapes(data, count);
      },
      strokeSegments: (data, count) => {
        order.push(`segments:${count}`);
        surface.strokeSegments(data, count);
      },
      fillTriangles: (data, count) => {
        order.push(`triangles:${count}`);
        surface.fillTriangles(data, count);
      },
    };
    const input = frameInput({ arrow: "end", flow: { shape: "dot", width: 4, dash: [0.5, 15], speed: 0 } }, { shape: "rect", width: 40, height: 20, borderWidth: 2, borderColor: "#fff", borderDash: [4, 3] });
    painter.paint(spy, input);
    // Edge line, arrowhead, node fills (borderless), then the dashed borders: four sides per box.
    expect(order).toEqual(["segments:1", "triangles:3", "shapes:3", "segments:12"]);
    const fills = surface.shapes[0]!;
    expect(fills[5]).toBe(0);
    // The flow's dots are drawn by the flow pass, on its own layer.
    const flowLayer = recordingSurface();
    painter.paintFlows(flowLayer, input);
    const dots = flowLayer.shapes[0]!;
    // 4 CSS px dots at pixel ratio 2, fully round.
    expect([dots[2], dots[3], dots[4]]).toEqual([8, 8, 4]);
  });

  it("draws a dashed circle border as a 32-sided outline", () => {
    const painter = new GraphPainter();
    const surface = recordingSurface();
    painter.paint(surface, frameInput({}, { width: 30, borderWidth: 2, borderColor: "#fff", borderDash: [2, 2] }, []));
    expect(surface.segments[0]!.length / 12).toBe(32 * 3);
  });
});

describe("graph painter lifting", () => {
  it("leaves a lifted node and its edges out of the still pass and draws them on the overlay", () => {
    const painter = new GraphPainter();
    const base = frameInput({ arrow: "end" }, { width: 20 }, [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "a", target: "c" }]);
    const lifted = { ...base, lifted: 1, liftedEdges: Uint32Array.from([0, 1]) };
    const still = recordingSurface();
    painter.paint(still, lifted);
    // Node b and its two edges are not in the still pass: two nodes, one edge.
    expect(still.shapes[0]!.length / 14).toBe(2);
    expect(still.segments[0]!.length / 12).toBe(1);
    expect(painter.needsOverlay(lifted)).toBe(true);
    const overlay = recordingSurface();
    painter.paintFlows(overlay, lifted);
    expect(overlay.shapes[0]!.length / 14).toBe(1);
    expect(overlay.segments[0]!.length / 12).toBe(2);
    expect(overlay.triangles[0]!.length / 6).toBe(6);
    // Moved between still frames, the lifted node is drawn where it is now.
    base.model.x[1] = 150;
    painter.paintFlows(overlay, lifted);
    const moved = overlay.shapes[1]!;
    expect(moved[0]! + moved[2]! / 2).toBeCloseTo((100 + 100) * 2, 3);
  });
});

describe("graph level of detail", () => {
  const source = (count: number, x: number[], y: number[], s: number[], t: number[]) => ({
    count,
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    nodeStyles: Float32Array.from(Array.from({ length: count }, (_, i) => [i % 2, 0, 1 - (i % 2), 1]).flat()),
    nodeStride: 4,
    nodeColorAt: 0,
    edgeCount: s.length,
    source: Uint32Array.from(s),
    target: Uint32Array.from(t),
    edgeStyles: Float32Array.from(s.flatMap(() => [0, 0, 0, 0.5])),
    edgeStride: 4,
    edgeColorAt: 0,
  });

  it("bins nodes into cells and merges edges between cells, both directions together", () => {
    // Two cells of 10 units: nodes 0, 1 in the first, 2, 3 in the second.
    const agg = buildAggregate(10, source(4, [1, 2, 11, 12], [1, 2, 1, 2], [0, 1, 2, 0], [2, 3, 0, 1]));
    expect(agg.cellCount).toBe(2);
    expect([...agg.cellNodes]).toEqual([2, 2]);
    expect(agg.cellX[0]).toBeCloseTo(1.5, 6);
    // Node colors average: one red, one blue in each cell.
    expect([...agg.cellColor.subarray(0, 4)]).toEqual([0.5, 0, 0.5, 1]);
    // Edges 0->2, 1->3, 2->0 cross the cells; 0->1 stays inside one and is dropped.
    expect(agg.edgeCount).toBe(1);
    expect(agg.edgeWeight[0]).toBe(3);
  });

  it("builds a level in slices, finishing with the same result", () => {
    const n = 20_000;
    const x = Array.from({ length: n }, (_, i) => (i % 200) * 3);
    const y = Array.from({ length: n }, (_, i) => Math.floor(i / 200) * 3);
    const s = Array.from({ length: n - 1 }, (_, i) => i);
    const t = s.map((i) => i + 1);
    const from = source(n, x, y, s, t);
    const job = new AggregateJob(2, 12, from);
    let slices = 0;
    let done = job.step(() => 1, 0);
    while (!done) {
      slices++;
      done = job.step(() => 1, 0);
    }
    expect(slices).toBeGreaterThan(2);
    const once = buildAggregate(12, from);
    expect(done.cellCount).toBe(once.cellCount);
    expect(done.edgeCount).toBe(once.edgeCount);
  });

  it("draws only what is on screen, and the aggregate level past the budget", () => {
    const n = 40_000;
    const side = 200;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: String(i), x: (i % side) * 10, y: Math.floor(i / side) * 10 }));
    const edges = Array.from({ length: n - 1 }, (_, i) => ({ source: String(i), target: String(i + 1) }));
    const model = buildGraphModel(nodes, edges);
    const colors = new ColorCache(() => undefined);
    const defaults = { nodeFill: [1, 0, 0, 1] as const, edgeColor: [0, 0, 1, 1] as const };
    const nodeStyles = new Float32Array(n * NODE_FLOATS);
    for (let i = 0; i < n; i++) writeNodeStyle(nodeStyles, i * NODE_FLOATS, { width: 6 }, colors, defaults);
    const edgeStyles = new Float32Array(model.edgeCount * EDGE_FLOATS);
    for (let i = 0; i < model.edgeCount; i++) writeEdgeStyle(edgeStyles, i * EDGE_FLOATS, {}, colors, defaults, false);
    const spatial = new GraphIndex();
    spatial.ensure(model, new Float32Array(n).fill(3), new Float32Array(n).fill(3));
    const base = { model, nodeStyles, edgeStyles, order: Uint32Array.from({ length: n }, (_, i) => i), width: 200, height: 200, pixelRatio: 1, time: 0, animate: false, minNodePx: 2, background: null, spatial };

    // Zoomed in on a corner: a few dozen nodes, not 40 000.
    const painter = new GraphPainter();
    painter.paint(recordingSurface(), { ...base, centerX: 50, centerY: 50, zoom: 2 });
    expect(painter.aggregated).toBe(false);
    expect(painter.drawnNodeCount).toBeGreaterThan(10);
    expect(painter.drawnNodeCount).toBeLessThan(200);

    // The whole graph with a small budget: a stand-in sample first, then the aggregate once it is built.
    const far = { ...base, centerX: 1000, centerY: 1000, zoom: 0.1, budget: { nodes: 1000, edges: 2000 } };
    const sampled = recordingSurface();
    painter.paint(sampled, far);
    expect(painter.aggregated).toBe(true);
    expect(spatial.building).toBe(true);
    expect(sampled.shapes[0]!.length / 14).toBeLessThanOrEqual(1000);
    while (!spatial.pump(() => 0, Infinity)) {
      // A finished level ends the loop.
    }
    const aggregated = recordingSurface();
    painter.paint(aggregated, far);
    expect(spatial.building).toBe(false);
    const dots = aggregated.shapes[0]!.length / 14;
    expect(dots).toBeGreaterThan(50);
    expect(dots).toBeLessThan(n / 4);
    expect(painter.drawnEdgeCount).toBe(0);
    // Zooming further out wants a coarser level: until it is built, the nearest built one stands in.
    const farther = recordingSurface();
    painter.paint(farther, { ...far, zoom: 0.02 });
    expect(spatial.building).toBe(true);
    expect(spatial.nearest(99)).not.toBeNull();
    expect(farther.shapes[0]!.length / 14).toBeGreaterThan(10);
  });
});

describe("graph model incidence", () => {
  it("lists a node's edges at either end, and nothing for a node out of range", () => {
    const model = buildGraphModel(nodes, { source: [0, 1, 0, 2], target: [1, 2, 2, 7] });
    expect(model.edgeCount).toBe(3);
    expect(model.skippedEdges).toBe(1);
    expect([...model.edgesAt(2)].sort()).toEqual([1, 2]);
    expect([...model.edgesAt(0)].sort()).toEqual([0, 2]);
    expect(model.edgesAt(9)).toHaveLength(0);
    // Edges given as arrays become objects on demand, with node ids.
    expect(model.edgeAt(1)).toEqual({ source: "b", target: "c" });
    expect(model.edgeIdOf(2)).toBe("a->c");
    expect(() => buildGraphModel(nodes, { source: [0], target: [] })).toThrow(TypeError);
  });
});

describe("dense graphs", () => {
  function complete(count: number) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const nodes = Array.from({ length: count }, (_, i) => ({ id: String(i), x: Math.cos(i * golden) * 10 * Math.sqrt(i + 0.5), y: Math.sin(i * golden) * 10 * Math.sqrt(i + 0.5) }));
    const source: number[] = [];
    const target: number[] = [];
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      source.push(i);
      target.push(j);
    }
    return { nodes, model: buildGraphModel(nodes, { source: Uint32Array.from(source), target: Uint32Array.from(target) }) };
  }

  it("hands style functions one reused edge view for edges given as arrays", () => {
    const { model } = complete(4);
    const first = model.edgeView(0);
    expect({ ...first }).toMatchObject({ source: "0", target: "1" });
    const second = model.edgeView(5);
    expect(second).toBe(first);
    expect(second).toMatchObject({ source: "2", target: "3" });
  });

  it("draws an even, stable sample of a complete graph within its budget, as dense as the whole, without arrows", () => {
    const { model } = complete(300);
    const colors = new ColorCache(() => undefined);
    const defaults = { nodeFill: [1, 0, 0, 1] as const, edgeColor: [0, 0, 1, 1] as const };
    const nodeStyles = new Float32Array(300 * NODE_FLOATS);
    for (let i = 0; i < 300; i++) writeNodeStyle(nodeStyles, i * NODE_FLOATS, { width: 4 }, colors, defaults);
    // One shared edge style record for every edge.
    const edgeStyles = new Float32Array(EDGE_FLOATS);
    writeEdgeStyle(edgeStyles, 0, { color: [0, 0, 1, 0.05], arrow: "end" }, colors, defaults, false);
    const edgeSlot = new Uint32Array(model.edgeCount);
    const spatial = new GraphIndex();
    spatial.ensure(model, new Float32Array(300).fill(2), new Float32Array(300).fill(2));
    const input = {
      model, nodeStyles, edgeStyles, edgeSlot, order: Uint32Array.from({ length: 300 }, (_, i) => i), width: 400, height: 400, pixelRatio: 1,
      time: 0, animate: false, minNodePx: 2, background: null, spatial, centerX: 0, centerY: 0, zoom: 1, budget: { nodes: 10_000, edges: 2_000, fill: Infinity },
    };
    const painter = new GraphPainter();
    const surface = recordingSurface();
    painter.paint(surface, input);
    const segments = surface.segments[0]!;
    const drawn = segments.length / 12;
    expect(drawn).toBeLessThanOrEqual(2_000);
    expect(drawn).toBeGreaterThan(1_000);
    // Each stands for about 22 edges: opacity 1 - 0.95^22, about 0.68, held at 0.6.
    expect(segments[11]).toBeCloseTo(0.6, 5);
    expect(surface.triangles).toHaveLength(0);
    // The same sample next frame.
    const again = recordingSurface();
    painter.paint(again, input);
    expect(again.segments[0]!.length).toBe(segments.length);
    expect([...again.segments[0]!.subarray(0, 24)]).toEqual([...segments.subarray(0, 24)]);
  });

  it("takes a moved node and its edges without rebuilding the grids", () => {
    const { model } = complete(50);
    const spatial = new GraphIndex();
    const half = new Float32Array(50).fill(2);
    spatial.ensure(model, half, half);
    model.x[0] = 5000;
    model.y[0] = 5000;
    spatial.moveNode(0, model.edgesAt(0));
    const out = { data: new Uint32Array(8) };
    const nodes = spatial.nodes.query({ minX: 4990, minY: 4990, maxX: 5010, maxY: 5010 }, out);
    expect([...out.data.subarray(0, nodes)]).toContain(0);
    const edges = spatial.edges.query({ minX: 4990, minY: 4990, maxX: 5010, maxY: 5010 }, out);
    expect(new Set(out.data.subarray(0, edges)).size).toBe(edges);
    expect([...out.data.subarray(0, edges)]).toEqual(expect.arrayContaining([...model.edgesAt(0)]));
  });

  it("grows its hash tables past their first size", () => {
    const n = 20_000;
    const x = Float64Array.from({ length: n }, (_, i) => (i % 200) * 3);
    const y = Float64Array.from({ length: n }, (_, i) => Math.floor(i / 200) * 3);
    const agg = buildAggregate(1, {
      count: n, x, y, nodeStyles: new Float32Array(n * 4).fill(1), nodeStride: 4, nodeColorAt: 0,
      edgeCount: n - 1, source: Uint32Array.from({ length: n - 1 }, (_, i) => i), target: Uint32Array.from({ length: n - 1 }, (_, i) => i + 1),
      edgeStyles: new Float32Array(4).fill(1), edgeSlot: new Uint32Array(n - 1), edgeStride: 4, edgeColorAt: 0,
    });
    expect(agg.cellCount).toBe(n);
    expect(agg.edgeCount).toBe(n - 1);
  });
});
