/**
 * Level of detail for a large graph's plain edges, computed once per graph and read every frame without
 * resampling: edges are ranked so the ones a reader can tell apart come first, cut into levels that double in
 * size, and measured on a world-space grid. A frame draws whole levels while they fit its budget for the view,
 * fades the next one in, and shows what is left as a density read from the grid, which is fixed in world space and
 * so cannot flicker while the view moves.
 *
 * The rank is `1 / deg(u) + 1 / deg(v)`, the effective resistance of an edge in a tree and a cheap estimate of it
 * elsewhere (Spielman and Srivastava sample sparsifiers by it; Eades, Nguyen, and Hong draw big graphs from such
 * sparsifiers): edges between nodes with few neighbours, bridges among them, come first, and edges inside dense
 * cores, which a reader cannot tell apart anyway, come last and are shown by the density.
 */

/** Edges in the first level; each further level doubles the total. */
export const FIRST_LEVEL_EDGES = 1024;
/** Cells along the longer side of the grid the levels are measured on. */
export const GRID_CELLS = 256;

export interface EdgeLevels {
  /** Edge indices in drawing order. */
  readonly order: Uint32Array;
  /** Level `k` is `order[levelStart[k]]` to `order[levelStart[k + 1] - 1]`; `levelStart` has one entry per level plus one. */
  readonly levelStart: Uint32Array;
  readonly levels: number;
  /** The grid: `cols` x `rows` square cells `cell` world units wide from (`minX`, `minY`). */
  readonly minX: number;
  readonly minY: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /**
   * Per level `k`, a summed-area table ((`cols` + 1) x (`rows` + 1), row by row) of the world length of the edges in
   * levels 0 to `k`, cut by the cells they cross.
   */
  readonly lengthUpTo: readonly Float32Array[];
  /** Per level `k`, the world length per cell (`cols` x `rows`) of the edges in levels `k` and above; one more, all zeros, ends it. */
  readonly lengthFrom: readonly Float32Array[];
}

