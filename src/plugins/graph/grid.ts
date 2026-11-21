/**
 * Dense spatial grids over the graph, built by counting sort into flat typed arrays, so a query for a view
 * returns what can be on it without touching the rest of the graph. Pure: no DOM, no chart.
 *
 * - `PointGrid` lists every node by its center. A query grows its rectangle by the largest node's half size.
 * - `BoxGrid` lists every edge in each cell its bounding box covers; an edge covering more than
 *   `MAX_CELLS_PER_ITEM` cells goes to a list of long edges that every query returns.
 */

/** A rectangle in graph units. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Cells per axis at most, so a grid's cell count stays a few times the item count at worst. */
const MAX_AXIS_CELLS = 4096;
/** An edge spanning more cells than this is long: kept on one list instead of in every cell. */
const MAX_CELLS_PER_ITEM = 64;

/** Grid geometry shared by both grids: origin, cell size, and size in cells. */
class GridFrame {
  originX = 0;
  originY = 0;
  cell = 1;
  cols = 1;
  rows = 1;

  fit(minX: number, minY: number, maxX: number, maxY: number, targetCells: number): void {
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    // Square cells, about `targetCells` of them over the bounds.
    let cell = Math.sqrt((spanX * spanY) / Math.max(1, targetCells));
    cell = Math.max(cell, spanX / MAX_AXIS_CELLS, spanY / MAX_AXIS_CELLS, 1e-9);
    this.cell = cell;
    this.originX = minX;
    this.originY = minY;
    this.cols = Math.min(MAX_AXIS_CELLS, Math.max(1, Math.ceil(spanX / cell) + 1));
    this.rows = Math.min(MAX_AXIS_CELLS, Math.max(1, Math.ceil(spanY / cell) + 1));
  }

