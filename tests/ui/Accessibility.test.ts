import { describe, expect, it } from "bun:test";
import type { Chart } from "../../src/ui/Chart.ts";
import type { ChartOptions } from "../../src/ui/Chart.ts";
import { fire, keyEvent, useChartHarness } from "./harness.ts";

// Behavior documented in docs/accessibility.md ("What the chart provides" and "Keyboard navigation").
const h = useChartHarness();

function make(options: ChartOptions = {}): Chart {
  const chart = h.make(options);
  chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
  return chart;
}

const press = (chart: Chart, key: string, init: Parameters<typeof keyEvent>[1] = {}, target: EventTarget = chart.rootElement): KeyboardEvent => {
  const event = keyEvent(key, init);
  fire(target, event);
  return event;
};

describe("chart accessibility attributes", () => {
  it("makes the root a focusable labelled figure and hides decoration", () => {
    const chart = make({ title: "Latency", subtitle: "p95" });
    const root = chart.rootElement;
    expect(root.tabIndex).toBe(0);
    expect(root.getAttribute("role")).toBe("figure");
    expect(root.getAttribute("aria-label")).toBe("Latency — p95");
    expect(root.hasAttribute("aria-description")).toBe(false);
    const summary = document.getElementById(root.getAttribute("aria-describedby")!);
    expect(summary?.textContent).toBe("Chart with no data series.");
    expect(summary?.className).toBe("blazeplot-visually-hidden");
    expect(chart.plotElement.getAttribute("role")).toBe("presentation");
    for (const hidden of [chart.canvas, chart.xAxisElement, chart.yAxisElement, chart.y2AxisElement]) {
      expect(hidden.getAttribute("aria-hidden")).toBe("true");
    }
    // The browser focus ring stays, offset so it remains inside the chart.
    expect(root.style.outlineOffset).toBe("-2px");
    expect(root.style.outline).toBe("");
    chart.dispose();
  });

  it("falls back to a generic label and honors label, description, and role overrides", () => {
    const plain = make();
    expect(plain.rootElement.getAttribute("aria-label")).toBe("BlazePlot chart");
    plain.dispose();

    const custom = make({ title: "ignored", accessibility: { label: "CPU by core", description: "See the table below", role: "img" } });
    expect(custom.rootElement.getAttribute("aria-label")).toBe("CPU by core");
    expect(document.getElementById(custom.rootElement.getAttribute("aria-describedby")!)?.textContent).toBe("See the table below");
    expect(custom.rootElement.getAttribute("role")).toBe("img");
    custom.dispose();
  });

  it("adds no ARIA or tab stop when accessibility is false", () => {
    const chart = make({ accessibility: false });
    const root = chart.rootElement;
    expect(root.hasAttribute("role")).toBe(false);
    expect(root.hasAttribute("aria-label")).toBe(false);
    expect(root.getAttribute("tabindex")).toBeNull();
    expect(chart.canvas.hasAttribute("aria-hidden")).toBe(false);
    const event = press(chart, "ArrowRight");
    expect(event.defaultPrevented).toBe(false);
    expect(chart.getViewport().xMin).toBe(0);
    chart.dispose();
  });

  it("keeps ARIA but disables keys when keyboard is false", () => {
    const chart = make({ accessibility: { keyboard: false } });
    expect(chart.rootElement.getAttribute("role")).toBe("figure");
    const event = press(chart, "ArrowRight");
    expect(event.defaultPrevented).toBe(false);
    expect(chart.getViewport().xMin).toBe(0);
    chart.dispose();
  });
});

