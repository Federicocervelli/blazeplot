/**
 * What a frame queries instead of walking the graph: a grid of nodes by center (also used for picking), a grid
 * of edges by bounding box, the largest node's half size, and the zoomed-out aggregation levels. Built lazily,
 * after positions or styles change, and kept until they change again. Pure: no DOM, no chart.
 */
import { AggregateJob } from "./aggregate.js";
import type { Aggregate } from "./aggregate.js";
import { BoxGrid, PointGrid } from "./grid.js";
import { PairHierarchy, PairTree } from "./pairs.js";
import type { GraphModel } from "./model.js";
import { E_COLOR, EDGE_FLOATS, N_FILL, NODE_FLOATS } from "./styles.js";

/** Listed edges per node, on average, from which a graph is drawn through the pair hierarchy. */
export const DENSE_DEGREE = 64;

/** Whether a graph is drawn through the pair hierarchy: "every pair" input, or many edges per node. */
export function isDense<N, E>(model: GraphModel<N, E>): boolean {
  return model.allPairs !== null || (model.nodes.length > 1 && (model.edgeCount * 2) / model.nodes.length >= DENSE_DEGREE);
}

export class GraphIndex {
  /** For a dense graph: the k-d tree of nodes and the pair hierarchy with its edge counts. Null otherwise. */
  dense: PairHierarchy | null = null;
  readonly nodes = new PointGrid();
  readonly edges = new BoxGrid();
  /** The largest node half size, in graph units: what a query for nodes grows its rectangle by. */
  maxHalf = 0;
  /** The aggregation base cell: a level `L` has cells `base * 2^L` graph units across. */
  base = 1;
  /**
   * A fixed pseudo-random order of the edges, `perm(k) = k * stride mod count`, and its inverse `rank(e) =
   * e * inverse mod count`: any prefix of it is an even sample of the graph, with no storage and no sort.
   */
  stride = 1;
  inverse = 1;
  private orderedFor = -1;
  private positionsDirty = true;
  private stylesDirty = true;
  private readonly levels = new Map<number, Aggregate>();
  /** The level being built between frames, if any. */
  private job: AggregateJob | null = null;
  /** Built levels whose nodes have moved since: drawn while a fresh one is built. */
  private staleLevels = new Set<number>();
  private nodeTotal = 0;
  private edgeTotal = 0;

  /** Positions changed (a new graph, `setPositions`, a finished drag): rebuild everything on next use. */
  invalidatePositions(): void {
    this.positionsDirty = true;
    this.levels.clear();
    this.staleLevels.clear();
    this.job = null;
  }

  /**
   * One node moved (a finished drag), with its edges: the grids return them from every query until a rebuild,
   * which is put off until many have moved, so a drag never ends with a rebuild over millions of edges. Built
   * aggregate levels are kept for drawing while they are rebuilt between frames.
   */
  moveNode(node: number, edges: ArrayLike<number>, x?: Float64Array, y?: Float64Array): void {
    if (this.positionsDirty) return;
    // The pair hierarchy covers node sets, so its counts hold; only the moved node's cells change shape.
    if (this.dense && x && y) this.dense.tree.refitNode(node, x, y);
    this.nodes.markMoved(node);
    for (let k = 0; k < edges.length; k++) this.edges.markMoved(edges[k]!);
    const edgeCount = this.edgeTotal;
    if (this.edges.movedCount > Math.max(20_000, edgeCount * 0.02) || this.nodes.movedCount > Math.max(2_000, this.nodeTotal * 0.02)) {
      this.invalidatePositions();
      return;
    }
    this.staleLevels = new Set(this.levels.keys());
  }

  /** Styles changed (sizes, colors): sizes pad the queries, and colors are in the aggregates. */
  invalidateStyles(): void {
    this.stylesDirty = true;
    this.levels.clear();
    this.job = null;
  }

  /** Whether a level is being built: call `pump` between frames until it finishes. */
  get building(): boolean {
    return this.job !== null;
  }

