import { describe, expect, test } from "bun:test";
import { buildImportGraph, findCycles, findLayerViolations } from "../../scripts/import-graph.ts";
import type { ImportGraph } from "../../scripts/import-graph.ts";

describe("findCycles", () => {
  test("reports nothing for a DAG and the members of each cycle otherwise", () => {
    const dag: ImportGraph = new Map([["a", ["b"]], ["b", ["c"]], ["c", []]]);
    expect(findCycles(dag)).toEqual([]);
    const cyclic: ImportGraph = new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]], ["d", ["d"]], ["e", []]]);
    expect(findCycles(cyclic)).toEqual([["a", "b", "c"], ["d"]]);
  });
});

describe("src import graph", () => {
  const graph = buildImportGraph();

  test("has no import cycles, type-only imports included", () => {
    expect(findCycles(graph)).toEqual([]);
  });

  test("respects the layering rules", () => {
    expect(findLayerViolations(graph)).toEqual([]);
  });
});

describe("findLayerViolations", () => {
  test("flags a plugin importing Chart, Chart importing a plugin, and core importing ui", () => {
    const graph: ImportGraph = new Map([
      ["src/plugins/legend/Legend.ts", ["src/ui/Chart.ts", "src/ui/PluginTypes.ts", "src/plugins/common/OverlayUtils.ts"]],
      ["src/ui/Chart.ts", ["src/plugins/legend/Legend.ts"]],
      ["src/core/SeriesStore.ts", ["src/ui/theme.ts"]],
    ]);
    const violations = findLayerViolations(graph);
    expect(violations).toHaveLength(3);
    expect(violations.some((v) => v.startsWith("src/plugins/legend/Legend.ts -> src/ui/Chart.ts"))).toBe(true);
    expect(violations.some((v) => v.startsWith("src/ui/Chart.ts -> src/plugins/legend/Legend.ts"))).toBe(true);
    expect(violations.some((v) => v.startsWith("src/core/SeriesStore.ts -> src/ui/theme.ts"))).toBe(true);
  });
});
