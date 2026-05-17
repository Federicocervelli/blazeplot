import { ShaderPrograms } from "./ShaderPrograms.js";
import type { Camera2D } from "../interaction/Camera2D.js";
import type { AttributeSpec, GpuBackend, GpuBuffer, GpuProgram } from "./types.js";
import type { SeriesStyle } from "../core/types.js";

const FLOATS_PER_SEGMENT_INSTANCE = 3;
const FLOATS_PER_POINT_INSTANCE = 2;
const BYTES_PER_FLOAT = 4;
const DEFAULT_POINT_SIZE_PX = 4;
const DEFAULT_BAR_WIDTH_DATA = 0.8;
const DEFAULT_BASELINE = 0;

export class Renderer {
  private readonly lineProgram: GpuProgram;
  private readonly segmentProgram: GpuProgram;
  private readonly pointProgram: GpuProgram;
  private readonly barProgram: GpuProgram;
  private readonly segmentSelectBuffer: GpuBuffer;
  private readonly pointCornerBuffer: GpuBuffer;
  private readonly barCornerBuffer: GpuBuffer;
  private readonly scaleUniform: Float32Array = new Float32Array(2);
  private readonly offsetUniform: Float32Array = new Float32Array(2);
  private readonly canvasSizeUniform: Float32Array = new Float32Array(2);

  constructor(private backend: GpuBackend) {
    this.lineProgram = this.backend.createProgram(ShaderPrograms.line.vert, ShaderPrograms.line.frag);
    this.segmentProgram = this.backend.createProgram(ShaderPrograms.segment.vert, ShaderPrograms.segment.frag);
    this.pointProgram = this.backend.createProgram(ShaderPrograms.point.vert, ShaderPrograms.point.frag);
    this.barProgram = this.backend.createProgram(ShaderPrograms.bar.vert, ShaderPrograms.bar.frag);

    this.segmentSelectBuffer = this.backend.createBuffer({ usage: "static", type: "float", length: 2 });
    this.backend.updateBuffer(this.segmentSelectBuffer, new Float32Array([0, 1]));

    this.pointCornerBuffer = this.backend.createBuffer({ usage: "static", type: "float", length: 8 });
    this.backend.updateBuffer(this.pointCornerBuffer, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

    this.barCornerBuffer = this.backend.createBuffer({ usage: "static", type: "float", length: 8 });
    this.backend.updateBuffer(this.barCornerBuffer, new Float32Array([-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1]));
  }

  get supportsInstancedSegments(): boolean {
    return this.backend.capabilities.instancing;
  }

  get supportsInstancedPoints(): boolean {
    return this.backend.capabilities.instancing;
  }

  get supportsInstancedBars(): boolean {
    return this.backend.capabilities.instancing;
  }

  clear(r: number, g: number, b: number, a: number): void {
    this.backend.clear(r, g, b, a);
  }

  createFloatBuffer(floatCount: number): GpuBuffer {
    return this.backend.createBuffer({ usage: "stream", type: "float", length: floatCount });
  }

  updateFloatBuffer(buffer: GpuBuffer, data: Float32Array): void {
    this.backend.updateBuffer(buffer, data);
  }

  viewport(x: number, y: number, width: number, height: number): void {
    this.backend.viewport(x, y, width, height);
  }

  drawLines(positions: GpuBuffer, count: number, style: SeriesStyle, camera: Camera2D): void {
    this.drawLinePrimitive("lines", positions, count, style, camera);
  }

  drawLineStrip(positions: GpuBuffer, count: number, style: SeriesStyle, camera: Camera2D): void {
    this.drawLinePrimitive("line_strip", positions, count, style, camera);
  }

  drawMinMaxSegments(positions: GpuBuffer, count: number, style: SeriesStyle, camera: Camera2D): void {
    this.drawLines(positions, count, style, camera);
  }

  drawMinMaxSegmentsInstanced(instanceBuffer: GpuBuffer, instanceCount: number, style: SeriesStyle, camera: Camera2D): void {
    this.writeCameraUniforms(camera);

    const stride = FLOATS_PER_SEGMENT_INSTANCE * BYTES_PER_FLOAT;
    const aX: AttributeSpec = { buffer: instanceBuffer, divisor: 1, stride, offset: 0 };
    const aMinY: AttributeSpec = { buffer: instanceBuffer, divisor: 1, stride, offset: BYTES_PER_FLOAT };
    const aMaxY: AttributeSpec = { buffer: instanceBuffer, divisor: 1, stride, offset: BYTES_PER_FLOAT * 2 };
    const aSelect: AttributeSpec = { buffer: this.segmentSelectBuffer, divisor: 0, stride: BYTES_PER_FLOAT, offset: 0 };

    this.backend.draw({
      program: this.segmentProgram,
      primitive: "lines",
      count: 2,
      instances: instanceCount,
      attributes: { aMaxY, aMinY, aSelect, aX },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uColor: style.color,
      },
    });
  }

