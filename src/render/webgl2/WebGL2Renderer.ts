import { describeRenderer } from "../ChartRenderer.js";
import type { ChartRenderer, ChartRendererInfo, FrameReport, RenderProjection, RendererLossState, RendererOrigin } from "../ChartRenderer.js";
import type { DrawCommand, GpuBackend, SolidPrimitive } from "./types.js";
import type { RgbaColor, SeriesMode, SeriesStyle } from "../../core/types.js";
import { WebGL2Backend } from "./WebGL2Backend.js";
import type { ProgramName } from "./ShaderPrograms.js";
import { destroyBackend } from "./releaseWebGLContext.js";
import { adoptWarmBackend, parkPlotCanvas } from "./WarmCanvasPool.js";

/** The frame stream starts small and doubles on demand, so a sparse chart does not hold the 256 KiB a dense one needs. */
const INITIAL_STREAM_FLOATS = 1 << 10;
const DEFAULT_MAX_DRAWING_BUFFER_PIXELS = 16_384 * 16_384;

/**
 * The programs a series of `mode` draws with. Every chart draws solid lines (grid, hairlines, fills, bar
 * triangles); the rest depends on the mode, and on whether lines are wide enough (more than one device
 * pixel) to take the instanced quad path.
 */
function programsForSeries(mode: SeriesMode, lineWidthPx: number): ProgramName[] {
  const programs: ProgramName[] = ["line"];
  if (lineWidthPx > 1) programs.push("thickLine");
  if (mode === "scatter") programs.push("point");
  if (mode === "bar") programs.push("bar");
  return programs;
}

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
  /** Programs hinted so far, started again on a new backend after a context restore. */
  private readonly prepared = new Set<ProgramName>();

  readonly info: ChartRendererInfo;
  private readonly createBackend: (canvas: HTMLCanvasElement) => GpuBackend;
  /** Whether disposal may hand the canvas and backend to the warm pool: only for a chart's own backend, never an injected one. */
  private readonly poolable: boolean;

  /**
   * @param canvas Canvas that owns the WebGL2 context; the renderer listens for its loss and restore events.
   * @param options `createBackend` builds a backend on `canvas` and is called again after a context restore;
   * `origin` records how this engine was chosen for `info`. Without `createBackend` the renderer builds the native
   * WebGL2 backend, adopting the warm one when `canvas` came from the warm pool.
   */
  constructor(private readonly canvas: HTMLCanvasElement, options: { readonly createBackend?: (canvas: HTMLCanvasElement) => GpuBackend; readonly origin?: RendererOrigin } = {}) {
    this.poolable = !options.createBackend;
    this.createBackend = options.createBackend ?? ((target) => new WebGL2Backend(target));
    this.backend = (this.poolable ? adoptWarmBackend(canvas) : undefined) ?? this.createBackend(canvas);
    this.info = describeRenderer("webgl2", { gpu: true, contextLoss: true, shared: false, maxDrawingBufferPixels: this.backend.maxDrawingBufferPixels ?? DEFAULT_MAX_DRAWING_BUFFER_PIXELS }, options.origin);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
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

  /** Start building the programs a series of `mode` will need (see `ChartRenderer.prepare`). */
  prepare(mode: SeriesMode, lineWidth: number): void {
    const pixelRatio = this.canvas.ownerDocument?.defaultView?.devicePixelRatio ?? 1;
    const programs = programsForSeries(mode, lineWidth * Math.max(1, pixelRatio));
    for (const name of programs) this.prepared.add(name);
    this.backend.prepare?.(programs);
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

  /** Fill `count` device-pixel rectangles with per-rectangle colors: eight floats each, see `ChartRenderSurface.fillRects`. */
  fillRects(rects: Float32Array, count: number): void {
    if (count <= 0) return;
    this.commands.push({ kind: "rects", first: this.stage(rects, count * 4), instances: count, canvasWidth: this.canvasWidth, canvasHeight: this.canvasHeight });
  }

  /** A second WebGL2 surface on `canvas`, with its own context. */
  createSurface(canvas: HTMLCanvasElement): ChartRenderer {
    return new WebGL2Renderer(canvas, { createBackend: this.createBackend });
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
    // A healthy chart canvas stays warm for the next chart instead of paying for a context release now and a new context later.
    if (this.poolable && !this.lost && parkPlotCanvas(this.canvas, this.backend)) return;
    destroyBackend(this.backend);
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
    next.prepare?.([...this.prepared]);
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
