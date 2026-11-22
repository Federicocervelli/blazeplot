/**
 * Graph drawing: projecting nodes to the screen, edge geometry (ends on node outlines, bows, arrowheads,
 * dashes and flow), culling, and the device-pixel buffers handed to the chart's render surface. Keeps the
 * screen geometry of the last frame for picking. No chart or plugin lifecycle.
 */
import type { ChartPluginContext } from "../../ui/PluginTypes.js";
import { type Aggregate, quantize, unquantize } from "./aggregate.js";
import type { Rect } from "./grid.js";
import { LineField } from "./field.js";
import type { GraphModel } from "./model.js";
import type { GraphIndex } from "./spatial.js";
import { type EdgeLevels, edgesForView } from "./edgeLevels.js";
import { type CutView, type PairHierarchy, type PairTree, type RefineCosts, type RefineSink, RefineScratch, refine } from "./pairs.js";
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
/** Segments the engine keeps between frames (`RenderSurface.createSegmentSet`). */
export type SegmentSetHandle = ReturnType<RenderSurface["createSegmentSet"]>;

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
  readonly budget?: { readonly nodes: number; readonly edges: number; readonly fill?: number; readonly overdraw?: number; readonly dense?: number; readonly fieldStep?: number };
  /** A dense graph's common edge style record (bands and single edges are drawn with it). */
  readonly denseSlot?: number;
  /** A dense graph's edges styled apart from the common style: drawn one by one, over the bands. */
  readonly styledEdges?: Uint32Array | null;
  /** Whether bands may fade from one end to the other (per-vertex color); else each is one color. */
  readonly gradientBands?: boolean;
  /**
   * A large graph's plain edges (one common style, straight, no arrows or flows), kept by the engine and ranked by
   * level (see `edgeLevels.ts`): drawn from the set, with what does not fit `fill` as a density, instead of being
   * collected each frame. `apart` lists the edges drawn one by one over them (any other style, or restyled since).
   */
  readonly retained?: RetainedEdges | null;
}

/** A large graph's plain edges kept between frames; see `GraphFrameInput.retained`. */
export interface RetainedEdges {
  readonly set: SegmentSetHandle;
  readonly levels: EdgeLevels;
  /** Straight color and CSS pixel width and dash of the common style. */
  readonly color: readonly [number, number, number, number];
  readonly width: number;
  readonly dash: number;
  readonly gap: number;
  /** CSS pixels of line area a frame draws from the set before the rest is density (see `edgesForView`). */
  readonly fill: number;
  /** Most segments a frame draws from the set (a CPU engine's per-line cost). */
  readonly maxSegments: number;
  readonly apart: Uint32Array;
  /** 1 for an edge in the set (by edge index), 0 for one drawn apart. */
  readonly member: Uint8Array;
  /** Whether drawn edges' screen geometry is needed (picking, labels), found while few enough cross the view. */
  readonly geometry: boolean;
}

/**
 * The opacity of one edge standing for `boost` edges drawn over each other, 1 - (1 - alpha)^boost, held under
 * 0.6 so a sample of a dense graph reads as a haze, not as a few hard lines.
 */
function boosted(alpha: number, boost: number): number {
  return Math.min(Math.max(alpha, 0.6), 1 - (1 - alpha) ** boost);
}

const SQRT3 = Math.sqrt(3);
/** A dense graph's lines at most this opaque add up in its field instead of being drawn one by one. */
const FAINT_LINE = 1 / 32;
/** Candidate edges `crossingEdges` tests one by one at least, before it calls a view overflowing. */
const CANDIDATES = 500_000;
/** Cells a detached node's star splits into bundles, at most, before it stops splitting. */
const STAR_ITEMS = 6_000;
/** No edge index: a single node pair of "every pair". */
const NO_EDGE = 0xffffffff;
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


