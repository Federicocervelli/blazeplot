#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "@typescript/typescript6";
import { REPORT_SCHEMA_VERSION, readmeSummaryLines, renderReportMarkdown } from "./benchmark-compare-report.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const apiReferencePath = resolve(root, "docs/api-reference.md");
const benchmarkDocsPath = resolve(root, "docs/benchmarks.md");
const readmePath = resolve(root, "README.md");
const packagePath = resolve(root, "package.json");
const distIndexPath = resolve(root, "dist/index.d.ts");
const docsPagesPath = resolve(root, "docs/pages.json");
const comparisonBenchmarkPath = resolve(root, "benchmarks/latest.json");
const baselineBenchmarkPath = resolve(root, "benchmarks/baseline-before-perf-pass.json");

const docsStartMarker = "<!-- README_DOCS_START -->";
const docsEndMarker = "<!-- README_DOCS_END -->";
const performanceStartMarker = "<!-- README_PERFORMANCE_START -->";
const performanceEndMarker = "<!-- README_PERFORMANCE_END -->";
const officialComparisonConfig = JSON.parse(readFileSync(resolve(root, "scripts/benchmark-config.json"), "utf-8"));
const officialComparisonLibraries = officialComparisonConfig.libraries;
const officialComparisonScenarios = officialComparisonConfig.scenarios.map((scenario) => scenario.name);

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const checkExportDescriptions = args.has("--check-export-descriptions");

const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

