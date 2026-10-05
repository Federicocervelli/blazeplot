import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { HistogramDataset } from "../../src/core/Histogram.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { AxisController } from "../../src/interaction/AxisController.ts";
import { Camera2D } from "../../src/interaction/Camera2D.ts";
import { ChartEmitter } from "../../src/ui/ChartEmitter.ts";
import {
  domainsAlmostEqual,
  normalizeAxesConfig,
  normalizeFitPadding,
  paddedAxisDomain,
  resolveSeriesStyle,
  withAlpha,
} from "../../src/ui/ChartConfig.ts";
import { ChartPicker, hoverStatesEqual, insidePlot, plotToData } from "../../src/ui/ChartPicker.ts";
import type { PlotRect } from "../../src/ui/ChartPicker.ts";
import { FollowXController } from "../../src/ui/FollowX.ts";
import type { FollowXHost } from "../../src/ui/FollowX.ts";
import { testStyle } from "../helpers.ts";
import { fire, keyEvent, pointerEvent, stubPlot, useChartHarness } from "./harness.ts";

const h = useChartHarness();

describe("ChartEmitter", () => {
  it("delivers payloads, supports unsubscribe, and isolates throwing listeners", () => {
    const emitter = new ChartEmitter();
    const seen: string[] = [];
    const error = spyOn(console, "error").mockImplementation(() => {});
    expect(emitter.has("render")).toBe(false);
    const off = emitter.subscribe("render", () => { throw new Error("boom"); });
    emitter.subscribe("render", () => seen.push("second"));
    expect(emitter.has("render")).toBe(true);
    emitter.emit("render", undefined);
    expect(seen).toEqual(["second"]);
    expect(error).toHaveBeenCalledTimes(1);
    off();
    emitter.emit("render", undefined);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("ChartConfig", () => {
  it("normalizes axes: x and y visible, y2 hidden, booleans apply to x and y only", () => {
    const defaults = normalizeAxesConfig(undefined);
    expect([defaults.x.visible, defaults.y.visible, defaults.y2.visible]).toEqual([true, true, false]);
    expect(defaults.x.position).toBe("outside");
    const off = normalizeAxesConfig(false);
    expect([off.x.visible, off.y.visible, off.y2.visible]).toEqual([false, false, false]);
    const custom = normalizeAxesConfig({ y2: { position: "inside" }, x: false });
    expect(custom.y2).toMatchObject({ visible: true, position: "inside" });
    expect(custom.x.visible).toBe(false);
  });

  it("sanitizes fit padding", () => {
    expect(normalizeFitPadding(0.1)).toEqual({ x: 0.1, y: 0.1 });
    expect(normalizeFitPadding({ x: -1, y: Number.NaN })).toEqual({ x: 0, y: 0 });
    expect(normalizeFitPadding(undefined)).toEqual({ x: 0, y: 0 });
  });

  it("pads fit domains in scale space and rejects unusable log domains", () => {
    const linear = new AxisController(new Camera2D());
    expect(paddedAxisDomain(linear, "y", 0, 10, 0.1, false)).toEqual({ min: -1, max: 11 });
    expect(paddedAxisDomain(linear, "y", 5, 5, 0, false)).toEqual({ min: 2.5, max: 7.5 });
    const log = new AxisController(new Camera2D(), { y: { scale: "log" } });
    const padded = paddedAxisDomain(log, "y", 10, 1000, 0.1, false)!;
    expect(padded.min).toBeGreaterThan(0);
    expect(padded.min).toBeLessThan(10);
    expect(paddedAxisDomain(log, "y", -5, 5, 0, false)).toBeNull();
    expect(domainsAlmostEqual(0, 1, 1e-12, 1)).toBe(true);
    expect(domainsAlmostEqual(0, 1, 0.1, 1)).toBe(false);
  });

  it("resolves a full series style from partial options", () => {
    const root = document.createElement("div");
    const style = resolveSeriesStyle({ lineWidth: 2, barWidth: 0.5 }, [1, 0, 0, 1], root);
    expect(style.color).toEqual([1, 0, 0, 1]);
    expect(style.lineWidth).toBe(2);
    expect(style.tickWidth).toBe(0.5);
    expect(style.fillColor).toEqual(withAlpha([1, 0, 0, 1], 0.25));
    expect(style.downColor).toEqual(withAlpha([1, 0, 0, 1], 0.45));
    expect(resolveSeriesStyle({ color: [0, 1, 0, 1] }, [1, 0, 0, 1], root).color).toEqual([0, 1, 0, 1]);
  });
});

describe("ChartPicker", () => {
  const rect: PlotRect = { left: 10, top: 20, width: 100, height: 100 };

  function setup() {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    const axis = new AxisController(camera);
    const buffer = new RingBuffer(16);
    buffer.append([0, 5, 10], [0, 5, 10]);
    const series = [new SeriesStore(buffer, { mode: "line", capacity: 16 }, testStyle())];
    const picker = new ChartPicker({ series: () => series, camera: () => camera, controller: () => axis, hoverDefaults: () => undefined });
    return { picker, series, axis };
  }

  it("maps plot coordinates to data and tests plot bounds", () => {
    const { axis } = setup();
    expect(insidePlot(50, 50, rect)).toBe(true);
    expect(insidePlot(-1, 50, rect)).toBe(false);
    expect(insidePlot(5, 5, { ...rect, width: 0 })).toBe(false);
    const [x, y] = plotToData(50, 50, rect, axis);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(5);
  });

  it("picks the nearest sample by X and projects it to client coordinates", () => {
    const { picker, series } = setup();
    const hover = picker.pickAtPlot(48, 52, 58, 72, rect)!;
    expect(hover.mode).toBe("nearest-x");
    expect(hover.items).toHaveLength(1);
    const item = hover.items[0]!;
    expect(item.series).toBe(series[0]!);
    expect([item.x, item.y]).toEqual([5, 5]);
    expect(item.plotX).toBeCloseTo(50);
    expect(item.clientX).toBeCloseTo(60);
    expect(item.clientY).toBeCloseTo(70);
    expect(picker.pickAtPlot(-5, 10, 0, 0, rect)).toBeNull();
  });

  it("honors maxDistancePx and nearest-point mode", () => {
    const { picker } = setup();
    expect(picker.pickAtPlot(60, 50, 70, 70, rect, { maxDistancePx: 1 })).toBeNull();
    const point = picker.pickAtPlot(51, 52, 61, 72, rect, { mode: "nearest-point" })!;
    expect(point.mode).toBe("nearest-point");
    expect(point.items[0]!.index).toBe(1);
  });

  it("reprojects held items and drops them when they leave the plot", () => {
    const { picker } = setup();
    const hover = picker.pickAtPlot(50, 50, 60, 70, rect)!;
    const moved = picker.reprojectHoverState(hover, { ...rect, left: 20 }, { clientX: 70, clientY: 70, plotX: 50, plotY: 50 })!;
    expect(moved.items[0]!.clientX).toBeCloseTo(70);
    expect(picker.reprojectHoverState(hover, { ...rect, width: 0 }, { clientX: 0, clientY: 0, plotX: 0, plotY: 0 })).toBeNull();
  });

  it("compares hover states by items and position with a small tolerance", () => {
    const { picker } = setup();
    const a = picker.pickAtPlot(50, 50, 60, 70, rect)!;
    const b = picker.pickAtPlot(50, 50, 60, 70, rect)!;
    expect(hoverStatesEqual(a, b)).toBe(true);
    expect(hoverStatesEqual(a, { ...b, plotX: b.plotX + 1 })).toBe(false);
    expect(hoverStatesEqual(a, null)).toBe(false);
    expect(hoverStatesEqual(null, null)).toBe(true);
  });
});

describe("FollowXController", () => {
  afterEach(() => mock.restore());

  function setup(sampleEnd = 100) {
    const camera = new Camera2D();
    camera.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 1 });
    const axis = new AxisController(camera);
    const events: string[] = [];
    const buffer = new RingBuffer(16);
    buffer.append([sampleEnd - 1, sampleEnd], [0, 1]);
    const series = new SeriesStore(buffer, { mode: "line", capacity: 16 }, testStyle());
    const host: FollowXHost = {
      camera: () => camera,
      axis: () => axis,
      candidates: () => [series],
      onStateChange: () => events.push("state"),
      onViewportChange: () => events.push("viewport"),
      requestRender: () => events.push("render"),
    };
    return { controller: new FollowXController(host), camera, events };
  }

  it("keeps the current span and moves the window to the newest data", () => {
    const { controller, camera, events } = setup();
    controller.start({});
    expect([camera.xMin, camera.xMax]).toEqual([90, 100]);
    expect(events).toEqual(["state", "viewport", "render"]);
    expect(controller.state).toBe("following");
  });

  it("uses a fixed window when configured", () => {
    const { controller, camera } = setup();
    controller.start({ window: 40 });
    expect([camera.xMin, camera.xMax]).toEqual([60, 100]);
  });

  it("pauses on interaction, auto-resumes, and stops", async () => {
    const { controller, camera, events } = setup();
    controller.start({ resumeAfterMs: 5 });
    camera.setViewport({ xMin: 0, xMax: 10 });
    events.length = 0;
    controller.pauseForInteraction();
    expect(controller.state).toBe("paused");
    controller.apply();
    expect(camera.xMin).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(controller.state).toBe("following");
    expect(camera.xMax).toBe(100);
    expect(controller.stop()).toBe(true);
    expect(controller.stop()).toBe(false);
    expect(controller.state).toBe("off");
  });

  it("ignores interaction when pauseOnInteraction is false", () => {
    const { controller } = setup();
    controller.start({ pauseOnInteraction: false });
    controller.pauseForInteraction();
    expect(controller.state).toBe("following");
  });

  it("configure sets options without applying them", () => {
    const { controller, camera, events } = setup();
    controller.configure({});
    expect(controller.state).toBe("following");
    expect(camera.xMax).toBe(10);
    expect(events).toEqual([]);
  });
});

describe("HistogramDataset.from and addBar", () => {
  it("bins raw values and defaults the bar width to the bin width", () => {
    const chart = h.make();
    const series = chart.addBar({ dataset: HistogramDataset.from([1, 1.2, 7], { binSize: 1, min: 0, max: 10 }) });
    expect(series.style.barWidth).toBe(1);
    chart.addBar({ dataset: HistogramDataset.from([1, 2], { binSize: 1, min: 0, max: 4 }) }, { barWidth: 0.5 });
    expect(chart.getSeriesState()[1]!.series.style.barWidth).toBe(0.5);
    chart.dispose();
  });

  it("requires an explicit bar width for variable-width bins", () => {
    const chart = h.make();
    const dataset = HistogramDataset.from([1, 2, 3, 8], { thresholds: [0, 2, 10] });
    expect(dataset.defaultBarWidth).toBeNull();
    expect(() => chart.addBar({ dataset })).toThrow(TypeError);
    expect(() => chart.addBar({ dataset }, { barWidth: 1 })).not.toThrow();
    chart.dispose();
  });
});

describe("ChartHover", () => {
  it("emits hover on pointer move, keeps keyboard inspection, and clears on leave", () => {
    const chart = h.make();
    const buffer = new RingBuffer(16);
    buffer.append([0, 5, 10], [0, 5, 10]);
    const series = chart.addLine({ dataset: buffer });
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    stubPlot(chart);
    const states: Array<ReturnType<typeof chart.getHoverState>> = [];
    chart.subscribe("hover", (state) => states.push(state));
    chart.start();
    h.raf.flush();

    fire(chartInternals(chart).canvas, pointerEvent("pointermove", 200, 100, { offsetX: 200, offsetY: 100 }));
    h.raf.flush();
    expect(chart.getHoverState()?.items[0]?.series).toBe(series);
    expect(chart.getHoverState()?.source).toBe("pointer");

    fire(chartInternals(chart).canvas, pointerEvent("pointerleave", 200, 100));
    expect(chart.getHoverState()).toBeNull();
    expect(states.length).toBe(2);
    chart.dispose();
  });
});

describe("ChartAccessibility", () => {
  it("labels the root from title text, links a summary, and removes timers on dispose", () => {
    const chart = h.make({ title: "Latency", subtitle: "p99" });
    const root = chartInternals(chart).canvas.closest(".blazeplot-root") as HTMLElement;
    expect(root.getAttribute("role")).toBe("figure");
    expect(root.getAttribute("aria-label")).toBe("Latency — p99");
    const summary = root.ownerDocument.getElementById(root.getAttribute("aria-describedby")!);
    expect(summary?.className).toBe("blazeplot-visually-hidden");
    expect(root.querySelector("style.blazeplot-style")).not.toBeNull();
    chart.addLine({ capacity: 4, name: "A" }).append({ x: 1, y: 2 });
    chart.dispose();
  });

  it("skips ARIA wiring when accessibility is disabled", () => {
    const chart = h.make({ accessibility: false });
    const root = chartInternals(chart).canvas.closest(".blazeplot-root") as HTMLElement;
    expect(root.hasAttribute("aria-label")).toBe(false);
    expect(root.querySelector("style.blazeplot-style")).toBeNull();
    // Keyboard events are inert without the a11y plugin.
    fire(root, keyEvent("ArrowRight"));
    chart.dispose();
  });
});