/** On-screen size (CSS pixels) of an aggregate cell: below it nodes are too small to tell apart. */
const AGGREGATE_CELL_PX = 3;
/** Most edges crossing the view whose geometry a frame finds for picking and labels when drawing from a kept set. */
const GEOMETRY_EDGES = 20_000;

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
  /** Cells of the last dense cut whose inside edges are drawn as a density over the cell: (cell, edges). */
  private cellList: Float64Array = new Float64Array(0);
  private cellCount = 0;
  private readonly refineScratch = new RefineScratch();
  /** Lines per pixel of a dense graph's edges over the view. */
  private readonly lineField = new LineField();
  /** While set, `buildEdges` records geometry for picking and labels but draws nothing. */
  private geometryOnly = false;
  /** What the last frame drew from a kept set (see `edgesForView`), for tests and the refine decision. */
  retainedDrawn = { full: 0, end: 0, fade: 1, level: 0 };
  private hullScreen = new Float64Array(0);
  /** The dragged node's star in a dense graph, for the overlay. */
  private readonly overlayField = new LineField();
  /** The still layer's stars of detached nodes. */
  private readonly starField = new LineField();
  private overlayLevels = new Float32Array(0);
  private overlayFieldUsed = false;
  private overlayColor: readonly [number, number, number] = [0, 0, 0];
  /** The coarse cut's lines per pixel, which the full cut weighs its detail by. */
  private throughCache = new Float32Array(0);
  private levelBuffer = new Float32Array(0);
  /** Lines per pixel of a kept set's density, over the view (`hazeInto`). */
  private hazeCounts = new Float32Array(0);
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
    this.flowNodeCount = 0;
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
      this.buildNodesUnderFlows(input, input.order, input.order.length);
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
      if (input.retained) {
        // Edges from the kept set, never collected or resampled per frame; nodes as below.
        this.paintRetained(surface, input, rect, input.retained);
        if (visible > budget.nodes) {
          this.aggregated = true;
          const level = Math.max(0, Math.ceil(Math.log2(AGGREGATE_CELL_PX / zoom / spatial.base)));
          const agg = spatial.level(level, model, input.nodeStyles, input.edgeStyles, input.edgeSlot) ?? spatial.nearest(level);
          // Only its dots: no merged edges.
          if (agg) this.paintAggregate(input, agg, 0);
          else this.paintSample(input, nodeRect, budget.nodes);
          this.clipped = !agg;
        } else {
          const nodeCount = spatial.nodes.query(nodeRect, this.nodeQuery);
          const nodes = this.sortForDrawing(this.nodeQuery.data, nodeCount, input.order);
          for (let k = 0; k < nodeCount; k++) this.ensureProjected(nodes[k]!, input);
          this.buildNodesUnderFlows(input, nodes, nodeCount);
        }
      } else if (visible > budget.nodes) {
        // Only too many visible nodes calls for the aggregate: while nodes can still be told apart, too many edges
        // are thinned below instead, so a dense graph keeps its nodes.
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
          // A dense graph: bands and single edges from the pair hierarchy, then every edge styled apart from the
          // rest (flows, highlights) on the view, one by one: those are never sampled.
          this.paintDense(input, rect, budget);
          const styled = input.styledEdges ?? null;
          if (styled && styled.length > 0) {
            const kept = this.selectStyled(input, styled, rect);
            this.buildEdges(input, this.edgeQuery.data.subarray(0, kept), true);
          }
        } else if (spatial.overflow && this.crossingEdges(input, rect, budget.edges, budget.fill ?? Infinity) < 0) {
          // More edges cross the view than a frame draws one by one: those in the common style through the pair
          // hierarchy, as a dense graph's are, and every other one on its own.
          this.paintDense(input, rect, budget, spatial.overflow);
          const styled = input.styledEdges ?? null;
          if (styled && styled.length > 0) {
            const kept = this.selectStyled(input, styled, rect);
            this.buildEdges(input, this.edgeQuery.data.subarray(0, kept), true);
          }
        } else if (spatial.overflow) {
          // They fit: `crossingEdges` left them in the query buffer.
          this.alphaBoost = 1;
          const kept = this.crossingEdges(input, rect, budget.edges, budget.fill ?? Infinity);
          this.buildEdges(input, this.edgeQuery.data.subarray(0, kept), true);
        } else {
          // A graph too small for a pair hierarchy: every edge that crosses the view, however many.
          this.alphaBoost = 1;
          const kept = this.crossingEdges(input, rect, Infinity, Infinity);
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
        this.buildNodesUnderFlows(input, nodes, nodeCount);
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
   * A large graph's plain edges from the kept set: the density of those the view's budget leaves out (from the
   * world-space grid, so it holds still while the view moves), then the ranked levels that fit and the next one
   * faded in, then every edge styled apart, one by one, on top.
   */
  private paintRetained<N, E>(surface: RenderSurface, input: GraphFrameInput<N, E>, rect: Rect, retained: RetainedEdges): void {
    const { width, height, zoom, centerX, centerY, pixelRatio: dpr } = input;
    const { levels, set, color } = retained;
    const drawn = edgesForView(levels, rect.minX, rect.minY, rect.maxX, rect.maxY, zoom, retained.width, retained.fill);
    // A CPU engine pays per line too: stop at its limit, fading nothing.
    if (drawn.end > retained.maxSegments) {
      drawn.end = Math.max(drawn.full, Math.min(drawn.end, retained.maxSegments));
      if (drawn.full > retained.maxSegments) {
        drawn.full = drawn.end = retained.maxSegments;
        drawn.fade = 1;
      }
    }
    this.retainedDrawn = drawn;
    if (drawn.level < levels.levels) this.hazeInto(input, retained, drawn.level, drawn.fade);
    this.submitField(surface, dpr);
    // Points are stored relative to the grid's corner (see `Graph.ts`).
    const scale = zoom * dpr;
    const offsetX = (width / 2 + (levels.minX - centerX) * zoom) * dpr;
    const offsetY = (height / 2 + (levels.minY - centerY) * zoom) * dpr;
    const style = { scaleX: scale, scaleY: scale, offsetX, offsetY, width: retained.width * dpr, dash: retained.dash * dpr, gap: retained.gap * dpr };
    if (drawn.full > 0) surface.drawSegmentSet(set, { ...style, color, first: 0, count: drawn.full });
    if (drawn.end > drawn.full && drawn.fade > 0.004) surface.drawSegmentSet(set, { ...style, color: [color[0], color[1], color[2], color[3] * drawn.fade], first: drawn.full, count: drawn.end - drawn.full });

    // Picking and labels need the screen geometry of drawn edges: found while few enough cross the view.
    if (retained.geometry) {
      this.alphaBoost = 1;
      let kept = this.crossingEdges(input, rect, GEOMETRY_EDGES, Infinity);
      // Edges drawn apart are found below, with their drawing.
      const query = this.edgeQuery.data;
      let members = 0;
      for (let k = 0; k < kept; k++) if (retained.member[query[k]!] === 1) query[members++] = query[k]!;
      kept = members;
      if (kept > 0) {
        this.geometryOnly = true;
        try {
          this.buildEdges(input, this.edgeQuery.data.subarray(0, kept), true);
        } finally {
          this.geometryOnly = false;
        }
      }
    }
    // Edges styled apart from the set, all of those on the view.
    if (retained.apart.length > 0) {
      const kept = this.selectStyled(input, retained.apart, rect);
      this.buildEdges(input, this.edgeQuery.data.subarray(0, kept), true);
    }
    if (this.segments.count > 0) surface.strokeSegments(this.segments.data, this.segments.count);
    if (this.triangles.count > 0) surface.fillTriangles(this.triangles.data, this.triangles.count);
  }

  /**
   * The density of a kept set's edges in levels past `level`, plus `1 - fade` of level `level`'s: lines per pixel
   * at each vertex of a grid over the view, read bilinearly from the world-space grid of edge length per cell.
   */
  private hazeInto<N, E>(input: GraphFrameInput<N, E>, retained: RetainedEdges, level: number, fade: number): void {
    const { width, height, zoom, centerX, centerY } = input;
    const { levels } = retained;
    const after = levels.lengthFrom[level + 1]!;
    const at = levels.lengthFrom[level]!;
    const cellPx = levels.cell * zoom;
    // About two samples per grid cell, at most one per two CSS pixels and at least one per sixteen.
    const step = Math.min(16, Math.max(2, cellPx / 2));
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;
    if (this.hazeCounts.length < cols * rows) this.hazeCounts = new Float32Array(cols * rows);
    const counts = this.hazeCounts;
    // Lines per pixel from world length per cell: length * zoom pixels of line, `width` wide, over cellPx² pixels.
    const toLines = Math.max(retained.width, 0) / (levels.cell * levels.cell * zoom);
    const gc = levels.cols;
    const gr = levels.rows;
    let any = false;
    for (let r = 0; r < rows; r++) {
      // Grid coordinates of cell centers: cell (c, r) is centered at c + 0.5.
      const gy = (centerY + (r * step - height / 2) / zoom - levels.minY) / levels.cell - 0.5;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      for (let c = 0; c < cols; c++) {
        const gx = (centerX + (c * step - width / 2) / zoom - levels.minX) / levels.cell - 0.5;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const cx = x0 + (k & 1);
          const cy = y0 + (k >> 1);
          if (cx < 0 || cy < 0 || cx >= gc || cy >= gr) continue;
          const i = cy * gc + cx;
          const v = after[i]! + (1 - fade) * (at[i]! - after[i]!);
          sum += v * (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy);
        }
        const n = sum * toLines;
        counts[r * cols + c] = n;
        if (n > 0) any = true;
      }
    }
    if (!any) return;
    const color = retained.color;
    this.drawField(counts, cols, rows, step, color[0], color[1], color[2], color[3]);
  }

  /**
   * The edges whose line crosses the view, written to the front of `edgeQuery`, while they fit `budget` (a count)
   * and `fill` (CSS pixels of on-screen length times width); -1 when they do not. Only the part of a line on the
   * view counts: a long edge that crosses a corner costs what it covers.
   */
  private crossingEdges<N, E>(input: GraphFrameInput<N, E>, rect: Rect, budget: number, fill: number): number {
    const spatial = input.spatial!;
    // Boxes meet the view more often than lines cross it (long edges, much more often), so candidates are tested
    // one by one up to a fixed floor, a few milliseconds of work, however small the budget.
    if (spatial.edges.countIn(rect) > Math.max(budget * 8, CANDIDATES)) return -1;
    const count = spatial.edges.query(rect, this.edgeQuery);
    const { model, edgeStyles, zoom } = input;
    const slots = input.edgeSlot;
    const data = this.edgeQuery.data;
    let kept = 0;
    let spent = 0;
    for (let k = 0; k < count; k++) {
      const e = data[k]!;
      const s = model.source[e]!;
      const t = model.target[e]!;
      const length = clippedLength(model.x[s]!, model.y[s]!, model.x[t]!, model.y[t]!, rect);
      if (length < 0) continue;
      data[kept++] = e;
      spent += length * zoom * Math.max(1, edgeStyles[(slots ? slots[e]! : e) * EDGE_FLOATS + E_WIDTH]!);
      if (kept > budget || spent > fill) return -1;
    }
    return kept;
  }

  /**
   * The edges of `styled` that cross the view, written to the front of `edgeQuery`: all of them, never a sample,
   * since an edge styled apart is one the reader is meant to see.
   */
  private selectStyled<N, E>(input: GraphFrameInput<N, E>, styled: Uint32Array, rect: Rect): number {
    const { model } = input;
    if (this.edgeQuery.data.length < styled.length) this.edgeQuery.data = new Uint32Array(styled.length);
    const buffer = this.edgeQuery.data;
    let count = 0;
    for (let k = 0; k < styled.length; k++) {
      const e = styled[k]!;
      const s = model.source[e]!;
      const t = model.target[e]!;
      if (segmentCrosses(model.x[s]!, model.y[s]!, model.x[t]!, model.y[t]!, rect)) buffer[count++] = e;
    }
    return count;
  }

  /**
   * A dense graph's edges through the pair hierarchy, cut by `refine` as finely as the budget allows: each band is
   * drawn from one cell's centroid to the other's, as wide at each end as that cell's spread across it (sqrt(3)
   * standard deviations each side), with the opacity of its edges drawn over each other; bands wide at both ends,
   * and the edges inside cells left whole, go to a density field over the view; single node pairs that are joined
   * are lines.
   */
  private paintDense<N, E>(input: GraphFrameInput<N, E>, rect: Rect, budget: { readonly edges: number; readonly fill?: number; readonly overdraw?: number; readonly dense?: number; readonly fieldStep?: number }, pairs: PairHierarchy = input.spatial!.dense!): void {
    const tree = pairs.tree;
    const { zoom, width, height, centerX, centerY, pixelRatio: dpr, edgeStyles, model } = input;
    const slot = (input.denseSlot ?? 0) * EDGE_FLOATS;
    const lineWidth = Math.max(0.5, edgeStyles[slot + E_WIDTH] ?? 1);
    const view = { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY, zoom };
    const lifted = input.lifted ?? -1;
    const sx = (x: number): number => width / 2 + (x - centerX) * zoom;
    const sy = (y: number): number => height / 2 + (y - centerY) * zoom;
    const diagonal = Math.hypot(width, height);
    const step = budget.fieldStep ?? 1;
    const field = this.lineField;
    field.reset(width, height, step);
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
        if ((this.singleCount + 1) * 3 > this.singleNodes.length) this.singleNodes = growU32(this.singleNodes, (this.singleCount + 1) * 3);
        this.singleNodes[this.singleCount * 3] = i;
        this.singleNodes[this.singleCount * 3 + 1] = j;
        this.singleNodes[this.singleCount * 3 + 2] = NO_EDGE;
        this.singleCount++;
      },
      edge: (e: number): void => {
        if ((this.singleCount + 1) * 3 > this.singleNodes.length) this.singleNodes = growU32(this.singleNodes, (this.singleCount + 1) * 3);
        this.singleNodes[this.singleCount * 3] = model.source[e]!;
        this.singleNodes[this.singleCount * 3 + 1] = model.target[e]!;
        this.singleNodes[this.singleCount * 3 + 2] = e;
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
      // A bundle costs the field lines it crosses; what splitting it shows is 1 - its opacity where it is widest.
      band: (a: number, b: number, edges: number, out: Float64Array): void => {
        out[0] = 0;
        if (a === b) {
          out[1] = 0;
          const w = (tree.maxX[a]! - tree.minX[a]!) * zoom;
          const h = (tree.maxY[a]! - tree.minY[a]!) * zoom;
          const peak = (edges * lineWidth * 0.5214 * Math.sqrt((w * w + h * h) / 2) * 2.25) / Math.max(1, w * h);
          out[2] = (1 - alpha) ** peak;
          return;
        }
        const dx = tree.mx[b]! - tree.mx[a]!;
        const dy = tree.my[b]! - tree.my[a]!;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ha = SQRT3 * tree.spread(a, -dy / len, dx / len) * zoom;
        const hb = SQRT3 * tree.spread(b, -dy / len, dx / len) * zoom;
        out[1] = Math.min(len * zoom, diagonal) / step;
        out[2] = (1 - alpha) ** ((edges * lineWidth) / (2 * Math.max(0.5, ha, hb)));
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
    const items = budget.dense ?? Math.min(budget.edges, 16_000);
    // What drawing a bundle as one smooth band could get wrong, in pixels times levels: over the area it covers on
    // the view, its lines one by one differ from their average by about one line's opacity times the square root
    // of the lines per pixel (fewer than one: some pixels have a line, most none), and as they pile up the haze
    // saturates and differences fade; a band's shape is a model too, so a tenth of its own opacity is counted as
    // well. All of it is seen only through what the other edges leave of the background (`through`), and a band
    // under a pixel wide is a line already.
    const opacityOf = (rho: number): number => 1 - (1 - alpha) ** rho;
    const errorOf = (area: number, width: number, rho: number, through: number, shape: number): number => {
      if (!(area > 0) || width <= 1) return 0;
      const grain = alpha * Math.min(1, Math.sqrt(rho)) * (1 - alpha) ** rho;
      return area * 255 * through * Math.max(grain, shape * opacityOf(rho));
    };
    // What the other edges leave of the background, from what all of them leave (`total`, measured) and an entry's
    // own lines to the pixel: a piece's own haze is not a reason to leave it unsplit.
    const others = (total: number, own: number): number => Math.min(1, total / (1 - alpha) ** own);
    const makeError =
      (through: (x: number, y: number) => number) =>
      (a: number, b: number, edges: number): number => {
        if (a === b) {
          const x0 = Math.max(0, sx(tree.minX[a]!));
          const x1 = Math.min(width, sx(tree.maxX[a]!));
          const y0 = Math.max(0, sy(tree.minY[a]!));
          const y1 = Math.min(height, sy(tree.maxY[a]!));
          if (x0 >= x1 || y0 >= y1) return 0;
          const w = (tree.maxX[a]! - tree.minX[a]!) * zoom;
          const h = (tree.maxY[a]! - tree.minY[a]!) * zoom;
          const rho = (edges * lineWidth * 0.5214 * Math.sqrt((w * w + h * h) / 2)) / Math.max(1, w * h);
          const t = Math.max(through((x0 + x1) / 2, (y0 + y1) / 2), through(x0, y0), through(x1, y1), through(x0, y1), through(x1, y0));
          // The inside of a cell is a rough model: a third of its opacity may be off. What shows through is what
          // the other edges leave: its own share of the measured haze (at its peak, 2.25 times its mean) is taken out.
          return errorOf((x1 - x0) * (y1 - y0), Math.max(w, h), rho, others(t, rho * 2.25), 0.3);
        }
        const ax = sx(tree.mx[a]!);
        const ay = sy(tree.my[a]!);
        const bx = sx(tree.mx[b]!);
        const by = sy(tree.my[b]!);
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        const ha = SQRT3 * tree.spread(a, -uy, ux) * zoom;
        const hb = SQRT3 * tree.spread(b, -uy, ux) * zoom;
        const ea = SQRT3 * tree.spread(a, ux, uy) * zoom;
        const eb = SQRT3 * tree.spread(b, ux, uy) * zoom;
        // The axis, out to where its lines start and end, over the view grown by the band's reach.
        const reach = Math.max(ha, hb);
        const grown = { minX: -reach, minY: -reach, maxX: width + reach, maxY: height + reach };
        const x0 = ax - ux * ea;
        const y0 = ay - uy * ea;
        const x1 = bx + ux * eb;
        const y1 = by + uy * eb;
        const total = len + ea + eb;
        const along = clippedLength(x0, y0, x1, y1, grown);
        if (along <= 0) return 0;
        // The middle of the part on the view, as a fraction of the axis.
        const mid = clipMiddle(x0, y0, x1, y1, grown);
        const t = Math.min(1, Math.max(0, (mid * total - ea) / len));
        const across = 2 * (ha * (1 - t) + hb * t) + lineWidth;
        const rho = (edges * lineWidth) / across;
        // Where it is seen: the middle of the axis's part on the view itself, else the nearest point of the view.
        const onView = clipMiddle(x0, y0, x1, y1, { minX: 0, minY: 0, maxX: width, maxY: height });
        const mx = Math.min(width, Math.max(0, x0 + (x1 - x0) * onView));
        const my = Math.min(height, Math.max(0, y0 + (y1 - y0) * onView));
        // And at its ends, where the cells' spreads stand for where the nodes are: what shows there, if on the view.
        let seen = others(through(mx, my), rho);
        for (const [ex, ey, half] of [
          [ax, ay, ha],
          [bx, by, hb],
        ] as const) {
          if (ex < 0 || ey < 0 || ex > width || ey > height) continue;
          seen = Math.max(seen, others(through(ex, ey), (edges * lineWidth) / (2 * Math.max(half, 0.5) + lineWidth)));
        }
        // A band's model is exact for cells small against how far apart they are, off by their ratio otherwise.
        const shape = Math.min(1, (ha + hb + ea + eb) / (2 * len));
        return errorOf(along * Math.min(across, diagonal), across, rho, seen, shape);
      };
    // At rest, two cuts: a coarse one shows how saturated the haze is where, then the full cut spends its detail
    // where the background still shows through, since that is where detail can be seen.
    if (step <= 1 && items >= 64) {
      this.cutDense(pairs, view, items / 4, alpha, budget, { ...costs, error: makeError(() => 1) }, sink);
      // The haze is smooth where it matters here: a coarse grid measures it.
      field.reset(width, height, 4 * step);
      this.fieldInto(field, tree, zoom, lineWidth, sx, sy);
      this.singlesIntoField(field, model, lifted, sx, sy, lineWidth);
      const counts = field.resolve();
      const cols = field.cols;
      const rows = field.rows;
      const log = Math.log(1 - Math.min(alpha, 0.999999));
      if (this.throughCache.length < cols * rows) this.throughCache = new Float32Array(cols * rows);
      this.throughCache.set(counts.subarray(0, cols * rows));
      const cache = this.throughCache;
      const coarse = field.step;
      const sample = (x: number, y: number): number => {
        const col = Math.min(cols - 1, Math.max(0, Math.round(x / coarse)));
        const row = Math.min(rows - 1, Math.max(0, Math.round(y / coarse)));
        return Math.exp(log * cache[row * cols + col]!);
      };
      field.reset(width, height, step);
      this.bandCount = 0;
      this.singleCount = 0;
      this.cellCount = 0;
      this.denseTau = this.cutDense(pairs, view, items, alpha, budget, { ...costs, error: makeError(sample) }, sink);
    } else this.denseTau = this.cutDense(pairs, view, items, alpha, budget, { ...costs, error: makeError(() => 1) }, sink);
    if (this.denseTau > 2) this.clipped = true;
    this.fieldInto(field, tree, zoom, lineWidth, sx, sy);

    // Single pairs that are joined, in the common style: a line too faint to tell apart from its neighbours (an
    // eighth of the way to its color or less) goes into the field, where lines add up exactly; an engine draws
    // each line in 8 bits, so a thousand faint lines drawn one by one would round a thousand times.
    const faint = alpha <= FAINT_LINE;
    const dash = edgeStyles[slot + E_DASH]!;
    const gap = edgeStyles[slot + E_GAP]!;
    const endGap = edgeStyles[slot + E_END_GAP]!;
    for (let k = 0; k < this.singleCount; k++) {
      const i = this.singleNodes[k * 3]!;
      const j = this.singleNodes[k * 3 + 1]!;
      // A listed edge is known to exist; a node pair of "every pair" is looked up.
      const known = this.singleNodes[k * 3 + 2]! !== NO_EDGE;
      // The dragged node's lines are drawn by the overlay, where it is now.
      if (i === lifted || j === lifted || (!known && !model.joined(i, j))) continue;
      if (faint && dash <= 0) {
        // Too faint to see on its own: its width is drawn on the grid two pixels apart; what adds up is kept.
        field.addBundle(sx(model.x[i]!), sy(model.y[i]!), sx(model.x[j]!), sy(model.y[j]!), 0, 0, 0, 0, 1, lineWidth, 4);
        continue;
      }
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
    // The edges of nodes taken out of the hierarchy (moved by a drag), from where they are, in a field of their
    // own: the rest is clipped to the hull of the nodes still in it, these to the hull of every node (the dragged
    // node's own are the overlay's).
    const stars = this.starField;
    stars.reset(width, height, step);
    for (const d of input.spatial?.detached ?? []) if (d !== lifted) this.starInto(stars, d, input, pairs, lifted, lineWidth, alpha, [r, g, b]);
    if (field.used || stars.used) {
      const counts = field.resolve();
      this.clipField(field, tree, input, -1, false);
      if (stars.used) {
        const more = stars.resolve();
        this.clipField(stars, tree, input, -1, true);
        for (let k = 0; k < field.cols * field.rows; k++) counts[k]! += more[k]!;
      }
      this.drawField(counts, field.cols, field.rows, step, r, g, b, alpha);
    }
  }

  /** The last cut's single edges into `field`, all of them: for the coarse cut, which only measures the haze. */
  private singlesIntoField<N, E>(field: LineField, model: GraphModel<N, E>, lifted: number, sx: (x: number) => number, sy: (y: number) => number, lineWidth: number): void {
    for (let k = 0; k < this.singleCount; k++) {
      const i = this.singleNodes[k * 3]!;
      const j = this.singleNodes[k * 3 + 1]!;
      if (i === lifted || j === lifted || (this.singleNodes[k * 3 + 2]! === NO_EDGE && !model.joined(i, j))) continue;
      field.addBundle(sx(model.x[i]!), sy(model.y[i]!), sx(model.x[j]!), sy(model.y[j]!), 0, 0, 0, 0, 1, lineWidth, 4);
    }
  }

  /** One cut of a dense graph's pair hierarchy into `sink`; returns where it stopped (see `refine`). */
  private cutDense(pairs: PairHierarchy, view: CutView, items: number, alpha: number, budget: { readonly fill?: number }, costs: RefineCosts, sink: RefineSink): number {
    return refine(
      pairs,
      view,
      {
        items,
        area: Infinity,
        // Faint single lines go to the field, where they cost what bundles cost.
        lines: alpha <= FAINT_LINE ? Infinity : (budget.fill ?? Infinity),
        field: Infinity,
        minSize: 2,
      },
      costs,
      sink,
      this.refineScratch,
    );
  }

  /** The last cut's bundles and cell insides into `field`. */
  private fieldInto(field: LineField, tree: PairTree, zoom: number, lineWidth: number, sx: (x: number) => number, sy: (y: number) => number): void {
    for (let k = 0; k < this.bandCount; k++) {
      const ca = this.bandCells[k * 3]!;
      const cb = this.bandCells[k * 3 + 1]!;
      const ax = sx(tree.mx[ca]!);
      const ay = sy(tree.my[ca]!);
      const bx = sx(tree.mx[cb]!);
      const by = sy(tree.my[cb]!);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const ha = SQRT3 * tree.spread(ca, -uy, ux) * zoom;
      const hb = SQRT3 * tree.spread(cb, -uy, ux) * zoom;
      const ea = SQRT3 * tree.spread(ca, ux, uy) * zoom;
      const eb = SQRT3 * tree.spread(cb, ux, uy) * zoom;
      field.addBundle(ax, ay, bx, by, ha, hb, ea, eb, this.bandCells[k * 3 + 2]!, lineWidth);
    }
    for (let k = 0; k < this.cellCount; k++) {
      const c = this.cellList[k * 2]!;
      field.addCell(sx(tree.minX[c]!), sy(tree.minY[c]!), sx(tree.maxX[c]!), sy(tree.maxY[c]!), this.cellList[k * 2 + 1]!, lineWidth);
    }
  }

  /** The density field's opacities, ready for `fillField` in this frame's pass (`fieldCols` 0: none). */
  private fieldCols = 0;
  private fieldRows = 0;
  private fieldStep = 1;
  private readonly fieldColor = new Float32Array(3);

  /** Turn lines per pixel into opacity at each field vertex, for `submitField`. */
  private drawField(field: Float32Array, cols: number, rows: number, step: number, r: number, g: number, b: number, alpha: number): void {
    if (this.levelBuffer.length < cols * rows) this.levelBuffer = new Float32Array(cols * rows);
    const levels = this.levelBuffer;
    const log = Math.log(1 - Math.min(alpha, 0.999999));
    for (let k = 0; k < cols * rows; k++) levels[k] = 1 - Math.exp(log * field[k]!);
    this.fieldCols = cols;
    this.fieldRows = rows;
    this.fieldStep = step;
    this.fieldColor[0] = r;
    this.fieldColor[1] = g;
    this.fieldColor[2] = b;
  }

  /** Draw the pending density field, if any, under the bands. */
  private submitField(surface: RenderSurface, dpr: number): void {
    if (this.fieldCols === 0) return;
    const c = this.fieldColor;
    surface.fillField(this.levelBuffer.subarray(0, this.fieldCols * this.fieldRows), this.fieldCols, this.fieldRows, 0, 0, this.fieldStep * dpr, c[0]!, c[1]!, c[2]!);
    this.fieldCols = 0;
  }

  /**
   * The dragged node's edges in a dense graph, where it is now: bands from it to cells far from it or small on
   * screen, and lines to the nodes near it (the overlay pass).
   */
  /**
   * The edges of `node`, a node taken out of the pair hierarchy (dragged, or moved), drawn from where it is now
   * into `field`, or as lines: its partners (the other ends of its kept edges, or for "every pair" the nodes it is
   * not joined to) sorted in tree order, so a cell's share of its edges is two binary searches. Cells are walked
   * from the root; a cell is one bundle from the node's point to the cell where its lines cannot be told apart
   * (faint, or many to the pixel) and the cell looks small from the node, and is split otherwise, down to single
   * lines. Edges to other detached nodes are drawn once: by the star of the smaller index, or by the lifted node's
   * (`skip`, whose star the overlay draws, is left out here).
   */
  private starInto<N, E>(field: LineField, node: number, input: GraphFrameInput<N, E>, pairs: PairHierarchy, skip: number, lineWidth: number, alpha: number, color: readonly [number, number, number]): void {
    const tree = pairs.tree;
    const { model, zoom, width, height, centerX, centerY, pixelRatio: dpr } = input;
    if (node < 0 || node >= model.nodes.length) return;
    const sx = (x: number): number => width / 2 + (x - centerX) * zoom;
    const sy = (y: number): number => height / 2 + (y - centerY) * zoom;
    const out = tree.excluded;
    const detached = input.spatial?.detached ?? [];
    const px = sx(model.x[node]!);
    const py = sy(model.y[node]!);
    const faint = alpha <= FAINT_LINE;
    const line = (j: number): void => {
      const qx = sx(model.x[j]!);
      const qy = sy(model.y[j]!);
      if (faint) {
        field.addBundle(px, py, qx, qy, 0, 0, 0, 0, 1, lineWidth, 4);
        return;
      }
      if (clippedLength(px, py, qx, qy, { minX: 0, minY: 0, maxX: width, maxY: height }) < 0) return;
      const o = this.segments.next();
      const d = this.segments.data;
      d[o] = px * dpr;
      d[o + 1] = py * dpr;
      d[o + 2] = qx * dpr;
      d[o + 3] = qy * dpr;
      d[o + 4] = lineWidth * dpr;
      d[o + 5] = 0;
      d[o + 6] = 0;
      d[o + 7] = 0;
      d[o + 8] = color[0];
      d[o + 9] = color[1];
      d[o + 10] = color[2];
      d[o + 11] = alpha;
    };
    // Whether this star draws its edge to detached node `j`.
    const ownsPair = (j: number): boolean => j !== node && j !== skip && (skip >= 0 ? node < j : true);
    let partners = this.starPartners;
    let n = 0;
    const listed = !pairs.listIsExceptions;
    if (listed) {
      const edges = model.edgesAt(node);
      if (partners.length < edges.length) partners = this.starPartners = new Int32Array(edges.length * 2);
      const keep = pairs.keep;
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k]!;
        if (keep && keep[e] === 0) continue;
        const j = model.source[e] === node ? model.target[e]! : model.source[e]!;
        if (j === node) continue;
        if (out[j] === 1) {
          if (ownsPair(j)) line(j);
          continue;
        }
        partners[n++] = tree.pos[j]!;
      }
    } else {
      const rule = model.allPairs;
      const es = rule?.exceptSource ?? new Uint32Array(0);
      const et = rule?.exceptTarget ?? new Uint32Array(0);
      for (let k = 0; k < es.length; k++) {
        const j = es[k] === node ? et[k]! : et[k] === node ? es[k]! : -1;
        if (j < 0 || out[j] === 1) continue;
        if (partners.length <= n) {
          const grown = new Int32Array(Math.max(64, partners.length * 2));
          grown.set(partners);
          partners = this.starPartners = grown;
        }
        partners[n++] = tree.pos[j]!;
      }
      for (const j of detached) if (ownsPair(j) && model.joined(node, j)) line(j);
    }
    const sorted = partners.subarray(0, n).sort();
    const below = (p: number): number => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid]! < p) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    // Edges from the node into cell `c`.
    const into = (c: number): number => {
      const inRange = below(tree.hi[c]!) - below(tree.lo[c]!);
      return listed ? inRange : tree.size(c) - inRange;
    };
    const view = { minX: -2, minY: -2, maxX: width + 2, maxY: height + 2 };
    const stack = this.starStack;
    stack.length = 0;
    if (tree.count > 0) stack.push(0);
    let items = 0;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const count = into(c);
      if (count <= 0) continue;
      // Nothing of a cell's edges from the node meets the view: skip it (the box around node and cell misses).
      const bx0 = Math.min(px, sx(tree.minX[c]!));
      const bx1 = Math.max(px, sx(tree.maxX[c]!));
      const by0 = Math.min(py, sy(tree.minY[c]!));
      const by1 = Math.max(py, sy(tree.maxY[c]!));
      if (bx1 < view.minX || bx0 > view.maxX || by1 < view.minY || by0 > view.maxY) continue;
      if (tree.left[c]! < 0) {
        // A leaf: its edges one by one.
        if (listed) {
          for (let k = below(tree.lo[c]!); k < n && sorted[k]! < tree.hi[c]!; k++) line(tree.order[sorted[k]!]!);
        } else {
          let k = below(tree.lo[c]!);
          for (let q = tree.lo[c]!; q < tree.hi[c]!; q++) {
            while (k < n && sorted[k]! < q) k++;
            if (k < n && sorted[k] === q) continue;
            const j = tree.order[q]!;
            if (out[j] !== 1 && j !== node) line(j);
          }
        }
        continue;
      }
      const cx = sx(tree.mx[c]!);
      const cy = sy(tree.my[c]!);
      const dist = Math.hypot(cx - px, cy - py) || 1;
      const ux = (cx - px) / dist;
      const uy = (cy - py) / dist;
      const hb = SQRT3 * tree.spread(c, -uy, ux) * zoom;
      const eb = SQRT3 * tree.spread(c, ux, uy) * zoom;
      const radius = tree.radius(c) * zoom;
      // Lines to the pixel across the cell's end: too many to tell apart, or too faint, and the cell small from
      // the node: one bundle is what its lines look like.
      const crowded = faint || (count * lineWidth) / (2 * Math.max(hb, 0.5)) >= 4;
      const split = radius > 1 && items < STAR_ITEMS && (radius / dist > 0.25 || !crowded);
      if (split) {
        stack.push(tree.left[c]!, tree.right[c]!);
        continue;
      }
      field.addBundle(px, py, cx, cy, 0, hb, 0, eb, count, lineWidth);
      items++;
    }
  }

  /** Scratch for `starInto`: partners in tree order, and the walk's stack. */
  private starPartners = new Int32Array(64);
  private readonly starStack: number[] = [];

  /**
   * Clear `field` outside the convex hull of the nodes: the tree's hull (nodes still in their cells), with the
   * detached nodes where they are now (`withDetached`), and `extra`.
   */
  private clipField<N, E>(field: LineField, tree: PairTree, input: GraphFrameInput<N, E>, extra: number, withDetached = true): void {
    const { model, zoom, width, height, centerX, centerY } = input;
    const sx = (x: number): number => width / 2 + (x - centerX) * zoom;
    const sy = (y: number): number => height / 2 + (y - centerY) * zoom;
    const points: number[] = [];
    for (let k = 0; k < tree.hullCount; k++) points.push(sx(tree.hull[k * 2]!), sy(tree.hull[k * 2 + 1]!));
    if (withDetached) for (const j of input.spatial?.detached ?? []) points.push(sx(model.x[j]!), sy(model.y[j]!));
    if (extra >= 0 && extra < model.nodes.length) points.push(sx(model.x[extra]!), sy(model.y[extra]!));
    const hull = convexHull(points);
    if (this.hullScreen.length < hull.length) this.hullScreen = new Float64Array(hull.length);
    this.hullScreen.set(hull);
    field.clip(this.hullScreen, hull.length / 2);
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
    // Flows run under the nodes: the nodes a flow passes over are drawn here, over it, and not by the still frame.
    if (this.flowNodeCount > 0) this.buildNodes(input, -1, this.flowNodes, this.flowNodeCount, false);
    if (lifted >= 0) {
      // The lifted node where the drag has it, its edges, their arrows and flows, then the node over them.
      this.projectOne(lifted, input);
      this.bands.count = 0;
      this.overlayFieldUsed = false;
      const pairs = input.spatial?.dense;
      if (pairs) {
        // A dense graph's dragged node: its edges as a star from where it is, in its own field.
        const slot = (input.denseSlot ?? 0) * EDGE_FLOATS;
        const lineWidth = Math.max(0.5, input.edgeStyles[slot + E_WIDTH] ?? 1);
        const alpha = input.edgeStyles[slot + E_COLOR + 3]!;
        const color = [input.edgeStyles[slot + E_COLOR]!, input.edgeStyles[slot + E_COLOR + 1]!, input.edgeStyles[slot + E_COLOR + 2]!] as const;
        const field = this.overlayField;
        // Every other pixel while it moves; the still frame after the drop draws it in full.
        field.reset(width, height, 2);
        this.starInto(field, lifted, input, pairs, -1, lineWidth, alpha, color);
        if (field.used) {
          const counts = field.resolve();
          this.clipField(field, pairs.tree, input, lifted);
          const cells = field.cols * field.rows;
          if (this.overlayLevels.length < cells) this.overlayLevels = new Float32Array(cells);
          const log = Math.log(1 - Math.min(alpha, 0.999999));
          for (let k = 0; k < cells; k++) this.overlayLevels[k] = 1 - Math.exp(log * counts[k]!);
          this.overlayFieldUsed = true;
          this.overlayColor = color;
        }
      }
      this.liftPass = true;
      this.liftFlowCount = 0;
      this.buildEdges(input, input.liftedEdges ?? new Uint32Array(0), false);
      this.liftPass = false;
      this.drawFlows(this.liftFlows, this.liftFlowCount, input);
      this.buildNodes(input, lifted, null, 0);
    }
    surface.beginFrame(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)), dpr);
    if (lifted >= 0 && this.overlayFieldUsed) {
      const f = this.overlayField;
      surface.fillField(this.overlayLevels.subarray(0, f.cols * f.rows), f.cols, f.rows, 0, 0, f.step * dpr, this.overlayColor[0], this.overlayColor[1], this.overlayColor[2]);
    }
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
    // Room for these after any a pass earlier in the frame recorded (a kept set's geometry, then edges drawn apart).
    const room = this.drawnEdgeCount + (subset ? subset.length : model.edgeCount);
    if (still && this.drawnEdges.length < room) {
      const grown = new Uint32Array(room);
      grown.set(this.drawnEdges.subarray(0, this.drawnEdgeCount));
      this.drawnEdges = grown;
    }
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
      // Drawn elsewhere (a kept set): only picking and labels need it here.
      if (this.geometryOnly) continue;

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

  /**
   * Build the nodes of a still frame (`list`, in drawing order), but those a flow passes over: they go to
   * `flowNodes`, for the overlay to draw over the flows, so flows run under the nodes and nothing is drawn twice.
   * They still count as drawn (labels, picking).
   */
  private buildNodesUnderFlows<N, E>(input: GraphFrameInput<N, E>, list: Uint32Array, count: number): void {
    this.flowNodeCount = 0;
    if (this.flowCount === 0) {
      this.buildNodes(input, -1, list, count);
      return;
    }
    // Each flow's box (CSS px): its start, control, and end points, grown by its width.
    const f = this.flows;
    const boxes = this.flowBoxes.length >= this.flowCount * 4 ? this.flowBoxes : (this.flowBoxes = new Float64Array(this.flowCount * 4));
    for (let k = 0; k < this.flowCount; k++) {
      const o = k * FLOW_RECORD;
      const grow = input.edgeStyles[f[o]! + E_FLOW_WIDTH]! + 2;
      boxes[k * 4] = Math.min(f[o + 1]!, f[o + 3]!, f[o + 5]!) - grow;
      boxes[k * 4 + 1] = Math.min(f[o + 2]!, f[o + 4]!, f[o + 6]!) - grow;
      boxes[k * 4 + 2] = Math.max(f[o + 1]!, f[o + 3]!, f[o + 5]!) + grow;
      boxes[k * 4 + 3] = Math.max(f[o + 2]!, f[o + 4]!, f[o + 6]!) + grow;
    }
    if (this.stillNodes.length < count) this.stillNodes = new Uint32Array(count);
    if (this.flowNodes.length < count) this.flowNodes = new Uint32Array(count);
    let still = 0;
    const ns = this.nodeScreen;
    const margin = 4;
    for (let k = 0; k < count; k++) {
      const i = list[k]!;
      const o = i * NODE_GEOMETRY;
      // The node's box with room for a border or a ring.
      const x0 = ns[o]! - ns[o + 2]! - margin;
      const x1 = ns[o]! + ns[o + 2]! + margin;
      const y0 = ns[o + 1]! - ns[o + 3]! - margin;
      const y1 = ns[o + 1]! + ns[o + 3]! + margin;
      let under = false;
      for (let b = 0; b < this.flowCount && !under; b++) {
        if (!(x1 >= boxes[b * 4]! && x0 <= boxes[b * 4 + 2]! && y1 >= boxes[b * 4 + 1]! && y0 <= boxes[b * 4 + 3]!)) continue;
        // Near its path: start to the curve's middle to its end (a bowed flow's curve stays close to that).
        const q = b * FLOW_RECORD;
        const mx = 0.25 * f[q + 1]! + 0.5 * f[q + 3]! + 0.25 * f[q + 5]!;
        const my = 0.25 * f[q + 2]! + 0.5 * f[q + 4]! + 0.25 * f[q + 6]!;
        // What can overlap: the node's half size and its border or ring, and half the flow's width.
        const reach = Math.max(ns[o + 2]!, ns[o + 3]!) + margin + input.edgeStyles[f[q]! + E_FLOW_WIDTH]! / 2;
        under = pointSegment(ns[o]!, ns[o + 1]!, f[q + 1]!, f[q + 2]!, mx, my) <= reach || pointSegment(ns[o]!, ns[o + 1]!, mx, my, f[q + 5]!, f[q + 6]!) <= reach;
      }
      if (under) this.flowNodes[this.flowNodeCount++] = i;
      else this.stillNodes[still++] = i;
    }
    this.buildNodes(input, -1, this.stillNodes, still);
    if (this.drawnNodes.length < this.drawnNodeCount + this.flowNodeCount) {
      const grown = new Uint32Array(this.drawnNodeCount + this.flowNodeCount);
      grown.set(this.drawnNodes.subarray(0, this.drawnNodeCount));
      this.drawnNodes = grown;
    }
    for (let k = 0; k < this.flowNodeCount; k++) this.drawnNodes[this.drawnNodeCount++] = this.flowNodes[k]!;
  }

  /** Nodes a flow passes over, drawn by the overlay; the rest, drawn by the still frame; flows' boxes. */
  private flowNodes = new Uint32Array(0);
  private flowNodeCount = 0;
  private stillNodes = new Uint32Array(0);
  private flowBoxes = new Float64Array(0);

  /**
   * Node shapes into the buffers: every node but the lifted one, or `only` that one (the overlay pass). `record`
   * keeps them as the frame's drawn nodes (for labels and picking); the overlay drawing them again over flows does not.
   */
  private buildNodes<N, E>(input: GraphFrameInput<N, E>, only: number, list: Uint32Array | null, listCount: number, record = true): void {
    const { nodeStyles, width, height, zoom, pixelRatio: dpr } = input;
    const ns = this.nodeScreen;
    const lifted = input.lifted ?? -1;
    const count = only >= 0 ? 1 : listCount;
    if (record && only < 0 && this.drawnNodes.length < count) this.drawnNodes = new Uint32Array(count);
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
      if (record && only < 0) this.drawnNodes[this.drawnNodeCount++] = i;
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

/**
 * Whether the segment from (`x0`, `y0`) to (`x1`, `y1`) crosses `rect` (Liang-Barsky clipping), so a long edge
 * whose box covers the view but whose line misses it is left out.
 */
export function segmentCrosses(x0: number, y0: number, x1: number, y1: number, rect: Rect): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let lo = 0;
  let hi = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > hi) return false;
      if (r > lo) lo = r;
    } else {
      if (r < lo) return false;
      if (r < hi) hi = r;
    }
    return true;
  };
  return clip(-dx, x0 - rect.minX) && clip(dx, rect.maxX - x0) && clip(-dy, y0 - rect.minY) && clip(dy, rect.maxY - y0);
}

