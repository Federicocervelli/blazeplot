#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);
const apiReferencePath = resolve(root, "docs/api-reference.md");
const readmePath = resolve(root, "README.md");
const packagePath = resolve(root, "package.json");
const distIndexPath = resolve(root, "dist/index.d.ts");
const docsPagesPath = resolve(root, "docs/pages.json");
const performanceBaselinePath = resolve(root, "docs/performance-baseline.json");

const docsStartMarker = "<!-- README_DOCS_START -->";
const docsEndMarker = "<!-- README_DOCS_END -->";
const performanceStartMarker = "<!-- README_PERFORMANCE_START -->";
const performanceEndMarker = "<!-- README_PERFORMANCE_END -->";

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const checkExportDescriptions = args.has("--check-export-descriptions");

const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

if (!existsSync(distIndexPath)) {
  throw new Error("dist/index.d.ts not found. Run `bun run build` before generating README docs.");
}

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
  const baseline = JSON.parse(readFileSync(performanceBaselinePath, "utf8"));
  const core = collectCoreRuntimeSize();
  const size = `${formatKiB(core.rawBytes)} raw / ${formatKiB(core.gzipBytes)} gzip`;
  const first = baseline.firstFrame;
  const rows = [
    `| **BlazePlot** | ${pkg.version} | **${size}** | **${first.renderMedianMs} ms render** (${first.setupMedianMs} ms setup) |`,
    ...baseline.competitors.map((entry) => `| ${entry.library} | ${entry.version} | ${entry.size} | ${entry.firstDraw} |`),
  ];
  const references = [
    "BlazePlot — [this release build](https://github.com/Federicocervelli/blazeplot) and local benchmark",
    ...baseline.competitors.map((entry) => `${entry.library} — [${entry.version}](${entry.reference})`),
  ].join(". ");

  return [
    performanceStartMarker,
    "## Performance",
    "",
    `The core chart runtime is intentionally compact: the production build for \`blazeplot\` (without optional plugins) is about **${size}**. Optional plugins and helpers ship as separate subpath entries.`,
    "",
    `A minimal ${first.sampleCount.toLocaleString("en-US")}-point line chart renders its first frame in about **${first.renderMedianMs} ms median / ${first.renderP95Ms} ms p95** of render work (${first.canvas} canvas, ${first.browser}, ${first.renderer}). Chart construction and WebGL setup takes about **${first.setupMedianMs} ms median**.`,
    "",
    "Size and first-draw comparison (vendor-published figures, best value bolded):",
    "",
    "| Library | Version | Size | First draw |",
    "|---|---:|---:|---:|",
    ...rows,
    "",
    `References: ${references}.`,
    performanceEndMarker,
  ].join("\n");
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
  const currentReadme = readFileSync(readmePath, "utf8");
  const stale = [];
  if (currentApi !== nextApi) stale.push("docs/api-reference.md");
  if (currentReadme !== nextReadme) stale.push("README.md");
  if (stale.length > 0) {
    console.error(`${stale.join(", ")} is stale. Run \`bun run docs:readme\`.`);
    process.exit(1);
  }
  console.log("Generated README/API docs are fresh.");
} else {
  writeFileSync(apiReferencePath, nextApi);
  if (nextReadme) writeFileSync(readmePath, nextReadme);
  console.log("Generated docs/api-reference.md from TypeScript declarations.");
  console.log("Updated README generated docs and performance sections.");
}
