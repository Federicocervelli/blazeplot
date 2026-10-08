import type { BarDraw, DrawCommand, GpuBackend, PointDraw, RectsDraw, SolidDraw, SolidPrimitive, ThickLineDraw } from "./types.js";
import { ShaderPrograms } from "./ShaderPrograms.js";
import type { ProgramName } from "./ShaderPrograms.js";
import { WebGL2UnavailableError } from "./availability.js";

const BYTES_PER_VERTEX = 2 * Float32Array.BYTES_PER_ELEMENT;

/** Unit-quad corner offsets shared by every instanced program, as triangle-strip vertices. */
const SEGMENT_CORNERS = [0, -1, 0, 1, 1, -1, 1, 1];
const POINT_CORNERS = [-1, -1, 1, -1, -1, 1, 1, 1];
const BAR_CORNERS = [-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1];
const RECT_CORNERS = [0, 0, 1, 0, 0, 1, 1, 1];
const BYTES_PER_RECT = 8 * Float32Array.BYTES_PER_ELEMENT;

/** Vertex streams of each built-in program: attribute names, and the static unit-quad corners of instanced ones. */
const PROGRAM_LAYOUTS: Readonly<Record<ProgramName, { readonly start: string; readonly end: string | null; readonly corners: readonly number[] | null }>> = {
  line: { start: "position", end: null, corners: null },
  thickLine: { start: "aStart", end: "aEnd", corners: SEGMENT_CORNERS },
  point: { start: "aPosition", end: null, corners: POINT_CORNERS },
  bar: { start: "aPosition", end: null, corners: BAR_CORNERS },
  rect: { start: "aRect", end: "aColor", corners: RECT_CORNERS },
};

/** The program each recorded draw kind runs. */
const PROGRAM_OF_COMMAND: Readonly<Record<DrawCommand["kind"], ProgramName>> = { solid: "line", thickLine: "thickLine", point: "point", bar: "bar", rects: "rect" };

/** A GPU object the context handed back, or the error browsers give when it cannot allocate one (typically a lost context). */
function allocated<T>(object: T | null, what: string): T {
  if (!object) throw new Error(`Failed to allocate WebGL ${what}.`);
  return object;
}

/** A program whose compile and link were issued but whose result has not been read yet. */
interface PendingProgram {
  readonly program: WebGLProgram;
  readonly shaders: readonly WebGLShader[];
}

/** Every uniform a built-in program may declare; a program that lacks one gets `null`, which GL ignores. */
const UNIFORM_NAMES = ["uScale", "uOffset", "uColor", "uCanvasSize", "uLineWidth", "uPointSize", "uBarWidth", "uBaseline"] as const;

