import { describe, expect, test } from "bun:test";
import officialConfig from "../../scripts/benchmark-config.json";
import {
  aggregateValues,
  collectNonWins,
  compareMetric,
  countComparisons,
  metricWinner,
  renderReportMarkdown,
  renderSummaryMarkdown,
  type AggregatedMetric,
  type CompareReport,
  type LibraryResult,
  type MetricDefinition,
} from "../../scripts/benchmark-compare-report.js";

const lowerBetter: MetricDefinition = { label: "Ready", short: "Ready", unit: "ms", direction: "min" };
const higherBetter: MetricDefinition = { label: "FPS", short: "FPS", unit: "fps", direction: "max" };

function metric(...values: number[]): AggregatedMetric {
  return aggregateValues(values);
}

function result(library: string, metrics: Record<string, AggregatedMetric>): LibraryResult {
  return { library, ok: true, runsRequested: 5, runsSucceeded: 5, runsFailed: 0, errors: [], metrics, details: {} };
}

function report(readyBlaze: number[], readyUplot: number[], fpsBlaze: number[], fpsUplot: number[]): CompareReport {
  return {
    schemaVersion: 2,
    generatedAt: "2026-01-01T00:00:00.000Z",
    command: "bun run bench:compare",
    publishable: true,
    warnings: [],
    noiseFloor: 0.05,
    metrics: { readyMs: lowerBetter, rafFps: higherBetter },
    options: { scenarios: ["a", "b"], libraries: ["blazeplot", "uplot", "chartjs"], width: 1280, height: 720, runs: 5, setupWarmupRuns: 1, headed: true },
    environment: {
      machine: { label: "test", platform: "win32", release: "10", arch: "x64", cpuModel: "cpu", cpuCount: 8, totalMemoryBytes: 1 << 30 },
      browser: { product: "Chrome/1" },
      executable: "chrome.exe",
      page: { userAgent: "ua", devicePixelRatio: 1, webglRenderer: "ANGLE (AMD, Radeon)", headlessUserAgent: false },
    },
    libraries: { blazeplot: { name: "BlazePlot", version: "1" }, uplot: { name: "uPlot", version: "1" }, chartjs: { name: "Chart.js", version: "1" } },
    scenarios: [
      {
        name: "a",
        title: "Static",
        group: "Setup",
        primary: "readyMs",
        metricIds: ["readyMs"],
        results: [result("blazeplot", { readyMs: metric(...readyBlaze) }), result("uplot", { readyMs: metric(...readyUplot) }), result("chartjs", { readyMs: metric(20, 21, 22, 20, 21) })],
      },
      {
        name: "b",
        title: "Pan",
        group: "Line",
        primary: "rafFps",
        metricIds: ["rafFps"],
        results: [result("blazeplot", { rafFps: metric(...fpsBlaze) }), result("uplot", { rafFps: metric(...fpsUplot) }), result("chartjs", { rafFps: metric(100, 101, 99, 100, 100) })],
      },
    ],
  };
}

describe("benchmark report aggregation", () => {
  test("aggregates median, p95, range and spread over runs", () => {
    const aggregated = aggregateValues([10, 12, 11, 30, 11]);
    expect(aggregated.median).toBe(11);
    expect(aggregated.min).toBe(10);
    expect(aggregated.max).toBe(30);
    expect(aggregated.p95).toBe(30);
    expect(aggregated.n).toBe(5);
    expect(aggregated.spreadPct).toBeCloseTo(((30 - 10) / 2 / 11) * 100, 0);
  });

  test("median of an even number of runs averages the middle pair", () => {
    expect(aggregateValues([1, 2, 3, 4]).median).toBe(2.5);
  });

  test("an empty run list aggregates to zeros", () => {
    expect(aggregateValues([]).n).toBe(0);
  });
});

describe("benchmark verdicts", () => {
  test("a clear lower-is-better win has advantage above one", () => {
    const comparison = compareMetric(metric(2, 2.1, 2.05, 2, 2.1), metric(4, 4.1, 4.2, 4, 4.1), lowerBetter);
    expect(comparison.verdict).toBe("win");
    expect(comparison.advantage).toBeGreaterThan(1.9);
  });

  test("a clear higher-is-better loss has advantage below one", () => {
    const comparison = compareMetric(metric(500, 510, 505, 500, 502), metric(1000, 1010, 990, 1000, 1000), higherBetter);
    expect(comparison.verdict).toBe("loss");
    expect(comparison.advantage).toBeLessThan(0.55);
  });

  test("medians inside the noise floor tie", () => {
    const comparison = compareMetric(metric(100, 101, 100, 99, 100), metric(102, 103, 102, 101, 102), higherBetter);
    expect(comparison.verdict).toBe("tie");
  });

  test("overlapping run ranges tie even when medians differ by more than the floor", () => {
    const comparison = compareMetric(metric(3, 6, 3.2, 3.1, 3.3), metric(4, 4.2, 4.1, 3.9, 4.0), lowerBetter);
    expect(comparison.verdict).toBe("tie");
    expect(comparison.lean).toBe("subject");
  });

  test("the absolute noise floor keeps sub-0.05 ms differences from counting as losses", () => {
    const comparison = compareMetric(metric(0.02, 0.02, 0.02), metric(0.01, 0.01, 0.01), lowerBetter);
    expect(comparison.verdict).toBe("tie");
  });
});

