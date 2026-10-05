import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { FakeResizeObserver, setupDom } from "./fakes.ts";
import type { FakeRaf, TestEnv } from "./fakes.ts";
import { stubPlot } from "./harness.ts";
import { releaseWarm } from "../../src/render/webgl2/warm.ts";
import type { Chart as ChartType } from "../../src/ui/Chart.ts";
import type { createChartRenderContext as CreateContext, sharedRenderer as SharedRenderer } from "../../src/render/engines.ts";

let env: TestEnv;
let raf: FakeRaf;
let Chart: typeof ChartType;
let createChartRenderContext: typeof CreateContext;
let sharedRenderer: typeof SharedRenderer;

beforeAll(async () => {
  env = setupDom();
  raf = env.raf;
  ({ Chart } = await import("../../src/ui/Chart.ts"));
  ({ createChartRenderContext, sharedRenderer } = await import("../../src/render/engines.ts"));
});
afterAll(() => env.teardown());

interface FakeGl {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: WebGL2RenderingContext;
  releases: number;
  lost: boolean;
}

let target: HTMLDivElement;
let glContexts: FakeGl[];
let blits: Array<{ target: HTMLCanvasElement; source: unknown }>;
let twoD: WeakMap<HTMLCanvasElement, unknown>;
let savedGetContext: typeof HTMLCanvasElement.prototype.getContext;

function recordingGl(canvas: HTMLCanvasElement): FakeGl {
  const state: FakeGl = { canvas, ctx: null as never, releases: 0, lost: false };
  const base: Record<string, unknown> = {
    canvas,
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getAttribLocation: () => 0,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    isContextLost: () => state.lost,
    getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => { state.releases++; } } : null),
  };
  const ctx = new Proxy(base, {
    get(t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop in t) return t[prop];
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return 1;
      return () => ({});
    },
  }) as unknown as WebGL2RenderingContext;
  (state as { ctx: WebGL2RenderingContext }).ctx = ctx;
  return state;
}

/** A 2D context stand-in that records `drawImage` calls against its canvas and ignores everything else. */
function recording2d(canvas: HTMLCanvasElement): unknown {
  return new Proxy({ measureText: () => ({ width: 5 }), drawImage: (source: unknown) => void blits.push({ target: canvas, source }) }, {
    get: (t, key) => (key in t ? (t as Record<string | symbol, unknown>)[key] : () => undefined),
    set: () => true,
  });
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
  raf.pending.clear();
  FakeResizeObserver.instances = [];
  glContexts = [];
  blits = [];
  twoD = new WeakMap();
  savedGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind === "webgl2") {
      // A real canvas hands back the same context object for repeated requests.
      let gl = glContexts.find((entry) => entry.canvas === this);
      if (!gl) glContexts.push((gl = recordingGl(this)));
      return gl.ctx;
    }
    if (kind === "2d") {
      let ctx = twoD.get(this);
      if (!ctx) twoD.set(this, (ctx = recording2d(this)));
      return ctx;
    }
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  // A shared context whose last chart was disposed idles warm for a moment; end that before the next test.
  releaseWarm();
  HTMLCanvasElement.prototype.getContext = savedGetContext;
  target.remove();
});

function mountCharts(count: number, context: ReturnType<typeof createChartRenderContext>): ChartType[] {
  const charts: ChartType[] = [];
  for (let i = 0; i < count; i++) {
    const host = document.createElement("div");
    target.appendChild(host);
    const chart = new Chart(host, { renderer: sharedRenderer(context) });
    stubPlot(chart);
    chart.addLine({ capacity: 8 }).append({ x: [0, 1, 2], y: [0, 1, 0] });
    chart.fitToData();
    chart.start();
    charts.push(chart);
  }
  return charts;
}