const exportDescriptions = new Map([
  [".", "Chart, datasets, data contracts, theming, and renderer selection."],
  ["./linked", "Multi-panel layouts with shared X and per-panel plugins."],
  ["./data", "Pure, chart-agnostic data transforms (binning, rolling mean)."],
  ["./export", "Chart data export (CSV/JSON-ready rows) and screenshot download/clipboard helpers."],
  ["./plugins/interactions", "Built-in pan, zoom, axis interaction, and reset plugin."],
  ["./plugins/legend", "Built-in legend plugin."],
  ["./plugins/tooltip", "Built-in tooltip plugin."],
  ["./plugins/annotations", "Built-in annotation overlay plugin."],
  ["./plugins/selection", "Built-in brush/range selection plugin."],
  ["./plugins/crosshair", "Built-in crosshair and ruler plugin."],
  ["./plugins/navigator", "Built-in overview/navigator plugin."],
  ["./plugins/flamegraph", "Built-in flame graph and status-span plugin."],
  ["./plugins/a11y", "Built-in accessibility plugin: hidden data table, keyboard inspection cursor, live summary."],
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

function renderReadmeDocs() {
  return [
    docsStartMarker,
    "## Documentation",
    "",
    `Guides: ${renderGuideLinks("docs")}.`,
    "",
    renderEntrypoints(),
    "",
    "Every public export (with kind and summary) and the per-chunk bundle sizes are listed in the [API reference](docs/api-reference.md).",
    docsEndMarker,
  ].join("\n");
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
    "| Create and render a chart | `new Chart(...)`, `chart.addLine(...)`, `chart.fitToData()`, and `chart.start()` |",
    "| Static X/Y arrays or object rows | `StaticDataset`, `StaticDataset.fromObjects(...)` |",
    "| Live irregular data | `chart.addLine({ capacity })`, `RingBuffer`, [Live data](" + guideLink(guideBasePath, "live-data.md") + ") |",
    "| Live fixed-rate data | `chart.addLine({ capacity, xStep })`, `UniformRingBuffer`, [Live data](" + guideLink(guideBasePath, "live-data.md") + ") |",
    "| OHLC/candlesticks | `StaticOhlcDataset`, `OhlcRingBuffer`, `chart.addOhlc(...)`, `chart.addCandlestick(...)` |",
    "| Custom high-performance data | `Dataset`, `AcceleratedDataset`, range/copy dataset interfaces |",
    "| Pan/zoom and user interaction | `blazeplot/plugins/interactions`, `chart.setViewport(...)`, `ViewportPolicy` |",
    "| Tooltips, legends, annotations, selection, flame graphs | `blazeplot/plugins/*` subpaths |",
    "| React | Create and dispose `Chart` in an effect |",
    "| Linked dashboards | `blazeplot/linked` with `panelPlugins` |",
    "| Image/data export | `chart.screenshot()`, `blazeplot/export` |",
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
    "The bundle table lists emitted files after Vite code-splitting. Entry rows can be tiny stubs that load shared chunks; the README performance section reports the aggregate core runtime size.",
    "",
    renderBundleSizeSummary(),
  ];
  parts.push("", renderPublicExports(publicExports));
  parts.push(docsEndMarker);
  return parts.join("\n");
}

function renderPerformanceBlock() {
  const core = collectCoreRuntimeSize();
  const size = `${formatKiB(core.rawBytes)} raw`;
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

function loadBaselineReport() {
  if (!existsSync(baselineBenchmarkPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(baselineBenchmarkPath, "utf8"));
    return parsed.schemaVersion === REPORT_SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function renderBenchmarkComparisonDocs() {
  const header = [
    "<!-- This file is generated by scripts/generate-readme-docs.js from benchmarks/latest.json. Do not edit by hand. -->",
  ];

  if (!existsSync(comparisonBenchmarkPath)) {
    return [
      ...header,
      "# Benchmark comparisons",
      "",
      "Public comparison tables are generated only from a publishable headed benchmark run.",
      "",
      "Run `bun run bench:compare` on the official local machine, then run `bun run docs:readme` to regenerate this page from `benchmarks/latest.json`.",
      "",
    ].join("\n");
  }

  const report = JSON.parse(readFileSync(comparisonBenchmarkPath, "utf8"));
  assertPublishableComparisonReport(report);
  const body = renderReportMarkdown(report, {
    title: "# Benchmark comparisons",
    baseline: loadBaselineReport(),
    methodologyLink: "./internal/benchmarks.md",
  });
  return [
    ...header,
    body.replace("\nGenerated:", "\nThis page is generated from `benchmarks/latest.json`; do not edit benchmark numbers by hand. To update it, run `bun run bench:compare` and then `bun run docs:readme`.\n\nGenerated:"),
  ].join("\n");
}

function renderComparisonPerformanceBlock(report, size) {
  const { summary } = readmeSummaryLines(report);
  const date = typeof report.generatedAt === "string" ? report.generatedAt.slice(0, 10) : "unknown date";
  const machine = report.environment?.machine;
  const page = report.environment?.page;
  const browser = report.environment?.browser;

  return [
    performanceStartMarker,
    "## Performance",
    "",
    `The core runtime (\`import { Chart } from "blazeplot"\`, without optional plugins) is about **${size}**. Plugins and helpers ship as separate subpath entries.`,
    "",
    summary,
    "",
    `Measured ${date} on ${String(machine?.cpuModel ?? "local machine").trim()}, ${shortGpuName(page?.webglRenderer)}, ${browser?.product ?? page?.userAgent ?? "unknown browser"}, ${report.options?.runs ?? "?"} fresh-page runs per cell. The per-scenario tables, spreads, and every scenario where BlazePlot does not clearly win are in [docs/benchmarks.md](docs/benchmarks.md). Reproduce with \`bun run bench:compare\`.`,
    performanceEndMarker,
  ].join("\n");
}

function shortGpuName(renderer) {
  if (!renderer) return "unknown GPU";
  const match = /ANGLE \(([^,]+), ([^,/]+)/.exec(renderer);
  return match ? match[2].trim() : renderer;
}

function assertPublishableComparisonReport(report) {
  const scenarioNames = new Set(report.scenarios?.map((scenario) => scenario.name) ?? []);
  const libraryNames = new Set(report.options?.libraries ?? Object.keys(report.libraries ?? {}));
  const missingScenarios = officialComparisonScenarios.filter((scenario) => !scenarioNames.has(scenario));
  const missingLibraries = officialComparisonLibraries.filter((library) => !libraryNames.has(library));
  const failures = report.scenarios?.flatMap((scenario) => scenario.results
    .filter((result) => !result.ok && !result.skipped)
    .map((result) => `${scenario.name}/${result.library}`)) ?? [];
  const warnings = report.warnings ?? [];
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION || report.publishable !== true || warnings.length > 0 || failures.length > 0 || missingScenarios.length > 0 || missingLibraries.length > 0) {
    const details = [
      report.schemaVersion !== REPORT_SCHEMA_VERSION ? `schemaVersion is ${report.schemaVersion}, expected ${REPORT_SCHEMA_VERSION}` : "",
      report.publishable !== true ? "publishable is not true" : "",
      warnings.length > 0 ? `warnings: ${warnings.join("; ")}` : "",
      failures.length > 0 ? `failed runs: ${failures.join(", ")}` : "",
      missingScenarios.length > 0 ? `missing official scenarios: ${missingScenarios.join(", ")}` : "",
      missingLibraries.length > 0 ? `missing official libraries: ${missingLibraries.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`benchmarks/latest.json is not a publishable headed comparison benchmark (${details}). Re-run \`bun run bench:compare\` on the official machine with a real GPU, or remove the file to generate README without comparison numbers.`);
  }
}


/** Size of everything `import { Chart } from "blazeplot"` loads eagerly: dist/index.js plus its static import graph. */
function collectCoreRuntimeSize() {
  const files = staticImportClosure("dist/index.js");
  const buffers = files.map((file) => readFileSync(resolve(root, file)));
  return {
    rawBytes: buffers.reduce((sum, buffer) => sum + buffer.length, 0),
    gzipBytes: gzipSync(Buffer.concat(buffers)).length,
  };
}

function staticImportClosure(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(resolve(root, file), "utf8");
    // Static `import ... from "./x.js"` only; dynamic `import("./x.js")` chunks load lazily.
    for (const match of source.matchAll(/\bimport\s*(?:[\w$*{}\s,]*?\s*from\s*)?["'](\.\.?\/[^"']+)["']/g)) {
      pending.push(posix.join(posix.dirname(file), match[1]));
    }
  }
  return [...seen];
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
  const readmeGeneratedBlock = renderReadmeDocs();
  if (!nextReadme.includes(performanceStartMarker)) {
    nextReadme = nextReadme.replace(/^## Performance[\s\S]*?\n## Documentation/m, `${performanceStartMarker}\n## Performance\n\n${performanceEndMarker}\n\n## Documentation`);
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
