/**
 * The zoomed-out level of detail: nodes binned into square cells of one size, each drawn as one dot at its
 * nodes' centroid in their average color, and edges merged per pair of cells, each drawn once with the opacity
 * its edges have when drawn over each other (1 - (1 - alpha)^count). What a frame draws is then bounded by the
 * cells on screen, not by the graph.
 *
 * A level is built by an `AggregateJob` in slices of a few milliseconds, between frames, so building one for
 * hundreds of thousands of items never stalls a frame. Pure: no DOM, no chart.
 */

export interface Aggregate {
  /** The cell size this level was built with, in graph units. */
  readonly cell: number;
  readonly cellCount: number;
  /** Per cell: centroid x, y in graph units. */
  readonly cellX: Float64Array;
  readonly cellY: Float64Array;
  readonly cellNodes: Uint32Array;
  /** Per cell: average straight fill r, g, b, a. */
  readonly cellColor: Float32Array;
  readonly edgeCount: number;
  /** Per merged edge: its two cells, how many edges it stands for, and their average color r, g, b, a. */
  readonly edgeA: Uint32Array;
  readonly edgeB: Uint32Array;
  readonly edgeWeight: Uint32Array;
  readonly edgeColor: Float32Array;
}

/** What a job reads: positions, endpoints, and the style records with where their colors are. */
export interface AggregateSource {
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly nodeStyles: Float32Array;
  readonly nodeStride: number;
  readonly nodeColorAt: number;
  readonly edgeCount: number;
  readonly source: Uint32Array;
  readonly target: Uint32Array;
  readonly edgeStyles: Float32Array;
  /** Each edge's style record, when records are shared; else edge `e` uses record `e`. */
  readonly edgeSlot?: Uint32Array;
  readonly edgeStride: number;
  readonly edgeColorAt: number;
}

/** An open-addressing hash from a non-negative integer key (below 2^53) to a dense index. */
class IndexHash {
  private keys: Float64Array;
  private values: Int32Array;
  private mask: number;
  size = 0;

  constructor(capacity: number) {
    let size = 16;
    while (size < capacity * 2) size *= 2;
    this.keys = new Float64Array(size).fill(-1);
    this.values = new Int32Array(size);
    this.mask = size - 1;
  }

  /** The index for `key`, made the next free one when the key is new. */
  indexOf(key: number): number {
    if (this.size * 2 >= this.keys.length) this.rehash();
    const mask = this.mask;
    let slot = hash(key) & mask;
    for (;;) {
      const at = this.keys[slot]!;
      if (at === key) return this.values[slot]!;
      if (at === -1) {
        this.keys[slot] = key;
        this.values[slot] = this.size;
        return this.size++;
      }
      slot = (slot + 1) & mask;
    }
  }

  /** Double the table: kept at most half full, so probes stay short. */
  private rehash(): void {
    const keys = this.keys;
    const values = this.values;
    const size = keys.length * 2;
    this.keys = new Float64Array(size).fill(-1);
    this.values = new Int32Array(size);
    this.mask = size - 1;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (key === -1) continue;
      let slot = hash(key) & this.mask;
      while (this.keys[slot] !== -1) slot = (slot + 1) & this.mask;
      this.keys[slot] = key;
      this.values[slot] = values[i]!;
    }
  }
}

/** A multiplicative hash of a key's low and high 32 bits: keys are cell coordinates, so they cluster. */
function hash(key: number): number {
  return Math.imul(key | 0, 0x9e3779b1) ^ Math.imul((key / 4294967296) | 0, 0x85ebca77);
}

/** Offsets that keep cell coordinates non-negative in a key: graphs span far less than 2^25 cells. */
const CELL_OFFSET = 2 ** 25;
const CELL_SPAN = 2 ** 26;
/** Items between two clock reads while a job runs. */
const CHECK_EVERY = 4096;

/** Builds one level in slices: call `step` until it returns the level. */
export class AggregateJob {
  private phase: "nodes" | "edges" | "done" = "nodes";
  private next = 0;
  private readonly cells: IndexHash;
  private readonly nodeCell: Uint32Array;
  private sumX: Float64Array = new Float64Array(1024);
  private sumY: Float64Array = new Float64Array(1024);
  private nodes: Uint32Array = new Uint32Array(1024);
  private colors: Float32Array = new Float32Array(4096);
  private pairs: IndexHash | null = null;
  private edgeA: Uint32Array = new Uint32Array(1024);
  private edgeB: Uint32Array = new Uint32Array(1024);
  private edgeWeight: Uint32Array = new Uint32Array(1024);
  private edgeColors: Float32Array = new Float32Array(4096);
  private result: Aggregate | null = null;

  constructor(
    readonly level: number,
    readonly cell: number,
    private readonly from: AggregateSource,
  ) {
    this.cells = new IndexHash(Math.max(16, Math.min(from.count, 1 << 12)));
    this.nodeCell = new Uint32Array(from.count);
  }

