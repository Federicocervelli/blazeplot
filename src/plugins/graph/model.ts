/**
 * The graph model: validated nodes and edges in flat arrays, edge endpoints by index, and a uniform
 * grid over node boxes for picking. Pure: no DOM, no chart.
 */
import type { GraphEdge, GraphEdgeArrays, GraphLimits, GraphNode } from "./types.js";

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
  /** How many edges were kept (drawable ones). */
  readonly edgeCount: number;
  /** An edge as an object, made on demand for edges given as arrays. Do not change it. */
  edgeAt(index: number): GraphEdge<E>;
  /**
   * An edge in one reused object, for style functions that run for every edge: valid until the next call, so
   * millions of edges given as arrays make no garbage. Do not keep it.
   */
  edgeView(index: number): GraphEdge<E>;
  /** An edge's id: its own, or `"<source>-><target>"`. Made on demand, so a large graph makes no strings. */
  edgeIdOf(index: number): string;
  /**
   * The edge with an id, or -1. The lookup table is built the first time it is needed; an id used twice keeps
   * its first edge, with one warning.
   */
  edgeIndexOf(id: string): number;
  readonly source: Uint32Array;
  readonly target: Uint32Array;
  /** The edges at a node, either end: an index built on first use, so later calls cost the node's degree. */
  edgesAt(node: number): Uint32Array;
  /** Whether nodes `i` and `j` are joined (either direction). Cheap: a binary search in a node's sorted targets. */
  joined(i: number, j: number): boolean;
  /** 1 when another edge runs from this edge's target to its source. */
  readonly reversed: Uint8Array;
  readonly skippedEdges: number;
}

