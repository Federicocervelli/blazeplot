import { describe, expect, it } from "bun:test";
import { selectionPlugin } from "../../src/plugins/selection.ts";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import type { SelectionEvent, SelectionPluginOptions, SelectionState } from "../../src/ui/Selection.ts";
import { countNodes } from "./fakes.ts";
import { fire, installPlugin, keyEvent, pluginContext, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function make(options: SelectionPluginOptions = {}): { chart: Chart; plugin: ReturnType<typeof selectionPlugin>; events: SelectionEvent[]; selects: Array<SelectionState | null> } {
  const events: SelectionEvent[] = [];
  const selects: Array<SelectionState | null> = [];
  const wrapped = selectionPlugin({ ...options, onChange: (event) => { events.push(event); options.onChange?.(event); } });
  const chart = h.make({ plugins: [wrapped] });
  chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
  chart.subscribe("select", ({ selection }) => selects.push(selection as SelectionState | null));
  return { chart, plugin: wrapped, events, selects };
}

function drag(chart: Chart, from: [number, number], to: [number, number]): void {
  fire(chart.canvas, pointerEvent("pointerdown", from[0], from[1]));
  fire(chart.canvas, pointerEvent("pointermove", to[0], to[1]));
  fire(chart.canvas, pointerEvent("pointerup", to[0], to[1]));
}

const overlayOf = (chart: Chart): HTMLElement => chart.plotElement.querySelector(".blazeplot-selection-brush") as HTMLElement;

describe("selectionPlugin", () => {
  it("emits start, update, and commit and publishes the selection on the chart", () => {
    const { chart, plugin, events, selects } = make();
    const overlay = overlayOf(chart);
    expect(overlay.style.display).toBe("none");

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointermove", 300, 150));
    expect(overlay.style.display).toBe("block");
    expect(overlay.style.left).toBe("100px");
    expect(overlay.style.width).toBe("200px");
    fire(chart.canvas, pointerEvent("pointerup", 300, 150));

    expect(events.map((e) => e.type)).toEqual(["start", "update", "commit"]);
    const selection = plugin.getSelection()!;
    expect(selection.mode).toBe("xy");
    expect(selection.yAxis).toBe("left");
    expect(selection.bounds.xMin).toBeCloseTo(25, 5);
    expect(selection.bounds.xMax).toBeCloseTo(75, 5);
    expect(selection.bounds.yMin).toBeCloseTo(25, 5);
    expect(selection.bounds.yMax).toBeCloseTo(75, 5);
    expect(selection.plotBounds).toEqual({ left: 100, top: 50, width: 200, height: 100 });
    expect(selects).toEqual([selection]);
    expect(events[2]!.selection).toBe(selection);
    expect(overlay.style.display).toBe("block");
    chart.dispose();
  });

  it("clamps drags to the plot and supports reverse drags", () => {
    const { chart, plugin } = make();
    drag(chart, [500, 300], [-50, -50]);
    const { bounds, plotBounds } = plugin.getSelection()!;
    expect(bounds.xMin).toBeCloseTo(0, 5);
    expect(bounds.xMax).toBeCloseTo(100, 5);
    expect(bounds.yMin).toBeCloseTo(0, 5);
    expect(bounds.yMax).toBeCloseTo(100, 5);
    expect(plotBounds).toEqual({ left: 0, top: 0, width: 400, height: 200 });
    chart.dispose();
  });

  it("limits the geometry in x-range and y-range modes", () => {
    const x = make({ mode: "x-range" });
    drag(x.chart, [100, 50], [300, 150]);
    expect(x.plugin.getSelection()!.bounds).toMatchObject({ yMin: 0, yMax: 100 });
    expect(x.plugin.getSelection()!.plotBounds).toEqual({ left: 100, top: 0, width: 200, height: 200 });
    x.chart.dispose();

    const y = make({ mode: "y-range" });
    drag(y.chart, [100, 50], [300, 150]);
    expect(y.plugin.getSelection()!.bounds).toMatchObject({ xMin: 0, xMax: 100 });
    expect(y.plugin.getSelection()!.plotBounds).toEqual({ left: 0, top: 50, width: 400, height: 100 });
    y.chart.dispose();
  });

  it("ignores short drags, canceled drags, other buttons, and other pointers", () => {
    const { chart, plugin, events, selects } = make({ minDragDistancePx: 10 });
    drag(chart, [100, 50], [103, 50]);
    expect(plugin.getSelection()).toBeNull();
    expect(overlayOf(chart).style.display).toBe("none");

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointermove", 300, 150));
    fire(chart.canvas, pointerEvent("pointercancel", 300, 150));
    expect(plugin.getSelection()).toBeNull();
    expect(overlayOf(chart).style.display).toBe("none");

    const secondary = pointerEvent("pointerdown", 100, 50, { button: 2 });
    fire(chart.canvas, secondary);
    expect(secondary.defaultPrevented).toBe(false);

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointerup", 300, 150, { pointerId: 7 }));
    expect(plugin.getSelection()).toBeNull();
    expect(events.map((e) => e.type)).not.toContain("commit");
    expect(selects).toEqual([]);
    chart.dispose();
  });

  it("keeps the committed rectangle on its data bounds when the viewport changes", () => {
    const { chart, plugin } = make();
    drag(chart, [100, 50], [300, 150]);
    chart.setViewport({ xMin: 0, xMax: 50 });
    chart.start();
    h.raf.flush();
    // x 25..50 now spans 200..400px, so the box has moved and shrunk to the plot edge.
    expect(overlayOf(chart).style.left).toBe("200px");
    expect(overlayOf(chart).style.width).toBe("200px");
    expect(plugin.getSelection()!.plotBounds.left).toBe(200);
    chart.dispose();
  });

  it("clears with Escape only in the chart that was last pressed", () => {
    const a = make();
    const b = make();
    drag(a.chart, [100, 50], [300, 150]);
    drag(b.chart, [100, 50], [300, 150]);
    // Pressing the canvas armed chart B; Escape clears B but not A.
    fire(b.chart.canvas, pointerEvent("pointerdown", 10, 10));
    fire(b.chart.canvas, pointerEvent("pointerup", 10, 10));
    fire(globalThis as unknown as EventTarget, keyEvent("Escape"));
    expect(a.plugin.getSelection()).not.toBeNull();
    expect(b.plugin.getSelection()).toBeNull();
    expect(b.selects.at(-1)).toBeNull();
    expect(b.events.at(-1)).toMatchObject({ type: "clear", selection: null });
    expect(overlayOf(b.chart).style.display).toBe("none");

    fire(a.chart.canvas, pointerEvent("pointerdown", 10, 10));
    fire(a.chart.canvas, pointerEvent("pointerup", 10, 10));
    fire(globalThis as unknown as EventTarget, keyEvent("Escape"));
    expect(a.plugin.getSelection()).toBeNull();
    a.chart.dispose();
    b.chart.dispose();
  });

  it("arms Escape on focus moves into the chart and ignores other keys", () => {
    const { chart, plugin } = make();
    drag(chart, [100, 50], [300, 150]);
    fire(document.body, new window.FocusEvent("focusin", { bubbles: true }));
    fire(globalThis as unknown as EventTarget, keyEvent("Escape"));
    // Focus left the chart, so Escape is not ours.
    expect(plugin.getSelection()).not.toBeNull();

    fire(chart.rootElement, new window.FocusEvent("focusin", { bubbles: true }));
    fire(globalThis as unknown as EventTarget, keyEvent("Enter"));
    expect(plugin.getSelection()).not.toBeNull();
    fire(globalThis as unknown as EventTarget, keyEvent("Escape"));
    expect(plugin.getSelection()).toBeNull();
    chart.dispose();
  });

  it("does not clear on Escape when clearOnEscape is false, but clear() still works", () => {
    const { chart, plugin, events } = make({ clearOnEscape: false });
    drag(chart, [100, 50], [300, 150]);
    fire(chart.canvas, pointerEvent("pointerdown", 10, 10));
    fire(chart.canvas, pointerEvent("pointerup", 10, 10));
    fire(globalThis as unknown as EventTarget, keyEvent("Escape"));
    expect(plugin.getSelection()).not.toBeNull();
    plugin.clear();
    expect(plugin.getSelection()).toBeNull();
    expect(events.at(-1)?.type).toBe("clear");
    chart.dispose();
  });

  it("applies theme colors and overrides", () => {
    const { chart } = make();
    chart.setTheme({ selectionFillColor: "rgb(1, 2, 3)" });
    expect(overlayOf(chart).style.background).toBe("rgb(1, 2, 3)");
    chart.dispose();

    const custom = make({ fillColor: "rgb(9, 9, 9)", strokeColor: "rgb(8, 8, 8)", className: "my-brush", zIndex: 3 });
    const overlay = custom.chart.plotElement.querySelector(".my-brush") as HTMLElement;
    expect(overlay.style.background).toBe("rgb(9, 9, 9)");
    expect(overlay.style.border).toContain("rgb(8, 8, 8)");
    expect(overlay.style.zIndex).toBe("3");
    custom.chart.dispose();
  });

  it("removes its overlay and every window and canvas listener when disposed alone", () => {
    const chart = h.make();
    chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
    const nodes = countNodes(chart.rootElement);
    const listeners = h.ledger().reachable();
    const plugin = selectionPlugin();
    const dispose = installPlugin(chart, plugin);
    expect(h.ledger().reachable()).toBeGreaterThan(listeners);
    drag(chart, [100, 50], [300, 150]);
    expect(plugin.getSelection()).not.toBeNull();
    dispose();
    expect(h.ledger().reachable()).toBe(listeners);
    expect(countNodes(chart.rootElement)).toBe(nodes);
    expect(plugin.getSelection()).toBeNull();
    chart.dispose();
  });

  it("leaves no listeners reachable after the chart is disposed", () => {
    const { chart } = make();
    chart.dispose();
    expect(h.ledger().reachable()).toBe(0);
  });
});

describe("selectionPlugin keyboard", () => {
  const press = (chart: Chart, key: string, init: Parameters<typeof keyEvent>[1] = {}, target: EventTarget = chart.rootElement): KeyboardEvent => {
    const event = keyEvent(key, init);
    fire(target, event);
    return event;
  };
  const status = (chart: Chart): string => (chart.rootElement.querySelector(".blazeplot-selection-status")?.textContent ?? "").replace(/ $/, "");

  it("extends a range from the plot center with Shift+Arrow, commits with Enter, and emits select", () => {
    const { chart, plugin, events, selects } = make({ mode: "x-range" });
    chart.installPlugin(interactionsPlugin());
    const right = press(chart, "ArrowRight", { shiftKey: true });
    expect(right.defaultPrevented).toBe(true);
    // The chart's own Shift+Arrow pan did not run.
    expect(chart.getViewport().xMin).toBe(0);
    press(chart, "ArrowRight", { shiftKey: true });
    expect(events.map((event) => event.type)).toEqual(["start", "update"]);
    expect(events[1]!.sourceEvent).toBeInstanceOf(window.KeyboardEvent);
    expect(overlayOf(chart).style.display).toBe("block");
    expect(overlayOf(chart).style.left).toBe("200px");
    expect(overlayOf(chart).style.width).toBe("40px");
    expect(status(chart)).toBe("Selecting X from 50.0 to 60.0.");
    // Up/Down do nothing in x-range mode, so they fall through to the chart.
    expect(press(chart, "ArrowUp", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(chart.getViewport().yMin).toBe(25);

    expect(press(chart, "Enter").defaultPrevented).toBe(true);
    expect(plugin.getSelection()?.bounds.xMin).toBeCloseTo(50, 8);
    expect(plugin.getSelection()?.bounds.xMax).toBeCloseTo(60, 8);
    expect(selects.at(-1)?.bounds.xMax).toBeCloseTo(60, 8);
    expect(events.at(-1)?.type).toBe("commit");
    expect(status(chart)).toBe("Selected X from 50.0 to 60.0.");
    // Without a pending range, Enter is not consumed.
    expect(press(chart, "Enter").defaultPrevented).toBe(false);
    chart.dispose();
  });

  it("starts from the keyboard inspection cursor and cancels with Escape, keeping the committed selection", () => {
    const { chart, plugin } = make({ mode: "xy" });
    const series = chart.addLine({ capacity: 128, name: "A" });
    for (let x = 0; x <= 100; x += 10) series.append({ x, y: x });
    pluginContext(chart).state.inspect({ series, index: 2 });
    press(chart, "ArrowLeft", { shiftKey: true });
    expect(status(chart)).toBe("Selecting X from 15.0 to 20.0, Y from 20.0 to 20.0. Enter commits, Escape cancels.");
    press(chart, "ArrowDown", { shiftKey: true });
    expect(status(chart)).toBe("Selecting X from 15.0 to 20.0, Y from 15.0 to 20.0.");
    press(chart, "Enter");
    const committed = plugin.getSelection();
    for (const [key, value] of Object.entries({ xMin: 15, xMax: 20, yMin: 15, yMax: 20 })) expect(committed?.bounds[key as "xMin"]).toBeCloseTo(value, 8);

    press(chart, "ArrowRight", { shiftKey: true });
    expect(press(chart, "Escape").defaultPrevented).toBe(true);
    expect(status(chart)).toBe("Selection cancelled.");
    expect(plugin.getSelection()).toBe(committed);
    expect(overlayOf(chart).style.display).toBe("block");
    chart.dispose();
  });

  it("ignores keys from child controls, with modifiers, or when keyboard is false", () => {
    const { chart, events } = make();
    const child = document.createElement("button");
    chart.rootElement.appendChild(child);
    press(chart, "ArrowRight", { shiftKey: true }, child);
    press(chart, "ArrowRight", { shiftKey: true, ctrlKey: true });
    press(chart, "ArrowRight");
    expect(events).toEqual([]);
    chart.dispose();

    const off = make({ keyboard: false });
    press(off.chart, "ArrowRight", { shiftKey: true });
    expect(off.events).toEqual([]);
    expect(off.chart.rootElement.querySelector(".blazeplot-selection-status")).toBeNull();
    off.chart.dispose();
  });

  it("steps by the configured fraction and announces clearing", () => {
    const { chart, plugin } = make({ mode: "x-range", keyboard: { step: 0.25 } });
    press(chart, "ArrowLeft", { shiftKey: true });
    press(chart, "Enter");
    expect(plugin.getSelection()?.bounds.xMin).toBeCloseTo(25, 8);
    expect(plugin.getSelection()?.bounds.xMax).toBeCloseTo(50, 8);
    plugin.clear();
    expect(status(chart)).toBe("Selection cleared.");
    chart.dispose();
  });
});