  drawPointsInstanced(
    instanceBuffer: GpuBuffer,
    pointCount: number,
    style: SeriesStyle,
    camera: Camera2D,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    this.writeCameraUniforms(camera);
    this.canvasSizeUniform[0] = Math.max(1, canvasWidth);
    this.canvasSizeUniform[1] = Math.max(1, canvasHeight);

    const instanceStride = FLOATS_PER_POINT_INSTANCE * BYTES_PER_FLOAT;
    const aPosition: AttributeSpec = { buffer: instanceBuffer, divisor: 1, stride: instanceStride, offset: 0, size: 2 };
    const aCorner: AttributeSpec = { buffer: this.pointCornerBuffer, divisor: 0, stride: FLOATS_PER_POINT_INSTANCE * BYTES_PER_FLOAT, offset: 0, size: 2 };

    this.backend.draw({
      program: this.pointProgram,
      primitive: "triangle_strip",
      count: 4,
      instances: pointCount,
      attributes: { aCorner, aPosition },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uCanvasSize: this.canvasSizeUniform,
        uPointSize: style.pointSize ?? DEFAULT_POINT_SIZE_PX,
        uColor: style.color,
      },
    });
  }

  drawAreaStrip(positions: GpuBuffer, count: number, style: SeriesStyle, camera: Camera2D): void {
    this.writeCameraUniforms(camera);

    this.backend.draw({
      program: this.lineProgram,
      primitive: "triangle_strip",
      count,
      attributes: { position: positions },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uColor: style.fillColor ?? style.color,
      },
    });
  }

  drawBarsInstanced(
    instanceBuffer: GpuBuffer,
    barCount: number,
    style: SeriesStyle,
    camera: Camera2D,
  ): void {
    this.writeCameraUniforms(camera);

    const instanceStride = FLOATS_PER_POINT_INSTANCE * BYTES_PER_FLOAT;
    const aPosition: AttributeSpec = { buffer: instanceBuffer, divisor: 1, stride: instanceStride, offset: 0, size: 2 };
    const aCorner: AttributeSpec = { buffer: this.barCornerBuffer, divisor: 0, stride: FLOATS_PER_POINT_INSTANCE * BYTES_PER_FLOAT, offset: 0, size: 2 };

    this.backend.draw({
      program: this.barProgram,
      primitive: "triangle_strip",
      count: 4,
      instances: barCount,
      attributes: { aCorner, aPosition },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uBarWidth: style.barWidth ?? DEFAULT_BAR_WIDTH_DATA,
        uBaseline: style.baseline ?? DEFAULT_BASELINE,
        uColor: style.color,
      },
    });
  }

  private drawLinePrimitive(primitive: "lines" | "line_strip", positions: GpuBuffer, count: number, style: SeriesStyle, camera: Camera2D): void {
    this.writeCameraUniforms(camera);

    this.backend.draw({
      program: this.lineProgram,
      primitive,
      count,
      attributes: { position: positions },
      uniforms: {
        uScale: this.scaleUniform,
        uOffset: this.offsetUniform,
        uColor: style.color,
      },
    });
  }

  private writeCameraUniforms(camera: Camera2D): void {
    this.scaleUniform[0] = camera.xScale;
    this.scaleUniform[1] = camera.yScale;
    this.offsetUniform[0] = camera.xOffset;
    this.offsetUniform[1] = camera.yOffset;
  }

  dispose(): void {
    this.backend.destroy();
  }
}