/** A small deterministic hash, to break ties between equal ranks without favouring input order. */
function mix(e: number): number {
  let h = Math.imul(e ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Rank and measure `edges` (indices into `source`/`target`) of a graph whose nodes are at `x`, `y`. `degree` counts
 * every edge of a node, drawn here or not.
 */
export function buildEdgeLevels(edges: Uint32Array, source: Uint32Array, target: Uint32Array, x: Float64Array, y: Float64Array, degree: Uint32Array): EdgeLevels {
  const count = edges.length;
  // Rank: higher first, ties by hash. Sort indices by a float key.
  const key = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const e = edges[k]!;
    key[k] = 1 / Math.max(1, degree[source[e]!]!) + 1 / Math.max(1, degree[target[e]!]!) + mix(e) * 1e-9;
  }
  const byRank = new Uint32Array(count);
  for (let k = 0; k < count; k++) byRank[k] = k;
  byRank.sort((a, b) => key[b]! - key[a]!);
  const order = new Uint32Array(count);
  for (let k = 0; k < count; k++) order[k] = edges[byRank[k]!]!;

  const starts = [0];
  let size = FIRST_LEVEL_EDGES;
  while (starts[starts.length - 1]! < count) {
    starts.push(Math.min(count, size));
    size *= 2;
  }
  if (starts.length === 1) starts.push(0);
  const levelStart = Uint32Array.from(starts);
  const levels = levelStart.length - 1;

  // The grid over every endpoint.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < count; k++) {
    const e = order[k]!;
    for (const n of [source[e]!, target[e]!]) {
      const px = x[n]!;
      const py = y[n]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (!(maxX >= minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const cell = span / GRID_CELLS;
  const cols = Math.max(1, Math.min(GRID_CELLS, Math.ceil((maxX - minX) / cell + 1e-9)));
  const rows = Math.max(1, Math.min(GRID_CELLS, Math.ceil((maxY - minY) / cell + 1e-9)));

  const own: Float32Array[] = [];
  for (let level = 0; level < levels; level++) {
    const grid = new Float32Array(cols * rows);
    for (let k = levelStart[level]!; k < levelStart[level + 1]!; k++) {
      const e = order[k]!;
      rasterizeLength(grid, cols, rows, (x[source[e]!]! - minX) / cell, (y[source[e]!]! - minY) / cell, (x[target[e]!]! - minX) / cell, (y[target[e]!]! - minY) / cell, cell);
    }
    own.push(grid);
  }
  const lengthFrom: Float32Array[] = new Array(levels + 1);
  lengthFrom[levels] = new Float32Array(cols * rows);
  for (let level = levels - 1; level >= 0; level--) {
    const grid = new Float32Array(cols * rows);
    const below = lengthFrom[level + 1]!;
    const mine = own[level]!;
    for (let c = 0; c < grid.length; c++) grid[c] = below[c]! + mine[c]!;
    lengthFrom[level] = grid;
  }
  const lengthUpTo: Float32Array[] = [];
  const running = new Float32Array(cols * rows);
  for (let level = 0; level < levels; level++) {
    const mine = own[level]!;
    for (let c = 0; c < running.length; c++) running[c]! += mine[c]!;
    lengthUpTo.push(summedArea(running, cols, rows));
  }
  return { order, levelStart, levels, minX, minY, cell, cols, rows, lengthUpTo, lengthFrom };
}

/** A summed-area table of `grid`, one row and column larger, so a rectangle's sum is four reads. */
function summedArea(grid: Float32Array, cols: number, rows: number): Float32Array {
  const w = cols + 1;
  const table = new Float32Array(w * (rows + 1));
  for (let r = 0; r < rows; r++) {
    let row = 0;
    for (let c = 0; c < cols; c++) {
      row += grid[r * cols + c]!;
      table[(r + 1) * w + c + 1] = table[r * w + c + 1]! + row;
    }
  }
  return table;
}

/**
 * Add the length (world units: grid units times `cell`) of the segment from (`ax`, `ay`) to (`bx`, `by`), in grid
 * units, to every cell of `grid` it crosses, walking the cells in order (Amanatides and Woo). Parts outside the grid
 * go to the nearest edge cell.
 */
export function rasterizeLength(grid: Float32Array, cols: number, rows: number, ax: number, ay: number, bx: number, by: number, cell: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.sqrt(dx * dx + dy * dy);
  const clampX = (v: number): number => Math.min(cols - 1, Math.max(0, Math.floor(v)));
  const clampY = (v: number): number => Math.min(rows - 1, Math.max(0, Math.floor(v)));
  let cx = clampX(ax);
  let cy = clampY(ay);
  if (!(length > 0)) return;
  const endX = clampX(bx);
  const endY = clampY(by);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  // Parameter along the segment (0 to 1) where it crosses the next vertical and horizontal cell boundary.
  const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let nextX = dx !== 0 ? ((dx > 0 ? cx + 1 : cx) - ax) / dx : Infinity;
  let nextY = dy !== 0 ? ((dy > 0 ? cy + 1 : cy) - ay) / dy : Infinity;
  let t = 0;
  const world = length * cell;
  // At most one step per cell boundary crossed.
  for (let guard = cols + rows + 2; guard > 0; guard--) {
    if (cx === endX && cy === endY) break;
    const next = Math.min(nextX, nextY, 1);
    grid[cy * cols + cx]! += (next - t) * world;
    t = next;
    if (t >= 1) return;
    if (nextX < nextY) {
      nextX += deltaX;
      if (cx + stepX >= 0 && cx + stepX < cols) cx += stepX;
    } else {
      nextY += deltaY;
      if (cy + stepY >= 0 && cy + stepY < rows) cy += stepY;
    }
  }
  grid[cy * cols + cx]! += Math.max(0, 1 - t) * world;
}

/**
 * The sum of a summed-area table over the world rectangle, with partial cells weighted by how much of them it
 * covers (the table read at fractional corners, interpolated), so the sum moves smoothly as the rectangle does.
 */
export function rectSum(levels: EdgeLevels, table: Float32Array, minX: number, minY: number, maxX: number, maxY: number): number {
  const { cols, rows, cell } = levels;
  const gx0 = Math.min(cols, Math.max(0, (minX - levels.minX) / cell));
  const gx1 = Math.min(cols, Math.max(0, (maxX - levels.minX) / cell));
  const gy0 = Math.min(rows, Math.max(0, (minY - levels.minY) / cell));
  const gy1 = Math.min(rows, Math.max(0, (maxY - levels.minY) / cell));
  if (gx1 <= gx0 || gy1 <= gy0) return 0;
  const at = (gx: number, gy: number): number => {
    const w = cols + 1;
    const c = Math.min(cols - 1, Math.floor(gx));
    const r = Math.min(rows - 1, Math.floor(gy));
    const fx = gx - c;
    const fy = gy - r;
    const a = table[r * w + c]!;
    const b = table[r * w + c + 1]!;
    const d = table[(r + 1) * w + c]!;
    const e = table[(r + 1) * w + c + 1]!;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  };
  return at(gx1, gy1) - at(gx0, gy1) - at(gx1, gy0) + at(gx0, gy0);
}

/**
 * What a frame draws: every edge before `full` at full opacity, those from `full` to `end` faded to `fade`, and the
 * rest as density. Chosen as the most levels whose length on the view, times `zoom` and the line width, fits
 * `budget` (CSS pixels of line area), with the next level faded in by how much of it fits.
 */
export function edgesForView(levels: EdgeLevels, minX: number, minY: number, maxX: number, maxY: number, zoom: number, lineWidth: number, budget: number): { full: number; end: number; fade: number; level: number } {
  const cost = (level: number): number => rectSum(levels, levels.lengthUpTo[level]!, minX, minY, maxX, maxY) * zoom * Math.max(1, lineWidth);
  let level = -1;
  let spent = 0;
  for (let k = 0; k < levels.levels; k++) {
    const c = cost(k);
    if (c > budget) {
      const fade = c > spent ? Math.min(1, Math.max(0, (budget - spent) / (c - spent))) : 1;
      return { full: level < 0 ? 0 : levels.levelStart[level + 1]!, end: levels.levelStart[k + 1]!, fade, level: k };
    }
    level = k;
    spent = c;
  }
  const all = levels.levelStart[levels.levels]!;
  return { full: all, end: all, fade: 1, level: levels.levels };
}
