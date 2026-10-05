import type { ChartRenderer, ChartRendererCapabilities, ChartRendererFactory, FrameReport, RenderProjection, RendererLossState } from "../ChartRenderer.js";
import type { DrawCommand, GpuBackend, SolidPrimitive } from "./types.js";
import type { RgbaColor, SeriesStyle } from "../../core/types.js";
import { WebGL2Backend } from "./WebGL2Backend.js";
import { releaseWebGLContext } from "./releaseWebGLContext.js";

const INITIAL_STREAM_FLOATS = 1 << 16;
const DEFAULT_MAX_DRAWING_BUFFER_PIXELS = 16_384 * 16_384;

/**
 * @internal Records a frame's draws against one CPU-side vertex stream and submits it to a
 * `GpuBackend` in `endFrame`, so buffer uploads per frame stay constant.
 */
export class WebGL2Renderer implements ChartRenderer {
  readonly kind = "webgl2" as const;
  private stream = new Float32Array(INITIAL_STREAM_FLOATS);
  private streamFloats = 0;
  private commands: DrawCommand[] = [];
  private canvasWidth = 1;
  private canvasHeight = 1;
  private pixelRatio = 1;

  private backend: GpuBackend;
  private lossListener: ((state: RendererLossState) => void) | null = null;
  private lost = false;
  private disposed = false;

  /**
   * @param canvas Canvas that owns the WebGL2 context; the renderer listens for its loss and restore events.
   * @param createBackend Builds a backend on `canvas`; called again after a context restore.
   */
  constructor(private readonly canvas: HTMLCanvasElement, private readonly createBackend: (canvas: HTMLCanvasElement) => GpuBackend = (target) => new WebGL2Backend(target)) {
    this.backend = createBackend(canvas);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
  }

  get capabilities(): ChartRendererCapabilities {
    return { gpu: true, contextLoss: true, shared: false, maxDrawingBufferPixels: this.backend.maxDrawingBufferPixels ?? DEFAULT_MAX_DRAWING_BUFFER_PIXELS };
  }

  get isLost(): boolean {
    return this.lost || this.backend.getContext?.()?.isContextLost() === true;
  }

  setLossListener(listener: ((state: RendererLossState) => void) | null): void {
    this.lossListener = listener;
  }

  /** Set the drawing-buffer size and device pixel ratio for this frame and clear it. */
  beginFrame(width: number, height: number, pixelRatio: number): void {
    this.canvasWidth = Math.max(1, width);
    this.canvasHeight = Math.max(1, height);
    this.pixelRatio = Math.max(1, pixelRatio);
    this.streamFloats = 0;
    this.commands = [];
    this.backend.viewport(0, 0, width, height);
    this.backend.clear(0, 0, 0, 0);
  }

  /** Upload everything recorded since `beginFrame` once and issue the draws in order. */
  endFrame(): FrameReport {
    const commands = this.commands;
    if (commands.length === 0) return { uploadBytes: 0, drawCalls: 0 };
    this.commands = [];
    this.backend.submit(this.stream, this.streamFloats, commands);
    return { uploadBytes: this.streamFloats * Float32Array.BYTES_PER_ELEMENT, drawCalls: commands.length };
  }

  /** @internal The WebGL2 context behind the backend, when it has one. */
  webglContext(): WebGL2RenderingContext | null {
    return this.backend.getContext?.() ?? null;
  }

  /**
   * Draw a polyline (`"line_strip"`) or independent segments (`"lines"`) from
   * data-space `[x, y]` vertices, `lineWidth` CSS pixels wide. NaN vertices
   * break the line. Lines at most one device pixel wide use native GL lines.
   */
  drawLines(
    data: Float32Array,
    vertexCount: number,
    color: RgbaColor,
    lineWidth: number,
    projection: RenderProjection,
    primitive: "line_strip" | "lines" = "line_strip",
  ): void {
    const widthPx = lineWidth * this.pixelRatio;
    if (widthPx <= 1) {
      this.drawSolid(data, vertexCount, color, projection, primitive);
      return;
    }

    const strip = primitive === "line_strip";
    const segments = strip ? vertexCount - 1 : vertexCount >> 1;
    if (segments <= 0) return;
    this.commands.push({
      kind: "thickLine",
      first: this.stage(data, vertexCount),
      segments,
      layout: strip ? "strip" : "pairs",
      lineWidth: widthPx,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      color,
      ...projection,
    });
  }

