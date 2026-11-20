import { segmentCrosses } from "../../src/plugins/graph/render.ts";
import { describe, expect, it } from "bun:test";
import { PairHierarchy, PairTree, RefineScratch, refine, starCut } from "../../src/plugins/graph/pairs.ts";
import type { RefineBudget } from "../../src/plugins/graph/pairs.ts";
import { buildGraphModel } from "../../src/plugins/graph/model.ts";
import { GraphIndex } from "../../src/plugins/graph/spatial.ts";
import { GraphPainter } from "../../src/plugins/graph/render.ts";
import type { RenderSurface } from "../../src/plugins/graph/render.ts";
import { ColorCache, EDGE_FLOATS, NODE_FLOATS, writeEdgeStyle, writeNodeStyle } from "../../src/plugins/graph/styles.ts";

/** Nodes on a sunflower disk: even, and the same every run. */
function disk(count: number, spacing = 10): { x: Float64Array; y: Float64Array } {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const r = spacing * Math.sqrt(i + 0.5);
    x[i] = Math.cos(i * golden) * r;
    y[i] = Math.sin(i * golden) * r;
  }
  return { x, y };
}

function hierarchy(count: number): { tree: PairTree; pairs: PairHierarchy; x: Float64Array; y: Float64Array } {
  const { x, y } = disk(count);
  const tree = new PairTree();
  tree.build(count, x, y);
  const pairs = new PairHierarchy(tree);
  pairs.build();
  return { tree, pairs, x, y };
}

