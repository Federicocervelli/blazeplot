import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { countNodes, RecordingRenderer, FakeResizeObserver, setupDom, trackListeners } from "./fakes.ts";
import { chartRenderer, describeRecorded, installEngineDoubles, itRecorded } from "./engines.ts";
import type { FakeRaf, ListenerLedger, TestEnv } from "./fakes.ts";
import type { Chart as ChartType, ChartOptions } from "../../src/ui/Chart.ts";
import type { ChartPlugin, ChartPluginContext, ChartPluginHandle } from "../../src/ui/PluginTypes.ts";
import type { WebGL2UnavailableError as UnavailableErrorType } from "../../src/render/webgl2/availability.ts";

let env: TestEnv;
let raf: FakeRaf;
let Chart: typeof ChartType;
let WebGL2UnavailableError: typeof UnavailableErrorType;
let restoreEngineDoubles: () => void;

beforeAll(async () => {
  env = setupDom();
  restoreEngineDoubles = installEngineDoubles();
  raf = env.raf;
  ({ Chart } = await import("../../src/ui/Chart.ts"));
  ({ WebGL2UnavailableError } = await import("../../src/render/webgl2/availability.ts"));
});
afterAll(() => {
  restoreEngineDoubles();
  env.teardown();
});

let target: HTMLDivElement;
let backends: RecordingRenderer[];
let ledger: ListenerLedger;

function make(options: ChartOptions = {}): ChartType {
  return new Chart(target, {
    ...options,
    renderer: chartRenderer(backends),
  });
}

/** Root padding as "top right bottom left", normalizing CSS shorthand serialization. */
function padding(chart: ChartType): string {
  const parts = (chart.rootElement.style.padding || "0px").split(/\s+/);
  const t = parts[0] ?? "0px";
  const r = parts[1] ?? t;
  const b = parts[2] ?? t;
  const l = parts[3] ?? r;
  return `${t} ${r} ${b} ${l}`;
}

function fire(el: EventTarget, event: unknown): void {
  el.dispatchEvent(event as Event);
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
  backends = [];
  raf.pending.clear();
  FakeResizeObserver.instances = [];
  ledger = trackListeners();
});
afterEach(() => {
  ledger.restore();
  target.remove();
});

