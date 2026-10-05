import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { FakeResizeObserver, setupDom } from "./fakes.ts";
import type { FakeRaf, TestEnv } from "./fakes.ts";
import { stubPlot } from "./harness.ts";
import type { Chart as ChartType } from "../../src/ui/Chart.ts";
import type { autoRenderer as AutoRenderer, canvas2dRenderer as Canvas2dRenderer } from "../../src/renderers/canvas2d.ts";
import type { WebGL2UnavailableError as UnavailableErrorType } from "../../src/render/WebGL2Backend.ts";

let env: TestEnv;
let raf: FakeRaf;
let Chart: typeof ChartType;
let canvas2dRenderer: typeof Canvas2dRenderer;
let autoRenderer: typeof AutoRenderer;
let WebGL2UnavailableError: typeof UnavailableErrorType;

beforeAll(async () => {
  env = setupDom();
  raf = env.raf;
  ({ Chart } = await import("../../src/ui/Chart.ts"));
  ({ canvas2dRenderer, autoRenderer } = await import("../../src/renderers/canvas2d.ts"));
  ({ WebGL2UnavailableError } = await import("../../src/render/WebGL2Backend.ts"));
});
afterAll(() => env.teardown());

let target: HTMLDivElement;
let contexts: string[];
let strokes: number;
const originalGetContext = (): typeof HTMLCanvasElement.prototype.getContext => HTMLCanvasElement.prototype.getContext;
let savedGetContext: typeof HTMLCanvasElement.prototype.getContext;

/** A 2D context stand-in that counts strokes; WebGL2 is unavailable. */
function install2dOnlyCanvas(): void {
  const ctx = new Proxy(
    { stroke: () => void strokes++, canvas: null, measureText: () => ({ width: 5 }) },
    { get: (t, key) => (key in t ? (t as Record<string | symbol, unknown>)[key] : () => undefined), set: () => true },
  );
  HTMLCanvasElement.prototype.getContext = function (kind: string) {
    contexts.push(kind);
    return kind === "2d" ? ctx : null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
  raf.pending.clear();
  FakeResizeObserver.instances = [];
  contexts = [];
  strokes = 0;
  savedGetContext = originalGetContext();
  install2dOnlyCanvas();
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = savedGetContext;
  target.remove();
});

describe("Chart renderer option", () => {
  it("renders with the Canvas 2D renderer when requested", () => {
    const chart = new Chart(target, { renderer: canvas2dRenderer() });
    stubPlot(chart);
    expect(chart.renderer).toBe("canvas2d");
    expect(chart.getWebGLContext()).toBeNull();
    expect(contexts).not.toContain("webgl2");
    chart.addLine({ capacity: 8 }).append({ x: [0, 1, 2], y: [0, 1, 0] });
    chart.start();
    raf.flush();
    expect(strokes).toBeGreaterThan(0);
    expect(chart.getFrameStats().drawCalls).toBeGreaterThan(0);
    chart.dispose();
  });

  it("autoRenderer falls back to Canvas 2D when WebGL2 is unavailable", () => {
    const chart = new Chart(target, { renderer: autoRenderer() });
    expect(chart.renderer).toBe("canvas2d");
    expect(contexts[0]).toBe("webgl2");
    chart.dispose();
  });

  it("the default renderer still throws WebGL2UnavailableError without WebGL2", () => {
    expect(() => new Chart(target, {})).toThrow(WebGL2UnavailableError);
    expect(target.children).toHaveLength(0);
  });

  it("rejects unknown renderer strings", () => {
    expect(() => new Chart(target, { renderer: "canvas2d" as never })).toThrow(TypeError);
    expect(target.children).toHaveLength(0);
  });
});