/** Every unordered pair of nodes that the leaf pairs cover, counted. */
function covered(pairs: PairHierarchy): Map<number, number> {
  const t = pairs.tree;
  const seen = new Map<number, number>();
  const n = t.order.length;
  for (let p = 0; p < pairs.count; p++) {
    if (!pairs.isLeaf(p)) continue;
    const a = pairs.cellA[p]!;
    const b = pairs.cellB[p]!;
    for (let u = t.lo[a]!; u < t.hi[a]!; u++) {
      for (let v = a === b ? u + 1 : t.lo[b]!; v < t.hi[b]!; v++) {
        const i = t.order[u]!;
        const j = t.order[v]!;
        const key = Math.min(i, j) * n + Math.max(i, j);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }
  return seen;
}

const everything = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9, zoom: 1 };
const free: RefineBudget = { items: Infinity, area: Infinity, lines: Infinity, field: Infinity, minSize: 0 };
const flatCosts = { band: (_a: number, _b: number, _edges: number, out: Float64Array) => void out.fill(1), lines: () => 1 };

/** What a refine emitted, and the edges it accounts for. */
function collect() {
  const out = { bands: [] as number[][], nodes: [] as number[][], cells: [] as number[][], edges: 0 };
  const sink = {
    band: (a: number, b: number, edges: number) => {
      out.bands.push([a, b, edges]);
      out.edges += edges;
    },
    nodes: (i: number, j: number) => {
      out.nodes.push([i, j]);
      out.edges += 1;
    },
    cell: (c: number, edges: number) => {
      out.cells.push([c, edges]);
      out.edges += edges;
    },
  };
  return { out, sink };
}

describe("pair tree", () => {
  it("splits nodes into cells with their bounds, centroid, spread, and radius, and refits a moved node", () => {
    const { tree, x, y } = hierarchy(500);
    expect(tree.size(0)).toBe(500);
    expect(tree.mx[0]).toBeCloseTo(x.reduce((s, v) => s + v, 0) / 500, 6);
    expect(tree.radius(0)).toBeCloseTo(Math.hypot(tree.maxX[0]! - tree.minX[0]!, tree.maxY[0]! - tree.minY[0]!) / 2, 9);
    // Leaves hold a few nodes, and every node's leaf contains it.
    for (let i = 0; i < 500; i++) {
      const leaf = tree.leafOf[i]!;
      expect(tree.left[leaf]).toBe(-1);
      expect(tree.contains(leaf, i)).toBe(true);
      expect(tree.size(leaf)).toBeLessThanOrEqual(4);
    }
    // A spread is a standard deviation: along x it is the square root of the x variance.
    const varX = x.reduce((s, v) => s + (v - tree.mx[0]!) ** 2, 0) / 500;
    expect(tree.spread(0, 1, 0)).toBeCloseTo(Math.sqrt(varX), 6);
    x[7] = 10_000;
    tree.refitNode(7, x, y);
    expect(tree.maxX[0]).toBe(10_000);
    expect(tree.maxX[tree.leafOf[7]!]).toBe(10_000);
    expect(tree.radius(0)).toBeGreaterThan(5000);
  });

  it("keeps the convex hull of the nodes, and moves it with a node that leaves it", () => {
    // A 20 x 20 grid: its hull is the four corners.
    const x = Float64Array.from({ length: 400 }, (_, i) => i % 20);
    const y = Float64Array.from({ length: 400 }, (_, i) => Math.floor(i / 20));
    const tree = new PairTree();
    tree.build(400, x, y);
    const corners = (t: PairTree) => Array.from({ length: t.hullCount }, (_, k) => `${t.hull[k * 2]},${t.hull[k * 2 + 1]}`).sort();
    expect(corners(tree)).toEqual(["0,0", "0,19", "19,0", "19,19"]);
    x[210] = 40;
    y[210] = 10;
    tree.refitNode(210, x, y);
    expect(corners(tree)).toEqual(["0,0", "0,19", "19,0", "19,19", "40,10"]);
  });

  it("builds over no nodes", () => {
    const tree = new PairTree();
    tree.build(0, new Float64Array(0), new Float64Array(0));
    expect(tree.count).toBe(0);
    const pairs = new PairHierarchy(tree);
    pairs.build();
    expect(pairs.count).toBe(0);
    const { sink, out } = collect();
    expect(refine(pairs, everything, free, flatCosts, sink, new RefineScratch())).toBe(0);
    expect(out.edges).toBe(0);
  });
});

describe("pair hierarchy", () => {
  it("covers every pair of distinct nodes exactly once, with a few pairs per node", () => {
    const { pairs } = hierarchy(300);
    const seen = covered(pairs);
    expect(seen.size).toBe((300 * 299) / 2);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(pairs.count / 300).toBeLessThan(20);
  });

  it("counts every pair less the exceptions, or the listed edges, into the leaf holding each pair", () => {
    const { pairs } = hierarchy(200);
    pairs.countAll(Uint32Array.of(0, 5, 9, 9), Uint32Array.of(1, 4, 9, 300));
    // (9, 9) is no pair; (9, 300) holds a node that is not there.
    expect(pairs.edges[0]).toBe((200 * 199) / 2 - 2);
    pairs.countAll(null, null);
    expect(pairs.edges[0]).toBe((200 * 199) / 2);
    const leaf = pairs.leafOf(3, 150);
    expect(leaf).toBeGreaterThanOrEqual(0);
    expect(pairs.isLeaf(leaf)).toBe(true);
    pairs.countListed(Uint32Array.of(3, 150, 7), Uint32Array.of(150, 3, 8), 3);
    expect(pairs.edges[0]).toBe(3);
    expect(pairs.edges[leaf]).toBe(2);
  });
});

describe("refine", () => {
  it("accounts for every edge on the view once, as bands, single node pairs, and whole cells", () => {
    const { pairs } = hierarchy(300);
    pairs.countAll(null, null);
    const { sink, out } = collect();
    refine(pairs, everything, { ...free, items: 400, minSize: 2 }, flatCosts, sink, new RefineScratch());
    expect(out.edges).toBe((300 * 299) / 2);
    expect(out.bands.length + out.nodes.length).toBeLessThanOrEqual(400);
    expect(out.bands.length).toBeGreaterThan(0);
  });

  it("is as fine as its budget allows: a larger budget stops at a smaller size, and the same input gives the same cut", () => {
    const { pairs } = hierarchy(1000);
    pairs.countAll(null, null);
    const view = { ...everything, zoom: 0.5 };
    const small = collect();
    const large = collect();
    const again = collect();
    const scratch = new RefineScratch();
    const coarse = refine(pairs, view, { ...free, items: 300, minSize: 2 }, flatCosts, small.sink, scratch);
    const fine = refine(pairs, view, { ...free, items: 3000, minSize: 2 }, flatCosts, large.sink, scratch);
    refine(pairs, view, { ...free, items: 3000, minSize: 2 }, flatCosts, again.sink, scratch);
    expect(fine).toBeLessThan(coarse);
    expect(large.out.bands.length).toBeGreaterThan(small.out.bands.length);
    expect(again.out).toEqual(large.out);
  });

  it("stops at the area, line, and field budgets too", () => {
    const { pairs } = hierarchy(500);
    pairs.countAll(null, null);
    const costs = { band: (_a: number, _b: number, _edges: number, out: Float64Array) => out.set([10, 5, 1]), lines: () => 100 };
    for (const budget of [{ area: 100 }, { field: 50 }]) {
      const { sink, out } = collect();
      const stopped = refine(pairs, everything, { ...free, ...budget, minSize: 2 }, costs, sink, new RefineScratch());
      expect(stopped).toBeGreaterThan(2);
      expect(out.bands.length).toBeLessThanOrEqual(10);
    }
    // Lines: no leaf pair becomes its node pairs when they cost more than allowed.
    const { sink, out } = collect();
    refine(pairs, everything, { ...free, lines: 50, minSize: 0 }, costs, sink, new RefineScratch());
    expect(out.nodes).toHaveLength(0);
    expect(out.edges).toBe((500 * 499) / 2);
  });

  it("splits nothing past its smallest size, and leaves out what lies off the view", () => {
    const { pairs } = hierarchy(300);
    pairs.countAll(null, null);
    const whole = collect();
    refine(pairs, everything, { ...free, minSize: 1e12 }, flatCosts, whole.sink, new RefineScratch());
    expect(whole.out.cells).toEqual([[0, (300 * 299) / 2]]);
    const away = collect();
    refine(pairs, { minX: 1e6, minY: 1e6, maxX: 1e6 + 10, maxY: 1e6 + 10, zoom: 1 }, free, flatCosts, away.sink, new RefineScratch());
    expect(away.out.edges).toBe(0);
    // Half the view: fewer edges than the whole, but all of those inside it.
    const half = collect();
    refine(pairs, { minX: 0, minY: -1e9, maxX: 1e9, maxY: 1e9, zoom: 1 }, { ...free, minSize: 0 }, flatCosts, half.sink, new RefineScratch());
    expect(half.out.edges).toBeLessThan((300 * 299) / 2);
    expect(half.out.edges).toBeGreaterThan((300 * 299) / 8);
  });

  it("splits leaf pairs further with exact counts from their lists, for listed edges and for exceptions", () => {
    const n = 600;
    const { pairs } = hierarchy(n);
    // Listed: a few thousand distinct pseudo-random edges.
    const listed = new Set<number>();
    let seed = 7;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
    while (listed.size < 6000) {
      const i = next();
      const j = next();
      if (i !== j) listed.add(Math.min(i, j) * n + Math.max(i, j));
    }
    const keys = [...listed];
    pairs.countListed(Uint32Array.from(keys, (k) => Math.floor(k / n)), Uint32Array.from(keys, (k) => k % n), keys.length);
    const isListed = ([i, j]: number[]) => listed.has(Math.min(i!, j!) * n + Math.max(i!, j!));
    const total = (out: ReturnType<typeof collect>["out"]) => out.bands.reduce((s, x) => s + x[2]!, 0) + out.cells.reduce((s, x) => s + x[1]!, 0) + out.nodes.filter(isListed).length;
    // Over the whole graph, a budget's cut and one split down to single pairs both count every edge once.
    for (const items of [3000, Infinity]) {
      const { sink, out } = collect();
      refine(pairs, everything, { ...free, items, minSize: 0 }, flatCosts, sink, new RefineScratch());
      expect(total(out)).toBe(listed.size);
    }
    // On part of it, those near the view (the rest are left out as the cut gets finer).
    const near = collect();
    refine(pairs, { minX: -150, minY: -150, maxX: 150, maxY: 150, zoom: 4 }, { ...free, items: 3000, minSize: 0 }, flatCosts, near.sink, new RefineScratch());
    expect(total(near.out)).toBeGreaterThan(0);
    expect(total(near.out)).toBeLessThan(listed.size);

    // Exceptions: every pair less them, split down the same way.
    const except = [[3, 400], [10, 20], [5, 599]] as const;
    pairs.countAll(Uint32Array.from(except.map((e) => e[0])), Uint32Array.from(except.map((e) => e[1])));
    const c = collect();
    refine(pairs, everything, { ...free, items: 5000, minSize: 0 }, flatCosts, c.sink, new RefineScratch());
    const skip = new Set(except.map(([i, j]) => Math.min(i, j) * n + Math.max(i, j)));
    const joined = c.out.nodes.filter(([i, j]) => !skip.has(Math.min(i!, j!) * n + Math.max(i!, j!))).length;
    expect(c.out.bands.reduce((s, x) => s + x[2]!, 0) + c.out.cells.reduce((s, x) => s + x[1]!, 0) + joined).toBe((n * (n - 1)) / 2 - except.length);
  });

  it("grows its queue past its first size", () => {
    const { pairs } = hierarchy(3000);
    pairs.countAll(null, null);
    const { sink, out } = collect();
    refine(pairs, everything, { ...free, minSize: 0 }, flatCosts, sink, new RefineScratch());
    expect(out.edges).toBe((3000 * 2999) / 2);
    // Nothing is left whole: what is not a separated band is single node pairs.
    expect(out.cells).toHaveLength(0);
    expect(out.nodes.length).toBeGreaterThan(50_000);
  });
});

describe("graph model joins", () => {
  it("tells joined pairs either way for listed edges, and every pair but the exceptions for a rule", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => ({ id, x: 0, y: 0 }));
    const listed = buildGraphModel(nodes, { source: Uint32Array.of(0, 2), target: Uint32Array.of(1, 3) });
    expect([listed.joined(0, 1), listed.joined(1, 0), listed.joined(3, 2), listed.joined(0, 2), listed.joined(0, 0), listed.joined(0, 9)]).toEqual([true, true, true, false, false, false]);
    const rule = buildGraphModel(nodes, { all: true, except: { source: Uint32Array.of(1, 2, 2, 9), target: Uint32Array.of(0, 2, 3, 0) } });
    expect(rule.allPairs!.implicitEdges).toBe(6 - 2);
    expect([rule.joined(0, 1), rule.joined(1, 0), rule.joined(2, 3), rule.joined(0, 3), rule.joined(1, 1)]).toEqual([false, false, false, true, false]);
  });
});