  /** Work until `deadline` (a `now()` reading) passes; returns the level once it is complete. */
  step(now: () => number, deadline: number): Aggregate | null {
    const f = this.from;
    while (this.phase === "nodes") {
      const end = Math.min(f.count, this.next + CHECK_EVERY);
      this.binNodes(this.next, end);
      this.next = end;
      if (end === f.count) {
        this.phase = "edges";
        this.next = 0;
        this.pairs = new IndexHash(Math.max(16, Math.min(f.edgeCount, 1 << 12)));
      }
      if (now() > deadline) return null;
    }
    while (this.phase === "edges") {
      const end = Math.min(f.edgeCount, this.next + CHECK_EVERY);
      this.mergeEdges(this.next, end);
      this.next = end;
      if (end === f.edgeCount) {
        this.finish();
        this.phase = "done";
        break;
      }
      if (now() > deadline) return null;
    }
    return this.result;
  }

  private binNodes(start: number, end: number): void {
    const f = this.from;
    const cell = this.cell;
    const styles = f.nodeStyles;
    for (let i = start; i < end; i++) {
      const cx = Math.floor(f.x[i]! / cell) + CELL_OFFSET;
      const cy = Math.floor(f.y[i]! / cell) + CELL_OFFSET;
      const c = this.cells.indexOf(cy * CELL_SPAN + cx);
      if (c >= this.nodes.length) {
        this.sumX = growF64(this.sumX, c + 1);
        this.sumY = growF64(this.sumY, c + 1);
        this.nodes = growU32(this.nodes, c + 1);
        this.colors = growF32(this.colors, (c + 1) * 4);
      }
      this.nodeCell[i] = c;
      this.sumX[c]! += f.x[i]!;
      this.sumY[c]! += f.y[i]!;
      this.nodes[c]!++;
      const o = i * f.nodeStride + f.nodeColorAt;
      const k = c * 4;
      this.colors[k]! += styles[o]!;
      this.colors[k + 1]! += styles[o + 1]!;
      this.colors[k + 2]! += styles[o + 2]!;
      this.colors[k + 3]! += styles[o + 3]!;
    }
  }

  private mergeEdges(start: number, end: number): void {
    const f = this.from;
    const cellCount = this.cells.size;
    const pairs = this.pairs!;
    const styles = f.edgeStyles;
    for (let e = start; e < end; e++) {
      const a = this.nodeCell[f.source[e]!]!;
      const b = this.nodeCell[f.target[e]!]!;
      if (a === b) continue;
      // Directions merge too: arrows are not drawn at this size.
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const k = pairs.indexOf(lo * cellCount + hi);
      if (k >= this.edgeA.length) {
        this.edgeA = growU32(this.edgeA, k + 1);
        this.edgeB = growU32(this.edgeB, k + 1);
        this.edgeWeight = growU32(this.edgeWeight, k + 1);
        this.edgeColors = growF32(this.edgeColors, (k + 1) * 4);
      }
      this.edgeA[k] = lo;
      this.edgeB[k] = hi;
      this.edgeWeight[k]!++;
      const o = (f.edgeSlot ? f.edgeSlot[e]! : e) * f.edgeStride + f.edgeColorAt;
      const q = k * 4;
      this.edgeColors[q]! += styles[o]!;
      this.edgeColors[q + 1]! += styles[o + 1]!;
      this.edgeColors[q + 2]! += styles[o + 2]!;
      this.edgeColors[q + 3]! += styles[o + 3]!;
    }
  }

  private finish(): void {
    const cellCount = this.cells.size;
    const cellX = new Float64Array(cellCount);
    const cellY = new Float64Array(cellCount);
    const cellColor = new Float32Array(cellCount * 4);
    for (let c = 0; c < cellCount; c++) {
      const n = this.nodes[c]!;
      cellX[c] = this.sumX[c]! / n;
      cellY[c] = this.sumY[c]! / n;
      for (let k = 0; k < 4; k++) cellColor[c * 4 + k] = this.colors[c * 4 + k]! / n;
    }
    const merged = this.pairs?.size ?? 0;
    for (let k = 0; k < merged; k++) {
      const w = this.edgeWeight[k]!;
      for (let c = 0; c < 4; c++) this.edgeColors[k * 4 + c]! /= w;
    }
    this.result = {
      cell: this.cell,
      cellCount,
      cellX,
      cellY,
      cellNodes: this.nodes.slice(0, cellCount),
      cellColor,
      edgeCount: merged,
      edgeA: this.edgeA.subarray(0, merged),
      edgeB: this.edgeB.subarray(0, merged),
      edgeWeight: this.edgeWeight.subarray(0, merged),
      edgeColor: this.edgeColors.subarray(0, merged * 4),
    };
  }
}

/** Build a level at once (tests, small graphs). */
export function buildAggregate(cell: number, from: AggregateSource): Aggregate {
  return new AggregateJob(0, cell, from).step(() => 0, Infinity)!;
}

function growF64(a: Float64Array, need: number): Float64Array {
  const b = new Float64Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

function growF32(a: Float32Array, need: number): Float32Array {
  const b = new Float32Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

function growU32(a: Uint32Array, need: number): Uint32Array {
  const b = new Uint32Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}
