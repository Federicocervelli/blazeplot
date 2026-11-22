import { describe, expect, it } from "bun:test";
import { LineField } from "../../src/plugins/graph/field.ts";

/** Total ink of the field: the count summed over vertices, times a vertex's area. */
function ink(field: LineField): number {
  const out = field.resolve();
  let sum = 0;
  for (let k = 0; k < field.cols * field.rows; k++) sum += out[k]!;
  return sum * field.step * field.step;
}

describe("LineField", () => {
  it("keeps a bundle's ink, edges times width times length, walked by rows or by columns", () => {
    for (const [ax, ay, bx, by] of [
      [200, 50, 220, 350],
      [50, 200, 350, 230],
      [60, 60, 340, 340],
    ] as const) {
      const field = new LineField();
      field.reset(400, 400, 1);
      field.addBundle(ax, ay, bx, by, 6, 9, 4, 5, 50, 1);
      expect(ink(field) / (50 * Math.hypot(bx - ax, by - ay))).toBeCloseTo(1, 1);
    }
  });

  it("writes wide bundles on coarser grids and their ends on finer ones, keeping the ink", () => {
    const field = new LineField();
    field.reset(400, 400, 1);
    // Cells 120 px across: the middle of the bundle is smooth over tens of pixels.
    field.addBundle(200, 20, 200, 380, 60, 60, 2, 2, 1000, 1);
    const out = field.resolve();
    expect(ink(field) / (1000 * 360)).toBeCloseTo(1, 1);
    // Halfway along, the two spreads (30 px each side, scaled by a half, one with half a line width added) sum to a
    // triangle peaking at 1000 / 61 lines per pixel; averaging over a step takes a little off the peak.
    const row = 200 * field.cols;
    expect(Math.abs(out[row + 200]! / (1000 / 61) - 1)).toBeLessThan(0.1);
    expect(out[row + 20]!).toBe(0);
  });

  it("draws a single line as a count of one across its width", () => {
    const field = new LineField();
    field.reset(100, 100, 1);
    field.addBundle(50, 0, 50, 100, 0, 0, 0, 0, 1, 1);
    const out = field.resolve();
    const row = 50 * field.cols;
    // Averaged over a step: one line a pixel wide spreads over the vertices next to it, summing to one.
    expect(out[row + 49]! + out[row + 50]! + out[row + 51]!).toBeCloseTo(1, 5);
    expect(out[row + 40]!).toBe(0);
  });

  it("spreads a cell's inside ink over its box, none at its edges, and clears what lies outside a hull", () => {
    const field = new LineField();
    field.reset(100, 100, 1);
    field.addCell(20, 20, 80, 80, 100, 1);
    const mean = 0.5214 * 60;
    expect(ink(field) / (100 * mean)).toBeCloseTo(1, 1);
    const out = field.out;
    expect(out[50 * field.cols + 50]!).toBeGreaterThan(out[50 * field.cols + 22]!);
    // Written on a coarser grid (the box is wide), so its edge is interpolated: little there, nothing past it.
    expect(out[50 * field.cols + 20]!).toBeLessThan(out[50 * field.cols + 50]! / 10);
    expect(out[50 * field.cols + 10]!).toBe(0);
    // A cell smaller than a step goes onto one vertex.
    const small = new LineField();
    small.reset(100, 100, 4);
    small.addCell(41, 41, 42, 42, 10, 1);
    expect(ink(small)).toBeGreaterThan(0);
    // The hull: a triangle over the left half.
    field.clip(Float64Array.of(0, 0, 50, 50, 0, 100), 3);
    expect(field.out[50 * field.cols + 60]!).toBe(0);
    expect(field.out[50 * field.cols + 40]!).toBeGreaterThan(0);
  });

  it("leaves out bundles off the view, and clears between frames", () => {
    const field = new LineField();
    field.reset(100, 100, 1);
    field.addBundle(-500, -500, -400, -300, 2, 2, 1, 1, 10, 1);
    expect(ink(field)).toBe(0);
    field.addBundle(10, 10, 90, 90, 2, 2, 1, 1, 10, 1);
    expect(ink(field)).toBeGreaterThan(0);
    field.reset(100, 100, 1);
    expect(field.used).toBe(false);
    expect(ink(field)).toBe(0);
  });
});
