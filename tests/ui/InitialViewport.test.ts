import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Chart as ChartType, ChartViewportChangeSource } from "../../src/ui/Chart.ts";
import { createLinkedCharts } from "../../src/linked/LinkedCharts.ts";
import { recordingRenderer } from "./fakes.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

let warn: ReturnType<typeof spyOn<Console, "warn">>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const warnings = (): string[] => warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("contains none of the data"));

function filled(options: Parameters<typeof h.make>[0] = {}) {
  const chart = h.make(options);
  const series = chart.addLine({ capacity: 64 });
  for (let x = 100; x <= 110; x++) series.append({ x, y: x * 2 });
  const sources: ChartViewportChangeSource[] = [];
  chart.subscribe("viewportchange", (event) => sources.push(event.source));
  return { chart, series, sources };
}

describe("initial viewport", () => {
  it("shows the data on the first render without fitToData", () => {
    const { chart, sources } = filled();
    chart.start();
    h.raf.flush();
    const viewport = chart.getViewport();
    expect(viewport.xMin).toBe(100);
    expect(viewport.xMax).toBe(110);
    expect(viewport.yMin).toBe(200);
    expect(viewport.yMax).toBe(220);
    expect(sources).toEqual(["fit"]);
    chart.dispose();
  });

  it("keeps fitting streaming data until the caller sets a viewport", () => {
    const chart = h.make();
    const series = chart.addLine({ capacity: 64 });
    chart.start();
    h.raf.flush();
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
    series.append({ x: 0, y: 0 });
    series.append({ x: 5, y: 10 });
    h.raf.flush();
    expect(chart.getViewport().xMax).toBe(5);
    series.append({ x: 20, y: 40 });
    h.raf.flush();
    expect(chart.getViewport()).toMatchObject({ xMin: 0, xMax: 20, yMin: 0, yMax: 40 });
    chart.dispose();
  });

  it("does not emit viewportchange while there is no data", () => {
    const chart = h.make();
    chart.addLine({ capacity: 8 });
    const sources: ChartViewportChangeSource[] = [];
    chart.subscribe("viewportchange", (event) => sources.push(event.source));
    chart.start();
    h.raf.flush();
    expect(sources).toEqual([]);
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
    chart.dispose();
  });

  it("respects an explicit setViewport made before start", () => {
    const { chart, sources } = filled();
    chart.setViewport({ xMin: 0, xMax: 50, yMin: -1, yMax: 1 });
    sources.length = 0;
    chart.start();
    h.raf.flush();
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 50, yMin: -1, yMax: 1 });
    expect(sources).toEqual([]);
    chart.dispose();
  });

  it("stops fitting after fitToData, a pan, or a zoom", () => {
    const touches: Array<(chart: ChartType) => unknown> = [
      (chart) => chart.fitToData({ padding: 0.1 }),
      (chart) => chart.pan({ dx: 0.1, dy: 0 }),
      (chart) => chart.zoom({ factor: 1.5, cx: 0.5, cy: 0.5, axis: "xy" }),
    ];
    for (const touch of touches) {
      const { chart, series } = filled();
      chart.start();
      h.raf.flush();
      touch(chart);
      const after = chart.getViewport();
      series.append({ x: 500, y: 5000 });
      h.raf.flush();
      expect(chart.getViewport()).toEqual(after);
      chart.dispose();
    }
  });

  it("stops fitting for good after a user pan", () => {
    const { chart, series, sources } = filled();
    chart.start();
    h.raf.flush();
    chart.pan({ dx: 0.25, dy: 0 }, undefined, { source: "user" });
    const panned = chart.getViewport();
    expect(panned.xMin).not.toBe(100);
    sources.length = 0;
    series.append({ x: 300, y: 600 });
    h.raf.flush();
    expect(chart.getViewport()).toEqual(panned);
    expect(sources).toEqual([]);
    chart.dispose();
  });

  it("treats followX and autoFitY options as caller intent", () => {
    const follow = filled({ followX: { window: 5 } });
    follow.chart.start();
    h.raf.flush();
    const viewport = follow.chart.getViewport();
    expect(viewport.xMax - viewport.xMin).toBeCloseTo(5);
    follow.chart.dispose();

    const auto = filled({ autoFitY: true });
    auto.chart.start();
    h.raf.flush();
    // X was not auto-fitted; it keeps the default window.
    expect(auto.chart.getViewport().xMin).toBe(0);
    expect(auto.chart.getViewport().xMax).toBe(1);
    auto.chart.dispose();
  });

  it("treats a viewportPolicy that moves the camera as caller intent", () => {
    const { chart, series } = filled({ viewportPolicy: { beforeRender: (camera) => camera.setViewport({ xMin: 100, xMax: 200 }) } });
    chart.start();
    h.raf.flush();
    expect(chart.getViewport().xMax).toBe(200);
    series.append({ x: 900, y: 1 });
    h.raf.flush();
    expect(chart.getViewport().xMax).toBe(200);
    chart.dispose();
  });

  it("fits a time axis and both Y axes", () => {
    const chart = h.make({ axes: { x: { scale: "time" } } });
    const left = chart.addLine({ capacity: 8 });
    const right = chart.addLine({ capacity: 8, yAxis: "right" });
    left.append({ x: 1.7e12, y: 1 });
    left.append({ x: 1.7e12 + 1000, y: 3 });
    right.append({ x: 1.7e12, y: 100 });
    right.append({ x: 1.7e12 + 1000, y: 300 });
    chart.start();
    h.raf.flush();
    expect(chart.getViewport()).toMatchObject({ xMin: 1.7e12, xMax: 1.7e12 + 1000, yMin: 1, yMax: 3 });
    expect(chart.getViewport("right")).toMatchObject({ yMin: 100, yMax: 300 });
    chart.dispose();
  });

  it("keeps linked panels fitting their own Y", () => {
    
    
    const group = createLinkedCharts(h.target(), { panels: [{ options: { renderer: recordingRenderer() } }, { options: { renderer: recordingRenderer() } }] });
    const [a, b] = group.charts;
    const sa = a!.addLine({ capacity: 8 });
    const sb = b!.addLine({ capacity: 8 });
    sa.append({ x: 0, y: 0 });
    sa.append({ x: 10, y: 10 });
    sb.append({ x: 0, y: 500 });
    sb.append({ x: 10, y: 900 });
    a!.start();
    b!.start();
    h.raf.flush();
    h.raf.flush();
    expect(b!.getViewport()).toMatchObject({ xMin: 0, xMax: 10, yMin: 500, yMax: 900 });
    group.dispose();
  });
});

