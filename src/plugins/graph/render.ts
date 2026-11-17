/**
 * Graph drawing: projecting nodes to the screen, edge geometry (ends on node outlines, bows, arrowheads,
 * dashes and flow), culling, and the device-pixel buffers handed to the chart's render surface. Keeps the
 * screen geometry of the last frame for picking. No chart or plugin lifecycle.
 */
import type { ChartPluginContext } from "../../ui/PluginTypes.js";
import { type Aggregate, quantize, unquantize } from "./aggregate.js";
import type { Rect } from "./grid.js";
import type { GraphModel } from "./model.js";
import type { GraphIndex } from "./spatial.js";
import { type PairTree, RefineScratch, refine, starCut } from "./pairs.js";
import {
  E_ARROW,
  E_ARROW_SIZE,
  E_COLOR,
  E_CURVATURE,
  E_DASH,
  E_END_GAP,
  E_FLOW,
  E_FLOW_DASH,
  E_FLOW_DOTS,
  E_FLOW_GAP,
  E_FLOW_SPEED,
  E_FLOW_WIDTH,
  E_GAP,
  E_HAS_FLOW,
  E_WIDTH,
  EDGE_FLOATS,
  N_BORDER,
  N_DASH,
  N_DASH_GAP,
  N_FILL,
  N_HEIGHT,
  N_RADIUS,
  N_RING,
  N_RING_GAP,
  N_RING_WIDTH,
  N_SHAPE,
  N_STROKE,
  N_WIDTH,
  NODE_FLOATS,
} from "./styles.js";

/** The chart engine's drawing surface (WebGL2, Canvas 2D, or the shared context). */
export type RenderSurface = ReturnType<ChartPluginContext["unstable"]["createRenderSurface"]>;

/** How far an `"auto"` edge with a reverse twin bows, as a fraction of its length. */
export const AUTO_BOW = 0.16;
/** Screen geometry kept per edge: start, control, end (CSS pixels), and whether it was drawn. */
export const EDGE_GEOMETRY = 7;
/** Screen geometry kept per node: center and half size (CSS pixels, at least the minimum size), and shape. */
export const NODE_GEOMETRY = 5;

const SHAPE = 14;
const SEGMENT = 12;
const VERTEX = 6;
const ARROW_HALF_WIDTH = 0.55;
/** Floats per collected flow: style offset, start, control, end, bowed. */
const FLOW_RECORD = 8;

/** A float buffer that grows by doubling and is reused frame after frame. */
class Buffer {
  data: Float32Array;
  count = 0;
  constructor(private readonly stride: number) {
    this.data = new Float32Array(stride * 64);
  }
  /** Room for one more record; returns its offset. */
  next(): number {
    const o = this.count * this.stride;
    if (o + this.stride > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.count++;
    return o;
  }
}

export interface GraphFrameInput<N, E> {
  readonly model: GraphModel<N, E>;
  readonly nodeStyles: Float32Array;
  /** Edge style records, and each edge's record (its slot); without slots, edge `i` uses record `i`. */
  readonly edgeStyles: Float32Array;
  readonly edgeSlot?: Uint32Array;
  /** Node indices in draw order (by layer). */
  readonly order: Uint32Array;
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
  /** Plot size in CSS pixels, and device pixels per CSS pixel. */
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  /** Seconds, for flow animation. */
  readonly time: number;
  readonly animate: boolean;
  readonly minNodePx: number;
  readonly background: { readonly kind: "dots" | "grid"; readonly gap: number; readonly size: number; readonly color: readonly number[] } | null;
  /**
   * A node being dragged (-1 for none), and its edges: the still pass leaves them out and the overlay pass
   * draws them, so a drag frame redraws one node and its edges instead of the whole graph.
   */
  readonly lifted?: number;
  readonly liftedEdges?: Uint32Array | null;
  /**
   * The spatial index. With it a still frame queries what is on screen instead of walking the graph, and draws
   * the aggregate level when more is visible than `budget` allows. Without it every item is walked.
   */
  readonly spatial?: GraphIndex | null;
  /**
   * Most nodes a still frame draws one by one before it draws the aggregate instead, and most edges, counted
   * and as area (CSS pixels of length times width), before it thins them.
   */
  readonly budget?: { readonly nodes: number; readonly edges: number; readonly fill?: number; readonly overdraw?: number; readonly dense?: number };
  /** A dense graph's common edge style record (bands and single edges are drawn with it). */
  readonly denseSlot?: number;
  /** A dense graph's edges styled apart from the common style: drawn one by one, over the bands. */
  readonly styledEdges?: Uint32Array | null;
  /** Whether bands may fade from one end to the other (per-vertex color); else each is one color. */
  readonly gradientBands?: boolean;
}

/**
 * The opacity of one edge standing for `boost` edges drawn over each other, 1 - (1 - alpha)^boost, held under
 * 0.6 so a sample of a dense graph reads as a haze, not as a few hard lines.
 */
function boosted(alpha: number, boost: number): number {
  return Math.min(Math.max(alpha, 0.6), 1 - (1 - alpha) ** boost);
}

const SQRT3 = Math.sqrt(3);
/**
 * A band at least this many CSS pixels wide at both ends (half-width) shades the view smoothly: it goes to a
 * density field sampled every `FIELD_STEP` pixels and drawn as one mesh, so a hundred bands crossing the view
 * cost one layer of pixels instead of a hundred.
 */
const FIELD_HALF_WIDTH = 16;
const FIELD_STEP = 8;
/** The density field may be added to this many times over per vertex in a frame. */
const FIELD_PASSES = 64;

function growF64(a: Float64Array, need: number): Float64Array {
  const b = new Float64Array(Math.max(need, a.length * 2, 64));
  b.set(a);
  return b;
}

function growU32(a: Uint32Array, need: number): Uint32Array {
  const b = new Uint32Array(Math.max(need, a.length * 2, 64));
  b.set(a);
  return b;
}

/** Merged edge indices fit below this in a sort key. */
const AGG_INDEX_SPAN = 2 ** 24;

/** On-screen size (CSS pixels) of an aggregate cell: below it nodes are too small to tell apart. */
const AGGREGATE_CELL_PX = 3;

/** The field step (CSS px) for a band or cell this wide (half-width): at most half of it, a power of two times the finest (four samples across). */
function fieldStep(half: number): number {
  let step = FIELD_STEP;
  while (step * 4 <= half * 2 && step < FIELD_STEP * 2 ** (FIELD_LEVELS - 1)) step *= 2;
  return step;
}

/** Levels of the density field: level `l` samples every `FIELD_STEP * 2^l` CSS pixels. */
const FIELD_LEVELS = 7;

/**
 * Lines per pixel over the view, at the vertices of grids from fine to coarse (a multigrid): a wide band or cell
 * is smooth across its width, so it is sampled on the grid whose step is about half that width, and costs the
 * vertices it covers there; `collapse` then adds each grid into the next finer one by bilinear interpolation, so
 * all of them cost about one pass over the finest grid, however many wide bands there are.
 */
class DensityField {
  readonly cols: number[] = [];
  readonly rows: number[] = [];
  private grids: Float32Array[] = [];
  private used: boolean[] = [];
  private readonly quad = new Float64Array(8);

  reset(width: number, height: number): void {
    for (let l = 0; l < FIELD_LEVELS; l++) {
      const step = FIELD_STEP * 2 ** l;
      const cols = Math.ceil(width / step) + 1;
      const rows = Math.ceil(height / step) + 1;
      this.cols[l] = cols;
      this.rows[l] = rows;
      if ((this.grids[l]?.length ?? 0) < cols * rows) this.grids[l] = new Float32Array(cols * rows);
      else if (this.used[l] !== false) this.grids[l]!.fill(0, 0, cols * rows);
      this.used[l] = false;
    }
  }

  private level(step: number): number {
    return Math.round(Math.log2(step / FIELD_STEP));
  }

  /**
   * A wide band: at each vertex inside it (row by row, between where the row crosses its outline), its lines per
   * pixel there, `spread` (edges times line width, halved) over its half-width at that point.
   */
  addBand(ax: number, ay: number, bx: number, by: number, nx: number, ny: number, ha: number, hb: number, spread: number): void {
    const step = fieldStep(Math.min(ha, hb));
    const l = this.level(step);
    const grid = this.grids[l]!;
    const cols = this.cols[l]!;
    const rows = this.rows[l]!;
    this.used[l] = true;
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy || 1;
    const q = this.quad;
    q[0] = ax + nx * ha;
    q[1] = ay + ny * ha;
    q[2] = bx + nx * hb;
    q[3] = by + ny * hb;
    q[4] = bx - nx * hb;
    q[5] = by - ny * hb;
    q[6] = ax - nx * ha;
    q[7] = ay - ny * ha;
    const r0 = Math.max(0, Math.ceil(Math.min(q[1]!, q[3]!, q[5]!, q[7]!) / step));
    const r1 = Math.min(rows - 1, Math.floor(Math.max(q[1]!, q[3]!, q[5]!, q[7]!) / step));
    for (let row = r0; row <= r1; row++) {
      const y = row * step;
      let left = Infinity;
      let right = -Infinity;
      for (let e = 0; e < 4; e++) {
        const x0 = q[e * 2]!;
        const y0 = q[e * 2 + 1]!;
        const x1 = q[((e + 1) % 4) * 2]!;
        const y1 = q[((e + 1) % 4) * 2 + 1]!;
        if ((y < y0 && y < y1) || (y > y0 && y > y1)) continue;
        const x = y0 === y1 ? x0 : x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
        const x2 = y0 === y1 ? x1 : x;
        left = Math.min(left, x, x2);
        right = Math.max(right, x, x2);
      }
      const c0 = Math.max(0, Math.ceil(left / step));
      const c1 = Math.min(cols - 1, Math.floor(right / step));
      const py = y - ay;
      for (let col = c0; col <= c1; col++) {
        const t = Math.min(1, Math.max(0, ((col * step - ax) * dx + py * dy) / length2));
        grid[row * cols + col]! += spread / (ha + (hb - ha) * t);
      }
    }
  }

