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

interface DrawProps {
  readonly count: number;
  readonly instances: number;
  readonly attributes: Readonly<Record<string, AttributeState>>;
  readonly uniforms: Readonly<Record<string, UniformValue>>;
}

function toReglContext(gl: WebGL2RenderingContext): WebGLRenderingContext {
  // regl's public types accept WebGLRenderingContext even though regl can run on WebGL2 contexts.
  return gl as unknown as WebGLRenderingContext;
}

interface ScissorProps {
  scissorEnable?: boolean;
  scissorBox?: { x: number; y: number; width: number; height: number };
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

export class ReglBackend implements GpuBackend {
  private gl: WebGL2RenderingContext;
  private regl: Regl;
  private resources: WebGL2Resources;
  private nextProgramId: number = 1;
  private commandCache: Map<string, DrawCommand> = new Map();
  private scissorBox: { x: number; y: number; w: number; h: number } | null = null;
  readonly capabilities: GpuBackend["capabilities"];

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
      throw new WebGL2UnavailableError();
    }

    this.gl = gl;
    this.regl = createRegl({
      gl: toReglContext(this.gl),
      extensions: [],
      optionalExtensions: [
        "angle_instanced_arrays",
        "ext_disjoint_timer_query_webgl2",
      ],
    });

    this.capabilities = {
      instancing: this.regl.hasExtension("angle_instanced_arrays"),
    };

    this.resources = new WebGL2Resources(this.regl);
    this.resources.preAllocate();
  }

  createBuffer(spec: BufferSpec): GpuBuffer {
    const { buffer } = this.resources.acquire(spec.length, spec.usage);
    return {
      kind: "buffer",
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
      kind: "program",
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
    const key = [program.id, spec.primitive, attributeNames.join(","), uniformNames.join(","), spec.instances === undefined ? 0 : 1].join("|");
    let command = this.commandCache.get(key);

    if (!command) {
      command = this.createDrawCommand(program, spec.primitive, attributeNames, uniformNames, spec.instances !== undefined);
      this.commandCache.set(key, command);
    }

    const attributes: Record<string, AttributeState> = {};
    for (const name of attributeNames) {
      attributes[name] = this.resolveAttribute(spec.attributes[name]!);
    }

    const props: DrawProps & ScissorProps = {
      count: spec.count,
      instances: spec.instances ?? 0,
      attributes,
      uniforms: spec.uniforms,
    };

    if (this.scissorBox) {
      props.scissorEnable = true;
      props.scissorBox = {
        x: this.scissorBox.x,
        y: this.scissorBox.y,
        width: this.scissorBox.w,
        height: this.scissorBox.h,
      };
    }

    command(props);
  }

  dispose(resource: GpuResource): void {
    if (this.isReglBuffer(resource)) {
      this.resources.release(resource.buffer);
    }
  }

  clear(r: number, g: number, b: number, a: number): void {
    this.regl.clear({ color: [r, g, b, a] });
  }

  viewport(x: number, y: number, w: number, h: number): void {
    // This backend's viewport API intentionally maps to a scissor box for plot clipping,
    // but regl must still be polled after canvas resizes so its full-drawing-buffer GL
    // viewport matches the new backing store. Otherwise WebGL content is rasterized with
    // stale dimensions while DOM hover markers use the current CSS rect.
    this.regl.poll();
    this.scissorBox = { x, y, w, h };
  }

  getContext(): WebGL2RenderingContext {
    return this.gl;
  }

  destroy(): void {
    this.resources.destroy();
    this.regl.destroy();
  }

  private createDrawCommand(
    program: ReglGpuProgram,
    primitive: DrawSpec["primitive"],
    attributeNames: readonly string[],
    uniformNames: readonly string[],
    instanced: boolean,
  ): DrawCommand {
    const attributes: Record<string, (context: object, props: DrawProps) => AttributeState> = {};
    for (const name of attributeNames) {
      attributes[name] = (_context, props) => props.attributes[name]!;
    }

    const uniforms: Record<string, (context: object, props: DrawProps) => Uniform> = {};
    for (const name of uniformNames) {
      uniforms[name] = (_context, props) => props.uniforms[name] as Uniform;
    }

    return this.regl({
      vert: program.vert,
      frag: program.frag,
      attributes,
      uniforms,
      primitive: this.toReglPrimitive(primitive),
      count: (_context: object, props: DrawProps) => props.count,
      instances: instanced ? (_context: object, props: DrawProps) => props.instances : undefined,
      depth: { enable: false },
      scissor: {
        enable: (_context: object, props: DrawProps & ScissorProps) => props.scissorEnable ?? false,
        box: (_context: object, props: DrawProps & ScissorProps) =>
          props.scissorBox ?? { x: 0, y: 0, width: 0, height: 0 },
      },
    });
  }

  private resolveAttribute(attribute: GpuBuffer | AttributeSpec): AttributeState {
    if ("divisor" in attribute) {
      return {
        buffer: this.asReglBuffer(attribute.buffer).buffer,
        divisor: attribute.divisor,
        stride: attribute.stride,
        offset: attribute.offset,
        size: attribute.size,
      } as AttributeState;
    }

    return this.asReglBuffer(attribute).buffer;
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
