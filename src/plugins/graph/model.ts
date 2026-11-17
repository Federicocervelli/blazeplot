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
  /** An edge's id: its own, or `"<source>-><target>"`. Made on demand, so a large graph makes no strings. */
  edgeIdOf(index: number): string;
  /**
   * The edge with an id, or -1. The lookup table is built the first time it is needed; an id used twice keeps
   * its first edge, with one warning.
   */
  edgeIndexOf(id: string): number;
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

  const source = new Uint32Array(edges.length);
  const target = new Uint32Array(edges.length);
  // Edges that cannot be drawn (an end that is not a node, or both ends one node) are left out; the array is
  // only copied when one is.
  let kept: GraphEdge<E>[] | null = null;
  let count = 0;
  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e]!;
    const from = nodeIndex.get(edge?.source);
    const to = nodeIndex.get(edge?.target);
    if (from === undefined || to === undefined || from === to) {
      kept ??= edges.slice(0, e) as GraphEdge<E>[];
      continue;
    }
    kept?.push(edge);
    source[count] = from;
    target[count] = to;
    count++;
  }
  const keptEdges: readonly GraphEdge<E>[] = kept ?? edges;
  const skippedEdges = edges.length - count;

  // Outgoing edges per node (counting sort), to find each edge's reverse twin among its target's few edges.
  const outStart = new Uint32Array(nodes.length + 1);
  for (let e = 0; e < count; e++) outStart[source[e]! + 1]!++;
  for (let i = 0; i < nodes.length; i++) outStart[i + 1]! += outStart[i]!;
  const outList = new Uint32Array(count);
  const cursor = outStart.slice(0, nodes.length);
  for (let e = 0; e < count; e++) outList[cursor[source[e]!]!++] = e;
  const reversed = new Uint8Array(count);
  for (let e = 0; e < count; e++) {
    const from = source[e]!;
    const to = target[e]!;
    for (let k = outStart[to]!, end = outStart[to + 1]!; k < end; k++) {
      if (target[outList[k]!] === from) {
        reversed[e] = 1;
        break;
      }
    }
  }

  const edgeIdOf = (index: number): string => {
    const edge = keptEdges[index]!;
    return edge.id ?? `${edge.source}->${edge.target}`;
  };
  let edgeIndex: Map<string, number> | null = null;
  const edgeIndexOf = (id: string): number => {
    if (!edgeIndex) {
      edgeIndex = new Map();
      let duplicate: string | null = null;
      for (let e = 0; e < count; e++) {
        const key = edgeIdOf(e);
        if (edgeIndex.has(key)) duplicate ??= key;
        else edgeIndex.set(key, e);
      }
      if (duplicate !== null) console.warn(`BlazePlot graph: edge id "${duplicate}" is used more than once; give parallel edges their own ids. The first edge keeps it.`);
    }
    return edgeIndex.get(id) ?? -1;
  };

  return {
    nodes,
    nodeIndex,
    x,
    y,
    edges: keptEdges,
    edgeIdOf,
    edgeIndexOf,
    source: source.subarray(0, count),
    target: target.subarray(0, count),
    reversed,
    skippedEdges,
  };
}

export function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}
