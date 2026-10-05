import { Canvas2DRenderer } from "../../src/render/canvas2d/Canvas2DRenderer.ts";
import type { ChartRenderer } from "../../src/render/ChartRenderer.ts";
import { SharedWebGLContext } from "../../src/render/webgl2/SharedWebGL.ts";
import type { DrawCommand, GpuBackend } from "../../src/render/webgl2/types.ts";
import { WebGL2Renderer } from "../../src/render/webgl2/WebGL2Renderer.ts";
import { FakeContext2D, fakeCanvas2d } from "./fake2d.ts";

/** One engine-independent observation of what a draw call put on the frame, in device pixels (y down). */
export type DrawObs =
  | { readonly kind: "stroke"; readonly widthPx: number; readonly segments: ReadonlyArray<readonly [number, number, number, number]> }
  | { readonly kind: "marker"; readonly diameterPx: number; readonly centers: ReadonlyArray<readonly [number, number]> }
  | { readonly kind: "rect"; readonly rects: ReadonlyArray<readonly [number, number, number, number]> }
  | { readonly kind: "polygon"; readonly bbox: readonly [number, number, number, number] };

/** A built engine plus the probes the contract suite uses to observe it without knowing how it draws. */
export interface EngineHarness {
  readonly name: string;
  readonly renderer: ChartRenderer;
  /** What the engine drew since the last `resetDraws()`; WebGL engines only show draws after `endFrame()`. */
  draws(): DrawObs[];
  resetDraws(): void;
  /** Size of every full-frame clear since creation. */
  clears(): ReadonlyArray<readonly [number, number]>;
  /** Simulate the browser losing the context; returns the dispatched event so tests can check `preventDefault`. */
  lose(): Event;
  restore(): void;
  /** How many times the engine (re)built its GPU resources, or `null` for engines that have none. */
  rebuilds(): number | null;
  readonly expected: { readonly gpu: boolean; readonly shared: boolean };
}

export interface EngineFixture {
  readonly name: string;
  create(): EngineHarness;
}

type Rect = readonly [number, number, number, number];

/** Records the commands a GPU backend would execute, and turns them into `DrawObs` in device pixels. */
class GlRecorder {
  width = 1;
  height = 1;
  readonly clearLog: Array<readonly [number, number]> = [];
  readonly commands: Array<{ command: DrawCommand; stream: Float32Array }> = [];
  builds = 0;

  backend(): GpuBackend {
    this.builds++;
    return {
      viewport: (_x, _y, w, h) => {
        this.width = w;
        this.height = h;
      },
      clear: () => {
        this.clearLog.push([this.width, this.height]);
      },
      submit: (stream, floatCount, commands) => {
        const copy = stream.slice(0, floatCount);
        for (const command of commands) this.commands.push({ command, stream: copy });
      },
      destroy: () => {},
    };
  }

  observe(): DrawObs[] {
    return this.commands.map(({ command, stream }) => this.observeCommand(command, stream));
  }

  private px(command: { scaleX: number; scaleY: number; offsetX: number; offsetY: number }, stream: Float32Array, vertex: number): [number, number] {
    const x = stream[vertex * 2]!;
    const y = stream[vertex * 2 + 1]!;
    return [(x * command.scaleX + command.offsetX + 1) * this.width * 0.5, (1 - (y * command.scaleY + command.offsetY)) * this.height * 0.5];
  }

