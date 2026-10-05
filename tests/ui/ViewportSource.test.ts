import { describe, expect, it } from "bun:test";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import type { ChartViewportChangeSource } from "../../src/ui/Chart.ts";
import { fire, pluginContext, useChartHarness, wheelEvent } from "./harness.ts";

const h = useChartHarness();

function seeded(options: Parameters<typeof h.make>[0] = {}) {
  const chart = h.make(options);
  const series = chart.addLine({ capacity: 64, name: "A" });
  for (let x = 0; x <= 10; x++) series.append({ x, y: x * 10 });
  chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
  const sources: ChartViewportChangeSource[] = [];
  chart.subscribe("viewportchange", (event) => sources.push(event.source));
  return { chart, series, sources };
}

describe("viewportchange source", () => {
  it("is api for setViewport, pan, and zoom by default", () => {
    const { chart, sources } = seeded();
    chart.setViewport({ xMin: 1, xMax: 9 });
    chart.pan({ dx: 0.1, dy: 0 });
    chart.zoom({ factor: 1.2, cx: 0.5, cy: 0.5, axis: "xy" });
    expect(sources).toEqual(["api", "api", "api"]);
    chart.dispose();
  });

  it("is fit for fitToData and autoFitY", () => {
    const { chart, sources } = seeded();
    chart.setViewport({ xMin: 2, xMax: 4, yMin: 0, yMax: 1000 });
    sources.length = 0;
    expect(chart.fitToData()).toBe(true);
    expect(sources).toEqual(["fit"]);
    chart.dispose();

    const auto = seeded({ autoFitY: true });
    auto.chart.start();
    auto.chart.setViewport({ xMin: 2, xMax: 4 });
    auto.sources.length = 0;
    h.raf.flush();
    expect(auto.sources).toContain("fit");
    auto.chart.dispose();
  });

  it("is follow for latest-X updates and does not pause following", () => {
    const { chart, series, sources } = seeded();
    chart.followX({ window: 10 });
    chart.start();
    h.raf.flush();
    sources.length = 0;
    series.append({ x: 20, y: 1 });
    h.raf.flush();
    expect(sources).toEqual(["follow"]);
    expect(chart.getFollowXState()).toBe("following");
    chart.dispose();
  });

  it("is user for plugin gestures passing it, and plugin gestures from interactions", () => {
    const { chart, sources } = seeded({ plugins: [interactionsPlugin()] });
    const ctx = pluginContext(chart);
    ctx.viewport.set({ xMin: 1, xMax: 9 }, undefined, { source: "user" });
    ctx.viewport.pan({ dx: 0.1, dy: 0 }, undefined, { source: "user" });
    ctx.viewport.zoom({ factor: 1.1, cx: 0.5, cy: 0.5, axis: "xy" }, undefined, { source: "user" });
    expect(sources).toEqual(["user", "user", "user"]);
    sources.length = 0;
    fire(chart.canvas, wheelEvent(200, 100, { deltaY: -100 }));
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(["user"]));
    chart.dispose();
  });

  it("lets pauseFollow false keep following active", () => {
    const { chart } = seeded();
    chart.followX({ window: 10 });
    chart.setViewport({ xMin: 1, xMax: 2 }, "left", { pauseFollow: false });
    expect(chart.getFollowXState()).toBe("following");
    chart.setViewport({ xMin: 1, xMax: 3 });
    expect(chart.getFollowXState()).toBe("paused");
    chart.dispose();
  });
});