describe("Chart construct / dispose", () => {
  itRecorded("mounts DOM under the target and creates one engine", () => {
    const chart = make({ title: "Hello" });
    expect(target.children).toHaveLength(1);
    expect(target.firstElementChild).toBe(chart.rootElement);
    expect(chart.rootElement.contains(chartInternals(chart).canvas)).toBe(true);
    expect(backends).toHaveLength(1);
    expect(backends[0]!.disposeCount).toBe(0);
    chart.dispose();
  });

  itRecorded("removes DOM, listeners, observers, rAF callbacks, and backend resources on dispose", () => {
    const chart = make({ title: "T", axes: { x: true, y: true, y2: true } });
    chart.addLine({ capacity: 16 }).append({ x: 1, y: 2 });
    chart.start();
    expect(raf.pending.size).toBe(1);
    expect(ledger.net()).toBeGreaterThan(0);
    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observed.size).toBe(1);

    chart.dispose();

    expect(target.children).toHaveLength(0);
    expect(ledger.net()).toBe(0);
    expect(observer.disconnected).toBe(true);
    expect(raf.pending.size).toBe(0);
    expect(backends[0]!.disposeCount).toBe(1);
  });

  it("cancels a pending hover rAF on dispose", () => {
    const chart = make();
    fire(chartInternals(chart).canvas, new window.MouseEvent("pointermove", { clientX: 5, clientY: 5 }));
    chart.dispose();
    expect(raf.pending.size).toBe(0);
  });

  itRecorded("is idempotent", () => {
    const chart = make();
    chart.start();
    chart.dispose();
    expect(() => chart.dispose()).not.toThrow();
    expect(target.children).toHaveLength(0);
    expect(ledger.net()).toBe(0);
    expect(raf.pending.size).toBe(0);
    // The engine must only be disposed once.
    expect(backends[0]!.disposeCount).toBe(1);
  });

  itRecorded("hands the engine its own release: dispose reaches it exactly once", () => {
    const chart = make();
    chart.start();
    expect(backends[0]!.disposeCount).toBe(0);
    chart.dispose();
    chart.dispose();
    expect(backends[0]!.disposeCount).toBe(1);
  });

  itRecorded("still disposes cleanly when the engine throws on cleanup", () => {
    const chart = make();
    backends[0]!.dispose = () => {
      throw new Error("context is gone");
    };
    expect(() => chart.dispose()).not.toThrow();
    expect(target.children).toHaveLength(0);
  });

  it("does not schedule frames after dispose", () => {
    const chart = make({ renderLoop: "continuous" });
    chart.start();
    chart.dispose();
    chart.requestRender();
    expect(raf.pending.size).toBe(0);
  });

  itRecorded("repeated construct/dispose cycles leave no DOM, listeners, or backend resources behind", () => {
    const baselineNodes = countNodes(document.body);
    for (let i = 0; i < 25; i++) {
      const chart = make({ title: "x", axes: { x: true, y: true, y2: true } });
      chart.addLine({ capacity: 8 });
      chart.start();
      chart.dispose();
    }
    expect(countNodes(document.body)).toBe(baselineNodes);
    expect(ledger.net()).toBe(0);
    expect(raf.pending.size).toBe(0);
    expect(backends).toHaveLength(25);
    for (const backend of backends) expect(backend.disposeCount).toBe(1);
  });
});

describe("Chart rendering loop", () => {
  it("renders on the next frame after start and stops after stop()", () => {
    const chart = make();
    let renders = 0;
    chart.subscribe("render", () => renders++);
    chart.start();
    raf.flush();
    expect(renders).toBe(1);
    expect(raf.pending.size).toBe(0);
    chart.stop();
    chart.requestRender();
    expect(raf.pending.size).toBe(0);
    chart.dispose();
  });

  it("keeps a continuous loop alive", () => {
    const chart = make({ renderLoop: "continuous" });
    chart.start();
    raf.flush();
    expect(raf.pending.size).toBe(1);
    chart.dispose();
  });

  it("coalesces repeated requestRender calls into one frame", () => {
    const chart = make();
    chart.start();
    chart.requestRender();
    chart.requestRender();
    expect(raf.pending.size).toBe(1);
    chart.dispose();
  });
});

describe("Chart resize", () => {
  function stubSize(el: HTMLElement, width: number, height: number): void {
    Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
  }

  it("resizes the drawing buffer by CSS size times pixelRatio and reports whether it changed", () => {
    const chart = make();
    stubSize(chartInternals(chart).canvas, 300, 150);
    expect(chart.resize(2)).toBe(true);
    expect(chartInternals(chart).canvas.width).toBe(600);
    expect(chartInternals(chart).canvas.height).toBe(300);
    expect(chart.resize(2)).toBe(false);
    expect(chart.resize(1)).toBe(true);
    expect(chartInternals(chart).canvas.width).toBe(300);
    chart.dispose();
  });

  it("clamps degenerate sizes and non-finite pixelRatio to at least 1x1", () => {
    const chart = make();
    stubSize(chartInternals(chart).canvas, 0, 0);
    chart.resize(Number.NaN);
    expect(chartInternals(chart).canvas.width).toBe(1);
    expect(chartInternals(chart).canvas.height).toBe(1);
    chart.dispose();
  });

  it("resizes when the ResizeObserver fires on the plot element and requests a render", () => {
    const chart = make();
    chart.start();
    raf.flush();
    stubSize(chartInternals(chart).canvas, 400, 200);
    const observer = FakeResizeObserver.instances[0]!;
    expect([...observer.observed]).toEqual([chartInternals(chart).plotElement]);
    observer.trigger();
    expect(chartInternals(chart).canvas.width).toBe(Math.floor(400 * Math.max(1, globalThis.devicePixelRatio || 1)));
    expect(raf.pending.size).toBe(1);
    chart.dispose();
  });
});

