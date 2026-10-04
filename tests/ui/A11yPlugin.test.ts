import { afterEach, describe, expect, it, jest } from "bun:test";
import { OhlcRingBuffer } from "../../src/index.ts";
import { a11yPlugin } from "../../src/plugins/a11y.ts";
import { crosshairPlugin } from "../../src/plugins/crosshair.ts";
import { tooltipPlugin } from "../../src/plugins/tooltip.ts";
import { sampleTableIndices } from "../../src/ui/A11y.ts";
import type { A11yPluginOptions } from "../../src/ui/A11y.ts";
import type { Chart, ChartOptions } from "../../src/ui/Chart.ts";
import { fire, keyEvent, pluginContext, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

afterEach(() => {
  jest.useRealTimers();
});

function make(options: A11yPluginOptions = {}, chartOptions: ChartOptions = {}): { chart: Chart; plugin: ReturnType<typeof a11yPlugin> } {
  const plugin = a11yPlugin(options);
  const chart = h.make({ ...chartOptions, plugins: [plugin, ...(chartOptions.plugins ?? [])] });
  chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
  return { chart, plugin };
}

function addRamp(chart: Chart, name: string, scale: number, count = 11): ReturnType<Chart["addLine"]> {
  const series = chart.addLine({ capacity: 4_096, name });
  for (let x = 0; x < count; x++) series.append({ x, y: x * scale });
  return series;
}

const press = (chart: Chart, key: string, init: Parameters<typeof keyEvent>[1] = {}): KeyboardEvent => {
  const event = keyEvent(key, init);
  fire(chart.rootElement, event);
  return event;
};

const announced = (chart: Chart): string => (chart.rootElement.querySelector(".blazeplot-a11y-announcer")?.textContent ?? "").replace(/ $/, "");
const tables = (chart: Chart): HTMLTableElement[] => [...chart.rootElement.querySelectorAll<HTMLTableElement>(".blazeplot-a11y table")];

describe("sampleTableIndices", () => {
  it("keeps every index when they fit and samples evenly, keeping both ends, when they do not", () => {
    expect(sampleTableIndices(3, 6, 10)).toEqual([3, 4, 5]);
    expect(sampleTableIndices(0, 101, 5)).toEqual([0, 25, 50, 75, 100]);
    expect(sampleTableIndices(10, 1_010, 3)).toEqual([10, 510, 1_009]);
    expect(sampleTableIndices(0, 10, 1)).toEqual([0]);
    expect(sampleTableIndices(5, 5, 10)).toEqual([]);
    expect(sampleTableIndices(0, 10, 0)).toEqual([]);
    const many = sampleTableIndices(0, 1_000_000, 100);
    expect(many).toHaveLength(100);
    expect(new Set(many).size).toBe(100);
    expect(many[0]).toBe(0);
    expect(many.at(-1)).toBe(999_999);
  });
});

describe("a11yPlugin data table", () => {
  it("renders a visually hidden table per visible series from the visible range, capped at maxRows", () => {
    const { chart, plugin } = make({ table: { maxRows: 3, xLabel: "Time" } });
    addRamp(chart, "CPU", 10);
    const hidden = addRamp(chart, "Hidden", 1);
    hidden.setVisible(false);
    chart.setViewport({ xMin: 2, xMax: 8 });
    plugin.refresh();

    const container = chart.rootElement.querySelector<HTMLElement>(".blazeplot-a11y")!;
    expect(container.classList.contains("blazeplot-visually-hidden")).toBe(true);
    expect(container.style.clipPath).toBe("inset(50%)");
    const [table] = tables(chart);
    expect(tables(chart)).toHaveLength(1);
    expect(table!.querySelector("caption")?.textContent).toBe("CPU: 3 points, evenly sampled from 7 visible points");
    expect([...table!.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Time", "Y"]);
    const rows = [...table!.querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows).toEqual([["2.00", "20.0"], ["5.00", "50.0"], ["8.00", "80.0"]]);
    expect(table!.querySelector("tbody tr")!.children[0]!.tagName).toBe("TH");
    chart.dispose();
  });

  it("lists OHLC columns and notes series with nothing in view", () => {
    const { chart, plugin } = make({ formatX: (x) => `x${x}`, formatY: (y) => `y${y}` });
    const line = chart.addLine({ capacity: 4, name: "Far" });
    line.append({ x: 50, y: 1 });
    plugin.refresh();
    expect(chart.rootElement.querySelector(".blazeplot-a11y-tables p")?.textContent).toBe("Far: no points in view.");
    chart.dispose();
  });

  it("rebuilds at most once per update window while the viewport changes, and skips unchanged rebuilds", () => {
    jest.useFakeTimers();
    const { chart } = make({ table: { updateMs: 200 } });
    addRamp(chart, "CPU", 10);
    jest.advanceTimersByTime(200);
    const first = tables(chart)[0];
    expect(first?.querySelectorAll("tbody tr")).toHaveLength(11);

    chart.setViewport({ xMin: 0, xMax: 5 });
    chart.setViewport({ xMin: 0, xMax: 4 });
    expect(tables(chart)[0]).toBe(first!);
    jest.advanceTimersByTime(199);
    expect(tables(chart)[0]).toBe(first!);
    jest.advanceTimersByTime(1);
    const second = tables(chart)[0]!;
    expect(second).not.toBe(first!);
    expect(second.querySelectorAll("tbody tr")).toHaveLength(5);

    // Same viewport and data: no DOM churn.
    chart.setViewport({ xMin: 0, xMax: 4 });
    jest.advanceTimersByTime(200);
    expect(tables(chart)[0]).toBe(second);
    chart.dispose();
  });

  it("can be turned off, and stops its timers on dispose", () => {
    jest.useFakeTimers();
    const off = make({ table: false, inspection: false }).chart;
    addRamp(off, "CPU", 10);
    jest.advanceTimersByTime(1_000);
    expect(tables(off)).toHaveLength(0);
    expect(off.rootElement.querySelector(".blazeplot-a11y p")).toBeNull();
    off.dispose();

    const { chart } = make({ live: { intervalMs: 1_000 } });
    const series = addRamp(chart, "CPU", 10);
    const live = chart.rootElement.querySelector<HTMLElement>(".blazeplot-a11y-live")!;
    chart.dispose();
    series.append({ x: 11, y: 1 });
    jest.advanceTimersByTime(5_000);
    expect(live.textContent).toBe("");
    expect(tables(chart)).toHaveLength(0);
  });
});

describe("a11yPlugin keyboard inspection", () => {
  it("starts with Enter at the sample nearest the plot center and steps, jumps, and switches series", () => {
    const { chart, plugin } = make();
    addRamp(chart, "A", 10);
    addRamp(chart, "B", 5);
    const ctx = pluginContext(chart);

    expect(press(chart, "Enter").defaultPrevented).toBe(true);
    expect(plugin.isInspecting()).toBe(true);
    expect(announced(chart)).toBe("A: x 5.00, y 50.0. Point 6 of 11.");
    expect(chart.getHoverState()).toMatchObject({ source: "inspection", anchorX: 5 });

    const right = press(chart, "ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    expect(chart.getViewport().xMin).toBe(0); // inspection keys do not pan
    expect(ctx.state.getInspection()?.index).toBe(6);
    press(chart, "ArrowLeft");
    press(chart, "ArrowLeft");
    expect(ctx.state.getInspection()?.index).toBe(4);

    press(chart, "ArrowDown");
    expect(announced(chart)).toBe("B: x 4.00, y 20.0. Point 5 of 11.");
    press(chart, "ArrowDown");
    expect(chart.getHoverState()?.items[0]?.name).toBe("A");
    press(chart, "ArrowUp");
    expect(chart.getHoverState()?.items[0]?.name).toBe("B");

    press(chart, "End");
    expect(ctx.state.getInspection()?.index).toBe(10);
    press(chart, "Home");
    expect(ctx.state.getInspection()?.index).toBe(0);
    press(chart, "PageDown");
    expect(ctx.state.getInspection()?.index).toBe(1);

    expect(press(chart, "Escape").defaultPrevented).toBe(true);
    expect(plugin.isInspecting()).toBe(false);
    expect(ctx.state.getInspection()).toBeNull();
    expect(announced(chart)).toBe("Stopped inspecting points.");
    // Back to the chart's own keyboard pan.
    press(chart, "ArrowRight");
    expect(chart.getViewport().xMin).toBeCloseTo(1, 8);
    chart.dispose();
  });

  it("scrolls the viewport to keep the inspected sample visible and jumps past the visible range on a second End", () => {
    const { chart } = make();
    addRamp(chart, "A", 1, 101);
    chart.setViewport({ xMin: 0, xMax: 10 });
    const ctx = pluginContext(chart);
    press(chart, "Enter");
    press(chart, "End");
    expect(ctx.state.getInspection()?.index).toBe(10);
    press(chart, "ArrowRight");
    expect(ctx.state.getInspection()?.index).toBe(11);
    expect(chart.getViewport().xMax).toBeGreaterThanOrEqual(11);
    expect(chart.getHoverState()?.source).toBe("inspection");
    press(chart, "End");
    press(chart, "End");
    expect(ctx.state.getInspection()?.index).toBe(100);
    expect(chart.getViewport().xMax).toBeGreaterThanOrEqual(100);
    chart.dispose();
  });

  it("moves in screen direction on a reversed X axis and announces OHLC values", () => {
    const { chart } = make({}, { axes: { x: { reversed: true } } });
    addRamp(chart, "A", 10);
    const ctx = pluginContext(chart);
    press(chart, "Enter");
    press(chart, "ArrowRight");
    expect(ctx.state.getInspection()?.index).toBe(4);
    chart.dispose();

    const { chart: ohlc, plugin } = make({ formatX: String, formatY: String });
    const candles = ohlc.addCandlestick({ name: "Price", dataset: new OhlcRingBuffer(8) });
    for (let x = 4; x <= 6; x++) candles.append({ x, open: x, high: x + 2, low: x - 1, close: x + 1 });
    press(ohlc, "Enter");
    expect(announced(ohlc)).toBe("Price: x 5, y open 5, high 7, low 4, close 6. Point 2 of 3.");
    plugin.refresh();
    expect([...ohlc.rootElement.querySelectorAll(".blazeplot-a11y thead th")].map((cell) => cell.textContent)).toEqual(["X", "Open", "High", "Low", "Close"]);
    expect([...ohlc.rootElement.querySelectorAll(".blazeplot-a11y tbody tr")[0]!.children].map((cell) => cell.textContent)).toEqual(["4", "4", "6", "3", "5"]);
    ohlc.dispose();
  });

  it("leaves keys alone when not inspecting, from child controls, with modifiers, and Shift+Arrow", () => {
    const { chart, plugin } = make();
    addRamp(chart, "A", 10);
    const child = document.createElement("button");
    chart.rootElement.appendChild(child);
    const fromChild = keyEvent("Enter");
    fire(child, fromChild);
    expect(fromChild.defaultPrevented).toBe(false);
    expect(plugin.isInspecting()).toBe(false);
    expect(press(chart, "Enter", { ctrlKey: true }).defaultPrevented).toBe(false);

    press(chart, "Enter");
    const ctx = pluginContext(chart);
    const before = ctx.state.getInspection()?.index;
    press(chart, "ArrowRight", { shiftKey: true });
    expect(ctx.state.getInspection()?.index).toBe(before);
    expect(chart.getViewport().xMin).toBeCloseTo(2.5, 8); // the chart's Shift+Arrow pan
    chart.dispose();
  });

  it("drives the tooltip and crosshair to the inspected sample", () => {
    const crosshair = crosshairPlugin();
    const { chart } = make({}, { plugins: [tooltipPlugin(), crosshair] });
    addRamp(chart, "A", 10);
    press(chart, "Enter");
    h.raf.flush();
    const tip = document.body.querySelector<HTMLElement>(".blazeplot-tooltip")!;
    expect(tip.style.display).toBe("block");
    expect(tip.textContent).toContain("(5, 50)");
    expect(crosshair.getPosition()).toMatchObject({ dataX: 5, dataY: 50, plotX: 200, plotY: 100 });
    press(chart, "ArrowRight");
    h.raf.flush();
    expect(tip.textContent).toContain("(6, 60)");
    expect(crosshair.getPosition()?.dataX).toBe(6);

    press(chart, "Escape");
    h.raf.flush();
    expect(tip.style.display).toBe("none");
    expect(crosshair.getPosition()).toBeNull();
    chart.dispose();
  });

  it("stops when the pointer takes over, focus leaves the root, or the series disappears", () => {
    const { chart, plugin } = make();
    const a = addRamp(chart, "A", 10);
    press(chart, "Enter");
    fire(chart.canvas, pointerEvent("pointermove", 100, 50));
    h.raf.flush();
    expect(plugin.isInspecting()).toBe(false);

    press(chart, "Enter");
    fire(chart.rootElement, new window.FocusEvent("blur"));
    expect(plugin.isInspecting()).toBe(false);

    press(chart, "Enter");
    const b = addRamp(chart, "B", 1);
    a.setVisible(false);
    expect(plugin.isInspecting()).toBe(true);
    expect(chart.getHoverState()?.items[0]?.series).toBe(b);
    b.setVisible(false);
    expect(plugin.isInspecting()).toBe(false);
    expect(announced(chart)).toBe("No visible series to inspect.");
    expect(press(chart, "Enter").defaultPrevented).toBe(true);
    expect(announced(chart)).toBe("No data points in view to inspect.");
    chart.dispose();
  });

  it("uses a custom announcement and can be turned off", () => {
    const { chart } = make({ formatAnnouncement: ({ series, x, y, position, total }) => `${series.name} ${x}/${y} ${position}/${total}` });
    addRamp(chart, "A", 10);
    press(chart, "Enter");
    expect(announced(chart)).toBe("A 5.00/50.0 6/11");
    chart.dispose();

    const off = make({ inspection: false }).chart;
    addRamp(off, "A", 10);
    expect(press(off, "Enter").defaultPrevented).toBe(false);
    off.dispose();
  });
});

describe("a11yPlugin live summary", () => {
  it("announces the latest values at most once per interval and only when they change", () => {
    jest.useFakeTimers();
    const { chart, plugin } = make({ live: { intervalMs: 2_000 } });
    const live = chart.rootElement.querySelector<HTMLElement>(".blazeplot-a11y-live")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    const series = addRamp(chart, "CPU", 10);
    jest.advanceTimersByTime(1_999);
    expect(live.textContent).toBe("");
    jest.advanceTimersByTime(1);
    expect(live.textContent).toBe("Latest: CPU 100 at 10.0.");
    series.append({ x: 11, y: 7 });
    jest.advanceTimersByTime(2_000);
    expect(live.textContent).toBe("Latest: CPU 7.00 at 11.0.");

    // Quiet while inspecting.
    chart.setViewport({ xMin: 0, xMax: 12 });
    press(chart, "Enter");
    series.append({ x: 12, y: 8 });
    jest.advanceTimersByTime(2_000);
    expect(live.textContent).toBe("Latest: CPU 7.00 at 11.0.");
    expect(plugin.isInspecting()).toBe(true);
    chart.dispose();
  });

  it("clamps the interval, supports a custom format, and is off by default", () => {
    jest.useFakeTimers();
    const { chart } = make({ live: { intervalMs: 10, format: (series) => `${series.length} series` } });
    addRamp(chart, "CPU", 10);
    const live = chart.rootElement.querySelector<HTMLElement>(".blazeplot-a11y-live")!;
    jest.advanceTimersByTime(999);
    expect(live.textContent).toBe("");
    jest.advanceTimersByTime(1);
    expect(live.textContent).toBe("1 series");
    chart.dispose();
    expect(make().chart.rootElement.querySelector(".blazeplot-a11y-live")).toBeNull();
  });
});
