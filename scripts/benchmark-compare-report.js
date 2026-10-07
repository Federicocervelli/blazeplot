// Aggregation, verdicts and markdown rendering for the public comparison benchmark.
// Shared by scripts/benchmark-compare.ts (writes benchmarks/latest.*) and scripts/generate-readme-docs.js
// (regenerates docs/benchmarks.md and the README section from benchmarks/latest.json). Plain JS so both
// Bun/TypeScript and plain Node can import it; types live in benchmark-compare-report.d.ts.

import { readFileSync } from "node:fs";

export const REPORT_SCHEMA_VERSION = 2;
/** Libraries that decide the winner. The Canvas 2D backend is reported next to BlazePlot but never changes the winner. */
export const CONTENDERS = ["blazeplot", "uplot", "chartjs"];
export const PRIMARY_LIBRARY = "blazeplot";
export const CANVAS_LIBRARY = "blazeplot-canvas2d";

const ABS_NOISE_BY_UNIT = { ms: 0.05, MiB: 0.25 };

export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index] ?? 0;
}

/** Summarize the per-run values of one metric. `p95` is the nearest-rank 95th percentile over runs. */
export function aggregateValues(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0, median: 0, mean: 0, p95: 0, min: 0, max: 0, spreadPct: 0, values: [] };
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = sorted.reduce((total, value) => total + value, 0) / n;
  const min = sorted[0];
  const max = sorted[n - 1];
  const scale = Math.abs(median);
  return {
    n,
    median: round(median),
    mean: round(mean),
    p95: round(percentile(sorted, 0.95)),
    min: round(min),
    max: round(max),
    spreadPct: scale > 0 ? round(((max - min) / 2 / scale) * 100, 1) : 0,
    values: values.map((value) => round(value)),
  };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function metricDef(report, id) {
  return report.metrics?.[id] ?? { label: id, short: id, unit: "", direction: "min" };
}

function absNoise(def) {
  return def.absNoise ?? ABS_NOISE_BY_UNIT[def.unit] ?? 0;
}

export function libraryName(report, id) {
  return report.libraries?.[id]?.name ?? id;
}

export function findResult(scenario, id) {
  return scenario.results.find((entry) => entry.library === id);
}

export function metricOf(scenario, id, metricId) {
  const result = findResult(scenario, id);
  return result?.ok ? result.metrics?.[metricId] : undefined;
}

/**
 * Compare `subject` against `reference` on one metric.
 * `advantage` is > 1 when the subject is better, whatever the metric direction (reference/subject for
 * lower-is-better, subject/reference for higher-is-better). A result is a win/loss only when the medians
 * differ by more than the noise floor AND the run ranges do not overlap; otherwise it is a tie that leans
 * towards whichever side has the better median.
 */
export function compareMetric(subject, reference, def, noiseFloor = 0.05) {
  const lowerBetter = def.direction !== "max";
  const diff = lowerBetter ? reference.median - subject.median : subject.median - reference.median;
  const scale = Math.max(Math.abs(subject.median), Math.abs(reference.median));
  const advantage = ratioAdvantage(subject.median, reference.median, lowerBetter);
  const tolerance = Math.max(noiseFloor * scale, absNoise(def));
  const rangesOverlap = subject.min <= reference.max && reference.min <= subject.max;
  let verdict;
  if (Math.abs(diff) <= tolerance) verdict = "tie";
  else if (rangesOverlap) verdict = "tie";
  else verdict = diff > 0 ? "win" : "loss";
  const lean = diff > 0 ? "subject" : diff < 0 ? "reference" : "none";
  return { verdict, lean, advantage, diff };
}

function ratioAdvantage(subject, reference, lowerBetter) {
  if (subject === reference) return 1;
  const numerator = lowerBetter ? reference : subject;
  const denominator = lowerBetter ? subject : reference;
  if (!(denominator > 0) || !(numerator > 0)) return null;
  return numerator / denominator;
}

