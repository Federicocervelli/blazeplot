import { describe, expect, it } from "bun:test";
import { FIRST_LEVEL_EDGES, buildEdgeLevels, edgesForView, rasterizeLength, rectSum } from "../../src/plugins/graph/edgeLevels.ts";

/** A star of `leaves` around node 0 plus a path through the leaves: hub edges and edges between low-degree nodes. */
function starAndPath(leaves: number) {
  const n = leaves + 1;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    x[i] = Math.cos(i) * 100;
    y[i] = Math.sin(i) * 100;
  }
  const source: number[] = [];
  const target: number[] = [];
  for (let i = 1; i < n; i++) {
    source.push(0);
    target.push(i);
  }
  for (let i = 1; i + 1 < n; i++) {
    source.push(i);
    target.push(i + 1);
  }
  const degree = new Uint32Array(n);
  for (let e = 0; e < source.length; e++) {
    degree[source[e]!]!++;
    degree[target[e]!]!++;
  }
  const edges = Uint32Array.from(source.map((_, e) => e));
  return { x, y, source: Uint32Array.from(source), target: Uint32Array.from(target), degree, edges };
}

describe("edge levels", () => {
  it("ranks edges between low-degree nodes before a hub's, in levels that double", () => {
    const g = starAndPath(3000);
    const levels = buildEdgeLevels(g.edges, g.source, g.target, g.x, g.y, g.degree);
    expect(levels.order.length).toBe(g.edges.length);
    expect(new Set(levels.order).size).toBe(g.edges.length);
    // Every path edge (indices from 3000 on) comes before every hub edge.
    const firstHub = levels.order.findIndex((e) => e < 3000);
    expect(firstHub).toBe(2999);
    expect(levels.levelStart[0]).toBe(0);
    expect(levels.levelStart[1]).toBe(FIRST_LEVEL_EDGES);
    expect(levels.levelStart[2]).toBe(FIRST_LEVEL_EDGES * 2);
    expect(levels.levelStart[levels.levels]).toBe(g.edges.length);
  });

  it("measures every edge's whole length on the grid, and sums rectangles smoothly", () => {
    const g = starAndPath(500);
    const levels = buildEdgeLevels(g.edges, g.source, g.target, g.x, g.y, g.degree);
    let total = 0;
    for (let e = 0; e < g.edges.length; e++) total += Math.hypot(g.x[g.target[e]!]! - g.x[g.source[e]!]!, g.y[g.target[e]!]! - g.y[g.source[e]!]!);
    const all = levels.lengthFrom[0]!.reduce((a, b) => a + b, 0);
    expect(all).toBeCloseTo(total, 0);
    const last = levels.lengthUpTo[levels.levels - 1]!;
    expect(rectSum(levels, last, -1e9, -1e9, 1e9, 1e9)).toBeCloseTo(total, 0);
    // Sliding the rectangle by a hair changes the sum by a hair: no jumps at cell boundaries.
    let previous = rectSum(levels, last, -50, -50, 10, 10);
    for (let shift = 0.05; shift < 5; shift += 0.05) {
      const next = rectSum(levels, last, -50 + shift, -50, 10 + shift, 10);
      expect(Math.abs(next - previous)).toBeLessThan(total * 0.01);
      previous = next;
    }
  });

  it("rasterizes a segment's length into the cells it crosses, all of it", () => {
    const grid = new Float32Array(16);
    rasterizeLength(grid, 4, 4, 0.5, 0.5, 3.5, 2.5, 2);
    const sum = grid.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(Math.hypot(3, 2) * 2, 4);
    expect(grid[0]).toBeGreaterThan(0);
    expect(grid[2 * 4 + 3]).toBeGreaterThan(0);
    // Off the grid: clamped to the edge cells, still counted.
    const outside = new Float32Array(4);
    rasterizeLength(outside, 2, 2, -5, 0.5, 7, 0.5, 1);
    expect(outside.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 4);
  });

  it("draws more levels for a larger budget or a smaller view, fading the next one in smoothly", () => {
    const g = starAndPath(6000);
    const levels = buildEdgeLevels(g.edges, g.source, g.target, g.x, g.y, g.degree);
    const view = [-120, -120, 120, 120] as const;
    const small = edgesForView(levels, ...view, 1, 1, 2_000);
    const large = edgesForView(levels, ...view, 1, 1, 200_000);
    expect(large.end).toBeGreaterThanOrEqual(small.end);
    expect(large.full).toBeGreaterThan(small.full);
    const zoomedIn = edgesForView(levels, -10, -10, 10, 10, 1, 1, 2_000);
    expect(zoomedIn.full).toBeGreaterThan(small.full);
    // Everything fits an unlimited budget.
    const all = edgesForView(levels, ...view, 1, 1, Infinity);
    expect([all.full, all.end, all.level]).toEqual([g.edges.length, g.edges.length, levels.levels]);
    // The amount drawn (whole levels plus the faded share) grows without jumps as the budget does.
    const drawn = (budget: number) => {
      const d = edgesForView(levels, ...view, 1, 1, budget);
      return d.full + (d.end - d.full) * d.fade;
    };
    let previous = drawn(1_000);
    for (let budget = 1_100; budget < 100_000; budget *= 1.1) {
      const next = drawn(budget);
      expect(next).toBeGreaterThanOrEqual(previous - 1e-6);
      expect(next - previous).toBeLessThan(g.edges.length * 0.2);
      previous = next;
    }
  });
});
