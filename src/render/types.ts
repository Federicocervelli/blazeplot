/** Minimal GPU abstraction used by the renderer. */
export interface GpuBackend {
  readonly capabilities: GpuCapabilities;
  createBuffer(spec: BufferSpec): GpuBuffer;
  updateBuffer(buffer: GpuBuffer, data: Float32Array | Uint16Array, offset?: number): void;
  createProgram(vert: string, frag: string): GpuProgram;
  draw(spec: DrawSpec): void;
  dispose(resource: GpuResource): void;
  clear(r: number, g: number, b: number, a: number): void;
  viewport(x: number, y: number, w: number, h: number): void;
  getContext?(): WebGL2RenderingContext | null;
  destroy(): void;
}

/** Feature flags reported by a GPU backend. */
export interface GpuCapabilities {
  readonly instancing: boolean;
}

/** Parameters for allocating a GPU buffer. */
export interface BufferSpec {
  readonly usage: "static" | "dynamic" | "stream";
  readonly type: "float" | "element";
  readonly length: number;
}

/** Opaque handle for a GPU buffer. */
export interface GpuBuffer {
  readonly kind: "buffer";
  readonly length: number;
  readonly type: BufferSpec["type"];
}

/** Opaque handle for a linked GPU program. */
export interface GpuProgram {
  readonly kind: "program";
}

/** GPU resource accepted by backend disposal. */
export type GpuResource = GpuBuffer | GpuProgram;

/** Uniform values accepted by `DrawSpec.uniforms`. */
export type UniformValue = number | boolean | readonly number[] | Float32Array;

/** Vertex attribute binding for a draw call. */
export interface AttributeSpec {
  readonly buffer: GpuBuffer;
  readonly divisor: number;
  readonly stride?: number;
  readonly offset?: number;
  readonly size?: number;
}

/** Complete draw call description for a GPU backend. */
export interface DrawSpec {
  readonly program: GpuProgram;
  readonly primitive: "points" | "lines" | "line_strip" | "triangles" | "triangle_strip";
  readonly count: number;
  readonly instances?: number;
  readonly uniforms: Readonly<Record<string, UniformValue>>;
  readonly attributes: Readonly<Record<string, GpuBuffer | AttributeSpec>>;
  readonly elements?: GpuBuffer;
}
