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

export interface GpuCapabilities {
  readonly instancing: boolean;
}

export interface BufferSpec {
  readonly usage: "static" | "dynamic" | "stream";
  readonly type: "float" | "element";
  readonly length: number;
}

export interface GpuBuffer {
  readonly length: number;
  readonly type: BufferSpec["type"];
}

export interface GpuProgram {}

export type GpuResource = GpuBuffer | GpuProgram;

export type UniformValue = number | boolean | readonly number[] | Float32Array;

export interface AttributeSpec {
  readonly buffer: GpuBuffer;
  readonly divisor: number;
  readonly stride?: number;
  readonly offset?: number;
  readonly size?: number;
}

export interface DrawSpec {
  readonly program: GpuProgram;
  readonly primitive: "points" | "lines" | "line_strip" | "triangles" | "triangle_strip";
  readonly count: number;
  readonly instances?: number;
  readonly uniforms: Readonly<Record<string, UniformValue>>;
  readonly attributes: Readonly<Record<string, GpuBuffer | AttributeSpec>>;
  readonly elements?: GpuBuffer;
}
