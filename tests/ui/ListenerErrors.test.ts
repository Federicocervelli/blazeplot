import { describe, expect, it, spyOn } from "bun:test";
import { fire, installPlugin, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function seeded() {
  const chart = h.make();
  const series = chart.addLine({ capacity: 32, name: "A" });
  for (let x = 0; x <= 10; x++) series.append({ x, y: x * 10 });
  chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
  return chart;
}

const logged = (error: { mock: { calls: unknown[][] } }, text: string): boolean =>
  error.mock.calls.some((call) => String(call[0]).includes(text));

describe("chart event listener isolation", () => {
  it("keeps calling later hover listeners after one throws and logs the error", () => {
    const chart = seeded();
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: unknown[] = [];
      chart.subscribe("hover", () => { throw new Error("bad hover"); });
      chart.subscribe("hover", (state) => seen.push(state));
      fire(chart.canvas, pointerEvent("pointermove", 200, 100));
      h.raf.flush();
      expect(seen.length).toBeGreaterThan(0);
      expect(logged(error, "hover listener failed")).toBe(true);
    } finally {
      error.mockRestore();
      chart.dispose();
    }
  });

  it("still sets frame stats and refreshes hover when a render listener throws", () => {
    const chart = seeded();
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      fire(chart.canvas, pointerEvent("pointermove", 200, 100));
      chart.start();
      h.raf.flush();
      const hovers: unknown[] = [];
      chart.subscribe("render", () => { throw new Error("bad render"); });
      chart.subscribe("hover", (state) => hovers.push(state));
      // Hover only fires when the picked values change, so move the hovered sample.
      chart.getSeriesState()[0]!.series.updateAt(5, { x: 5, y: 55 });
      chart.requestRender();
      expect(() => h.raf.flush()).not.toThrow();
      expect(hovers.length).toBeGreaterThan(0);
      expect(logged(error, "render listener failed")).toBe(true);
    } finally {
      error.mockRestore();
      chart.dispose();
    }
  });

  it("still renders after a pan when a viewportchange listener throws", () => {
    const chart = seeded();
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      chart.start();
      h.raf.flush();
      let renders = 0;
      chart.subscribe("render", () => renders++);
      chart.subscribe("viewportchange", () => { throw new Error("bad viewport"); });
      expect(() => chart.pan({ dx: 0.1, dy: 0 })).not.toThrow();
      h.raf.flush();
      expect(renders).toBe(1);
      expect(logged(error, "viewportchange listener failed")).toBe(true);
    } finally {
      error.mockRestore();
      chart.dispose();
    }
  });

  it("logs errors from plugin dispose and cleanups while releasing the rest", () => {
    const chart = seeded();
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = document.createElement("div");
      bad.remove = () => { throw new Error("bad cleanup"); };
      const good = document.createElement("div");
      const dispose = installPlugin(chart, {
        install(ctx) {
          ctx.dom.mount("plot", good);
          ctx.dom.mount("plot", bad);
          return () => { throw new Error("bad dispose"); };
        },
      });
      dispose();
      expect(logged(error, "plugin dispose failed")).toBe(true);
      expect(logged(error, "plugin cleanup failed")).toBe(true);
      expect(good.parentElement).toBeNull();
    } finally {
      error.mockRestore();
      chart.dispose();
    }
  });
});
