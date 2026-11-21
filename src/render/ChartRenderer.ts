import type { RgbaColor, SeriesMode, SeriesStyle } from "../core/types.js";

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
 * A frame is `beginFrame`, any number of `fillRects`, `fillShapes`, `strokeSegments`, `fillTriangles`, and `fillField`, then `endFrame`. Everything is in device pixels
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
  /**
   * Fill `count` rounded rectangles with an optional inner border, antialiased. `shapes` holds
   * 14 floats per shape: `x`, `y`, `width`, `height` in device pixels, the corner
   * `radius` and `borderWidth` in device pixels, then the straight fill `r`, `g`, `b`, `a` and the
   * straight border `r`, `g`, `b`, `a` from 0 to 1. A radius of at least half the shorter side draws
   * a pill, and a square with it a circle. The border is drawn inside the shape's bounds, over the fill. Shapes with a
   * non-finite coordinate or a size that is not positive are skipped.
   */
  fillShapes(shapes: Float32Array, count: number): void;
  /**
   * Stroke `count` independent line segments with butt caps, antialiased. `segments` holds
   * 12 floats per segment: `x0`, `y0`, `x1`, `y1` and `width` in device pixels,
   * then `dash`, `gap`, and `dashOffset` in device pixels along the segment (`dash` of 0 or less is solid),
   * then the straight `r`, `g`, `b`, `a`. Segments with a non-finite coordinate are skipped.
   */
  strokeSegments(segments: Float32Array, count: number): void;
  /**
   * Fill `vertexCount / 3` triangles with per-vertex colors. `vertices` holds six
   * (6) floats per vertex: `x`, `y` in device pixels, then the straight `r`, `g`, `b`, `a`. Triangles
   * with a non-finite vertex are skipped. Edges are not antialiased on every engine. Engines without
   * `capabilities.gpu` (Canvas 2D) cannot interpolate: they fill each triangle in its first vertex's color.
   */
  fillTriangles(vertices: Float32Array, vertexCount: number): void;
  /**
   * Shade a grid of opacities in one color: `alpha` holds `cols * rows` straight opacities from 0 to 1, row by
   * row, for the grid's vertices at `x + col * step`, `y + row * step` (device pixels), and the color between
   * them is interpolated bilinearly; `r`, `g`, `b` are straight, from 0 to 1. The half step around the outer
   * vertices takes their opacity. A density drawn this way costs one pass over the area, however it was summed.
   */
  fillField(alpha: Float32Array, cols: number, rows: number, x: number, y: number, step: number, r: number, g: number, b: number): void;
  /** Finish the frame and present it. */
  endFrame(): void;
  /** Whether the surface's context is lost; draw calls are skipped until it is restored. */
  readonly isLost: boolean;
  /** Register the one listener told when the surface's context is lost or restored (`null` clears it). */
  setLossListener(listener: ((state: RendererLossState) => void) | null): void;
  /** Release the surface. Safe to call more than once. */
  dispose(): void;
}

/** Floats per shape passed to `fillShapes`. @internal */
export const SHAPE_FLOATS = 14;
/** Floats per segment passed to `strokeSegments`. @internal */
export const SEGMENT_FLOATS = 12;
/** Floats per vertex passed to `fillTriangles`. @internal */
export const TRIANGLE_VERTEX_FLOATS = 6;

/** A built-in rendering engine: WebGL2, Canvas 2D, or WebGL2 through a context shared with other charts. */
export type RendererName = "webgl2" | "canvas2d" | "shared";

/** What `ChartOptions.renderer` can ask for: an engine by name, or `"auto"` (WebGL2, else Canvas 2D). */
export type RendererChoice = RendererName | "auto";


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
  readonly kind: RendererName;
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
  /** Rounded rectangles, pills, and circles with borders; see {@link ChartRenderSurface.fillShapes}. */
  fillShapes(shapes: Float32Array, count: number): void;
  /** Per-segment width, dash, and color; see {@link ChartRenderSurface.strokeSegments}. */
  strokeSegments(segments: Float32Array, count: number): void;
  /** Per-vertex colored triangles; see {@link ChartRenderSurface.fillTriangles}. */
  fillTriangles(vertices: Float32Array, vertexCount: number): void;
  /**
   * A grid of opacities shaded in one color; see {@link ChartRenderSurface.fillField}. Optional: without it the
   * grid is drawn as per-vertex colored triangles.
   */
  fillField?(alpha: Float32Array, cols: number, rows: number, x: number, y: number, step: number, r: number, g: number, b: number): void;
  /**
   * Hint that a series of `mode` with `lineWidth` CSS pixel lines is about to be drawn, so a GPU engine
   * can start building the programs it will need before the first frame. Optional and purely advisory.
   */
  prepare?(mode: SeriesMode, lineWidth: number): void;
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
    fillShapes: (shapes, count) => engine.fillShapes(shapes, count),
    strokeSegments: (segments, count) => engine.strokeSegments(segments, count),
    fillTriangles: (vertices, vertexCount) => engine.fillTriangles(vertices, vertexCount),
    fillField: (alpha, cols, rows, x, y, step, r, g, b) => {
      if (engine.fillField) engine.fillField(alpha, cols, rows, x, y, step, r, g, b);
      else {
        const vertices = fieldTriangles(alpha, cols, rows, x, y, step, r, g, b);
        engine.fillTriangles(vertices, vertices.length / TRIANGLE_VERTEX_FLOATS);
      }
    },
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

/** A grid of opacities as per-vertex colored triangles, two per cell, cells all transparent left out. Shared scratch. */
function fieldTriangles(alpha: Float32Array, cols: number, rows: number, x: number, y: number, step: number, r: number, g: number, b: number): Float32Array {
  const cells = Math.max(0, cols - 1) * Math.max(0, rows - 1);
  const need = cells * 6 * TRIANGLE_VERTEX_FLOATS;
  if (fieldScratch.length < need) fieldScratch = new Float32Array(need);
  const out = fieldScratch;
  let o = 0;
  const vertex = (vx: number, vy: number, a: number): void => {
    out[o] = vx;
    out[o + 1] = vy;
    out[o + 2] = r;
    out[o + 3] = g;
    out[o + 4] = b;
    out[o + 5] = a;
    o += TRIANGLE_VERTEX_FLOATS;
  };
  for (let row = 0; row + 1 < rows; row++) {
    for (let col = 0; col + 1 < cols; col++) {
      const k = row * cols + col;
      const a0 = alpha[k]!;
      const a1 = alpha[k + 1]!;
      const a2 = alpha[k + cols]!;
      const a3 = alpha[k + cols + 1]!;
      if (!(a0 > 0 || a1 > 0 || a2 > 0 || a3 > 0)) continue;
      const x0 = x + col * step;
      const y0 = y + row * step;
      vertex(x0, y0, a0);
      vertex(x0 + step, y0, a1);
      vertex(x0, y0 + step, a2);
      vertex(x0 + step, y0, a1);
      vertex(x0 + step, y0 + step, a3);
      vertex(x0, y0 + step, a2);
    }
  }
  return out.subarray(0, o);
}
let fieldScratch = new Float32Array(0);
