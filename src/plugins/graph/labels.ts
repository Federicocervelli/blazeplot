/**
 * The 2D layer over the graph: node content (custom renderers or the default label) and edge labels,
 * in graph units so they zoom with the shapes under them. Budgeted per frame, and only for items large
 * enough on screen to be read.
 */
import type { GraphModel } from "./model.js";
import { EDGE_GEOMETRY, NODE_GEOMETRY, edgeMiddle } from "./render.js";
import type { GraphEdge, GraphEdgeLabelFrame, GraphEdgeLabelStyle, GraphItemState, GraphNode, GraphNodeFrame } from "./types.js";

export type NodeRenderer<N> = (ctx: CanvasRenderingContext2D, node: GraphNode<N>, frame: GraphNodeFrame) => void;
export type EdgeLabelRenderer<E> = (ctx: CanvasRenderingContext2D, edge: GraphEdge<E>, frame: GraphEdgeLabelFrame) => void;

export interface ResolvedLabelStyle {
  readonly labelFont: string;
  readonly labelColor: string;
  readonly edge: Required<Omit<GraphEdgeLabelStyle, "color" | "background" | "borderColor">> & { readonly color: string; readonly background: string; readonly borderColor: string };
}

export interface LabelPassInput<N, E> {
  readonly ctx: CanvasRenderingContext2D;
  readonly model: GraphModel<N, E>;
  readonly order: Uint32Array;
  readonly nodeScreen: Float32Array;
  readonly edgeScreen: Float32Array;
  /** Node box sizes in graph units, from the node styles. */
  readonly nodeSize: (index: number) => readonly [width: number, height: number, rect: boolean];
  readonly nodeState: (index: number) => GraphItemState;
  readonly edgeState: (index: number) => GraphItemState;
  readonly drawNode: NodeRenderer<N> | null;
  readonly drawEdgeLabel: EdgeLabelRenderer<E> | null;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly detailMinPx: number;
  readonly maxDetails: number;
  readonly maxEdgeLabels: number;
}

/** Draw every label of one frame. Errors thrown by app renderers are reported once per frame and do not stop the frame. */
export function drawLabels<N, E>(input: LabelPassInput<N, E>): void {
  const { ctx, model, zoom, width, height, pixelRatio: dpr } = input;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  let failed: unknown = null;

  if (input.drawEdgeLabel) {
    let drawn = 0;
    for (let i = 0; i < model.edges.length && drawn < input.maxEdgeLabels; i++) {
      const g = i * EDGE_GEOMETRY;
      if (input.edgeScreen[g + 6] !== 1) continue;
      const middle = edgeMiddle(input.edgeScreen, g);
      if (middle.x < -50 || middle.y < -50 || middle.x > width + 50 || middle.y > height + 50) continue;
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, middle.x * dpr, middle.y * dpr);
      ctx.save();
      try {
        input.drawEdgeLabel(ctx, model.edges[i]!, { screenX: middle.x, screenY: middle.y, angle: middle.angle, normalX: middle.normalX, normalY: middle.normalY, zoom, state: input.edgeState(i) });
      } catch (error) {
        failed ??= error;
      }
      ctx.restore();
      drawn++;
    }
  }

  if (input.drawNode) {
    let drawn = 0;
    for (let k = 0; k < input.order.length && drawn < input.maxDetails; k++) {
      const i = input.order[k]!;
      const o = i * NODE_GEOMETRY;
      const hw = input.nodeScreen[o + 2]!;
      const hh = input.nodeScreen[o + 3]!;
      if (Math.min(hw, hh) * 2 < input.detailMinPx) continue;
      const x = input.nodeScreen[o]! - hw;
      const y = input.nodeScreen[o + 1]! - hh;
      // Content may spill past the box (a label under a circle), so keep a margin before culling.
      if (x + hw * 2 < -hw * 2 || y + hh * 2 < -hh * 2 - 40 || x > width + hw * 2 || y > height + hh * 2) continue;
      const [w, h, rect] = input.nodeSize(i);
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, x * dpr, y * dpr);
      ctx.save();
      try {
        input.drawNode(ctx, model.nodes[i]!, { screenX: x, screenY: y, screenWidth: hw * 2, screenHeight: hh * 2, width: w, height: h, zoom, shape: rect ? "rect" : "circle", state: input.nodeState(i) });
      } catch (error) {
        failed ??= error;
      }
      ctx.restore();
      drawn++;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (failed) console.error("BlazePlot graph: a node or edge label renderer threw.", failed);
}

const widthCache = new Map<string, number>();

/** `measureText` widths, cached per font and text; the cache is dropped when it grows past a bound. */
export function textWidth(ctx: CanvasRenderingContext2D, text: string): number {
  const key = `${ctx.font}\u0000${text}`;
  let value = widthCache.get(key);
  if (value === undefined) {
    if (widthCache.size > 20_000) widthCache.clear();
    value = ctx.measureText(text).width;
    widthCache.set(key, value);
  }
  return value;
}

/** `text` cut with an ellipsis to fit `maxWidth` in the current font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (textWidth(ctx, text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(ctx, `${text.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "";
}

/** The default node content: its label inside a box, or under a circle. */
export function defaultNodeRenderer<N>(style: () => ResolvedLabelStyle): NodeRenderer<N> {
  return (ctx, node, frame) => {
    const text = node.label ?? node.id;
    if (!text) return;
    const { labelFont, labelColor } = style();
    ctx.font = labelFont;
    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    if (frame.shape === "circle") {
      ctx.textBaseline = "top";
      ctx.fillText(fitText(ctx, text, Math.max(frame.width * 4, 80)), frame.width / 2, frame.height + 3);
      return;
    }
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, text, frame.width - 8), frame.width / 2, frame.height / 2);
  };
}

/** The default edge label: `edge.label` in a rounded box. */
export function defaultEdgeLabelRenderer<E>(style: () => ResolvedLabelStyle): EdgeLabelRenderer<E> {
  return (ctx, edge, frame) => {
    const text = edge.label;
    if (!text) return;
    const s = style().edge;
    ctx.font = s.font;
    const w = textWidth(ctx, text) + s.paddingX * 2;
    const metrics = ctx.measureText("Mg");
    const textHeight = (metrics.actualBoundingBoxAscent ?? 8) + (metrics.actualBoundingBoxDescent ?? 2);
    const h = (Number.isFinite(textHeight) && textHeight > 0 ? textHeight : 10) + s.paddingY * 2;
    // Clear of a reverse edge: along the bow's side by the offset plus half the box's extent that way.
    const away = s.offset > 0 ? s.offset + Math.abs(frame.normalX) * (w / 2) + Math.abs(frame.normalY) * (h / 2) : 0;
    const x = frame.normalX * away - w / 2;
    const y = frame.normalY * away - h / 2;
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, Math.min(s.radius, h / 2));
    if (s.background) {
      ctx.fillStyle = s.background;
      ctx.fill();
    }
    if (s.borderWidth > 0 && s.borderColor) {
      ctx.lineWidth = s.borderWidth;
      ctx.strokeStyle = s.borderColor;
      ctx.stroke();
    }
    ctx.fillStyle = s.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2);
  };
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
