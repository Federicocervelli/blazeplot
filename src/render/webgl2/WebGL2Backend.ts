import type { BarDraw, DrawCommand, GpuBackend, PointDraw, RectsDraw, SolidDraw, SolidPrimitive, ThickLineDraw } from "./types.js";
import { ShaderPrograms } from "./ShaderPrograms.js";
import { WebGL2UnavailableError } from "./availability.js";

const BYTES_PER_VERTEX = 2 * Float32Array.BYTES_PER_ELEMENT;

/** Unit-quad corner offsets shared by every instanced program, as triangle-strip vertices. */
const SEGMENT_CORNERS = [0, -1, 0, 1, 1, -1, 1, 1];
const POINT_CORNERS = [-1, -1, 1, -1, -1, 1, 1, 1];
const BAR_CORNERS = [-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1];
const RECT_CORNERS = [0, 0, 1, 0, 0, 1, 1, 1];
const BYTES_PER_RECT = 8 * Float32Array.BYTES_PER_ELEMENT;

/** A linked program with its fixed vertex array object and uniform locations. */
interface ProgramState {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly corners: WebGLBuffer | null;
  readonly uScale: WebGLUniformLocation | null;
  readonly uOffset: WebGLUniformLocation | null;
  readonly uColor: WebGLUniformLocation | null;
  readonly uCanvasSize: WebGLUniformLocation | null;
  readonly uLineWidth: WebGLUniformLocation | null;
  readonly uPointSize: WebGLUniformLocation | null;
  readonly uBarWidth: WebGLUniformLocation | null;
  readonly uBaseline: WebGLUniformLocation | null;
  /** Attribute locations of the per-instance streams (`aStart`/`aEnd` or `aPosition`). */
  readonly aStart: number;
  readonly aEnd: number;
}

/**
 * Native WebGL2 implementation of BlazePlot's GPU backend.
 *
 * Every frame's geometry lives in one stream buffer that is re-specified (orphaned) and uploaded
 * with a single `bufferData` call in `submit`; draws read from it at vertex offsets. Each built-in
 * program has one vertex array object, created on first use.
 */
export class WebGL2Backend implements GpuBackend {
  private readonly gl: WebGL2RenderingContext;
  private readonly stream: WebGLBuffer;
  /** Pixels in the largest viewport the context reports (a conservative default when it cannot say). */
  readonly maxDrawingBufferPixels: number;
  private programs: Partial<Record<keyof typeof ShaderPrograms, ProgramState>> = {};
  private scissorBox: { x: number; y: number; w: number; h: number } | null = null;
  /**
   * True once the context this backend's objects belong to has been lost. A restored context is a
   * new generation: every object created before the loss is invalid and deleting it logs
   * INVALID_OPERATION, so teardown must drop those references without calling `gl.delete*`.
   */
  private contextLost: boolean = false;
  private readonly handleContextLost = (): void => {
    this.contextLost = true;
  };

