import type { BarDraw, DrawCommand, FieldDraw, GpuBackend, InterleavedDraw, PointDraw, RectsDraw, SegmentSetDraw, SolidDraw, SolidPrimitive, ThickLineDraw } from "./types.js";
import { SEGMENT_SET_ROW } from "../SegmentSet.js";
import type { SegmentSet } from "../SegmentSet.js";
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

/** One attribute of an interleaved stream: its name, float count, and float offset within a record. */
interface InterleavedAttribute {
  readonly name: string;
  readonly size: number;
  readonly offset: number;
}

/** A record layout of interleaved per-instance (or per-vertex) data in the frame stream. */
interface InterleavedLayout {
  readonly strideFloats: number;
  readonly attributes: readonly InterleavedAttribute[];
}

/**
 * Vertex streams of each built-in program: attribute names, the static unit-quad corners of instanced
 * ones, and for interleaved programs the record layout (`start`/`end` are then unused).
 */
const PROGRAM_LAYOUTS: Readonly<Record<ProgramName, { readonly start: string; readonly end: string | null; readonly corners: readonly number[] | null; readonly interleaved?: InterleavedLayout }>> = {
  line: { start: "position", end: null, corners: null },
  thickLine: { start: "aStart", end: "aEnd", corners: SEGMENT_CORNERS },
  point: { start: "aPosition", end: null, corners: POINT_CORNERS },
  bar: { start: "aPosition", end: null, corners: BAR_CORNERS },
  rect: { start: "aRect", end: "aColor", corners: RECT_CORNERS },
  shape: {
    start: "aRect",
    end: null,
    corners: RECT_CORNERS,
    interleaved: { strideFloats: 14, attributes: [{ name: "aRect", size: 4, offset: 0 }, { name: "aShape", size: 2, offset: 4 }, { name: "aFill", size: 4, offset: 6 }, { name: "aBorder", size: 4, offset: 10 }] },
  },
  segment: {
    start: "aEnds",
    end: null,
    corners: SEGMENT_CORNERS,
    interleaved: { strideFloats: 12, attributes: [{ name: "aEnds", size: 4, offset: 0 }, { name: "aStroke", size: 4, offset: 4 }, { name: "aColor", size: 4, offset: 8 }] },
  },
  color: {
    start: "aPosition",
    end: null,
    corners: null,
    interleaved: { strideFloats: 6, attributes: [{ name: "aPosition", size: 2, offset: 0 }, { name: "aColor", size: 4, offset: 2 }] },
  },
  field: { start: "aRect", end: null, corners: RECT_CORNERS },
  // Each set has its own vertex array (see `segmentSetResources`); the program's own is never drawn from.
  segmentSet: { start: "aIndex", end: null, corners: SEGMENT_CORNERS },
};

/** The program each recorded draw kind runs. */
const PROGRAM_OF_COMMAND: Readonly<Record<DrawCommand["kind"], ProgramName>> = {
  solid: "line",
  thickLine: "thickLine",
  point: "point",
  bar: "bar",
  rects: "rect",
  shapes: "shape",
  segments: "segment",
  colorTriangles: "color",
  field: "field",
  segmentSet: "segmentSet",
};

function isInterleaved(command: DrawCommand): command is InterleavedDraw {
  return command.kind === "shapes" || command.kind === "segments" || command.kind === "colorTriangles";
}

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
const UNIFORM_NAMES = ["uScale", "uOffset", "uColor", "uCanvasSize", "uLineWidth", "uPointSize", "uBarWidth", "uBaseline", "uPoints", "uPointsWidth", "uPointCount", "uStroke"] as const;

/** The texture unit segment sets read their points from (unit 0 is the field's). */
const POINTS_UNIT = 1;

/** A segment set's GPU copy on one backend: its points as a texture, its index pairs, and a vertex array over them. */
interface SegmentSetResources {
  readonly texture: WebGLTexture;
  readonly ends: WebGLBuffer;
  readonly vao: WebGLVertexArrayObject;
  /** The set's `version` the texture holds. */
  version: number;
  readonly unregister: () => void;
}

