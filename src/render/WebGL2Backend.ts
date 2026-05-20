import type { GpuBackend, GpuBuffer, GpuProgram, GpuResource, BufferSpec, DrawSpec, AttributeSpec, UniformValue } from "./types.js";
import { WebGL2Resources } from "./WebGL2Resources.js";

type NativeGpuBuffer = GpuBuffer & {
  readonly buffer: WebGLBuffer;
  readonly target: number;
};

type UniformSetter = (value: UniformValue) => void;

type NativeGpuProgram = GpuProgram & {
  readonly id: number;
  readonly program: WebGLProgram;
  readonly attributes: ReadonlyMap<string, AttributeInfo>;
  readonly uniforms: ReadonlyMap<string, UniformSetter>;
};

interface AttributeInfo {
  readonly location: number;
  readonly size: number;
  readonly type: number;
}

export class WebGL2UnavailableError extends Error {
  constructor(message = "BlazePlot requires WebGL2, but this browser/context does not support it.") {
    super(message);
    this.name = "WebGL2UnavailableError";
  }
}

export function isWebGL2Available(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return canvas.getContext("webgl2") !== null;
}

export class WebGL2Backend implements GpuBackend {
  private readonly gl: WebGL2RenderingContext;
  private readonly resources: WebGL2Resources;
  private nextProgramId: number = 1;
  private scissorBox: { x: number; y: number; w: number; h: number } | null = null;
  private activeProgram: NativeGpuProgram | null = null;
  private readonly allocatedPrograms: Set<WebGLProgram> = new Set();
  private enabledAttributes: Set<number> = new Set();
  readonly capabilities: GpuBackend["capabilities"];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      throw new WebGL2UnavailableError();
    }

    this.gl = gl;
    this.capabilities = {
      instancing: typeof gl.vertexAttribDivisor === "function" && typeof gl.drawArraysInstanced === "function",
    };
    this.resources = new WebGL2Resources(gl);
    this.resources.preAllocate();

    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.STENCIL_TEST);
  }

  createBuffer(spec: BufferSpec): GpuBuffer {
    const { buffer } = this.resources.acquire(spec.length, spec.usage, spec.type);
    return {
      kind: "buffer",
      length: spec.length,
      type: spec.type,
      buffer,
      target: spec.type === "element" ? this.gl.ELEMENT_ARRAY_BUFFER : this.gl.ARRAY_BUFFER,
    } as NativeGpuBuffer;
  }

  updateBuffer(buffer: GpuBuffer, data: Float32Array | Uint16Array, offset: number = 0): void {
    if (data.length + offset > buffer.length) {
      throw new RangeError("GPU buffer update exceeds allocated buffer length.");
    }

    const nativeBuffer = this.asNativeBuffer(buffer);
    const bytesPerElement = buffer.type === "float" ? Float32Array.BYTES_PER_ELEMENT : Uint16Array.BYTES_PER_ELEMENT;
    this.gl.bindBuffer(nativeBuffer.target, nativeBuffer.buffer);
    this.gl.bufferSubData(nativeBuffer.target, offset * bytesPerElement, data);
  }

  createProgram(vert: string, frag: string): GpuProgram {
    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vert);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, frag);
    const program = this.gl.createProgram();
    if (!program) {
      this.gl.deleteShader(vertexShader);
      this.gl.deleteShader(fragmentShader);
      throw new Error("Failed to allocate WebGL program.");
    }

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const log = this.gl.getProgramInfoLog(program) ?? "unknown link error";
      this.gl.deleteProgram(program);
      throw new Error(`Failed to link WebGL program: ${log}`);
    }

    this.allocatedPrograms.add(program);

    return {
      kind: "program",
      id: this.nextProgramId++,
      program,
      attributes: this.readAttributes(program),
      uniforms: this.readUniforms(program),
    } as NativeGpuProgram;
  }

  draw(spec: DrawSpec): void {
    if (spec.count <= 0 || (spec.instances !== undefined && spec.instances <= 0)) return;

    const program = this.asNativeProgram(spec.program);
    this.useProgram(program);
    this.applyScissor();
    this.applyAttributes(program, spec.attributes);
    this.applyUniforms(program, spec.uniforms);

    const primitive = this.toGlPrimitive(spec.primitive);
    if (spec.elements) {
      const elements = this.asNativeBuffer(spec.elements);
      if (elements.type !== "element") {
        throw new TypeError("Indexed draws require an element buffer.");
      }
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, elements.buffer);
      const drawType = this.gl.UNSIGNED_SHORT;
      if (spec.instances !== undefined) {
        this.gl.drawElementsInstanced(primitive, spec.count, drawType, 0, spec.instances);
      } else {
        this.gl.drawElements(primitive, spec.count, drawType, 0);
      }
      return;
    }

    if (spec.instances !== undefined) {
      this.gl.drawArraysInstanced(primitive, 0, spec.count, spec.instances);
    } else {
      this.gl.drawArrays(primitive, 0, spec.count);
    }
  }

  dispose(resource: GpuResource): void {
    if (this.isNativeBuffer(resource)) {
      this.resources.release(resource.buffer);
      return;
    }
    if (this.isNativeProgram(resource)) {
      this.gl.deleteProgram(resource.program);
      this.allocatedPrograms.delete(resource.program);
      if (this.activeProgram === resource) this.activeProgram = null;
    }
  }

  clear(r: number, g: number, b: number, a: number): void {
    this.updateFullViewport();
    this.gl.disable(this.gl.SCISSOR_TEST);
    this.gl.clearColor(r, g, b, a);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  viewport(x: number, y: number, w: number, h: number): void {
    this.updateFullViewport();
    this.scissorBox = { x, y, w, h };
  }

  getContext(): WebGL2RenderingContext {
    return this.gl;
  }

  destroy(): void {
    for (const location of this.enabledAttributes) {
      this.gl.disableVertexAttribArray(location);
      this.gl.vertexAttribDivisor(location, 0);
    }
    this.enabledAttributes.clear();
    this.activeProgram = null;
    for (const program of this.allocatedPrograms) {
      this.gl.deleteProgram(program);
    }
    this.allocatedPrograms.clear();
    this.resources.destroy();
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

  private readAttributes(program: WebGLProgram): ReadonlyMap<string, AttributeInfo> {
    const attributes = new Map<string, AttributeInfo>();
    const count = this.gl.getProgramParameter(program, this.gl.ACTIVE_ATTRIBUTES) as number;
    for (let i = 0; i < count; i++) {
      const active = this.gl.getActiveAttrib(program, i);
      if (!active) continue;
      const location = this.gl.getAttribLocation(program, active.name);
      if (location < 0) continue;
      attributes.set(active.name, {
        location,
        size: this.attributeComponentCount(active.type),
        type: active.type,
      });
    }
    return attributes;
  }

  private readUniforms(program: WebGLProgram): ReadonlyMap<string, UniformSetter> {
    const uniforms = new Map<string, UniformSetter>();
    const count = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const active = this.gl.getActiveUniform(program, i);
      if (!active) continue;
      const name = active.name.replace(/\[0\]$/, "");
      const location = this.gl.getUniformLocation(program, name);
      if (!location) continue;
      uniforms.set(name, this.createUniformSetter(location, active.type));
    }
    return uniforms;
  }

  private useProgram(program: NativeGpuProgram): void {
    if (this.activeProgram === program) return;
    this.gl.useProgram(program.program);
    this.activeProgram = program;
  }

  private applyScissor(): void {
    if (!this.scissorBox) {
      this.gl.disable(this.gl.SCISSOR_TEST);
      return;
    }
    this.gl.enable(this.gl.SCISSOR_TEST);
    this.gl.scissor(this.scissorBox.x, this.scissorBox.y, this.scissorBox.w, this.scissorBox.h);
  }

  private applyAttributes(program: NativeGpuProgram, attributes: Readonly<Record<string, GpuBuffer | AttributeSpec>>): void {
    const usedLocations = new Set<number>();
    for (const [name, attribute] of Object.entries(attributes)) {
      const info = program.attributes.get(name);
      if (!info) continue;
      const resolved = this.resolveAttribute(attribute, info);
      const buffer = this.asNativeBuffer(resolved.buffer);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer.buffer);
      this.gl.enableVertexAttribArray(info.location);
      this.gl.vertexAttribPointer(info.location, resolved.size, this.gl.FLOAT, false, resolved.stride, resolved.offset);
      this.gl.vertexAttribDivisor(info.location, resolved.divisor);
      usedLocations.add(info.location);
      this.enabledAttributes.add(info.location);
    }

    for (const location of this.enabledAttributes) {
      if (!usedLocations.has(location)) {
        this.gl.disableVertexAttribArray(location);
        this.gl.vertexAttribDivisor(location, 0);
      }
    }
    this.enabledAttributes = usedLocations;
  }

  private applyUniforms(program: NativeGpuProgram, uniforms: Readonly<Record<string, UniformValue>>): void {
    for (const [name, value] of Object.entries(uniforms)) {
      const setter = program.uniforms.get(name);
      if (setter) setter(value);
    }
  }

  private resolveAttribute(attribute: GpuBuffer | AttributeSpec, info: AttributeInfo): Required<AttributeSpec> {
    if ("divisor" in attribute) {
      return {
        buffer: attribute.buffer,
        divisor: attribute.divisor,
        stride: attribute.stride ?? 0,
        offset: attribute.offset ?? 0,
        size: attribute.size ?? info.size,
      };
    }

    return {
      buffer: attribute,
      divisor: 0,
      stride: 0,
      offset: 0,
      size: info.size,
    };
  }

  private createUniformSetter(location: WebGLUniformLocation, type: number): UniformSetter {
    switch (type) {
      case this.gl.FLOAT:
        return value => this.gl.uniform1f(location, this.toNumber(value));
      case this.gl.FLOAT_VEC2:
        return value => this.gl.uniform2fv(location, this.toFloatList(value, 2));
      case this.gl.FLOAT_VEC3:
        return value => this.gl.uniform3fv(location, this.toFloatList(value, 3));
      case this.gl.FLOAT_VEC4:
        return value => this.gl.uniform4fv(location, this.toFloatList(value, 4));
      case this.gl.INT:
      case this.gl.BOOL:
        return value => this.gl.uniform1i(location, this.toNumber(value));
      default:
        return value => this.setUniformByValue(location, value);
    }
  }

  private setUniformByValue(location: WebGLUniformLocation, value: UniformValue): void {
    if (typeof value === "number") {
      this.gl.uniform1f(location, value);
      return;
    }
    if (typeof value === "boolean") {
      this.gl.uniform1i(location, value ? 1 : 0);
      return;
    }
    switch (value.length) {
      case 1:
        this.gl.uniform1fv(location, value);
        return;
      case 2:
        this.gl.uniform2fv(location, value);
        return;
      case 3:
        this.gl.uniform3fv(location, value);
        return;
      case 4:
        this.gl.uniform4fv(location, value);
        return;
      case 9:
        this.gl.uniformMatrix3fv(location, false, value);
        return;
      case 16:
        this.gl.uniformMatrix4fv(location, false, value);
        return;
      default:
        throw new Error(`Unsupported uniform array length: ${value.length}`);
    }
  }

  private toFloatList(value: UniformValue, expectedLength: number): Float32List {
    if (typeof value === "number" || typeof value === "boolean") {
      throw new TypeError(`Expected a float vector uniform with ${expectedLength} components.`);
    }
    if (value.length !== expectedLength) {
      throw new TypeError(`Expected a float vector uniform with ${expectedLength} components, received ${value.length}.`);
    }
    return value instanceof Float32Array ? value : new Float32Array(value);
  }

  private toNumber(value: UniformValue): number {
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value.length === 1) return value[0] ?? 0;
    throw new TypeError("Expected a scalar uniform value.");
  }

  private attributeComponentCount(type: number): number {
    switch (type) {
      case this.gl.FLOAT:
        return 1;
      case this.gl.FLOAT_VEC2:
        return 2;
      case this.gl.FLOAT_VEC3:
        return 3;
      case this.gl.FLOAT_VEC4:
        return 4;
      default:
        return 1;
    }
  }

  private updateFullViewport(): void {
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private asNativeBuffer(buffer: GpuBuffer): NativeGpuBuffer {
    return buffer as NativeGpuBuffer;
  }

  private asNativeProgram(program: GpuProgram): NativeGpuProgram {
    return program as NativeGpuProgram;
  }

  private isNativeBuffer(resource: GpuResource): resource is NativeGpuBuffer {
    return "length" in resource && "type" in resource && "buffer" in resource;
  }

  private isNativeProgram(resource: GpuResource): resource is NativeGpuProgram {
    return "program" in resource;
  }

  private toGlPrimitive(primitive: DrawSpec["primitive"]): number {
    switch (primitive) {
      case "points":
        return this.gl.POINTS;
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

/**
 * Deprecated alias for WebGL2Backend. This preserves the pre-native-backend public API.
 * @deprecated Use WebGL2Backend.
 */
export const ReglBackend: typeof WebGL2Backend = WebGL2Backend;
