import { ShaderPrograms } from "./ShaderPrograms.js";
import type { Camera2D } from "../interaction/Camera2D.js";
import type { GpuBackend, GpuBuffer, GpuProgram } from "./types.js";
import type { SeriesStyle } from "../core/types.js";

export class Renderer {
  private readonly lineProgram: GpuProgram;
  private readonly scaleUniform: Float32Array = new Float32Array(2);
  private readonly offsetUniform: Float32Array = new Float32Array(2);

  constructor(private backend: GpuBackend) {
    this.lineProgram = this.backend.createProgram(ShaderPrograms.line.vert, ShaderPrograms.line.frag);
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

  private drawLinePrimitive(primitive: "lines" | "line_strip", positions: GpuBuffer, count: number, style: SeriesStyle, camera: Camera2D): void {
    this.scaleUniform[0] = camera.xScale;
    this.scaleUniform[1] = camera.yScale;
    this.offsetUniform[0] = camera.xOffset;
    this.offsetUniform[1] = camera.yOffset;

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

  drawMinMaxSegments(positions: GpuBuffer, count: number, style: SeriesStyle, camera: Camera2D): void {
    this.drawLines(positions, count, style, camera);
  }

  dispose(): void {
    this.backend.destroy();
  }
}
