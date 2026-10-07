import { describe, expect, it } from "bun:test";
import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

/** Log every plot-size read of a chart canvas, and every `render` event, in order. */
function trace(chart: ReturnType<typeof h.make>, name: string, log: string[]): void {
  // The harness measures the plot at construction; undo that so the chart is in the state of a fresh mount.
  Object.assign((chart as unknown as { plotSize: { width: number; height: number } }).plotSize, { width: -1, height: -1 });
  const canvas = chartInternals(chart).canvas;
  Object.defineProperty(canvas, "clientWidth", { configurable: true, get: () => (log.push(`read ${name}`), 400) });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, get: () => 200 });
  chart.subscribe("render", () => log.push(`render ${name}`));
}

describe("first-frame plot size reads", () => {
  it("reads every waiting chart's size before any of them draws, so one layout serves the frame", () => {
    const log: string[] = [];
    const charts = ["a", "b", "c"].map((name) => {
      const chart = h.make();
      trace(chart, name, log);
      chart.addLine({ capacity: 4 }).append({ x: new Float64Array([0, 1, 2, 3]), y: new Float32Array([1, 2, 3, 4]) });
      chart.start();
      return chart;
    });
    log.length = 0;
    h.raf.flush();
    const firstRender = log.findIndex((entry) => entry.startsWith("render"));
    expect(log.slice(0, firstRender).filter((entry) => entry.startsWith("read")).sort()).toEqual(["read a", "read b", "read c"]);
    expect(log.slice(firstRender).some((entry) => entry.startsWith("read"))).toBe(false);
    expect(log.filter((entry) => entry.startsWith("render"))).toHaveLength(3);
    for (const chart of charts) chart.dispose();
  });

  it("measures afresh when a chart stops before its first frame and starts again", () => {
    const log: string[] = [];
    const chart = h.make();
    trace(chart, "a", log);
    chart.addLine({ capacity: 2 }).append({ x: new Float64Array([0, 1]), y: new Float32Array([1, 2]) });
    chart.start();
    chart.stop();
    log.length = 0;
    chart.start();
    h.raf.flush();
    expect(log.filter((entry) => entry === "read a")).toHaveLength(1);
    expect(log).toContain("render a");
    chart.dispose();
  });

  it("a disposed chart leaves nothing queued for the next frame", () => {
    const log: string[] = [];
    const gone = h.make();
    trace(gone, "gone", log);
    gone.addLine({ capacity: 2 }).append({ x: new Float64Array([0, 1]), y: new Float32Array([1, 2]) });
    gone.start();
    gone.dispose();
    const live = h.make();
    trace(live, "live", log);
    live.addLine({ capacity: 2 }).append({ x: new Float64Array([0, 1]), y: new Float32Array([1, 2]) });
    live.start();
    log.length = 0;
    h.raf.flush();
    expect(log.some((entry) => entry === "read gone")).toBe(false);
    expect(log).toContain("render live");
    live.dispose();
  });
});