describe("benchmark report rendering", () => {
  const winning = report([2, 2.1, 2, 2.05, 2], [4, 4.1, 4.2, 4, 4.1], [2000, 2010, 1990, 2000, 2005], [1000, 1010, 990, 1000, 1000]);
  const losing = report([8, 8.5, 8.2, 8, 8.1], [3, 3.1, 3.2, 3, 3.1], [2000, 2010, 1990, 2000, 2005], [1000, 1010, 990, 1000, 1000]);

  test("picks the winner among the contender libraries", () => {
    expect(metricWinner(winning, winning.scenarios[0]!, "readyMs").winner).toBe("blazeplot");
    expect(metricWinner(losing, losing.scenarios[0]!, "readyMs").winner).toBe("uplot");
  });

  test("lists every metric where BlazePlot does not clearly win", () => {
    expect(collectNonWins(winning)).toHaveLength(0);
    const nonWins = collectNonWins(losing);
    expect(nonWins.map((entry) => `${entry.scenario.name}/${entry.metricId}/${entry.referenceId}/${entry.verdict}`)).toEqual(["a/readyMs/uplot/loss"]);
    expect(countComparisons(losing)).toBe(4);
  });

  test("markdown shows the scoreboard, the non-win section and the methodology", () => {
    const markdown = renderReportMarkdown(losing);
    expect(markdown).toContain("## Scoreboard");
    expect(markdown).toContain("## Where BlazePlot does not win");
    expect(markdown).toContain("| a | Ready (ms) |");
    expect(markdown).toContain("LOSS");
    expect(markdown).toContain("## Methodology");
    expect(renderReportMarkdown(winning)).toContain("clearly wins every metric");
  });

  test("baseline section reports regressions of the primary library", () => {
    const markdown = renderReportMarkdown(losing, { baseline: { ...winning, generatedAt: "2025-12-01T00:00:00.000Z" } });
    expect(markdown).toContain("## Change since the baseline");
    expect(markdown).toContain("WORSE");
  });
});

describe("benchmark summary page", () => {
  const winning = report([2, 2.1, 2, 2.05, 2], [4, 4.1, 4.2, 4, 4.1], [2000, 2010, 1990, 2000, 2005], [1000, 1010, 990, 1000, 1000]);
  const losing = report([8, 8.5, 8.2, 8, 8.1], [3, 3.1, 3.2, 3, 3.1], [2000, 2010, 1990, 2000, 2005], [1000, 1010, 990, 1000, 1000]);

  test("is a short page: area counts, one scoreboard row per scenario, and the losses", () => {
    const markdown = renderSummaryMarkdown(losing, { title: "# Benchmarks" });
    expect(markdown.startsWith("# Benchmarks")).toBe(true);
    expect(markdown).toContain("BlazePlot is ahead of uPlot on 1, level on 0, and behind on 1");
    expect(markdown).toContain("| Setup | 1 | 1 behind |");
    expect(markdown).toContain("| Line | 1 | 1 ahead |");
    expect(markdown).toContain("## Where uPlot is faster");
    expect(markdown).toContain("| Static | Ready (ms) |");
    expect(markdown).not.toContain("## Results by scenario");
    expect(markdown.split(/\r?\n/u).length).toBeLessThan(60);
  });

  test("shows FPS without repeating its unit and links to the full results", () => {
    const markdown = renderSummaryMarkdown(losing);
    expect(markdown).toContain("| Pan | FPS |");
    expect(markdown).toContain("(./benchmark-results.md)");
  });

  test("says so when uPlot is never clearly ahead", () => {
    expect(renderSummaryMarkdown(winning)).toContain("never clearly behind uPlot");
  });

  test("lists each scenario at most once in the losses table, with its ratio", () => {
    const withTwoLosses = report([8, 8.5, 8.2, 8, 8.1], [3, 3.1, 3.2, 3, 3.1], [500, 510, 490, 500, 505], [1000, 1010, 990, 1000, 1000]);
    const lines = renderSummaryMarkdown(withTwoLosses).split(/\r?\n/u);
    const losses = lines.slice(lines.indexOf("## Where uPlot is faster"), lines.indexOf("## How it was measured"));
    expect(losses.filter((line) => line.startsWith("| Static |"))).toHaveLength(1);
    expect(losses.filter((line) => line.startsWith("| Pan |"))).toHaveLength(1);
    expect(losses.some((line) => line.startsWith("| Static |") && line.endsWith("2.61× |"))).toBe(true);
  });
});

describe("benchmark config", () => {
  test("every scenario lists known metrics and its primary metric", () => {
    const metricIds = Object.keys(officialConfig.metrics);
    for (const scenario of officialConfig.scenarios) {
      expect(scenario.metrics).toContain(scenario.primary);
      for (const id of scenario.metrics) expect(metricIds).toContain(id);
    }
    expect(new Set(officialConfig.scenarios.map((scenario) => scenario.name)).size).toBe(officialConfig.scenarios.length);
  });

  test("every scenario has a short label for the summary page", () => {
    for (const scenario of officialConfig.scenarios) {
      expect((scenario as { label?: string }).label?.length ?? 0).toBeGreaterThan(0);
      expect((scenario as { label?: string }).label!.length).toBeLessThan(45);
    }
  });
});