describe("star cut", () => {
  it("covers a node's edges to every other node once, as bands to far or small cells and single nodes near it", () => {
    const { tree } = hierarchy(400);
    let edges = 0;
    const singles = new Set<number>();
    starCut(tree, 17, tree.mx[tree.leafOf[17]!]!, tree.my[tree.leafOf[17]!]!, everything, 4, {
      band: (_cell, n) => void (edges += n),
      node: (j) => {
        expect(j).not.toBe(17);
        singles.add(j);
        edges++;
      },
    });
    expect(edges).toBe(399);
    expect(singles.size).toBeGreaterThan(0);
    expect(singles.size).toBeLessThan(399);
  });
});

describe("dense graph painter", () => {
  function recording(): RenderSurface & { fields: { alpha: Float32Array; cols: number; rows: number }[]; triangles: number[]; segments: Float32Array[] } {
    const fields: { alpha: Float32Array; cols: number; rows: number }[] = [];
    const triangles: number[] = [];
    const segments: Float32Array[] = [];
    return {
      fields,
      triangles,
      segments,
      beginFrame() {},
      endFrame() {},
      fillRects() {},
      fillShapes() {},
      strokeSegments: (data, count) => void segments.push(data.slice(0, count * 12)),
      fillTriangles: (_data, count) => void triangles.push(count),
      fillField: (alpha, cols, rows) => void fields.push({ alpha: alpha.slice(0, cols * rows), cols, rows }),
      isLost: false,
      setLossListener() {},
      dispose() {},
    };
  }

  function scene(count: number, except: [number, number][] = []) {
    const { x, y } = disk(count);
    const nodes = Array.from({ length: count }, (_, i) => ({ id: String(i), x: x[i]!, y: y[i]! }));
    const model = buildGraphModel(nodes, { all: true, except: { source: Uint32Array.from(except.map((e) => e[0])), target: Uint32Array.from(except.map((e) => e[1])) } });
    const colors = new ColorCache(() => undefined);
    const defaults = { nodeFill: [1, 0, 0, 1] as const, edgeColor: [0, 0, 1, 1] as const };
    const nodeStyles = new Float32Array(count * NODE_FLOATS);
    for (let i = 0; i < count; i++) writeNodeStyle(nodeStyles, i * NODE_FLOATS, { width: 4 }, colors, defaults);
    const edgeStyles = new Float32Array(EDGE_FLOATS);
    writeEdgeStyle(edgeStyles, 0, { color: [0, 0, 1, 0.01], width: 1 }, colors, defaults, false);
    const spatial = new GraphIndex();
    spatial.ensure(model, new Float32Array(count).fill(2), new Float32Array(count).fill(2));
    const input = {
      model, nodeStyles, edgeStyles, edgeSlot: new Uint32Array(0), order: Uint32Array.from({ length: count }, (_, i) => i), width: 400, height: 400, pixelRatio: 1,
      time: 0, animate: false, minNodePx: 2, background: null, spatial, centerX: 0, centerY: 0, zoom: 1, denseSlot: 0, styledEdges: null,
      budget: { nodes: 100_000, edges: 100_000, fill: Infinity, overdraw: 48, dense: 4_000 },
    };
    return { model, spatial, input };
  }

  it("shades a complete graph as a density inside the nodes' hull, darker in the middle than at the rim, and none outside", () => {
    const { spatial, input } = scene(400);
    expect(spatial.dense).not.toBeNull();
    const painter = new GraphPainter();
    const surface = recording();
    painter.paint(surface, { ...input, zoom: 0.8 });
    expect(surface.fields).toHaveLength(1);
    const { alpha, cols, rows } = surface.fields[0]!;
    const at = (px: number, py: number) => alpha[Math.round(py / 8) * cols + Math.round(px / 8)]!;
    // The disk has a radius of 200 graph units, 160 px at this zoom: the corners of the view lie outside it.
    expect(at(200, 200)).toBeGreaterThan(0.2);
    expect(at(200, 200)).toBeGreaterThan(at(200, 200 + 140));
    expect(at(0, 0)).toBe(0);
    expect(at((cols - 1) * 8, (rows - 1) * 8)).toBe(0);
  });

  it("refines to single lines when zoomed in, and draws only the pairs that are joined", () => {
    // Nodes 0 and 1 sit next to each other at the middle of the disk; their pair is an exception.
    const { model, input } = scene(400, [[0, 1]]);
    const painter = new GraphPainter();
    const surface = recording();
    const zoom = 8;
    painter.paint(surface, { ...input, zoom, centerX: (model.x[0]! + model.x[1]!) / 2, centerY: (model.y[0]! + model.y[1]!) / 2 });
    // Each node on the view is joined to all 399 others, more lines than the budget: what is left are bands.
    const lines = surface.segments.flatMap((s) => Array.from({ length: s.length / 12 }, (_, k) => [...s.subarray(k * 12, k * 12 + 4)]));
    expect(lines.length).toBeGreaterThan(0);
    const screen = (i: number) => [200 + (model.x[i]! - (model.x[0]! + model.x[1]!) / 2) * zoom, 200 + (model.y[i]! - (model.y[0]! + model.y[1]!) / 2) * zoom];
    const [ax, ay] = screen(0);
    const [bx, by] = screen(1);
    // Lines end on node outlines (and their end gap): 4 graph units across, so about 2 * zoom pixels from the center.
    const joins = (l: number[], px: number, py: number) => Math.hypot(l[0]! - px, l[1]! - py) < 2 * zoom + 4 || Math.hypot(l[2]! - px, l[3]! - py) < 2 * zoom + 4;
    expect(lines.some((l) => joins(l, ax!, ay!) && joins(l, bx!, by!))).toBe(false);
    // Node 0 is still joined to the others near it.
    expect(lines.some((l) => joins(l, ax!, ay!))).toBe(true);
  });

  it("stops at its budget when zoomed out, and says so, so a finer cut can follow", () => {
    const { input } = scene(2000);
    const painter = new GraphPainter();
    painter.paint(recording(), { ...input, zoom: 0.4, budget: { ...input.budget, dense: 200 } });
    expect(painter.clipped).toBe(true);
    const fine = recording();
    painter.paint(fine, { ...input, zoom: 0.4, budget: { ...input.budget, dense: 50_000 } });
    expect(fine.triangles.length + fine.fields.length).toBeGreaterThan(0);
  });
});

describe("segmentCrosses", () => {
  const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  it("keeps segments that cross the view and leaves out those whose box alone covers it", () => {
    expect(segmentCrosses(-5, 5, 15, 5, rect)).toBe(true);
    expect(segmentCrosses(2, 2, 3, 3, rect)).toBe(true);
    expect(segmentCrosses(-5, 12, 12, -5, rect)).toBe(true);
    // The box around it covers the view, the line passes beside a corner.
    expect(segmentCrosses(-10, 8, 8, 30, rect)).toBe(false);
    expect(segmentCrosses(-5, -1, 15, -1, rect)).toBe(false);
    expect(segmentCrosses(11, 2, 11, 8, rect)).toBe(false);
  });
});