/** A linked program with its fixed vertex array object and uniform locations. */
interface ProgramState extends Readonly<Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>> {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly corners: WebGLBuffer | null;
  /** Attribute locations of the per-instance streams (`aStart`/`aEnd` or `aPosition`). */
  readonly aStart: number;
  readonly aEnd: number;
  /** Locations of an interleaved program's attributes, in its layout's order (empty otherwise). */
  readonly attributes: readonly number[];
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
  /** The largest texture side the context reports (2048, the WebGL2 minimum, when it cannot say). */
  private readonly maxTextureSize: number;
  private programs: Partial<Record<ProgramName, ProgramState>> = {};
  private pending: Partial<Record<ProgramName, PendingProgram>> = {};
  private scissorBox: { x: number; y: number; w: number; h: number } | null = null;
  /** The texture field draws upload into, made on first use. */
  private fieldTexture: WebGLTexture | null = null;
  /** GPU copies of the segment sets this backend drew, until a set or the backend is disposed. */
  private readonly segmentSets = new Map<SegmentSet, SegmentSetResources>();
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
    this.maxTextureSize = maxTextureSize(gl);
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
    // Nothing staged and nothing drawn from kept sets: every draw would read an empty stream.
    if (commands.length === 0 || (floatCount <= 0 && !commands.some((command) => command.kind === "segmentSet"))) return;
    const gl = this.gl;
    this.applyScissor();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stream);
    // A frame of segment sets alone stages nothing.
    if (floatCount > 0) gl.bufferData(gl.ARRAY_BUFFER, floatCount === stream.length ? stream : stream.subarray(0, floatCount), gl.STREAM_DRAW);

    let active: ProgramState | null = null;
    for (const command of commands) {
      const state = this.programFor(command);
      if (state !== active) {
        gl.useProgram(state.program);
        gl.bindVertexArray(state.vao);
        active = state;
      }
      if (isInterleaved(command)) {
        this.drawInterleaved(state, command);
        continue;
      }
      if (command.kind === "field") {
        this.drawField(state, command);
        continue;
      }
      if (command.kind === "segmentSet") {
        this.drawSegmentSet(state, command);
        // The set's own vertex array is bound now: the next draw of any program binds its own again.
        active = null;
        continue;
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
    if (this.isContextInvalid()) {
      for (const resources of this.segmentSets.values()) resources.unregister();
      this.segmentSets.clear();
      return;
    }
    for (const { program, shaders } of pending) {
      this.gl.deleteProgram(program);
      for (const shader of shaders) this.gl.deleteShader(shader);
    }
    if (this.fieldTexture) this.gl.deleteTexture(this.fieldTexture);
    this.fieldTexture = null;
    // Deleting the entry being visited is safe while iterating a Map.
    for (const set of this.segmentSets.keys()) this.releaseSegmentSet(set);
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

  /** Upload a field's opacities to the field texture and draw its rectangle through it, filtered linearly. */
  private drawField(state: ProgramState, command: FieldDraw): void {
    const gl = this.gl;
    if (!this.fieldTexture) {
      this.fieldTexture = allocated(gl.createTexture(), "texture");
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, command.cols, command.rows, 0, gl.RED, gl.UNSIGNED_BYTE, command.alpha);
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    gl.uniform4f(state.uColor, command.color[0], command.color[1], command.color[2], 1);
    this.aimAttribute(state.aStart, 0, command.first * BYTES_PER_VERTEX, 4);
    this.drawQuads(1);
  }

  /** Draw some segments of a set from its GPU copy, uploading the set first or its changed points when needed. */
  private drawSegmentSet(state: ProgramState, command: SegmentSetDraw): void {
    const gl = this.gl;
    const resources = this.segmentSetResources(state, command.set);
    if (!resources) return;
    gl.bindVertexArray(resources.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.ends);
    // WebGL2 has no base instance: aim the index pairs at the first segment drawn.
    gl.vertexAttribIPointer(state.aStart, 2, gl.UNSIGNED_INT, 0, command.first * 2 * Uint32Array.BYTES_PER_ELEMENT);
    gl.activeTexture(gl.TEXTURE0 + POINTS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    gl.uniform1i(state.uPoints, POINTS_UNIT);
    gl.uniform1i(state.uPointsWidth, SEGMENT_SET_ROW);
    gl.uniform1ui(state.uPointCount, command.set.pointCount);
    gl.uniform2f(state.uScale, command.scaleX, command.scaleY);
    gl.uniform2f(state.uOffset, command.offsetX, command.offsetY);
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    gl.uniform4f(state.uStroke, command.stroke[0], command.stroke[1], command.stroke[2], 0);
    gl.uniform4f(state.uColor, command.color[0], command.color[1], command.color[2], command.color[3]);
    this.drawQuads(command.count);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stream);
  }

  /** The GPU copy of `set`, made on its first draw here; points changed since are uploaded first. */
  private segmentSetResources(state: ProgramState, set: SegmentSet): SegmentSetResources | null {
    const gl = this.gl;
    const rows = set.points.length / (SEGMENT_SET_ROW * 2);
    let resources = this.segmentSets.get(set);
    if (!resources) {
      if (rows > this.maxTextureSize) {
        console.error(`BlazePlot: a segment set of ${set.pointCount} points is larger than this GPU's textures hold; it is not drawn.`);
        return null;
      }
      const texture = allocated(gl.createTexture(), "texture");
      gl.activeTexture(gl.TEXTURE0 + POINTS_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, SEGMENT_SET_ROW, rows, 0, gl.RG, gl.FLOAT, set.points);
      const ends = allocated(gl.createBuffer(), "buffer");
      const vao = allocated(gl.createVertexArray(), "vertex array");
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, ends);
      gl.bufferData(gl.ARRAY_BUFFER, set.ends, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(state.aStart);
      gl.vertexAttribIPointer(state.aStart, 2, gl.UNSIGNED_INT, 0, 0);
      gl.vertexAttribDivisor(state.aStart, 1);
      const aCorner = gl.getAttribLocation(state.program, "aCorner");
      gl.bindBuffer(gl.ARRAY_BUFFER, state.corners);
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, BYTES_PER_VERTEX, 0);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      resources = { texture, ends, vao, version: set.version, unregister: set.onRelease(() => this.releaseSegmentSet(set)) };
      this.segmentSets.set(set, resources);
      return resources;
    }
    if (resources.version !== set.version) {
      gl.activeTexture(gl.TEXTURE0 + POINTS_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, resources.texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      // One version behind: only the rows the last change touched; further behind: every row.
      const from = resources.version === set.version - 1 ? Math.floor(set.changedFrom / SEGMENT_SET_ROW) : 0;
      const to = resources.version === set.version - 1 ? Math.ceil(set.changedTo / SEGMENT_SET_ROW) : rows;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, from, SEGMENT_SET_ROW, to - from, gl.RG, gl.FLOAT, set.points.subarray(from * SEGMENT_SET_ROW * 2, to * SEGMENT_SET_ROW * 2));
      gl.activeTexture(gl.TEXTURE0);
      resources.version = set.version;
    }
    return resources;
  }

  /** Free the GPU copy of `set` (disposed, or this backend is). */
  private releaseSegmentSet(set: SegmentSet): void {
    const resources = this.segmentSets.get(set);
    if (!resources) return;
    this.segmentSets.delete(set);
    resources.unregister();
    if (this.isContextInvalid()) return;
    this.gl.deleteTexture(resources.texture);
    this.gl.deleteBuffer(resources.ends);
    this.gl.deleteVertexArray(resources.vao);
  }

  /** Aim every attribute of an interleaved program at its record in the frame stream, then draw. */
  private drawInterleaved(state: ProgramState, command: InterleavedDraw): void {
    const gl = this.gl;
    gl.uniform2f(state.uCanvasSize, command.canvasWidth, command.canvasHeight);
    const layout = PROGRAM_LAYOUTS[PROGRAM_OF_COMMAND[command.kind]].interleaved!;
    const stride = layout.strideFloats * Float32Array.BYTES_PER_ELEMENT;
    const base = command.first * BYTES_PER_VERTEX;
    layout.attributes.forEach((attribute, index) => {
      const location = state.attributes[index]!;
      if (location >= 0) this.aimAttribute(location, stride, base + attribute.offset * Float32Array.BYTES_PER_ELEMENT, attribute.size);
    });
    if (command.kind === "colorTriangles") gl.drawArrays(gl.TRIANGLES, 0, command.count);
    else this.drawQuads(command.count);
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

    const { start: startName, end: endName, corners, interleaved } = PROGRAM_LAYOUTS[name];
    const vao = allocated(gl.createVertexArray(), "vertex array");
    const aStart = gl.getAttribLocation(program, startName);
    const aEnd = endName ? gl.getAttribLocation(program, endName) : -1;
    const attributes = interleaved ? interleaved.attributes.map((attribute) => gl.getAttribLocation(program, attribute.name)) : [];
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stream);
    if (interleaved) {
      // Every attribute is aimed at the frame stream on each draw (`drawInterleaved`); instanced ones advance per instance.
      for (const location of attributes) {
        if (location < 0) continue;
        gl.enableVertexAttribArray(location);
        if (corners) gl.vertexAttribDivisor(location, 1);
      }
    } else if (corners) {
      // Instanced streams are re-aimed at the frame stream offset on every draw.
      gl.enableVertexAttribArray(aStart);
      gl.vertexAttribDivisor(aStart, 1);
      if (aEnd >= 0) {
        gl.enableVertexAttribArray(aEnd);
        gl.vertexAttribDivisor(aEnd, 1);
      }
    } else {
      gl.enableVertexAttribArray(aStart);
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
      attributes,
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

function maxTextureSize(gl: WebGL2RenderingContext): number {
  try {
    const size = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number | null;
    if (typeof size === "number" && size >= 2048) return size;
  } catch {
    // As for the viewport: assume the minimum WebGL2 guarantees.
  }
  return 2048;
}

function maxViewportPixels(gl: WebGL2RenderingContext): number {
  try {
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
    if (dims && dims.length >= 2 && dims[0]! > 0 && dims[1]! > 0) return dims[0]! * dims[1]!;
  } catch {
    // Contexts that cannot answer (or are already lost) fall back to a conservative size.
  }
  return DEFAULT_MAX_VIEWPORT_PIXELS;
}
