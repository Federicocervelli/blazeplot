import { describe, expect, it } from "bun:test";
import { resolveChartTheme } from "../../src/ui/theme.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

const TITLE_SELECTORS = [".blazeplot-title", ".blazeplot-subtitle", ".blazeplot-axis-title"];

function titleElements(root: HTMLElement): HTMLElement[] {
  return TITLE_SELECTORS.flatMap((selector) => [...root.querySelectorAll<HTMLElement>(selector)]);
}

describe("chart layout DOM", () => {
  it("creates no title elements for a chart without titles", () => {
    const chart = h.make({ axes: { x: true, y: true } });
    expect(titleElements(chart.rootElement)).toHaveLength(0);
    // Only the axis gutters, the plot, and the always-present accessibility nodes remain.
    expect(chart.rootElement.querySelectorAll(".blazeplot-axis-corner")).toHaveLength(0);
    chart.dispose();
  });

  it("creates only the title elements that have text, with their own placement", () => {
    const chart = h.make({ title: "Latency", axes: { x: { title: "Time" }, y: true } });
    const root = chart.rootElement;
    const title = root.querySelector<HTMLElement>(".blazeplot-title")!;
    expect(title.textContent).toBe("Latency");
    expect(title.style.display).toBe("block");
    expect(title.style.zIndex).toBe("18");
    expect(root.querySelector(".blazeplot-subtitle")).toBeNull();
    expect(root.querySelector(".blazeplot-axis-title-y")).toBeNull();
    const xTitle = root.querySelector<HTMLElement>(".blazeplot-axis-title-x")!;
    expect(xTitle.textContent).toBe("Time");
    expect(xTitle.style.transform).toBe("translateX(-50%)");
    chart.dispose();
  });

  it("hides a title that is removed and keeps its element for reuse", () => {
    const chart = h.make({ axes: { x: { title: "Time" }, y: { title: "Value" } } });
    const root = chart.rootElement;
    const yTitle = root.querySelector<HTMLElement>(".blazeplot-axis-title-y")!;
    expect(yTitle.style.display).toBe("block");
    chart.setAxes({ x: { title: "Time" }, y: true });
    expect(yTitle.style.display).toBe("none");
    expect(yTitle.textContent).toBe("");
    chart.setAxes({ x: { title: "Time" }, y: { title: "Again" } });
    expect(root.querySelectorAll(".blazeplot-axis-title-y")).toHaveLength(1);
    expect(yTitle.textContent).toBe("Again");
    expect(yTitle.style.display).toBe("block");
    chart.dispose();
  });

  it("does not rewrite the grid template when an update changes nothing", () => {
    const chart = h.make({ axes: { x: { position: "outside" }, y: { position: "outside" } } });
    const observer = new MutationObserver(() => {});
    observer.observe(chart.rootElement, { attributes: true, attributeFilter: ["style"] });
    chart.setAxes({ x: { position: "outside" }, y: { position: "outside" } });
    // Rebuilding the axes re-applies the same layout: the root's own style must not change.
    expect(observer.takeRecords().filter((record) => record.target === chart.rootElement)).toHaveLength(0);
    observer.disconnect();
    chart.dispose();
  });
});

describe("theme color resolution", () => {
  it("resolves opaque hex colors without a probe element or a computed-style read", () => {
    const original = window.getComputedStyle;
    let reads = 0;
    window.getComputedStyle = ((...args: Parameters<typeof original>) => {
      reads++;
      return original.apply(window, args);
    }) as typeof original;
    try {
      const theme = resolveChartTheme({ backgroundColor: "#0f172a", gridColor: "#fff", seriesColors: ["#ff0000", "#00f"] }, document.body);
      expect(theme.backgroundColor[0]).toBeCloseTo(15 / 255);
      expect(theme.backgroundColor[3]).toBe(1);
      expect(theme.gridColor).toEqual([1, 1, 1, 1]);
      expect(theme.seriesColors).toEqual([[1, 0, 0, 1], [0, 0, 1, 1]]);
      expect(reads).toBe(0);
    } finally {
      window.getComputedStyle = original;
    }
  });
});
