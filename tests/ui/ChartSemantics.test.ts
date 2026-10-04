import { afterEach, describe, expect, it, jest } from "bun:test";
import type { Chart, ChartHoverState, ChartOptions } from "../../src/ui/Chart.ts";
import { buildChartSummary } from "../../src/ui/ChartSummary.ts";
import { fire, pluginContext, pointerEvent, useChartHarness } from "./harness.ts";

// Core semantics documented in docs/accessibility.md: role, generated summary, inspection contract, forced colors.
const h = useChartHarness();

function make(options: ChartOptions = {}): Chart {
  const chart = h.make(options);
  chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
  return chart;
}

function describedText(chart: Chart): string | null {
  const id = chart.rootElement.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent ?? null : null;
}

function addRamp(chart: Chart, name: string, scale: number, count = 11): ReturnType<Chart["addLine"]> {
  const series = chart.addLine({ capacity: 64, name });
  for (let x = 0; x < count; x++) series.append({ x, y: x * scale });
  return series;
}

afterEach(() => {
  jest.useRealTimers();
});

describe("chart summary", () => {
  it("describes series names, X and Y ranges, sample counts, and latest values", () => {
    const chart = make();
    addRamp(chart, "CPU", 10);
    const memory = addRamp(chart, "Memory", 2, 6);
    memory.setVisible(false);
    const summary = chart.getSummary();
    expect(summary.series.map((item) => item.name)).toEqual(["CPU", "Memory"]);
    expect(summary.x).toEqual({ min: 0, max: 10 });
    expect(summary.series[0]).toMatchObject({ sampleCount: 11, visible: true, x: { min: 0, max: 10 }, y: { min: 0, max: 100 }, latest: { x: 10, y: 100 } });
    expect(summary.series[1]).toMatchObject({ sampleCount: 6, visible: false, latest: { x: 5, y: 10 } });
    expect(summary.text).toBe(
      "Line chart with 2 series. X from 0 to 10.0. "
      + "CPU: 11 points, values from 0 to 100, latest 100 at 10.0. "
      + "Memory: hidden, 6 points, values from 0 to 10.0, latest 10.0 at 5.00.",
    );
    chart.dispose();
  });

  it("names mixed modes, unnamed series, empty series, and caps the series list", () => {
    const format = (value: number): string => String(value);
    const chart = make();
    chart.addBar({ capacity: 4 });
    chart.addScatter({ capacity: 4, id: "pts" }).append({ x: 1, y: 2 });
    const summary = buildChartSummary(chart.getSeriesState().map((state) => state.series), format);
    expect(summary.text).toBe("Chart with 2 series. X from 1 to 1. bar 1: bar, 0 points. pts: scatter, 1 point, values from 2 to 2, latest 2 at 1.");
    for (let i = 0; i < 21; i++) chart.addLine({ capacity: 1 });
    const many = buildChartSummary(chart.getSeriesState().map((state) => state.series), format);
    expect(many.text.endsWith("And 3 more series.")).toBe(true);
    expect(buildChartSummary([], format).text).toBe("Chart with no data series.");
    chart.dispose();
  });

  it("refreshes the aria-describedby text at most once per throttle window, and on focus", () => {
    jest.useFakeTimers();
    const chart = make();
    expect(describedText(chart)).toBe("Chart with no data series.");
    const series = chart.addLine({ capacity: 64, name: "CPU" });
    series.append({ x: 0, y: 1 });
    series.append({ x: 1, y: 2 });
    // Throttled: the text has not changed yet.
    expect(describedText(chart)).toBe("Chart with no data series.");
    jest.advanceTimersByTime(1_000);
    expect(describedText(chart)).toContain("CPU: 2 points");

    series.append({ x: 2, y: 3 });
    fire(chart.rootElement, new window.FocusEvent("focusin", { bubbles: true }));
    expect(describedText(chart)).toContain("CPU: 3 points");
    chart.dispose();
  });

  it("uses a fixed string, a summary formatter, or no description", () => {
    const fixed = make({ accessibility: { description: "Static text" } });
    addRamp(fixed, "A", 1);
    expect(describedText(fixed)).toBe("Static text");
    fixed.dispose();

    jest.useFakeTimers();
    const custom = make({ accessibility: { description: (summary) => `${summary.series.length} lines, latest ${summary.series[0]?.latest?.y ?? "none"}` } });
    expect(describedText(custom)).toBe("0 lines, latest none");
    addRamp(custom, "A", 1);
    jest.advanceTimersByTime(1_000);
    expect(describedText(custom)).toBe("1 lines, latest 10");
    custom.dispose();

    const none = make({ accessibility: { description: "" } });
    expect(none.rootElement.hasAttribute("aria-describedby")).toBe(false);
    expect(none.rootElement.querySelector(".blazeplot-visually-hidden")).toBeNull();
    none.dispose();
  });

  it("injects the focus and forced-colors stylesheet with a theme focus color", () => {
    const chart = make({ theme: { focusRingColor: "#ff00aa" } });
    const style = chart.rootElement.querySelector("style.blazeplot-style");
    expect(style?.textContent).toContain(".blazeplot-root:focus-visible");
    expect(style?.textContent).toContain("@media (forced-colors:active)");
    expect(chart.rootElement.style.getPropertyValue("--blazeplot-focus-ring")).toBe("#ff00aa");
    chart.dispose();

    const off = make({ accessibility: false });
    expect(off.rootElement.querySelector("style.blazeplot-style")).toBeNull();
    off.dispose();
  });
});

