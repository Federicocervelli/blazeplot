/**
 * The graph model: validated nodes and edges in flat arrays, edge endpoints by index, and a uniform
 * grid over node boxes for picking. Pure: no DOM, no chart.
 */
import type { GraphEdge, GraphLimits, GraphNode } from "./types.js";

export const DEFAULT_MAX_NODES = 100_000;
export const DEFAULT_MAX_EDGES = 500_000;
/** Positions beyond this are rejected: float32 device coordinates lose whole pixels well before it. */
const MAX_COORDINATE = 1e9;

export interface GraphModel<N, E> {
  readonly nodes: readonly GraphNode<N>[];
  readonly nodeIndex: ReadonlyMap<string, number>;
  /** Node centers in graph units; `setPositions` and drags change them in place. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly edges: readonly GraphEdge<E>[];
  readonly edgeIds: readonly string[];
  readonly edgeIndex: ReadonlyMap<string, number>;
  readonly source: Uint32Array;
  readonly target: Uint32Array;
  /** 1 when another edge runs from this edge's target to its source. */
  readonly reversed: Uint8Array;
  readonly skippedEdges: number;
}

/** Read and check a graph. Throws a `RangeError` before allocating anything large when a limit or rule is broken. */
export function buildGraphModel<N, E>(nodes: readonly GraphNode<N>[], edges: readonly GraphEdge<E>[], limits: GraphLimits = {}): GraphModel<N, E> {
  const maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
  const maxEdges = limits.maxEdges ?? DEFAULT_MAX_EDGES;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new TypeError("graph: nodes and edges must be arrays.");
  if (nodes.length > maxNodes) throw new RangeError(`graph: ${nodes.length} nodes is more than the limit of ${maxNodes}.`);
  if (edges.length > maxEdges) throw new RangeError(`graph: ${edges.length} edges is more than the limit of ${maxEdges}.`);

  const nodeIndex = new Map<string, number>();
  const x = new Float64Array(nodes.length);
  const y = new Float64Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (typeof node?.id !== "string" || node.id.length === 0) throw new RangeError(`graph: node ${i} has no id.`);
    if (nodeIndex.has(node.id)) throw new RangeError(`graph: node id "${node.id}" is used twice.`);
    if (!isCoordinate(node.x) || !isCoordinate(node.y)) throw new RangeError(`graph: node "${node.id}" has a position that is not a finite number within ±${MAX_COORDINATE}.`);
    nodeIndex.set(node.id, i);
    x[i] = node.x;
    y[i] = node.y;
  }

  const kept: GraphEdge<E>[] = [];
  const edgeIds: string[] = [];
  const edgeIndex = new Map<string, number>();
  const source = new Uint32Array(edges.length);
  const target = new Uint32Array(edges.length);
  // Directed pairs as one number (`from * count + to`), exact while nodes * nodes stays under 2^53.
  const count = nodes.length;
  const pairs = new Set<number>();
  let skippedEdges = 0;
  for (const edge of edges) {
    const from = nodeIndex.get(edge?.source);
    const to = nodeIndex.get(edge?.target);
    if (from === undefined || to === undefined || from === to) {
      skippedEdges++;
      continue;
    }
    const id = edge.id ?? `${edge.source}->${edge.target}`;
    if (edgeIndex.has(id)) throw new RangeError(`graph: edge id "${id}" is used twice; give parallel edges their own ids.`);
    edgeIndex.set(id, kept.length);
    source[kept.length] = from;
    target[kept.length] = to;
    edgeIds.push(id);
    kept.push(edge);
    pairs.add(from * count + to);
  }
  const reversed = new Uint8Array(kept.length);
  for (let i = 0; i < kept.length; i++) reversed[i] = pairs.has(target[i]! * count + source[i]!) ? 1 : 0;

  return {
    nodes,
    nodeIndex,
    x,
    y,
    edges: kept,
    edgeIds,
    edgeIndex,
    source: source.subarray(0, kept.length),
    target: target.subarray(0, kept.length),
    reversed,
    skippedEdges,
  };
}

export function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

/** Cells per axis are kept below this, so a cell key stays an exact integer in a double. */
const CELL_SPAN = 1 << 20;

/**
 * A uniform grid over node boxes in graph units. Each node is listed in every cell its box touches, so
 * a point query reads one cell (or a few, with slop) whatever the graph's size.
 */
export class NodeGrid {
  private cells = new Map<number, number[]>();
  private cellSize = 1;
  private originX = 0;
  private originY = 0;

  /** Rebuild from node centers and half sizes (graph units). */
  build(count: number, x: Float64Array, y: Float64Array, halfW: Float32Array, halfH: Float32Array): void {
    this.cells.clear();
    if (count === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let sumExtent = 0;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, x[i]! - halfW[i]!);
      maxX = Math.max(maxX, x[i]! + halfW[i]!);
      minY = Math.min(minY, y[i]! - halfH[i]!);
      maxY = Math.max(maxY, y[i]! + halfH[i]!);
      sumExtent += Math.max(halfW[i]!, halfH[i]!) * 2;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    // About two nodes across a cell on average, and about as many cells as nodes for a spread-out graph.
    const typical = Math.max(sumExtent / count, 1e-9) * 2;
    this.cellSize = Math.max(typical, span / Math.ceil(Math.sqrt(count)) / 2, span / (CELL_SPAN - 2));
    this.originX = minX;
    this.originY = minY;
    for (let i = 0; i < count; i++) {
      const c0 = this.cellX(x[i]! - halfW[i]!);
      const c1 = this.cellX(x[i]! + halfW[i]!);
      const r0 = this.cellY(y[i]! - halfH[i]!);
      const r1 = this.cellY(y[i]! + halfH[i]!);
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
          const key = c * CELL_SPAN + r;
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  /** Call `visit` for every node listed in a cell within `radius` of (`px`, `py`); a node may come more than once. */
  query(px: number, py: number, radius: number, visit: (index: number) => void): void {
    if (this.cells.size === 0) return;
    const c0 = this.cellX(px - radius);
    const c1 = this.cellX(px + radius);
    const r0 = this.cellY(py - radius);
    const r1 = this.cellY(py + radius);
    // A huge radius (far zoomed out) would visit more cells than there are nodes; cap the walk.
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > this.cells.size * 4) {
      for (const list of this.cells.values()) for (const index of list) visit(index);
      return;
    }
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const list = this.cells.get(c * CELL_SPAN + r);
        if (list) for (const index of list) visit(index);
      }
    }
  }

  private cellX(value: number): number {
    return clampCell(Math.floor((value - this.originX) / this.cellSize));
  }

  private cellY(value: number): number {
    return clampCell(Math.floor((value - this.originY) / this.cellSize));
  }
}

function clampCell(cell: number): number {
  return cell < -1 ? -1 : cell > CELL_SPAN - 2 ? CELL_SPAN - 2 : cell;
}