  /** Bring the grids up to date. Cheap when nothing changed. */
  ensure<N, E>(model: GraphModel<N, E>, halfW: Float32Array, halfH: Float32Array): void {
    const count = model.nodes.length;
    this.nodeTotal = count;
    this.edgeTotal = model.edgeCount;
    if (this.stylesDirty || this.positionsDirty) {
      let maxHalf = 0;
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const half = halfW[i]! > halfH[i]! ? halfW[i]! : halfH[i]!;
        if (half > maxHalf) maxHalf = half;
        sum += half;
      }
      this.maxHalf = maxHalf;
      // Level 0 cells are about a node across: aggregation starts where single nodes stop being visible.
      this.base = count > 0 ? Math.max((sum / count) * 2, 1e-6) : 1;
    }
    if (this.orderedFor !== model.edgeCount) {
      [this.stride, this.inverse] = coprimeNear(model.edgeCount, 0.6180339887);
      this.orderedFor = model.edgeCount;
    }
    const moved = this.positionsDirty;
    if (this.positionsDirty || this.stylesDirty) {
      this.nodes.build(count, model.x, model.y);
      const dense = isDense(model);
      // A dense graph's edges are drawn through the pair hierarchy: no edge grid over millions of edges.
      this.edges.build(dense ? 0 : model.edgeCount, model.source, model.target, model.x, model.y, this.maxHalf);
      if (!dense) this.dense = null;
      else if (moved || !this.dense) {
        const tree = new PairTree();
        tree.build(count, model.x, model.y);
        const pairs = new PairHierarchy(tree);
        pairs.build();
        if (model.allPairs) pairs.countAll(model.allPairs.exceptSource, model.allPairs.exceptTarget);
        else pairs.countListed(model.source, model.target, model.edgeCount);
        this.dense = pairs;
      }
    }
    this.positionsDirty = false;
    this.stylesDirty = false;
  }

  /**
   * The aggregate at `level` when it is built. Otherwise starts building it (replacing a job for another level)
   * and returns null: draw `nearest(level)` meanwhile.
   */
  level<N, E>(level: number, model: GraphModel<N, E>, nodeStyles: Float32Array, edgeStyles: Float32Array, edgeSlot?: Uint32Array): Aggregate | null {
    const found = this.levels.get(level);
    const stale = this.staleLevels.has(level);
    if (found && !stale) return found;
    if (this.job?.level !== level) {
      this.job = new AggregateJob(level, this.base * 2 ** level, {
        count: model.nodes.length,
        x: model.x,
        y: model.y,
        nodeStyles,
        nodeStride: NODE_FLOATS,
        nodeColorAt: N_FILL,
        // A dense graph's edges are drawn through the pair hierarchy, so its levels hold only nodes.
        edgeCount: this.dense ? 0 : model.edgeCount,
        source: model.source,
        target: model.target,
        edgeStyles,
        ...(edgeSlot ? { edgeSlot } : {}),
        edgeStride: EDGE_FLOATS,
        edgeColorAt: E_COLOR,
      });
    }
    // A stale level is still drawn until the fresh one is ready.
    return found ?? null;
  }

  /** The built level nearest `level` (a coarser one on a tie), or null when none is built. */
  nearest(level: number): Aggregate | null {
    let best: Aggregate | null = null;
    let distance = Infinity;
    for (const [at, aggregate] of this.levels) {
      const d = Math.abs(at - level) - (at > level ? 0.5 : 0);
      if (d < distance) {
        best = aggregate;
        distance = d;
      }
    }
    return best;
  }

  /** Advance the job until `deadline`; true when it finished a level (draw again to show it). */
  pump(now: () => number, deadline: number): boolean {
    const job = this.job;
    if (!job) return false;
    const done = job.step(now, deadline);
    if (!done) return false;
    this.job = null;
    this.staleLevels.delete(job.level);
    // A few levels are kept: a zoom back and forth reuses them.
    if (this.levels.size >= 5) this.levels.delete(this.levels.keys().next().value!);
    this.levels.set(job.level, done);
    return true;
  }
}

/** A stride near `fraction * n` coprime with `n`, and its inverse modulo `n` (both 1 for n of 2 or less). */
function coprimeNear(n: number, fraction: number): [number, number] {
  if (n <= 2) return [1, 1];
  let a = Math.max(1, Math.round(n * fraction));
  while (gcd(a, n) !== 1) a++;
  // Extended Euclid for the inverse.
  let [oldR, r] = [a, n];
  let [oldS, t] = [1, 0];
  while (r !== 0) {
    const q = Math.floor(oldR / r);
    [oldR, r] = [r, oldR - q * r];
    [oldS, t] = [t, oldS - q * t];
  }
  return [a, ((oldS % n) + n) % n];
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}