describe("chart keyboard navigation", () => {
  it("pans by 10% per arrow key and 2.5x with Shift", () => {
    const chart = make();
    const right = press(chart, "ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    expect(chart.getViewport()).toMatchObject({ xMin: 10, xMax: 110 });
    press(chart, "ArrowLeft");
    expect(chart.getViewport()).toMatchObject({ xMin: 0, xMax: 100 });
    press(chart, "ArrowUp");
    expect(chart.getViewport()).toMatchObject({ yMin: 10, yMax: 110 });
    press(chart, "ArrowDown");
    expect(chart.getViewport()).toMatchObject({ yMin: 0, yMax: 100 });
    press(chart, "ArrowRight", { shiftKey: true });
    expect(chart.getViewport().xMin).toBeCloseTo(25, 8);
    chart.dispose();
  });

  it("zooms both axes with + and -, and only Y with PageUp and PageDown", () => {
    const chart = make();
    press(chart, "+");
    expect(chart.getViewport().xMax - chart.getViewport().xMin).toBeCloseTo(80, 8);
    expect(chart.getViewport().yMax - chart.getViewport().yMin).toBeCloseTo(80, 8);
    press(chart, "-");
    expect(chart.getViewport().xMax - chart.getViewport().xMin).toBeCloseTo(100, 8);
    press(chart, "=");
    press(chart, "_");
    expect(chart.getViewport().xMax - chart.getViewport().xMin).toBeCloseTo(100, 8);

    press(chart, "PageUp");
    expect(chart.getViewport().xMax - chart.getViewport().xMin).toBeCloseTo(100, 8);
    expect(chart.getViewport().yMax - chart.getViewport().yMin).toBeCloseTo(80, 8);
    press(chart, "PageDown");
    expect(chart.getViewport().yMax - chart.getViewport().yMin).toBeCloseTo(100, 8);
    chart.dispose();
  });

  it("fits to the data with Home or 0 and leaves the key alone when there is nothing to fit", () => {
    const empty = make();
    const nothing = press(empty, "Home");
    expect(nothing.defaultPrevented).toBe(false);
    empty.dispose();

    const chart = make();
    const series = chart.addLine({ capacity: 8 });
    for (let x = 0; x < 5; x++) series.append({ x, y: x * 2 });
    const home = press(chart, "Home");
    expect(home.defaultPrevented).toBe(true);
    const fit = chart.getViewport();
    // 5% padding around x 0..4 and y 0..8.
    expect(fit.xMin).toBeCloseTo(-0.2, 8);
    expect(fit.xMax).toBeCloseTo(4.2, 8);
    chart.setViewport({ xMin: 50, xMax: 60 });
    press(chart, "0");
    expect(chart.getViewport().xMin).toBeCloseTo(-0.2, 8);
    chart.dispose();
  });

  it("ignores other keys, modifiers, form controls, and events another handler already handled", () => {
    const chart = make();
    const before = chart.getViewport();
    expect(press(chart, "a").defaultPrevented).toBe(false);
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }] as const) {
      expect(press(chart, "ArrowRight", init).defaultPrevented).toBe(false);
    }

    for (const tag of ["input", "textarea", "select"] as const) {
      const field = document.createElement(tag);
      chart.rootElement.appendChild(field);
      expect(press(chart, "ArrowRight", {}, field).defaultPrevented).toBe(false);
      field.remove();
    }

    const child = document.createElement("button");
    chart.rootElement.appendChild(child);
    child.addEventListener("keydown", (event) => event.preventDefault());
    press(chart, "ArrowRight", {}, child);
    expect(chart.getViewport()).toEqual(before);

    // A focusable child that does not handle the key lets it reach the chart.
    const other = document.createElement("button");
    chart.rootElement.appendChild(other);
    expect(press(chart, "ArrowRight", {}, other).defaultPrevented).toBe(true);
    expect(chart.getViewport().xMin).toBe(10);
    chart.dispose();
  });

  it("applies panFraction and zoomFactor, falling back for invalid values", () => {
    const tuned = make({ accessibility: { keyboard: { panFraction: 0.2, zoomFactor: 2 } } });
    press(tuned, "ArrowRight");
    expect(tuned.getViewport().xMin).toBeCloseTo(20, 8);
    press(tuned, "+");
    expect(tuned.getViewport().xMax - tuned.getViewport().xMin).toBeCloseTo(50, 8);
    tuned.dispose();

    const invalid = make({ accessibility: { keyboard: { panFraction: Number.NaN, zoomFactor: 0.5 } } });
    press(invalid, "ArrowRight");
    expect(invalid.getViewport().xMin).toBeCloseTo(10, 8);
    press(invalid, "+");
    expect(invalid.getViewport().xMax - invalid.getViewport().xMin).toBeCloseTo(80, 8);
    invalid.dispose();
  });

  it("passes keyboard pan and zoom through the viewport policy", () => {
    const chart = make({ viewportPolicy: { beforePan: () => null, beforeZoom: () => null } });
    const before = chart.getViewport();
    press(chart, "ArrowRight");
    press(chart, "+");
    expect(chart.getViewport()).toEqual(before);
    chart.dispose();
  });

  it("stops listening for keys after dispose", () => {
    const chart = make();
    const root = chart.rootElement;
    chart.dispose();
    const event = keyEvent("ArrowRight");
    fire(root, event);
    expect(event.defaultPrevented).toBe(false);
  });
});
