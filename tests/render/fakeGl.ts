import { WebGL2Backend } from "../../src/render/webgl2/WebGL2Backend.ts";

type Tagged = { gen: number };

/**
 * Fake WebGL2 context that tags objects with a context generation (to catch deletes of stale
 * objects) and counts every call by name (to assert on per-frame upload counts).
 */
export class FakeGl {
  generation = 1;
  lost = false;
  readonly invalidDeletes: string[] = [];
  readonly validDeletes: string[] = [];
  readonly calls: Record<string, number> = {};
  readonly VERTEX_SHADER = 1;
  readonly FRAGMENT_SHADER = 2;
  readonly COMPILE_STATUS = 3;
  readonly LINK_STATUS = 4;
  readonly ARRAY_BUFFER = 7;
  readonly STATIC_DRAW = 9;
  readonly STREAM_DRAW = 11;
  readonly DEPTH_TEST = 12;
  readonly STENCIL_TEST = 13;
  readonly FLOAT = 14;
  readonly TRIANGLE_STRIP = 15;
  readonly LINES = 16;
  readonly LINE_STRIP = 17;
  readonly TRIANGLES = 18;
  readonly BLEND = 19;
  readonly ONE = 20;
  readonly ONE_MINUS_SRC_ALPHA = 21;
  /** Capabilities currently enabled; a context restore resets them. */
  readonly enabled = new Set<number>();
  blendFunc: number[] | null = null;

  count(name: string): number {
    return this.calls[name] ?? 0;
  }
  private hit(name: string): void {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
  }
  isContextLost(): boolean {
    return this.lost;
  }
  private make(): Tagged {
    return { gen: this.generation };
  }
  private del(kind: string, obj: Tagged): void {
    if (this.lost) return; // spec: deletes on a lost context are silently ignored
    if (obj.gen !== this.generation) this.invalidDeletes.push(kind);
    else this.validDeletes.push(kind);
  }
  createBuffer(): object { return this.make(); }
  createShader(): object { return this.make(); }
  createProgram(): object { return this.make(); }
  createVertexArray(): object { return this.make(); }
  deleteBuffer(o: Tagged): void { this.del("buffer", o); }
  deleteShader(o: Tagged): void { this.del("shader", o); }
  deleteProgram(o: Tagged): void { this.del("program", o); }
  deleteVertexArray(o: Tagged): void { this.del("vertexArray", o); }
  getShaderParameter(): boolean { return true; }
  getProgramParameter(): boolean { return true; }
  getAttribLocation(_p: unknown, name: string): number { return name.length % 4; }
  getUniformLocation(): object { return {}; }
  bufferData(): void { this.hit("bufferData"); }
  bufferSubData(): void { this.hit("bufferSubData"); }
  drawArrays(): void { this.hit("drawArrays"); }
  drawArraysInstanced(): void { this.hit("drawArraysInstanced"); }
  disable(cap: number): void { this.enabled.delete(cap); }
  enable(cap: number): void { this.enabled.add(cap); }
  blendFuncSeparate(...args: number[]): void { this.blendFunc = args; }
  clearColor(): void {}
  clear(): void {}
  scissor(): void {}
  viewport(): void {}
  bindBuffer(): void {}
  bindVertexArray(): void {}
  useProgram(): void {}
  shaderSource(): void {}
  compileShader(): void {}
  attachShader(): void {}
  linkProgram(): void {}
  enableVertexAttribArray(): void {}
  vertexAttribPointer(): void {}
  vertexAttribDivisor(): void {}
  uniform1f(): void {}
  uniform2f(): void {}
  uniform4f(): void {}
}

/** Build a backend over a `FakeGl`, plus helpers to fire context loss and restore. */
export function setupFakeGl(): { gl: FakeGl; backend: () => WebGL2Backend; fireLost: () => void; restore: () => void } {
  const gl = new FakeGl();
  const target = new EventTarget();
  const canvas = Object.assign(target, { width: 100, height: 100, getContext: () => gl }) as unknown as HTMLCanvasElement;
  return {
    gl,
    backend: () => new WebGL2Backend(canvas),
    fireLost: () => {
      gl.lost = true;
      target.dispatchEvent(new Event("webglcontextlost"));
    },
    restore: () => {
      gl.lost = false;
      gl.generation++;
      gl.enabled.clear();
      gl.blendFunc = null;
    },
  };
}