  /** Create a WebGL2 backend for a canvas. */
  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Fragment shaders emit premultiplied color and blending uses ONE / ONE_MINUS_SRC_ALPHA, so
      // translucent colors blend with what is already drawn and the page composites the result correctly.
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      throw new WebGL2UnavailableError();
    }

    this.gl = gl;
    this.maxDrawingBufferPixels = maxViewportPixels(gl);
    const stream = gl.createBuffer();
    if (!stream) throw new Error("Failed to allocate WebGL buffer.");
    this.stream = stream;
    canvas.addEventListener("webglcontextlost", this.handleContextLost);

    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.STENCIL_TEST);
    this.applyBlendState();
  }

  /** Clear the active framebuffer. */
  clear(r: number, g: number, b: number, a: number): void {
    this.updateFullViewport();
    // Re-applied every frame so the state also survives context loss and restore, which resets it.
    this.applyBlendState();
    this.gl.disable(this.gl.SCISSOR_TEST);
    this.gl.clearColor(r, g, b, a);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  /** Set the WebGL viewport in pixels. */
  viewport(x: number, y: number, w: number, h: number): void {
    this.updateFullViewport();
    this.scissorBox = { x, y, w, h };
  }

  /** Upload the frame stream with one call, then draw every command from it. */
  submit(stream: Float32Array, floatCount: number, commands: readonly DrawCommand[]): void {
    if (floatCount <= 0 || commands.length === 0) return;
    const gl = this.gl;
    this.applyScissor();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stream);
    gl.bufferData(gl.ARRAY_BUFFER, floatCount === stream.length ? stream : stream.subarray(0, floatCount), gl.STREAM_DRAW);

    let active: ProgramState | null = null;
    for (const command of commands) {
      const state = this.programFor(command);
      if (state !== active) {
        gl.useProgram(state.program);
        gl.bindVertexArray(state.vao);
        active = state;
      }
      if (command.kind !== "rects") {
        gl.uniform2f(state.uScale, command.scaleX, command.scaleY);
        gl.uniform2f(state.uOffset, command.offsetX, command.offsetY);
        gl.uniform4f(state.uColor, command.color[0], command.color[1], command.color[2], command.color[3]);
      }
      switch (command.kind) {
        case "solid":
          this.drawSolid(command);
          break;
        case "thickLine":
          this.drawThickLine(state, command);
          break;
        case "point":
          this.drawPoints(state, command);
          break;
        case "bar":
          this.drawBars(state, command);
          break;
        case "rects":
          this.drawRects(state, command);
          break;
      }
    }
    gl.bindVertexArray(null);
  }

  /** Return the underlying WebGL2 rendering context. */
  getContext(): WebGL2RenderingContext {
    return this.gl;
  }

  /** Release GPU objects owned by the backend. */
  destroy(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    const programs = Object.values(this.programs);
    this.programs = {};
    if (this.isContextInvalid()) return;
    for (const state of programs) {
      this.gl.deleteProgram(state.program);
      this.gl.deleteVertexArray(state.vao);
      if (state.corners) this.gl.deleteBuffer(state.corners);
    }
    this.gl.deleteBuffer(this.stream);
  }

  private drawSolid(command: SolidDraw): void {
    this.gl.drawArrays(this.toGlPrimitive(command.primitive), command.first, command.count);
  }

  private drawThickLine(state: ProgramState, command: ThickLineDraw): void {
    const gl = this.gl;
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    gl.uniform1f(state.uLineWidth, command.lineWidth);
    const stride = command.layout === "strip" ? BYTES_PER_VERTEX : BYTES_PER_VERTEX * 2;
    this.pointInstanceAttribute(state.aStart, stride, command.first * BYTES_PER_VERTEX);
    this.pointInstanceAttribute(state.aEnd, stride, (command.first + 1) * BYTES_PER_VERTEX);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, command.segments);
  }

  private drawPoints(state: ProgramState, command: PointDraw): void {
    const gl = this.gl;
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    gl.uniform1f(state.uPointSize, command.pointSize);
    this.pointInstanceAttribute(state.aStart, BYTES_PER_VERTEX, command.first * BYTES_PER_VERTEX);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, command.instances);
  }

  private drawBars(state: ProgramState, command: BarDraw): void {
    const gl = this.gl;
    gl.uniform1f(state.uBarWidth, command.barWidth);
    gl.uniform1f(state.uBaseline, command.baseline);
    this.pointInstanceAttribute(state.aStart, BYTES_PER_VERTEX, command.first * BYTES_PER_VERTEX);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, command.instances);
  }

  private drawRects(state: ProgramState, command: RectsDraw): void {
    const gl = this.gl;
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    // Bounds and color are interleaved per rectangle; first counts four two-float vertices per rectangle.
    this.pointInstanceAttribute(state.aStart, BYTES_PER_RECT, command.first * BYTES_PER_VERTEX, 4);
    this.pointInstanceAttribute(state.aEnd, BYTES_PER_RECT, command.first * BYTES_PER_VERTEX + 4 * Float32Array.BYTES_PER_ELEMENT, 4);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, command.instances);
  }

  /** Re-aim a per-instance attribute of the bound VAO at the frame stream (WebGL2 has no base instance). */
  private pointInstanceAttribute(location: number, stride: number, byteOffset: number, size = 2): void {
    this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, stride, byteOffset);
  }

  private programFor(command: DrawCommand): ProgramState {
    switch (command.kind) {
      case "solid":
        return (this.programs.line ??= this.createProgram("line", "position", null, null));
      case "thickLine":
        return (this.programs.thickLine ??= this.createProgram("thickLine", "aStart", "aEnd", SEGMENT_CORNERS));
      case "point":
        return (this.programs.point ??= this.createProgram("point", "aPosition", null, POINT_CORNERS));
      case "bar":
        return (this.programs.bar ??= this.createProgram("bar", "aPosition", null, BAR_CORNERS));
      case "rects":
        return (this.programs.rect ??= this.createProgram("rect", "aRect", "aColor", RECT_CORNERS));
    }
  }

  /** Compile one built-in program and record its VAO: instance/vertex stream from the frame stream, corners from a static buffer. */
  private createProgram(name: keyof typeof ShaderPrograms, startName: string, endName: string | null, corners: readonly number[] | null): ProgramState {
    const gl = this.gl;
    const sources = ShaderPrograms[name];
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, sources.vert);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, sources.frag);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error("Failed to allocate WebGL program.");
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "unknown link error";
      gl.deleteProgram(program);
      throw new Error(`Failed to link WebGL program: ${log}`);
    }

    const vao = gl.createVertexArray();
    if (!vao) {
      gl.deleteProgram(program);
      throw new Error("Failed to allocate WebGL vertex array.");
    }
    const aStart = gl.getAttribLocation(program, startName);
    const aEnd = endName ? gl.getAttribLocation(program, endName) : -1;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stream);
    gl.enableVertexAttribArray(aStart);
    if (corners) {
      // Instanced streams are re-aimed at the frame stream offset on every draw.
      gl.vertexAttribDivisor(aStart, 1);
      if (aEnd >= 0) {
        gl.enableVertexAttribArray(aEnd);
        gl.vertexAttribDivisor(aEnd, 1);
      }
    } else {
      gl.vertexAttribPointer(aStart, 2, gl.FLOAT, false, 0, 0);
    }

    let cornerBuffer: WebGLBuffer | null = null;
    if (corners) {
      cornerBuffer = gl.createBuffer();
      if (!cornerBuffer) {
        gl.bindVertexArray(null);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
        throw new Error("Failed to allocate WebGL buffer.");
      }
      const aCorner = gl.getAttribLocation(program, "aCorner");
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stream);
    }
    gl.bindVertexArray(null);

    return {
      program,
      vao,
      corners: cornerBuffer,
      uScale: gl.getUniformLocation(program, "uScale"),
      uOffset: gl.getUniformLocation(program, "uOffset"),
      uColor: gl.getUniformLocation(program, "uColor"),
      uCanvasSize: gl.getUniformLocation(program, "uCanvasSize"),
      uLineWidth: gl.getUniformLocation(program, "uLineWidth"),
      uPointSize: gl.getUniformLocation(program, "uPointSize"),
      uBarWidth: gl.getUniformLocation(program, "uBarWidth"),
      uBaseline: gl.getUniformLocation(program, "uBaseline"),
      aStart,
      aEnd,
    };
  }

  private applyBlendState(): void {
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFuncSeparate(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  private isContextInvalid(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Failed to allocate WebGL shader.");
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const log = this.gl.getShaderInfoLog(shader) ?? "unknown compile error";
      this.gl.deleteShader(shader);
      throw new Error(`Failed to compile WebGL shader: ${log}`);
    }
    return shader;
  }

  private applyScissor(): void {
    if (!this.scissorBox) {
      this.gl.disable(this.gl.SCISSOR_TEST);
      return;
    }
    this.gl.enable(this.gl.SCISSOR_TEST);
    this.gl.scissor(this.scissorBox.x, this.scissorBox.y, this.scissorBox.w, this.scissorBox.h);
  }

  private updateFullViewport(): void {
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private toGlPrimitive(primitive: SolidPrimitive): number {
    switch (primitive) {
      case "lines":
        return this.gl.LINES;
      case "line_strip":
        return this.gl.LINE_STRIP;
      case "triangles":
        return this.gl.TRIANGLES;
      case "triangle_strip":
        return this.gl.TRIANGLE_STRIP;
    }
  }
}

const DEFAULT_MAX_VIEWPORT_PIXELS = 16_384 * 16_384;

function maxViewportPixels(gl: WebGL2RenderingContext): number {
  try {
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
    if (dims && dims.length >= 2 && dims[0]! > 0 && dims[1]! > 0) return dims[0]! * dims[1]!;
  } catch {
    // Contexts that cannot answer (or are already lost) fall back to a conservative size.
  }
  return DEFAULT_MAX_VIEWPORT_PIXELS;
}
