/**
 * What a frame queries instead of walking the graph: a grid of nodes by center (also used for picking), a grid
 * of edges by bounding box, the largest node's half size, and the zoomed-out aggregation levels. Built lazily,
 * after positions or styles change, and kept until they change again. Pure: no DOM, no chart.
 */
import { AggregateJob } from "./aggregate.js";
import type { Aggregate } from "./aggregate.js";
import { BoxGrid, PointGrid } from "./grid.js";
import type { GraphModel } from "./model.js";
import { E_COLOR, EDGE_FLOATS, N_FILL, NODE_FLOATS } from "./styles.js";

export class GraphIndex {
  readonly nodes = new PointGrid();
  readonly edges = new BoxGrid();
  /** The largest node half size, in graph units: what a query for nodes grows its rectangle by. */
  maxHalf = 0;
  /** The aggregation base cell: a level `L` has cells `base * 2^L` graph units across. */
  base = 1;
  private positionsDirty = true;
  private stylesDirty = true;
  private readonly levels = new Map<number, Aggregate>();
  /** The level being built between frames, if any. */
  private job: AggregateJob | null = null;

  /** Positions changed (a new graph, `setPositions`, a finished drag): rebuild everything on next use. */
  invalidatePositions(): void {
    this.positionsDirty = true;
    this.levels.clear();
    this.job = null;
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
    if (this.positionsDirty || this.stylesDirty) {
      this.nodes.build(count, model.x, model.y);
      this.edges.build(model.edges.length, model.source, model.target, model.x, model.y, this.maxHalf);
    }
    this.positionsDirty = false;
    this.stylesDirty = false;
  }

  /**
   * The aggregate at `level` when it is built. Otherwise starts building it (replacing a job for another level)
   * and returns null: draw `nearest(level)` meanwhile.
   */
  level<N, E>(level: number, model: GraphModel<N, E>, nodeStyles: Float32Array, edgeStyles: Float32Array): Aggregate | null {
    const found = this.levels.get(level);
    if (found) return found;
    if (this.job?.level !== level) {
      this.job = new AggregateJob(level, this.base * 2 ** level, {
        count: model.nodes.length,
        x: model.x,
        y: model.y,
        nodeStyles,
        nodeStride: NODE_FLOATS,
        nodeColorAt: N_FILL,
        edgeCount: model.edges.length,
        source: model.source,
        target: model.target,
        edgeStyles,
        edgeStride: EDGE_FLOATS,
        edgeColorAt: E_COLOR,
      });
    }
    return null;
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
    // A few levels are kept: a zoom back and forth reuses them.
    if (this.levels.size >= 5) this.levels.delete(this.levels.keys().next().value!);
    this.levels.set(job.level, done);
    return true;
  }
}