  private observeCommand(command: DrawCommand, stream: Float32Array): DrawObs {
    switch (command.kind) {
      case "thickLine": {
        const pairs = command.layout === "pairs";
        const segments: Array<[number, number, number, number]> = [];
        for (let s = 0; s < command.segments; s++) {
          const a = this.px(command, stream, command.first + (pairs ? s * 2 : s));
          const b = this.px(command, stream, command.first + (pairs ? s * 2 + 1 : s + 1));
          if (Number.isFinite(a[0] + a[1] + b[0] + b[1])) segments.push([a[0], a[1], b[0], b[1]]);
        }
        return { kind: "stroke", widthPx: command.lineWidth, segments };
      }
      case "point": {
        const centers: Array<[number, number]> = [];
        for (let i = 0; i < command.instances; i++) {
          const c = this.px(command, stream, command.first + i);
          if (Number.isFinite(c[0] + c[1])) centers.push(c);
        }
        return { kind: "marker", diameterPx: command.pointSize, centers };
      }
      case "bar": {
        const rects: Rect[] = [];
        for (let i = 0; i < command.instances; i++) {
          const x = stream[(command.first + i) * 2]!;
          const y = stream[(command.first + i) * 2 + 1]!;
          if (!Number.isFinite(x + y)) continue;
          const a = this.px(command, new Float32Array([x - command.barWidth / 2, command.baseline]), 0);
          const b = this.px(command, new Float32Array([x + command.barWidth / 2, y]), 0);
          rects.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
        }
        return { kind: "rect", rects };
      }
      case "solid": {
        if (command.primitive === "lines" || command.primitive === "line_strip") {
          const strip = command.primitive === "line_strip";
          const segments: Array<[number, number, number, number]> = [];
          const count = strip ? command.count - 1 : command.count >> 1;
          for (let s = 0; s < count; s++) {
            const a = this.px(command, stream, command.first + (strip ? s : s * 2));
            const b = this.px(command, stream, command.first + (strip ? s + 1 : s * 2 + 1));
            if (Number.isFinite(a[0] + a[1] + b[0] + b[1])) segments.push([a[0], a[1], b[0], b[1]]);
          }
          return { kind: "stroke", widthPx: 1, segments };
        }
        const points: Array<[number, number]> = [];
        for (let i = 0; i < command.count; i++) {
          const p = this.px(command, stream, command.first + i);
          if (Number.isFinite(p[0] + p[1])) points.push(p);
        }
        if (command.primitive === "triangles" && command.count % 6 === 0 && isRectPairs(stream, command.first, command.count)) {
          const rects: Rect[] = [];
          for (let v = 0; v < command.count; v += 6) {
            const a = this.px(command, stream, command.first + v);
            const b = this.px(command, stream, command.first + v + 5);
            rects.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
          }
          return { kind: "rect", rects };
        }
        return { kind: "polygon", bbox: bbox(points) };
      }
    }
  }
}

function isRectPairs(stream: Float32Array, first: number, count: number): boolean {
  for (let v = 0; v < count; v += 6) {
    const o = (first + v) * 2;
    const [x0, y0, x1, y1] = [stream[o]!, stream[o + 1]!, stream[o + 2]!, stream[o + 5]!];
    const expected = [x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1];
    for (let i = 0; i < 12; i++) if (stream[o + i] !== expected[i]) return false;
  }
  return true;
}

function bbox(points: ReadonlyArray<readonly [number, number]>): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

/** Turn recorded Canvas 2D calls into `DrawObs`. */
function observe2d(calls: ReadonlyArray<readonly [string, ...unknown[]]>): DrawObs[] {
  const out: DrawObs[] = [];
  let ops: Array<{ op: "move" | "line"; x: number; y: number }> = [];
  let arcs: Array<{ x: number; y: number; r: number }> = [];
  let rects: Rect[] = [];
  const flushRects = (): void => {
    if (rects.length > 0) out.push({ kind: "rect", rects });
    rects = [];
  };
  for (const call of calls) {
    const [name, ...args] = call;
    if (name !== "fillRect") flushRects();
    switch (name) {
      case "beginPath":
        ops = [];
        arcs = [];
        break;
      case "moveTo":
        ops.push({ op: "move", x: args[0] as number, y: args[1] as number });
        break;
      case "lineTo":
        ops.push({ op: "line", x: args[0] as number, y: args[1] as number });
        break;
      case "arc":
        arcs.push({ x: args[0] as number, y: args[1] as number, r: args[2] as number });
        break;
      case "stroke": {
        const segments: Array<[number, number, number, number]> = [];
        let pen: { x: number; y: number } | null = null;
        for (const o of ops) {
          if (o.op === "line" && pen) segments.push([pen.x, pen.y, o.x, o.y]);
          pen = o;
        }
        out.push({ kind: "stroke", widthPx: args[1] as number, segments });
        break;
      }
      case "fill":
        if (arcs.length > 0) out.push({ kind: "marker", diameterPx: arcs[0]!.r * 2, centers: arcs.map((a) => [a.x, a.y] as const) });
        else out.push({ kind: "polygon", bbox: bbox(ops.map((o) => [o.x, o.y] as const)) });
        break;
      case "fillRect": {
        const [, x, y, w, h] = args as [string, number, number, number, number];
        rects.push([x, y, x + w, y + h]);
        break;
      }
    }
  }
  flushRects();
  return out;
}

