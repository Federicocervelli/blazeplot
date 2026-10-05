import { describe, expect, it } from "bun:test";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import type { InteractionsPluginOptions } from "../../src/plugins/interactions/Interactions.ts";
import { tooltipPlugin } from "../../src/plugins/tooltip.ts";
import { countNodes } from "./fakes.ts";
import { fire, installPlugin, pointerEvent, useChartHarness, wheelEvent } from "./harness.ts";

const h = useChartHarness();

/** 400x200 plot showing x 0..100, y 0..100 (left) and 0..10 (right). */
function make(options: InteractionsPluginOptions = {}, axes: Record<string, boolean> = { x: true, y: true, y2: true }): Chart {
  const chart = h.make({ axes, plugins: [interactionsPlugin(options)] });
  chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
  chart.setViewport({ yMin: 0, yMax: 10 }, "right");
  return chart;
}

const span = (chart: Chart, axis: "x" | "y"): number => {
  const v = chart.getViewport();
  return axis === "x" ? v.xMax - v.xMin : v.yMax - v.yMin;
};

describe("interactionsPlugin install and dispose", () => {
  it("adds a hidden selection box and axis gutter affordances, and restores everything on dispose", () => {
    const chart = h.make({ axes: { x: true, y: true, y2: true } });
    const root = chart.rootElement;
    const x = chart.xAxisElement;
    const y = chart.yAxisElement;
    const before = {
      nodes: countNodes(root),
      listeners: h.ledger().reachable(),
      canvasTouch: chart.canvas.style.touchAction,
      xPointer: x.style.pointerEvents,
      yCursor: y.style.cursor,
      xFilter: x.style.filter,
      xClass: x.className,
    };

    const dispose = installPlugin(chart, interactionsPlugin());
    const box = chart.plotElement.querySelector(".blazeplot-selection") as HTMLElement;
    expect(box.style.display).toBe("none");
    expect(box.style.pointerEvents).toBe("none");
    expect(chart.canvas.style.touchAction).toBe("none");
    expect(x.style.pointerEvents).toBe("auto");
    expect(x.style.cursor).toBe("ew-resize");
    expect(y.style.cursor).toBe("ns-resize");
    expect(root.querySelector("style:not(.blazeplot-style)")).not.toBeNull();
    fire(x, pointerEvent("pointerenter", 0, 0));
    expect(x.style.filter).toContain("brightness");

    dispose();
    expect(countNodes(root)).toBe(before.nodes);
    expect(h.ledger().reachable()).toBe(before.listeners);
    expect(chart.canvas.style.touchAction).toBe(before.canvasTouch);
    expect(x.style.pointerEvents).toBe(before.xPointer);
    expect(y.style.cursor).toBe(before.yCursor);
    expect(x.style.filter).toBe(before.xFilter);
    expect(x.className).toBe(before.xClass);
    chart.dispose();
  });

  it("leaves touch-action alone without the plugin so the page can scroll", () => {
    const plain = h.make({ axes: { x: true, y: true } });
    for (const el of [plain.canvas, plain.plotElement, plain.rootElement, plain.xAxisElement, plain.yAxisElement]) {
      expect(el.style.touchAction).toBe("");
    }
    const withPlugin = make();
    expect(withPlugin.canvas.style.touchAction).toBe("none");
  });

  it("keeps the most restrictive touch-action whatever the plugin install order", () => {
    const tooltipFirst = h.make({ plugins: [tooltipPlugin(), interactionsPlugin()] });
    expect(tooltipFirst.canvas.style.touchAction).toBe("none");
    const interactionsFirst = h.make({ plugins: [interactionsPlugin(), tooltipPlugin()] });
    expect(interactionsFirst.canvas.style.touchAction).toBe("none");
    const tooltipOnly = h.make({ plugins: [tooltipPlugin()] });
    expect(tooltipOnly.canvas.style.touchAction).toBe("pan-y");
    for (const chart of [tooltipFirst, interactionsFirst, tooltipOnly]) chart.dispose();
    expect(tooltipOnly.canvas.style.touchAction).toBe("");
  });

  it("does not claim gutters or touch-action when the related options are off", () => {
    const chart = make({ axisInteractions: false, touchPan: false, pinchZoom: false });
    expect(chart.xAxisElement.style.pointerEvents).not.toBe("auto");
    expect(chart.xAxisElement.style.cursor).toBe("");
    expect(chart.canvas.style.touchAction).toBe(h.make().canvas.style.touchAction);
    expect(chart.rootElement.querySelector("style:not(.blazeplot-style)")).toBeNull();
    // Wheel over a gutter does nothing without axisInteractions.
    const before = chart.getViewport();
    const event = wheelEvent(10, 10, { deltaY: -100 });
    fire(chart.yAxisElement, event);
    expect(event.defaultPrevented).toBe(false);
    expect(chart.getViewport()).toEqual(before);
    chart.dispose();
  });

  it("leaves no reachable listeners or nodes after the chart is disposed", () => {
    const nodes = countNodes(document.body);
    const chart = make();
    chart.dispose();
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(0);
  });
});

