import type { RenderProjection } from "./Renderer.js";
import type { RgbaColor, SeriesStyle } from "../core/types.js";

/** Rendering backend a chart is drawn with. */
export type ChartRendererKind = "webgl2" | "canvas2d";

/**
 * @internal Semantic drawing surface the chart talks to. Vertices are data-space `[x, y]` floats
 * (origin-shifted, with nonlinear axis scales already applied) mapped to clip space by a linear
 * `RenderProjection`; implementations own how that reaches pixels (WebGL2 draw calls, Canvas 2D paths).
 * Draw calls only have to be complete by `endFrame()`, and the data arrays may be reused by the
 * chart as soon as a draw call returns.
 */
export interface ChartRenderer {
  readonly kind: ChartRendererKind;
  /** Set the drawing-buffer size (device pixels) and device pixel ratio for this frame and clear it. */
  beginFrame(width: number, height: number, pixelRatio: number): void;
  /** Finish the frame: submit anything recorded since `beginFrame` and present it. */
  endFrame(): void;
  /** The underlying WebGL2 context, or `null` when the renderer does not expose one. */
  getWebGLContext(): WebGL2RenderingContext | null;
  /** Polyline (`"line_strip"`) or independent segments (`"lines"`); NaN vertices break the line. */
  drawLines(data: Float32Array, vertexCount: number, color: RgbaColor, lineWidth: number, projection: RenderProjection, primitive?: "line_strip" | "lines"): void;
  /** 1px segments from clip-space vertices (grid lines). */
  drawClipLines(data: Float32Array, vertexCount: number, color: RgbaColor): void;
  /** Square points `pointSize` device pixels across. */
  drawPoints(data: Float32Array, pointCount: number, color: RgbaColor, pointSize: number, projection: RenderProjection): void;
  /** One bar per `[x, y]` vertex, `style.barWidth` data units wide, from `style.baseline`. */
  drawBarsInstanced(data: Float32Array, barCount: number, style: SeriesStyle, projection: RenderProjection): void;
  /** Solid triangles (axis-aligned rectangles are emitted as two triangles) or a triangle strip (area fills). */
  drawTriangles(data: Float32Array, vertexCount: number, color: RgbaColor, projection: RenderProjection, primitive?: "triangles" | "triangle_strip"): void;
  /** Release everything the renderer owns. */
  dispose(): void;
}

/** Context passed to a renderer factory when a chart (re)creates its renderer. */
export interface ChartRendererFactoryContext {
  /** The chart's plot canvas. A renderer takes exclusive ownership of its rendering context. */
  readonly canvas: HTMLCanvasElement;
}

/**
 * Creates the renderer for a chart. It may throw when its backend is unavailable.
 * Use `canvas2dRenderer()` / `autoRenderer()` from `blazeplot/renderers/canvas2d`.
 */
export type ChartRendererFactory = (context: ChartRendererFactoryContext) => ChartRenderer;