function loseEvent(target: EventTarget, type: string): Event {
  const event = new Event(type, { cancelable: true });
  target.dispatchEvent(event);
  return event;
}

export const webgl2Fixture: EngineFixture = {
  name: "WebGL2Renderer",
  create() {
    const log = new GlRecorder();
    const canvas = new EventTarget() as unknown as HTMLCanvasElement;
    const renderer = new WebGL2Renderer(canvas, () => log.backend());
    return {
      name: "webgl2",
      renderer,
      draws: () => log.observe(),
      resetDraws: () => {
        log.commands.length = 0;
      },
      clears: () => log.clearLog,
      lose: () => loseEvent(canvas, "webglcontextlost"),
      restore: () => void canvas.dispatchEvent(new Event("webglcontextrestored")),
      rebuilds: () => log.builds,
      expected: { gpu: true, shared: false },
    };
  },
};

export const canvas2dFixture: EngineFixture = {
  name: "Canvas2DRenderer",
  create() {
    const ctx = new FakeContext2D();
    const canvas = fakeCanvas2d(ctx);
    (globalThis as { Path2D?: unknown }).Path2D ??= class {
      moveTo(): void {}
      lineTo(): void {}
      closePath(): void {}
    };
    const renderer = new Canvas2DRenderer(canvas);
    return {
      name: "canvas2d",
      renderer,
      draws: () => observe2d(ctx.calls),
      resetDraws: () => {
        ctx.calls.length = 0;
      },
      clears: () => ctx.calls.filter((c) => c[0] === "clearRect").map((c) => [c[3], c[4]] as [number, number]),
      lose: () => {
        ctx.lost = true;
        return loseEvent(canvas, "contextlost");
      },
      restore: () => {
        ctx.lost = false;
        canvas.dispatchEvent(new Event("contextrestored"));
      },
      rebuilds: () => null,
      expected: { gpu: false, shared: false },
    };
  },
};

export const sharedFixture: EngineFixture = {
  name: "SharedWebGLRenderer",
  create() {
    const log = new GlRecorder();
    const hidden = new EventTarget() as unknown as HTMLCanvasElement;
    const doc = { createElement: () => hidden } as unknown as Document;
    const context = new SharedWebGLContext(doc, () => log.backend());
    const chartCanvas = fakeCanvas2d(new FakeContext2D());
    const renderer = context.renderer()({ canvas: chartCanvas }) as ChartRenderer;
    return {
      name: "shared",
      renderer,
      draws: () => log.observe(),
      resetDraws: () => {
        log.commands.length = 0;
      },
      clears: () => log.clearLog,
      lose: () => loseEvent(hidden, "webglcontextlost"),
      restore: () => void hidden.dispatchEvent(new Event("webglcontextrestored")),
      rebuilds: () => log.builds,
      expected: { gpu: true, shared: true },
    };
  },
};

export const engineFixtures: readonly EngineFixture[] = [webgl2Fixture, canvas2dFixture, sharedFixture];
