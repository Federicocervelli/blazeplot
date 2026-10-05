import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Chart } from "../../src/ui/Chart.ts";
import { createLinkedCharts } from "../../src/linked/LinkedCharts.ts";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

let warn: ReturnType<typeof spyOn<Console, "warn">>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const warnings = (): string[] => warn.mock.calls.map((call) => String(call[0]));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("constructor target validation", () => {
  it("throws an actionable TypeError for null, undefined, and non-elements", () => {
    expect(() => new Chart(null as unknown as HTMLElement)).toThrow(new TypeError("Chart: target must be an HTMLElement (got null). Is the element mounted?"));
    expect(() => new Chart(undefined as unknown as HTMLElement)).toThrow(/got undefined/);
    expect(() => new Chart({} as unknown as HTMLElement)).toThrow(/got object/);
    expect(() => new Chart("#chart" as unknown as HTMLElement)).toThrow(/pass the element, not a selector/);
    expect(() => new Chart(42 as unknown as HTMLElement)).toThrow(/got number/);
    expect(() => new Chart(document as unknown as HTMLElement)).toThrow(TypeError);
  });

  it("applies to createLinkedCharts", () => {
    expect(() => createLinkedCharts(null as unknown as HTMLElement, { panels: [{}] })).toThrow(
      new TypeError("createLinkedCharts: target must be an HTMLElement (got null). Is the element mounted?"),
    );
  });
});

describe("development warnings", () => {
  it("warns once when the first render finds a zero-size plot", () => {
    const chart = h.make({}, { width: 400, height: 0 });
    chart.addLine({ capacity: 4 });
    chart.start();
    h.raf.flush();
    chart.requestRender();
    h.raf.flush();
    const found = warnings().filter((message) => message.includes("plot area"));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("zero height");
    expect(found[0]).toMatch(/^BlazePlot: /);
    chart.dispose();
  });

  it("names the width when only the width is zero, and stays quiet for a sized plot", () => {
    const narrow = h.make({}, { width: 0, height: 200 });
    narrow.start();
    h.raf.flush();
    expect(warnings().some((message) => message.includes("zero width"))).toBe(true);
    narrow.dispose();

    warn.mockClear();
    const sized = h.make();
    sized.start();
    h.raf.flush();
    expect(warnings().filter((message) => message.includes("plot area"))).toHaveLength(0);
    sized.dispose();
  });

  it("warns once when a series was added but the chart was never started", async () => {
    const chart = h.make();
    chart.addLine({ capacity: 4 });
    chart.addLine({ capacity: 4 });
    await sleep(1_100);
    const found = warnings().filter((message) => message.includes("was never called"));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("chart.start()");
    chart.dispose();
  });

  it("does not warn when the chart is started, or disposed first", async () => {
    const started = h.make();
    started.addLine({ capacity: 4 });
    started.start();
    const disposed = h.make();
    disposed.addLine({ capacity: 4 });
    disposed.dispose();
    await sleep(1_100);
    expect(warnings().filter((message) => message.includes("was never called"))).toHaveLength(0);
    started.dispose();
  });
});

describe("context events", () => {
  it("emits contextlost and contextrestored from the engine state", () => {
    const chart = h.make();
    const log: string[] = [];
    chart.subscribe("contextlost", () => log.push("lost"));
    chart.subscribe("contextrestored", () => log.push("restored"));
    const engine = h.backends()[0];
    if (!engine) {
      // Real engines: the chart owns the same handler, covered by the Chart.lifecycle tests.
      chart.dispose();
      return;
    }
    engine.lose();
    engine.restore();
    expect(log).toEqual(["lost", "restored"]);
    chart.dispose();
  });
});

describe("root focus", () => {
  it("is a tab stop by default, and not when there is neither a summary nor a plugin", () => {
    const summary = h.make();
    expect(summary.rootElement.tabIndex).toBe(0);
    summary.dispose();

    const bare = h.make({ accessibility: { description: "" } });
    expect(bare.rootElement.getAttribute("tabindex")).toBeNull();
    expect(bare.rootElement.getAttribute("role")).toBe("figure");
    bare.dispose();

    const withPlugin = h.make({ accessibility: { description: "" }, plugins: [interactionsPlugin()] });
    expect(withPlugin.rootElement.tabIndex).toBe(0);
    withPlugin.dispose();
  });
});