describe("shared render context", () => {
  it('the "shared" renderer name puts every chart on the document\'s one context', () => {
    const charts = [0, 1, 2].map(() => {
      const host = document.createElement("div");
      target.appendChild(host);
      return new Chart(host, { renderer: "shared" });
    });
    expect(glContexts).toHaveLength(1);
    expect(charts.every((chart) => chart.rendererInfo.name === "shared" && chart.rendererInfo.requested === "shared")).toBe(true);
    expect(charts[0]!.rendererInfo.capabilities).toMatchObject({ gpu: true, shared: true });
    for (const chart of charts) chart.dispose();
    releaseWarm();
    expect(glContexts[0]!.releases).toBe(1);
  });

  it("serves many charts from a single WebGL2 context and blits into each chart canvas", () => {
    const context = createChartRenderContext();
    const charts = mountCharts(20, context);
    expect(glContexts).toHaveLength(1);
    expect(context.chartCount).toBe(20);
    expect(charts.every((chart) => chart.renderer === "shared")).toBe(true);
    expect(charts.every((chart) => chartInternals(chart).getWebGLContext() === null)).toBe(true);

    raf.flush();
    const sharedCanvas = glContexts[0]!.canvas;
    expect(blits).toHaveLength(20);
    expect(blits.every((blit) => blit.source === sharedCanvas)).toBe(true);
    expect(new Set(blits.map((blit) => blit.target)).size).toBe(20);
    expect(charts.every((chart) => chart.getFrameStats().drawCalls > 0)).toBe(true);
    for (const chart of charts) chart.dispose();
  });

  it("only resizes the shared canvas when consecutive charts differ in size", () => {
    const context = createChartRenderContext();
    const [a, b] = mountCharts(2, context) as [ChartType, ChartType];
    chartInternals(a).canvas.width = 300;
    chartInternals(a).canvas.height = 100;
    chartInternals(b).canvas.width = 300;
    chartInternals(b).canvas.height = 100;
    raf.flush();
    const shared = glContexts[0]!.canvas;
    expect([shared.width, shared.height]).toEqual([300, 100]);
    let widthWrites = 0;
    let value = shared.width;
    Object.defineProperty(shared, "width", { get: () => value, set: (next: number) => { widthWrites++; value = next; }, configurable: true });
    a.requestRender();
    b.requestRender();
    raf.flush();
    expect(widthWrites).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("keeps the shared context warm after the last chart is disposed, releases it once idle, and recreates it on demand", () => {
    const context = createChartRenderContext();
    const charts = mountCharts(3, context);
    for (const chart of charts.slice(0, 2)) chart.dispose();
    expect(glContexts[0]!.releases).toBe(0);
    expect(context.chartCount).toBe(1);
    charts[2]!.dispose();
    expect(context.chartCount).toBe(0);
    // Warm: the context is still alive for the next chart.
    expect(glContexts[0]!.releases).toBe(0);

    // The idle period ends (here: forced) and the context is released.
    releaseWarm();
    expect(glContexts[0]!.releases).toBe(1);

    const again = mountCharts(1, context);
    expect(glContexts).toHaveLength(2);
    again[0]!.dispose();
    releaseWarm();
    expect(glContexts[1]!.releases).toBe(1);
  });

  it("hands the warm shared context, with its programs, to charts mounted right after the last one is disposed", () => {
    const context = createChartRenderContext();
    mountCharts(2, context).forEach((chart) => chart.dispose());
    expect(glContexts).toHaveLength(1);
    const next = mountCharts(2, context);
    expect(glContexts).toHaveLength(1);
    expect(context.chartCount).toBe(2);
    // The pending idle release must not take the context away from the new charts.
    releaseWarm();
    expect(glContexts[0]!.releases).toBe(0);
    raf.flush();
    expect(next.every((chart) => chart.getFrameStats().drawCalls > 0)).toBe(true);
    next.forEach((chart) => chart.dispose());
  });

  it("releases an idle context at once when asked with context.dispose()", () => {
    const context = createChartRenderContext();
    mountCharts(1, context).forEach((chart) => chart.dispose());
    expect(glContexts[0]!.releases).toBe(0);
    context.dispose();
    expect(glContexts[0]!.releases).toBe(1);
  });

  it("separate contexts do not share a WebGL context", () => {
    const first = createChartRenderContext();
    const second = createChartRenderContext();
    const a = mountCharts(1, first)[0]!;
    const b = mountCharts(1, second)[0]!;
    expect(glContexts).toHaveLength(2);
    a.dispose();
    first.dispose();
    expect(glContexts[0]!.releases).toBe(1);
    expect(glContexts[1]!.releases).toBe(0);
    b.dispose();
  });

  it("tells every chart about shared context loss and resumes drawing after restore", () => {
    const context = createChartRenderContext();
    const charts = mountCharts(3, context);
    raf.flush();
    const gl = glContexts[0]!;
    const lost = new window.Event("webglcontextlost", { cancelable: true });
    gl.lost = true;
    gl.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);

    blits.length = 0;
    for (const chart of charts) chart.requestRender();
    raf.flush();
    expect(blits).toHaveLength(0);

    gl.lost = false;
    gl.canvas.dispatchEvent(new window.Event("webglcontextrestored"));
    raf.flush();
    expect(glContexts[0]!.releases).toBe(0);
    expect(blits.length).toBeGreaterThanOrEqual(3);
    expect(context.chartCount).toBe(3);
    for (const chart of charts) chart.dispose();
    expect(context.chartCount).toBe(0);
    releaseWarm();
    expect(gl.releases).toBe(1);
  });

  it("linked charts put every panel on one WebGL context when given a shared renderer", async () => {
    const { createLinkedCharts } = await import("../../src/linked/LinkedCharts.ts");
    const context = createChartRenderContext();
    const linked = createLinkedCharts(target, { panels: Array.from({ length: 6 }, () => ({})), rows: 3, columns: 2, renderer: sharedRenderer(context) });
    expect(glContexts).toHaveLength(1);
    expect(linked.charts.every((chart) => chart.renderer === "shared")).toBe(true);
    expect(context.chartCount).toBe(6);
    linked.dispose();
    expect(context.chartCount).toBe(0);
    releaseWarm();
    expect(glContexts[0]!.releases).toBe(1);
  });
});