/** Winner among the contender libraries for one metric, or "tie" when the best two are within noise. */
export function metricWinner(report, scenario, metricId) {
  const def = metricDef(report, metricId);
  const entries = CONTENDERS
    .map((id) => ({ id, metric: metricOf(scenario, id, metricId) }))
    .filter((entry) => entry.metric !== undefined);
  if (entries.length === 0) return { winner: null, tied: [] };
  const lowerBetter = def.direction !== "max";
  entries.sort((a, b) => (lowerBetter ? a.metric.median - b.metric.median : b.metric.median - a.metric.median));
  const best = entries[0];
  const tied = [best.id];
  for (const entry of entries.slice(1)) {
    const verdict = compareMetric(best.metric, entry.metric, def, report.noiseFloor ?? 0.05).verdict;
    if (verdict === "tie") tied.push(entry.id);
  }
  return { winner: tied.length === 1 ? best.id : "tie", tied };
}

/** Rows for every metric where the subject library does not clearly beat uPlot or Chart.js. */
export function collectNonWins(report, subjectId = PRIMARY_LIBRARY, referenceIds = ["uplot", "chartjs"]) {
  const rows = [];
  for (const scenario of report.scenarios) {
    for (const metricId of scenario.metricIds) {
      const def = metricDef(report, metricId);
      const subject = metricOf(scenario, subjectId, metricId);
      if (!subject) continue;
      for (const referenceId of referenceIds) {
        const reference = metricOf(scenario, referenceId, metricId);
        if (!reference) continue;
        const comparison = compareMetric(subject, reference, def, report.noiseFloor ?? 0.05);
        if (comparison.verdict !== "win") rows.push({ scenario, metricId, def, referenceId, subject, reference, ...comparison });
      }
    }
  }
  return rows;
}

export function countComparisons(report, subjectId = PRIMARY_LIBRARY, referenceIds = ["uplot", "chartjs"]) {
  let count = 0;
  for (const scenario of report.scenarios) {
    for (const metricId of scenario.metricIds) {
      if (!metricOf(scenario, subjectId, metricId)) continue;
      for (const referenceId of referenceIds) if (metricOf(scenario, referenceId, metricId)) count++;
    }
  }
  return count;
}

// ------------------------------------------------------------------ formatting