describe("Chart frames", () => {
  itRecorded("finishes one engine frame per render regardless of series and chunk count", () => {
    const render = (seriesCount: number): { frames: number; draws: number } => {
      const chart = make({ grid: true });
      for (let i = 0; i < seriesCount; i++) {
        const mode = i % 4;
        const series = mode === 0 ? chart.addLine({ capacity: 64 }) : mode === 1 ? chart.addBar({ capacity: 64 }) : mode === 2 ? chart.addScatter({ capacity: 64 }) : chart.addArea({ capacity: 64 });
        for (let j = 0; j < 32; j++) series.append({ x: j, y: j + i });
      }
      chart.fitToData();
      chart.start();
      raf.flush();
      const backend = backends.at(-1)!;
      const stats = { frames: backend.frames, draws: backend.draws.length };
      chart.dispose();
      return stats;
    };

    const few = render(2);
    const many = render(40);
    expect(few.frames).toBe(1);
    expect(many.frames).toBe(1);
    expect(many.draws).toBeGreaterThan(few.draws);
  });
});

describe("Chart series churn", () => {
  it("returns DOM and listeners to baseline after add/remove loops", () => {
    const chart = make({ axes: { x: true, y: true, y2: true } });
    chart.start();
    raf.flush();
    const cycle = (): void => {
      const line = chart.addLine({ capacity: 32 });
      const bars = chart.addBar({ capacity: 32 });
      const scatter = chart.addScatter({ capacity: 32, yAxis: "right" });
      for (let j = 0; j < 5; j++) {
        line.append({ x: j, y: j });
        bars.append({ x: j, y: j });
        scatter.append({ x: j, y: j });
      }
      raf.flush();
      expect(chart.removeSeries(line)).toBe(true);
      expect(chart.removeSeries(bars)).toBe(true);
      expect(chart.removeSeries(scatter)).toBe(true);
    };
    cycle();
    const baselineNodes = countNodes(chart.rootElement);
    const baselineListeners = ledger.net();

    for (let i = 0; i < 200; i++) cycle();
    raf.flush();

    expect(chart.getSeriesState()).toHaveLength(0);
    expect(countNodes(chart.rootElement)).toBe(baselineNodes);
    expect(ledger.net()).toBe(baselineListeners);
    expect(raf.pending.size).toBeLessThanOrEqual(1);
    chart.dispose();
  });

  it("removeSeries returns false for already-removed series and keeps ordering of others", () => {
    const chart = make();
    chart.addLine({ capacity: 4, id: "a" });
    const b = chart.addLine({ capacity: 4, id: "b" });
    chart.addLine({ capacity: 4, id: "c" });
    expect(chart.removeSeries(b)).toBe(true);
    expect(chart.removeSeries(b)).toBe(false);
    expect(chart.getSeriesState().map((s) => s.id)).toEqual(["a", "c"]);
    expect(chart.getSeriesState().map((s) => s.index)).toEqual([0, 1]);
    chart.dispose();
  });

  itRecorded("does not draw removed series", () => {
    const chart = make({ grid: false });
    const series = chart.addLine({ capacity: 8 });
    series.append({ x: 0, y: 0 });
    series.append({ x: 1, y: 1 });
    chart.fitToData();
    chart.start();
    raf.flush();
    expect(backends[0]!.draws.length).toBeGreaterThan(0);
    chart.removeSeries(series);
    backends[0]!.draws = [];
    chart.requestRender();
    raf.flush();
    expect(backends[0]!.draws).toHaveLength(0);
    chart.dispose();
  });
});

