import type { ChartRenderer } from "./ChartRenderer.js";
import type { DrawCommand, GpuBackend, SolidPrimitive } from "./types.js";
import type { RgbaColor, SeriesStyle } from "../core/types.js";

const INITIAL_STREAM_FLOATS = 1 << 16;

/** Linear projection uniforms used by renderer draw calls. */
export interface RenderProjection {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * @internal Records a frame's draws against one CPU-side vertex stream and submits it to a
 * `GpuBackend` in `endFrame`, so buffer uploads per frame stay constant.
 */
export class Renderer implements ChartRenderer {
  readonly kind = "webgl2" as const;
  private stream = new Float32Array(INITIAL_STREAM_FLOATS);
  private streamFloats = 0;
  private commands: DrawCommand[] = [];
  private canvasWidth = 1;
  private canvasHeight = 1;
  private pixelRatio = 1;

  constructor(private readonly backend: GpuBackend) {}

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
  endFrame(): void {
    const commands = this.commands;
    if (commands.length === 0) return;
    this.commands = [];
    this.backend.submit(this.stream, this.streamFloats, commands);
  }

  /** Return the underlying WebGL2 context when available. */
  getWebGLContext(): WebGL2RenderingContext | null {
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

  /** Release all GPU resources owned by the backend. */
  dispose(): void {
    this.commands = [];
    this.backend.destroy();
  }

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
