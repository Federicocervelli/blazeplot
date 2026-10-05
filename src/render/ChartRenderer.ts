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

/**
 * Context state transitions an engine reports to the chart that owns it.
 *
 * @experimental Reported to plugins through {@link ChartRenderSurface.setLossListener}.
 */
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

/**
 * A drawing surface a plugin owns, drawn with the chart's rendering engine: WebGL2, Canvas 2D, or
 * the shared WebGL2 context. Get one from `ctx.unstable.createRenderSurface(canvas)`.
 *
 * A frame is `beginFrame`, any number of `fillRects`, then `endFrame`. Everything is in device pixels
 * with the origin at the canvas's top-left corner, so size the canvas in device pixels first.
 *
 * @experimental May change in a minor release. See docs/stability.md.
 */
export interface ChartRenderSurface {
  /** Start a frame on a drawing buffer of `width` x `height` device pixels (`pixelRatio` device pixels per CSS pixel) and clear it. */
  beginFrame(width: number, height: number, pixelRatio: number): void;
  /**
   * Fill `count` rectangles. `rects` holds eight floats per rectangle: `x`, `y`, `width`, `height` in
   * device pixels, then straight (not premultiplied) `r`, `g`, `b`, `a` from 0 to 1. Rectangles with a
   * non-finite coordinate are skipped. Edges are not snapped to whole pixels.
   */
  fillRects(rects: Float32Array, count: number): void;
  /** Finish the frame and present it. */
  endFrame(): void;
  /** Whether the surface's context is lost; draw calls are skipped until it is restored. */
  readonly isLost: boolean;
  /** Register the one listener told when the surface's context is lost or restored (`null` clears it). */
  setLossListener(listener: ((state: RendererLossState) => void) | null): void;
  /** Release the surface. Safe to call more than once. */
  dispose(): void;
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
  /** Filled rectangles with per-rectangle colors; see {@link ChartRenderSurface.fillRects}. */
  fillRects(rects: Float32Array, count: number): void;
  /** A second drawing surface on `canvas` that uses this same engine, for layers a plugin owns. Dispose it separately. */
  createSurface(canvas: HTMLCanvasElement): ChartRenderer;
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
 * The built-in factories are `webgl2Renderer()`, `canvas2dRenderer()`, `sharedRenderer()`, and `autoRenderer()`.
 */
export type ChartRendererFactory = (context: ChartRendererFactoryContext) => ChartRendererHandle;

/** @internal Narrow an engine instance to the surface contract plugins see. */
export function toRenderSurface(engine: ChartRenderer): ChartRenderSurface {
  let disposed = false;
  return {
    beginFrame: (width, height, pixelRatio) => engine.beginFrame(width, height, pixelRatio),
    fillRects: (rects, count) => engine.fillRects(rects, count),
    endFrame: () => void engine.endFrame(),
    get isLost() {
      return engine.isLost;
    },
    setLossListener: (listener) => engine.setLossListener(listener),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      engine.dispose();
    },
  };
}
