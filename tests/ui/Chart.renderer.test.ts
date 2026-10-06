import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { FakeResizeObserver, setupDom } from "./fakes.ts";
import type { FakeRaf, TestEnv } from "./fakes.ts";
import { stubPlot } from "./harness.ts";
import type { Chart as ChartType } from "../../src/ui/Chart.ts";
import type { autoRenderer as AutoRenderer, canvas2dRenderer as Canvas2dRenderer, Canvas2DUnavailableError as Canvas2DErrorType, webgl2Renderer as Webgl2Renderer } from "../../src/render/engines.ts";
import type { WebGL2UnavailableError as UnavailableErrorType } from "../../src/render/webgl2/availability.ts";

let env: TestEnv;
let raf: FakeRaf;
let Chart: typeof ChartType;
let canvas2dRenderer: typeof Canvas2dRenderer;
let autoRenderer: typeof AutoRenderer;
let WebGL2UnavailableError: typeof UnavailableErrorType;
let Canvas2DUnavailableError: typeof Canvas2DErrorType;
let webgl2Renderer: typeof Webgl2Renderer;

beforeAll(async () => {
  env = setupDom();
  raf = env.raf;
  ({ Chart } = await import("../../src/ui/Chart.ts"));
  ({ canvas2dRenderer, autoRenderer, webgl2Renderer, Canvas2DUnavailableError } = await import("../../src/render/engines.ts"));
  ({ WebGL2UnavailableError } = await import("../../src/render/webgl2/availability.ts"));
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

/** Make `canvas.getContext` return nothing, so no engine can start. */
function installNoContextCanvas(): void {
  HTMLCanvasElement.prototype.getContext = function () {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

describe("Chart renderer option", () => {
  it("renders with the Canvas 2D renderer when requested by name", () => {
    const chart = new Chart(target, { renderer: "canvas2d" });
    stubPlot(chart);
    expect(chart.renderer).toBe("canvas2d");
    expect(chartInternals(chart).getWebGLContext()).toBeNull();
    expect(contexts).not.toContain("webgl2");
    chart.addLine({ capacity: 8 }).append({ x: [0, 1, 2], y: [0, 1, 0] });
    chart.start();
    raf.flush();
    expect(strokes).toBeGreaterThan(0);
    expect(chart.getFrameStats().drawCalls).toBeGreaterThan(0);
    chart.dispose();
  });

  it("treats a name and its factory the same", () => {
    const byName = new Chart(target, { renderer: "canvas2d" });
    const byFactory = new Chart(target, { renderer: canvas2dRenderer() });
    expect(byFactory.rendererInfo).toEqual(byName.rendererInfo);
    byName.dispose();
    byFactory.dispose();
  });

  it("defaults to auto: falls back to Canvas 2D without WebGL2, quietly, and says so", () => {
    const logs = [spyOn(console, "warn"), spyOn(console, "error"), spyOn(console, "log")].map((spy) => spy.mockImplementation(() => {}));
    const chart = new Chart(target, {});
    expect(chart.renderer).toBe("canvas2d");
    expect(contexts[0]).toBe("webgl2");
    expect(chart.rendererInfo).toMatchObject({ name: "canvas2d", requested: "auto", fallbackFrom: "webgl2" });
    expect(chart.rendererInfo.capabilities).toMatchObject({ gpu: false, shared: false });
    for (const log of logs) {
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    }
    chart.dispose();
  });

  it("preloadWebGL is a quiet no-op without WebGL2 and never throws", async () => {
    const { preloadWebGL } = await import("../../src/render/engines.ts");
    contexts.length = 0;
    expect(() => preloadWebGL()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // It tried WebGL2 once, found none, and left nothing behind.
    expect(contexts.every((kind) => kind === "webgl2")).toBe(true);
    expect(target.children).toHaveLength(0);
    const chart = new Chart(target, {});
    expect(chart.rendererInfo).toMatchObject({ name: "canvas2d", requested: "auto" });
    chart.dispose();
  });

  it("preloadWebGL is safe without a document (server rendering)", async () => {
    const { preloadWebGL } = await import("../../src/render/engines.ts");
    const saved = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: undefined });
    try {
      expect(() => preloadWebGL()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: saved });
    }
  });

  it("auto and its factory agree", () => {
    const chart = new Chart(target, { renderer: autoRenderer() });
    expect(chart.rendererInfo).toMatchObject({ name: "canvas2d", requested: "auto", fallbackFrom: "webgl2" });
    chart.dispose();
  });

  it("an engine chosen directly reports itself as requested and never as a fallback", () => {
    const chart = new Chart(target, { renderer: "canvas2d" });
    expect(chart.rendererInfo).toMatchObject({ name: "canvas2d", requested: "canvas2d" });
    expect(chart.rendererInfo.fallbackFrom).toBeUndefined();
    chart.dispose();
  });

  it('"webgl2" is strict: it throws WebGL2UnavailableError instead of falling back', () => {
    expect(() => new Chart(target, { renderer: "webgl2" })).toThrow(WebGL2UnavailableError);
    expect(() => new Chart(target, { renderer: webgl2Renderer() })).toThrow(WebGL2UnavailableError);
    expect(target.children).toHaveLength(0);
  });

  it('"shared" is strict as well', () => {
    expect(() => new Chart(target, { renderer: "shared" })).toThrow(WebGL2UnavailableError);
    expect(target.children).toHaveLength(0);
  });

  it('"canvas2d" throws Canvas2DUnavailableError when there is no 2D context', () => {
    installNoContextCanvas();
    expect(() => new Chart(target, { renderer: "canvas2d" })).toThrow(Canvas2DUnavailableError);
    expect(target.children).toHaveLength(0);
  });

  it("auto reports the WebGL2 reason when neither engine can start", () => {
    installNoContextCanvas();
    expect(() => new Chart(target, {})).toThrow(WebGL2UnavailableError);
    expect(target.children).toHaveLength(0);
  });

  it("rejects unknown renderer values with the valid names", () => {
    expect(() => new Chart(target, { renderer: "canvas" as never })).toThrow(TypeError);
    expect(() => new Chart(target, { renderer: "canvas" as never })).toThrow(/"auto", "webgl2", "canvas2d", "shared"/);
    expect(() => new Chart(target, { renderer: 5 as never })).toThrow(TypeError);
    expect(() => new Chart(target, { renderer: "toString" as never })).toThrow(TypeError);
    expect(target.children).toHaveLength(0);
  });
});
