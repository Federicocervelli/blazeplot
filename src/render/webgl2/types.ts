import type { RgbaColor } from "../../core/types.js";
import type { ProgramName } from "./ShaderPrograms.js";

/** Primitive topology for solid-color draws. */
export type SolidPrimitive = "lines" | "line_strip" | "triangles" | "triangle_strip";

/** Fields shared by every recorded draw. Vertices are `[x, y]` float pairs in the frame stream. */
interface DrawBase {
  /** Index of the first `[x, y]` vertex of this draw in the frame stream. */
  readonly first: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly color: RgbaColor;
}

/** Native GL primitives in a solid color (hairlines, grid, area fills, triangle batches). */
export interface SolidDraw extends DrawBase {
  readonly kind: "solid";
  readonly primitive: SolidPrimitive;
  /** Vertex count. */
  readonly count: number;
}

/** Wide lines drawn as one screen-space quad per segment. */
export interface ThickLineDraw extends DrawBase {
  readonly kind: "thickLine";
  readonly segments: number;
  /** `strip` reads consecutive vertices as a polyline; `pairs` reads independent vertex pairs. */
  readonly layout: "strip" | "pairs";
  /** Line width in device pixels. */
  readonly lineWidth: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** Instanced point quads. */
export interface PointDraw extends DrawBase {
  readonly kind: "point";
  readonly instances: number;
  /** Point size in device pixels. */
  readonly pointSize: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** Instanced bar quads, `barWidth` wide in data units, from `baseline`. */
export interface BarDraw extends DrawBase {
  readonly kind: "bar";
  readonly instances: number;
  readonly barWidth: number;
  readonly baseline: number;
}

/**
 * Instanced rectangles with per-instance colors. Each rectangle is eight floats in the frame stream
 * (`x, y, width, height` in device pixels, then `r, g, b, a`), so `first` counts four vertices per rectangle.
 */
export interface RectsDraw {
  readonly kind: "rects";
  readonly first: number;
  readonly instances: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** One recorded draw call. */
export type DrawCommand = SolidDraw | ThickLineDraw | PointDraw | BarDraw | RectsDraw;

/**
 * Minimal GPU surface used by the renderer. A frame is recorded on the CPU and submitted in one
 * call, so the number of buffer uploads does not depend on the number of series or chunks.
 */
export interface GpuBackend {
  /** Set the clipped drawing rectangle in drawing-buffer pixels. */
  viewport(x: number, y: number, w: number, h: number): void;
  clear(r: number, g: number, b: number, a: number): void;
  /** Upload the first `floatCount` floats of `stream` once, then issue every command against it in order. */
  submit(stream: Float32Array, floatCount: number, commands: readonly DrawCommand[]): void;
  /** Start building `programs` ahead of the first draw that needs them (a hint; drawing builds whatever is still missing). */
  prepare?(programs: readonly ProgramName[]): void;
  getContext?(): WebGL2RenderingContext | null;
  /** Pixels in the largest drawing buffer the context supports, when known. */
  readonly maxDrawingBufferPixels?: number;
  destroy(): void;
}