  /**
   * The edges inside a cell, on the finest grid (cells are disjoint, so all of them cost one pass at most): their
   * ink, edges times line width times their mean length (0.905 of the radius, as in an even disk), spread evenly
   * over the vertices inside the cell's ellipse (its covariance `sxx`, `syy`, `sxy` in CSS px², out to two
   * standard deviations, as an even disk reaches) and its bounding box (`x0`..`x1`, `y0`..`y1`), or onto the
   * nearest vertex when none is inside: the ink drawn is the same, and none falls outside the cell's box.
   */
  addCell(cx: number, cy: number, sxx: number, syy: number, sxy: number, x0: number, y0: number, x1: number, y1: number, width: number): void {
    const step = FIELD_STEP;
    const grid = this.grids[0]!;
    const cols = this.cols[0]!;
    const rows = this.rows[0]!;
    this.used[0] = true;
    const ink = width * 0.905 * 2 * Math.sqrt((sxx + syy) / 2);
    // Inverse covariance, kept invertible for cells along a line.
    const a = sxx + 0.25;
    const d = syy + 0.25;
    const det = a * d - sxy * sxy;
    const ia = d / det;
    const id = a / det;
    const ib = -sxy / det;
    const c0 = Math.ceil(x0 / step);
    const c1 = Math.floor(x1 / step);
    const r0 = Math.ceil(y0 / step);
    const r1 = Math.floor(y1 / step);
    // Vertices off the view count too, so the density does not change with the view: counted one by one for a
    // small cell, or as the ellipse's area (within the box's) for one much larger than the view.
    const total = Math.max(0, c1 - c0 + 1) * Math.max(0, r1 - r0 + 1);
    let inside = 0;
    if (total > 4 * cols * rows) inside = Math.min(total, (4 * Math.PI * Math.sqrt(det)) / (step * step));
    else
      for (let row = r0; row <= r1; row++) {
        const dy = row * step - cy;
        for (let col = c0; col <= c1; col++) {
          const dx = col * step - cx;
          if (ia * dx * dx + 2 * ib * dx * dy + id * dy * dy <= 4) inside++;
        }
      }
    if (inside > 0) {
      const share = ink / (inside * step * step);
      for (let row = Math.max(0, r0); row <= Math.min(rows - 1, r1); row++) {
        const dy = row * step - cy;
        for (let col = Math.max(0, c0); col <= Math.min(cols - 1, c1); col++) {
          const dx = col * step - cx;
          if (ia * dx * dx + 2 * ib * dx * dy + id * dy * dy <= 4) grid[row * cols + col]! += share;
        }
      }
      return;
    }
    const col = Math.round(cx / step);
    const row = Math.round(cy / step);
    if (col >= 0 && col < cols && row >= 0 && row < rows) grid[row * cols + col]! += ink / (step * step);
  }

  /** Add every coarser grid into the finest, by bilinear interpolation down the levels; returns the finest. */
  collapse(): Float32Array {
    for (let l = FIELD_LEVELS - 1; l > 0; l--) {
      if (!this.used[l]) continue;
      const coarse = this.grids[l]!;
      const fine = this.grids[l - 1]!;
      const cc = this.cols[l]!;
      const cr = this.rows[l]!;
      const fc = this.cols[l - 1]!;
      const fr = this.rows[l - 1]!;
      for (let row = 0; row < fr; row++) {
        const r0 = Math.min(cr - 1, row >> 1);
        const r1 = Math.min(cr - 1, (row + 1) >> 1);
        for (let col = 0; col < fc; col++) {
          const c0 = Math.min(cc - 1, col >> 1);
          const c1 = Math.min(cc - 1, (col + 1) >> 1);
          fine[row * fc + col]! += (coarse[r0 * cc + c0]! + coarse[r0 * cc + c1]! + coarse[r1 * cc + c0]! + coarse[r1 * cc + c1]!) / 4;
        }
      }
      this.used[l - 1] = true;
    }
    return this.grids[0]!;
  }
}

export class GraphPainter {
  private readonly shapes = new Buffer(SHAPE);
  private readonly segments = new Buffer(SEGMENT);
  private readonly triangles = new Buffer(VERTEX);
  /** Bands of a dense graph (per-vertex colored triangles), drawn under its single edges. */
  private readonly bands = new Buffer(VERTEX);
  /** The coarseness of the last dense cut (CSS pixels), where the next one starts its search. */
  private denseTau = 2;
  /** Whether the last still frame left detail out for its budget (a coarser dense cut, fewer edges), so a frame with a larger budget would show more. */
  clipped = false;
  /** The last dense cut: bands (cell, cell, edges) and pairs of single nodes. */
  private bandCells: Float64Array = new Float64Array(0);
  private bandCount = 0;
  private singleNodes: Uint32Array = new Uint32Array(0);
  private singleCount = 0;
  private bandKeys = new Float64Array(0);
  private bandEnds = new Float64Array(0);
  /** Cells of the last dense cut whose inside edges are drawn as a density over the cell: (cell, edges). */
  private cellList: Float64Array = new Float64Array(0);
  private cellCount = 0;
  private readonly refineScratch = new RefineScratch();
  /** Lines per pixel of the wide bands, at the vertices of a grid over the view (see `addToField`). */
  private readonly field = new DensityField();
  private levelBuffer = new Float32Array(0);
  /** Round flow dots, drawn over the edges and under the arrowheads. */
  private readonly dots = new Buffer(SHAPE);
  /** Dashed node borders, drawn over the node fills. */
  private readonly borders = new Buffer(SEGMENT);
  private readonly backgroundShapes = new Buffer(SHAPE);
  /** Points of the curve being walked for dots: x, y pairs. */
  private path = new Float64Array(64);
  private readonly backgroundSegments = new Buffer(SEGMENT);
  /** Per node: screen center x, y, half width, half height, shape (0 circle, 1 rect). */
  nodeScreen = new Float32Array(0);
  /** Per edge: start x, y, control x, y, end x, y, and 1 when drawn this frame. */
  edgeScreen = new Float32Array(0);
  /** Whether the last flow frame drew a moving flow, so another frame is needed. */
  moving = false;
  /**
   * The flows found by the last static frame: per flow, the edge's style offset, its drawn start, control, and end
   * (CSS pixels, after the arrowheads shortened it), and 1 when it bows. Flow frames redraw only these.
   */
  private flows = new Float32Array(0);
  private flowCount = 0;
  /** Whether the overlay surface holds anything, so an empty overlay frame clears it once. */
  private flowsDrawn = false;
  /** Flows of the lifted node's edges, found by the overlay pass. */
  private liftFlows = new Float32Array(0);
  private liftFlowCount = 0;
  /** Whether edges being built now belong to the overlay (their flows go to `liftFlows`). */
  private liftPass = false;
  /** Edges of a thinned frame are drawn as dense as those they stand for: opacity 1 - (1 - alpha)^boost. */
  private alphaBoost = 1;
  /** The point `exit` found, kept in fields so the hot loop allocates nothing. */
  private exitX = 0;
  private exitY = 0;
  /** Per node, the frame it was last projected in: a visible-only frame projects nodes as it needs them. */
  private projected = new Uint32Array(0);
  private frameStamp = 0;
  /** The nodes and edges the last still frame drew one by one, for labels and picking. */
  drawnNodes = new Uint32Array(0);
  drawnNodeCount = 0;
  drawnEdges = new Uint32Array(0);
  drawnEdgeCount = 0;
  /** Whether the last still frame drew the aggregate level instead of single items. */
  aggregated = false;
  /** Query results, reused. */
  private readonly nodeQuery = { data: new Uint32Array(1024) };
  private readonly edgeQuery = { data: new Uint32Array(1024) };
  private readonly rect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private rank: Uint32Array | null = null;
  private rankOf: Uint32Array | null = null;