export function formatNumber(value, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function digitsFor(def, value) {
  if (def.unit === "fps" || def.unit === "k samples/s") return Math.abs(value) >= 100 ? 0 : 1;
  if (def.unit === "MiB") return 1;
  return Math.abs(value) >= 100 ? 1 : 2;
}

export function formatValue(def, value) {
  return formatNumber(value, digitsFor(def, value));
}

export function formatRatio(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return `${value.toFixed(value >= 10 ? 1 : 2)}×`;
}

function cell(def, metric, bold) {
  if (!metric) return "—";
  const text = formatValue(def, metric.median);
  return bold ? `**${text}**` : text;
}

function detailCell(def, metric, bold) {
  if (!metric) return "—";
  const median = formatValue(def, metric.median);
  const head = bold ? `**${median}**` : median;
  return `${head} · p95 ${formatValue(def, metric.p95)} · ±${metric.spreadPct.toFixed(0)}%`;
}

function esc(value) {
  return String(value).replaceAll("|", "\\|");
}

function row(cells) {
  return `| ${cells.map(esc).join(" | ")} |`;
}

function verdictLabel(comparison, subjectName, referenceName) {
  if (comparison.verdict === "win") return "win";
  if (comparison.verdict === "loss") return "LOSS";
  const lean = comparison.lean === "subject" ? subjectName : comparison.lean === "reference" ? referenceName : "even";
  return `within noise (leans ${lean})`;
}

function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const gib = 1024 * 1024 * 1024;
  return value >= gib ? `${(value / gib).toFixed(1)} GiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function winnerLabel(report, scenario, metricId) {
  const { winner, tied } = metricWinner(report, scenario, metricId);
  if (winner === null) return "—";
  if (winner === "tie") return `tie (${tied.map((id) => libraryName(report, id)).join(", ")})`;
  return libraryName(report, winner);
}

function boldFor(report, scenario, metricId, libraryId) {
  const { winner } = metricWinner(report, scenario, metricId);
  return winner === libraryId;
}

// -------------------------------------------------------------------- sections

export function libraryOrder(report) {
  return (report.options?.libraries?.length ? report.options.libraries : Object.keys(report.libraries ?? {})).filter((id) => report.libraries?.[id]);
}

function ratioCells(report, scenario, metricId) {
  const def = metricDef(report, metricId);
  const subject = metricOf(scenario, PRIMARY_LIBRARY, metricId);
  return ["uplot", "chartjs"].map((id) => {
    const reference = metricOf(scenario, id, metricId);
    if (!subject || !reference) return "—";
    return formatRatio(compareMetric(subject, reference, def, report.noiseFloor ?? 0.05).advantage);
  });
}

/** One row per scenario using its primary metric. */
export function scoreboardLines(report) {
  const libs = libraryOrder(report);
  const lines = [
    row(["Scenario", "Metric", ...libs.map((id) => libraryName(report, id)), "Winner", "BlazePlot vs uPlot", "BlazePlot vs Chart.js"]),
    `|---|---|${libs.map(() => "---:").join("|")}|---|---:|---:|`,
  ];
  for (const scenario of report.scenarios) {
    const def = metricDef(report, scenario.primary);
    const [vsUplot, vsChartjs] = ratioCells(report, scenario, scenario.primary);
    lines.push(row([
      scenario.name,
      `${def.short} (${def.unit}${def.direction === "max" ? ", higher is better" : ""})`,
      ...libs.map((id) => cell(def, metricOf(scenario, id, scenario.primary), boldFor(report, scenario, scenario.primary, id))),
      winnerLabel(report, scenario, scenario.primary),
      vsUplot,
      vsChartjs,
    ]));
  }
  return lines;
}

function nonWinSection(report, subjectId, referenceIds, heading, intro) {
  const subjectName = libraryName(report, subjectId);
  const rows = collectNonWins(report, subjectId, referenceIds);
  const lines = ["", heading, "", intro, ""];
  if (rows.length === 0) {
    lines.push(`${subjectName} clearly wins every metric against ${referenceIds.map((id) => libraryName(report, id)).join(" and ")}.`);
    return lines;
  }
  lines.push(
    row(["Scenario", "Metric", subjectName, "Competitor", "Competitor value", "Advantage", "Verdict"]),
    "|---|---|---:|---|---:|---:|---|",
  );
  const order = (entry) => (entry.verdict === "loss" ? 0 : 1);
  for (const entry of [...rows].sort((a, b) => order(a) - order(b))) {
    const referenceName = libraryName(report, entry.referenceId);
    lines.push(row([
      entry.scenario.name,
      `${entry.def.short} (${entry.def.unit})`,
      formatValue(entry.def, entry.subject.median),
      referenceName,
      formatValue(entry.def, entry.reference.median),
      formatRatio(entry.advantage),
      verdictLabel(entry, subjectName, referenceName),
    ]));
  }
  return lines;
}

export function nonWinLines(report) {
  const lines = nonWinSection(
    report,
    PRIMARY_LIBRARY,
    ["uplot", "chartjs"],
    "## Where BlazePlot does not win",
    "Every metric of every scenario where BlazePlot (WebGL) is not clearly ahead of uPlot or Chart.js. Advantage is competitor ÷ BlazePlot for lower-is-better metrics and BlazePlot ÷ competitor for higher-is-better ones, so values below 1.00× are losses. \"Within noise\" means the medians differ by less than the noise floor or the min–max ranges of the runs overlap.",
  );
  if (report.libraries?.[CANVAS_LIBRARY]) {
    lines.push(...nonWinSection(
      report,
      CANVAS_LIBRARY,
      ["uplot"],
      "### Canvas 2D backend versus uPlot",
      "The Canvas 2D backend is the fallback renderer; the same rule applied against uPlot only.",
    ));
  }
  return lines;
}

function detailTables(report) {
  const libs = libraryOrder(report);
  const lines = ["", "## Results by scenario", "", "Each cell is median · p95 across runs · half-range spread as a percentage of the median. Bold marks the winner among BlazePlot (WebGL), uPlot and Chart.js.", ""];
  let group = "";
  for (const scenario of report.scenarios) {
    if (scenario.group !== group) {
      group = scenario.group;
      lines.push(`### ${group}`, "");
    }
    lines.push(`#### ${scenario.name}`, "", scenario.title, "");
    if (scenario.notes?.length) lines.push(...scenario.notes.map((note) => `- ${note}`), "");
    lines.push(
      row(["Metric", ...libs.map((id) => libraryName(report, id)), "Winner", "BlazePlot vs uPlot", "BlazePlot vs Chart.js"]),
      `|---|${libs.map(() => "---:").join("|")}|---|---:|---:|`,
    );
    for (const metricId of scenario.metricIds) {
      const def = metricDef(report, metricId);
      const [vsUplot, vsChartjs] = ratioCells(report, scenario, metricId);
      lines.push(row([
        `${def.short} (${def.unit})`,
        ...libs.map((id) => {
          const result = findResult(scenario, id);
          if (result && !result.ok) return result.skipped ? `skipped` : "failed";
          return detailCell(def, metricOf(scenario, id, metricId), boldFor(report, scenario, metricId, id));
        }),
        winnerLabel(report, scenario, metricId),
        vsUplot,
        vsChartjs,
      ]));
    }
    lines.push("");
  }
  return lines;
}

