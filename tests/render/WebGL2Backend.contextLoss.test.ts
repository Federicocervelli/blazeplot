import { describe, expect, it } from "bun:test";
import type { DrawCommand } from "../../src/render/webgl2/types.ts";
import { SegmentSet } from "../../src/render/SegmentSet.ts";
import { setupFakeGl } from "./fakeGl.ts";

const base = { first: 0, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, color: [1, 1, 1, 1] } as const;
const commands: DrawCommand[] = [
  { ...base, kind: "solid", primitive: "lines", count: 4 },
  { ...base, kind: "thickLine", segments: 3, layout: "strip", lineWidth: 3, canvasWidth: 100, canvasHeight: 100 },
  { ...base, kind: "point", instances: 2, pointSize: 4, canvasWidth: 100, canvasHeight: 100 },
  { ...base, kind: "bar", instances: 2, barWidth: 1, baseline: 0 },
  { kind: "rects", first: 0, instances: 2, canvasWidth: 100, canvasHeight: 100 },
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

  it("ignores context loss while detached, then reports a loss-and-restore that happened meanwhile", () => {
    const { gl, backend, fireLost, restore } = setupFakeGl();
    const b = backend();
    b.detachCanvasListeners();
    fireLost();
    restore();
    // The restored context holds none of this backend's objects, and nothing saw the loss event.
    expect(b.attachCanvasListeners()).toBe(false);
    b.destroy();
    expect(gl.invalidDeletes).toEqual([]);
  });

  it("listens for context loss again after being re-attached", () => {
    const { gl, backend, fireLost, restore } = setupFakeGl();
    const b = backend();
    b.detachCanvasListeners();
    expect(b.attachCanvasListeners()).toBe(true);
    fireLost();
    restore();
    b.destroy();
    expect(gl.invalidDeletes).toEqual([]);
    expect(gl.validDeletes).toEqual([]);
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

describe("WebGL2Backend program building", () => {
  it("starts prepared programs before any draw and does not compile them again when they are drawn", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    b.prepare(["line", "point"]);
    // Two programs, two shaders each, issued without any draw.
    expect(gl.count("linkProgram")).toBe(2);
    expect(gl.count("compileShader")).toBe(4);
    b.prepare(["line"]);
    expect(gl.count("linkProgram")).toBe(2);

    b.submit(stream, 64, [commands[0]!, commands[2]!]);
    expect(gl.count("linkProgram")).toBe(2);
    b.destroy();
  });

  it("builds an unprepared program on first draw, so correctness does not depend on hints", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    b.submit(stream, 64, commands);
    expect(gl.count("linkProgram")).toBe(commands.length);
    b.destroy();
  });

  it("releases programs that were prepared but never drawn on destroy", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    b.prepare(["thickLine", "bar"]);
    b.destroy();
    expect(gl.validDeletes.filter((kind) => kind === "program")).toHaveLength(2);
    expect(gl.invalidDeletes).toEqual([]);
  });
});

describe("WebGL2Backend segment sets", () => {
  const draw = (set: SegmentSet): DrawCommand => ({ kind: "segmentSet", set, first: 0, count: set.segmentCount, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, stroke: [1, 0, 0], color: [1, 1, 1, 1], canvasWidth: 100, canvasHeight: 100 });
  const makeSet = () => new SegmentSet(new Float32Array([0, 0, 10, 0, 10, 10]), 3, new Uint32Array([0, 1, 1, 2]), 2);

  it("uploads a set once, then only the rows of moved points, and draws without staging a stream", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    const set = makeSet();
    b.submit(stream, 0, [draw(set)]);
    b.submit(stream, 0, [draw(set)]);
    expect(gl.count("texImage2D")).toBe(1);
    expect(gl.count("drawArraysInstanced")).toBe(2);
    // Only the set's own buffer is filled; no frame stream upload.
    expect(gl.count("bufferData")).toBe(2);
    set.setPoints(new Float32Array([5, 5]), 1);
    b.submit(stream, 0, [draw(set)]);
    expect(gl.count("texSubImage2D")).toBe(1);
    expect(gl.count("texImage2D")).toBe(1);
  });

  it("frees a set's GPU copy when the set is disposed, and draws nothing from it after", () => {
    const { gl, backend } = setupFakeGl();
    const b = backend();
    const set = makeSet();
    b.submit(stream, 0, [draw(set)]);
    set.dispose();
    expect(gl.validDeletes.filter((kind) => kind === "texture")).toHaveLength(1);
    expect(gl.validDeletes).toContain("vertexArray");
    b.destroy();
    expect(gl.invalidDeletes).toEqual([]);
  });

  it("drops a set's copy without deleting it after a context loss, and uploads it again on the next backend", () => {
    const { gl, backend, fireLost, restore } = setupFakeGl();
    const first = backend();
    const set = makeSet();
    first.submit(stream, 0, [draw(set)]);
    fireLost();
    first.destroy();
    restore();
    expect(gl.invalidDeletes).toEqual([]);
    const second = backend();
    second.submit(stream, 0, [draw(set)]);
    expect(gl.count("texImage2D")).toBe(2);
    // The first backend no longer listens for the set's disposal.
    set.dispose();
    expect(gl.invalidDeletes).toEqual([]);
  });
});
