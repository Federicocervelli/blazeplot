import { describe, expect, it } from "bun:test";
import { buildGraphModel, NodeGrid } from "../../src/plugins/graph/model.ts";
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
    expect(model.edgeIds).toEqual(["a->b", "b->a", "a->c"]);
    expect([...model.reversed]).toEqual([1, 1, 0]);
    expect(model.skippedEdges).toBe(2);
  });

  it("rejects duplicate or empty ids, bad positions, duplicate edge ids, and graphs over the limits", () => {
    expect(() => buildGraphModel([{ id: "a", x: 0, y: 0 }, { id: "a", x: 1, y: 1 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel([{ id: "", x: 0, y: 0 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel([{ id: "a", x: Number.NaN, y: 0 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel([{ id: "a", x: 1e12, y: 0 }], [])).toThrow(RangeError);
    expect(() => buildGraphModel(nodes, [{ source: "a", target: "b" }, { source: "a", target: "b" }])).toThrow(/parallel/);
    expect(() => buildGraphModel(nodes, [], { maxNodes: 2 })).toThrow(/limit of 2/);
    expect(() => buildGraphModel(nodes, [{ source: "a", target: "b" }, { source: "b", target: "c" }], { maxEdges: 1 })).toThrow(/limit of 1/);
    expect(() => buildGraphModel("nope" as never, [])).toThrow(TypeError);
  });

  it("finds nodes near a point through the grid, and only those", () => {
    const count = 2500;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    const half = new Float32Array(count).fill(4);
    for (let i = 0; i < count; i++) {
      x[i] = (i % 50) * 20;
      y[i] = Math.floor(i / 50) * 20;
    }
    const grid = new NodeGrid();
    grid.build(count, x, y, half, half);
    const seen = new Set<number>();
    grid.query(400, 400, 2, (i) => seen.add(i));
    expect(seen.has(20 * 50 + 20)).toBe(true);
    // A small query reads a few cells, not the whole graph.
    expect(seen.size).toBeLessThan(40);
    const all = new Set<number>();
    grid.query(500, 500, 1e6, (i) => all.add(i));
    expect(all.size).toBe(count);
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
  const edgeStyles = new Float32Array(model.edges.length * EDGE_FLOATS);
  model.edges.forEach((_, i) => writeEdgeStyle(edgeStyles, i * EDGE_FLOATS, edgeStyle, colors, defaults, false));
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