describe("interactionsPlugin box zoom and pan", () => {
  it("zooms to the dragged rectangle on pointer release", () => {
    const chart = make();
    const box = chart.plotElement.querySelector(".blazeplot-selection") as HTMLElement;
    const down = pointerEvent("pointerdown", 100, 50);
    fire(chart.canvas, down);
    expect(down.defaultPrevented).toBe(true);
    expect(box.style.display).toBe("block");
    fire(chart.canvas, pointerEvent("pointermove", 300, 150));
    expect(box.style.left).toBe("100px");
    expect(box.style.top).toBe("50px");
    expect(box.style.width).toBe("200px");
    expect(box.style.height).toBe("100px");
    fire(chart.canvas, pointerEvent("pointerup", 300, 150));
    expect(box.style.display).toBe("none");

    const v = chart.getViewport();
    expect(v.xMin).toBeCloseTo(25, 5);
    expect(v.xMax).toBeCloseTo(75, 5);
    expect(v.yMin).toBeCloseTo(25, 5);
    expect(v.yMax).toBeCloseTo(75, 5);
    // The right axis maps the same pixel rectangle through its own scale.
    const right = chart.getViewport("right");
    expect(right.yMin).toBeCloseTo(2.5, 5);
    expect(right.yMax).toBeCloseTo(7.5, 5);
    chart.dispose();
  });

  it("restricts box zoom to one axis when axis is set", () => {
    const chart = make({ axis: "x" });
    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointermove", 300, 150));
    fire(chart.canvas, pointerEvent("pointerup", 300, 150));
    const v = chart.getViewport();
    expect(v.xMin).toBeCloseTo(25, 5);
    expect(v.xMax).toBeCloseTo(75, 5);
    expect(v.yMin).toBe(0);
    expect(v.yMax).toBe(100);
    chart.dispose();
  });

  it("ignores drags below minDragDistancePx, pointer cancel, other buttons, and touch pointers", () => {
    const chart = make({ minDragDistancePx: 10 });
    const before = chart.getViewport();
    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointerup", 104, 50));
    expect(chart.getViewport()).toEqual(before);

    fire(chart.canvas, pointerEvent("pointerdown", 100, 50));
    fire(chart.canvas, pointerEvent("pointermove", 300, 150));
    fire(chart.canvas, pointerEvent("pointercancel", 300, 150));
    const box = chart.plotElement.querySelector(".blazeplot-selection") as HTMLElement;
    expect(box.style.display).toBe("none");
    fire(chart.canvas, pointerEvent("pointerup", 300, 150));
    expect(chart.getViewport()).toEqual(before);

    const secondary = pointerEvent("pointerdown", 100, 50, { button: 2 });
    fire(chart.canvas, secondary);
    expect(secondary.defaultPrevented).toBe(false);
    const touch = pointerEvent("pointerdown", 100, 50, { pointerType: "touch" });
    fire(chart.canvas, touch);
    expect(touch.defaultPrevented).toBe(false);
    chart.dispose();
  });

  it("does nothing on drag when boxZoom is disabled", () => {
    const chart = make({ boxZoom: false });
    const down = pointerEvent("pointerdown", 100, 50);
    fire(chart.canvas, down);
    expect(down.defaultPrevented).toBe(false);
    chart.dispose();
  });

  it("pans on shift-drag and follows only the matching pointer id", () => {
    const chart = make();
    fire(chart.canvas, pointerEvent("pointerdown", 200, 100, { shiftKey: true }));
    fire(chart.canvas, pointerEvent("pointermove", 240, 100, { pointerId: 99 }));
    expect(chart.getViewport().xMin).toBe(0);
    fire(chart.canvas, pointerEvent("pointermove", 240, 100));
    // Dragging right by 40 of 400 px moves the window left by 10% of the span.
    expect(chart.getViewport().xMin).toBeCloseTo(-10, 5);
    expect(chart.getViewport().xMax).toBeCloseTo(90, 5);
    fire(chart.canvas, pointerEvent("pointerup", 240, 100));
    fire(chart.canvas, pointerEvent("pointermove", 300, 100));
    expect(chart.getViewport().xMin).toBeCloseTo(-10, 5);
    chart.dispose();
  });

  it("does not shift-pan when shiftDragPan is false", () => {
    const chart = make({ shiftDragPan: false });
    const box = chart.plotElement.querySelector(".blazeplot-selection") as HTMLElement;
    fire(chart.canvas, pointerEvent("pointerdown", 200, 100, { shiftKey: true }));
    // Falls through to a box zoom instead of a pan.
    expect(box.style.display).toBe("block");
    fire(chart.canvas, pointerEvent("pointermove", 240, 100));
    fire(chart.canvas, pointerEvent("pointerup", 240, 100));
    expect(chart.getViewport().xMin).toBe(0);
    chart.dispose();
  });

  it("drags an axis gutter to pan that axis only", () => {
    const chart = make();
    fire(chart.xAxisElement, pointerEvent("pointerdown", 200, 210));
    fire(chart.xAxisElement, pointerEvent("pointermove", 240, 210));
    fire(chart.xAxisElement, pointerEvent("pointerup", 240, 210));
    expect(chart.getViewport().xMin).toBeCloseTo(-10, 5);
    expect(chart.getViewport().yMin).toBe(0);

    fire(chart.yAxisElement, pointerEvent("pointerdown", -10, 100));
    fire(chart.yAxisElement, pointerEvent("pointermove", -10, 120));
    fire(chart.yAxisElement, pointerEvent("pointerup", -10, 120));
    expect(chart.getViewport().yMin).not.toBe(0);
    const rightBefore = chart.getViewport("right").yMin;
    fire(chart.y2AxisElement, pointerEvent("pointerdown", 410, 100));
    fire(chart.y2AxisElement, pointerEvent("pointermove", 410, 80));
    fire(chart.y2AxisElement, pointerEvent("pointerup", 410, 80));
    expect(chart.getViewport("right").yMin).not.toBe(rightBefore);
    chart.dispose();
  });
});

