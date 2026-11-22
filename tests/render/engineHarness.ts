import { Canvas2DRenderer } from "../../src/render/canvas2d/Canvas2DRenderer.ts";
import type { ChartRenderer, RendererName } from "../../src/render/ChartRenderer.ts";
import { SharedWebGLContext } from "../../src/render/webgl2/SharedWebGL.ts";
import type { DrawCommand, GpuBackend } from "../../src/render/webgl2/types.ts";
import { WebGL2Renderer } from "../../src/render/webgl2/WebGL2Renderer.ts";
import { FakeContext2D, fakeCanvas2d } from "./fake2d.ts";

/** One engine-independent observation of what a draw call put on the frame, in device pixels (y down). */
export type DrawObs =
  | { readonly kind: "stroke"; readonly widthPx: number; readonly segments: ReadonlyArray<readonly [number, number, number, number]>; readonly dashed?: boolean }
  /** Rounded shapes (`fillShapes`): each shape's bounding box, plus whether it has a border. */
  | { readonly kind: "shape"; readonly boxes: ReadonlyArray<readonly [number, number, number, number]>; readonly bordered: boolean }
  | { readonly kind: "marker"; readonly diameterPx: number; readonly centers: ReadonlyArray<readonly [number, number]> }
  | { readonly kind: "rect"; readonly rects: ReadonlyArray<readonly [number, number, number, number]> }
  | { readonly kind: "polygon"; readonly bbox: readonly [number, number, number, number] }
  /** A density grid (`fillField`) drawn as one image: the device-pixel box it covers, and its grid size. */
  | { readonly kind: "field"; readonly box: readonly [number, number, number, number]; readonly cols: number; readonly rows: number };

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
  /** A second surface on this engine's own kind of canvas, plus what it drew since creation. */
  createSurface(): { readonly surface: ChartRenderer; draws(): DrawObs[] };
  /** How many times the engine (re)built its GPU resources, or `null` for engines that have none. */
  rebuilds(): number | null;
  readonly expected: { readonly name: RendererName; readonly gpu: boolean; readonly shared: boolean };
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
    return this.commands.flatMap(({ command, stream }) => this.observeCommand(command, stream));
  }

  private px(command: { scaleX: number; scaleY: number; offsetX: number; offsetY: number }, stream: Float32Array, vertex: number): [number, number] {
    const x = stream[vertex * 2]!;
    const y = stream[vertex * 2 + 1]!;
    return [(x * command.scaleX + command.offsetX + 1) * this.width * 0.5, (1 - (y * command.scaleY + command.offsetY)) * this.height * 0.5];
  }

  private observeCommand(command: DrawCommand, stream: Float32Array): DrawObs[] {
    switch (command.kind) {
      case "thickLine": {
        const pairs = command.layout === "pairs";
        const segments: Array<[number, number, number, number]> = [];
        for (let s = 0; s < command.segments; s++) {
          const a = this.px(command, stream, command.first + (pairs ? s * 2 : s));
          const b = this.px(command, stream, command.first + (pairs ? s * 2 + 1 : s + 1));
          if (Number.isFinite(a[0] + a[1] + b[0] + b[1])) segments.push([a[0], a[1], b[0], b[1]]);
        }
        return [{ kind: "stroke", widthPx: command.lineWidth, segments }];
      }
      case "point": {
        const centers: Array<[number, number]> = [];
        for (let i = 0; i < command.instances; i++) {
          const c = this.px(command, stream, command.first + i);
          if (Number.isFinite(c[0] + c[1])) centers.push(c);
        }
        return [{ kind: "marker", diameterPx: command.pointSize, centers }];
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
        return [{ kind: "rect", rects }];
      }
      case "rects": {
        const rects: Rect[] = [];
        for (let i = 0; i < command.instances; i++) {
          const o = (command.first + i * 4) * 2;
          const [x, y, w, h] = [stream[o]!, stream[o + 1]!, stream[o + 2]!, stream[o + 3]!];
          if (Number.isFinite(x + y + w + h)) rects.push([x, y, x + w, y + h]);
        }
        return [{ kind: "rect", rects }];
      }
      case "shapes": {
        const out: DrawObs[] = [];
        for (let i = 0; i < command.count; i++) {
          const o = command.first * 2 + i * 14;
          const [x, y, w, h] = [stream[o]!, stream[o + 1]!, stream[o + 2]!, stream[o + 3]!];
          out.push({ kind: "shape", boxes: [[x, y, x + w, y + h]], bordered: stream[o + 5]! > 0 && stream[o + 13]! > 0 });
        }
        return out;
      }
      case "segments": {
        const out: DrawObs[] = [];
        for (let i = 0; i < command.count; i++) {
          const o = command.first * 2 + i * 12;
          out.push({ kind: "stroke", widthPx: stream[o + 4]!, segments: [[stream[o]!, stream[o + 1]!, stream[o + 2]!, stream[o + 3]!]], dashed: stream[o + 5]! > 0 && stream[o + 6]! > 0 });
        }
        return out;
      }
      case "segmentSet": {
        // The set's CPU copy, mapped as the shader maps it; one stroke for the draw, like an opaque Canvas 2D path.
        const { set } = command;
        const segments: Array<[number, number, number, number]> = [];
        for (let k = command.first; k < command.first + command.count; k++) {
          const i = set.ends[k * 2]!;
          const j = set.ends[k * 2 + 1]!;
          if (i >= set.pointCount || j >= set.pointCount) continue;
          const p = [set.points[i * 2]!, set.points[i * 2 + 1]!, set.points[j * 2]!, set.points[j * 2 + 1]!];
          if (p.some((v) => Math.abs(v) > 1e38)) continue;
          segments.push([p[0]! * command.scaleX + command.offsetX, p[1]! * command.scaleY + command.offsetY, p[2]! * command.scaleX + command.offsetX, p[3]! * command.scaleY + command.offsetY]);
        }
        return [{ kind: "stroke", widthPx: command.stroke[0], segments, dashed: command.stroke[1] > 0 }];
      }
      case "field": {
        // A texture over one rectangle: what it shades is checked through the renderer's own tests.
        const o = command.first * 2;
        const [x, y, w, h] = [stream[o]!, stream[o + 1]!, stream[o + 2]!, stream[o + 3]!];
        return [{ kind: "field", box: [x, y, x + w, y + h], cols: command.cols, rows: command.rows }];
      }
      case "colorTriangles": {
        const out: DrawObs[] = [];
        for (let v = 0; v + 2 < command.count; v += 3) {
          const o = (command.first * 2) + v * 6;
          out.push({ kind: "polygon", bbox: bbox([[stream[o]!, stream[o + 1]!], [stream[o + 6]!, stream[o + 7]!], [stream[o + 12]!, stream[o + 13]!]]) });
        }
        return out;
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
          return [{ kind: "stroke", widthPx: 1, segments }];
        }
        if (command.primitive === "triangle_strip") {
          // A pair with a non-finite vertex breaks the strip; each run of complete pairs is one ribbon.
          const runs: DrawObs[] = [];
          let run: Array<[number, number]> = [];
          const flush = (): void => {
            if (run.length >= 4) runs.push({ kind: "polygon", bbox: bbox(run) });
            run = [];
          };
          for (let pair = 0; pair < command.count >> 1; pair++) {
            const top = this.px(command, stream, command.first + pair * 2);
            const bottom = this.px(command, stream, command.first + pair * 2 + 1);
            if (Number.isFinite(top[0] + top[1] + bottom[0] + bottom[1])) run.push(top, bottom);
            else flush();
          }
          flush();
          return runs;
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
          return [{ kind: "rect", rects }];
        }
        return [{ kind: "polygon", bbox: bbox(points) }];
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
  /** Corner points of rounded shapes (`arcTo`), per subpath: a shape path. */
  let shapePoints: Array<Array<readonly [number, number]>> = [];
  let roundShape = false;
  /** Rectangles added to the current path with `rect`; one `fill` paints them all. */
  let pathRects: Rect[] = [];
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
        pathRects = [];
        shapePoints = [];
        roundShape = false;
        break;
      case "arcTo": {
        roundShape = true;
        const [x1, y1, x2, y2] = args as [number, number, number, number];
        shapePoints.at(-1)?.push([x1, y1], [x2, y2]);
        break;
      }
      case "rect": {
        const [x, y, w, h] = args as [number, number, number, number];
        pathRects.push([x, y, x + w, y + h]);
        break;
      }
      case "moveTo":
        ops.push({ op: "move", x: args[0] as number, y: args[1] as number });
        shapePoints.push([[args[0] as number, args[1] as number]]);
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
        if (roundShape) {
          // The inset border of the shape filled just before.
          const previous = out.at(-1);
          if (previous?.kind === "shape") out[out.length - 1] = { ...previous, bordered: true };
          break;
        }
        out.push({ kind: "stroke", widthPx: args[1] as number, segments, dashed: args[2] === true });
        break;
      }
      case "fill":
        if (roundShape) out.push({ kind: "shape", boxes: shapePoints.filter((p) => p.length > 1).map((p) => bbox(p)), bordered: false });
        else if (pathRects.length > 0) out.push({ kind: "rect", rects: pathRects });
        else if (arcs.length > 0) out.push({ kind: "marker", diameterPx: arcs[0]!.r * 2, centers: arcs.map((a) => [a.x, a.y] as const) });
        else if (ops.length > 0) {
          // Each moveTo opens a subpath, and each closed subpath is one polygon.
          let subpath: Array<readonly [number, number]> = [];
          for (const o of ops) {
            if (o.op === "move" && subpath.length > 0) {
              out.push({ kind: "polygon", bbox: bbox(subpath) });
              subpath = [];
            }
            subpath.push([o.x, o.y] as const);
          }
          out.push({ kind: "polygon", bbox: bbox(subpath) });
        } else if (args[1] !== -1) out.push({ kind: "polygon", bbox: bbox([]) });
        pathRects = [];
        break;
      case "drawImage": {
        const [image, x, y, w, h] = args as [HTMLCanvasElement, number, number, number, number];
        out.push({ kind: "field", box: [x, y, x + w, y + h], cols: image.width, rows: image.height });
        break;
      }
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
    const renderer = new WebGL2Renderer(canvas, { createBackend: () => log.backend() });
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
      createSurface: () => {
        log.commands.length = 0;
        return { surface: renderer.createSurface(new EventTarget() as unknown as HTMLCanvasElement), draws: () => log.observe() };
      },
      rebuilds: () => log.builds,
      expected: { name: "webgl2", gpu: true, shared: false },
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
      rect(): void {}
      arc(): void {}
      arcTo(): void {}
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
      createSurface: () => {
        const surfaceCtx = new FakeContext2D();
        return { surface: renderer.createSurface(fakeCanvas2d(surfaceCtx)), draws: () => observe2d(surfaceCtx.calls) };
      },
      rebuilds: () => null,
      expected: { name: "canvas2d", gpu: false, shared: false },
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
      createSurface: () => {
        log.commands.length = 0;
        return { surface: renderer.createSurface(fakeCanvas2d(new FakeContext2D())), draws: () => log.observe() };
      },
      rebuilds: () => log.builds,
      expected: { name: "shared", gpu: true, shared: true },
    };
  },
};

export const engineFixtures: readonly EngineFixture[] = [webgl2Fixture, canvas2dFixture, sharedFixture];