function failureLines(report) {
  const lines = ["", "## Failures and skipped runs", ""];
  const items = [];
  for (const scenario of report.scenarios) {
    for (const result of scenario.results) {
      if (result.skipped) items.push(`- ${scenario.name} / ${libraryName(report, result.library)}: skipped, ${result.skipped}`);
      else if (!result.ok) items.push(`- ${scenario.name} / ${libraryName(report, result.library)}: ${result.errors?.[0]?.split("\n")[0] ?? "no successful run"}`);
      else if (result.runsFailed > 0) items.push(`- ${scenario.name} / ${libraryName(report, result.library)}: ${result.runsFailed} of ${result.runsRequested} runs failed (${result.errors?.[0]?.split("\n")[0] ?? "unknown error"}); medians use the ${result.runsSucceeded} successful run(s)`);
    }
  }
  lines.push(...(items.length > 0 ? items : ["No library runs failed or were skipped."]));
  return lines;
}

function baselineLines(report, baseline) {
  if (!baseline || baseline.generatedAt === report.generatedAt) return [];
  const lines = [
    "",
    "## Change since the baseline",
    "",
    `Baseline: \`${baseline.command ?? "benchmark baseline"}\` generated ${baseline.generatedAt}${baseline.libraries?.blazeplot ? ` with BlazePlot ${baseline.libraries.blazeplot.version}` : ""}. Change is the BlazePlot (WebGL) median now versus then; "better" and "worse" follow each metric's direction, and changes inside the noise floor are shown as "same".`,
    "",
    row(["Scenario", "Metric", "Baseline", "Now", "Change", "Result"]),
    "|---|---|---:|---:|---:|---|",
  ];
  let any = false;
  for (const scenario of report.scenarios) {
    const before = baseline.scenarios?.find((entry) => entry.name === scenario.name);
    if (!before) continue;
    for (const metricId of scenario.metricIds) {
      const def = metricDef(report, metricId);
      const now = metricOf(scenario, PRIMARY_LIBRARY, metricId);
      const then = metricOf(before, PRIMARY_LIBRARY, metricId);
      if (!now || !then) continue;
      any = true;
      const comparison = compareMetric(now, then, def, report.noiseFloor ?? 0.05);
      const change = then.median !== 0 ? ((now.median - then.median) / Math.abs(then.median)) * 100 : 0;
      const result = comparison.verdict === "win" ? "better" : comparison.verdict === "loss" ? "WORSE" : "same";
      lines.push(row([scenario.name, `${def.short} (${def.unit})`, formatValue(def, then.median), formatValue(def, now.median), `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`, result]));
    }
  }
  return any ? lines : [];
}

export function methodologyLines(report, link = "../docs/internal/benchmarks.md") {
  return [
    "",
    "## Methodology",
    "",
    `- Every sample is one fresh browser context (new renderer process and heap) measuring exactly one scenario and library; each cell aggregates ${report.options?.runs ?? "N"} such runs. Runs are interleaved across libraries with a rotating order so no library always runs first.`,
    "- Before measuring, the page builds small charts of the same series type (JIT and shader warmup), then runs the full-size chart construction once and discards it. The measured chart follows a forced garbage collection. The cold-page scenario skips all warmup on purpose.",
    "- Ready time is library construction through the end of the first frame in which the chart's content has been drawn: layout, axes and first paint included. Libraries that draw synchronously are timed through the next frame boundary, so deferred drawing (BlazePlot renders in its first animation frame) is not charged unfairly.",
    "- Frame cost is the synchronous update/redraw call plus the time the library spends inside its own animation-frame callbacks, so a library that redraws immediately and one that defers to the next frame are charged the same way. FPS is the real animation-frame cadence with the frame-rate limit disabled, so it also reflects raster and GPU back-pressure.",
    "- All libraries receive the same data (in their own native format), the same 1 px lines and colors, no grid, and the same axis gutters (52 px left/right, 28 px bottom), so they plot into the same rectangle. The plot size each library reports is recorded in the JSON details.",
    "- Heap numbers are `performance.memory.usedJSHeapSize` after forced GC with precise memory info enabled: JavaScript heap only, so GPU, canvas backing-store and other native memory are not included.",
    `- Details and caveats: [Benchmark methodology](${link}).`,
  ];
}