  /**
   * Project, cull, and draw everything that does not move on `surface`: background, edges, arrows, and nodes.
   * Flows are only collected; `paintFlows` draws them on their own surface, so an animation frame costs what
   * the moving flows cost, not the whole graph.
   */
  paint<N, E>(surface: RenderSurface, input: GraphFrameInput<N, E>): void {
    const { width, height, pixelRatio: dpr } = input;
    this.shapes.count = 0;
    this.segments.count = 0;
    this.triangles.count = 0;
    this.borders.count = 0;
    this.bands.count = 0;
    this.fieldCols = 0;
    this.flowCount = 0;
    this.liftPass = false;
    this.drawnNodeCount = 0;
    this.drawnEdgeCount = 0;
    this.aggregated = false;
    this.clipped = false;
    this.startFrame(input);
    const spatial = input.spatial;

    surface.beginFrame(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)), dpr);
    this.paintBackground(surface, input);
    if (!spatial) {
      // No index: walk every item.
      this.project(input);
      this.buildEdges(input, null, true);
      if (this.segments.count > 0) surface.strokeSegments(this.segments.data, this.segments.count);
      if (this.triangles.count > 0) surface.fillTriangles(this.triangles.data, this.triangles.count);
      this.buildNodes(input, -1, input.order, input.order.length);
    } else {
      const { model, zoom, centerX, centerY } = input;
      const rect = this.rect;
      rect.minX = centerX - width / 2 / zoom;
      rect.maxX = centerX + width / 2 / zoom;
      rect.minY = centerY - height / 2 / zoom;
      rect.maxY = centerY + height / 2 / zoom;
      // Nodes are found by center: grow the view by the largest node and the minimum drawn size.
      const pad = spatial.maxHalf + input.minNodePx / zoom;
      const nodeRect: Rect = { minX: rect.minX - pad, minY: rect.minY - pad, maxX: rect.maxX + pad, maxY: rect.maxY + pad };
      const budget = input.budget ?? { nodes: 60_000, edges: 150_000 };
      const visible = spatial.nodes.countIn(nodeRect);
      // Only too many visible nodes calls for the aggregate: while nodes can still be told apart, too many edges
      // are thinned below instead, so a dense graph keeps its nodes.
      if (visible > budget.nodes) {
        this.aggregated = true;
        const target = AGGREGATE_CELL_PX / zoom;
        const level = Math.max(0, Math.ceil(Math.log2(target / spatial.base)));
        // A level not built yet is built between frames; meanwhile the nearest built one is drawn, or a sample of
        // the visible nodes when none is.
        const agg = spatial.level(level, model, input.nodeStyles, input.edgeStyles, input.edgeSlot) ?? spatial.nearest(level);
        if (spatial.dense) this.paintDense(input, rect, budget);
        if (agg) this.paintAggregate(input, agg, budget.edges);
        else this.paintSample(input, nodeRect, budget.nodes);
        this.submitField(surface, input.pixelRatio);
        if (this.bands.count > 0) surface.fillTriangles(this.bands.data, this.bands.count);
        if (this.segments.count > 0) surface.strokeSegments(this.segments.data, this.segments.count);
      } else {
        if (spatial.dense) {
          // A dense graph: bands and single edges from the pair hierarchy, then the edges styled apart from the
          // rest (flows, highlights), one by one: those on the view, or an even sample of them that keeps to an
          // eighth of the count and a sixteenth of the area, so they stand out from the haze instead of covering it.
          this.paintDense(input, rect, budget);
          const styled = input.styledEdges ?? null;
          if (styled && styled.length > 0) {
            const kept = this.selectStyled(input, styled, rect, budget.edges / 8, (budget.fill ?? Infinity) / 16);
            this.buildEdges(input, this.edgeQuery.data.subarray(0, kept), true);
          }
        } else {
          const kept = this.selectEdges(input, rect, budget.edges, budget.fill ?? Infinity);
          this.buildEdges(input, this.edgeQuery.data.subarray(0, kept), true);
        }
        this.alphaBoost = 1;
        this.submitField(surface, input.pixelRatio);
        if (this.bands.count > 0) surface.fillTriangles(this.bands.data, this.bands.count);
        if (this.segments.count > 0) surface.strokeSegments(this.segments.data, this.segments.count);
        if (this.triangles.count > 0) surface.fillTriangles(this.triangles.data, this.triangles.count);
        const nodeCount = spatial.nodes.query(nodeRect, this.nodeQuery);
        const nodes = this.sortForDrawing(this.nodeQuery.data, nodeCount, input.order);
        for (let k = 0; k < nodeCount; k++) this.ensureProjected(nodes[k]!, input);
        this.buildNodes(input, -1, nodes, nodeCount);
      }
    }
    if (this.shapes.count > 0) surface.fillShapes(this.shapes.data, this.shapes.count);
    if (this.borders.count > 0) surface.strokeSegments(this.borders.data, this.borders.count);
    surface.endFrame();
    // A lifted node is drawn by the overlay, but its label is drawn with the others, last, over them.
    const lifted = input.lifted ?? -1;
    if (lifted >= 0 && lifted < input.model.nodes.length) {
      this.ensureProjected(lifted, input);
      if (this.drawnNodes.length <= this.drawnNodeCount) {
        const grown = new Uint32Array(this.drawnNodeCount + 1);
        grown.set(this.drawnNodes);
        this.drawnNodes = grown;
      }
      this.drawnNodes[this.drawnNodeCount++] = lifted;
    }
  }

  /**
   * The edges to draw one by one, written to the front of `edgeQuery`; sets `alphaBoost`. All edges in view while
   * they fit `budget` (a count) and `fill` (area: CSS pixels of length times width); otherwise an even sample that
   * fits, taken in the index's fixed order, each drawn with the opacity of the edges it stands for. The sample is
   * stable from frame to frame, and a larger share only adds edges to it. When the grid finds few candidates the
   * grid query is thinned; when it finds many (a dense graph, whose edges all cross the view) the order is walked
   * from its start, culling as it goes, until the budget is spent, so the cost follows the budget, not the graph.
   */
  private selectEdges<N, E>(input: GraphFrameInput<N, E>, rect: Rect, budget: number, fill: number): number {
    const { model, edgeStyles, zoom } = input;
    const spatial = input.spatial!;
    const slots = input.edgeSlot;
    const total = model.edgeCount;
    const data = (): Uint32Array => this.edgeQuery.data;
    const widthOf = (e: number): number => Math.max(1, edgeStyles[(slots ? slots[e]! : e) * EDGE_FLOATS + E_WIDTH]!);
    // An edge's on-screen area, and whether its box meets the view (both in graph units, scaled by zoom).
    const area = (e: number): number => {
      const s = model.source[e]!;
      const t = model.target[e]!;
      const dx = model.x[t]! - model.x[s]!;
      const dy = model.y[t]! - model.y[s]!;
      return Math.sqrt(dx * dx + dy * dy) * zoom * widthOf(e);
    };
    const meets = (e: number): boolean => {
      const s = model.source[e]!;
      const t = model.target[e]!;
      const x0 = model.x[s]!;
      const x1 = model.x[t]!;
      const y0 = model.y[s]!;
      const y1 = model.y[t]!;
      return !((x0 < rect.minX && x1 < rect.minX) || (x0 > rect.maxX && x1 > rect.maxX) || (y0 < rect.minY && y1 < rect.minY) || (y0 > rect.maxY && y1 > rect.maxY));
    };
    this.alphaBoost = 1;
    if (spatial.edges.countIn(rect) <= budget * 2) {
      const count = spatial.edges.query(rect, this.edgeQuery);
      let spent = 0;
      for (let k = 0; k < count; k++) spent += area(data()[k]!);
      if (count <= budget && spent <= fill) return count;
      const share = Math.min(budget / count, fill / spent);
      const limit = share * total;
      let kept = 0;
      const buffer = data();
      for (let k = 0; k < count; k++) {
        const e = buffer[k]!;
        if ((e * spatial.inverse) % total < limit) buffer[kept++] = e;
      }
      this.alphaBoost = kept > 0 ? count / kept : 1;
      this.clipped = true;
      return kept;
    }
    let kept = 0;
    let spent = 0;
    let walked = 0;
    let buffer = data();
    for (; walked < total && kept < budget && spent < fill; walked++) {
      const e = (walked * spatial.stride) % total;
      if (!meets(e)) continue;
      if (kept >= buffer.length) {
        const grown = new Uint32Array(Math.max(1024, buffer.length * 2));
        grown.set(buffer);
        buffer = this.edgeQuery.data = grown;
      }
      buffer[kept++] = e;
      spent += area(e);
    }
    // What was walked is an even share of every edge, so the kept edges stand for total / walked each.
    this.alphaBoost = walked > 0 ? total / walked : 1;
    if (walked < total) this.clipped = true;
    return kept;
  }

  /**
   * The edges of `styled` whose box meets the view, written to the front of `edgeQuery`: all while they fit
   * `budget` (a count) and `fill` (CSS pixels of length times width), else an even sample (the same permutation as
   * `selectEdges`) that does.
   */
  private selectStyled<N, E>(input: GraphFrameInput<N, E>, styled: Uint32Array, rect: Rect, budget: number, fill: number): number {
    const { model, edgeStyles, zoom } = input;
    const slots = input.edgeSlot;
    const spatial = input.spatial!;
    if (this.edgeQuery.data.length < styled.length) this.edgeQuery.data = new Uint32Array(styled.length);
    const buffer = this.edgeQuery.data;
    let count = 0;
    let spent = 0;
    for (let k = 0; k < styled.length; k++) {
      const e = styled[k]!;
      const x0 = model.x[model.source[e]!]!;
      const y0 = model.y[model.source[e]!]!;
      const x1 = model.x[model.target[e]!]!;
      const y1 = model.y[model.target[e]!]!;
      if ((x0 < rect.minX && x1 < rect.minX) || (x0 > rect.maxX && x1 > rect.maxX) || (y0 < rect.minY && y1 < rect.minY) || (y0 > rect.maxY && y1 > rect.maxY)) continue;
      buffer[count++] = e;
      spent += Math.hypot(x1 - x0, y1 - y0) * zoom * Math.max(1, edgeStyles[(slots ? slots[e]! : e) * EDGE_FLOATS + E_WIDTH]!);
    }
    if (count <= budget && spent <= fill) return count;
    this.clipped = true;
    const total = model.edgeCount;
    const limit = Math.min(budget / count, fill / spent) * total;
    let kept = 0;
    for (let k = 0; k < count; k++) if ((buffer[k]! * spatial.inverse) % total < limit) buffer[kept++] = buffer[k]!;
    return kept;
  }

  /**
   * A dense graph's edges through the pair hierarchy, cut by `refine` as finely as the budget allows: each band is
   * drawn from one cell's centroid to the other's, as wide at each end as that cell's spread across it (sqrt(3)
   * standard deviations each side), with the opacity of its edges drawn over each other; bands wide at both ends,
   * and the edges inside cells left whole, go to a density field over the view; single node pairs that are joined
   * are lines.
   */
  private paintDense<N, E>(input: GraphFrameInput<N, E>, rect: Rect, budget: { readonly edges: number; readonly fill?: number; readonly overdraw?: number; readonly dense?: number }): void {
    const pairs = input.spatial!.dense!;
    const tree = pairs.tree;
    const { zoom, width, height, centerX, centerY, pixelRatio: dpr, edgeStyles, model } = input;
    const slot = (input.denseSlot ?? 0) * EDGE_FLOATS;
    const lineWidth = Math.max(0.5, edgeStyles[slot + E_WIDTH] ?? 1);
    const view = { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY, zoom };
    const lifted = input.lifted ?? -1;
    const sx = (x: number): number => width / 2 + (x - centerX) * zoom;
    const sy = (y: number): number => height / 2 + (y - centerY) * zoom;
    const diagonal = Math.hypot(width, height);
    const field = this.field;
    field.reset(width, height);
    const cols = field.cols[0]!;
    const rows = field.rows[0]!;
    this.bandCount = 0;
    this.singleCount = 0;
    this.cellCount = 0;
    const sink = {
      band: (a: number, b: number, edges: number): void => {
        if ((this.bandCount + 1) * 3 > this.bandCells.length) this.bandCells = growF64(this.bandCells, (this.bandCount + 1) * 3);
        const o = this.bandCount++ * 3;
        this.bandCells[o] = a;
        this.bandCells[o + 1] = b;
        this.bandCells[o + 2] = edges;
      },
      nodes: (i: number, j: number): void => {
        if ((this.singleCount + 1) * 2 > this.singleNodes.length) this.singleNodes = growU32(this.singleNodes, (this.singleCount + 1) * 2);
        this.singleNodes[this.singleCount * 2] = i;
        this.singleNodes[this.singleCount * 2 + 1] = j;
        this.singleCount++;
      },
      cell: (c: number, edges: number): void => {
        if ((this.cellCount + 1) * 2 > this.cellList.length) this.cellList = growF64(this.cellList, (this.cellCount + 1) * 2);
        this.cellList[this.cellCount * 2] = c;
        this.cellList[this.cellCount * 2 + 1] = edges;
        this.cellCount++;
      },
    };
    const r = edgeStyles[slot + E_COLOR]!;
    const g = edgeStyles[slot + E_COLOR + 1]!;
    const b = edgeStyles[slot + E_COLOR + 2]!;
    const alpha = edgeStyles[slot + E_COLOR + 3]!;
    const costs = {
      // Narrow bands cost the area they cover (clipped to the view's diagonal both ways); wide ones cost the field
      // vertices they cover.
      band: (a: number, b: number, edges: number, out: Float64Array): void => {
        if (a === b) {
          // Lines per pixel over the cell: its edges' ink (mean length about 0.9 of its radius) over its area.
          const z2 = zoom * zoom;
          const sxx = tree.sxx[a]! * z2;
          const syy = tree.syy[a]! * z2;
          const spread = Math.sqrt(Math.max(1, sxx * syy - (tree.sxy[a]! * z2) ** 2));
          out[2] = (1 - alpha) ** ((edges * lineWidth * 0.905 * 2 * Math.sqrt((sxx + syy) / 2)) / (4 * Math.PI * spread));
          return;
        }
        const dx = tree.mx[b]! - tree.mx[a]!;
        const dy = tree.my[b]! - tree.my[a]!;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ha = SQRT3 * tree.spread(a, -dy / len, dx / len) * zoom;
        const hb = SQRT3 * tree.spread(b, -dy / len, dx / len) * zoom;
        const along = Math.min(len * zoom, diagonal);
        // 1 - the band's opacity where it is widest, the least opaque.
        out[2] = (1 - alpha) ** ((edges * lineWidth) / (2 * Math.max(0.5, ha, hb)));
        if (Math.min(ha, hb) >= FIELD_HALF_WIDTH) {
          const step = fieldStep(Math.min(ha, hb));
          out[0] = 0;
          out[1] = 1 + (along * Math.min(diagonal, ha + hb)) / (step * step);
        } else {
          out[0] = along * Math.min(diagonal, Math.max(lineWidth, ha + hb));
          out[1] = 0;
        }
      },
      lines: (a: number, b: number): number => {
        let total = 0;
        for (let x = tree.lo[a]!; x < tree.hi[a]!; x++) {
          const i = tree.order[x]!;
          for (let y = a === b ? x + 1 : tree.lo[b]!; y < tree.hi[b]!; y++) {
            const j = tree.order[y]!;
            total += Math.min(diagonal, Math.hypot(model.x[j]! - model.x[i]!, model.y[j]! - model.y[i]!) * zoom) * lineWidth;
          }
        }
        return total;
      },
    };
    // Bands carry density by covering area, so they are bounded by overdraw (how many times they cover the plot
    // together), the field by a few passes over its vertices, single lines by the line-area budget.
    this.denseTau = refine(
      pairs,
      view,
      {
        items: budget.dense ?? Math.min(budget.edges, 16_000),
        area: (budget.overdraw ?? 48) * width * height,
        lines: budget.fill ?? Infinity,
        field: FIELD_PASSES * cols * rows,
        minSize: 2,
      },
      costs,
      sink,
      this.refineScratch,
    );
    if (this.denseTau > 2) this.clipped = true;

    // Bands, sorted by quantized opacity so an engine that fills per color (Canvas 2D) batches them.
    const gradient = input.gradientBands !== false;
    if (this.bandKeys.length < this.bandCount) {
      this.bandKeys = new Float64Array(this.bandCount);
      this.bandEnds = new Float64Array(this.bandCount * 2);
    }
    const ends = this.bandEnds;
    for (let k = 0; k < this.bandCount; k++) {
      const ca = this.bandCells[k * 3]!;
      const cb = this.bandCells[k * 3 + 1]!;
      const edges = this.bandCells[k * 3 + 2]!;
      const dx = tree.mx[cb]! - tree.mx[ca]!;
      const dy = tree.my[cb]! - tree.my[ca]!;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ha = Math.max(0.5, SQRT3 * tree.spread(ca, -dy / len, dx / len) * zoom);
      const hb = Math.max(0.5, SQRT3 * tree.spread(cb, -dy / len, dx / len) * zoom);
      // Lines per pixel across the band at each end: its edges' width spread over the band's width there.
      const la = 1 - (1 - alpha) ** ((edges * lineWidth) / (2 * ha));
      const lb = 1 - (1 - alpha) ** ((edges * lineWidth) / (2 * hb));
      ends[k * 2] = gradient ? la : (la + lb) / 2;
      ends[k * 2 + 1] = gradient ? lb : (la + lb) / 2;
      this.bandKeys[k] = Math.round(ends[k * 2]! * 63) * AGG_INDEX_SPAN + k;
    }
    // The density field over the view: wide bands and whole cells add their lines per pixel at the vertices they cover.
    let fieldUsed = false;
    for (let k = 0; k < this.cellCount; k++) {
      const c = this.cellList[k * 2]!;
      // Only what the nodes' own dots do not already cover.
      if (tree.radius(c) * 2 * zoom <= 2) continue;
      const z2 = zoom * zoom;
      field.addCell(sx(tree.mx[c]!), sy(tree.my[c]!), tree.sxx[c]! * z2, tree.syy[c]! * z2, tree.sxy[c]! * z2, sx(tree.minX[c]!), sy(tree.minY[c]!), sx(tree.maxX[c]!), sy(tree.maxY[c]!), this.cellList[k * 2 + 1]! * lineWidth);
      fieldUsed = true;
    }
    const order = this.bandKeys.subarray(0, this.bandCount).sort();
    for (let j = 0; j < this.bandCount; j++) {
      const k = order[j]! % AGG_INDEX_SPAN;
      const ca = this.bandCells[k * 3]!;
      const cb = this.bandCells[k * 3 + 1]!;
      const ax = sx(tree.mx[ca]!);
      const ay = sy(tree.my[ca]!);
      const bx = sx(tree.mx[cb]!);
      const by = sy(tree.my[cb]!);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      const ha = Math.max(0.5, SQRT3 * tree.spread(ca, nx, ny) * zoom);
      const hb = Math.max(0.5, SQRT3 * tree.spread(cb, nx, ny) * zoom);
      if (Math.min(ha, hb) >= FIELD_HALF_WIDTH) {
        field.addBand(ax, ay, bx, by, nx, ny, ha, hb, (this.bandCells[k * 3 + 2]! * lineWidth) / 2);
        fieldUsed = true;
        continue;
      }
      const qa = Math.round(ends[k * 2]! * 63) / 63;
      const qb = Math.round(ends[k * 2 + 1]! * 63) / 63;
      this.bandQuad(ax, ay, bx, by, nx, ny, ha, hb, r, g, b, qa, qb, dpr);
    }
    if (fieldUsed) {
      const grid = field.collapse();
      this.maskField(grid, cols, rows, tree, sx, sy);
      this.drawField(grid, cols, rows, r, g, b, alpha);
    }

    // Single pairs that are joined: lines between the node outlines, in the common style.
    const dash = edgeStyles[slot + E_DASH]!;
    const gap = edgeStyles[slot + E_GAP]!;
    const endGap = edgeStyles[slot + E_END_GAP]!;
    for (let k = 0; k < this.singleCount; k++) {
      const i = this.singleNodes[k * 2]!;
      const j = this.singleNodes[k * 2 + 1]!;
      // The dragged node's lines are drawn by the overlay, where it is now.
      if (i === lifted || j === lifted || !model.joined(i, j)) continue;
      this.ensureProjected(i, input);
      this.ensureProjected(j, input);
      const a = i * NODE_GEOMETRY;
      const c = j * NODE_GEOMETRY;
      const dx = this.nodeScreen[c]! - this.nodeScreen[a]!;
      const dy = this.nodeScreen[c + 1]! - this.nodeScreen[a + 1]!;
      if (!this.exit(this.nodeScreen, a, dx, dy, endGap)) continue;
      const x0 = this.exitX;
      const y0 = this.exitY;
      if (!this.exit(this.nodeScreen, c, -dx, -dy, endGap)) continue;
      if ((this.exitX - x0) * dx + (this.exitY - y0) * dy <= 0) continue;
      const o = this.segments.next();
      const d = this.segments.data;
      d[o] = x0 * dpr;
      d[o + 1] = y0 * dpr;
      d[o + 2] = this.exitX * dpr;
      d[o + 3] = this.exitY * dpr;
      d[o + 4] = lineWidth * dpr;
      d[o + 5] = dash * dpr;
      d[o + 6] = gap * dpr;
      d[o + 7] = 0;
      d[o + 8] = r;
      d[o + 9] = g;
      d[o + 10] = b;
      d[o + 11] = alpha;
    }
  }

  /**
   * Clear the field outside the convex hull of the nodes, where no edge can be: the coarse grids blur a band past
   * its outline by up to a step, which would show as a halo around the graph. The tree keeps the hull.
   */
  private maskField(grid: Float32Array, cols: number, rows: number, tree: PairTree, sx: (x: number) => number, sy: (y: number) => number): void {
    const n = tree.hullCount;
    if (n < 3) return;
    const h = tree.hull;
    // Per row, the hull spans one interval (it is convex): clear the vertices outside it.
    for (let row = 0; row < rows; row++) {
      const y = row * FIELD_STEP;
      let left = Infinity;
      let right = -Infinity;
      for (let e = 0; e < n; e++) {
        const f = (e + 1) % n;
        const y0 = sy(h[e * 2 + 1]!);
        const y1 = sy(h[f * 2 + 1]!);
        if ((y < y0 && y < y1) || (y > y0 && y > y1)) continue;
        const x0 = sx(h[e * 2]!);
        const x1 = sx(h[f * 2]!);
        const x = y0 === y1 ? Math.min(x0, x1) : x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
        const x2 = y0 === y1 ? Math.max(x0, x1) : x;
        if (x < left) left = x;
        if (x2 > right) right = x2;
      }
      const from = row * cols;
      if (left > right) {
        grid.fill(0, from, from + cols);
        continue;
      }
      const c0 = Math.min(cols, Math.max(0, Math.ceil(left / FIELD_STEP)));
      const c1 = Math.min(cols - 1, Math.floor(right / FIELD_STEP));
      if (c0 > 0) grid.fill(0, from, from + c0);
      if (c1 + 1 < cols) grid.fill(0, from + Math.max(0, c1 + 1), from + cols);
    }
  }

  /** The density field's opacities, ready for `fillField` in this frame's pass (`fieldCols` 0: none). */
  private fieldCols = 0;
  private fieldRows = 0;
  private readonly fieldColor = new Float32Array(3);

  /** Turn lines per pixel into opacity at each field vertex, for `submitField`. */
  private drawField(field: Float32Array, cols: number, rows: number, r: number, g: number, b: number, alpha: number): void {
    if (this.levelBuffer.length < cols * rows) this.levelBuffer = new Float32Array(cols * rows);
    const levels = this.levelBuffer;
    const log = Math.log(1 - Math.min(alpha, 0.999999));
    for (let k = 0; k < cols * rows; k++) levels[k] = 1 - Math.exp(log * field[k]!);
    this.fieldCols = cols;
    this.fieldRows = rows;
    this.fieldColor[0] = r;
    this.fieldColor[1] = g;
    this.fieldColor[2] = b;
  }

  /** Draw the pending density field, if any, under the bands. */
  private submitField(surface: RenderSurface, dpr: number): void {
    if (this.fieldCols === 0) return;
    const c = this.fieldColor;
    surface.fillField(this.levelBuffer.subarray(0, this.fieldCols * this.fieldRows), this.fieldCols, this.fieldRows, 0, 0, FIELD_STEP * dpr, c[0]!, c[1]!, c[2]!);
    this.fieldCols = 0;
  }

  /** A band as two triangles: half-widths `ha` and `hb` across (`nx`, `ny`) at each end, opacity `qa` to `qb`. */
  private bandQuad(ax: number, ay: number, bx: number, by: number, nx: number, ny: number, ha: number, hb: number, r: number, g: number, b: number, qa: number, qb: number, dpr: number): void {
    const corners = [ax + nx * ha, ay + ny * ha, qa, ax - nx * ha, ay - ny * ha, qa, bx + nx * hb, by + ny * hb, qb, ax - nx * ha, ay - ny * ha, qa, bx - nx * hb, by - ny * hb, qb, bx + nx * hb, by + ny * hb, qb];
    for (let v = 0; v < 6; v++) {
      const o = this.bands.next();
      const d = this.bands.data;
      d[o] = corners[v * 3]! * dpr;
      d[o + 1] = corners[v * 3 + 1]! * dpr;
      d[o + 2] = r;
      d[o + 3] = g;
      d[o + 4] = b;
      d[o + 5] = corners[v * 3 + 2]!;
    }
  }

  /**
   * The dragged node's edges in a dense graph, where it is now: bands from it to cells far from it or small on
   * screen, and lines to the nodes near it (the overlay pass).
   */
  private paintStar<N, E>(input: GraphFrameInput<N, E>, node: number): void {
    const pairs = input.spatial?.dense;
    if (!pairs) return;
    const tree = pairs.tree;
    const { zoom, width, height, centerX, centerY, pixelRatio: dpr, edgeStyles, model } = input;
    const slot = (input.denseSlot ?? 0) * EDGE_FLOATS;
    const lineWidth = Math.max(0.5, edgeStyles[slot + E_WIDTH] ?? 1);
    const [r, g, b, alpha] = [edgeStyles[slot + E_COLOR]!, edgeStyles[slot + E_COLOR + 1]!, edgeStyles[slot + E_COLOR + 2]!, edgeStyles[slot + E_COLOR + 3]!];
    const sx = (x: number): number => width / 2 + (x - centerX) * zoom;
    const sy = (y: number): number => height / 2 + (y - centerY) * zoom;
    const halfW = width / 2 / zoom;
    const halfH = height / 2 / zoom;
    const view = { minX: centerX - halfW, minY: centerY - halfH, maxX: centerX + halfW, maxY: centerY + halfH, zoom };
    this.ensureProjected(node, input);
    const px = this.nodeScreen[node * NODE_GEOMETRY]!;
    const py = this.nodeScreen[node * NODE_GEOMETRY + 1]!;
    starCut(tree, node, model.x[node]!, model.y[node]!, view, Math.max(2, this.denseTau), {
      band: (cell, edges) => {
        const bx = sx(tree.mx[cell]!);
        const by = sy(tree.my[cell]!);
        const len = Math.hypot(bx - px, by - py) || 1;
        const nx = -(by - py) / len;
        const ny = (bx - px) / len;
        const hb = Math.max(0.5, SQRT3 * tree.spread(cell, nx, ny) * zoom);
        const qa = 1 - (1 - alpha) ** ((edges * lineWidth) / 1);
        const qb = 1 - (1 - alpha) ** ((edges * lineWidth) / (2 * hb));
        this.bandQuad(px, py, bx, by, nx, ny, 0.5, hb, r, g, b, qa, input.gradientBands !== false ? qb : (qa + qb) / 2, dpr);
      },
      node: (j) => {
        if (!model.joined(node, j)) return;
        this.ensureProjected(j, input);
        const o = this.segments.next();
        const d = this.segments.data;
        d[o] = px * dpr;
        d[o + 1] = py * dpr;
        d[o + 2] = this.nodeScreen[j * NODE_GEOMETRY]! * dpr;
        d[o + 3] = this.nodeScreen[j * NODE_GEOMETRY + 1]! * dpr;
        d[o + 4] = lineWidth * dpr;
        d[o + 5] = 0;
        d[o + 6] = 0;
        d[o + 7] = 0;
        d[o + 8] = r;
        d[o + 9] = g;
        d[o + 10] = b;
        d[o + 11] = alpha;
      },
    });
  }

  /** A new projection frame: every node counts as not yet projected. */
  private startFrame<N, E>(input: GraphFrameInput<N, E>): void {
    const count = input.model.nodes.length;
    if (this.nodeScreen.length < count * NODE_GEOMETRY) this.nodeScreen = new Float32Array(count * NODE_GEOMETRY);
    if (this.projected.length < count) {
      this.projected = new Uint32Array(count);
      this.frameStamp = 0;
    }
    if (++this.frameStamp === 0xffffffff) {
      this.projected.fill(0);
      this.frameStamp = 1;
    }
  }

  private ensureProjected<N, E>(i: number, input: GraphFrameInput<N, E>): void {
    if (this.projected[i] === this.frameStamp) return;
    this.projectOne(i, input);
    this.projected[i] = this.frameStamp;
  }

  /**
   * Queried nodes in drawing order: input order, or by layer then input order when `order` is not the identity.
   * Sorts in place and returns the array.
   */
  private sortForDrawing(nodes: Uint32Array, count: number, order: Uint32Array): Uint32Array {
    const view = nodes.subarray(0, count);
    let identity = true;
    for (let k = 0; k < order.length; k += Math.max(1, order.length >> 6)) if (order[k] !== k) identity = false;
    if (identity && order[order.length - 1] === order.length - 1) {
      view.sort();
      return nodes;
    }
    if (this.rank !== order || !this.rankOf || this.rankOf.length !== order.length) {
      this.rankOf = new Uint32Array(order.length);
      for (let k = 0; k < order.length; k++) this.rankOf[order[k]!] = k;
      this.rank = order;
    }
    const rankOf = this.rankOf;
    // Sort by rank: map to ranks, sort numerically, map back.
    for (let k = 0; k < count; k++) view[k] = rankOf[view[k]!]!;
    view.sort();
    for (let k = 0; k < count; k++) view[k] = order[view[k]!]!;
    return nodes;
  }

  /**
   * The aggregate level: merged edges (the heaviest `edgeBudget` of those on screen) with the opacity of their
   * edges drawn over each other, then one dot per cell.
   */
  private paintAggregate<N, E>(input: GraphFrameInput<N, E>, agg: Aggregate, edgeBudget: number): void {
    const { width, height, zoom, centerX, centerY, pixelRatio: dpr, edgeStyles, nodeStyles, model } = input;
    const sx = (x: number): number => width / 2 + (x - centerX) * zoom;
    const sy = (y: number): number => height / 2 + (y - centerY) * zoom;
    // A merged edge is as wide as the edges are, from the first edge's style.
    const lineWidth = model.edgeCount > 0 ? Math.max(0.5, edgeStyles[E_WIDTH]!) : 1;
    const onScreen = (k: number): boolean => {
      const ax = sx(agg.cellX[agg.edgeA[k]!]!);
      const ay = sy(agg.cellY[agg.edgeA[k]!]!);
      const bx = sx(agg.cellX[agg.edgeB[k]!]!);
      const by = sy(agg.cellY[agg.edgeB[k]!]!);
      return !((ax < 0 && bx < 0) || (ax > width && bx > width) || (ay < 0 && by < 0) || (ay > height && by > height));
    };
    const fill = input.budget?.fill ?? Infinity;
    // The merged edges on screen, heaviest first (an order fixed per level, equal weights by index, so an even
    // sample of them), are kept until the count or the area budget is spent: those ranked before the first left
    // out are drawn.
    let cut = agg.edgeCount;
    let taken = 0;
    let spent = 0;
    for (let j = 0; j < agg.edgeCount; j++) {
      const k = agg.byWeight[j]!;
      if (!onScreen(k)) continue;
      if (taken >= edgeBudget || spent >= fill) {
        cut = j;
        this.clipped = true;
        break;
      }
      const ax = agg.cellX[agg.edgeA[k]!]! - agg.cellX[agg.edgeB[k]!]!;
      const ay = agg.cellY[agg.edgeA[k]!]! - agg.cellY[agg.edgeB[k]!]!;
      spent += Math.sqrt(ax * ax + ay * ay) * zoom * lineWidth;
      taken++;
    }
    // In quantized color order (5 bits a channel, 16 opacities, also fixed per level), so engines that stroke per
    // style (Canvas 2D) draw a few dozen paths instead of one per merged edge. At this size the steps cannot be seen.
    for (let j = 0; j < agg.edgeCount; j++) {
      const k = agg.byKey[j]!;
      if (agg.rank[k]! >= cut || !onScreen(k)) continue;
      const o = this.segments.next();
      const d = this.segments.data;
      d[o] = sx(agg.cellX[agg.edgeA[k]!]!) * dpr;
      d[o + 1] = sy(agg.cellY[agg.edgeA[k]!]!) * dpr;
      d[o + 2] = sx(agg.cellX[agg.edgeB[k]!]!) * dpr;
      d[o + 3] = sy(agg.cellY[agg.edgeB[k]!]!) * dpr;
      d[o + 4] = lineWidth * dpr;
      d[o + 5] = 0;
      d[o + 6] = 0;
      d[o + 7] = 0;
      unquantize(agg.edgeKey[k]!, d, o + 8);
    }
    // One dot per cell, as large as its nodes would cover, at least the minimum size and at most the cell.
    const cellPx = agg.cell * zoom;
    // Each node is drawn at least `minNodePx` across, so a cell's nodes cover about n of those squares.
    const nodePx = Math.max(input.minNodePx, model.nodes.length > 0 ? Math.max(nodeStyles[N_WIDTH]!, nodeStyles[N_HEIGHT]!) * zoom : 1);
    for (let c = 0; c < agg.cellCount; c++) {
      const x = sx(agg.cellX[c]!);
      const y = sy(agg.cellY[c]!);
      const size = Math.min(cellPx, nodePx * Math.sqrt(agg.cellNodes[c]!));
      const half = size / 2;
      if (x + half < 0 || y + half < 0 || x - half > width || y - half > height) continue;
      const o = this.shapes.next();
      const d = this.shapes.data;
      d[o] = (x - half) * dpr;
      d[o + 1] = (y - half) * dpr;
      d[o + 2] = size * dpr;
      d[o + 3] = size * dpr;
      d[o + 4] = half * dpr;
      d[o + 5] = 0;
      unquantize(quantize(agg.cellColor, c * 4, agg.cellColor[c * 4 + 3]!), d, o + 6);
      d[o + 10] = 0;
      d[o + 11] = 0;
      d[o + 12] = 0;
      d[o + 13] = 0;
    }
  }

  /** Up to `limit` of the nodes in `rect`, evenly spaced through them, as minimum-size dots: a stand-in until a level is built. */
  private paintSample<N, E>(input: GraphFrameInput<N, E>, rect: Rect, limit: number): void {
    const count = input.spatial!.nodes.query(rect, this.nodeQuery);
    const stride = Math.max(1, Math.ceil(count / Math.max(1, limit)));
    const { nodeStyles, pixelRatio: dpr, width, height } = input;
    const half = input.minNodePx / 2;
    for (let k = 0; k < count; k += stride) {
      const i = this.nodeQuery.data[k]!;
      this.ensureProjected(i, input);
      const x = this.nodeScreen[i * NODE_GEOMETRY]!;
      const y = this.nodeScreen[i * NODE_GEOMETRY + 1]!;
      if (x + half < 0 || y + half < 0 || x - half > width || y - half > height) continue;
      const o = this.shapes.next();
      const d = this.shapes.data;
      d[o] = (x - half) * dpr;
      d[o + 1] = (y - half) * dpr;
      d[o + 2] = half * 2 * dpr;
      d[o + 3] = half * 2 * dpr;
      d[o + 4] = half * dpr;
      d[o + 5] = 0;
      for (let c = 0; c < 4; c++) d[o + 6 + c] = nodeStyles[i * NODE_FLOATS + N_FILL + c]!;
      d[o + 10] = 0;
      d[o + 11] = 0;
      d[o + 12] = 0;
      d[o + 13] = 0;
    }
  }

  /** Whether the overlay has anything to draw: flows the last still frame found, or a lifted node. */
  needsOverlay<N, E>(input: GraphFrameInput<N, E>): boolean {
    return this.flowCount > 0 || (input.lifted ?? -1) >= 0;
  }

  /** Whether the last still frame found flows to draw. */
  get hasFlows(): boolean {
    return this.flowCount > 0;
  }

  /**
   * Draw the flows the last static frame collected, at `input.time`, on their own surface (over the static one).
   * Clears the surface once when there are none left. Sets `moving` when another frame is needed.
   */
  paintFlows<N, E>(surface: RenderSurface, input: GraphFrameInput<N, E>): void {
    const { width, height, pixelRatio: dpr } = input;
    const lifted = input.lifted ?? -1;
    this.moving = false;
    if (this.flowCount === 0 && lifted < 0 && !this.flowsDrawn) return;
    this.segments.count = 0;
    this.dots.count = 0;
    this.triangles.count = 0;
    this.shapes.count = 0;
    this.borders.count = 0;
    this.drawFlows(this.flows, this.flowCount, input);
    if (lifted >= 0) {
      // The lifted node where the drag has it, its edges, their arrows and flows, then the node over them.
      this.projectOne(lifted, input);
      this.bands.count = 0;
      if (input.spatial?.dense) this.paintStar(input, lifted);
      this.liftPass = true;
      this.liftFlowCount = 0;
      this.buildEdges(input, input.liftedEdges ?? new Uint32Array(0), false);
      this.liftPass = false;
      this.drawFlows(this.liftFlows, this.liftFlowCount, input);
      this.buildNodes(input, lifted, null, 0);
    }
    surface.beginFrame(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)), dpr);
    if (lifted >= 0 && this.bands.count > 0) surface.fillTriangles(this.bands.data, this.bands.count);
    if (this.segments.count > 0) surface.strokeSegments(this.segments.data, this.segments.count);
    if (this.dots.count > 0) surface.fillShapes(this.dots.data, this.dots.count);
    if (this.triangles.count > 0) surface.fillTriangles(this.triangles.data, this.triangles.count);
    if (this.shapes.count > 0) surface.fillShapes(this.shapes.data, this.shapes.count);
    if (this.borders.count > 0) surface.strokeSegments(this.borders.data, this.borders.count);
    surface.endFrame();
    this.flowsDrawn = this.flowCount > 0 || lifted >= 0;
  }

  /** Flow records drawn at `input.time` into the segment and dot buffers; sets `moving` for animated ones. */
  private drawFlows<N, E>(f: Float32Array, count: number, input: GraphFrameInput<N, E>): void {
    const { pixelRatio: dpr, time, animate, edgeStyles } = input;
    for (let k = 0; k < count; k++) {
      const o = k * FLOW_RECORD;
      const s = f[o]!;
      const dash = edgeStyles[s + E_FLOW_DASH]!;
      const gap = edgeStyles[s + E_FLOW_GAP]!;
      const period = dash + gap;
      const speed = edgeStyles[s + E_FLOW_SPEED]!;
      // Dashes move toward the target: the pattern's phase falls as time goes on.
      const phase = animate && speed !== 0 ? -((time * speed) % period) : 0;
      if (animate && speed !== 0) this.moving = true;
      const bowed = f[o + 7] === 1;
      if (edgeStyles[s + E_FLOW_DOTS]) this.flowDots(f[o + 1]!, f[o + 2]!, f[o + 3]!, f[o + 4]!, f[o + 5]!, f[o + 6]!, bowed, edgeStyles[s + E_FLOW_WIDTH]!, period, phase, edgeStyles, s + E_FLOW, dpr);
      else this.curve(f[o + 1]!, f[o + 2]!, f[o + 3]!, f[o + 4]!, f[o + 5]!, f[o + 6]!, bowed, edgeStyles[s + E_FLOW_WIDTH]!, dash, gap, phase, edgeStyles, s + E_FLOW, dpr);
    }
  }

  /** Project one node again (the lifted one, which moves between still frames). */
  private projectOne<N, E>(i: number, input: GraphFrameInput<N, E>): void {
    const { model, nodeStyles, zoom, width, height, centerX, centerY, minNodePx } = input;
    if (i >= model.nodes.length || this.nodeScreen.length < (i + 1) * NODE_GEOMETRY) return;
    const s = i * NODE_FLOATS;
    const o = i * NODE_GEOMETRY;
    const minHalf = minNodePx / 2;
    this.nodeScreen[o] = width / 2 + (model.x[i]! - centerX) * zoom;
    this.nodeScreen[o + 1] = height / 2 + (model.y[i]! - centerY) * zoom;
    this.nodeScreen[o + 2] = Math.max(minHalf, (nodeStyles[s + N_WIDTH]! * zoom) / 2);
    this.nodeScreen[o + 3] = Math.max(minHalf, (nodeStyles[s + N_HEIGHT]! * zoom) / 2);
    this.nodeScreen[o + 4] = nodeStyles[s + N_SHAPE]!;
  }

  /** Node centers and half sizes on screen, with the minimum size applied. */
  private project<N, E>(input: GraphFrameInput<N, E>): void {
    const { model, nodeStyles, zoom, width, height, centerX, centerY, minNodePx } = input;
    const count = model.nodes.length;
    if (this.nodeScreen.length < count * NODE_GEOMETRY) this.nodeScreen = new Float32Array(count * NODE_GEOMETRY);
    const minHalf = minNodePx / 2;
    for (let i = 0; i < count; i++) {
      const s = i * NODE_FLOATS;
      const o = i * NODE_GEOMETRY;
      this.nodeScreen[o] = width / 2 + (model.x[i]! - centerX) * zoom;
      this.nodeScreen[o + 1] = height / 2 + (model.y[i]! - centerY) * zoom;
      this.nodeScreen[o + 2] = Math.max(minHalf, (nodeStyles[s + N_WIDTH]! * zoom) / 2);
      this.nodeScreen[o + 3] = Math.max(minHalf, (nodeStyles[s + N_HEIGHT]! * zoom) / 2);
      this.nodeScreen[o + 4] = nodeStyles[s + N_SHAPE]!;
      this.projected[i] = this.frameStamp;
    }
  }

  private paintBackground<N, E>(surface: RenderSurface, input: GraphFrameInput<N, E>): void {
    const background = input.background;
    if (!background || background.color[3]! <= 0) return;
    const { zoom, width, height, centerX, centerY, pixelRatio: dpr } = input;
    // Coarsen by doubling until dots or lines are at least 10 CSS pixels apart: a zoomed-out graph
    // keeps a calm pattern and the count stays bounded by the plot area.
    let gap = background.gap;
    while (gap * zoom < 10) gap *= 2;
    const step = gap * zoom;
    const left = centerX - width / 2 / zoom;
    const top = centerY - height / 2 / zoom;
    const firstX = Math.ceil(left / gap) * gap;
    const firstY = Math.ceil(top / gap) * gap;
    const [r, g, b, a] = background.color as [number, number, number, number];
    const size = background.size * dpr;
    if (background.kind === "dots") {
      const shapes = this.backgroundShapes;
      shapes.count = 0;
      for (let sy = (firstY - top) * zoom; sy <= height; sy += step) {
        for (let sx = (firstX - left) * zoom; sx <= width; sx += step) {
          const o = shapes.next();
          const d = shapes.data;
          d[o] = sx * dpr - size / 2;
          d[o + 1] = sy * dpr - size / 2;
          d[o + 2] = size;
          d[o + 3] = size;
          d[o + 4] = size / 2;
          d[o + 5] = 0;
          d.set([r, g, b, a, 0, 0, 0, 0], o + 6);
        }
      }
      if (shapes.count > 0) surface.fillShapes(shapes.data, shapes.count);
      return;
    }
    const lines = this.backgroundSegments;
    lines.count = 0;
    const line = (x0: number, y0: number, x1: number, y1: number): void => {
      const o = lines.next();
      lines.data.set([x0 * dpr, y0 * dpr, x1 * dpr, y1 * dpr, size, 0, 0, 0, r, g, b, a], o);
    };
    for (let sx = (firstX - left) * zoom; sx <= width; sx += step) line(sx, 0, sx, height);
    for (let sy = (firstY - top) * zoom; sy <= height; sy += step) line(0, sy, width, sy);
    if (lines.count > 0) surface.strokeSegments(lines.data, lines.count);
  }

  /** Edges into the buffers: every edge but the lifted node's, or only `subset` (the overlay pass). */
  private buildEdges<N, E>(input: GraphFrameInput<N, E>, subset: Uint32Array | null, still: boolean): void {
    const { model, edgeStyles, width, height, pixelRatio: dpr } = input;
    const lifted = still ? (input.lifted ?? -1) : -1;
    const slots = input.edgeSlot;
    // A visible-only frame projects nodes as edges need them (an edge's far end may be off screen).
    const lazy = subset !== null;
    if (still && this.drawnEdges.length < (subset ? subset.length : model.edgeCount)) this.drawnEdges = new Uint32Array(subset ? subset.length : model.edgeCount);
    const count = subset ? subset.length : model.edgeCount;
    if (this.edgeScreen.length < model.edgeCount * EDGE_GEOMETRY) this.edgeScreen = new Float32Array(model.edgeCount * EDGE_GEOMETRY);
    const ns = this.nodeScreen;
    const geometry = this.edgeScreen;
    for (let k = 0; k < count; k++) {
      const i = subset ? subset[k]! : k;
      if (i >= model.edgeCount) continue;
      if (lifted >= 0 && (model.source[i] === lifted || model.target[i] === lifted)) {
        geometry[i * EDGE_GEOMETRY + 6] = 0;
        continue;
      }
      const s = (slots ? slots[i]! : i) * EDGE_FLOATS;
      const g = i * EDGE_GEOMETRY;
      geometry[g + 6] = 0;
      if (lazy) {
        this.ensureProjected(model.source[i]!, input);
        this.ensureProjected(model.target[i]!, input);
      }
      const a = model.source[i]! * NODE_GEOMETRY;
      const b = model.target[i]! * NODE_GEOMETRY;
      const ax = ns[a]!;
      const ay = ns[a + 1]!;
      const bx = ns[b]!;
      const by = ns[b + 1]!;
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (!(length > 0)) continue;
      const style = edgeStyles[s + E_CURVATURE]!;
      const curvature = Number.isNaN(style) ? (model.reversed[i] ? AUTO_BOW : 0) : style;
      const nx = -dy / length;
      const ny = dx / length;
      const cx = (ax + bx) / 2 + nx * curvature * length;
      const cy = (ay + by) / 2 + ny * curvature * length;
      // Cull on the hull of the two centers and the control point, grown by the stroke and arrows.
      const margin = edgeStyles[s + E_WIDTH]! + edgeStyles[s + E_ARROW_SIZE]! + 2;
      if (Math.max(ax, bx, cx) < -margin || Math.min(ax, bx, cx) > width + margin || Math.max(ay, by, cy) < -margin || Math.min(ay, by, cy) > height + margin) continue;

      const gap = edgeStyles[s + E_END_GAP]!;
      if (!this.exit(ns, a, cx - ax, cy - ay, gap)) continue;
      let sx = this.exitX;
      let sy = this.exitY;
      if (!this.exit(ns, b, cx - bx, cy - by, gap)) continue;
      let ex = this.exitX;
      let ey = this.exitY;
      // Nodes that overlap leave no edge to draw.
      if ((ex - sx) * dx + (ey - sy) * dy <= 0) continue;
      // Keep the bow when the ends moved onto the outlines: the control point stays where it was.
      geometry[g] = sx;
      geometry[g + 1] = sy;
      geometry[g + 2] = cx;
      geometry[g + 3] = cy;
      geometry[g + 4] = ex;
      geometry[g + 5] = ey;
      geometry[g + 6] = 1;
      if (still) this.drawnEdges[this.drawnEdgeCount++] = i;

      const arrows = edgeStyles[s + E_ARROW]!;
      const arrowSize = edgeStyles[s + E_ARROW_SIZE]!;
      const vx = ex - sx;
      const vy = ey - sy;
      const visibleLength = Math.sqrt(vx * vx + vy * vy);
      // Under a device pixel an edge is not seen; it stays pickable through its geometry.
      if (visibleLength * dpr < 1) continue;
      // A thinned frame draws a sample of the edges: their arrowheads would be noise, not direction.
      const drawArrows = this.alphaBoost === 1 && arrowSize > 0 && visibleLength > arrowSize * 1.5;
      if (drawArrows && arrows & 1) {
        let tx = ex - cx;
        let ty = ey - cy;
        const tl = Math.sqrt(tx * tx + ty * ty) || 1;
        tx /= tl;
        ty /= tl;
        this.arrow(ex, ey, tx, ty, arrowSize, edgeStyles, s + E_COLOR, dpr);
        // The line stops inside the arrowhead, so its butt end never shows past the tip.
        ex -= tx * arrowSize * 0.7;
        ey -= ty * arrowSize * 0.7;
      }
      if (drawArrows && arrows & 2) {
        let tx = sx - cx;
        let ty = sy - cy;
        const tl = Math.sqrt(tx * tx + ty * ty) || 1;
        tx /= tl;
        ty /= tl;
        this.arrow(sx, sy, tx, ty, arrowSize, edgeStyles, s + E_COLOR, dpr);
        sx -= tx * arrowSize * 0.7;
        sy -= ty * arrowSize * 0.7;
      }

      const lineWidth = edgeStyles[s + E_WIDTH]!;
      if (lineWidth > 0 && edgeStyles[s + E_COLOR + 3]! > 0) {
        this.curve(sx, sy, cx, cy, ex, ey, curvature !== 0, lineWidth, edgeStyles[s + E_DASH]!, edgeStyles[s + E_GAP]!, 0, edgeStyles, s + E_COLOR, dpr);
      }
      if (edgeStyles[s + E_HAS_FLOW]) {
        const lift = this.liftPass;
        let f = lift ? this.liftFlows : this.flows;
        const at = lift ? this.liftFlowCount : this.flowCount;
        if ((at + 1) * FLOW_RECORD > f.length) {
          const grown = new Float32Array(Math.max(64, f.length * 2));
          grown.set(f);
          f = grown;
          if (lift) this.liftFlows = grown;
          else this.flows = grown;
        }
        const o = at * FLOW_RECORD;
        if (lift) this.liftFlowCount++;
        else this.flowCount++;
        f[o] = s;
        f[o + 1] = sx;
        f[o + 2] = sy;
        f[o + 3] = cx;
        f[o + 4] = cy;
        f[o + 5] = ex;
        f[o + 6] = ey;
        f[o + 7] = curvature !== 0 ? 1 : 0;
      }
    }
  }

  /** `exit` without allocating: the point goes to `exitX`/`exitY`; false for a zero direction. */
  private exit(screen: Float32Array, o: number, dx: number, dy: number, gap: number): boolean {
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!(length > 0)) return false;
    const ux = dx / length;
    const uy = dy / length;
    const hw = screen[o + 2]!;
    const hh = screen[o + 3]!;
    let t: number;
    if (screen[o + 4] === 0) t = (hw < hh ? hw : hh) + gap;
    else {
      const tx = ux === 0 ? Infinity : (hw + gap) / Math.abs(ux);
      const ty = uy === 0 ? Infinity : (hh + gap) / Math.abs(uy);
      t = tx < ty ? tx : ty;
    }
    this.exitX = screen[o]! + ux * t;
    this.exitY = screen[o + 1]! + uy * t;
    return true;
  }

  /** Emit a straight or quadratic stroke as segments, with the dash pattern continuous along it. */
  private curve(sx: number, sy: number, cx: number, cy: number, ex: number, ey: number, bowed: boolean, width: number, dash: number, gap: number, phase: number, styles: Float32Array, colorAt: number, dpr: number): void {
    const pieces = bowed ? Math.min(24, Math.max(6, Math.ceil(Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2) / 14))) : 1;
    let px = sx;
    let py = sy;
    let along = phase;
    for (let k = 1; k <= pieces; k++) {
      const t = k / pieces;
      const u = 1 - t;
      const qx = bowed ? u * u * sx + 2 * u * t * cx + t * t * ex : ex;
      const qy = bowed ? u * u * sy + 2 * u * t * cy + t * t * ey : ey;
      const o = this.segments.next();
      const d = this.segments.data;
      d[o] = px * dpr;
      d[o + 1] = py * dpr;
      d[o + 2] = qx * dpr;
      d[o + 3] = qy * dpr;
      d[o + 4] = width * dpr;
      d[o + 5] = dash * dpr;
      d[o + 6] = gap * dpr;
      d[o + 7] = along * dpr;
      d[o + 8] = styles[colorAt]!;
      d[o + 9] = styles[colorAt + 1]!;
      d[o + 10] = styles[colorAt + 2]!;
      d[o + 11] = this.alphaBoost === 1 ? styles[colorAt + 3]! : boosted(styles[colorAt + 3]!, this.alphaBoost);
      along += Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
      px = qx;
      py = qy;
    }
  }

  /** Round dots `size` across, `period` apart along a straight or quadratic edge, the first at `-phase`. */
  private flowDots(sx: number, sy: number, cx: number, cy: number, ex: number, ey: number, bowed: boolean, size: number, period: number, phase: number, styles: Float32Array, colorAt: number, dpr: number): void {
    if (!(size > 0) || !(period > 0)) return;
    const pieces = bowed ? Math.min(24, Math.max(6, Math.ceil(Math.hypot(ex - sx, ey - sy) / 14))) : 1;
    if (this.path.length < (pieces + 1) * 2) this.path = new Float64Array((pieces + 1) * 2);
    const points = this.path;
    for (let k = 0; k <= pieces; k++) {
      const t = k / pieces;
      const u = 1 - t;
      points[k * 2] = bowed ? u * u * sx + 2 * u * t * cx + t * t * ex : sx + (ex - sx) * t;
      points[k * 2 + 1] = bowed ? u * u * sy + 2 * u * t * cy + t * t * ey : sy + (ey - sy) * t;
    }
    // Walk the polyline, dropping a dot every `period`, the first `-phase` in (phase is zero or negative).
    let next = (((-phase % period) + period) % period) || 0;
    let walked = 0;
    const r = (size / 2) * dpr;
    for (let k = 0; k < pieces; k++) {
      const ax = points[k * 2]!;
      const ay = points[k * 2 + 1]!;
      const bx = points[k * 2 + 2]!;
      const by = points[k * 2 + 3]!;
      const length = Math.hypot(bx - ax, by - ay);
      while (next <= walked + length) {
        const t = length > 0 ? (next - walked) / length : 0;
        const o = this.dots.next();
        const d = this.dots.data;
        d[o] = (ax + (bx - ax) * t) * dpr - r;
        d[o + 1] = (ay + (by - ay) * t) * dpr - r;
        d[o + 2] = r * 2;
        d[o + 3] = r * 2;
        d[o + 4] = r;
        d[o + 5] = 0;
        for (let c = 0; c < 4; c++) d[o + 6 + c] = styles[colorAt + c]!;
        d[o + 10] = 0;
        d[o + 11] = 0;
        d[o + 12] = 0;
        d[o + 13] = 0;
        next += period;
      }
      walked += length;
    }
  }

  private arrow(tipX: number, tipY: number, tx: number, ty: number, size: number, styles: Float32Array, colorAt: number, dpr: number): void {
    const baseX = tipX - tx * size;
    const baseY = tipY - ty * size;
    const half = size * ARROW_HALF_WIDTH;
    const points = [tipX, tipY, baseX - ty * half, baseY + tx * half, baseX + ty * half, baseY - tx * half];
    for (let p = 0; p < 3; p++) {
      const o = this.triangles.next();
      const d = this.triangles.data;
      d[o] = points[p * 2]! * dpr;
      d[o + 1] = points[p * 2 + 1]! * dpr;
      d[o + 2] = styles[colorAt]!;
      d[o + 3] = styles[colorAt + 1]!;
      d[o + 4] = styles[colorAt + 2]!;
      d[o + 5] = this.alphaBoost === 1 ? styles[colorAt + 3]! : boosted(styles[colorAt + 3]!, this.alphaBoost);
    }
  }

  /** Node shapes into the buffers: every node but the lifted one, or `only` that one (the overlay pass). */
  private buildNodes<N, E>(input: GraphFrameInput<N, E>, only: number, list: Uint32Array | null, listCount: number): void {
    const { nodeStyles, width, height, zoom, pixelRatio: dpr } = input;
    const ns = this.nodeScreen;
    const lifted = input.lifted ?? -1;
    const count = only >= 0 ? 1 : listCount;
    if (only < 0 && this.drawnNodes.length < count) this.drawnNodes = new Uint32Array(count);
    for (let k = 0; k < count; k++) {
      const i = only >= 0 ? only : list![k]!;
      if (only < 0 && i === lifted) continue;
      const s = i * NODE_FLOATS;
      const o = i * NODE_GEOMETRY;
      const x = ns[o]!;
      const y = ns[o + 1]!;
      const hw = ns[o + 2]!;
      const hh = ns[o + 3]!;
      const ringWidth = nodeStyles[s + N_RING_WIDTH]!;
      const ring = ringWidth > 0 && nodeStyles[s + N_RING + 3]! > 0 ? ringWidth + nodeStyles[s + N_RING_GAP]! : 0;
      if (x + hw + ring < 0 || x - hw - ring > width || y + hh + ring < 0 || y - hh - ring > height) continue;
      if (only < 0) this.drawnNodes[this.drawnNodeCount++] = i;
      const circle = nodeStyles[s + N_SHAPE] === 0;
      // A node drawn at its minimum size is a dot: round, whatever its shape.
      const radius = circle ? Math.min(hw, hh) : Math.min(nodeStyles[s + N_RADIUS]! * zoom, hw, hh);
      if (ring > 0) {
        this.shape(x, y, hw + ring, hh + ring, circle ? Math.min(hw, hh) + ring : radius + ring, ringWidth, nodeStyles, -1, s + N_RING, dpr);
      }
      // A border under a third of a device pixel is not seen: drop it, so tiny nodes stay one plain shape.
      const borderPx = Math.min(nodeStyles[s + N_BORDER]! * zoom, hw, hh);
      const border = borderPx * dpr < 0.35 ? 0 : borderPx;
      const dash = nodeStyles[s + N_DASH]! * zoom;
      const dashed = dash > 0 && border > 0;
      this.shape(x, y, hw, hh, radius, dashed ? 0 : border, nodeStyles, s + N_FILL, s + N_STROKE, dpr);
      if (dashed) this.dashedBorder(x, y, hw, hh, circle, border, dash, nodeStyles[s + N_DASH_GAP]! * zoom, nodeStyles, s + N_STROKE, dpr);
    }
  }

  /**
   * A dashed outline inside a node's box, the pattern continuous around it: four sides for a box (its
   * corners drawn square), or a 32-sided circle.
   */
  private dashedBorder(x: number, y: number, hw: number, hh: number, circle: boolean, width: number, dash: number, gap: number, styles: Float32Array, colorAt: number, dpr: number): void {
    if (styles[colorAt + 3]! <= 0) return;
    const inset = width / 2;
    const rx = hw - inset;
    const ry = hh - inset;
    // Sides as start and end points. A box's sides run to its outer edge so its butt-capped corners are filled.
    const sides: number[] = [];
    if (circle) {
      const r = Math.min(rx, ry);
      for (let k = 0; k < 32; k++) {
        const a0 = (k / 32) * Math.PI * 2;
        const a1 = ((k + 1) / 32) * Math.PI * 2;
        sides.push(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
      }
    } else {
      sides.push(x - hw, y - ry, x + hw, y - ry, x + rx, y - hh, x + rx, y + hh, x + hw, y + ry, x - hw, y + ry, x - rx, y + hh, x - rx, y - hh);
    }
    let along = 0;
    for (let k = 0; k + 3 < sides.length; k += 4) {
      const ax = sides[k]!;
      const ay = sides[k + 1]!;
      const bx = sides[k + 2]!;
      const by = sides[k + 3]!;
      const o = this.borders.next();
      const d = this.borders.data;
      d[o] = ax * dpr;
      d[o + 1] = ay * dpr;
      d[o + 2] = bx * dpr;
      d[o + 3] = by * dpr;
      d[o + 4] = width * dpr;
      d[o + 5] = dash * dpr;
      d[o + 6] = gap * dpr;
      d[o + 7] = along * dpr;
      for (let c = 0; c < 4; c++) d[o + 8 + c] = styles[colorAt + c]!;
      along += Math.hypot(bx - ax, by - ay);
    }
  }

  /** One shape record; `fillAt` of -1 means a transparent fill (a ring). */
  private shape(x: number, y: number, hw: number, hh: number, radius: number, border: number, styles: Float32Array, fillAt: number, borderAt: number, dpr: number): void {
    const o = this.shapes.next();
    const d = this.shapes.data;
    d[o] = (x - hw) * dpr;
    d[o + 1] = (y - hh) * dpr;
    d[o + 2] = hw * 2 * dpr;
    d[o + 3] = hh * 2 * dpr;
    d[o + 4] = radius * dpr;
    d[o + 5] = border * dpr;
    for (let c = 0; c < 4; c++) {
      d[o + 6 + c] = fillAt < 0 ? 0 : styles[fillAt + c]!;
      d[o + 10 + c] = styles[borderAt + c]!;
    }
  }
}

