import { describe, expect, it } from "bun:test";
import { measureText } from "../../src/ui/TextMeasure.ts";
import { stubPlot, useChartHarness } from "./harness.ts";

const h = useChartHarness();

/** A document whose 2D context counts `measureText` calls; widths are 6px per character. */
function countingDocument(): { doc: Document; calls: () => number; fonts: string[] } {
  let calls = 0;
  const fonts: string[] = [];
  const context = {
    font: "",
    measureText: (text: string) => {
      calls++;
      fonts.push(context.font);
      return { width: text.length * 6 + 0.4, actualBoundingBoxAscent: 8.2, actualBoundingBoxDescent: 1 };
    },
  };
  const doc = { createElement: () => ({ getContext: () => context }) } as unknown as Document;
  return { doc, calls: () => calls, fonts };
}

describe("measureText", () => {
  it("measures each (font, text) pair once and rounds up to whole pixels", () => {
    const { doc, calls } = countingDocument();
    expect(measureText(doc, "12px a", "100")).toEqual({ width: 19, height: 10 });
    expect(measureText(doc, "12px a", "100")).toEqual({ width: 19, height: 10 });
    expect(calls()).toBe(1);
    measureText(doc, "12px a", "200");
    measureText(doc, "14px a", "100");
    expect(calls()).toBe(3);
  });

  it("shares one context per document and falls back when there is no 2D canvas", () => {
    const { doc, calls } = countingDocument();
    measureText(doc, "f", "a");
    measureText(doc, "f", "b");
    expect(calls()).toBe(2);
    const bare = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
    expect(measureText(bare, "f", "a")).toEqual({ width: 12, height: 12 });
  });

  it("uses the fallback size for a dimension the context cannot report", () => {
    const context = { font: "", measureText: () => ({ width: 30 }) };
    const doc = { createElement: () => ({ getContext: () => context }) } as unknown as Document;
    expect(measureText(doc, "f", "abc")).toEqual({ width: 30, height: 12 });
  });

  it("forgets remembered extents when a web font finishes loading", () => {
    const { doc, calls } = countingDocument();
    let loaded: () => void = () => {};
    (doc as unknown as { fonts: unknown }).fonts = { addEventListener: (_: string, listener: () => void) => void (loaded = listener) };
    measureText(doc, "f", "a");
    measureText(doc, "f", "a");
    expect(calls()).toBe(1);
    loaded();
    measureText(doc, "f", "a");
    expect(calls()).toBe(2);
  });
});

describe("axis overlay", () => {
  function tickLabels(chart: { rootElement: HTMLElement }, axis: "x" | "y"): HTMLElement[] {
    return [...chart.rootElement.querySelectorAll<HTMLElement>(`.blazeplot-axis-${axis} > div`)];
  }

  it("positions visible labels and hides ticks that collide or fall outside the plot", () => {
    const chart = h.make({ axes: { x: { position: "outside" }, y: { position: "outside" } } });
    stubPlot(chart, { width: 400, height: 200 });
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 9 });
    chart.start();
    h.raf.flush();
    const xs = tickLabels(chart, "x");
    expect(xs.length).toBeGreaterThan(0);
    const shown = xs.filter((el) => el.style.display !== "none");
    expect(shown.length).toBeGreaterThan(1);
    for (const el of shown) expect(parseFloat(el.style.left)).toBeGreaterThanOrEqual(0);
    expect(shown[0]!.style.top).toBe("4px");
    const ys = tickLabels(chart, "y").filter((el) => el.style.display !== "none");
    expect(ys.length).toBeGreaterThan(1);
    expect(ys[0]!.style.right).toBe("4px");
    chart.dispose();
  });

  it("writes nothing to the DOM when a frame changes no tick", () => {
    const chart = h.make({ axes: { x: { position: "outside" }, y: { position: "outside" } } });
    stubPlot(chart, { width: 400, height: 200 });
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 9 });
    chart.start();
    h.raf.flush();

    const observer = new MutationObserver(() => {});
    // The axis containers hold the labels; engines may legitimately touch the canvas every frame.
    for (const axis of chart.rootElement.querySelectorAll(".blazeplot-axis")) {
      observer.observe(axis, { subtree: true, attributes: true, characterData: true, childList: true });
    }
    chart.requestRender();
    h.raf.flush();
    expect(observer.takeRecords()).toHaveLength(0);

    chart.setViewport({ xMin: 1, xMax: 11 });
    h.raf.flush();
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    observer.disconnect();
    chart.dispose();
  });
});
