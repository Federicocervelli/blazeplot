#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);
const apiReferencePath = resolve(root, "docs/api-reference.md");
const benchmarkDocsPath = resolve(root, "docs/benchmarks.md");
const readmePath = resolve(root, "README.md");
const packagePath = resolve(root, "package.json");
const distIndexPath = resolve(root, "dist/index.d.ts");
const docsPagesPath = resolve(root, "docs/pages.json");
const comparisonBenchmarkPath = resolve(root, "benchmarks/latest.json");

const docsStartMarker = "<!-- README_DOCS_START -->";
const docsEndMarker = "<!-- README_DOCS_END -->";
const performanceStartMarker = "<!-- README_PERFORMANCE_START -->";
const performanceEndMarker = "<!-- README_PERFORMANCE_END -->";
const officialComparisonLibraries = ["blazeplot", "uplot", "chartjs"];
const officialComparisonScenarios = ["line-100k-static", "line-1m-static", "line-1m-pan", "line-1m-stream", "line-10m-pan"];
const runtimeComparisonPairs = [
  { primaryLibrary: "blazeplot", referenceLibrary: "uplot" },
];

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const checkExportDescriptions = args.has("--check-export-descriptions");

const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

const exportDescriptions = new Map([
  [".", "Core chart, data, interaction, rendering types, and low-level primitives."],
  ["./core", "Data structures, datasets, LOD helpers, and series storage without chart UI."],
  ["./interaction", "Camera, axis, pan/zoom intent, and viewport policy helpers without chart UI."],
  ["./render", "Renderer and WebGL backend primitives without chart UI."],
  ["./react", "React wrapper component."],
  ["./linked", "Linked chart layout helpers with tooltip/crosshair sync factories."],
  ["./linked-core", "Lean linked chart layout helpers without tooltip/crosshair sync imports."],
  ["./data", "Pure chart data export and transform helpers."],
  ["./export", "Screenshot download and clipboard helpers."],
  ["./plugins/interactions", "Built-in pan, zoom, axis interaction, and reset plugin."],
  ["./plugins/legend", "Built-in legend plugin."],
  ["./plugins/tooltip", "Built-in tooltip plugin."],
  ["./plugins/annotations", "Built-in annotation overlay plugin."],
  ["./plugins/selection", "Built-in brush/range selection plugin."],
  ["./plugins/crosshair", "Built-in crosshair and ruler plugin."],
  ["./plugins/navigator", "Built-in overview/navigator plugin."],
  ["./plugins/flamegraph", "Built-in flame graph and status-span plugin."],
]);

validateExportDescriptions();
if (checkExportDescriptions && process.argv.length <= 3) {
  console.log("Package export descriptions cover every public subpath.");
  process.exit(0);
}

if (!existsSync(distIndexPath)) {
  throw new Error("dist/index.d.ts not found. Run `bun run build` before generating README docs.");
}

const sourceCache = new Map();
const declarationCache = new Map();
const printer = ts.createPrinter({ removeComments: true });

function packageEntryName(key) {
  return key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`;
}

function parseSource(filePath) {
  const cached = sourceCache.get(filePath);
  if (cached) return cached;
  const source = ts.createSourceFile(filePath, readFileSync(filePath, "utf-8"), ts.ScriptTarget.Latest, true);
  sourceCache.set(filePath, source);
  return source;
}

function markdownEscape(value) {
  return String(value)
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function code(value) {
  return `\`${markdownEscape(value)}\``;
}

function jsDoc(node) {
  const docs = node.jsDoc;
  if (!docs || docs.length === 0) return "";
  const parts = [];
  for (const doc of docs) {
    if (typeof doc.comment === "string" && doc.comment.trim()) parts.push(doc.comment.trim());
    for (const tag of doc.tags ?? []) {
      if (tag.tagName?.text === "deprecated") {
        const text = typeof tag.comment === "string" ? tag.comment.trim() : "";
        parts.push(text ? `Deprecated: ${text}` : "Deprecated.");
      }
    }
  }
  return parts.join(" ").trim();
}