describe("Chart events", () => {
  it("emits serieschange on add, remove, and visibility changes", () => {
    const chart = make();
    let count = 0;
    chart.subscribe("serieschange", () => count++);
    const series = chart.addLine({ capacity: 4 });
    expect(count).toBe(1);
    series.setVisible(false);
    expect(count).toBe(2);
    chart.removeSeries(series);
    expect(count).toBe(3);
    chart.removeSeries(series);
    expect(count).toBe(3);
    chart.dispose();
  });

  it("emits render once per frame and unsubscribe stops delivery", () => {
    const chart = make();
    let count = 0;
    const off = chart.subscribe("render", () => count++);
    chart.start();
    raf.flush();
    expect(count).toBe(1);
    off();
    chart.requestRender();
    raf.flush();
    expect(count).toBe(1);
    chart.dispose();
  });

  it("delivers plugin-emitted select events to chart subscribers and themechange on setTheme", () => {
    let ctx = null as ChartPluginContext | null;
    const chart = make({ plugins: [{ install: (c) => { ctx = c; } }] });
    const selections: unknown[] = [];
    let themed = 0;
    chart.subscribe("select", (e) => selections.push(e.selection));
    chart.subscribe("themechange", () => themed++);
    ctx!.events.emit("select", { selection: null });
    chart.setTheme();
    expect(selections).toEqual([null]);
    expect(themed).toBe(1);
    chart.dispose();
  });

  it("emits viewportchange when the viewport is set programmatically", () => {
    const chart = make();
    const seen: Array<{ xMin: number; xMax: number }> = [];
    chart.subscribe("viewportchange", (e) => seen.push({ xMin: e.viewport.xMin, xMax: e.viewport.xMax }));
    chart.setViewport({ xMin: 10, xMax: 20 });
    expect(seen.at(-1)).toEqual({ xMin: 10, xMax: 20 });
    chart.dispose();
  });

  it("delivers canvas click and dblclick as pointer events, and stops after dispose", () => {
    const chart = make();
    const clicks: string[] = [];
    chart.subscribe("click", (e) => clicks.push(e.type));
    chart.subscribe("dblclick", (e) => clicks.push(e.type));
    chartInternals(chart).canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fire(chartInternals(chart).canvas, new window.MouseEvent("click", { clientX: 50, clientY: 50 }));
    fire(chartInternals(chart).canvas, new window.MouseEvent("dblclick", { clientX: 50, clientY: 50 }));
    expect(clicks).toEqual(["click", "dblclick"]);
    chart.dispose();
    fire(chartInternals(chart).canvas, new window.MouseEvent("click", { clientX: 50, clientY: 50 }));
    expect(clicks).toHaveLength(2);
  });
});

