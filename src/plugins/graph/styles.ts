/**
 * Resolving node and edge styles into flat float arrays, one record per item, so a frame reads numbers
 * and never calls style functions or parses colors. Colors are parsed once per string and theme.
 */
import type { RgbaColor } from "../../core/types.js";
import { resolveThemeColor } from "../../ui/theme.js";
import type { GraphColor, GraphEdgeStyle, GraphNodeStyle } from "./types.js";

/** Node record: shape, width, height, cornerRadius, borderWidth, opacity, layer, fill rgba, border rgba, ring rgba, ringWidth, ringGap, border dash, border gap. */
export const NODE_FLOATS = 23;
export const N_SHAPE = 0;
export const N_WIDTH = 1;
export const N_HEIGHT = 2;
export const N_RADIUS = 3;
export const N_BORDER = 4;
export const N_LAYER = 6;
export const N_FILL = 7;
export const N_STROKE = 11;
export const N_RING = 15;
export const N_RING_WIDTH = 19;
export const N_RING_GAP = 20;
export const N_DASH = 21;
export const N_DASH_GAP = 22;

/** Edge record: color rgba, width, dash, gap, arrow (bit 1 end, bit 2 start), arrowSize, curvature (NaN for auto), end gap, flow rgba, flowWidth, flowDash, flowGap, flowSpeed, pickable, has flow, flow dots. */
export const EDGE_FLOATS = 22;
export const E_COLOR = 0;
export const E_WIDTH = 4;
export const E_DASH = 5;
export const E_GAP = 6;
export const E_ARROW = 7;
export const E_ARROW_SIZE = 8;
export const E_CURVATURE = 9;
export const E_END_GAP = 10;
export const E_FLOW = 11;
export const E_FLOW_WIDTH = 15;
export const E_FLOW_DASH = 16;
export const E_FLOW_GAP = 17;
export const E_FLOW_SPEED = 18;
export const E_PICKABLE = 19;
/** 1 when the edge has a flow overlay. */
export const E_HAS_FLOW = 20;
/** 1 when the flow is drawn as round dots instead of dashes. */
export const E_FLOW_DOTS = 21;

const TRANSPARENT: RgbaColor = [0, 0, 0, 0];

/** Parses colors once per string; `clear` when the theme (and so `var()` values) may have changed. */
export class ColorCache {
  private readonly cache = new Map<string, RgbaColor>();
  constructor(private readonly context: () => Element | undefined) {}

  resolve(color: GraphColor | undefined, fallback: RgbaColor): RgbaColor {
    if (color === undefined) return fallback;
    if (typeof color !== "string") return color.length === 4 && color.every(Number.isFinite) ? color : fallback;
    let value = this.cache.get(color);
    if (!value) {
      value = resolveThemeColor(color, fallback, this.context(), "graph");
      this.cache.set(color, value);
    }
    return value;
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Defaults the theme decides, re-read on every theme change. */
export interface StyleDefaults {
  readonly nodeFill: RgbaColor;
  readonly edgeColor: RgbaColor;
}

function finite(value: number | undefined, fallback: number, min = 0, max = 1e6): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function putColor(out: Float32Array, o: number, color: RgbaColor, alpha: number): void {
  out[o] = color[0];
  out[o + 1] = color[1];
  out[o + 2] = color[2];
  out[o + 3] = Math.min(1, Math.max(0, color[3] * alpha));
}

/** Write one node style record at `o`. */
export function writeNodeStyle(out: Float32Array, o: number, style: GraphNodeStyle, colors: ColorCache, defaults: StyleDefaults): void {
  const rect = style.shape === "rect";
  const width = finite(style.width, 12, 0);
  const height = rect ? finite(style.height, width, 0) : width;
  const opacity = finite(style.opacity, 1, 0, 1);
  out[o + N_SHAPE] = rect ? 1 : 0;
  out[o + N_WIDTH] = width;
  out[o + N_HEIGHT] = height;
  out[o + N_RADIUS] = rect ? finite(style.cornerRadius, 0, 0) : width / 2;
  out[o + N_BORDER] = finite(style.borderWidth, 0, 0);
  out[o + 5] = opacity;
  out[o + N_LAYER] = finite(style.layer, 0, -1e6, 1e6);
  putColor(out, o + N_FILL, colors.resolve(style.fill, defaults.nodeFill), opacity);
  putColor(out, o + N_STROKE, colors.resolve(style.borderColor, TRANSPARENT), opacity);
  const ring = style.ring;
  putColor(out, o + N_RING, ring ? colors.resolve(ring.color, TRANSPARENT) : TRANSPARENT, 1);
  out[o + N_RING_WIDTH] = ring ? finite(ring.width, 2, 0, 1000) : 0;
  out[o + N_RING_GAP] = ring ? finite(ring.gap, 2, 0, 1000) : 0;
  const dash = style.borderDash;
  const dashed = dash !== undefined && finite(dash[0], 0, 0, 1e4) > 0 && finite(dash[1], 0, 0, 1e4) > 0;
  out[o + N_DASH] = dashed ? finite(dash[0], 0, 0, 1e4) : 0;
  out[o + N_DASH_GAP] = dashed ? finite(dash[1], 0, 0, 1e4) : 0;
}

/** Write one edge style record at `o`. */
export function writeEdgeStyle(out: Float32Array, o: number, style: GraphEdgeStyle, colors: ColorCache, defaults: StyleDefaults, pickableByDefault: boolean): void {
  const opacity = finite(style.opacity, 1, 0, 1);
  putColor(out, o + E_COLOR, colors.resolve(style.color, defaults.edgeColor), opacity);
  out[o + E_WIDTH] = finite(style.width, 1, 0, 1000);
  out[o + E_DASH] = style.dash ? finite(style.dash[0], 0, 0, 1e4) : 0;
  out[o + E_GAP] = style.dash ? finite(style.dash[1], 0, 0, 1e4) : 0;
  const arrow = style.arrow ?? "none";
  out[o + E_ARROW] = (arrow === "end" || arrow === "both" ? 1 : 0) | (arrow === "start" || arrow === "both" ? 2 : 0);
  out[o + E_ARROW_SIZE] = finite(style.arrowSize, 9, 0, 1000);
  out[o + E_CURVATURE] = style.curvature === undefined || style.curvature === "auto" ? Number.NaN : finite(style.curvature, 0, -4, 4);
  out[o + E_END_GAP] = finite(style.gap, 2, 0, 1000);
  const flow = style.flow;
  putColor(out, o + E_FLOW, flow ? colors.resolve(flow.color, defaults.edgeColor) : TRANSPARENT, opacity);
  out[o + E_FLOW_WIDTH] = flow ? finite(flow.width, out[o + E_WIDTH]!, 0, 1000) : 0;
  out[o + E_FLOW_DASH] = flow ? finite(flow.dash?.[0], 6, 0.5, 1e4) : 0;
  out[o + E_FLOW_GAP] = flow ? finite(flow.dash?.[1], 6, 0.5, 1e4) : 0;
  out[o + E_FLOW_SPEED] = flow ? finite(flow.speed, 40, -1e4, 1e4) : 0;
  out[o + E_PICKABLE] = (style.pickable ?? pickableByDefault) ? 1 : 0;
  out[o + E_HAS_FLOW] = flow ? 1 : 0;
  out[o + E_FLOW_DOTS] = flow?.shape === "dot" ? 1 : 0;
}