describe("forced colors", () => {
  function stubForcedColors(matches: boolean): { set(next: boolean): void; listeners: () => number; restore(): void } {
    const original = window.matchMedia;
    const listeners = new Set<() => void>();
    const query = {
      media: "(forced-colors: active)",
      matches,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    window.matchMedia = ((media: string) => (media === "(forced-colors: active)" ? query : original.call(window, media))) as typeof window.matchMedia;
    return {
      set(next) {
        query.matches = next;
        for (const listener of listeners) listener();
      },
      listeners: () => listeners.size,
      restore() {
        window.matchMedia = original;
      },
    };
  }

  it("switches the canvas palette and series colors while forced colors are active and restores them after", () => {
    const media = stubForcedColors(false);
    try {
      const chart = make();
      const series = chart.addLine({ capacity: 4 }, { color: [0.1, 0.2, 0.3, 1] });
      const themes: string[] = [];
      chart.subscribe("themechange", () => themes.push(chart.theme.backgroundCssColor));
      expect(chart.theme.focusRingColor).toBe("#60a5fa");

      media.set(true);
      expect(chart.theme.backgroundCssColor).toBe("Canvas");
      expect(chart.theme.focusRingColor).toBe("Highlight");
      expect(series.style.color).toEqual(chart.theme.seriesColors[0]!);
      const added = chart.addLine({ capacity: 4 });
      expect(added.style.color).toEqual(chart.theme.seriesColors[1 % chart.theme.seriesColors.length]!);

      media.set(false);
      expect(series.style.color).toEqual([0.1, 0.2, 0.3, 1]);
      expect(chart.theme.backgroundCssColor).toBe("rgba(5, 5, 5, 1)");
      expect(themes).toEqual(["Canvas", "rgba(5, 5, 5, 1)"]);
      expect(media.listeners()).toBe(1);
      chart.dispose();
      expect(media.listeners()).toBe(0);
    } finally {
      media.restore();
    }
  });

  it("starts in forced colors and can be opted out", () => {
    const media = stubForcedColors(true);
    try {
      const chart = make();
      expect(chart.theme.backgroundCssColor).toBe("Canvas");
      chart.dispose();
      const opted = make({ accessibility: { forcedColors: false } });
      expect(opted.theme.backgroundCssColor).toBe("rgba(5, 5, 5, 1)");
      expect(media.listeners()).toBe(0);
      opted.dispose();
    } finally {
      media.restore();
    }
  });
});

describe("inspection contract", () => {
  it("shows an inspected sample as the hover state with source inspection and the sample first", () => {
    const chart = make();
    const a = addRamp(chart, "A", 10);
    const b = addRamp(chart, "B", 5);
    const ctx = pluginContext(chart);
    const hovers: Array<ChartHoverState | null> = [];
    chart.subscribe("hover", (state) => hovers.push(state));

    const state = ctx.state.inspect({ series: b, index: 4 });
    expect(state?.source).toBe("inspection");
    expect(state?.items.map((item) => item.name)).toEqual(["B", "A"]);
    expect(state).toMatchObject({ dataX: 4, dataY: 20, anchorX: 4, plotX: 160, plotY: 160, clientX: 160, clientY: 160 });
    expect(state?.items[0]?.distancePx).toBe(0);
    expect(chart.getHoverState()).toBe(state);
    expect(ctx.state.getInspection()).toEqual({ series: b, index: 4 });
    expect(hovers.at(-1)).toBe(state);

    // Re-projected as the viewport changes.
    chart.setViewport({ xMin: 2, xMax: 12 });
    expect(chart.getHoverState()?.plotX).toBe(80);

    // Off-screen: no hover state, but the target is kept and returns when it is visible again.
    chart.setViewport({ xMin: 6, xMax: 16 });
    expect(chart.getHoverState()).toBeNull();
    expect(ctx.state.getInspection()).not.toBeNull();
    chart.setViewport({ xMin: 0, xMax: 10 });
    expect(chart.getHoverState()?.items[0]?.series).toBe(b);

    expect(ctx.state.inspect(null)).toBeNull();
    expect(ctx.state.getInspection()).toBeNull();
    expect(a.length).toBe(11);
    chart.dispose();
  });

  it("is ended by a pointer moving over the plot and by removing the series, and rejects bad targets", () => {
    const chart = make();
    const a = addRamp(chart, "A", 10);
    const ctx = pluginContext(chart);
    ctx.state.inspect({ series: a, index: 2 });
    fire(chart.canvas, pointerEvent("pointermove", 300, 50));
    expect(ctx.state.getInspection()).toBeNull();
    h.raf.flush();
    expect(chart.getHoverState()?.source).toBe("pointer");

    ctx.state.inspect({ series: a, index: 2 });
    fire(chart.canvas, pointerEvent("pointerleave", 300, 50));
    expect(chart.getHoverState()?.source).toBe("inspection");
    chart.removeSeries(a);
    expect(ctx.state.getInspection()).toBeNull();

    const b = addRamp(chart, "B", 1);
    const other = make().addLine({ capacity: 2 });
    expect(() => ctx.state.inspect({ series: other, index: 0 })).toThrow(RangeError);
    expect(() => ctx.state.inspect({ series: b, index: 11 })).toThrow(RangeError);
    expect(() => ctx.state.inspect({ series: b, index: 1.5 })).toThrow(RangeError);
    chart.dispose();
  });

  it("formats values like the axis labels", () => {
    const chart = make({ axes: { x: { tickFormat: (value) => `t${value}` } } });
    const ctx = pluginContext(chart);
    expect(ctx.coords.format(3, "x")).toBe("t3");
    expect(ctx.coords.format(1234.5, "y")).toBe("1235");
    expect(ctx.coords.format(Number.NaN, "y")).toBe("NaN");
    chart.dispose();
  });
});