describe("Chart plugins", () => {
  /** A plugin that records install, hook, and dispose calls under `name`. */
  function recorder(name: string, log: string[]): ChartPlugin {
    return {
      install() {
        log.push(`install ${name}`);
        const handle: ChartPluginHandle = {
          dispose: () => log.push(`dispose ${name}`),
          onResize: (size) => log.push(`resize ${name} ${size.width}x${size.height}`),
          onThemeChange: () => log.push(`theme ${name}`),
          onContextLost: () => log.push(`lost ${name}`),
          onContextRestored: () => log.push(`restored ${name}`),
        };
        return handle;
      },
    };
  }

  it("installs plugins and disposes function and handle forms exactly once", () => {
    const log: string[] = [];
    const fnPlugin: ChartPlugin = { install: () => () => log.push("fn") };
    const handlePlugin: ChartPlugin = { install: () => ({ dispose: () => log.push("handle") }) };
    const voidPlugin: ChartPlugin = { install: () => { log.push("void"); } };
    const chart = make({ plugins: [fnPlugin, handlePlugin, voidPlugin] });
    expect(log).toEqual(["void"]);
    chart.dispose();
    expect([...log].sort()).toEqual(["fn", "handle", "void"]);
    chart.dispose();
    expect(log).toHaveLength(3);
  });

  it("installs in registration order and disposes in reverse registration order", () => {
    const log: string[] = [];
    const chart = make({ plugins: [recorder("a", log), recorder("b", log), recorder("c", log)] });
    expect(log).toEqual(["install a", "install b", "install c"]);
    log.length = 0;
    chart.dispose();
    expect(log).toEqual(["dispose c", "dispose b", "dispose a"]);
  });

  itRecorded("runs lifecycle hooks in registration order, onThemeChange before the themechange event", () => {
    const log: string[] = [];
    const chart = make({ plugins: [recorder("a", log), recorder("b", log)] });
    chart.subscribe("themechange", () => log.push("event themechange"));
    log.length = 0;

    chart.setTheme();
    Object.defineProperty(chartInternals(chart).canvas, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(chartInternals(chart).canvas, "clientHeight", { configurable: true, value: 160 });
    chart.resize(1);
    backends[0]!.lose();
    backends[0]!.restore();

    expect(log).toEqual([
      "theme a", "theme b", "event themechange",
      "resize a 320x160", "resize b 320x160",
      "lost a", "lost b",
      "restored a", "restored b",
    ]);
    chart.dispose();
  });

  it("isolates a throwing hook so later plugins still run", () => {
    const log: string[] = [];
    const error = spyOn(console, "error").mockImplementation(() => {});
    const chart = make({
      plugins: [
        { install: () => ({ onThemeChange: () => { throw new Error("boom"); } }) },
        recorder("b", log),
      ],
    });
    chart.setTheme();
    expect(log).toContain("theme b");
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    chart.dispose();
  });

  it("does not call hooks on a plugin disposed individually", () => {
    const log: string[] = [];
    const chart = make();
    const dispose = chartInternals(chart).installPlugin(recorder("a", log));
    dispose();
    chart.setTheme();
    expect(log).toEqual(["install a", "dispose a"]);
    chart.dispose();
    expect(log).toEqual(["install a", "dispose a"]);
  });

  itRecorded("a throwing plugin disposer does not stop later disposers or chart cleanup", () => {
    const log: string[] = [];
    const chart = make({
      plugins: [
        { install: () => () => log.push("first") },
        { install: () => () => { throw new Error("boom"); } },
      ],
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    expect(() => chart.dispose()).not.toThrow();
    expect(error.mock.calls.some((call) => String(call[0]).includes("plugin dispose failed"))).toBe(true);
    error.mockRestore();
    expect(log).toEqual(["first"]);
    expect(target.children).toHaveLength(0);
    expect(backends[0]!.disposeCount).toBe(1);
  });

  itRecorded("a plugin that throws during install tears down the already-built chart", () => {
    const log: string[] = [];
    expect(() =>
      make({
        plugins: [
          { install: () => () => log.push("first") },
          {
            install(ctx) {
              ctx.dom.mount("plot", document.createElement("div"));
              ctx.dom.listen("plot", "pointermove", () => {});
              throw new Error("install failed");
            },
          },
        ],
      }),
    ).toThrow("install failed");
    expect(log).toEqual(["first"]);
    expect(target.children).toHaveLength(0);
    expect(ledger.net()).toBe(0);
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
    expect(backends[0]!.disposeCount).toBe(1);
  });

  it("sums layout reservations from every plugin as root padding and releases them", () => {
    const releases: Array<() => void> = [];
    const chart = make({
      plugins: [
        { install: (ctx) => { releases.push(ctx.layout.reserve({ top: 10, left: 4 })); } },
        { install: (ctx) => { releases.push(ctx.layout.reserve({ bottom: 20, top: 5, right: -5 })); } },
      ],
    });
    expect(padding(chart)).toBe("15px 0px 20px 4px");
    releases[0]!();
    expect(padding(chart)).toBe("5px 0px 20px 0px");
    releases[0]!();
    expect(padding(chart)).toBe("5px 0px 20px 0px");
    releases[1]!();
    expect(padding(chart)).toBe("0px 0px 0px 0px");
    chart.dispose();
  });

  it("gives each plugin its own context and releases context resources after dispose", () => {
    const contexts: ChartPluginContext[] = [];
    let renders = 0;
    let moves = 0;
    const node = document.createElement("div");
    const chart = make({
      plugins: [
        {
          install(ctx) {
            contexts.push(ctx);
            ctx.layout.reserve({ bottom: 12 });
            ctx.events.subscribe("render", () => renders++);
            ctx.dom.mount("root", node);
            ctx.dom.listen("plot", "pointermove", () => moves++);
            ctx.dom.decorate("axis-x", { style: { cursor: "ew-resize" }, classes: ["my-axis"], attributes: { "data-plugin": "x" } });
            // No cleanup returned: the context releases everything it handed out.
          },
        },
        { install: (ctx) => { contexts.push(ctx); } },
      ],
    });
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(contexts[0]).not.toBe(chart as unknown);
    expect(padding(chart)).toBe("0px 0px 12px 0px");
    expect(node.parentElement).toBe(chart.rootElement);
    expect(chartInternals(chart).xAxisElement.style.cursor).toBe("ew-resize");
    expect(chartInternals(chart).xAxisElement.classList.contains("my-axis")).toBe(true);
    expect(chartInternals(chart).xAxisElement.getAttribute("data-plugin")).toBe("x");
    fire(chartInternals(chart).canvas, new window.PointerEvent("pointermove", { clientX: 1, clientY: 1 }));
    expect(moves).toBe(1);

    chart.dispose();
    expect(padding(chart)).toBe("0px 0px 0px 0px");
    expect(node.parentElement).toBeNull();
    expect(chartInternals(chart).xAxisElement.style.cursor).toBe("");
    expect(chartInternals(chart).xAxisElement.classList.contains("my-axis")).toBe(false);
    expect(chartInternals(chart).xAxisElement.hasAttribute("data-plugin")).toBe(false);
    expect(renders).toBe(0);
    expect(ledger.net()).toBe(0);
  });

  it("decorations restore the previous values, so undoing in reverse order is exact", () => {
    let ctx = null as ChartPluginContext | null;
    const chart = make({ plugins: [{ install: (c) => { ctx = c; } }] });
    const axis = chartInternals(chart).yAxisElement;
    const before = axis.style.pointerEvents;
    const undoOuter = ctx!.dom.decorate("axis-y", { style: { pointerEvents: "auto", filter: "blur(1px)" } });
    const undoInner = ctx!.dom.decorate("axis-y", { style: { filter: "brightness(2)" } });
    expect(axis.style.filter).toBe("brightness(2)");
    undoInner();
    expect(axis.style.filter).toBe("blur(1px)");
    undoOuter();
    expect(axis.style.pointerEvents).toBe(before);
    expect(axis.style.filter).toBe("");
    chart.dispose();
  });

  it("exposes coordinates, viewport, state, geometry, and the unstable escape hatches", () => {
    let ctx = null as ChartPluginContext | null;
    const chart = make({ plugins: [{ install: (c) => { ctx = c; } }] });
    chartInternals(chart).canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 200, right: 410, bottom: 220, x: 10, y: 20, toJSON() {} }) as DOMRect;
    const c = ctx!;
    c.viewport.set({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    expect(c.viewport.get()).toMatchObject({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    expect(c.layout.plotRect()).toEqual({ left: 10, top: 20, width: 400, height: 200 });
    expect(c.coords.clientToPlot(110, 70)).toEqual([100, 50]);
    expect(c.coords.plotToClient(100, 50)).toEqual([110, 70]);
    expect(c.coords.clientToData(210, 120)).toEqual([50, 5]);
    expect(c.coords.clientToData(0, 0)).toBeNull();
    expect(c.viewport.isReversed("x")).toBe(false);
    expect(c.viewport.getFollowXState()).toBe("off");
    c.viewport.followX({ window: 10 });
    expect(c.viewport.getFollowXState()).toBe("following");
    c.viewport.setFollowXPaused(true);
    expect(c.viewport.getFollowXState()).toBe("paused");
    c.viewport.stopFollowX();
    expect(c.viewport.getFollowXState()).toBe("off");
    expect(c.state.getSeries()).toEqual([]);
    expect(c.state.getHover()).toBeNull();
    expect(c.state.getFrameStats().renderMode).toBe("none");
    expect(c.theme).toBe(chart.theme);
    expect(c.dom.contains(chartInternals(chart).canvas)).toBe(true);
    expect(c.dom.contains(document.body)).toBe(false);
    expect(c.unstable.canvas).toBe(chartInternals(chart).canvas);
    expect(c.unstable.element("plot")).toBe(chartInternals(chart).plotElement);
    expect(c.unstable.element("body")).toBe(document.body);
    expect(c.unstable.getCamera("right")).toBe(chartInternals(chart).getCamera("right"));
    chart.dispose();
  });
});

describeRecorded("Chart WebGL2 availability", () => {
  it("throws WebGL2UnavailableError with the default backend when no context exists", () => {
    expect(() => new Chart(target)).toThrow(WebGL2UnavailableError);
  });

  it("removes the half-built DOM and releases listeners when the backend cannot be created", () => {
    expect(() => new Chart(target)).toThrow();
    expect(target.children).toHaveLength(0);
    expect(ledger.net()).toBe(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  itRecorded("restores a caller-supplied canvas when construction fails", () => {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width: 10px;";
    target.appendChild(canvas);
    expect(() => new Chart(canvas)).toThrow(WebGL2UnavailableError);
    expect(canvas.parentElement).toBe(target);
    expect(canvas.style.cssText).toBe("width: 10px;");
    expect(target.querySelector(".blazeplot-root")).toBeNull();
  });

});

describeRecorded("Chart context loss", () => {
  function lose(): void {
    backends.at(-1)!.lose();
  }
  function restore(): void {
    backends.at(-1)!.restore();
  }
  function withData(chart: ChartType): void {
    const series = chart.addLine({ capacity: 8 });
    series.append({ x: 0, y: 0 });
    series.append({ x: 1, y: 1 });
    chart.fitToData();
  }

  itRecorded("stops drawing when the engine reports loss, tells plugins, and skips frames until restoration", () => {
    const log: string[] = [];
    const chart = make({ grid: false, plugins: [{ install: () => ({ onContextLost: () => log.push("lost"), onContextRestored: () => log.push("restored") }) }] });
    withData(chart);
    chart.start();
    raf.flush();
    let renders = 0;
    chart.subscribe("render", () => renders++);

    lose();
    expect(log).toEqual(["lost"]);
    backends[0]!.draws = [];
    chart.requestRender();
    raf.flush();
    expect(renders).toBe(0);
    expect(backends[0]!.draws).toHaveLength(0);
    chart.dispose();
  });

  itRecorded("renders again after the engine reports restoration, on the same engine", () => {
    const log: string[] = [];
    const chart = make({ grid: false, plugins: [{ install: () => ({ onContextLost: () => log.push("lost"), onContextRestored: () => log.push("restored") }) }] });
    withData(chart);
    chart.start();
    raf.flush();

    lose();
    restore();

    expect(backends).toHaveLength(1);
    expect(log).toEqual(["lost", "restored"]);
    let renders = 0;
    chart.subscribe("render", () => renders++);
    raf.flush();
    expect(renders).toBe(1);
    expect(backends[0]!.draws.length).toBeGreaterThan(0);

    chart.dispose();
    expect(backends[0]!.disposeCount).toBe(1);
    expect(raf.pending.size).toBe(0);
  });

  itRecorded("detects a lost engine during render and does not emit render", () => {
    const chart = make();
    chart.start();
    backends[0]!.lost = true;
    let renders = 0;
    chart.subscribe("render", () => renders++);
    raf.flush();
    expect(renders).toBe(0);
    chart.dispose();
  });

  itRecorded("ignores engine notifications after dispose", () => {
    const log: string[] = [];
    const chart = make({ plugins: [{ install: () => ({ onContextLost: () => log.push("lost") }) }] });
    chart.dispose();
    lose();
    expect(log).toEqual([]);
  });

  itRecorded("cancels the post-restore render if the context is lost again or the chart is disposed", () => {
    const chart = make();
    lose();
    restore();
    expect(raf.pending.size).toBe(1);
    lose();
    expect(raf.pending.size).toBe(0);
    restore();
    expect(raf.pending.size).toBe(1);
    chart.dispose();
    expect(raf.pending.size).toBe(0);
  });
});

describe("Plugin access to the rendering engine", () => {
  /** Install a no-op plugin and return its context. */
  function contextOf(chart: ChartType): ChartPluginContext {
    let captured: ChartPluginContext | null = null;
    chartInternals(chart).installPlugin({ install: (ctx) => void (captured = ctx) });
    return captured!;
  }

  it("shows the engine in use through the stable ctx.renderer", () => {
    const chart = make();
    const ctx = contextOf(chart);
    expect(ctx.renderer).toBe(chart.rendererInfo);
    expect(ctx.renderer.name).toBe(chart.renderer);
    expect(Object.isFrozen(ctx.renderer)).toBe(true);
    chart.dispose();
  });

  it("hands out render surfaces on the chart's engine and releases them with the plugin and the chart", () => {
    const chart = make();
    const ctx = contextOf(chart);
    const surface = ctx.unstable.createRenderSurface(document.createElement("canvas"));
    expect(() => {
      surface.beginFrame(10, 10, 1);
      surface.fillRects(new Float32Array([0, 0, 5, 5, 1, 1, 1, 1]), 1);
      surface.endFrame();
    }).not.toThrow();
    expect(surface.isLost).toBe(false);
    chart.dispose();
    expect(() => surface.dispose()).not.toThrow();
  });

  itRecorded("disposes a surface exactly once however many times it is released", () => {
    const chart = make();
    const ctx = contextOf(chart);
    const surface = ctx.unstable.createRenderSurface(document.createElement("canvas"));
    surface.dispose();
    chart.dispose();
    expect(backends[0]!.surfaces[0]!.disposeCount).toBe(1);
  });
});

describe("Chart overlays and screenshot", () => {
  it("renders title and axis title text into chart-root DOM overlays", () => {
    const chart = make({ title: "My Title", subtitle: "Sub", axes: { x: { title: "Time" }, y: { title: "Value" } } });
    const text = chart.rootElement.textContent ?? "";
    expect(text).toContain("My Title");
    expect(text).toContain("Sub");
    expect(text).toContain("Time");
    expect(text).toContain("Value");
    chart.dispose();
  });

  it("populates axis tick labels under the root after a frame", () => {
    const chart = make();
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    chart.start();
    raf.flush();
    expect(chartInternals(chart).xAxisElement.children.length + chartInternals(chart).yAxisElement.children.length).toBeGreaterThan(0);
    chart.dispose();
  });

  it("screenshot renders a frame first, then composes from the chart root", async () => {
    // The 2D-canvas compositor needs real canvas support, which the DOM shim lacks, so only the
    // pre-compose behaviour is asserted here; overlay-text inclusion is covered by browser tests.
    const chart = make({ title: "Shot" });
    let renders = 0;
    chart.subscribe("render", () => renders++);
    await chart.screenshot({ width: 10, height: 10 }).catch(() => undefined);
    expect(renders).toBe(1);
    chart.dispose();
  });
});
