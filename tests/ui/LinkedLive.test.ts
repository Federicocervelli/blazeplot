import { describe, expect, it } from "bun:test";
import { createLinkedCharts } from "../../src/linked.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import { FakeBackend } from "./fakes.ts";
import { pluginContext, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function build(count: number, followX: boolean) {
  const linked = createLinkedCharts(h.target(), {
    panels: Array.from({ length: count }, () => ({
      options: {
        ...(followX ? { followX: { window: 10 } } : {}),
        backendFactory: (ctx: { canvas: HTMLCanvasElement }) => new FakeBackend(ctx.canvas),
      },
    })),
  });
  const series = linked.charts.map((chart) => chart.addLine({ capacity: 256 }));
  for (const chart of linked.charts) chart.start();
  const feed = (x: number): void => {
    for (const s of series) s.append({ x, y: x });
    h.raf.flush();
    h.raf.flush();
  };
  return { linked, feed };
}

describe("createLinkedCharts live follow", () => {
  it("keeps every following panel following and in sync while data streams", () => {
    const { linked, feed } = build(3, true);
    for (let x = 0; x < 30; x++) feed(x);
    for (const chart of linked.charts) {
      expect(chart.getFollowXState()).toBe("following");
      expect(chart.getViewport()).toMatchObject({ xMin: 19, xMax: 29 });
    }
    linked.dispose();
  });

  it("pauses all panels on a user pan and resumes them all together", () => {
    const { linked, feed } = build(2, true);
    const [a, b] = linked.charts as [Chart, Chart];
    for (let x = 0; x < 30; x++) feed(x);
    pluginContext(a).viewport.pan({ dx: -0.2, dy: 0 }, undefined, { source: "user" });
    expect(a.getFollowXState()).toBe("paused");
    expect(b.getFollowXState()).toBe("paused");
    expect(b.getViewport().xMax).toBe(a.getViewport().xMax);
    const frozen = b.getViewport().xMax;
    feed(30);
    feed(31);
    expect(b.getViewport().xMax).toBe(frozen);
    a.setFollowXPaused(false);
    expect(b.getFollowXState()).toBe("following");
    feed(32);
    expect(a.getViewport().xMax).toBe(32);
    expect(b.getViewport().xMax).toBe(32);
    linked.dispose();
  });

  it("reports mirrored updates with source linked", () => {
    const { linked } = build(2, false);
    const [a, b] = linked.charts as [Chart, Chart];
    const sources: string[] = [];
    b.subscribe("viewportchange", (event) => sources.push(event.source));
    a.setViewport({ xMin: 1, xMax: 2 });
    expect(sources).toEqual(["linked"]);
    linked.dispose();
  });
});