/** Read and check a graph. Throws a `RangeError` before allocating anything large when a limit is broken. */
export function buildGraphModel<N, E>(nodes: readonly GraphNode<N>[], edges: readonly GraphEdge<E>[] | GraphEdgeArrays<E>, limits: GraphLimits = {}): GraphModel<N, E> {
  const maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
  const maxEdges = limits.maxEdges ?? DEFAULT_MAX_EDGES;
  const arrays = Array.isArray(edges) ? null : (edges as GraphEdgeArrays<E>);
  if (!Array.isArray(nodes) || (!arrays && !Array.isArray(edges))) throw new TypeError("graph: nodes must be an array, and edges an array or { source, target } index arrays.");
  if (arrays && (!isIndexList(arrays.source) || !isIndexList(arrays.target) || arrays.source.length !== arrays.target.length)) {
    throw new TypeError("graph: edge arrays need source and target index lists of the same length.");
  }
  const given = arrays ? arrays.source.length : (edges as readonly GraphEdge<E>[]).length;
  if (nodes.length > maxNodes) throw new RangeError(`graph: ${nodes.length} nodes is more than the limit of ${maxNodes}.`);
  if (given > maxEdges) throw new RangeError(`graph: ${given} edges is more than the limit of ${maxEdges}.`);

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

  const source = new Uint32Array(given);
  const target = new Uint32Array(given);
  // Edges that cannot be drawn (an end that is not a node, or both ends one node) are left out. `original` maps a
  // kept edge to its place in the input, and exists only when one was left out.
  let original: Uint32Array | null = null;
  let count = 0;
  const nodeCount = nodes.length;
  for (let e = 0; e < given; e++) {
    let from: number | undefined;
    let to: number | undefined;
    if (arrays) {
      from = arrays.source[e]!;
      to = arrays.target[e]!;
      if (!(from >= 0 && from < nodeCount && Number.isInteger(from))) from = undefined;
      if (!(to >= 0 && to < nodeCount && Number.isInteger(to))) to = undefined;
    } else {
      const edge = (edges as readonly GraphEdge<E>[])[e]!;
      from = nodeIndex.get(edge?.source);
      to = nodeIndex.get(edge?.target);
    }
    if (from === undefined || to === undefined || from === to) {
      if (!original) {
        original = new Uint32Array(given);
        for (let k = 0; k < count; k++) original[k] = k;
      }
      continue;
    }
    if (original) original[count] = e;
    source[count] = from;
    target[count] = to;
    count++;
  }
  const skippedEdges = given - count;
  const inputIndex = (index: number): number => (original ? original[index]! : index);
  const objects = arrays ? null : (edges as readonly GraphEdge<E>[]);
  const edgeAt = (index: number): GraphEdge<E> => {
    if (objects) return objects[inputIndex(index)]!;
    const at = inputIndex(index);
    const id = arrays!.ids?.[at];
    const label = arrays!.labels?.[at];
    const data = arrays!.data?.[at];
    return { source: nodes[source[index]!]!.id, target: nodes[target[index]!]!.id, ...(id !== undefined ? { id } : {}), ...(label !== undefined ? { label } : {}), ...(data !== undefined ? { data } : {}) };
  };
  const view: { id?: string; source: string; target: string; label?: string; data?: E } = { source: "", target: "" };
  const edgeView = (index: number): GraphEdge<E> => {
    if (objects) return objects[inputIndex(index)]!;
    const at = inputIndex(index);
    view.source = nodes[source[index]!]!.id;
    view.target = nodes[target[index]!]!.id;
    view.id = arrays!.ids?.[at];
    view.label = arrays!.labels?.[at];
    view.data = arrays!.data?.[at];
    return view;
  };

  // Each node's outgoing targets, sorted (counting sort by source, then each run sorted), so an edge's reverse
  // twin is a binary search among its target's targets: fast for a dense graph too.
  const outStart = new Uint32Array(nodeCount + 1);
  for (let e = 0; e < count; e++) outStart[source[e]! + 1]!++;
  for (let i = 0; i < nodeCount; i++) outStart[i + 1]! += outStart[i]!;
  const outTargets = new Uint32Array(count);
  const cursor = outStart.slice(0, nodeCount);
  for (let e = 0; e < count; e++) outTargets[cursor[source[e]!]!++] = target[e]!;
  for (let i = 0; i < nodeCount; i++) if (outStart[i + 1]! - outStart[i]! > 1) outTargets.subarray(outStart[i]!, outStart[i + 1]!).sort();
  const reversed = new Uint8Array(count);
  for (let e = 0; e < count; e++) {
    const from = source[e]!;
    let lo = outStart[target[e]!]!;
    let hi = outStart[target[e]! + 1]!;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (outTargets[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    if (lo < outStart[target[e]! + 1]! && outTargets[lo] === from) reversed[e] = 1;
  }

  let incidentStart: Uint32Array | null = null;
  let incident: Uint32Array | null = null;
  const edgesAt = (node: number): Uint32Array => {
    if (!incidentStart || !incident) {
      incidentStart = new Uint32Array(nodeCount + 1);
      for (let e = 0; e < count; e++) {
        incidentStart[source[e]! + 1]!++;
        incidentStart[target[e]! + 1]!++;
      }
      for (let i = 0; i < nodeCount; i++) incidentStart[i + 1]! += incidentStart[i]!;
      incident = new Uint32Array(count * 2);
      const at = incidentStart.slice(0, nodeCount);
      for (let e = 0; e < count; e++) {
        incident[at[source[e]!]!++] = e;
        incident[at[target[e]!]!++] = e;
      }
    }
    if (node < 0 || node >= nodeCount) return new Uint32Array(0);
    return incident.subarray(incidentStart[node]!, incidentStart[node + 1]!);
  };

  const edgeIdOf = (index: number): string => {
    if (objects) {
      const edge = objects[inputIndex(index)]!;
      return edge.id ?? `${edge.source}->${edge.target}`;
    }
    return arrays!.ids?.[inputIndex(index)] ?? `${nodes[source[index]!]!.id}->${nodes[target[index]!]!.id}`;
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

  const has = (from: number, to: number): boolean => {
    let lo = outStart[from]!;
    let hi = outStart[from + 1]!;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (outTargets[mid]! < to) lo = mid + 1;
      else hi = mid;
    }
    return lo < outStart[from + 1]! && outTargets[lo] === to;
  };
  const joined = (i: number, j: number): boolean => {
    if (i === j || i < 0 || j < 0 || i >= nodeCount || j >= nodeCount) return false;
    return has(i, j) || has(j, i);
  };

  return {
    nodes,
    nodeIndex,
    x,
    y,
    edgeCount: count,
    edgeAt,
    edgeView,
    edgeIdOf,
    edgeIndexOf,
    edgesAt,
    joined,
    source: source.subarray(0, count),
    target: target.subarray(0, count),
    reversed,
    skippedEdges,
  };
}

function isIndexList(value: unknown): value is ArrayLike<number> {
  return ArrayBuffer.isView(value) || Array.isArray(value);
}

export function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}