/** Full markdown report (benchmarks/latest.md and docs/benchmarks.md). */
export function renderReportMarkdown(report, options = {}) {
  const machine = report.environment?.machine;
  const page = report.environment?.page;
  const browser = report.environment?.browser;
  const lines = [
    options.title ?? "# Latest BlazePlot comparison benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    `Command: \`${report.command}\``,
    `Publishable: ${report.publishable ? "yes" : "no"}`,
  ];
  if (report.warnings?.length) lines.push("", "Warnings:", ...report.warnings.map((warning) => `- ${warning}`));
  lines.push(
    "",
    "## Environment",
    "",
    `- Machine: ${machine?.label ?? "local machine"}; ${String(machine?.cpuModel ?? "unknown CPU").trim()}; ${machine?.cpuCount ?? "?"} logical CPUs; ${formatBytes(machine?.totalMemoryBytes)} RAM`,
    `- OS: ${[machine?.platform, machine?.release, machine?.arch].filter(Boolean).join(" ") || "unknown"}`,
    `- Browser: ${browser?.product ?? page?.userAgent ?? "unknown browser"}${report.environment?.executable ? ` (${report.environment.executable})` : ""}`,
    `- GPU/WebGL: ${page?.webglRenderer ?? "unknown"}`,
    `- Canvas: ${report.options?.width ?? "?"}×${report.options?.height ?? "?"} CSS px; DPR ${page?.devicePixelRatio ?? "?"}`,
    `- Runs: ${report.options?.runs ?? "?"} fresh-page runs per scenario and library (median reported); ${report.options?.setupWarmupRuns ?? 0} discarded full-size setup run(s) per page`,
    `- Libraries: ${libraryOrder(report).map((id) => `${libraryName(report, id)} ${report.libraries[id].version}`).join("; ")}`,
    "",
    "## Scoreboard",
    "",
    "Primary metric of each scenario (median over runs). Advantage columns are > 1.00× when BlazePlot (WebGL) is better, whatever the metric direction. Every metric is in [Results by scenario](#results-by-scenario).",
    "",
    ...scoreboardLines(report),
    ...nonWinLines(report),
    ...detailTables(report),
    ...baselineLines(report, options.baseline),
    ...failureLines(report),
    ...methodologyLines(report, options.methodologyLink),
    "",
  );
  return lines.join("\n");
}

/** Compact section for the README: scoreboard plus the count of metrics BlazePlot does not clearly win. */
export function readmeSummaryLines(report) {
  const nonWins = collectNonWins(report);
  const losses = nonWins.filter((entry) => entry.verdict === "loss").length;
  const ties = nonWins.length - losses;
  const total = countComparisons(report);
  return {
    scoreboard: scoreboardLines(report),
    summary: `Across ${report.scenarios.length} scenarios and ${total} metric comparisons against uPlot and Chart.js, BlazePlot (WebGL) clearly wins ${total - nonWins.length}, is within noise on ${ties}, and loses ${losses}.`,
  };
}

// --------------------------------------------------------------- concise summary

