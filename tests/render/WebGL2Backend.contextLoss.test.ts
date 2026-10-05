import { describe, expect, it } from "bun:test";
import { WebGL2Backend } from "../../src/render/WebGL2Backend.ts";

/** Fake GL that tags objects with the context generation and flags deletes of stale objects. */
class GenerationGl {
  generation = 1;
  lost = false;
  readonly invalidDeletes: string[] = [];
  readonly validDeletes: string[] = [];
  readonly VERTEX_SHADER = 1;
  readonly FRAGMENT_SHADER = 2;
  readonly COMPILE_STATUS = 3;
  readonly LINK_STATUS = 4;
  readonly ACTIVE_ATTRIBUTES = 5;
  readonly ACTIVE_UNIFORMS = 6;
  readonly ARRAY_BUFFER = 7;
  readonly ELEMENT_ARRAY_BUFFER = 8;
  readonly STATIC_DRAW = 9;
  readonly DYNAMIC_DRAW = 10;
  readonly STREAM_DRAW = 11;
  readonly DEPTH_TEST = 12;
  readonly STENCIL_TEST = 13;
  readonly BLEND = 14;
  readonly ONE = 15;
  readonly ONE_MINUS_SRC_ALPHA = 16;
  readonly SCISSOR_TEST = 17;
  readonly COLOR_BUFFER_BIT = 18;
  /** Capabilities currently enabled; a context restore resets them. */
  readonly enabled = new Set<number>();
  blendFunc: number[] | null = null;

  isContextLost(): boolean { return this.lost; }
  private make(): { gen: number } { return { gen: this.generation }; }
  private del(kind: string, obj: { gen: number }): void {
    if (this.lost) return; // spec: deletes on a lost context are silently ignored
    if (obj.gen !== this.generation) this.invalidDeletes.push(kind);
    else this.validDeletes.push(kind);
  }
  createBuffer(): object { return this.make(); }
  createShader(): object { return this.make(); }
  createProgram(): object { return this.make(); }
  deleteBuffer(o: { gen: number }): void { this.del("buffer", o); }
  deleteShader(o: { gen: number }): void { this.del("shader", o); }
  deleteProgram(o: { gen: number }): void { this.del("program", o); }
  getShaderParameter(): boolean { return true; }
  getProgramParameter(_p: unknown, pname: number): number | boolean { return pname === this.LINK_STATUS ? true : 0; }
  disable(cap: number): void { this.enabled.delete(cap); }
  enable(cap: number): void { this.enabled.add(cap); }
  blendFuncSeparate(...args: number[]): void { this.blendFunc = args; }
  viewport(): void {}
  clearColor(): void {}
  clear(): void {}
  bindBuffer(): void {}
  bufferData(): void {}
  shaderSource(): void {}
  compileShader(): void {}
  attachShader(): void {}
  linkProgram(): void {}
  disableVertexAttribArray(): void {}
  vertexAttribDivisor(): void {}
}

function setup(): { gl: GenerationGl; backend: () => WebGL2Backend; fireLost: () => void } {
  const gl = new GenerationGl();
  const target = new EventTarget();
  const canvas = Object.assign(target, { getContext: () => gl }) as unknown as HTMLCanvasElement;
  return {
    gl,
    backend: () => new WebGL2Backend(canvas),
    fireLost: () => { gl.lost = true; target.dispatchEvent(new Event("webglcontextlost")); },
  };
}

function restore(gl: GenerationGl): void {
  gl.lost = false;
  gl.generation++;
  gl.enabled.clear();
  gl.blendFunc = null;
}

describe("WebGL2Backend context loss", () => {
  it("deletes its objects normally when the context is healthy", () => {
    const { gl, backend } = setup();
    const b = backend();
    b.createBuffer({ length: 16, type: "float", usage: "stream" });
    const program = b.createProgram("v", "f");
    b.dispose(program);
    b.destroy();
    expect(gl.invalidDeletes).toEqual([]);
    expect(gl.validDeletes).toContain("buffer");
    expect(gl.validDeletes).toContain("program");
  });

  it("does not delete objects from a lost context after it is restored", () => {
    const { gl, backend, fireLost } = setup();
    const old = backend();
    const buffer = old.createBuffer({ length: 16, type: "float", usage: "stream" });
    const program = old.createProgram("v", "f");
    old.createProgram("v", "f");

    fireLost();
    restore(gl);
    const next = backend();
    const fresh = next.createBuffer({ length: 16, type: "float", usage: "stream" });

    old.dispose(buffer);
    old.dispose(program);
    old.destroy();
    expect(gl.invalidDeletes).toEqual([]);

    next.dispose(fresh);
    next.destroy();
    expect(gl.invalidDeletes).toEqual([]);
    expect(gl.validDeletes).toContain("buffer");
  });

  it("enables premultiplied-alpha blending and re-applies it after a context restore", () => {
    const { gl, backend, fireLost } = setup();
    const b = backend();
    expect(gl.enabled.has(gl.BLEND)).toBe(true);
    expect(gl.blendFunc).toEqual([gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);

    fireLost();
    restore(gl);
    expect(gl.enabled.has(gl.BLEND)).toBe(false);
    b.clear(0, 0, 0, 0);
    expect(gl.enabled.has(gl.BLEND)).toBe(true);
    expect(gl.blendFunc).toEqual([gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
  });

  it("stops listening for context loss once destroyed", () => {
    const { gl, backend, fireLost } = setup();
    const b = backend();
    b.destroy();
    fireLost();
    restore(gl);
    expect(() => b.destroy()).not.toThrow();
  });
});
