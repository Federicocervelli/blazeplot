import { describe, expect, it } from "bun:test";
import { legendPlugin } from "../../src/plugins/legend.ts";
import { GUTTER_SHRINK_AFTER_FRAMES, GutterTracker } from "../../src/ui/AxisOverlay.ts";
import { stubBox, useChartHarness } from "./harness.ts";

const h = useChartHarness();

describe("axis gutters", () => {
  it("keeps the default gutters and honors a fixed size", () => {
    const chart = h.make({ axes: { x: { position: "outside" }, y: { position: "outside" } } });
    expect(chart.rootElement.style.gridTemplateColumns).toBe("52px minmax(0, 1fr) 0px");
    expect(chart.rootElement.style.gridTemplateRows).toBe("0px minmax(0, 1fr) 28px");
    chart.dispose();

    const fixed = h.make({ axes: { x: { size: 40 }, y: { size: 96, title: "Latency" } } });
    // The title allowance (24px) is added to the label gutter.
    expect(fixed.rootElement.style.gridTemplateColumns).toBe("120px minmax(0, 1fr) 0px");
    expect(fixed.rootElement.style.gridTemplateRows).toBe("0px minmax(0, 1fr) 40px");
    fixed.dispose();
  });

  it("gives the title and subtitle their own row above the plot", () => {
    const chart = h.make({ title: "Latency", subtitle: "p99", axes: { x: true, y: true } });
    expect(chart.rootElement.style.gridTemplateRows).toBe("46px minmax(0, 1fr) 28px");
    const titleOnly = h.make({ title: "Latency", axes: { x: true, y: true } });
    expect(titleOnly.rootElement.style.gridTemplateRows).toBe("26px minmax(0, 1fr) 28px");
    chart.dispose();
    titleOnly.dispose();
  });

  it("sizes auto gutters from measured labels", () => {
    const chart = h.make({ axes: { x: true, y: { size: "auto" } } });
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 9 });
    chart.start();
    h.raf.flush();
    const columns = chart.rootElement.style.gridTemplateColumns;
    expect(columns).not.toBe("52px minmax(0, 1fr) 0px");
    expect(columns).toMatch(/^\d+px minmax\(0, 1fr\) 0px$/);
    chart.dispose();
  });

  it("grows the auto gutter at once and shrinks only after it holds", () => {
    const tracker = new GutterTracker();
    expect(tracker.next(60)).toBe(60);
    expect(tracker.next(80)).toBe(80);
    // A shorter label for a few frames must not change the gutter.
    for (let i = 0; i < GUTTER_SHRINK_AFTER_FRAMES - 1; i++) expect(tracker.next(40)).toBeNull();
    expect(tracker.next(40)).toBe(40);
    // Alternating label lengths never shrink.
    const jitter = new GutterTracker();
    jitter.next(80);
    for (let i = 0; i < 500; i++) expect(jitter.next(i % 2 === 0 ? 60 : 80)).toBeNull();
  });

  it("reserves space for an outside legend so the plot shrinks", () => {
    const chart = h.make({ plugins: [legendPlugin({ position: "bottom" })] });
    const legend = chart.rootElement.querySelector(".blazeplot-legend") as HTMLElement;
    expect(legend.style.bottom).toBe("8px");
    expect(chart.rootElement.style.padding).toBe("");
    stubBox(legend, { width: 200, height: 24 });
    chart.addLine({ capacity: 4, name: "CPU" });
    expect(chart.rootElement.style.padding).toBe("0px 0px 40px");
    chart.dispose();
  });
});
