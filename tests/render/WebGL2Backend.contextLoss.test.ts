import { describe, expect, it } from "bun:test";
import type { DrawCommand } from "../../src/render/webgl2/types.ts";
import { setupFakeGl } from "./fakeGl.ts";

const base = { first: 0, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, color: [1, 1, 1, 1] } as const;
const commands: DrawCommand[] = [
  { ...base, kind: "solid", primitive: "lines", count: 4 },
  { ...base, kind: "thickLine", segments: 3, layout: "strip", lineWidth: 3, canvasWidth: 100, canvasHeight: 100 },
  { ...base, kind: "point", instances: 2, pointSize: 4, canvasWidth: 100, canvasHeight: 100 },
  { ...base, kind: "bar", instances: 2, barWidth: 1, baseline: 0 },
];
const stream = new Float32Array(64);

describe("WebGL2Backend context loss", () => {
  it("deletes its objects normally when the context is healthy", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    b.submit(stream, 64, commands);
    b.destroy();
    expect(gl.invalidDeletes).toEqual([]);
    expect(gl.validDeletes).toContain("buffer");
    expect(gl.validDeletes).toContain("program");
    expect(gl.validDeletes).toContain("vertexArray");
  });

  it("enables premultiplied-alpha blending and re-applies it after a context restore", () => {
    const { gl, backend, fireLost, restore } = setupFakeGl();
    const b = backend();
    const expected = [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    expect(gl.enabled.has(gl.BLEND)).toBe(true);
    expect(gl.blendFunc).toEqual(expected);

    fireLost();
    restore();
    expect(gl.enabled.has(gl.BLEND)).toBe(false);
    b.clear(0, 0, 0, 0);
    expect(gl.enabled.has(gl.BLEND)).toBe(true);
    expect(gl.blendFunc).toEqual(expected);
  });

  it("does not delete objects from a lost context after it is restored", () => {
    const { gl, backend, fireLost, restore } = setupFakeGl();
    const old = backend();
    old.submit(stream, 64, commands);

    fireLost();
    restore();
    const next = backend();
    next.submit(stream, 64, commands);

    old.destroy();
    expect(gl.invalidDeletes).toEqual([]);

    next.destroy();
    expect(gl.invalidDeletes).toEqual([]);
    expect(gl.validDeletes).toContain("buffer");
  });

  it("stops listening for context loss once destroyed", () => {
    const { backend, fireLost, restore } = setupFakeGl();
    const b = backend();
    b.destroy();
    fireLost();
    restore();
    expect(() => b.destroy()).not.toThrow();
  });
});

describe("WebGL2Backend frame submission", () => {
  it("uploads the stream once per frame regardless of how many draws it carries", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    b.submit(stream, 64, commands);
    const warmBufferData = gl.count("bufferData");

    const many: DrawCommand[] = [];
    for (let i = 0; i < 500; i++) many.push(commands[i % commands.length]!);
    const before = gl.count("bufferData");
    b.submit(stream, 64, many);

    expect(gl.count("bufferData") - before).toBe(1);
    expect(gl.count("bufferSubData")).toBe(0);
    expect(gl.count("drawArrays") + gl.count("drawArraysInstanced")).toBe(commands.length + many.length);
    expect(warmBufferData).toBeGreaterThanOrEqual(1);
    b.destroy();
  });

  it("skips empty frames without touching the stream buffer", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    b.submit(stream, 0, commands);
    b.submit(stream, 64, []);
    expect(gl.count("bufferData")).toBe(0);
    b.destroy();
  });
});
