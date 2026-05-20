import { describe, expect, it } from "bun:test";
import { Renderer } from "../../src/render/Renderer.ts";
import type { BufferSpec, DrawSpec, GpuBackend, GpuBuffer, GpuCapabilities, GpuProgram, GpuResource } from "../../src/render/types.ts";

class MockBackend implements GpuBackend {
  readonly capabilities: GpuCapabilities;
  readonly createdBuffers: BufferSpec[] = [];
  readonly updates: Array<{ buffer: GpuBuffer; data: Float32Array | Uint16Array; offset?: number }> = [];
  readonly programs: Array<{ vert: string; frag: string }> = [];
  readonly draws: DrawSpec[] = [];
  readonly clears: Array<readonly [number, number, number, number]> = [];
  readonly viewports: Array<readonly [number, number, number, number]> = [];
  destroyed = false;
  private nextBufferId = 1;
  private nextProgramId = 1;

  constructor(instancing: boolean = true) {
    this.capabilities = { instancing };
  }

  createBuffer(spec: BufferSpec): GpuBuffer {
    this.createdBuffers.push(spec);
    return { kind: "buffer", length: spec.length, type: spec.type, id: this.nextBufferId++ } as GpuBuffer;
  }

  updateBuffer(buffer: GpuBuffer, data: Float32Array | Uint16Array, offset?: number): void {
    this.updates.push({ buffer, data, offset });
  }

  createProgram(vert: string, frag: string): GpuProgram {
    this.programs.push({ vert, frag });
    return { kind: "program", id: this.nextProgramId++ } as GpuProgram;
  }

  draw(spec: DrawSpec): void {
    this.draws.push(spec);
  }

  dispose(_resource: GpuResource): void {}

  clear(r: number, g: number, b: number, a: number): void {
    this.clears.push([r, g, b, a]);
  }

  viewport(x: number, y: number, w: number, h: number): void {
    this.viewports.push([x, y, w, h]);
  }

  getContext(): WebGL2RenderingContext | null {
    return null;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function makeRenderer(instancing: boolean = true): { renderer: Renderer; backend: MockBackend; positions: GpuBuffer } {
  const backend = new MockBackend(instancing);
  const renderer = new Renderer(backend);
  const positions = renderer.createFloatBuffer(16);
  return { renderer, backend, positions };
}

describe("Renderer", () => {
  it("initializes shader programs and static geometry buffers through the backend contract", () => {
    const { backend } = makeRenderer();

    expect(backend.programs).toHaveLength(6);
    expect(backend.createdBuffers.slice(0, 3)).toEqual([
      { usage: "static", type: "float", length: 2 },
      { usage: "static", type: "float", length: 8 },
      { usage: "static", type: "float", length: 8 },
    ]);
    expect(Array.from(backend.updates[0]!.data)).toEqual([0, 1]);
    expect(Array.from(backend.updates[1]!.data)).toEqual([-1, -1, 1, -1, -1, 1, 1, 1]);
    expect(Array.from(backend.updates[2]!.data)).toEqual([-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1]);
  });

  it("delegates clear, viewport, buffer updates, and dispose", () => {
    const { renderer, backend, positions } = makeRenderer();

    renderer.clear(0.1, 0.2, 0.3, 1);
    renderer.viewport(1, 2, 300, 200);
    renderer.updateFloatBuffer(positions, new Float32Array([1, 2, 3, 4]), 2);
    renderer.dispose();

    expect(backend.clears).toEqual([[0.1, 0.2, 0.3, 1]]);
    expect(backend.viewports).toEqual([[1, 2, 300, 200]]);
    expect(Array.from(backend.updates.at(-1)!.data)).toEqual([1, 2]);
    expect(backend.destroyed).toBe(true);
  });

  it("emits line and area draw specs with projection uniforms", () => {
    const { renderer, backend, positions } = makeRenderer();
    const projection = { scaleX: 2, scaleY: 3, offsetX: -1, offsetY: 1 };
    const style = { color: [1, 0, 0, 1] as const, lineWidth: 1 };

    renderer.drawLines(positions, 6, style, projection);
    renderer.drawAreaStrip(positions, 8, { ...style, fillColor: [0, 1, 0, 0.5] }, projection);

    expect(backend.draws.at(-2)).toMatchObject({ primitive: "lines", count: 6, attributes: { position: positions } });
    expect(backend.draws.at(-2)!.uniforms.uScale).toBeInstanceOf(Float32Array);
    expect(Array.from(backend.draws.at(-2)!.uniforms.uScale as Float32Array)).toEqual([2, 3]);
    expect(backend.draws.at(-1)).toMatchObject({ primitive: "triangle_strip", count: 8, attributes: { position: positions } });
    expect(backend.draws.at(-1)!.uniforms.uColor).toEqual([0, 1, 0, 0.5]);
  });

  it("uses instanced draw specs for points and bars when supported", () => {
    const { renderer, backend, positions } = makeRenderer(true);
    const style = { color: [0, 0, 1, 1] as const, lineWidth: 1, pointSize: 7, barWidth: 0.4, baseline: -1 };
    const projection = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

    renderer.drawPoints(positions, 10, style, projection, 640, 480);
    renderer.drawBarsInstanced(positions, 5, style, projection, 800, 600);

    expect(backend.draws.at(-2)).toMatchObject({ primitive: "triangle_strip", count: 4, instances: 10 });
    expect(backend.draws.at(-2)!.attributes.aPosition).toMatchObject({ buffer: positions, divisor: 1, stride: 8, offset: 0, size: 2 });
    expect(backend.draws.at(-2)!.uniforms.uCanvasSize).toBeInstanceOf(Float32Array);
    expect(backend.draws.at(-1)).toMatchObject({ primitive: "triangle_strip", count: 4, instances: 5 });
    expect(backend.draws.at(-1)!.attributes.aPosition).toMatchObject({ buffer: positions, divisor: 1, stride: 8, offset: 0, size: 2 });
    expect(Array.from(backend.draws.at(-1)!.uniforms.uCanvasSize as Float32Array)).toEqual([800, 600]);
  });

  it("falls back to point sprites when instancing is unavailable", () => {
    const { renderer, backend, positions } = makeRenderer(false);

    renderer.drawPoints(positions, 10, { color: [1, 1, 1, 1], lineWidth: 1 }, { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, 640, 480);

    expect(backend.draws.at(-1)).toMatchObject({ primitive: "points", count: 10, attributes: { aPosition: positions } });
    expect(backend.draws.at(-1)!.instances).toBeUndefined();
  });
});
