import { describe, expect, it } from "bun:test";
import { createLinkedCharts } from "../../src/linked.ts";
import type { LinkedChartsOptions, LinkedChartsHandle } from "../../src/linked.ts";
import type { ChartOptions } from "../../src/ui/Chart.ts";
import type { ChartPlugin } from "../../src/ui/PluginTypes.ts";
import type { SelectionState } from "../../src/plugins/selection/Selection.ts";
import { countNodes, RecordingRenderer, recordingRenderer } from "./fakes.ts";
import { pluginContext, useChartHarness } from "./harness.ts";

const h = useChartHarness();

interface Built {
  readonly linked: LinkedChartsHandle;
  readonly backends: RecordingRenderer[];
}

function build(count: number, options: Partial<LinkedChartsOptions> = {}, panelOptions: ChartOptions = {}): Built {
  const backends: RecordingRenderer[] = [];
  const linked = createLinkedCharts(h.target(), {
    panels: Array.from({ length: count }, () => ({
      options: {
        ...panelOptions,
        renderer: recordingRenderer(backends),
      },
    })),
    ...options,
  });
  return { linked, backends };
}

const selection: SelectionState = {
  mode: "xy",
  yAxis: "left",
  bounds: { xMin: 1, xMax: 2, yMin: 3, yMax: 4 },
  plotBounds: { left: 0, top: 0, width: 10, height: 10 },
};