function declarationKind(node) {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableStatement(node)) return "const";
  return "export";
}

function declarationName(node) {
  if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
    return node.name.text;
  }
  if (ts.isVariableStatement(node)) {
    const first = node.declarationList.declarations[0];
    return first && ts.isIdentifier(first.name) ? first.name.text : "";
  }
  return "";
}

function resolveModuleDts(fromFile, moduleSpecifier) {
  const raw = moduleSpecifier.replace(/\.js$/, ".d.ts");
  return resolve(dirname(fromFile), raw);
}

function collectIndexExports() {
  const source = parseSource(distIndexPath);
  const exports = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;

    const moduleSpecifier = statement.moduleSpecifier.text;
    const filePath = resolveModuleDts(distIndexPath, moduleSpecifier);
    for (const element of statement.exportClause.elements) {
      const name = element.name.text;
      exports.push({
        name,
        source: moduleSpecifier.replace(/\.js$/, ""),
        filePath,
        typeOnly: statement.isTypeOnly || element.isTypeOnly,
      });
    }
  }
  return exports;
}

function findDeclaration(filePath, name) {
  const cacheKey = `${filePath}:${name}`;
  const cached = declarationCache.get(cacheKey);
  if (cached) return cached;

  const source = parseSource(filePath);
  for (const statement of source.statements) {
    const foundName = declarationName(statement);
    if (foundName === name) {
      const result = { node: statement, source };
      declarationCache.set(cacheKey, result);
      return result;
    }
  }
  return null;
}

