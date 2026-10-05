import type { RgbaColor, SeriesStyle } from "../core/types.js";

/** Linear projection uniforms used by renderer draw calls. */
export interface RenderProjection {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** What one frame cost the engine: bytes staged for the GPU and draw calls issued. */
export interface FrameReport {
  /** Vertex bytes uploaded to the GPU this frame (0 for engines that draw immediately, such as Canvas 2D). */
  readonly uploadBytes: number;
  /** Draw calls the engine issued this frame. */
  readonly drawCalls: number;
}

/** Context state transitions an engine reports to the chart that owns it. */
export type RendererLossState = "lost" | "restored";

/** Static facts about the engine a chart draws with. */
export interface ChartRendererCapabilities {
  /** Draws on the GPU. */
  readonly gpu: boolean;
  /** Reports context loss and restoration through `setLossListener`. */
  readonly contextLoss: boolean;
  /** Draws through a context shared with other charts. */
  readonly shared: boolean;
  /** Largest drawing buffer, in pixels, the engine can render into. */
  readonly maxDrawingBufferPixels: number;
}

/** A built-in rendering engine: WebGL2, Canvas 2D, or WebGL2 through a context shared with other charts. */
export type RendererName = "webgl2" | "canvas2d" | "shared";

/** What `ChartOptions.renderer` can ask for: an engine by name, or `"auto"` (WebGL2, else Canvas 2D). */
export type RendererChoice = RendererName | "auto";

/** Rendering backend a chart is drawn with. */
export type ChartRendererKind = RendererName;

/** Which engine a chart ended up with, what was asked for, and what that engine can do. */
export interface ChartRendererInfo {
  /** The engine in use. */
  readonly name: RendererName;
  /** What was requested: the `renderer` option's name, or `"auto"`. A factory reports the name it stands for. */
  readonly requested: RendererChoice;
  /** Set when `"auto"` could not start this engine's preferred one: the engine that was skipped. */
  readonly fallbackFrom?: RendererName;
  readonly capabilities: ChartRendererCapabilities;
}

/** @internal How an engine came to be chosen; engines turn it into their {@link ChartRendererInfo}. */
export interface RendererOrigin {
  readonly requested?: RendererChoice;
  readonly fallbackFrom?: RendererName;
}

/** @internal Build the frozen {@link ChartRendererInfo} an engine reports. */
export function describeRenderer(name: RendererName, capabilities: ChartRendererCapabilities, origin: RendererOrigin = {}): ChartRendererInfo {
  const info: ChartRendererInfo = { name, requested: origin.requested ?? name, ...(origin.fallbackFrom ? { fallbackFrom: origin.fallbackFrom } : {}), capabilities: Object.freeze({ ...capabilities }) };
  return Object.freeze(info);
}

/** Opaque renderer instance returned by a renderer factory. Only the built-in renderers implement it. */
export interface ChartRendererHandle {
  readonly kind: ChartRendererKind;
}

/**
 * @internal Semantic drawing surface the chart talks to. Vertices are data-space `[x, y]` floats
 * (origin-shifted, with nonlinear axis scales already applied) mapped to clip space by a linear
 * `RenderProjection`; implementations own how that reaches pixels (WebGL2 draw calls, Canvas 2D paths).
 * Draw calls only have to be complete by `endFrame()`, and the data arrays may be reused by the
 * chart as soon as a draw call returns.
 */
export interface ChartRenderer extends ChartRendererHandle {
  /** Set the drawing-buffer size (device pixels) and device pixel ratio for this frame and clear it. */
  beginFrame(width: number, height: number, pixelRatio: number): void;
  /** Finish the frame: submit anything recorded since `beginFrame`, present it, and report what it cost. */
  endFrame(): FrameReport;
  /** What this engine is, why it was chosen, and what it can do. Stable for the engine's lifetime. */
  readonly info: ChartRendererInfo;
  /** Whether the engine's context is currently lost, so drawing is pointless until it is restored. */
  readonly isLost: boolean;
  /**
   * Register the single listener told when the context is lost or restored (`null` clears it). The
   * engine owns the underlying DOM events and rebuilds its own resources before reporting `"restored"`.
   */
  setLossListener(listener: ((state: RendererLossState) => void) | null): void;
  /** @internal Escape hatch for plugins that draw with their own GL: the engine's exclusive WebGL2 context, if it owns one. */
  webglContext?(): WebGL2RenderingContext | null;
  /** Polyline (`"line_strip"`) or independent segments (`"lines"`); NaN vertices break the line. */
  drawLines(data: Float32Array, vertexCount: number, color: RgbaColor, lineWidth: number, projection: RenderProjection, primitive?: "line_strip" | "lines"): void;
  /** 1px segments from clip-space vertices (grid lines). */
  drawClipLines(data: Float32Array, vertexCount: number, color: RgbaColor): void;
  /** Round markers `pointSize` CSS pixels in diameter. */
  drawPoints(data: Float32Array, pointCount: number, color: RgbaColor, pointSize: number, projection: RenderProjection): void;
  /** One bar per `[x, y]` vertex, `style.barWidth` data units wide, from `style.baseline - yOrigin`. */
  drawBarsInstanced(data: Float32Array, barCount: number, style: SeriesStyle, projection: RenderProjection, yOrigin?: number): void;
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
export type ChartRendererFactory = (context: ChartRendererFactoryContext) => ChartRendererHandle;
