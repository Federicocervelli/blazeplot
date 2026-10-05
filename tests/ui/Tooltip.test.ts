import { describe, expect, it } from "bun:test";
import { crosshairPlugin } from "../../src/plugins/crosshair.ts";
import { legendPlugin } from "../../src/plugins/legend.ts";
import { tooltipPlugin } from "../../src/plugins/tooltip.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import { countNodes } from "./fakes.ts";
import { fire, installPlugin, pointerEvent, stubBox, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function seed(chart: Chart, name = "A", scale = 10): void {
  const series = chart.addLine({ capacity: 32, name });
  for (let x = 0; x <= 10; x++) series.append({ x, y: x * scale });
  chart.setViewport({ xMin: 0, xMax: 10 });
  chart.setViewport({ yMin: 0, yMax: 100 });
}

function tooltipOf(): HTMLElement {
  return document.body.querySelector(".blazeplot-tooltip") as HTMLElement;
}

/** Move the pointer over the plot and run the chart's and the plugin's deferred hover frames. */
function hover(chart: Chart, x: number, y: number): void {
  fire(chart.canvas, pointerEvent("pointermove", x, y));
  h.raf.flush();
  h.raf.flush();
}

describe("tooltipPlugin", () => {
  it("mounts a hidden role=tooltip element on the document body and a marker layer in the plot", () => {
    const chart = h.make({ plugins: [tooltipPlugin()] });
    const tip = tooltipOf();
    expect(tip.parentElement).toBe(document.body);
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(tip.style.display).toBe("none");
    expect(tip.style.pointerEvents).toBe("none");
    expect(chart.plotElement.querySelector(".blazeplot-tooltip-markers")).not.toBeNull();
    chart.dispose();
  });

  it("shows picked values with aria-hidden=false on hover and hides on pointer leave", () => {
    const chart = h.make({ plugins: [tooltipPlugin()] });
    seed(chart);
    hover(chart, 200, 100);
    const tip = tooltipOf();
    expect(tip.style.display).toBe("block");
    expect(tip.getAttribute("aria-hidden")).toBe("false");
    expect(tip.textContent).toContain("A");
    expect(tip.textContent).toContain("(5, 50)");

    fire(chart.canvas, pointerEvent("pointerleave", 200, 100));
    h.raf.flush();
    expect(tip.style.display).toBe("none");
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    chart.dispose();
  });

  it("clamps the tooltip position inside the viewport", () => {
    const chart = h.make({ plugins: [tooltipPlugin({ offsetX: 10, offsetY: 10 })] }, { width: 790, height: 200 });
    seed(chart);
    hover(chart, 785, 100);
    // window is 800x600; the fallback tooltip size is 240x80, with a 4px margin.
    expect(tooltipOf().style.transform).toBe("translate(556px, 110px)");
    hover(chart, 100, 100);
    expect(tooltipOf().style.transform).toBe("translate(110px, 110px)");
    chart.dispose();
  });

  it("uses the formatter and escapes nothing into HTML (text only)", () => {
    const chart = h.make({
      plugins: [tooltipPlugin({ formatter: (item) => `<b>${item.y}</b>` })],
    });
    seed(chart);
    hover(chart, 200, 100);
    const tip = tooltipOf();
    expect(tip.querySelector("b")).toBeNull();
    expect(tip.textContent).toContain("<b>50</b>");
    chart.dispose();
  });

  it("delegates to a custom render function", () => {
    const seen: number[] = [];
    const chart = h.make({
      plugins: [tooltipPlugin({ render: (state, container) => { seen.push(state.items.length); container.textContent = "custom"; } })],
    });
    seed(chart);
    hover(chart, 200, 100);
    expect(seen.length).toBeGreaterThan(0);
    expect(tooltipOf().textContent).toBe("custom");
    chart.dispose();
  });

  it("draws one marker per picked item and hides spares, unless highlight is false", () => {
    const chart = h.make({ plugins: [tooltipPlugin()] });
    seed(chart, "A");
    seed(chart, "B", 5);
    hover(chart, 200, 100);
    const layer = chart.plotElement.querySelector(".blazeplot-tooltip-markers") as HTMLElement;
    expect([...layer.children].map((m) => (m as HTMLElement).style.display)).toEqual(["block", "block"]);
    fire(chart.canvas, pointerEvent("pointerleave", 200, 100));
    h.raf.flush();
    expect([...layer.children].map((m) => (m as HTMLElement).style.display)).toEqual(["none", "none"]);
    chart.dispose();

    const quiet = h.make({ plugins: [tooltipPlugin({ highlight: false })] });
    seed(quiet);
    hover(quiet, 200, 100);
    expect(quiet.plotElement.querySelector(".blazeplot-tooltip-markers")!.children).toHaveLength(0);
    quiet.dispose();
  });

  it("re-picks when its mode, group, or maxDistancePx differ from the chart's hover state", () => {
    const chart = h.make({ plugins: [tooltipPlugin({ group: "none", mode: "nearest-point", maxDistancePx: 1000 })] });
    seed(chart, "A");
    seed(chart, "B", 5);
    hover(chart, 200, 100);
    // group "none" yields only the single nearest point rather than every series.
    const lines = tooltipOf().textContent!.split(/A|B/).length - 1;
    expect(lines).toBe(1);
    chart.dispose();
  });

  it("applies theme colors and refreshes on themechange", () => {
    const chart = h.make({ plugins: [tooltipPlugin()] });
    const tip = tooltipOf();
    expect(tip.style.background).not.toBe("");
    chart.setTheme({ tooltipBackgroundColor: "rgb(1, 2, 3)", tooltipTextColor: "rgb(4, 5, 6)" });
    expect(tip.style.background).toBe("rgb(1, 2, 3)");
    expect(tip.style.color).toBe("rgb(4, 5, 6)");
    chart.dispose();

    const explicit = h.make({ plugins: [tooltipPlugin({ backgroundColor: "red", className: "tt", zIndex: 5 })] });
    const custom = document.body.querySelector(".tt") as HTMLElement;
    expect(custom.style.background).toBe("red");
    expect(custom.style.zIndex).toBe("5");
    explicit.setTheme({ tooltipBackgroundColor: "rgb(9, 9, 9)" });
    expect(custom.style.background).toBe("red");
    explicit.dispose();
  });

  it("locks the tooltip width to the widest content when lockWidth is set", () => {
    const chart = h.make({ plugins: [tooltipPlugin({ lockWidth: true })] });
    seed(chart);
    const tip = tooltipOf();
    let width = 120;
    stubBox(tip, { width: 0, height: 0 });
    tip.getBoundingClientRect = () => ({ width, height: 20, left: 0, top: 0, right: width, bottom: 20, x: 0, y: 0, toJSON() {} }) as DOMRect;
    hover(chart, 200, 100);
    expect(tip.style.minWidth).toBe("120px");
    width = 80;
    hover(chart, 210, 100);
    expect(tip.style.minWidth).toBe("120px");
    fire(chart.canvas, pointerEvent("pointerleave", 210, 100));
    h.raf.flush();
    expect(tip.style.minWidth).toBe("");
    chart.dispose();
  });

  it("links tooltips across charts that share a syncGroup", () => {
    const a = h.make({ plugins: [tooltipPlugin({ syncGroup: "g1", className: "tt-a" })] });
    const b = h.make({ plugins: [tooltipPlugin({ syncGroup: "g1", className: "tt-b" })] });
    const solo = h.make({ plugins: [tooltipPlugin({ className: "tt-solo" })] });
    for (const chart of [a, b, solo]) seed(chart);
    hover(a, 200, 100);
    h.raf.flush();
    expect(document.body.querySelector(".tt-a")!.getAttribute("aria-hidden")).toBe("false");
    expect(document.body.querySelector(".tt-b")!.getAttribute("aria-hidden")).toBe("false");
    expect(document.body.querySelector(".tt-solo")!.getAttribute("aria-hidden")).toBe("true");

    fire(a.canvas, pointerEvent("pointerleave", 200, 100));
    h.raf.flush();
    expect(document.body.querySelector(".tt-b")!.getAttribute("aria-hidden")).toBe("true");
    for (const chart of [a, b, solo]) chart.dispose();
  });

  it("shows after a touch long press and cancels when the touch ends first", async () => {
    const chart = h.make({ plugins: [tooltipPlugin({ longPressMs: 1 })] });
    seed(chart);
    fire(chart.canvas, pointerEvent("pointerdown", 200, 100, { pointerType: "touch" }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(tooltipOf().getAttribute("aria-hidden")).toBe("false");
    fire(chart.canvas, pointerEvent("pointerup", 200, 100, { pointerType: "touch" }));
    chart.dispose();

    const cancelled = h.make({ plugins: [tooltipPlugin({ longPressMs: 1 })] });
    seed(cancelled);
    fire(cancelled.canvas, pointerEvent("pointerdown", 200, 100, { pointerType: "touch" }));
    fire(cancelled.canvas, pointerEvent("pointerup", 200, 100, { pointerType: "touch" }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(tooltipOf().getAttribute("aria-hidden")).toBe("true");
    cancelled.dispose();

    const off = h.make({ plugins: [tooltipPlugin({ longPressMs: false })] });
    seed(off);
    fire(off.canvas, pointerEvent("pointerdown", 200, 100, { pointerType: "touch" }));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(tooltipOf().getAttribute("aria-hidden")).toBe("true");
    off.dispose();
  });

  it("long press shows after a still hold, follows the finger, and cancels on drift or a second finger", async () => {
    const touch = (type: string, x: number, y: number, pointerId = 1): PointerEvent => pointerEvent(type, x, y, { pointerType: "touch", pointerId });
    const chart = h.make({ plugins: [tooltipPlugin({ longPressMs: 1 })] });
    seed(chart);
    const tip = tooltipOf();
    fire(chart.canvas, touch("pointerdown", 200, 100));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(tip.getAttribute("aria-hidden")).toBe("false");
    expect(tip.textContent).toContain("(5, 50)");
    // Once active, moves are claimed so other gesture handlers skip them, and the tooltip follows.
    const move = touch("pointermove", 240, 100);
    fire(chart.canvas, move);
    expect(move.defaultPrevented).toBe(true);
    expect(tip.textContent).toContain("(6, 60)");
    fire(chart.canvas, touch("pointerup", 240, 100));
    chart.dispose();

    const moved = h.make({ plugins: [tooltipPlugin({ longPressMs: 20 })] });
    seed(moved);
    const movedTip = tooltipOf();
    fire(moved.canvas, touch("pointerdown", 200, 100));
    // Moving more than the threshold before the delay cancels the press.
    fire(moved.canvas, touch("pointermove", 260, 100));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(movedTip.getAttribute("aria-hidden")).toBe("true");
    moved.dispose();

    const multi = h.make({ plugins: [tooltipPlugin({ longPressMs: 1 })] });
    seed(multi);
    fire(multi.canvas, touch("pointerdown", 200, 100, 1));
    fire(multi.canvas, touch("pointerdown", 220, 100, 2));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(tooltipOf().getAttribute("aria-hidden")).toBe("true");
    multi.dispose();
  });

  it("lets the page scroll vertically but keeps sideways long-press drags", () => {
    const chart = h.make({ plugins: [tooltipPlugin()] });
    expect(chart.canvas.style.touchAction).toBe("pan-y");
    chart.dispose();
    const off = h.make({ plugins: [tooltipPlugin({ longPressMs: false })] });
    expect(off.canvas.style.touchAction).toBe("");
    off.dispose();
  });

  it("removes its DOM, listeners, and pending frames on dispose", () => {
    const baselineNodes = countNodes(document.body);
    const chart = h.make({ plugins: [tooltipPlugin()] });
    seed(chart);
    fire(chart.canvas, pointerEvent("pointermove", 200, 100));
    // A tooltip hover frame is pending until the chart frame runs; dispose must cancel both.
    chart.dispose();
    expect(h.raf.pending.size).toBe(0);
    expect(tooltipOf()).toBeNull();
    expect(countNodes(document.body)).toBe(baselineNodes);
    expect(h.ledger().reachable()).toBe(0);
  });

  it("disposing only the plugin leaves the chart's own listeners and DOM intact", () => {
    const chart = h.make();
    const nodes = countNodes(chart.rootElement);
    const bodyNodes = countNodes(document.body);
    const listeners = h.ledger().reachable();
    const dispose = installPlugin(chart, tooltipPlugin({ syncGroup: "x" }));
    seed(chart);
    hover(chart, 200, 100);
    dispose();
    h.raf.flush();
    expect(h.ledger().reachable()).toBe(listeners);
    expect(countNodes(chart.rootElement)).toBe(nodes);
    expect(countNodes(document.body)).toBe(bodyNodes);
    expect(h.raf.pending.size).toBe(0);
    chart.dispose();
  });
});

describe("plugin-owned styles", () => {
  const sheets = (): string[] => [...document.head.querySelectorAll("style[data-blazeplot-plugin-style]")].map((el) => el.getAttribute("data-blazeplot-plugin-style")!).sort();

  it("injects one stylesheet per plugin per document and removes it with the last user", () => {
    const before = sheets();
    const a = h.make({ plugins: [tooltipPlugin(), crosshairPlugin(), legendPlugin()] });
    const b = h.make({ plugins: [tooltipPlugin(), crosshairPlugin()] });
    // The pick rules are shared by the tooltip and crosshair.
    expect(sheets()).toEqual([...before, "legend", "pick", "tooltip"].sort());
    a.dispose();
    expect(sheets()).toEqual([...before, "pick", "tooltip"].sort());
    b.dispose();
    expect(sheets()).toEqual(before);
  });

  it("keeps plugin rules out of charts without the plugin", () => {
    const chart = h.make();
    expect(sheets()).toEqual([]);
    expect(chart.rootElement.querySelector("style.blazeplot-style")!.textContent).not.toContain("blazeplot-tooltip");
    chart.dispose();
  });
});
