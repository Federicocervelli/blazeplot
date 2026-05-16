import createRegl from "regl";
import type { AttributeState, Buffer as ReglBuffer, DrawCommand, PrimitiveType, Regl, Uniform } from "regl";
import type { GpuBackend, GpuBuffer, GpuProgram, GpuResource, BufferSpec, DrawSpec, AttributeSpec, UniformValue } from "./types.js";
import { WebGL2Resources } from "./WebGL2Resources.js";

type ReglGpuBuffer = GpuBuffer & {
  readonly buffer: ReglBuffer;
};

type ReglGpuProgram = GpuProgram & {
  readonly id: number;
  readonly vert: string;
  readonly frag: string;
};

interface ResolvedAttribute {
  buffer: ReglBuffer;
  divisor?: number;
  stride?: number;
  offset?: number;
}

interface DrawProps {
  readonly count: number;
  readonly instances: number;
  readonly attributes: Readonly<Record<string, ResolvedAttribute | ReglBuffer>>;
  readonly uniforms: Readonly<Record<string, UniformValue>>;
}

function toReglContext(gl: WebGL2RenderingContext): WebGLRenderingContext {
  return gl as unknown as WebGLRenderingContext;
}

export class ReglBackend implements GpuBackend {
  private gl: WebGL2RenderingContext;
  private regl: Regl;
  private resources: WebGL2Resources;
  private nextProgramId: number = 1;
  private commandCache: Map<string, DrawCommand> = new Map();

  constructor(canvas: HTMLCanvasElement) {
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
      throw new Error("BlazePlot requires WebGL2, but this browser/context does not support it.");
    }

    this.gl = gl;
    this.regl = createRegl({
      gl: toReglContext(this.gl),
      extensions: [],
      optionalExtensions: [
        "ext_disjoint_timer_query_webgl2",
      ],
    });

    this.resources = new WebGL2Resources(this.regl);
    this.resources.preAllocate();
  }

  createBuffer(spec: BufferSpec): GpuBuffer {
    const { buffer } = this.resources.acquire(spec.length, spec.usage);
    return {
      length: spec.length,
      type: spec.type,
      buffer,
    } as ReglGpuBuffer;
  }

  updateBuffer(buffer: GpuBuffer, data: Float32Array | Uint16Array, offset: number = 0): void {
    if (data.length + offset > buffer.length) {
      throw new RangeError("GPU buffer update exceeds allocated buffer length.");
    }

    const bytesPerElement = buffer.type === "float" ? 4 : 2;
    this.asReglBuffer(buffer).buffer.subdata(data, offset * bytesPerElement);
  }

  createProgram(vert: string, frag: string): GpuProgram {
    return {
      id: this.nextProgramId++,
      vert,
      frag,
    } as ReglGpuProgram;
  }

  draw(spec: DrawSpec): void {
    if (spec.count <= 0) return;

    const program = this.asReglProgram(spec.program);
    const attributeNames = Object.keys(spec.attributes).sort();
    const uniformNames = Object.keys(spec.uniforms).sort();
    const key = this.buildCacheKey(program, spec, attributeNames, uniformNames);
    let command = this.commandCache.get(key);

    if (!command) {
      command = this.createDrawCommand(program, spec, attributeNames, uniformNames);
      this.commandCache.set(key, command);
    }

    const attributes: Record<string, ResolvedAttribute | ReglBuffer> = {};
    for (const name of attributeNames) {
      attributes[name] = this.resolveAttribute(spec, name);
    }

    command({
      count: spec.count,
      instances: spec.instances ?? 0,
      attributes,
      uniforms: spec.uniforms,
    });
  }

  dispose(resource: GpuResource): void {
    if (this.isReglBuffer(resource)) {
      this.resources.release(resource.buffer);
    }
  }

  clear(r: number, g: number, b: number, a: number): void {
    this.regl.clear({ color: [r, g, b, a] });
  }

  viewport(_x: number, _y: number, _w: number, _h: number): void {
    // Handled by regl internally via canvas size
  }

  destroy(): void {
    this.resources.destroy();
    this.regl.destroy();
  }

  private buildCacheKey(
    program: ReglGpuProgram,
    spec: DrawSpec,
    attributeNames: readonly string[],
    uniformNames: readonly string[],
  ): string {
    const parts = [String(program.id), spec.primitive];
    for (const name of attributeNames) {
      const attr = spec.attributes[name]!;
      parts.push("divisor" in attr ? `${name}:i${(attr as AttributeSpec).divisor}` : name);
    }
    parts.push(uniformNames.join(","));
    parts.push(spec.instances !== undefined ? "1" : "0");
    return parts.join("|");
  }

  private createDrawCommand(
    program: ReglGpuProgram,
    spec: DrawSpec,
    attributeNames: readonly string[],
    uniformNames: readonly string[],
  ): DrawCommand {
    const attributes: Record<string, (context: object, props: DrawProps) => AttributeState> = {};
    for (const name of attributeNames) {
      attributes[name] = (_context, props) => props.attributes[name]! as ReglBuffer;
    }

    const uniforms: Record<string, (context: object, props: DrawProps) => Uniform> = {};
    for (const name of uniformNames) {
      uniforms[name] = (_context, props) => props.uniforms[name] as Uniform;
    }

    const instanced = spec.instances !== undefined;

    const command = this.regl({
      vert: program.vert,
      frag: program.frag,
      attributes,
      uniforms,
      primitive: this.toReglPrimitive(spec.primitive),
      count: (_context: object, props: DrawProps) => props.count,
      instances: instanced ? (_context: object, props: DrawProps) => props.instances : undefined,
      depth: { enable: false },
    });

    return command;
  }

  private resolveAttribute(spec: DrawSpec, name: string): ResolvedAttribute | ReglBuffer {
    const attr = spec.attributes[name]!;
    if ("divisor" in attr) {
      const inst = attr as AttributeSpec;
      return {
        buffer: this.asReglBuffer(inst.buffer).buffer,
        divisor: inst.divisor,
        stride: inst.stride,
        offset: inst.offset,
      };
    }
    return this.asReglBuffer(attr).buffer;
  }

  private asReglBuffer(buffer: GpuBuffer): ReglGpuBuffer {
    return buffer as ReglGpuBuffer;
  }

  private asReglProgram(program: GpuProgram): ReglGpuProgram {
    return program as ReglGpuProgram;
  }

  private isReglBuffer(resource: GpuResource): resource is ReglGpuBuffer {
    return "length" in resource && "type" in resource && "buffer" in resource;
  }

  private toReglPrimitive(primitive: DrawSpec["primitive"]): PrimitiveType {
    switch (primitive) {
      case "line_strip":
        return "line strip";
      case "triangle_strip":
        return "triangle strip";
      default:
        return primitive;
    }
  }
}
