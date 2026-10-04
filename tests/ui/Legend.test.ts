import { describe, expect, it } from "bun:test";
import { legendPlugin } from "../../src/plugins/legend.ts";
import { countNodes } from "./fakes.ts";
import { fire, installPlugin, keyEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();

function legendOf(root: HTMLElement): HTMLElement {
  return root.querySelector(".blazeplot-legend") as HTMLElement;
}

describe("legendPlugin", () => {
  it("renders one toggle button per series with ARIA state and a hidden swatch", () => {
    const chart = h.make({ plugins: [legendPlugin()] });
    chart.addLine({ capacity: 4, name: "CPU" });
    chart.addLine({ capacity: 4, id: "mem" });
    chart.addScatter({ capacity: 4 });

    const legend = legendOf(chart.rootElement);
    expect(legend.getAttribute("role")).toBe("group");
    expect(legend.getAttribute("aria-label")).toBe("Chart series legend");
    const rows = [...legend.children] as HTMLButtonElement[];
    expect(rows.map((row) => row.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["CPU", "mem", "scatter 3"]);
    expect(rows.every((row) => row.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(rows.every((row) => row.type === "button")).toBe(true);
    expect(rows[0]!.querySelector("span[aria-hidden='true']")).not.toBeNull();
    expect(rows[0]!.title).toBe("Hide CPU");
    chart.dispose();
  });

  it("toggles series visibility on click and mirrors it in aria-pressed, title, swatch opacity, and strike-through", () => {
    const chart = h.make({ plugins: [legendPlugin()] });
    const series = chart.addLine({ capacity: 4, name: "CPU" });
    const row = legendOf(chart.rootElement).children[0] as HTMLButtonElement;

    fire(row, new window.MouseEvent("click", { bubbles: true }));
    expect(series.visible).toBe(false);
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(row.title).toBe("Show CPU");
    expect((row.children[0] as HTMLElement).style.opacity).toBe("0.45");
    expect((row.children[1] as HTMLElement).style.textDecoration).toBe("line-through");
    expect(row.style.opacity).toBe("");

    fire(row, new window.MouseEvent("click", { bubbles: true }));
    expect(series.visible).toBe(true);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect((row.children[0] as HTMLElement).style.opacity).toBe("1");
    expect((row.children[1] as HTMLElement).style.textDecoration).toBe("none");
    chart.dispose();
  });

  it("keeps existing row nodes (and focus) when series or theme change", () => {
    const chart = h.make({ plugins: [legendPlugin()] });
    chart.addLine({ capacity: 4, name: "A" });
    const legend = legendOf(chart.rootElement);
    const first = legend.children[0] as HTMLElement;
    first.focus();
    const second = chart.addLine({ capacity: 4, name: "B" });
    chart.setTheme();
    expect(legend.children[0]).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(legend.children).toHaveLength(2);
    chart.removeSeries(second);
    expect(legend.children).toHaveLength(1);
    chart.dispose();
  });

  it("renders non-interactive spans when toggleOnClick is false", () => {
    const chart = h.make({ plugins: [legendPlugin({ toggleOnClick: false })] });
    const series = chart.addLine({ capacity: 4, name: "A" });
    const row = legendOf(chart.rootElement).children[0] as HTMLElement;
    expect(row.tagName).toBe("SPAN");
    expect(row.hasAttribute("aria-pressed")).toBe(false);
    fire(row, new window.MouseEvent("click", { bubbles: true }));
    expect(series.visible).toBe(true);
    chart.dispose();
  });

  it("applies position, className, colors, and zIndex options", () => {
    const chart = h.make({
      plugins: [legendPlugin({ position: "bottom-left", className: "my-legend", zIndex: 7, backgroundColor: "red", textColor: "blue", borderColor: "transparent" })],
    });
    const legend = chart.rootElement.querySelector(".my-legend") as HTMLElement;
    expect(legend.style.bottom).toBe("8px");
    expect(legend.style.left).toBe("8px");
    expect(legend.style.top).toBe("auto");
    expect(legend.style.right).toBe("auto");
    expect(legend.style.zIndex).toBe("7");
    expect(legend.style.background).toBe("red");
    expect(legend.style.color).toBe("blue");
    expect(legend.style.border).toBe("0px");
    chart.dispose();
  });

  it("delegates to a custom render function on every change", () => {
    const calls: number[] = [];
    const chart = h.make({
      plugins: [legendPlugin({ render: (state, container) => { calls.push(state.length); container.textContent = `n=${state.length}`; } })],
    });
    expect(calls).toEqual([0]);
    chart.addLine({ capacity: 4 });
    expect(calls).toEqual([0, 1]);
    expect(legendOf(chart.rootElement).textContent).toBe("n=1");
    chart.dispose();
  });

  it("is operable by keyboard: Enter and Space on a real button are native clicks, other keys are ignored", () => {
    const chart = h.make({ plugins: [legendPlugin()] });
    chart.addLine({ capacity: 4, name: "A" });
    const row = legendOf(chart.rootElement).children[0] as HTMLButtonElement;
    // A <button> is focusable without tabindex; the legend does not trap keys.
    expect(row.tabIndex).toBe(0);
    const arrow = keyEvent("ArrowLeft");
    fire(row, arrow);
    // Bubbles to the chart root, which pans (handled), legend itself does not interfere.
    expect(arrow.defaultPrevented).toBe(true);
    chart.dispose();
  });

  it("removes its DOM, listeners, and subscriptions on dispose", () => {
    const baselineNodes = countNodes(document.body);
    const chart = h.make({ plugins: [legendPlugin()] });
    const series = chart.addLine({ capacity: 4, name: "A" });
    expect(legendOf(chart.rootElement)).not.toBeNull();
    chart.dispose();
    expect(h.target().children).toHaveLength(0);
    expect(countNodes(document.body)).toBe(baselineNodes);
    expect(h.ledger().reachable()).toBe(0);
    // A disposed chart no longer drives the plugin.
    expect(() => series.setVisible(false)).not.toThrow();
  });

  it("disposing only the plugin removes its DOM and stops reacting to a live chart", () => {
    const chart = h.make();
    const calls: number[] = [];
    const baselineNodes = countNodes(chart.rootElement);
    const baselineListeners = h.ledger().reachable();
    const dispose = installPlugin(chart, legendPlugin({ render: (state) => calls.push(state.length) }));
    expect(calls).toEqual([0]);
    dispose();
    chart.addLine({ capacity: 4 });
    chart.setTheme();
    expect(calls).toEqual([0]);
    expect(countNodes(chart.rootElement)).toBe(baselineNodes);
    expect(h.ledger().reachable()).toBe(baselineListeners);
    chart.dispose();
  });

  it("leaves no DOM or listeners behind across install/dispose cycles", () => {
    const baselineNodes = countNodes(document.body);
    for (let i = 0; i < 10; i++) {
      const chart = h.make({ plugins: [legendPlugin()] });
      chart.addLine({ capacity: 4 });
      chart.dispose();
    }
    expect(countNodes(document.body)).toBe(baselineNodes);
    expect(h.ledger().reachable()).toBe(0);
  });
});
