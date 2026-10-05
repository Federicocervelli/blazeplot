import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { evaluate, extractMetrics, formatReport, limitFor, median, parseThresholds, withBaselines, withUpdatedThresholds, type GateRunInput, type PerfThresholds } from "../../scripts/perf-gate-lib.ts";

const thresholds: PerfThresholds = {
  scenario: "perf-gate",
  repetitions: 3,
  retryRepetitions: 3,
  discardedRepetitions: 1,
  defaultHeadroom: 2,
  metrics: {
    frameP50Ratio: { baseline: 0.5 },
    drawCallsP95: { baseline: 10, headroom: 1.2 },
  },
};

function run(frameP50Ratio: number, drawCallsP95 = 10): Record<string, number> {
  return { frameP50Ratio, drawCallsP95 };
}

describe("perf gate", () => {
  it("computes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it("normalises time metrics by the calibration workload and keeps counts as-is", () => {
    const input: GateRunInput = {
      calibrationMs: 20,
      ingestMs: 400,
      chart: { frameMs: { p50: 5, p95: 10 }, pointsRendered: { p95: 1234 }, drawCalls: { p95: 7 }, uploadBytes: { p95: 99 } },
    };
    expect(extractMetrics(input)).toEqual({ frameP50Ratio: 0.25, frameP95Ratio: 0.5, ingestRatio: 20, drawCallsP95: 7, pointsRenderedP95: 1234, uploadBytesP95: 99 });
    expect(() => extractMetrics({ ...input, calibrationMs: 0 })).toThrow();
  });

  it("applies per-metric headroom over the default", () => {
    expect(limitFor({ baseline: 10 }, 2)).toBe(20);
    expect(limitFor({ baseline: 10, headroom: 1.2 }, 2)).toBe(12);
  });

  it("passes on noise and fails on a ~2x regression using the median across runs", () => {
    // One slow outlier among five runs must not fail the gate.
    const noisy = evaluate(thresholds, [run(0.5), run(0.55), run(0.48), run(3), run(0.52)]);
    expect(noisy.every((v) => v.pass)).toBe(true);
    // A consistent 2.5x slowdown must.
    const regressed = evaluate(thresholds, [run(1.3), run(1.25), run(1.4), run(1.2), run(1.35)]);
    expect(regressed.find((v) => v.name === "frameP50Ratio")?.pass).toBe(false);
    // Deterministic counts use their tighter headroom.
    const moreDraws = evaluate(thresholds, [run(0.5, 13), run(0.5, 13), run(0.5, 13)]);
    expect(moreDraws.find((v) => v.name === "drawCallsP95")?.pass).toBe(false);
  });

  it("rejects runs that lack a gated metric", () => {
    expect(() => evaluate(thresholds, [{ frameP50Ratio: 1 }])).toThrow("drawCallsP95");
    expect(() => evaluate(thresholds, [])).toThrow();
  });

  it("rewrites baselines with measured medians and keeps the rest of the file", () => {
    const next = withBaselines(thresholds, [run(0.4, 8), run(0.6, 9), run(0.5, 10)]);
    expect(next.metrics.frameP50Ratio?.baseline).toBe(0.5);
    expect(next.metrics.drawCallsP95?.baseline).toBe(9);
    expect(next.metrics.drawCallsP95?.headroom).toBe(1.2);
    expect(next.defaultHeadroom).toBe(2);
  });

  it("formats a report with failing rows flagged", () => {
    const report = formatReport(evaluate(thresholds, [run(2), run(2), run(2)]));
    expect(report).toContain("FAIL");
    expect(report).toContain("frameP50Ratio");
  });

  it("validates the committed thresholds file", () => {
    const parsed = parseThresholds(JSON.parse(readFileSync(new URL("../../benchmarks/thresholds.json", import.meta.url), "utf8")));
    expect(parsed.scenario).toBe("perf-gate");
    expect(Object.keys(parsed.metrics).length).toBeGreaterThan(0);
    expect(parsed.defaultHeadroom).toBeGreaterThan(1);
  });

  it("gives Canvas 2D its own metrics on top of the shared measurement settings", () => {
    const raw = JSON.parse(readFileSync(new URL("../../benchmarks/thresholds.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const webgl = parseThresholds(raw);
    const canvas = parseThresholds(raw, "canvas2d");
    expect(canvas.scenario).toBe(webgl.scenario);
    expect(canvas.repetitions).toBe(webgl.repetitions);
    // A CPU-drawn engine uploads nothing, so it has no upload metric.
    expect(webgl.metrics.uploadBytesP95).toBeDefined();
    expect(canvas.metrics.uploadBytesP95).toBeUndefined();
    expect(canvas.metrics.frameP50Ratio).toBeDefined();
    expect(() => parseThresholds({ ...raw, renderers: {} }, "canvas2d")).toThrow("renderers.canvas2d");
  });

  it("writes refreshed baselines back to the right section of the file", () => {
    const raw = JSON.parse(readFileSync(new URL("../../benchmarks/thresholds.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const canvas = parseThresholds(raw, "canvas2d");
    const next = withBaselines(canvas, [{ frameP50Ratio: 0.2, frameP95Ratio: 0.3, ingestRatio: 4, drawCallsP95: 4, pointsRenderedP95: 28000 }]);
    const updated = withUpdatedThresholds(raw, "canvas2d", next) as { metrics: Record<string, { baseline: number }>; renderers: { canvas2d: { metrics: Record<string, { baseline: number }> } } };
    expect(updated.renderers.canvas2d.metrics.frameP50Ratio?.baseline).toBe(0.2);
    // The WebGL2 section is untouched.
    expect(updated.metrics.frameP50Ratio?.baseline).toBe((raw.metrics as Record<string, { baseline: number }>).frameP50Ratio?.baseline);
    const webgl = parseThresholds(raw);
    const refreshed = withUpdatedThresholds(raw, "webgl2", withBaselines(webgl, [{ frameP50Ratio: 0.5, frameP95Ratio: 0.5, ingestRatio: 1, drawCallsP95: 4, pointsRenderedP95: 28000, uploadBytesP95: 1000 }])) as { metrics: Record<string, { baseline: number }>; renderers: unknown };
    expect(refreshed.metrics.frameP50Ratio?.baseline).toBe(0.5);
    expect(refreshed.renderers).toEqual(raw.renderers);
  });

  it("rejects malformed thresholds", () => {
    expect(() => parseThresholds(null)).toThrow();
    expect(() => parseThresholds({ scenario: "x", repetitions: 1, retryRepetitions: 0, discardedRepetitions: 0, defaultHeadroom: 1, metrics: {} })).toThrow("defaultHeadroom");
    expect(() => parseThresholds({ scenario: "x", repetitions: 1, retryRepetitions: 0, discardedRepetitions: 0, defaultHeadroom: 2, metrics: { a: { baseline: 0 } } })).toThrow("baseline");
  });
});
