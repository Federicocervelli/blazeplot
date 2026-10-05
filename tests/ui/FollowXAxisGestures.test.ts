import { describe, expect, it } from "bun:test";
import { createLinkedCharts } from "../../src/linked.ts";
import type { Chart, ChartFollowXState } from "../../src/ui/Chart.ts";
import { FakeBackend } from "./fakes.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

function following() {
  const chart = h.make({ followX: { window: 10 } });
  const series = chart.addLine({ capacity: 256 });
  for (let x = 0; x < 30; x++) series.append({ x, y: x });
  chart.start();
  h.raf.flush();
  const states: ChartFollowXState[] = [];
  chart.subscribe("followxchange", ({ state }) => states.push(state));
  return { chart, series, states };
}

describe("latest-X follow and per-axis gestures", () => {
  it("keeps following through Y-only pans and zooms", () => {
    const { chart, states } = following();
    expect(chart.getFollowXState()).toBe("following");
    chart.pan({ dx: 0, dy: 0.2 });
    chart.pan({ dx: 0, dy: 0.1 }, "left");
    chart.pan({ dx: 0, dy: 0.1 }, "right");
    chart.zoom({ factor: 1.2, cx: 0.5, cy: 0.5, axis: "y" });
    chart.zoom({ factor: 1.2, cx: 0.5, cy: 0.5, axis: "y" }, "right");
    expect(chart.getFollowXState()).toBe("following");
    expect(states).toEqual([]);
    chart.dispose();
  });

  it("still pauses for X and both-axis gestures", () => {
    const runs: Array<(c: Chart) => void> = [
      (c) => c.pan({ dx: 0.1, dy: 0 }),
      (c) => c.pan({ dx: 0.1, dy: 0.1 }),
      (c) => c.zoom({ factor: 1.2, cx: 0.5, cy: 0.5, axis: "x" }),
      (c) => c.zoom({ factor: 1.2, cx: 0.5, cy: 0.5, axis: "xy" }),
    ];
    for (const run of runs) {
      const { chart, states } = following();
      run(chart);
      expect(chart.getFollowXState()).toBe("paused");
      expect(states).toEqual(["paused"]);
      chart.dispose();
    }
  });

  it("keeps every linked panel following through a Y-only gesture", () => {
    const linked = createLinkedCharts(h.target(), {
      panels: Array.from({ length: 2 }, () => ({
        options: { followX: { window: 10 }, backendFactory: (ctx: { canvas: HTMLCanvasElement }) => new FakeBackend(ctx.canvas) },
      })),
    });
    const [a, b] = linked.charts as [Chart, Chart];
    const series = linked.charts.map((chart) => chart.addLine({ capacity: 256 }));
    for (const chart of linked.charts) chart.start();
    for (let x = 0; x < 30; x++) for (const s of series) s.append({ x, y: x });
    h.raf.flush();
    a.zoom({ factor: 1.5, cx: 0.5, cy: 0.5, axis: "y" }, undefined, { source: "user" });
    a.pan({ dx: 0, dy: 0.1 }, undefined, { source: "user" });
    expect(a.getFollowXState()).toBe("following");
    expect(b.getFollowXState()).toBe("following");
    a.pan({ dx: 0.1, dy: 0 }, undefined, { source: "user" });
    expect(a.getFollowXState()).toBe("paused");
    expect(b.getFollowXState()).toBe("paused");
    linked.dispose();
  });
});
