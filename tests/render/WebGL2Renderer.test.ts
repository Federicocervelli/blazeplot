import { describe, expect, it } from "bun:test";
import { WebGL2Renderer } from "../../src/render/webgl2/WebGL2Renderer.ts";
import { testStyle } from "../helpers.ts";
import type { DrawCommand, GpuBackend } from "../../src/render/webgl2/types.ts";

class MockBackend implements GpuBackend {
  readonly submits: Array<{ stream: Float32Array; floatCount: number; commands: readonly DrawCommand[] }> = [];
  readonly clears: Array<readonly [number, number, number, number]> = [];
  readonly viewports: Array<readonly [number, number, number, number]> = [];
  destroyed = false;

  submit(stream: Float32Array, floatCount: number, commands: readonly DrawCommand[]): void {
    this.submits.push({ stream: stream.slice(0, floatCount), floatCount, commands: [...commands] });
  }

  clear(r: number, g: number, b: number, a: number): void {
    this.clears.push([r, g, b, a]);
  }

  viewport(x: number, y: number, w: number, h: number): void {
    this.viewports.push([x, y, w, h]);
  }

  destroy(): void {
    this.destroyed = true;
  }

  get commands(): readonly DrawCommand[] {
    return this.submits.flatMap((submit) => submit.commands);
  }
}

function makeRenderer(): { renderer: WebGL2Renderer; backend: MockBackend } {
  const backend = new MockBackend();
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  return { renderer: new WebGL2Renderer(canvas, () => backend), backend };
}

const positions = new Float32Array([0, 0, 1, 1, 2, 0, 3, 1, 4, 0, 5, 1, 6, 0, 7, 1]);

describe("WebGL2Renderer", () => {
  const projection = { scaleX: 2, scaleY: 3, offsetX: -1, offsetY: 1 };

  it("begins frames with a viewport and transparent clear, and destroys the backend on dispose", () => {
    const { renderer, backend } = makeRenderer();

    renderer.beginFrame(300, 200, 2);
    renderer.dispose();

    expect(backend.viewports).toEqual([[0, 0, 300, 200]]);
    expect(backend.clears).toEqual([[0, 0, 0, 0]]);
    expect(backend.destroyed).toBe(true);
  });

  it("records draws and submits the whole frame in one call", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(800, 400, 1);

    renderer.drawLines(positions, 4, [1, 0, 0, 1], 1, projection);
    renderer.drawTriangles(positions, 8, [0, 1, 0, 0.5], projection, "triangle_strip");
    renderer.drawPoints(positions, 3, [0, 0, 1, 1], 5, projection);
    expect(backend.submits).toHaveLength(0);
    renderer.endFrame();

    expect(backend.submits).toHaveLength(1);
    const { commands, floatCount, stream } = backend.submits[0]!;
    expect(floatCount).toBe((4 + 8 + 3) * 2);
    expect(Array.from(stream.subarray(0, 8))).toEqual([0, 0, 1, 1, 2, 0, 3, 1]);
    expect(commands.map((c) => c.first)).toEqual([0, 4, 12]);
  });

  it("does not submit empty frames", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(800, 400, 1);
    renderer.drawLines(positions, 0, [1, 1, 1, 1], 1, projection);
    renderer.endFrame();
    expect(backend.submits).toHaveLength(0);
  });

  it("draws hairlines natively and area fills as triangle strips", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(800, 400, 1);

    renderer.drawLines(positions, 6, [1, 0, 0, 1], 1, projection);
    renderer.drawTriangles(positions, 8, [0, 1, 0, 0.5], projection, "triangle_strip");
    renderer.endFrame();

    expect(backend.commands[0]).toMatchObject({ kind: "solid", primitive: "line_strip", count: 6, scaleX: 2, scaleY: 3, offsetX: -1, offsetY: 1, color: [1, 0, 0, 1] });
    expect(backend.commands[1]).toMatchObject({ kind: "solid", primitive: "triangle_strip", count: 8, color: [0, 1, 0, 0.5] });
  });

  it("draws clip-space lines with an identity projection", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(800, 400, 1);
    renderer.drawClipLines(positions, 4, [0.5, 0.5, 0.5, 1]);
    renderer.endFrame();
    expect(backend.commands[0]).toMatchObject({ kind: "solid", primitive: "lines", count: 4, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
  });

  it("expands wide lines into instanced quads sized in device pixels", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(800, 400, 2);

    renderer.drawLines(positions, 6, [1, 1, 0, 1], 1.5, projection);
    renderer.drawLines(positions, 6, [1, 1, 0, 1], 2, projection, "lines");
    renderer.endFrame();

    expect(backend.commands[0]).toMatchObject({ kind: "thickLine", layout: "strip", segments: 5, lineWidth: 3, canvasWidth: 800, canvasHeight: 400 });
    expect(backend.commands[1]).toMatchObject({ kind: "thickLine", layout: "pairs", segments: 3, lineWidth: 4 });
  });

  it("uses instanced quads for points and bars", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(640, 480, 1);

    renderer.drawPoints(positions, 5, [0, 0, 1, 1], 7, projection);
    renderer.drawBarsInstanced(positions, 5, testStyle({ barWidth: 0.4, baseline: -1 }), projection);
    renderer.endFrame();

    expect(backend.commands[0]).toMatchObject({ kind: "point", instances: 5, pointSize: 7, canvasWidth: 640, canvasHeight: 480 });
    expect(backend.commands[1]).toMatchObject({ kind: "bar", instances: 5, barWidth: 0.4, baseline: -1, first: 5 });
  });

  it("treats pointSize as a CSS-pixel diameter", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(1280, 960, 2);
    renderer.drawPoints(positions, 5, [0, 0, 1, 1], 6, projection);
    renderer.endFrame();
    expect(backend.commands[0]).toMatchObject({ kind: "point", pointSize: 12 });
  });

  it("offsets the instanced bar baseline by the Y origin", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(640, 480, 1);
    renderer.drawBarsInstanced(positions, 5, testStyle({ barWidth: 0.4, baseline: 1_000_000 }), projection, 999_990);
    renderer.endFrame();
    expect(backend.commands[0]).toMatchObject({ kind: "bar", baseline: 10 });
  });

  it("grows the frame stream while keeping earlier draws intact", () => {
    const { renderer, backend } = makeRenderer();
    renderer.beginFrame(640, 480, 1);
    const big = new Float32Array(200_000).fill(3);
    renderer.drawTriangles(positions, 8, [1, 1, 1, 1], projection);
    renderer.drawTriangles(big, 100_000, [1, 1, 1, 1], projection);
    renderer.endFrame();

    const { stream, floatCount } = backend.submits[0]!;
    expect(floatCount).toBe(16 + 200_000);
    expect(Array.from(stream.subarray(0, 4))).toEqual([0, 0, 1, 1]);
    expect(stream[16]).toBe(3);
    expect(backend.commands[1]!.first).toBe(8);
  });

  it("starts each frame from an empty stream", () => {
    const { renderer, backend } = makeRenderer();
    for (let frame = 0; frame < 2; frame++) {
      renderer.beginFrame(640, 480, 1);
      renderer.drawTriangles(positions, 8, [1, 1, 1, 1], projection);
      renderer.endFrame();
    }
    expect(backend.submits.map((s) => s.floatCount)).toEqual([16, 16]);
    expect(backend.submits[1]!.commands[0]!.first).toBe(0);
  });
});