/** "AMD Radeon RX 9070" out of an ANGLE renderer string; other strings are returned trimmed. */
function shortGpu(renderer) {
  const text = String(renderer ?? "unknown GPU");
  return /ANGLE \([^,]+,\s*([^,(]+)/.exec(text)?.[1]?.trim() ?? text.trim();
}

/** "Chrome 154" out of "Chrome/154.0.8037.57". */
function shortBrowser(product) {
  const match = /^([^/]+)\/(\d+)/.exec(String(product ?? ""));
  return match ? `${match[1]} ${match[2]}` : String(product ?? "unknown browser");
}

/** "Ready (ms)", or just "FPS" when the unit repeats the name. */
function metricHeading(def) {
  return def.short.toLowerCase() === def.unit.toLowerCase() ? def.short : `${def.short} (${def.unit})`;
}

/** Short labels and headline flags from the official config, for results written before scenarios carried them. */
let configInfo = null;

function scenarioInfo(scenario) {
  if (!configInfo) {
    configInfo = new Map();
    try {
      const config = JSON.parse(readFileSync(new URL("./benchmark-config.json", import.meta.url), "utf8"));
      for (const entry of config.scenarios ?? []) configInfo.set(entry.name, entry);
    } catch {
      // Without the config, full titles are used and every scenario is shown.
    }
  }
  const known = configInfo.get(scenario.name);
  return { label: scenario.label ?? known?.label ?? scenario.title, headline: (scenario.headline ?? known?.headline) === true };
}

/** The scenarios where uPlot is clearly faster than either BlazePlot engine, in the order given. */
function uplotLeads(report, scenarios, pipelineIds) {
  const names = new Set();
  for (const pipelineId of pipelineIds) {
    for (const entry of collectNonWins(report, pipelineId, ["uplot"])) {
      if (entry.verdict === "loss" && scenarios.includes(entry.scenario) && entry.metricId === entry.scenario.primary) names.add(entry.scenario.name);
    }
  }
  return scenarios.filter((scenario) => names.has(scenario.name));
}

/**
 * Short benchmark page: the handful of scenarios people care most about (flagged `headline` in
 * benchmark-config.json) as one table, with a line on where uPlot is still faster. Every metric of every
 * scenario is in `renderReportMarkdown` (docs/benchmark-results.md).
 */
export function renderSummaryMarkdown(report, options = {}) {
  const page = report.environment?.page;
  const machine = report.environment?.machine;
  const pipelines = [PRIMARY_LIBRARY, CANVAS_LIBRARY].filter((id) => report.libraries?.[id]);
  const libs = [...pipelines, "uplot", "chartjs"].filter((id) => report.libraries?.[id]);
  const featured = report.scenarios.filter((scenario) => scenarioInfo(scenario).headline);
  const shown = featured.length > 0 ? featured : report.scenarios;
  const cpu = String(machine?.cpuModel ?? "unknown CPU").replace(/\s+\d+-Core Processor/, "").trim();
  const lines = [
    options.title ?? "# Benchmarks",
    "",
    `BlazePlot against uPlot and Chart.js on the same data in ${shortBrowser(report.environment?.browser?.product ?? page?.userAgent)}, on ${cpu} and ${shortGpu(page?.webglRenderer)}. Each number is the median of ${report.options?.runs ?? "?"} fresh-page runs, and BlazePlot is shown on both of its rendering engines. Lower is better, except for FPS.`,
    "",
    row(["Scenario", "Metric", ...libs.map((id) => libraryName(report, id))]),
    `|---|---|${libs.map(() => "---:").join("|")}|`,
  ];
  for (const scenario of shown) {
    const def = metricDef(report, scenario.primary);
    lines.push(row([
      scenarioInfo(scenario).label,
      metricHeading(def),
      ...libs.map((id) => cell(def, metricOf(scenario, id, scenario.primary), boldFor(report, scenario, scenario.primary, id))),
    ]));
  }

  const behind = uplotLeads(report, shown, pipelines);
  lines.push("");
  if (behind.length > 0) {
    lines.push(`Bold is the best of ${libraryName(report, PRIMARY_LIBRARY)}, uPlot and Chart.js. uPlot is still faster on: ${behind.map((scenario) => scenarioInfo(scenario).label.replace(/^./, (letter) => letter.toLowerCase())).join("; ")}.`);
  } else {
    lines.push(`Bold is the best of ${libraryName(report, PRIMARY_LIBRARY)}, uPlot and Chart.js.`);
  }
  lines.push(
    "",
    `All ${report.scenarios.length} scenarios, every metric with p95 and spread, and the full method are on [Benchmark results](./benchmark-results.md). Reproduce with \`bun run bench:compare\`.`,
    "",
  );
  return lines.join("\n");
}
