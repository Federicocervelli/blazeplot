import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { FakeGl } from "../render/fakeGl.ts";
import { FakeResizeObserver } from "./fakes.ts";
import { fire, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

/** Context doubles for the real engines, whatever engine the rest of the UI suites run on. */
let restoreGetContext: () => void;
beforeAll(() => {
  const proto = window.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const original = proto.getContext;
  const gls = new WeakMap<object, FakeGl>();
  const ctx2d = new Proxy({ canvas: null, measureText: () => ({ width: 5 }), isContextLost: () => false } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : () => undefined),
    set: () => true,
  });
  proto.getContext = function (this: object, kind: string): unknown {
    if (kind === "2d") return ctx2d;
    if (kind !== "webgl2") return null;
    let gl = gls.get(this);
    if (!gl) gls.set(this, (gl = new FakeGl()));
    return gl;
  };
  restoreGetContext = () => {
    proto.getContext = original;
  };
});
afterAll(() => restoreGetContext());

/** Count layout reads (`clientWidth`, `clientHeight`, `getBoundingClientRect`) on every canvas while `run` executes. */
function countCanvasLayoutReads(run: () => void): number {
  const proto = window.HTMLCanvasElement.prototype;
  const widthGetter = Object.getOwnPropertyDescriptor(proto, "clientWidth")!.get!;
  const heightGetter = Object.getOwnPropertyDescriptor(proto, "clientHeight")!.get!;
  const rectRead = proto.getBoundingClientRect;
  let reads = 0;
  Object.defineProperty(proto, "clientWidth", { configurable: true, get() { reads++; return widthGetter.call(this); } });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get() { reads++; return heightGetter.call(this); } });
  proto.getBoundingClientRect = function (this: HTMLCanvasElement) { reads++; return rectRead.call(this); };
  try {
    run();
  } finally {
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: widthGetter });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: heightGetter });
    proto.getBoundingClientRect = rectRead;
  }
  return reads;
}

/** Change the laid-out size of a canvas without telling the chart (a browser would, via its ResizeObserver). */
function setLayoutSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: height });
}

async function chartClass(): Promise<typeof import("../../src/ui/Chart.ts").Chart> {
  return (await import("../../src/ui/Chart.ts")).Chart;
}

describe("chart constructor", () => {
  it("reads no layout for engines that can be sized later, so many charts share one layout", async () => {
    const Chart = await chartClass();
    for (const renderer of ["canvas2d", "shared"] as const) {
      const charts: Array<InstanceType<typeof Chart>> = [];
      const reads = countCanvasLayoutReads(() => {
        for (let i = 0; i < 10; i++) {
          const chart = new Chart(h.target(), { renderer, axes: { x: true, y: true } });
          chart.addLine({ capacity: 4 }).append({ x: 1, y: 2 });
          chart.start();
          charts.push(chart);
        }
      });
      expect(reads).toBe(0);
      for (const chart of charts) chart.dispose();
    }
  });

  it("sizes the canvas before a WebGL2 context is created on it", async () => {
    const Chart = await chartClass();
    const reads = countCanvasLayoutReads(() => {
      new Chart(h.target(), { renderer: "webgl2", axes: { x: true, y: true } }).dispose();
    });
    expect(reads).toBeGreaterThan(0);
  });

  it("sizes the drawing buffer from layout on the first frame", async () => {
    const Chart = await chartClass();
    const chart = new Chart(h.target(), { renderer: "canvas2d", axes: { x: true, y: true } });
    const canvas = chartInternals(chart).canvas;
    setLayoutSize(canvas, 320, 180);
    expect(canvas.width).not.toBe(320);
    chart.start();
    h.raf.flush();
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
    chart.dispose();
  });

  it("reads no layout in later frames or hover refreshes, which would force a flush after other charts' DOM writes", async () => {
    const Chart = await chartClass();
    const chart = new Chart(h.target(), { renderer: "canvas2d", axes: { x: true, y: true } });
    chart.addLine({ capacity: 4 }).append({ x: 1, y: 2 });
    chart.start();
    h.raf.flush();
    const canvas = chartInternals(chart).canvas;
    const reads = countCanvasLayoutReads(() => {
      for (let i = 0; i < 5; i++) {
        chart.setViewport({ xMin: i, xMax: i + 10 });
        fire(canvas, pointerEvent("pointermove", 100, 50, { offsetX: 100, offsetY: 50 }));
        h.raf.flush();
      }
    });
    expect(reads).toBe(0);
    chart.dispose();
  });

  it("takes the plot size from the resize path, so a ResizeObserver notification is enough", async () => {
    const Chart = await chartClass();
    const chart = new Chart(h.target(), { renderer: "canvas2d", axes: { x: true, y: true } });
    chart.start();
    h.raf.flush();
    const canvas = chartInternals(chart).canvas;
    setLayoutSize(canvas, 200, 100);
    FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!.trigger();
    h.raf.flush();
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    chart.dispose();
  });

  it("does not let the first frame override an explicit resize", async () => {
    const Chart = await chartClass();
    const chart = new Chart(h.target(), { renderer: "canvas2d", axes: { x: true, y: true } });
    const canvas = chartInternals(chart).canvas;
    setLayoutSize(canvas, 320, 180);
    expect(chart.resize(1)).toBe(true);
    expect(canvas.width).toBe(320);
    chart.start();
    h.raf.flush();
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
    chart.dispose();
  });
});
