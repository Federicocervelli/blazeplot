/**
 * Graph drawing: projecting nodes to the screen, edge geometry (ends on node outlines, bows, arrowheads,
 * dashes and flow), culling, and the device-pixel buffers handed to the chart's render surface. Keeps the
 * screen geometry of the last frame for picking. No chart or plugin lifecycle.
 */
import type { ChartPluginContext } from "../../ui/PluginTypes.js";
import type { GraphModel } from "./model.js";
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
  readonly edgeStyles: Float32Array;
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
}

export class GraphPainter {
  private readonly shapes = new Buffer(SHAPE);
  private readonly segments = new Buffer(SEGMENT);
  private readonly triangles = new Buffer(VERTEX);
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
  /** The point `exit` found, kept in fields so the hot loop allocates nothing. */
  private exitX = 0;
  private exitY = 0;

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
    this.flowCount = 0;
    this.liftPass = false;
    this.project(input);

    surface.beginFrame(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)), dpr);
    this.paintBackground(surface, input);
    this.buildEdges(input);
    if (this.segments.count > 0) surface.strokeSegments(this.segments.data, this.segments.count);
    if (this.triangles.count > 0) surface.fillTriangles(this.triangles.data, this.triangles.count);
    this.buildNodes(input);
    if (this.shapes.count > 0) surface.fillShapes(this.shapes.data, this.shapes.count);
    if (this.borders.count > 0) surface.strokeSegments(this.borders.data, this.borders.count);
    surface.endFrame();
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
      this.liftPass = true;
      this.liftFlowCount = 0;
      this.buildEdges(input, input.liftedEdges ?? new Uint32Array(0));
      this.liftPass = false;
      this.drawFlows(this.liftFlows, this.liftFlowCount, input);
      this.buildNodes(input, lifted);
    }
    surface.beginFrame(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)), dpr);
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
  private buildEdges<N, E>(input: GraphFrameInput<N, E>, subset: Uint32Array | null = null): void {
    const { model, edgeStyles, width, height, pixelRatio: dpr } = input;
    const lifted = subset ? -1 : (input.lifted ?? -1);
    const count = subset ? subset.length : model.edges.length;
    if (this.edgeScreen.length < model.edges.length * EDGE_GEOMETRY) this.edgeScreen = new Float32Array(model.edges.length * EDGE_GEOMETRY);
    const ns = this.nodeScreen;
    const geometry = this.edgeScreen;
    for (let k = 0; k < count; k++) {
      const i = subset ? subset[k]! : k;
      if (i >= model.edges.length) continue;
      if (lifted >= 0 && (model.source[i] === lifted || model.target[i] === lifted)) {
        geometry[i * EDGE_GEOMETRY + 6] = 0;
        continue;
      }
      const s = i * EDGE_FLOATS;
      const g = i * EDGE_GEOMETRY;
      geometry[g + 6] = 0;
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

      const arrows = edgeStyles[s + E_ARROW]!;
      const arrowSize = edgeStyles[s + E_ARROW_SIZE]!;
      const vx = ex - sx;
      const vy = ey - sy;
      const visibleLength = Math.sqrt(vx * vx + vy * vy);
      // Under a device pixel an edge is not seen; it stays pickable through its geometry.
      if (visibleLength * dpr < 1) continue;
      const drawArrows = arrowSize > 0 && visibleLength > arrowSize * 1.5;
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
      d[o + 11] = styles[colorAt + 3]!;
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
      d[o + 5] = styles[colorAt + 3]!;
    }
  }

  /** Node shapes into the buffers: every node but the lifted one, or `only` that one (the overlay pass). */
  private buildNodes<N, E>(input: GraphFrameInput<N, E>, only = -1): void {
    const { nodeStyles, order, width, height, zoom, pixelRatio: dpr } = input;
    const ns = this.nodeScreen;
    const lifted = input.lifted ?? -1;
    const count = only >= 0 ? 1 : order.length;
    for (let k = 0; k < count; k++) {
      const i = only >= 0 ? only : order[k]!;
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
