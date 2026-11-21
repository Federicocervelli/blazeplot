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
  /** Per merged edge: its color with the opacity of its edges drawn over each other, quantized (see `quantize`). */
  readonly edgeKey: Uint32Array;
  /** Merged edges heaviest first (ties by index), and in order of `edgeKey` (ties by index): fixed per level, so a frame sorts nothing. */
  readonly byWeight: Uint32Array;
  readonly byKey: Uint32Array;
  /** Per merged edge: its place in `byWeight`. */
  readonly rank: Uint32Array;
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

/**
 * An open-addressing hash from a non-negative integer key (below 2^53) to a dense index, kept at most half full.
 * Slots hold key + 1, so a new table is empty as allocated. It can grow in steps (`startGrowth`, `growStep`), so a
 * job that grows a large one spreads the work over slices; `indexOf` grows it at once when it must.
 */
class IndexHash {
  private keys: Float64Array;
  private values: Int32Array;
  private mask: number;
  size = 0;
  /** While growing: the old table, and how many of its slots have been moved. */
  private old: Float64Array | null = null;
  private oldValues: Int32Array | null = null;
  private moved = 0;

  constructor(capacity: number) {
    let size = 16;
    while (size < capacity * 2) size *= 2;
    this.keys = new Float64Array(size);
    this.values = new Int32Array(size);
    this.mask = size - 1;
  }

  /** Whether adding `extra` keys could fill the table past half. */
  needsGrowth(extra: number): boolean {
    return (this.size + extra) * 2 >= this.keys.length;
  }

  /** Start doubling the table until it holds `extra` more keys at most half full; finish with `growStep`. */
  startGrowth(extra: number): void {
    let size = this.keys.length;
    while ((this.size + extra) * 2 >= size) size *= 2;
    this.old = this.keys;
    this.oldValues = this.values;
    this.moved = 0;
    this.keys = new Float64Array(size);
    this.values = new Int32Array(size);
    this.mask = size - 1;
  }

  /** Move up to `slots` slots of the old table into the new one; returns true once all are moved. */
  growStep(slots: number): boolean {
    const old = this.old;
    const values = this.oldValues;
    if (!old || !values) return true;
    const end = Math.min(old.length, this.moved + slots);
    for (let i = this.moved; i < end; i++) {
      const stored = old[i]!;
      if (stored === 0) continue;
      let slot = hash(stored - 1) & this.mask;
      while (this.keys[slot] !== 0) slot = (slot + 1) & this.mask;
      this.keys[slot] = stored;
      this.values[slot] = values[i]!;
    }
    this.moved = end;
    if (end < old.length) return false;
    this.old = null;
    this.oldValues = null;
    return true;
  }