  col(x: number): number {
    const c = Math.floor((x - this.originX) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  row(y: number): number {
    const r = Math.floor((y - this.originY) / this.cell);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }
}

/** Nodes by center. */
export class PointGrid {
  readonly frame = new GridFrame();
  /** Per cell, where its items start in `items` (one more entry than cells). */
  private starts = new Uint32Array(1);
  private items = new Uint32Array(0);
  private cellOf = new Uint32Array(0);
  private count = 0;
  /** Items moved since the build: every query returns them, and their stale cell entries are skipped. */
  private moved: number[] = [];
  private isMoved = new Uint8Array(0);

  /** How many items moved since the build. */
  get movedCount(): number {
    return this.moved.length;
  }

  /** Mark an item as moved: it is returned by every query until the next build. */
  markMoved(i: number): void {
    if (i >= this.isMoved.length || this.isMoved[i]) return;
    this.isMoved[i] = 1;
    this.moved.push(i);
  }

  build(count: number, x: Float64Array, y: Float64Array): void {
    this.count = count;
    this.moved = [];
    this.isMoved = new Uint8Array(count);
    if (count === 0) {
      this.starts = new Uint32Array(1);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const px = x[i]!;
      const py = y[i]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const frame = this.frame;
    // About four nodes a cell.
    frame.fit(minX, minY, maxX, maxY, count / 4);
    const cells = frame.cols * frame.rows;
    const starts = new Uint32Array(cells + 1);
    if (this.cellOf.length < count) this.cellOf = new Uint32Array(count);
    const cellOf = this.cellOf;
    for (let i = 0; i < count; i++) {
      const c = frame.row(y[i]!) * frame.cols + frame.col(x[i]!);
      cellOf[i] = c;
      starts[c + 1]!++;
    }
    for (let c = 0; c < cells; c++) starts[c + 1]! += starts[c]!;
    const cursor = starts.slice(0, cells);
    const items = this.items.length >= count ? this.items : new Uint32Array(count);
    for (let i = 0; i < count; i++) items[cursor[cellOf[i]!]!++] = i;
    this.starts = starts;
    this.items = items;
  }

  /** Items in cells overlapping `rect`, in no particular order. Returns how many were written to `out`. */
  query(rect: Rect, out: { data: Uint32Array }): number {
    if (this.count === 0) return 0;
    const frame = this.frame;
    const c0 = frame.col(rect.minX);
    const c1 = frame.col(rect.maxX);
    const r0 = frame.row(rect.minY);
    const r1 = frame.row(rect.maxY);
    let n = 0;
    const moved = this.moved.length > 0;
    for (let r = r0; r <= r1; r++) {
      const first = this.starts[r * frame.cols + c0]!;
      const last = this.starts[r * frame.cols + c1 + 1]!;
      const size = last - first;
      if (n + size > out.data.length) out.data = grow(out.data, n + size);
      if (!moved) {
        out.data.set(this.items.subarray(first, last), n);
        n += size;
        continue;
      }
      for (let k = first; k < last; k++) {
        const i = this.items[k]!;
        if (!this.isMoved[i]) out.data[n++] = i;
      }
    }
    if (moved) {
      if (n + this.moved.length > out.data.length) out.data = grow(out.data, n + this.moved.length);
      for (const i of this.moved) out.data[n++] = i;
    }
    return n;
  }

  /** How many items are in cells overlapping `rect`: an upper bound of what a query returns, at a row's cost. */
  countIn(rect: Rect): number {
    if (this.count === 0) return 0;
    const frame = this.frame;
    const c0 = frame.col(rect.minX);
    const c1 = frame.col(rect.maxX);
    const r0 = frame.row(rect.minY);
    const r1 = frame.row(rect.maxY);
    let n = this.moved.length;
    for (let r = r0; r <= r1; r++) n += this.starts[r * frame.cols + c1 + 1]! - this.starts[r * frame.cols + c0]!;
    return n;
  }
}

/** Edges by bounding box, with long edges on their own list. */
export class BoxGrid {
  readonly frame = new GridFrame();
  private starts = new Uint32Array(1);
  private items = new Uint32Array(0);
  /** Edges spanning more than `MAX_CELLS_PER_ITEM` cells: every query returns them. */
  long = new Uint32Array(0);
  /** Per edge, the query stamp it was last returned for, so an edge in several cells comes out once. */
  private seen = new Uint32Array(0);
  private stamp = 0;
  private count = 0;
  /** Edges moved since the build (their node was dragged): every query returns them, their stale entries skipped. */
  private moved: number[] = [];
  private isMoved = new Uint8Array(0);

  /** How many edges moved since the build. */
  get movedCount(): number {
    return this.moved.length;
  }

  /** Mark an edge as moved: it is returned by every query until the next build. */
  markMoved(e: number): void {
    if (e >= this.isMoved.length || this.isMoved[e]) return;
    this.isMoved[e] = 1;
    this.moved.push(e);
  }

  /**
   * Build over `count` edges between points (`ax[source]`, `ay[source]`) and the target's, positions in graph
   * units; `pad` grows every box (the largest node half size), so an edge is listed where its ends' boxes are.
   */
  build(count: number, source: Uint32Array, target: Uint32Array, x: Float64Array, y: Float64Array, pad: number): void {
    this.count = count;
    this.moved = [];
    this.isMoved = new Uint8Array(count);
    if (this.seen.length < count) this.seen = new Uint32Array(count);
    else this.seen.fill(0, 0, count);
    this.stamp = 0;
    if (count === 0) {
      this.starts = new Uint32Array(1);
      this.long = new Uint32Array(0);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let lengths = 0;
    for (let i = 0; i < count; i++) {
      const s = source[i]!;
      const t = target[i]!;
      const x0 = x[s]!;
      const y0 = y[s]!;
      const x1 = x[t]!;
      const y1 = y[t]!;
      if (x0 < minX) minX = x0;
      if (x0 > maxX) maxX = x0;
      if (y0 < minY) minY = y0;
      if (y0 > maxY) maxY = y0;
      if (x1 < minX) minX = x1;
      if (x1 > maxX) maxX = x1;
      if (y1 < minY) minY = y1;
      if (y1 > maxY) maxY = y1;
      lengths += Math.abs(x1 - x0) + Math.abs(y1 - y0);
    }
    const frame = this.frame;
    // Cells about the size of a typical edge, so most edges cover a few cells, and no more cells than edges.
    const typical = Math.max(lengths / count, pad * 2, 1e-9);
    const spanArea = Math.max(maxX - minX, 1e-6) * Math.max(maxY - minY, 1e-6);
    frame.fit(minX - pad, minY - pad, maxX + pad, maxY + pad, Math.min(count, spanArea / (typical * typical)));
    const cols = frame.cols;
    const cells = cols * frame.rows;
    const starts = new Uint32Array(cells + 1);
    let longCount = 0;
    // First pass: count, per cell, the edges whose box covers it.
    for (let i = 0; i < count; i++) {
      const s = source[i]!;
      const t = target[i]!;
      const c0 = frame.col(Math.min(x[s]!, x[t]!) - pad);
      const c1 = frame.col(Math.max(x[s]!, x[t]!) + pad);
      const r0 = frame.row(Math.min(y[s]!, y[t]!) - pad);
      const r1 = frame.row(Math.max(y[s]!, y[t]!) + pad);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS_PER_ITEM) {
        longCount++;
        continue;
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) starts[r * cols + c + 1]!++;
    }
    for (let c = 0; c < cells; c++) starts[c + 1]! += starts[c]!;
    const total = starts[cells]!;
    const items = this.items.length >= total ? this.items : new Uint32Array(total);
    const long = new Uint32Array(longCount);
    const cursor = starts.slice(0, cells);
    let l = 0;
    for (let i = 0; i < count; i++) {
      const s = source[i]!;
      const t = target[i]!;
      const c0 = frame.col(Math.min(x[s]!, x[t]!) - pad);
      const c1 = frame.col(Math.max(x[s]!, x[t]!) + pad);
      const r0 = frame.row(Math.min(y[s]!, y[t]!) - pad);
      const r1 = frame.row(Math.max(y[s]!, y[t]!) + pad);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS_PER_ITEM) {
        long[l++] = i;
        continue;
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) items[cursor[r * cols + c]!++] = i;
    }
    this.starts = starts;
    this.items = items;
    this.long = long;
  }

  /** An upper bound of what `query(rect)` returns (edges in several cells count once per cell), at a row's cost. */
  countIn(rect: Rect): number {
    if (this.count === 0) return 0;
    const frame = this.frame;
    const c0 = frame.col(rect.minX);
    const c1 = frame.col(rect.maxX);
    const r0 = frame.row(rect.minY);
    const r1 = frame.row(rect.maxY);
    let n = this.long.length + this.moved.length;
    for (let r = r0; r <= r1; r++) n += this.starts[r * frame.cols + c1 + 1]! - this.starts[r * frame.cols + c0]!;
    return n;
  }

  /** Edges whose box may overlap `rect`, each once, plus every long edge. Returns how many were written. */
  query(rect: Rect, out: { data: Uint32Array }): number {
    if (this.count === 0) return 0;
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    const seen = this.seen;
    const frame = this.frame;
    const c0 = frame.col(rect.minX);
    const c1 = frame.col(rect.maxX);
    const r0 = frame.row(rect.minY);
    const r1 = frame.row(rect.maxY);
    let n = 0;
    let data = out.data;
    const need = (extra: number): void => {
      if (n + extra > data.length) data = out.data = grow(data, n + extra);
    };
    for (let r = r0; r <= r1; r++) {
      const first = this.starts[r * frame.cols + c0]!;
      const last = this.starts[r * frame.cols + c1 + 1]!;
      need(last - first);
      for (let k = first; k < last; k++) {
        const i = this.items[k]!;
        if (seen[i] === stamp || this.isMoved[i]) continue;
        seen[i] = stamp;
        data[n++] = i;
      }
    }
    need(this.long.length + this.moved.length);
    for (let k = 0; k < this.long.length; k++) {
      const i = this.long[k]!;
      if (!this.isMoved[i]) data[n++] = i;
    }
    for (const i of this.moved) data[n++] = i;
    return n;
  }
}

function grow(data: Uint32Array, need: number): Uint32Array {
  const grown = new Uint32Array(Math.max(need, data.length * 2, 64));
  grown.set(data);
  return grown;
}