describe("interactionsPlugin wheel", () => {
  it("zooms around the pointer and prevents page scroll", () => {
    const chart = make();
    const event = wheelEvent(100, 100, { deltaY: -100 });
    fire(chart.canvas, event);
    expect(event.defaultPrevented).toBe(true);
    expect(span(chart, "x")).toBeLessThan(100);
    expect(span(chart, "y")).toBeLessThan(100);
    // The point under the pointer (x=25) stays put.
    const [dataX] = chart.clientToData(100, 100)!;
    expect(dataX).toBeCloseTo(25, 3);

    const out = wheelEvent(100, 100, { deltaY: 100 });
    const widthIn = span(chart, "x");
    fire(chart.canvas, out);
    expect(span(chart, "x")).toBeGreaterThan(widthIn);
    chart.dispose();
  });

  it("zooms only the configured axis, and only X on the X gutter", () => {
    const chart = make({ axis: "x" });
    fire(chart.canvas, wheelEvent(100, 100, { deltaY: -100 }));
    expect(span(chart, "x")).toBeLessThan(100);
    expect(span(chart, "y")).toBeCloseTo(100, 8);
    chart.dispose();

    const gutter = make();
    fire(gutter.yAxisElement, wheelEvent(-10, 100, { deltaY: -100 }));
    expect(span(gutter, "x")).toBeCloseTo(100, 8);
    expect(span(gutter, "y")).toBeLessThan(100);
    const rightBefore = gutter.getViewport("right");
    fire(gutter.y2AxisElement, wheelEvent(410, 100, { deltaY: -100 }));
    const rightAfter = gutter.getViewport("right");
    expect(rightAfter.yMax - rightAfter.yMin).toBeLessThan(rightBefore.yMax - rightBefore.yMin);
    fire(gutter.xAxisElement, wheelEvent(100, 210, { deltaY: -100 }));
    expect(span(gutter, "x")).toBeLessThan(100);
    gutter.dispose();
  });

  it("treats small pixel deltas as a trackpad pan unless trackpadPan is off", () => {
    const chart = make();
    fire(chart.canvas, wheelEvent(100, 100, { deltaX: 25, deltaY: 0 }));
    expect(span(chart, "x")).toBeCloseTo(100, 8);
    expect(chart.getViewport().xMin).toBeGreaterThan(0);
    chart.dispose();

    const zoom = make({ trackpadPan: false });
    fire(zoom.canvas, wheelEvent(100, 100, { deltaY: 20 }));
    expect(span(zoom, "x")).toBeGreaterThan(100);
    zoom.dispose();
  });

  it("honors line and page delta modes and ctrl pinch sensitivity", () => {
    const line = make();
    fire(line.canvas, wheelEvent(100, 100, { deltaY: -3, deltaMode: 1 }));
    expect(span(line, "x")).toBeLessThan(100);
    line.dispose();

    const page = make();
    fire(page.canvas, wheelEvent(100, 100, { deltaY: -1, deltaMode: 2 }));
    expect(span(page, "x")).toBeLessThan(100);
    page.dispose();

    const pinch = make();
    fire(pinch.canvas, wheelEvent(100, 100, { deltaY: -10, ctrlKey: true }));
    expect(span(pinch, "x")).toBeLessThan(100);
    pinch.dispose();
  });

  it("ignores wheel input when wheelZoom is off", () => {
    const chart = make({ wheelZoom: false });
    const event = wheelEvent(100, 100, { deltaY: -100 });
    fire(chart.canvas, event);
    expect(event.defaultPrevented).toBe(false);
    expect(span(chart, "x")).toBe(100);
    chart.dispose();
  });
});