/** The length of the part of the segment from (`x0`, `y0`) to (`x1`, `y1`) inside `rect`, or -1 when it misses it (Liang-Barsky). */
export function clippedLength(x0: number, y0: number, x1: number, y1: number, rect: Rect): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 4; k++) {
    const p = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dy : dy;
    const q = k === 0 ? x0 - rect.minX : k === 1 ? rect.maxX - x0 : k === 2 ? y0 - rect.minY : rect.maxY - y0;
    if (p === 0) {
      if (q < 0) return -1;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > hi) return -1;
      if (r > lo) lo = r;
    } else {
      if (r < lo) return -1;
      if (r < hi) hi = r;
    }
  }
  return (hi - lo) * Math.sqrt(dx * dx + dy * dy);
}

/** The middle of the part of the segment from (`x0`, `y0`) to (`x1`, `y1`) inside `rect`, as a fraction of it (0.5 when it misses). */
export function clipMiddle(x0: number, y0: number, x1: number, y1: number, rect: Rect): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 4; k++) {
    const p = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dy : dy;
    const q = k === 0 ? x0 - rect.minX : k === 1 ? rect.maxX - x0 : k === 2 ? y0 - rect.minY : rect.maxY - y0;
    if (p === 0) {
      if (q < 0) return 0.5;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > hi) return 0.5;
      if (r > lo) lo = r;
    } else {
      if (r < lo) return 0.5;
      if (r < hi) hi = r;
    }
  }
  return (lo + hi) / 2;
}

/** The convex hull of points (x, y pairs), counterclockwise as x, y pairs (Andrew's monotone chain). */
export function convexHull(points: readonly number[]): number[] {
  const n = points.length / 2;
  if (n < 3) return points.slice();
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => points[a * 2]! - points[b * 2]! || points[a * 2 + 1]! - points[b * 2 + 1]!);
  const cross = (o: number, a: number, b: number): number => (points[a * 2]! - points[o * 2]!) * (points[b * 2 + 1]! - points[o * 2 + 1]!) - (points[a * 2 + 1]! - points[o * 2 + 1]!) * (points[b * 2]! - points[o * 2]!);
  const hull: number[] = [];
  for (const p of order) {
    while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop();
    hull.push(p);
  }
  const lower = hull.length + 1;
  for (let k = n - 2; k >= 0; k--) {
    const p = order[k]!;
    while (hull.length >= lower && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop();
    hull.push(p);
  }
  hull.pop();
  return hull.flatMap((i) => [points[i * 2]!, points[i * 2 + 1]!]);
}

/** The distance from (`px`, `py`) to the segment from (`ax`, `ay`) to (`bx`, `by`). */
function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