/** A linked program with its fixed vertex array object and uniform locations. */
interface ProgramState extends Readonly<Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>> {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly corners: WebGLBuffer | null;
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
  private programs: Partial<Record<ProgramName, ProgramState>> = {};
  private pending: Partial<Record<ProgramName, PendingProgram>> = {};
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
    // Lets the browser compile and link programs on worker threads (see `prepare`). Harmless when absent.
    gl.getExtension("KHR_parallel_shader_compile");
    this.maxDrawingBufferPixels = maxViewportPixels(gl);
    this.stream = allocated(gl.createBuffer(), "buffer");
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    // Depth and stencil tests are off by default and the context has neither buffer.
    this.applyBlendState();
  }

  /** Clear the active framebuffer. */
  clear(r: number, g: number, b: number, a: number): void {
    const gl = this.gl;
    this.updateFullViewport();
    // Re-applied every frame so the state also survives context loss and restore, which resets it.
    this.applyBlendState();
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
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

  /**
   * Stop listening to the canvas without touching GPU objects, for a backend parked in the warm pool.
   * Pair with {@link attachCanvasListeners}.
   */
  detachCanvasListeners(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
  }

  /**
   * Listen to the canvas again after {@link detachCanvasListeners}. A loss and restore may have happened
   * in between unseen, which leaves a live context holding none of this backend's objects: returns false
   * then (and marks the backend lost so teardown skips `gl.delete*`), and the caller must not draw with it.
   */
  attachCanvasListeners(): boolean {
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.contextLost ||= this.gl.isContextLost() || !this.gl.isBuffer(this.stream);
    return !this.contextLost;
  }

  /** Release GPU objects owned by the backend. */
  destroy(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    const programs = Object.values(this.programs);
    const pending = Object.values(this.pending);
    this.programs = {};
    this.pending = {};
    if (this.isContextInvalid()) return;
    for (const { program, shaders } of pending) {
      this.gl.deleteProgram(program);
      for (const shader of shaders) this.gl.deleteShader(shader);
    }
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
    this.aimAttribute(state.aStart, stride, command.first * BYTES_PER_VERTEX);
    this.aimAttribute(state.aEnd, stride, (command.first + 1) * BYTES_PER_VERTEX);
    this.drawQuads(command.segments);
  }

  private drawPoints(state: ProgramState, command: PointDraw): void {
    const gl = this.gl;
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    gl.uniform1f(state.uPointSize, command.pointSize);
    this.aimAttribute(state.aStart, BYTES_PER_VERTEX, command.first * BYTES_PER_VERTEX);
    this.drawQuads(command.instances);
  }

  private drawBars(state: ProgramState, command: BarDraw): void {
    const gl = this.gl;
    gl.uniform1f(state.uBarWidth, command.barWidth);
    gl.uniform1f(state.uBaseline, command.baseline);
    this.aimAttribute(state.aStart, BYTES_PER_VERTEX, command.first * BYTES_PER_VERTEX);
    this.drawQuads(command.instances);
  }

  private drawRects(state: ProgramState, command: RectsDraw): void {
    const gl = this.gl;
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    // Bounds and color are interleaved per rectangle; first counts four two-float vertices per rectangle.
    this.aimAttribute(state.aStart, BYTES_PER_RECT, command.first * BYTES_PER_VERTEX, 4);
    this.aimAttribute(state.aEnd, BYTES_PER_RECT, command.first * BYTES_PER_VERTEX + 4 * Float32Array.BYTES_PER_ELEMENT, 4);
    this.drawQuads(command.instances);
  }

  private drawQuads(instances: number): void {
    this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, 4, instances);
  }

  /** Re-aim a per-instance attribute of the bound VAO at the frame stream (WebGL2 has no base instance). */
  private aimAttribute(location: number, stride: number, byteOffset: number, size = 2): void {
    this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, stride, byteOffset);
  }

  /**
   * Start building `programs` without waiting for the result. Compile and link are only issued here;
   * the first draw that needs a program reads the outcome (`finishProgram`). With
   * `KHR_parallel_shader_compile` the browser compiles them on worker threads while JavaScript goes on
   * with the chart's first frame, so program build time overlaps with series setup instead of
   * stalling the first draw. Names already built or started are skipped, so hints can be repeated.
   */
  prepare(programs: readonly ProgramName[]): void {
    for (const name of programs) if (!this.programs[name]) this.startProgram(name);
  }

  private programFor(command: DrawCommand): ProgramState {
    const name = PROGRAM_OF_COMMAND[command.kind];
    return (this.programs[name] ??= this.finishProgram(name));
  }

  /** Issue compile and link for one built-in program and return without reading the result. */
  private startProgram(name: ProgramName): PendingProgram {
    const known = this.pending[name];
    if (known) return known;
    const gl = this.gl;
    const sources = ShaderPrograms[name];
    const program = allocated(gl.createProgram(), "program");
    const shaders = ([[gl.VERTEX_SHADER, sources.vert], [gl.FRAGMENT_SHADER, sources.frag]] as const).map(([type, source]) => {
      const shader = allocated(gl.createShader(type), "shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      return shader;
    });
    gl.linkProgram(program);
    return (this.pending[name] = { program, shaders });
  }

  /** Wait for a started program (starting it first when no hint did), then record its VAO: instance/vertex stream from the frame stream, corners from a static buffer. */
  private finishProgram(name: ProgramName): ProgramState {
    const gl = this.gl;
    const { program, shaders } = this.startProgram(name);
    delete this.pending[name];
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    const log = linked ? "" : [...shaders.map((shader) => gl.getShaderInfoLog(shader)), gl.getProgramInfoLog(program)].filter(Boolean).join("\n");
    for (const shader of shaders) gl.deleteShader(shader);
    if (!linked) {
      gl.deleteProgram(program);
      throw new Error(`Failed to build WebGL program "${name}": ${log || "unknown error"}`);
    }

    const { start: startName, end: endName, corners } = PROGRAM_LAYOUTS[name];
    const vao = allocated(gl.createVertexArray(), "vertex array");
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
      cornerBuffer = allocated(gl.createBuffer(), "buffer");
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
      ...(Object.fromEntries(UNIFORM_NAMES.map((uniform) => [uniform, gl.getUniformLocation(program, uniform)])) as Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>),
      aStart,
      aEnd,
    };
  }

  private applyBlendState(): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private isContextInvalid(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  private applyScissor(): void {
    const gl = this.gl;
    const box = this.scissorBox;
    if (!box) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(box.x, box.y, box.w, box.h);
  }

  private updateFullViewport(): void {
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private toGlPrimitive(primitive: SolidPrimitive): number {
    const gl = this.gl;
    switch (primitive) {
      case "lines":
        return gl.LINES;
      case "line_strip":
        return gl.LINE_STRIP;
      case "triangles":
        return gl.TRIANGLES;
      case "triangle_strip":
        return gl.TRIANGLE_STRIP;
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
