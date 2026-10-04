import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { countNodes, FakeBackend, FakeResizeObserver, setupDom, trackListeners } from "./fakes.ts";
import type { FakeRaf, ListenerLedger, TestEnv } from "./fakes.ts";
import type { Chart as ChartType, ChartOptions, ChartPlugin } from "../../src/ui/Chart.ts";
import type { WebGL2UnavailableError as UnavailableErrorType } from "../../src/render/WebGL2Backend.ts";

let env: TestEnv;
let raf: FakeRaf;
let Chart: typeof ChartType;
let WebGL2UnavailableError: typeof UnavailableErrorType;

beforeAll(async () => {
  env = setupDom();
  raf = env.raf;
  ({ Chart } = await import("../../src/ui/Chart.ts"));
  ({ WebGL2UnavailableError } = await import("../../src/render/WebGL2Backend.ts"));
});
afterAll(() => env.teardown());

let target: HTMLDivElement;
let backends: FakeBackend[];
let ledger: ListenerLedger;

function make(options: ChartOptions = {}): ChartType {
  return new Chart(target, {
    ...options,
    backendFactory: (ctx) => {
      const backend = new FakeBackend(ctx.canvas);
      backends.push(backend);
      return backend;
    },
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
  it("mounts DOM under the target and creates a fixed set of GPU buffers", () => {
    const chart = make({ title: "Hello" });
    expect(target.children).toHaveLength(1);
    expect(target.firstElementChild).toBe(chart.rootElement);
    expect(chart.rootElement.contains(chart.canvas)).toBe(true);
    expect(backends).toHaveLength(1);
    expect(backends[0]!.liveBuffers.size).toBe(3);
    chart.dispose();
  });

  it("removes DOM, listeners, observers, rAF callbacks, and backend resources on dispose", () => {
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
    expect(backends[0]!.destroyCount).toBeGreaterThanOrEqual(1);
    expect(backends[0]!.liveResourceCount).toBe(0);
  });

  it("cancels a pending hover rAF on dispose", () => {
    const chart = make();
    fire(chart.canvas, new window.MouseEvent("pointermove", { clientX: 5, clientY: 5 }));
    chart.dispose();
    expect(raf.pending.size).toBe(0);
  });

  it("is idempotent", () => {
    const chart = make();
    chart.start();
    chart.dispose();
    expect(() => chart.dispose()).not.toThrow();
    expect(target.children).toHaveLength(0);
    expect(ledger.net()).toBe(0);
    expect(raf.pending.size).toBe(0);
    // The backend must only be torn down once.
    expect(backends[0]!.destroyCount).toBe(1);
  });

  it("does not schedule frames after dispose", () => {
    const chart = make({ renderLoop: "continuous" });
    chart.start();
    chart.dispose();
    chart.requestRender();
    expect(raf.pending.size).toBe(0);
  });

  it("repeated construct/dispose cycles leave no DOM, listeners, or backend resources behind", () => {
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
    for (const backend of backends) expect(backend.liveResourceCount).toBe(0);
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

  it("resizes the drawing buffer by CSS size times dpr and reports whether it changed", () => {
    const chart = make();
    stubSize(chart.canvas, 300, 150);
    expect(chart.resize(2)).toBe(true);
    expect(chart.canvas.width).toBe(600);
    expect(chart.canvas.height).toBe(300);
    expect(chart.resize(2)).toBe(false);
    expect(chart.resize(1)).toBe(true);
    expect(chart.canvas.width).toBe(300);
    chart.dispose();
  });

  it("clamps degenerate sizes and non-finite dpr to at least 1x1", () => {
    const chart = make();
    stubSize(chart.canvas, 0, 0);
    chart.resize(Number.NaN);
    expect(chart.canvas.width).toBe(1);
    expect(chart.canvas.height).toBe(1);
    chart.dispose();
  });

  it("resizes when the ResizeObserver fires on the plot element and requests a render", () => {
    const chart = make();
    chart.start();
    raf.flush();
    stubSize(chart.canvas, 400, 200);
    const observer = FakeResizeObserver.instances[0]!;
    expect([...observer.observed]).toEqual([chart.plotElement]);
    observer.trigger();
    expect(chart.canvas.width).toBe(Math.floor(400 * Math.max(1, globalThis.devicePixelRatio || 1)));
    expect(raf.pending.size).toBe(1);
    chart.dispose();
  });
});

describe("Chart series churn", () => {
  it("returns GPU resource counts and DOM to baseline after add/remove loops", () => {
    const chart = make({ axes: { x: true, y: true, y2: true } });
    chart.start();
    raf.flush();
    const backend = backends[0]!;
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
    // Warm-up: the renderer lazily allocates shared buffers (e.g. static quad corners) once.
    cycle();
    const baselineBuffers = backend.liveBuffers.size;
    const baselineCreated = backend.createdBuffers;
    const baselinePrograms = backend.livePrograms.size;
    const baselineNodes = countNodes(chart.rootElement);
    const baselineListeners = ledger.net();

    for (let i = 0; i < 200; i++) cycle();
    raf.flush();

    expect(chart.getSeriesState()).toHaveLength(0);
    expect(backend.liveBuffers.size).toBe(baselineBuffers);
    expect(backend.createdBuffers).toBe(baselineCreated);
    expect(backend.livePrograms.size).toBe(baselinePrograms);
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

  it("does not draw removed series", () => {
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

  it("emits select with the payload and themechange on setTheme", () => {
    const chart = make();
    const selections: unknown[] = [];
    let themed = 0;
    chart.subscribe("select", (e) => selections.push(e.selection));
    chart.subscribe("themechange", () => themed++);
    chart.emitSelect(null);
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
    chart.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fire(chart.canvas, new window.MouseEvent("click", { clientX: 50, clientY: 50 }));
    fire(chart.canvas, new window.MouseEvent("dblclick", { clientX: 50, clientY: 50 }));
    expect(clicks).toEqual(["click", "dblclick"]);
    chart.dispose();
    fire(chart.canvas, new window.MouseEvent("click", { clientX: 50, clientY: 50 }));
    expect(clicks).toHaveLength(2);
  });
});

describe("Chart plugins", () => {
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

  it("a throwing plugin disposer does not stop later disposers or chart cleanup", () => {
    const log: string[] = [];
    const chart = make({
      plugins: [
        { install: () => () => { throw new Error("boom"); } },
        { install: () => () => log.push("second") },
      ],
    });
    expect(() => chart.dispose()).not.toThrow();
    expect(log).toEqual(["second"]);
    expect(target.children).toHaveLength(0);
    expect(backends[0]!.destroyCount).toBe(1);
  });

  it("a plugin that throws during install tears down the already-built chart", () => {
    const log: string[] = [];
    expect(() =>
      make({
        plugins: [
          { install: () => () => log.push("first") },
          { install: () => { throw new Error("install failed"); } },
        ],
      }),
    ).toThrow("install failed");
    expect(log).toEqual(["first"]);
    expect(target.children).toHaveLength(0);
    expect(ledger.net()).toBe(0);
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
    expect(backends[0]!.liveResourceCount).toBe(0);
  });

  it("sums layout reservations as root padding and releases them", () => {
    const chart = make();
    chart.setLayoutReservation("legend", { top: 10, left: 4 });
    chart.setLayoutReservation("nav", { bottom: 20, top: 5 });
    expect(padding(chart)).toBe("15px 0px 20px 4px");
    chart.setLayoutReservation("legend", null);
    expect(padding(chart)).toBe("5px 0px 20px 0px");
    chart.setLayoutReservation("nav", null);
    expect(padding(chart)).toBe("0px 0px 0px 0px");
    chart.dispose();
  });

  it("replacing a reservation under the same id does not accumulate, and negatives are ignored", () => {
    const chart = make();
    chart.setLayoutReservation("a", { top: 10 });
    chart.setLayoutReservation("a", { top: 30, right: -5 });
    expect(padding(chart)).toBe("30px 0px 0px 0px");
    chart.dispose();
  });

  it("plugins receive the chart as context and can release subscriptions and reservations on dispose", () => {
    let ctx: unknown;
    let calls = 0;
    const chart = make({
      plugins: [{
        install(c) {
          ctx = c;
          c.setLayoutReservation("p", { bottom: 12 });
          const unsub = c.subscribe("render", () => calls++);
          return () => {
            unsub();
            c.setLayoutReservation("p", null);
          };
        },
      }],
    });
    expect(ctx).toBe(chart);
    expect(padding(chart)).toBe("0px 0px 12px 0px");
    chart.dispose();
    expect(padding(chart)).toBe("0px 0px 0px 0px");
    expect(calls).toBe(0);
  });
});

describe("Chart WebGL2 availability", () => {
  it("throws WebGL2UnavailableError with the default backend when no context exists", () => {
    expect(() => new Chart(target)).toThrow(WebGL2UnavailableError);
  });

  it("removes the half-built DOM and releases listeners when the backend cannot be created", () => {
    expect(() => new Chart(target)).toThrow();
    expect(target.children).toHaveLength(0);
    expect(ledger.net()).toBe(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it("restores a caller-supplied canvas when construction fails", () => {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width: 10px;";
    target.appendChild(canvas);
    expect(() => new Chart(canvas)).toThrow(WebGL2UnavailableError);
    expect(canvas.parentElement).toBe(target);
    expect(canvas.style.cssText).toBe("width: 10px;");
    expect(target.querySelector(".blazeplot-root")).toBeNull();
  });

  it("disposes the backend and DOM when buffer creation fails", () => {
    const backend = new FakeBackend();
    backend.createBuffer = () => { throw new Error("out of memory"); };
    expect(() => new Chart(target, { backendFactory: () => backend })).toThrow("out of memory");
    expect(backend.destroyCount).toBe(1);
    expect(target.children).toHaveLength(0);
  });
});

describe("Chart WebGL context loss", () => {
  function lose(chart: ChartType): Event {
    const event = new window.Event("webglcontextlost", { cancelable: true }) as unknown as Event;
    fire(chart.canvas, event);
    return event;
  }
  function restore(chart: ChartType): void {
    fire(chart.canvas, new window.Event("webglcontextrestored"));
  }
  function withData(chart: ChartType): void {
    const series = chart.addLine({ capacity: 8 });
    series.append({ x: 0, y: 0 });
    series.append({ x: 1, y: 1 });
    chart.fitToData();
  }

  it("prevents default on loss and skips drawing until restoration", () => {
    const chart = make({ grid: false });
    withData(chart);
    chart.start();
    let renders = 0;
    chart.subscribe("render", () => renders++);

    const event = lose(chart);
    expect(event.defaultPrevented).toBe(true);
    chart.requestRender();
    raf.flush();
    expect(renders).toBe(0);
    expect(backends[0]!.draws).toHaveLength(0);
    chart.dispose();
  });

  it("recreates GPU resources on restore, disposes the old backend, and renders again", () => {
    const chart = make({ grid: false });
    withData(chart);
    chart.start();
    raf.flush();
    const old = backends[0]!;

    lose(chart);
    restore(chart);

    expect(backends).toHaveLength(2);
    const fresh = backends[1]!;
    expect(old.destroyCount).toBe(1);
    expect(fresh.liveBuffers.size).toBe(3);
    let renders = 0;
    chart.subscribe("render", () => renders++);
    raf.flush();
    expect(renders).toBe(1);
    expect(fresh.draws.length).toBeGreaterThan(0);

    chart.dispose();
    expect(fresh.destroyCount).toBe(1);
    expect(old.destroyCount).toBe(1);
    expect(raf.pending.size).toBe(0);
  });

  it("detects a lost context during render via isContextLost and does not emit render", () => {
    const chart = make();
    chart.start();
    backends[0]!.contextLost = true;
    let renders = 0;
    chart.subscribe("render", () => renders++);
    raf.flush();
    expect(renders).toBe(0);
    chart.dispose();
  });

  it("stays lost and logs when restoration cannot recreate resources", () => {
    let calls = 0;
    const chart = new Chart(target, {
      backendFactory: (ctx) => {
        calls++;
        if (calls > 1) throw new WebGL2UnavailableError();
        const backend = new FakeBackend(ctx.canvas);
        backends.push(backend);
        return backend;
      },
    });
    const errors = spyOn(console, "error").mockImplementation(() => {});
    lose(chart);
    expect(() => restore(chart)).not.toThrow();
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    expect(backends[0]!.destroyCount).toBe(0);
    chart.dispose();
    expect(backends[0]!.destroyCount).toBe(1);
  });

  it("cancels the post-restore render if the context is lost again or the chart is disposed", () => {
    const chart = make();
    lose(chart);
    restore(chart);
    expect(raf.pending.size).toBe(1);
    lose(chart);
    expect(raf.pending.size).toBe(0);
    restore(chart);
    expect(raf.pending.size).toBe(1);
    chart.dispose();
    expect(raf.pending.size).toBe(0);
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
    expect(chart.xAxisElement.children.length + chart.yAxisElement.children.length).toBeGreaterThan(0);
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