function unit(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

/**
 * Where a ray from node `o`'s center in direction (`dx`, `dy`) leaves its outline, `gap` CSS pixels out:
 * a circle's radius, or a box's edge (corners are treated as square).
 */
export function exit(screen: Float32Array, o: number, dx: number, dy: number, gap: number): [number, number] | null {
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const ux = dx / length;
  const uy = dy / length;
  const x = screen[o]!;
  const y = screen[o + 1]!;
  const hw = screen[o + 2]!;
  const hh = screen[o + 3]!;
  if (screen[o + 4] === 0) {
    const r = Math.min(hw, hh) + gap;
    return [x + ux * r, y + uy * r];
  }
  const tx = ux === 0 ? Infinity : (hw + gap) / Math.abs(ux);
  const ty = uy === 0 ? Infinity : (hh + gap) / Math.abs(uy);
  const t = Math.min(tx, ty);
  return [x + ux * t, y + uy * t];
}

/** Squared distance from (`px`, `py`) to an edge's last screen geometry, sampled along a bow. */
export function edgeDistanceSq(geometry: Float32Array, g: number, px: number, py: number): number {
  const sx = geometry[g]!;
  const sy = geometry[g + 1]!;
  const cx = geometry[g + 2]!;
  const cy = geometry[g + 3]!;
  const ex = geometry[g + 4]!;
  const ey = geometry[g + 5]!;
  const bowed = Math.abs((cx - (sx + ex) / 2) * (ey - sy) - (cy - (sy + ey) / 2) * (ex - sx)) > 1e-6;
  const pieces = bowed ? 12 : 1;
  let best = Infinity;
  let ax = sx;
  let ay = sy;
  for (let k = 1; k <= pieces; k++) {
    const t = k / pieces;
    const u = 1 - t;
    const bx = bowed ? u * u * sx + 2 * u * t * cx + t * t * ex : ex;
    const by = bowed ? u * u * sy + 2 * u * t * cy + t * t * ey : ey;
    best = Math.min(best, segmentDistanceSq(px, py, ax, ay, bx, by));
    ax = bx;
    ay = by;
  }
  return best;
}

export function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** The middle of an edge's last screen geometry, its direction there, and the side it bows to. */
export function edgeMiddle(geometry: Float32Array, g: number): { x: number; y: number; angle: number; normalX: number; normalY: number } {
  const sx = geometry[g]!;
  const sy = geometry[g + 1]!;
  const cx = geometry[g + 2]!;
  const cy = geometry[g + 3]!;
  const ex = geometry[g + 4]!;
  const ey = geometry[g + 5]!;
  const x = 0.25 * sx + 0.5 * cx + 0.25 * ex;
  const y = 0.25 * sy + 0.5 * cy + 0.25 * ey;
  const [tx, ty] = unit(ex - sx, ey - sy);
  // The bow's side: toward the control point, or the left of travel for a straight edge.
  const ox = cx - (sx + ex) / 2;
  const oy = cy - (sy + ey) / 2;
  const [normalX, normalY] = Math.hypot(ox, oy) > 1e-3 ? unit(ox, oy) : [-ty, tx];
  return { x, y, angle: Math.atan2(ty, tx), normalX, normalY };
}