  /** Draw 1px line segments from clip-space vertices, e.g. grid lines. */
  drawClipLines(data: Float32Array, vertexCount: number, color: RgbaColor): void {
    this.drawSolid(data, vertexCount, color, { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, "lines");
  }

  /** Draw round scatter markers `pointSize` CSS pixels in diameter. */
  drawPoints(data: Float32Array, pointCount: number, color: RgbaColor, pointSize: number, projection: RenderProjection): void {
    if (pointCount <= 0) return;
    this.commands.push({
      kind: "point",
      first: this.stage(data, pointCount),
      instances: pointCount,
      pointSize: pointSize * this.pixelRatio,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
      color,
      ...projection,
    });
  }

  /** Draw one instanced bar per `[x, y]` vertex, `style.barWidth` wide, from `style.baseline - yOrigin`. */
  drawBarsInstanced(data: Float32Array, barCount: number, style: SeriesStyle, projection: RenderProjection, yOrigin: number = 0): void {
    if (barCount <= 0) return;
    this.commands.push({
      kind: "bar",
      first: this.stage(data, barCount),
      instances: barCount,
      barWidth: style.barWidth,
      baseline: style.baseline - yOrigin,
      color: style.color,
      ...projection,
    });
  }

  /** Draw data-space triangles (bars, candle bodies, buckets) or a triangle strip (area fills) in a solid color. */
  drawTriangles(data: Float32Array, vertexCount: number, color: RgbaColor, projection: RenderProjection, primitive: "triangles" | "triangle_strip" = "triangles"): void {
    this.drawSolid(data, vertexCount, color, projection, primitive);
  }

  /** Release all GPU resources and the WebGL context itself, so a disposed chart does not hold one until GC. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.lossListener = null;
    this.commands = [];
    const gl = this.backend.getContext?.();
    try {
      this.backend.destroy();
    } finally {
      // Browsers cap live contexts (~16) and evict the oldest, so release now instead of waiting for GC.
      releaseWebGLContext(gl);
    }
  }

  private readonly handleContextLost = (event: Event): void => {
    // Allow the browser to restore the context; the chart stops drawing until it does.
    event.preventDefault();
    this.lost = true;
    this.commands = [];
    this.lossListener?.("lost");
  };

  private readonly handleContextRestored = (): void => {
    // A restored context is a new generation: every object from the old one is invalid, so rebuild the backend.
    const previous = this.backend;
    let next: GpuBackend;
    try {
      next = this.createBackend(this.canvas);
    } catch (error) {
      console.error("BlazePlot failed to restore WebGL resources after context restoration.", error);
      return;
    }
    this.backend = next;
    try {
      previous.destroy();
    } catch {
      // The previous backend belonged to the lost context generation; nothing is left to free.
    }
    this.lost = false;
    this.lossListener?.("restored");
  };

  private drawSolid(data: Float32Array, vertexCount: number, color: RgbaColor, projection: RenderProjection, primitive: SolidPrimitive): void {
    if (vertexCount <= 0) return;
    this.commands.push({ kind: "solid", primitive, first: this.stage(data, vertexCount), count: vertexCount, color, ...projection });
  }

  /** Append the first `vertexCount` `[x, y]` vertices of `data` to the frame stream; returns their first vertex index. */
  private stage(data: Float32Array, vertexCount: number): number {
    const floats = vertexCount * 2;
    const start = this.streamFloats;
    const end = start + floats;
    if (end > this.stream.length) {
      let capacity = this.stream.length;
      while (capacity < end) capacity *= 2;
      const grown = new Float32Array(capacity);
      grown.set(this.stream.subarray(0, start));
      this.stream = grown;
    }
    this.stream.set(floats === data.length ? data : data.subarray(0, floats), start);
    this.streamFloats = end;
    return start >> 1;
  }
}

/** The default renderer factory: WebGL2, throwing `WebGL2UnavailableError` when it is unavailable. */
export function webgl2Renderer(): ChartRendererFactory {
  return ({ canvas }) => new WebGL2Renderer(canvas);
}