describe("viewport outside the data warning", () => {
  it("warns once at the first frame with data when the caller viewport misses it", () => {
    const { chart, series } = filled();
    chart.setViewport({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
    chart.start();
    h.raf.flush();
    series.append({ x: 120, y: 1 });
    h.raf.flush();
    const found = warnings();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("[0, 1.00]");
    expect(found[0]).toContain("[100, 110]");
    expect(found[0]).toContain("fitToData()");
    chart.dispose();
  });

  it("formats time axes as dates", () => {
    const chart = h.make({ axes: { x: { scale: "time", timezone: "UTC" } } });
    const series = chart.addLine({ capacity: 4 });
    series.append({ x: Date.UTC(2024, 0, 1), y: 1 });
    chart.setViewport({ xMin: 0, xMax: 1000 });
    chart.start();
    h.raf.flush();
    expect(warnings()[0]).toMatch(/2024/);
    chart.dispose();
  });

  it("stays quiet when the viewport overlaps the data, or nothing was set", () => {
    const overlapping = filled();
    overlapping.chart.setViewport({ xMin: 105, xMax: 200, yMin: 0, yMax: 1000 });
    overlapping.chart.start();
    const fitted = filled();
    fitted.chart.start();
    h.raf.flush();
    expect(warnings()).toHaveLength(0);
    overlapping.chart.dispose();
    fitted.chart.dispose();
  });
});
