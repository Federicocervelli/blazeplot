import { ShaderPrograms } from "./ShaderPrograms.js";
import type { AttributeSpec, GpuBackend, GpuBuffer, GpuProgram } from "./types.js";
import type { RgbaColor, SeriesStyle } from "../core/types.js";

const BYTES_PER_FLOAT = 4;
const BYTES_PER_POINT = 2 * BYTES_PER_FLOAT;

/** Linear projection uniforms used by renderer draw calls. */
export interface RenderProjection {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

type ProgramName = keyof typeof ShaderPrograms;

/** @internal Draws built-in series primitives through a `GpuBackend`. */
export class Renderer {
  private readonly programs = new Map<ProgramName, GpuProgram>();
  private readonly cornerBuffers = new Map<string, AttributeSpec>();
  private readonly scaleUniform = new Float32Array(2);
  private readonly offsetUniform = new Float32Array(2);
  private readonly canvasSizeUniform = new Float32Array([1, 1]);
  private pixelRatio = 1;

  constructor(private readonly backend: GpuBackend) {}

  /** Whether the backend can draw instanced quads (bars, thick lines, points). */
  get supportsInstancing(): boolean {
    return this.backend.capabilities.instancing;
  }

  /** Set the drawing-buffer size and device pixel ratio for this frame and clear it. */
  beginFrame(width: number, height: number, pixelRatio: number): void {
    this.canvasSizeUniform[0] = Math.max(1, width);
    this.canvasSizeUniform[1] = Math.max(1, height);
    this.pixelRatio = Math.max(1, pixelRatio);
    this.backend.viewport(0, 0, width, height);
    this.backend.clear(0, 0, 0, 0);
  }

  /** Allocate a streaming float buffer. */
  createFloatBuffer(floatCount: number): GpuBuffer {
    return this.backend.createBuffer({ usage: "stream", type: "float", length: floatCount });
  }

  /** Upload the first `floatCount` floats of `data` into an existing buffer. */
  updateFloatBuffer(buffer: GpuBuffer, data: Float32Array, floatCount: number = data.length): void {
    const count = Math.max(0, Math.min(floatCount, data.length));
    this.backend.updateBuffer(buffer, count === data.length ? data : data.subarray(0, count));
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
    positions: GpuBuffer,
    vertexCount: number,
    color: RgbaColor,
    lineWidth: number,
    projection: RenderProjection,
    primitive: "line_strip" | "lines" = "line_strip",
  ): void {
    this.writeProjection(projection);
    const widthPx = lineWidth * this.pixelRatio;
    if (!this.supportsInstancing || widthPx <= 1) {
      this.drawSolid(primitive, positions, vertexCount, color);
      return;
    }

    const strip = primitive === "line_strip";
    const segments = strip ? vertexCount - 1 : vertexCount >> 1;
    if (segments <= 0) return;
    const stride = strip ? BYTES_PER_POINT : BYTES_PER_POINT * 2;
    this.backend.draw({
      program: this.program("thickLine"),
      primitive: "triangle_strip",
      count: 4,
      instances: segments,
      attributes: {
        aStart: { buffer: positions, divisor: 1, stride, offset: 0, size: 2 },
        aEnd: { buffer: positions, divisor: 1, stride, offset: BYTES_PER_POINT, size: 2 },
        aCorner: this.corners("segment", [0, -1, 0, 1, 1, -1, 1, 1]),
      },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uCanvasSize: this.canvasSizeUniform,
        uLineWidth: widthPx,
        uColor: color,
      },
    });
  }

  /** Draw 1px line segments from clip-space vertices, e.g. grid lines. */
  drawClipLines(positions: GpuBuffer, vertexCount: number, color: RgbaColor): void {
    this.scaleUniform.fill(1);
    this.offsetUniform.fill(0);
    this.drawSolid("lines", positions, vertexCount, color);
  }

  /** Draw scatter points `pointSize` device pixels across. */
  drawPoints(positions: GpuBuffer, pointCount: number, color: RgbaColor, pointSize: number, projection: RenderProjection): void {
    this.writeProjection(projection);
    if (!this.supportsInstancing) {
      this.backend.draw({
        program: this.program("pointSprite"),
        primitive: "points",
        count: pointCount,
        attributes: { aPosition: positions },
        uniforms: { uScale: this.scaleUniform, uOffset: this.offsetUniform, uPointSize: pointSize, uColor: color },
      });
      return;
    }

    this.backend.draw({
      program: this.program("point"),
      primitive: "triangle_strip",
      count: 4,
      instances: pointCount,
      attributes: {
        aPosition: { buffer: positions, divisor: 1, stride: BYTES_PER_POINT, offset: 0, size: 2 },
        aCorner: this.corners("point", [-1, -1, 1, -1, -1, 1, 1, 1]),
      },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uCanvasSize: this.canvasSizeUniform,
        uPointSize: pointSize,
        uColor: color,
      },
    });
  }

  /** Draw one instanced bar per `[x, y]` vertex, `style.barWidth` wide, from `style.baseline`. */
  drawBarsInstanced(positions: GpuBuffer, barCount: number, style: SeriesStyle, projection: RenderProjection): void {
    this.writeProjection(projection);
    this.backend.draw({
      program: this.program("bar"),
      primitive: "triangle_strip",
      count: 4,
      instances: barCount,
      attributes: {
        aPosition: { buffer: positions, divisor: 1, stride: BYTES_PER_POINT, offset: 0, size: 2 },
        aCorner: this.corners("bar", [-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1]),
      },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uBarWidth: style.barWidth,
        uBaseline: style.baseline,
        uColor: style.color,
      },
    });
  }

  /** Draw data-space triangles (bars, candle bodies, buckets) or a triangle strip (area fills) in a solid color. */
  drawTriangles(positions: GpuBuffer, vertexCount: number, color: RgbaColor, projection: RenderProjection, primitive: "triangles" | "triangle_strip" = "triangles"): void {
    this.writeProjection(projection);
    this.drawSolid(primitive, positions, vertexCount, color);
  }

  /** Release all GPU resources owned by the backend. */
  dispose(): void {
    this.backend.destroy();
  }

  private drawSolid(
    primitive: "lines" | "line_strip" | "triangles" | "triangle_strip",
    positions: GpuBuffer,
    count: number,
    color: RgbaColor,
  ): void {
    this.backend.draw({
      program: this.program("line"),
      primitive,
      count,
      attributes: { position: positions },
      uniforms: { uScale: this.scaleUniform, uOffset: this.offsetUniform, uColor: color },
    });
  }

  private writeProjection(projection: RenderProjection): void {
    this.scaleUniform[0] = projection.scaleX;
    this.scaleUniform[1] = projection.scaleY;
    this.offsetUniform[0] = projection.offsetX;
    this.offsetUniform[1] = projection.offsetY;
  }

  private program(name: ProgramName): GpuProgram {
    let program = this.programs.get(name);
    if (!program) {
      program = this.backend.createProgram(ShaderPrograms[name].vert, ShaderPrograms[name].frag);
      this.programs.set(name, program);
    }
    return program;
  }

  /** Static per-vertex corner offsets for an instanced quad, created on first use. */
  private corners(name: string, values: readonly number[]): AttributeSpec {
    let spec = this.cornerBuffers.get(name);
    if (!spec) {
      const buffer = this.backend.createBuffer({ usage: "static", type: "float", length: values.length });
      this.backend.updateBuffer(buffer, new Float32Array(values));
      spec = { buffer, divisor: 0, stride: BYTES_PER_POINT, offset: 0, size: 2 };
      this.cornerBuffers.set(name, spec);
    }
    return spec;
  }
}