  /** The index for `key`, made the next free one when the key is new. */
  indexOf(key: number): number {
    if (this.old) while (!this.growStep(Infinity));
    if (this.size * 2 >= this.keys.length) {
      this.startGrowth(1);
      this.growStep(Infinity);
    }
    const mask = this.mask;
    const stored = key + 1;
    let slot = hash(key) & mask;
    for (;;) {
      const at = this.keys[slot]!;
      if (at === stored) return this.values[slot]!;
      if (at === 0) {
        this.keys[slot] = stored;
        this.values[slot] = this.size;
        return this.size++;
      }
      slot = (slot + 1) & mask;
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
  private phase: "nodes" | "edges" | "keys" | "byWeight" | "rank" | "byKey" | "done" = "nodes";
  /** What the last phases build, a slice each, so no slice of a large level runs long. */
  private edgeKey: Uint32Array = new Uint32Array(0);
  private heaviest = 0;
  private byWeight: Uint32Array = new Uint32Array(0);
  private rank: Uint32Array = new Uint32Array(0);
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
      if (this.grow(this.cells, end - this.next, now, deadline)) return null;
      this.binNodes(this.next, end);
      this.next = end;
      if (end === f.count) {
        this.phase = "edges";
        this.next = 0;
        // Sized for a few merged edges a cell, so a large level grows its table seldom (each growth is one slice).
        this.pairs = new IndexHash(Math.max(16, Math.min(f.edgeCount, this.cells.size * 4)));
      }
      if (now() > deadline) return null;
    }
    while (this.phase === "edges") {
      const end = Math.min(f.edgeCount, this.next + CHECK_EVERY);
      if (this.grow(this.pairs!, end - this.next, now, deadline)) return null;
      this.mergeEdges(this.next, end);
      this.next = end;
      if (end === f.edgeCount) {
        this.phase = "keys";
        this.next = 0;
        const merged = this.pairs?.size ?? 0;
        this.edgeKey = new Uint32Array(merged);
      }
      if (now() > deadline) return null;
    }
    const merged = this.pairs?.size ?? 0;
    while (this.phase === "keys") {
      // Average colors, then each merged edge's color with its opacity, quantized.
      const end = Math.min(merged, this.next + CHECK_EVERY);
      for (let k = this.next; k < end; k++) {
        const w = this.edgeWeight[k]!;
        for (let c = 0; c < 4; c++) this.edgeColors[k * 4 + c]! /= w;
        this.edgeKey[k] = quantize(this.edgeColors, k * 4, 1 - (1 - this.edgeColors[k * 4 + 3]!) ** w);
        if (w > this.heaviest) this.heaviest = w;
      }
      this.next = end;
      if (end === merged) this.phase = "byWeight";
      if (now() > deadline) return null;
    }
    // Weights past this share the last bucket, kept in index order: as heavy as any edge needs to be told apart.
    const top = Math.min(this.heaviest, 1 << 16);
    if (this.phase === "byWeight") {
      const weight = this.edgeWeight;
      this.byWeight = countingSort(merged, top + 1, (k) => top - Math.min(top, weight[k]!));
      this.phase = "rank";
      if (now() > deadline) return null;
    }
    if (this.phase === "rank") {
      this.rank = new Uint32Array(merged);
      for (let j = 0; j < merged; j++) this.rank[this.byWeight[j]!] = j;
      this.phase = "byKey";
      if (now() > deadline) return null;
    }
    if (this.phase === "byKey") {
      this.finish(countingSort(merged, KEYS, (k) => this.edgeKey[k]!));
      this.phase = "done";
    }
    return this.result;
  }

  /**
   * Make room in `table` for `extra` more keys before a chunk adds them, a slice at a time: returns true when the
   * deadline passed first, to go on next slice.
   */
  private grow(table: IndexHash, extra: number, now: () => number, deadline: number): boolean {
    if (!this.growing) {
      if (!table.needsGrowth(extra)) return false;
      table.startGrowth(extra);
      this.growing = true;
    }
    while (!table.growStep(CHECK_EVERY * 8)) if (now() > deadline) return true;
    this.growing = false;
    return false;
  }
  private growing = false;

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

  private finish(byKey: Uint32Array): void {
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
      edgeKey: this.edgeKey,
      byWeight: this.byWeight,
      byKey,
      rank: this.rank,
    };
  }
}

/** A color as 5 bits a channel and 16 opacity steps: an integer below 2^19. */
export function quantize(colors: Float32Array, at: number, alpha: number): number {
  const c = (v: number): number => (v > 0 ? (v < 1 ? Math.round(v * 31) : 31) : 0);
  const a = alpha > 0 ? (alpha < 1 ? Math.max(1, Math.round(alpha * 15)) : 15) : 0;
  return ((c(colors[at]!) * 32 + c(colors[at + 1]!)) * 32 + c(colors[at + 2]!)) * 16 + a;
}

/** Write a quantized color as straight rgba at `out[at..at+3]`. */
export function unquantize(key: number, out: Float32Array, at: number): void {
  out[at + 3] = (key % 16) / 15;
  key = Math.floor(key / 16);
  out[at + 2] = (key % 32) / 31;
  key = Math.floor(key / 32);
  out[at + 1] = (key % 32) / 31;
  out[at] = Math.floor(key / 32) / 31;
}

/** Quantized colors are below this. */
const KEYS = 1 << 19;

/** Indices `0..count` stably sorted by an integer `key` below `keys` (a counting sort: linear, no comparisons). */
function countingSort(count: number, keys: number, key: (k: number) => number): Uint32Array {
  const start = new Uint32Array(keys + 1);
  for (let k = 0; k < count; k++) start[key(k) + 1]!++;
  for (let v = 0; v < keys; v++) start[v + 1]! += start[v]!;
  const out = new Uint32Array(count);
  for (let k = 0; k < count; k++) out[start[key(k)]!++] = k;
  return out;
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