describe("createLinkedCharts layout", () => {
  it("builds a grid root with one cell and chart per panel, stacked in rows by default", () => {
    const { linked } = build(3);
    expect(h.target().children).toHaveLength(1);
    expect(h.target().firstElementChild).toBe(linked.root);
    expect(linked.root.className).toBe("blazeplot-linked-charts");
    expect(linked.root.style.display).toBe("grid");
    expect(linked.root.style.gridTemplateRows).toBe("repeat(3, minmax(0, 1fr))");
    expect(linked.root.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
    expect(linked.root.style.gap).toBe("8px");
    expect(linked.root.children).toHaveLength(3);
    expect(linked.charts).toHaveLength(3);
    for (const [index, chart] of linked.charts.entries()) {
      const cell = linked.root.children[index] as HTMLElement;
      expect(cell.className).toBe("blazeplot-linked-panel");
      expect(cell.contains(chart.rootElement)).toBe(true);
    }
    linked.dispose();
  });

  it("honors rows, columns, spacing, and class names, and clamps nonsense values", () => {
    const { linked } = build(4, { rows: 2, spacing: 12, className: "grid" });
    expect(linked.root.className).toBe("grid");
    expect(linked.root.style.gridTemplateRows).toBe("repeat(2, minmax(0, 1fr))");
    expect(linked.root.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(linked.root.style.gap).toBe("12px");
    linked.dispose();

    const css = build(2, { rows: 1, columns: 2, spacing: "1rem" });
    expect(css.linked.root.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(css.linked.root.style.gap).toBe("1rem");
    css.linked.dispose();

    const odd = build(2, { rows: 0.2, columns: -3 });
    expect(odd.linked.root.style.gridTemplateRows).toBe("repeat(1, minmax(0, 1fr))");
    expect(odd.linked.root.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
    odd.linked.dispose();

    const named = createLinkedCharts(h.target(), {
      panels: [{ className: "custom-cell", options: { renderer: recordingRenderer() } }],
    });
    expect(named.root.querySelector(".custom-cell")).not.toBeNull();
    named.dispose();
  });
});

describe("createLinkedCharts X sync", () => {
  it("mirrors X viewport changes to every other panel and leaves Y alone", () => {
    const { linked } = build(3);
    const [a, b, c] = linked.charts as [typeof linked.charts[0], typeof linked.charts[0], typeof linked.charts[0]];
    b.setViewport({ yMin: 5, yMax: 6 });
    a.setViewport({ xMin: 10, xMax: 20 });
    for (const chart of [b, c]) expect(chart.getViewport()).toMatchObject({ xMin: 10, xMax: 20 });
    expect(b.getViewport()).toMatchObject({ yMin: 5, yMax: 6 });
    expect(c.getViewport().yMin).not.toBe(5);
    c.pan({ dx: 0.1, dy: 0 });
    expect(a.getViewport().xMin).toBeCloseTo(c.getViewport().xMin, 8);
    expect(b.getViewport().xMax).toBeCloseTo(c.getViewport().xMax, 8);
    linked.dispose();
  });

  it("does not re-enter its own sync listeners", () => {
    const { linked } = build(2);
    const [a, b] = linked.charts as [typeof linked.charts[0], typeof linked.charts[0]];
    let aEvents = 0;
    let bEvents = 0;
    a.subscribe("viewportchange", () => aEvents++);
    b.subscribe("viewportchange", () => bEvents++);
    a.setViewport({ xMin: 1, xMax: 2 });
    expect(aEvents).toBe(1);
    expect(bEvents).toBe(1);
    linked.dispose();
  });

  it("setXRange applies one range to all panels, once per panel", () => {
    const { linked } = build(3);
    const counts = linked.charts.map(() => 0);
    linked.charts.forEach((chart, i) => chart.subscribe("viewportchange", () => counts[i]!++));
    linked.setXRange(100, 200);
    for (const chart of linked.charts) expect(chart.getViewport()).toMatchObject({ xMin: 100, xMax: 200 });
    expect(counts).toEqual([1, 1, 1]);
    linked.dispose();
  });

  it("does not link panels when syncX is false", () => {
    const { linked } = build(2, { syncX: false });
    const [a, b] = linked.charts as [typeof linked.charts[0], typeof linked.charts[0]];
    a.setViewport({ xMin: 10, xMax: 20 });
    expect(b.getViewport()).not.toMatchObject({ xMin: 10, xMax: 20 });
    // The imperative setter still reaches every panel.
    linked.setXRange(5, 6);
    expect(b.getViewport()).toMatchObject({ xMin: 5, xMax: 6 });
    linked.dispose();
  });
});

describe("createLinkedCharts selection sync", () => {
  it("re-emits select events on the other panels only, and not at all by default", () => {
    const { linked } = build(3, { syncSelections: true });
    const seen: Array<Array<SelectionState | null>> = linked.charts.map(() => []);
    linked.charts.forEach((chart, i) => chart.subscribe("select", (e) => seen[i]!.push(e.selection as SelectionState | null)));
    pluginContext(linked.charts[0]!).events.emit("select", { selection });
    expect(seen).toEqual([[selection], [selection], [selection]]);
    pluginContext(linked.charts[1]!).events.emit("select", { selection: null });
    expect(seen.map((list) => list.length)).toEqual([2, 2, 2]);
    expect(seen[0]!.at(-1)).toBeNull();
    linked.dispose();

    const off = build(2);
    const received: unknown[] = [];
    off.linked.charts[1]!.subscribe("select", (e) => received.push(e.selection));
    pluginContext(off.linked.charts[0]!).events.emit("select", { selection });
    expect(received).toEqual([]);
    off.linked.dispose();
  });
});

describe("createLinkedCharts panelPlugins", () => {
  it("creates plugins per panel with one shared syncGroup per layout, after the panel's own plugins", () => {
    const groups: string[] = [];
    const order: string[] = [];
    const own = (id: string): ChartPlugin => ({ install: () => { order.push(id); } });
    const { linked } = build(2, {
      panelPlugins: (group) => {
        groups.push(group);
        return [own("shared")];
      },
    }, { plugins: [own("own")] });
    expect(groups).toHaveLength(2);
    expect(groups[0]).toBe(groups[1]!);
    expect(groups[0]).toMatch(/^blazeplot-linked-/);
    expect(order).toEqual(["own", "shared", "own", "shared"]);

    const other = build(1, { panelPlugins: (group) => { groups.push(group); return []; } });
    expect(groups[2]).not.toBe(groups[0]!);
    other.linked.dispose();
    linked.dispose();
  });

  it("disposes the plugins with the panels", () => {
    const disposed: string[] = [];
    const { linked } = build(2, { panelPlugins: () => [{ install: () => () => { disposed.push("x"); } }] });
    linked.dispose();
    expect(disposed).toEqual(["x", "x"]);
  });
});

describe("createLinkedCharts lifecycle", () => {
  it("removes every panel, listener, and GPU resource on dispose, and is idempotent", () => {
    const nodes = countNodes(document.body);
    const { linked, backends } = build(3, { syncSelections: true });
    expect(backends).toHaveLength(3);
    linked.dispose();
    expect(h.target().children).toHaveLength(0);
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(0);
    for (const backend of backends) expect(backend.disposeCount).toBe(1);
    expect(linked.charts).toHaveLength(0);
    expect(() => linked.dispose()).not.toThrow();
    expect(() => linked.setXRange(0, 1)).not.toThrow();
  });

  it("stops syncing after dispose", () => {
    const { linked } = build(2);
    const [a, b] = [...linked.charts];
    linked.dispose();
    const before = b!.getViewport();
    a!.setViewport({ xMin: 50, xMax: 60 });
    expect(b!.getViewport()).toEqual(before);
  });

  it("releases already-built panels and the root when a later panel fails to construct", () => {
    const backends: RecordingRenderer[] = [];
    let calls = 0;
    const nodes = countNodes(document.body);
    expect(() =>
      createLinkedCharts(h.target(), {
        panels: Array.from({ length: 3 }, () => ({
          options: {
            renderer: (ctx) => {
              if (++calls === 3) throw new Error("no WebGL2");
              return recordingRenderer(backends)(ctx);
            },
          },
        })),
      }),
    ).toThrow("no WebGL2");
    expect(backends).toHaveLength(2);
    for (const backend of backends) expect(backend.disposeCount).toBe(1);
    expect(h.target().children).toHaveLength(0);
    expect(countNodes(document.body)).toBe(nodes);
    expect(h.ledger().reachable()).toBe(0);
  });
});
