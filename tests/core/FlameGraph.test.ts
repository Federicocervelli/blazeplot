import { describe, expect, it } from "bun:test";
import { buildFlameGraphModel, buildStatusChartModel, parseFoldedStacks, pickFrame } from "../../src/plugins/flamegraph.ts";

describe("FlameGraph model helpers", () => {
  it("parses folded stacks and builds merged flame graph frames", () => {
    const folded = parseFoldedStacks("root;a 3\nroot;b 2\nroot;a;c 1\n");
    expect(folded).toEqual([
      { stack: ["root", "a"], value: 3, delta: undefined },
      { stack: ["root", "b"], value: 2, delta: undefined },
      { stack: ["root", "a", "c"], value: 1, delta: undefined },
    ]);

    const model = buildFlameGraphModel(folded, { includeRoot: false });
    const root = model.frames.find((frame) => frame.name === "root");
    const a = model.frames.find((frame) => frame.name === "a");
    const b = model.frames.find((frame) => frame.name === "b");
    const c = model.frames.find((frame) => frame.name === "c");

    expect(model.total).toBe(6);
    expect(model.maxDepth).toBe(2);
    expect(root).toMatchObject({ start: 0, value: 6, end: 6, depth: 0 });
    expect(a).toMatchObject({ start: 0, value: 4, end: 4, depth: 1 });
    expect(b).toMatchObject({ start: 4, value: 2, end: 6, depth: 1 });
    expect(c).toMatchObject({ start: 0, value: 1, end: 1, depth: 2 });
  });

  it("supports unmerged flame chart order", () => {
    const model = buildFlameGraphModel([
      { stack: ["a", "leaf"], value: 2 },
      { stack: ["a", "leaf"], value: 3 },
    ], { flameChart: true });

    expect(model.total).toBe(5);
    expect(model.frames.filter((frame) => frame.name === "a").map((frame) => [frame.start, frame.end])).toEqual([[0, 2], [2, 5]]);
    expect(model.frames.filter((frame) => frame.name === "leaf").map((frame) => [frame.start, frame.end])).toEqual([[0, 2], [2, 5]]);
  });

  it("builds status-span interval models and hit-tests by row", () => {
    const model = buildStatusChartModel([
      { name: "idle", start: 0, end: 5, depth: 0 },
      { name: "busy", start: 3, end: 8, depth: 1 },
      { name: "ignored", start: 4, end: 4, depth: 2 },
    ]);

    expect(model.minX).toBe(0);
    expect(model.maxX).toBe(8);
    expect(model.frames).toHaveLength(2);
    expect(pickFrame(model, 4, 0)?.name).toBe("idle");
    expect(pickFrame(model, 4, 1)?.name).toBe("busy");
    expect(pickFrame(model, 7, 0)).toBeNull();
  });
});
