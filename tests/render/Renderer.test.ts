import { describe, expect, it } from "bun:test";
import { Renderer } from "../../src/render/Renderer.ts";
import { testStyle } from "../helpers.ts";
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
  const projection = { scaleX: 2, scaleY: 3, offsetX: -1, offsetY: 1 };

  it("lazily creates programs and shares static quad corners through the backend contract", () => {
    const { renderer, backend, positions } = makeRenderer();
    expect(backend.programs).toHaveLength(0);
    expect(backend.createdBuffers).toEqual([{ usage: "stream", type: "float", length: 16 }]);

    renderer.drawBarsInstanced(positions, 3, testStyle(), projection);
    renderer.drawBarsInstanced(positions, 3, testStyle(), projection);

    expect(backend.programs).toHaveLength(1);
    expect(backend.createdBuffers.filter((spec) => spec.usage === "static")).toHaveLength(1);
    expect(Array.from(backend.updates.at(-1)!.data)).toEqual([-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1]);
  });

  it("begins frames with a viewport and transparent clear, and delegates updates and dispose", () => {
    const { renderer, backend, positions } = makeRenderer();

    renderer.beginFrame(300, 200, 2);
    renderer.updateFloatBuffer(positions, new Float32Array([1, 2, 3, 4]), 2);
    renderer.dispose();

    expect(backend.viewports).toEqual([[0, 0, 300, 200]]);
    expect(backend.clears).toEqual([[0, 0, 0, 0]]);
    expect(Array.from(backend.updates.at(-1)!.data)).toEqual([1, 2]);
    expect(backend.destroyed).toBe(true);
  });

  it("draws hairlines natively and area fills as triangle strips", () => {
    const { renderer, backend, positions } = makeRenderer();
    renderer.beginFrame(800, 400, 1);

    renderer.drawLines(positions, 6, [1, 0, 0, 1], 1, projection);
    renderer.drawTriangles(positions, 8, [0, 1, 0, 0.5], projection, "triangle_strip");

    expect(backend.draws.at(-2)).toMatchObject({ primitive: "line_strip", count: 6, attributes: { position: positions } });
    expect(Array.from(backend.draws.at(-2)!.uniforms.uScale as Float32Array)).toEqual([2, 3]);
    expect(backend.draws.at(-1)).toMatchObject({ primitive: "triangle_strip", count: 8 });
    expect(backend.draws.at(-1)!.uniforms.uColor).toEqual([0, 1, 0, 0.5]);
  });

  it("expands wide lines into instanced quads sized in device pixels", () => {
    const { renderer, backend, positions } = makeRenderer(true);
    renderer.beginFrame(800, 400, 2);

    renderer.drawLines(positions, 6, [1, 1, 0, 1], 1.5, projection);
    const strip = backend.draws.at(-1)!;
    expect(strip).toMatchObject({ primitive: "triangle_strip", count: 4, instances: 5 });
    expect(strip.attributes.aStart).toMatchObject({ buffer: positions, divisor: 1, stride: 8, offset: 0 });
    expect(strip.attributes.aEnd).toMatchObject({ buffer: positions, divisor: 1, stride: 8, offset: 8 });
    expect(strip.uniforms.uLineWidth).toBe(3);
    expect(Array.from(strip.uniforms.uCanvasSize as Float32Array)).toEqual([800, 400]);

    renderer.drawLines(positions, 6, [1, 1, 0, 1], 2, projection, "lines");
    expect(backend.draws.at(-1)).toMatchObject({ instances: 3, attributes: { aStart: { stride: 16 }, aEnd: { stride: 16 } } });
  });

  it("falls back to native lines and point sprites without instancing", () => {
    const { renderer, backend, positions } = makeRenderer(false);
    renderer.beginFrame(640, 480, 2);

    renderer.drawLines(positions, 4, [1, 1, 1, 1], 3, projection);
    renderer.drawPoints(positions, 10, [1, 1, 1, 1], 7, projection);

    expect(backend.draws.at(-2)).toMatchObject({ primitive: "line_strip", count: 4 });
    expect(backend.draws.at(-1)).toMatchObject({ primitive: "points", count: 10, attributes: { aPosition: positions } });
    expect(backend.draws.at(-1)!.instances).toBeUndefined();
  });

  it("treats pointSize as a CSS-pixel diameter on both point paths", () => {
    for (const instancing of [true, false]) {
      const { renderer, backend, positions } = makeRenderer(instancing);
      renderer.beginFrame(1280, 960, 2);
      renderer.drawPoints(positions, 10, [0, 0, 1, 1], 6, projection);
      expect(backend.draws.at(-1)!.uniforms.uPointSize).toBe(12);
    }
  });

  it("offsets the instanced bar baseline by the Y origin", () => {
    const { renderer, backend, positions } = makeRenderer(true);
    renderer.beginFrame(640, 480, 1);
    renderer.drawBarsInstanced(positions, 5, testStyle({ barWidth: 0.4, baseline: 1_000_000 }), projection, 999_990);
    expect(backend.draws.at(-1)!.uniforms.uBaseline).toBe(10);
  });

  it("uses instanced quads for points and bars when supported", () => {
    const { renderer, backend, positions } = makeRenderer(true);
    renderer.beginFrame(640, 480, 1);

    renderer.drawPoints(positions, 10, [0, 0, 1, 1], 7, projection);
    renderer.drawBarsInstanced(positions, 5, testStyle({ barWidth: 0.4, baseline: -1 }), projection);

    expect(backend.draws.at(-2)).toMatchObject({ primitive: "triangle_strip", count: 4, instances: 10 });
    expect(backend.draws.at(-2)!.uniforms.uPointSize).toBe(7);
    expect(Array.from(backend.draws.at(-2)!.uniforms.uCanvasSize as Float32Array)).toEqual([640, 480]);
    expect(backend.draws.at(-1)).toMatchObject({ instances: 5, uniforms: { uBarWidth: 0.4, uBaseline: -1 } });
  });
});