function collectPublicExports() {
  return collectIndexExports()
    .map((entry) => {
      const declaration = findDeclaration(entry.filePath, entry.name);
      return {
        ...entry,
        kind: declaration ? declarationKind(declaration.node) : entry.typeOnly ? "type" : "value",
        summary: declaration ? jsDoc(declaration.node) : "",
        declaration,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function validateExportDescriptions() {
  const missing = Object.keys(pkg.exports ?? {})
    .filter((key) => key !== "./package.json" && !exportDescriptions.has(key));
  if (missing.length > 0) {
    throw new Error(`Missing package export descriptions for: ${missing.join(", ")}`);
  }
}

function readDocPages() {
  return JSON.parse(readFileSync(docsPagesPath, "utf8"))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

function renderEntrypoints() {
  const rows = Object.keys(pkg.exports ?? {})
    .filter((key) => key !== "./package.json")
    .map((key) => `| ${code(packageEntryName(key))} | ${exportDescriptions.get(key)} |`);

  return [
    "### Package entry points",
    "",
    "| Import | Contents |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

function renderBundleSizeSummary() {
  return execFileSync("bun", ["scripts/bundle-size-check.ts", "--markdown"], {
    cwd: root,
    encoding: "utf8",
  }).trimEnd();
}

function renderPublicExports(exports) {
  const rows = exports.map((entry) => {
    const summary = entry.summary || "—";
    return `| ${code(entry.name)} | ${entry.kind} | ${code(entry.source)} | ${markdownEscape(summary)} |`;
  });

  return [
    "### All public exports",
    "",
    "Generated from `dist/index.d.ts` after the package build.",
    "",
    "| Export | Kind | Source | JSDoc summary |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function guideLink(basePath, file) {
  const prefix = basePath ? `${basePath.replace(/\/$/, "")}/` : "";
  return `${prefix}${file}`;
}

function renderGuideLinks(basePath) {
  return readDocPages()
    .filter((page) => !page.sourcePath.startsWith("docs/internal/"))
    .filter((page) => page.slug !== "api-reference" && page.slug !== "documentation-contributions" && page.slug !== "release-and-benchmarks")
    .map((page) => `[${page.title === "Data" ? "Data semantics" : page.title}](${guideLink(basePath, page.sourcePath.replace(/^docs\//, ""))})`)
    .join(", ");
}

function renderGeneratedDocs(options = {}) {
  const publicExports = collectPublicExports();
  const guideBasePath = options.guideBasePath ?? "";
  const commonApiMap = [
    "This page is generated from the built package. Use it as an index of import paths and public symbols; the guide pages explain when to use each feature.",
    "",
    "### Common API map",
    "",
    "| Task | Start here |",
    "|---|---|",
    "| Create and render a chart | `createChart(...)` for common static charts; `Chart`, `chart.addLine(...)`, `chart.fitToData()`, and `chart.start()` for manual lifecycle control |",
    "| Static X/Y arrays or object rows | `createChart(...)`, `StaticDataset`, `StaticDataset.fromObjects(...)` |",
    "| Live irregular data | `chart.addLine({ capacity })`, `RingBuffer`, [Live data](" + guideLink(guideBasePath, "live-data.md") + ") |",
    "| Live fixed-rate data | `chart.addLine({ capacity, xStep })`, `UniformRingBuffer`, [Live data](" + guideLink(guideBasePath, "live-data.md") + ") |",
    "| OHLC/candlesticks | `StaticOhlcDataset`, `OhlcRingBuffer`, `chart.addOhlc(...)`, `chart.addCandlestick(...)` |",
    "| Custom high-performance data | `Dataset`, `AcceleratedDataset`, range/copy dataset interfaces |",
    "| Pan/zoom and user interaction | `blazeplot/plugins/interactions`, `Camera2D`, viewport APIs |",
    "| Tooltips, legends, annotations, selection, flame graphs | `blazeplot/plugins/*` subpaths |",
    "| React | `blazeplot/react` and `BlazeChart` |",
    "| Linked dashboards | `blazeplot/linked` or `blazeplot/linked-core` |",
    "| Image/data export | `chart.screenshot()`, `blazeplot/export`, `blazeplot/data` |",
    "",
    `Guides: ${renderGuideLinks(guideBasePath)}.`,
  ].join("\n");

  const parts = [
    docsStartMarker,
    "## API reference",
    "",
    commonApiMap,
    "",
    renderEntrypoints(),
    "",
    "The bundle table lists emitted files after Vite code-splitting. Entry rows can be tiny stubs that load shared chunks; use the README performance section for the aggregate core runtime size.",
    "",
    renderBundleSizeSummary(),
  ];
  parts.push("", renderPublicExports(publicExports));
  parts.push(docsEndMarker);
  return parts.join("\n");
}

function renderPerformanceBlock() {
  const core = collectCoreRuntimeSize();
  const size = `${formatKiB(core.rawBytes)} raw / ${formatKiB(core.gzipBytes)} gzip`;
  if (existsSync(comparisonBenchmarkPath)) {
    const report = JSON.parse(readFileSync(comparisonBenchmarkPath, "utf8"));
    assertPublishableComparisonReport(report);
    return renderComparisonPerformanceBlock(report, size);
  }

  return [
    performanceStartMarker,
    "## Performance",
    "",
    `The core chart runtime is intentionally compact: the production build for \`blazeplot\` (without optional plugins) is about **${size}**. Optional plugins and helpers ship as separate subpath entries.`,
    "",
    "Public library-comparison numbers are generated only from the manual headed benchmark suite. Run `bun run bench:compare` on the official local machine to overwrite `benchmarks/latest.json` and `benchmarks/latest.md`; once that file exists, this README section is generated from it.",
    "",
    "CI still runs `bun run bench:ci` as a fast headless smoke test, but those headless/SwiftShader numbers are not used for public comparison claims.",
    performanceEndMarker,
  ].join("\n");
}

function comparisonLibraryOrder(report) {
  const libraryOrder = report.options?.libraries?.length ? report.options.libraries : officialComparisonLibraries;
  return libraryOrder.filter((id) => report.libraries?.[id]);
}

function libraryVersionLabel(report, libraryId) {
  const library = report.libraries?.[libraryId];
  return library ? `${library.name} ${library.version}` : libraryId;
}

function renderBenchmarkComparisonDocs() {
  const header = [
    "<!-- This file is generated by scripts/generate-readme-docs.js from benchmarks/latest.json. Do not edit by hand. -->",
    "# Benchmark comparisons",
    "",
  ];

  if (!existsSync(comparisonBenchmarkPath)) {
    return [
      ...header,
      "Public comparison tables are generated only from a publishable headed benchmark run.",
      "",
      "Run `bun run bench:compare` on the official local machine, then run `bun run docs:readme` to regenerate this page from `benchmarks/latest.json`.",
      "",
    ].join("\n");
  }

  const report = JSON.parse(readFileSync(comparisonBenchmarkPath, "utf8"));
  assertPublishableComparisonReport(report);
  const libraries = comparisonLibraryOrder(report);
  const libraryHeader = libraries.map((id) => libraryVersionLabel(report, id));
  const runtimeComparisons = runtimeComparisonTables(report);
  const machine = report.environment?.machine;
  const page = report.environment?.page;
  const browser = report.environment?.browser;

  const lines = [
    ...header,
    "This page is generated from `benchmarks/latest.json`; do not edit benchmark numbers by hand. To update it, run `bun run bench:compare` and then `bun run docs:readme`.",
    "",
    `Generated: ${report.generatedAt}`,
    `Command: \`${report.command}\``,
    `Publishable: ${report.publishable ? "yes" : "no"}`,
    "",
    "## Environment",
    "",
    `- Machine: ${machine?.label ?? "local machine"}; ${machine?.cpuModel ?? "unknown CPU"}; ${machine?.cpuCount ?? "?"} logical CPUs; ${formatBytes(machine?.totalMemoryBytes)} RAM`,
    `- OS: ${[machine?.platform, machine?.release, machine?.arch].filter(Boolean).join(" ") || "unknown"}`,
    `- Browser: ${browser?.product ?? page?.userAgent ?? "unknown browser"}`,
    `- GPU/WebGL: ${page?.webglRenderer ?? "unknown"}`,
    `- Canvas: ${report.options?.width ?? "?"}×${report.options?.height ?? "?"} CSS px; DPR ${page?.devicePixelRatio ?? "?"}`,
    `- Library prewarm: ${formatNumber(report.prewarmMs, 1)} ms before measured runs`,
    `- Setup warmup runs: ${report.options?.setupWarmupRuns ?? 0} discarded run(s) before each measured library/scenario`,
    "",
    "## Scenario data preparation",
    "",
    "| Scenario | Samples | Visible samples | Data prep ms |",
    "|---|---:|---:|---:|",
    ...report.scenarios.map((scenario) => `| ${markdownEscape(scenario.name)} | ${integer(scenario.sampleCount)} | ${integer(scenario.viewportSamples)} | ${formatNumber(scenario.dataPrepMs, 1)} |`),
    "",
  ];

  for (const runtimeComparison of runtimeComparisons) {
    lines.push(
      `## ${runtimeComparison.primaryLabel} vs ${runtimeComparison.referenceLabel} runtime delta`,
      "",
      `Higher ratios favor ${runtimeComparison.primaryLabel}. FPS ratio is ${runtimeComparison.primaryLabel} RAF FPS divided by ${runtimeComparison.referenceLabel} RAF FPS; work ratio is ${runtimeComparison.referenceLabel} p95 work time divided by ${runtimeComparison.primaryLabel} p95 work time.`,
      "",
      `| Scenario | FPS ratio | Work p95 ratio | ${runtimeComparison.primaryLabel} FPS | ${runtimeComparison.referenceLabel} FPS | ${runtimeComparison.primaryLabel} work p95 | ${runtimeComparison.referenceLabel} work p95 |`,
      "|---|---:|---:|---:|---:|---:|---:|",
      ...runtimeComparison.rows.map((row) => `| ${row.map(markdownEscape).join(" | ")} |`),
      "",
    );
  }

  lines.push(
    "## Initial chart ready time",
    "",
    "Ready time includes library chart construction plus the first browser frame after shared scenario data has been prepared.",
    "",
    `| Scenario | ${libraryHeader.join(" | ")} |`,
    `|---|${libraries.map(() => "---:").join("|")}|`,
    ...report.scenarios.map((scenario) => `| ${[scenario.name, ...libraries.map((id) => formatReadyCell(scenario, id, true))].map(markdownEscape).join(" | ")} |`),
    "",
    "## Runtime measurements",
    "",
    "RAF columns measure browser animation-frame cadence during automated pan/stream scenarios. Work p95 uses BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call.",
    "",
    "| Scenario | Library | RAF FPS | RAF p95 ms | Work p50 ms | Work p95 ms | Points p50 | Draws p50 | Appended | Heap after measure |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  );

  for (const scenario of report.scenarios.filter((entry) => entry.operation !== "static")) {
    for (const result of scenario.results) {
      const library = report.libraries?.[result.library] ?? { name: result.library };
      const measurement = result.measurement;
      lines.push(`| ${[
        scenario.name,
        library.name,
        formatMeasurementCell(scenario, result.library, "rafFps", true),
        formatMeasurementCell(scenario, result.library, "rafP95", true),
        formatMeasurementCell(scenario, result.library, "workP50", true),
        formatMeasurementCell(scenario, result.library, "workP95", true),
        measurement?.pointsRendered ? integer(measurement.pointsRendered.p50) : "—",
        measurement?.drawCalls ? formatNumber(measurement.drawCalls.p50, 0) : "—",
        measurement ? integer(measurement.samplesAppended) : "—",
        formatNullableBytes(result.heapAfterMeasureBytes),
      ].map(markdownEscape).join(" | ")} |`);
    }
  }

  lines.push(
    "",
    "## Source artifacts",
    "",
    "- `benchmarks/latest.json` is the canonical machine-readable result.",
    "- `benchmarks/latest.md` is the complete generated run report.",
    "- `benchmarks/README.md` documents how to collect publishable headed comparison numbers.",
    "",
  );

  return lines.join("\n");
}

function renderComparisonPerformanceBlock(report, size) {
  const libraries = comparisonLibraryOrder(report);
  const libraryHeader = libraries.map((id) => libraryVersionLabel(report, id));
  const readyRows = report.scenarios.map((scenario) => [
    scenario.name,
    ...libraries.map((id) => formatReadyCell(scenario, id, true)),
  ]);
  const measuredRows = report.scenarios
    .filter((scenario) => scenario.operation !== "static")
    .flatMap((scenario) => [
      [`${scenario.name} RAF FPS`, ...libraries.map((id) => formatMeasurementCell(scenario, id, "rafFps", true))],
      [`${scenario.name} RAF p95 ms`, ...libraries.map((id) => formatMeasurementCell(scenario, id, "rafP95", true))],
      [`${scenario.name} work p95 ms`, ...libraries.map((id) => formatMeasurementCell(scenario, id, "workP95", true))],
    ]);
  const runtimeComparisons = runtimeComparisonTables(report);
  const machine = report.environment?.machine;
  const page = report.environment?.page;
  const browser = report.environment?.browser;
  const warnings = report.warnings?.length
    ? ["", `Result warnings: ${report.warnings.join(" ")}`]
    : [];

  return [
    performanceStartMarker,
    "## Performance",
    "",
    `The core chart runtime is intentionally compact: the production build for \`blazeplot\` (without optional plugins) is about **${size}**. Optional plugins and helpers ship as separate subpath entries.`,
    "",
    `Latest manual headed comparison: ${report.generatedAt} on ${machine?.cpuModel ?? "local machine"} (${machine?.cpuCount ?? "?"} logical CPUs), ${page?.webglRenderer ?? "unknown GPU"}, ${browser?.product ?? page?.userAgent ?? "unknown browser"}. The harness prewarms each selected library before measured runs (${formatNumber(report.prewarmMs, 1)} ms total) and discards ${report.options?.setupWarmupRuns ?? 0} setup warmup run(s) before each displayed row. Source: \`benchmarks/latest.json\`.`, 
    ...warnings,
    "",
    "Initial chart ready time in milliseconds (chart construction plus first browser frame after shared data preparation):",
    "",
    `| Scenario | ${libraryHeader.join(" | ")} |`,
    `|---|${libraries.map(() => "---:").join("|")}|`,
    ...readyRows.map((row) => `| ${row.map(markdownEscape).join(" | ")} |`),
    "",
    "Automated pan/stream measurements (no user interaction after launch). Work time uses BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call:",
    "",
    `| Metric | ${libraryHeader.join(" | ")} |`,
    `|---|${libraries.map(() => "---:").join("|")}|`,
    ...measuredRows.map((row) => `| ${row.map(markdownEscape).join(" | ")} |`),
    ...runtimeComparisons.flatMap((runtimeComparison) => [
      "",
      `${runtimeComparison.primaryLabel} vs ${runtimeComparison.referenceLabel} runtime ratios. Higher favors ${runtimeComparison.primaryLabel}; FPS is ${runtimeComparison.primaryLabel}/${runtimeComparison.referenceLabel} and work p95 is ${runtimeComparison.referenceLabel}/${runtimeComparison.primaryLabel}:`,
      "",
      `| Scenario | FPS ratio | Work p95 ratio | ${runtimeComparison.primaryLabel} FPS | ${runtimeComparison.referenceLabel} FPS | ${runtimeComparison.primaryLabel} work p95 | ${runtimeComparison.referenceLabel} work p95 |`,
      "|---|---:|---:|---:|---:|---:|---:|",
      ...runtimeComparison.rows.map((row) => `| ${row.map(markdownEscape).join(" | ")} |`),
    ]),
    "",
    "Full generated benchmark details: [docs/benchmarks.md](docs/benchmarks.md).",
    "",
    `Command: \`${report.command}\``, 
    performanceEndMarker,
  ].join("\n");
}

function formatReadyCell(scenario, libraryId, highlightBest = false) {
  const result = scenario.results.find((entry) => entry.library === libraryId);
  if (!result) return "—";
  if (!result.ok) return "failed";
  const value = result.readyMs;
  const best = highlightBest ? bestResultValue(scenario, (entry) => entry.readyMs, "min") : undefined;
  return formatMaybeBestNumber(value, 1, best);
}

function formatMeasurementCell(scenario, libraryId, metric, highlightBest = false) {
  const result = scenario.results.find((entry) => entry.library === libraryId);
  if (!result) return "—";
  if (!result.ok) return "failed";
  const value = measurementMetricValue(result, metric);
  const best = highlightBest ? bestResultValue(scenario, (entry) => measurementMetricValue(entry, metric), measurementMetricDirection(metric)) : undefined;
  return formatMaybeBestNumber(value, measurementMetricDigits(metric), best);
}

function measurementMetricValue(result, metric) {
  const measurement = result.measurement;
  if (!measurement) return undefined;
  if (metric === "rafFps") return measurement.rafFps;
  if (metric === "rafP95") return measurement.rafFrameMs?.p95;
  if (metric === "workP50") return workSummary(result)?.p50;
  if (metric === "workP95") return workSummary(result)?.p95;
  return undefined;
}

function measurementMetricDirection(metric) {
  return metric === "rafFps" ? "max" : "min";
}

function measurementMetricDigits(metric) {
  return metric === "rafFps" ? 1 : 2;
}

function bestResultValue(scenario, valueForResult, direction) {
  const values = scenario.results
    .filter((result) => result.ok)
    .map(valueForResult)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return undefined;
  return direction === "max" ? Math.max(...values) : Math.min(...values);
}

function formatMaybeBestNumber(value, digits, best) {
  const formatted = formatNumber(value, digits);
  return isBestValue(value, best, digits) ? `**${formatted}**` : formatted;
}

function isBestValue(value, best, digits) {
  return typeof value === "number" && typeof best === "number" && Number.isFinite(value) && Number.isFinite(best) && value.toFixed(digits) === best.toFixed(digits);
}

function runtimeComparisonTables(report) {
  return runtimeComparisonPairs
    .map(({ primaryLibrary, referenceLibrary }) => runtimeComparisonTable(report, primaryLibrary, referenceLibrary))
    .filter((table) => table.rows.length > 0);
}

function runtimeComparisonTable(report, primaryLibraryId, referenceLibraryId) {
  return {
    primaryLabel: libraryDisplayName(report, primaryLibraryId),
    referenceLabel: libraryDisplayName(report, referenceLibraryId),
    rows: runtimeComparisonRows(report, primaryLibraryId, referenceLibraryId),
  };
}

function runtimeComparisonRows(report, primaryLibraryId, referenceLibraryId) {
  return report.scenarios
    .filter((scenario) => scenario.operation !== "static")
    .flatMap((scenario) => {
      const primary = scenario.results.find((entry) => entry.library === primaryLibraryId);
      const reference = scenario.results.find((entry) => entry.library === referenceLibraryId);
      const primaryMeasurement = primary?.measurement;
      const referenceMeasurement = reference?.measurement;
      const primaryWork = primary ? workSummary(primary) : undefined;
      const referenceWork = reference ? workSummary(reference) : undefined;
      if (!primary?.ok || !reference?.ok || !primaryMeasurement || !referenceMeasurement || !primaryWork || !referenceWork) return [];
      return [[
        scenario.name,
        formatRatio(primaryMeasurement.rafFps / referenceMeasurement.rafFps),
        formatRatio(referenceWork.p95 / primaryWork.p95),
        formatNumber(primaryMeasurement.rafFps, 1),
        formatNumber(referenceMeasurement.rafFps, 1),
        formatNumber(primaryWork.p95, 2),
        formatNumber(referenceWork.p95, 2),
      ]];
    });
}

function libraryDisplayName(report, libraryId) {
  return report.libraries?.[libraryId]?.name ?? libraryId;
}

function workSummary(result) {
  return result.measurement?.chartFrameMs ?? result.measurement?.updateMs;
}

function formatRatio(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? `${formatNumber(value, 2)}×` : "—";
}

function assertPublishableComparisonReport(report) {
  const scenarioNames = new Set(report.scenarios?.map((scenario) => scenario.name) ?? []);
  const libraryNames = new Set(report.options?.libraries ?? Object.keys(report.libraries ?? {}));
  const missingScenarios = officialComparisonScenarios.filter((scenario) => !scenarioNames.has(scenario));
  const missingLibraries = officialComparisonLibraries.filter((library) => !libraryNames.has(library));
  const failures = report.scenarios?.flatMap((scenario) => scenario.results
    .filter((result) => !result.ok)
    .map((result) => `${scenario.name}/${result.library}`)) ?? [];
  const warnings = report.warnings ?? [];
  if (report.publishable !== true || warnings.length > 0 || failures.length > 0 || missingScenarios.length > 0 || missingLibraries.length > 0) {
    const details = [
      report.publishable !== true ? "publishable is not true" : "",
      warnings.length > 0 ? `warnings: ${warnings.join("; ")}` : "",
      failures.length > 0 ? `failed runs: ${failures.join(", ")}` : "",
      missingScenarios.length > 0 ? `missing official scenarios: ${missingScenarios.join(", ")}` : "",
      missingLibraries.length > 0 ? `missing official libraries: ${missingLibraries.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`benchmarks/latest.json is not a publishable headed comparison benchmark (${details}). Re-run \`bun run bench:compare\` on the official machine with a real GPU, or remove the file to generate README without comparison numbers.`);
  }
}

function formatNumber(value, digits) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function integer(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
}

function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const gib = 1024 * 1024 * 1024;
  if (value >= gib) return `${(value / gib).toFixed(1)} GiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatNullableBytes(value) {
  return typeof value === "number" ? formatBytes(value) : "—";
}

function collectCoreRuntimeSize() {
  const files = [
    "dist/index.js",
    ...findDistFiles(/^Chart-.*\.js$/),
    ...findDistFiles(/^(RingBuffer|UniformRingBuffer)-.*\.js$/),
    ...findDistFiles(/^OhlcDataset-.*\.js$/),
    ...findDistFiles(/^AxisController-.*\.js$/),
    ...findDistFiles(/^WebGL2Backend-.*\.js$/),
  ];
  const buffers = files.map((file) => readFileSync(resolve(root, file)));
  return {
    rawBytes: files.reduce((sum, file) => sum + statSync(resolve(root, file)).size, 0),
    gzipBytes: gzipSync(Buffer.concat(buffers)).length,
  };
}

function findDistFiles(pattern) {
  const files = execFileSync("node", ["-e", "const {readdirSync}=require('fs'); console.log(readdirSync('dist').join('\\n'))"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((file) => pattern.test(file))
    .map((file) => `dist/${file}`);
  if (files.length !== 1) throw new Error(`Expected exactly one dist file matching ${pattern}, found ${files.length}.`);
  return files;
}

function formatKiB(bytes) {
  return `${Math.round(bytes / 1024)} KiB`;
}

function replaceBlock(content, startMarker, endMarker, block, label) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${label} generated markers were not found.`);
  }
  const before = content.slice(0, start);
  const after = content.slice(end + endMarker.length);
  return `${before}${block}${after}`;
}

const apiGeneratedBlock = renderGeneratedDocs({ guideBasePath: "." });
const apiGenerated = apiGeneratedBlock
  .replace(docsStartMarker, "")
  .replace(docsEndMarker, "")
  .trim();

const nextApi = `${apiGenerated}\n`;
const nextBenchmarkDocs = `${renderBenchmarkComparisonDocs().trimEnd()}\n`;
let nextReadme = existsSync(readmePath) ? readFileSync(readmePath, "utf-8") : "";
if (nextReadme) {
  const readmeGeneratedBlock = renderGeneratedDocs({ guideBasePath: "docs" });
  if (!nextReadme.includes(performanceStartMarker)) {
    nextReadme = nextReadme.replace(/^## Performance[\s\S]*?\n## Installation/m, `${performanceStartMarker}\n## Performance\n\n${performanceEndMarker}\n\n## Installation`);
  }
  nextReadme = replaceBlock(nextReadme, performanceStartMarker, performanceEndMarker, renderPerformanceBlock(), "README performance");
  nextReadme = replaceBlock(nextReadme, docsStartMarker, docsEndMarker, readmeGeneratedBlock, "README docs");
}

if (check) {
  const currentApi = readFileSync(apiReferencePath, "utf8");
  const currentBenchmarkDocs = existsSync(benchmarkDocsPath) ? readFileSync(benchmarkDocsPath, "utf8") : "";
  const currentReadme = readFileSync(readmePath, "utf8");
  const stale = [];
  if (currentApi !== nextApi) stale.push("docs/api-reference.md");
  if (currentBenchmarkDocs !== nextBenchmarkDocs) stale.push("docs/benchmarks.md");
  if (currentReadme !== nextReadme) stale.push("README.md");
  if (stale.length > 0) {
    console.error(`${stale.join(", ")} is stale. Run \`bun run docs:readme\`.`);
    process.exit(1);
  }
  console.log("Generated README/API/benchmark docs are fresh.");
} else {
  writeFileSync(apiReferencePath, nextApi);
  writeFileSync(benchmarkDocsPath, nextBenchmarkDocs);
  if (nextReadme) writeFileSync(readmePath, nextReadme);
  console.log("Generated docs/api-reference.md from TypeScript declarations.");
  console.log("Generated docs/benchmarks.md from latest benchmark results.");
  console.log("Updated README generated docs and performance sections.");
}
