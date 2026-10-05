import { describe, expect, it } from "bun:test";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import { selectionPlugin } from "../../src/plugins/selection.ts";
import type { Chart } from "../../src/ui/Chart.ts";
import type { ChartPlugin } from "../../src/ui/PluginTypes.ts";
import { fire, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function setup(plugins: ChartPlugin[]): Chart {
  const chart = h.make({ plugins });
  chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
  return chart;
}

function drag(chart: Chart, init: { shiftKey?: boolean; altKey?: boolean } = {}, pointerId = 1): void {
  fire(chart.canvas, pointerEvent("pointerdown", 100, 50, { pointerId, ...init }));
  fire(chart.canvas, pointerEvent("pointermove", 300, 150, { pointerId, ...init }));
  fire(chart.canvas, pointerEvent("pointerup", 300, 150, { pointerId, ...init }));
}

const unchanged = (chart: Chart): boolean => {
  const v = chart.getViewport();
  return v.xMin === 0 && v.xMax === 100 && v.yMin === 0 && v.yMax === 100;
};

describe("pointer gesture arbitration", () => {
  for (const order of ["interactions first", "selection first"] as const) {
    it(`a plain drag runs exactly one action with default options (${order})`, () => {
      const commits: string[] = [];
      const selection = selectionPlugin({ onChange: (event) => { if (event.type === "commit") commits.push("select"); } });
      const chart = setup(order === "interactions first" ? [interactionsPlugin(), selection] : [selection, interactionsPlugin()]);
      drag(chart);
      expect(commits).toEqual(["select"]);
      expect(unchanged(chart)).toBe(true);
      chart.dispose();
    });
  }

  it("box zoom runs on its own modifier while selection keeps the plain drag", () => {
    const commits: string[] = [];
    const chart = setup([
      interactionsPlugin({ boxZoomModifier: "alt" }),
      selectionPlugin({ onChange: (event) => { if (event.type === "commit") commits.push("select"); } }),
    ]);
    drag(chart, { altKey: true });
    expect(commits).toEqual([]);
    expect(unchanged(chart)).toBe(false);
    const zoomed = chart.getViewport();
    drag(chart);
    expect(commits).toEqual(["select"]);
    expect(chart.getViewport()).toEqual(zoomed);
    chart.dispose();
  });

  it("selection modifier moves the selection drag to a key and ignores plain drags", () => {
    const commits: string[] = [];
    const chart = setup([selectionPlugin({ modifier: "shift", onChange: (event) => { if (event.type === "commit") commits.push("select"); } })]);
    drag(chart);
    expect(commits).toEqual([]);
    drag(chart, { shiftKey: true });
    expect(commits).toEqual(["select"]);
    chart.dispose();
  });

  it("shift-drag pans instead of selecting by default", () => {
    const commits: string[] = [];
    const chart = setup([interactionsPlugin(), selectionPlugin({ onChange: (event) => { if (event.type === "commit") commits.push("select"); } })]);
    drag(chart, { shiftKey: true });
    expect(commits).toEqual([]);
    expect(chart.getViewport().xMin).not.toBe(0);
    chart.dispose();
  });

  it("lets a third-party plugin claim a drag and the built-ins respect it", () => {
    const claimed: boolean[] = [];
    const commits: string[] = [];
    const thirdParty: ChartPlugin = {
      install(ctx) {
        ctx.dom.listen("plot", "pointerdown", (event) => { claimed.push(ctx.dom.claimPointer(event)); }, { capture: true });
      },
    };
    // The third party installs first, so its capture listener runs before the built-ins' listeners.
    const chart = setup([thirdParty, interactionsPlugin(), selectionPlugin({ onChange: (event) => { if (event.type === "commit") commits.push("select"); } })]);
    drag(chart);
    expect(claimed).toEqual([true]);
    expect(commits).toEqual([]);
    expect(unchanged(chart)).toBe(true);
    chart.dispose();
  });

  it("a third party that loses the claim is told so, and claims end with the pointer", () => {
    const results: boolean[] = [];
    const late: ChartPlugin = {
      install(ctx) {
        ctx.dom.listen("plot", "pointerdown", (event) => { results.push(ctx.dom.claimPointer(event)); });
      },
    };
    const chart = setup([selectionPlugin(), late]);
    drag(chart);
    drag(chart);
    // Selection claims in the capture phase every time; the late plugin never wins.
    expect(results).toEqual([false, false]);
    chart.dispose();

    const solo = setup([late]);
    results.length = 0;
    drag(solo);
    drag(solo);
    expect(results).toEqual([true, true]);
    solo.dispose();
  });

  it("claiming twice from one plugin is allowed and a disposed owner frees the pointer", () => {
    const results: boolean[] = [];
    const first: ChartPlugin = {
      install(ctx) {
        ctx.dom.listen("plot", "pointerdown", (event) => { results.push(ctx.dom.claimPointer(event), ctx.dom.claimPointer(event)); });
      },
    };
    let second = (): boolean => true;
    const other: ChartPlugin = {
      install(ctx) {
        second = () => ctx.dom.claimPointer(pointerEvent("pointerdown", 0, 0));
      },
    };
    const chart = setup([first, other]);
    fire(chart.canvas, pointerEvent("pointerdown", 10, 10));
    expect(results).toEqual([true, true]);
    expect(second()).toBe(false);
    fire(chart.canvas, pointerEvent("pointerup", 10, 10));
    expect(second()).toBe(true);
    chart.dispose();
  });
});