describe("interactionsPlugin reset", () => {
  it("restores the viewport captured at first interaction on double click", () => {
    const chart = make();
    fire(chart.canvas, wheelEvent(100, 100, { deltaY: -100 }));
    expect(span(chart, "x")).toBeLessThan(100);
    const event = new window.MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    fire(chart.canvas, event);
    expect(event.defaultPrevented).toBe(true);
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
    expect(chart.getViewport("right")).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 10 });
    chart.dispose();
  });

  it("uses a custom resetViewport, can be disabled, and resumes X follow", () => {
    const chart = make({ resetViewport: () => ({ xMin: 10, xMax: 20, yMin: 0, yMax: 1 }) });
    fire(chart.canvas, new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(chart.getViewport()).toEqual({ xMin: 10, xMax: 20, yMin: 0, yMax: 1 });
    chart.dispose();

    const off = make({ doubleClickReset: false });
    fire(off.canvas, wheelEvent(100, 100, { deltaY: -100 }));
    const zoomed = off.getViewport();
    fire(off.canvas, new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(off.getViewport()).toEqual(zoomed);
    off.dispose();

    const follow = make();
    follow.addLine({ capacity: 8 }).append({ x: 1, y: 1 });
    follow.followX({ window: 50 });
    follow.setFollowXPaused(true);
    expect(follow.getFollowXState()).toBe("paused");
    fire(follow.canvas, new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(follow.getFollowXState()).toBe("following");
    follow.dispose();
  });

  it("keeps follow paused when resumeFollowOnReset is false", () => {
    const chart = make({ resumeFollowOnReset: false });
    chart.addLine({ capacity: 8 }).append({ x: 1, y: 1 });
    chart.followX({ window: 50 });
    chart.setFollowXPaused(true);
    fire(chart.canvas, new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(chart.getFollowXState()).toBe("paused");
    chart.dispose();
  });
});

const touch = (type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", x: number, y: number, pointerId = 1): PointerEvent =>
  pointerEvent(type, x, y, { pointerType: "touch", pointerId });

describe("interactionsPlugin touch", () => {
  it("pans with one finger and pinch-zooms with two", () => {
    const chart = make();
    fire(chart.canvas, touch("pointerdown", 200, 100));
    fire(chart.canvas, touch("pointermove", 240, 100));
    expect(chart.getViewport().xMin).toBeCloseTo(-10, 5);
    fire(chart.canvas, touch("pointerup", 240, 100));
    // A finished gesture does not keep panning.
    fire(chart.canvas, touch("pointermove", 300, 100));
    expect(chart.getViewport().xMin).toBeCloseTo(-10, 5);

    fire(chart.canvas, touch("pointerdown", 150, 100, 1));
    fire(chart.canvas, touch("pointerdown", 250, 100, 2));
    const widthBefore = span(chart, "x");
    fire(chart.canvas, touch("pointermove", 100, 100, 1));
    fire(chart.canvas, touch("pointermove", 300, 100, 2));
    expect(span(chart, "x")).toBeLessThan(widthBefore);
    // Lifting one finger switches back to a pan with the remaining one.
    fire(chart.canvas, touch("pointerup", 300, 100, 2));
    const xMin = chart.getViewport().xMin;
    fire(chart.canvas, touch("pointermove", 140, 100, 1));
    expect(chart.getViewport().xMin).not.toBe(xMin);
    fire(chart.canvas, touch("pointercancel", 140, 100, 1));
    chart.dispose();
  });

  it("pans only the touched axis gutter", () => {
    const chart = make();
    fire(chart.yAxisElement, touch("pointerdown", -10, 100));
    fire(chart.yAxisElement, touch("pointermove", -10, 120));
    expect(chart.getViewport().xMin).toBe(0);
    expect(chart.getViewport().yMin).not.toBe(0);
    chart.dispose();
  });

  it("ignores a move that another plugin already handled", () => {
    const chart = make();
    fire(chart.canvas, touch("pointerdown", 200, 100));
    const move = touch("pointermove", 240, 100);
    move.preventDefault();
    fire(chart.canvas, move);
    expect(chart.getViewport().xMin).toBe(0);
    chart.dispose();
  });

  it("resets on double tap, but not for slow, distant, or dragged taps", () => {
    const chart = make();
    fire(chart.canvas, wheelEvent(100, 100, { deltaY: -100 }));
    const tap = (x: number, stamp: number): PointerEvent => {
      fire(chart.canvas, touch("pointerdown", x, 100));
      const end = touch("pointerup", x, 100);
      Object.defineProperty(end, "timeStamp", { value: stamp });
      fire(chart.canvas, end);
      return end;
    };
    tap(100, 1000);
    tap(300, 1100);
    expect(span(chart, "x")).toBeLessThan(100);
    tap(100, 2000);
    expect(span(chart, "x")).toBeLessThan(100);
    // A drag between taps never counts as a tap.
    fire(chart.canvas, touch("pointerdown", 100, 100));
    fire(chart.canvas, touch("pointermove", 160, 100));
    const dragEnd = touch("pointerup", 160, 100);
    Object.defineProperty(dragEnd, "timeStamp", { value: 2050 });
    fire(chart.canvas, dragEnd);
    const afterDrag = span(chart, "x");
    tap(160, 2100);
    expect(span(chart, "x")).toBe(afterDrag);
    const second = tap(162, 2200);
    expect(second.defaultPrevented).toBe(true);
    expect(chart.getViewport()).toEqual({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
    chart.dispose();
  });

  it("ignores touches when touchPan and pinchZoom are off", () => {
    const chart = make({ touchPan: false, pinchZoom: false });
    fire(chart.canvas, touch("pointerdown", 200, 100));
    fire(chart.canvas, touch("pointermove", 260, 100));
    expect(chart.getViewport().xMin).toBe(0);
    chart.dispose();
  });
});

const hintOf = (chart: Chart): HTMLElement | null => chart.plotElement.querySelector(".blazeplot-gesture-hint");

describe("interactionsPlugin cooperative gestures", () => {
  it('wheelZoom "modifier" scrolls the page without Ctrl and zooms with Ctrl or pinch', () => {
    const chart = make({ wheelZoom: "modifier" });
    const before = chart.getViewport();
    const plain = wheelEvent(100, 100, { deltaY: -100 });
    fire(chart.canvas, plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(chart.getViewport()).toEqual(before);
    const hint = hintOf(chart)!;
    expect(hint.style.display).toBe("flex");
    expect(hint.getAttribute("aria-hidden")).toBe("true");
    expect(hint.textContent).toMatch(/scroll to zoom/);

    const zoom = wheelEvent(100, 100, { deltaY: -100, ctrlKey: true });
    fire(chart.canvas, zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(span(chart, "x")).toBeLessThan(100);
    // Axis gutters are cooperative too.
    const axisWheel = wheelEvent(100, 100, { deltaY: -100 });
    const viewport = chart.getViewport();
    fire(chart.xAxisElement, axisWheel);
    expect(axisWheel.defaultPrevented).toBe(false);
    expect(chart.getViewport()).toEqual(viewport);
    chart.dispose();
  });

  it("themes, words, and hides the hint on request", () => {
    const custom = make({ wheelZoom: "modifier", gestureHint: { wheelText: "Hold Ctrl", backgroundColor: "rgb(1, 2, 3)", textColor: "rgb(4, 5, 6)", durationMs: 5 } });
    fire(custom.canvas, wheelEvent(100, 100, { deltaY: -100 }));
    const label = hintOf(custom)!.firstElementChild as HTMLElement;
    expect(label.textContent).toBe("Hold Ctrl");
    expect(label.style.background).toContain("rgb(1, 2, 3)");
    expect(label.style.color).toBe("rgb(4, 5, 6)");
    custom.dispose();

    const off = make({ wheelZoom: "modifier", gestureHint: false });
    fire(off.canvas, wheelEvent(100, 100, { deltaY: -100 }));
    expect(hintOf(off)).toBeNull();
    off.dispose();
  });

  it("the hint hides itself after its duration", async () => {
    const chart = make({ wheelZoom: "modifier", gestureHint: { durationMs: 5 } });
    fire(chart.canvas, wheelEvent(100, 100, { deltaY: -100 }));
    expect(hintOf(chart)!.style.display).toBe("flex");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hintOf(chart)!.style.display).toBe("none");
    chart.dispose();
  });

  it('touchPan "two-finger" lets one finger scroll the page and uses two fingers to pan and zoom', () => {
    const chart = make({ touchPan: "two-finger" });
    expect(chart.canvas.style.touchAction).toBe("pan-x pan-y");
    const before = chart.getViewport();
    fire(chart.canvas, touch("pointerdown", 200, 100));
    fire(chart.canvas, touch("pointermove", 260, 100));
    expect(chart.getViewport()).toEqual(before);
    expect(hintOf(chart)!.style.display).toBe("flex");
    expect(hintOf(chart)!.textContent).toMatch(/two fingers/);
    // The browser takes over for the scroll.
    fire(chart.canvas, touch("pointercancel", 260, 100));
    expect(chart.getViewport()).toEqual(before);

    fire(chart.canvas, touch("pointerdown", 150, 100, 1));
    fire(chart.canvas, touch("pointerdown", 250, 100, 2));
    const width = span(chart, "x");
    fire(chart.canvas, touch("pointermove", 100, 100, 1));
    fire(chart.canvas, touch("pointermove", 300, 100, 2));
    expect(span(chart, "x")).toBeLessThan(width);
    const afterPinch = chart.getViewport();
    // Moving both fingers together pans.
    fire(chart.canvas, touch("pointermove", 140, 100, 1));
    fire(chart.canvas, touch("pointermove", 340, 100, 2));
    expect(chart.getViewport().xMin).toBeLessThan(afterPinch.xMin);
    expect(span(chart, "x")).toBeCloseTo(afterPinch.xMax - afterPinch.xMin, 5);
    // Lifting one finger does not start a one-finger pan.
    fire(chart.canvas, touch("pointerup", 340, 100, 2));
    const settled = chart.getViewport();
    fire(chart.canvas, touch("pointermove", 200, 100, 1));
    expect(chart.getViewport()).toEqual(settled);
    chart.dispose();
  });

  it('touchPan "two-finger" does not show the hint for pointercancel at the end of a two-finger gesture', () => {
    const chart = make({ touchPan: "two-finger" });
    fire(chart.canvas, touch("pointerdown", 150, 100, 1));
    fire(chart.canvas, touch("pointerdown", 250, 100, 2));
    fire(chart.canvas, touch("pointermove", 100, 100, 1));
    fire(chart.canvas, touch("pointermove", 300, 100, 2));
    expect(hintOf(chart)?.style.display ?? "none").not.toBe("flex");
    // The browser cancels both pointers when it ends the touch sequence.
    fire(chart.canvas, touch("pointercancel", 100, 100, 1));
    fire(chart.canvas, touch("pointercancel", 300, 100, 2));
    expect(hintOf(chart)?.style.display ?? "none").not.toBe("flex");

    // A later one-finger scroll takeover still shows the hint.
    fire(chart.canvas, touch("pointerdown", 200, 100, 3));
    fire(chart.canvas, touch("pointercancel", 200, 100, 3));
    expect(hintOf(chart)!.style.display).toBe("flex");
    chart.dispose();
  });

  it("two-finger mode still pans with one finger on an axis gutter", () => {
    const chart = make({ touchPan: "two-finger" });
    expect(chart.yAxisElement.style.touchAction).toBe("none");
    fire(chart.yAxisElement, touch("pointerdown", -10, 100));
    fire(chart.yAxisElement, touch("pointermove", -10, 120));
    expect(chart.getViewport().yMin).not.toBe(0);
    chart.dispose();
  });
});
