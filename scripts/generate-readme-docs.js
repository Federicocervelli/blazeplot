#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);
const apiReferencePath = resolve(root, "docs/api-reference.md");
const readmePath = resolve(root, "README.md");
const packagePath = resolve(root, "package.json");
const distIndexPath = resolve(root, "dist/index.d.ts");

const startMarker = "<!-- README_DOCS_START -->";
const endMarker = "<!-- README_DOCS_END -->";

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
]);

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

function nodeText(node, source) {
  return markdownEscape(printer.printNode(ts.EmitHint.Unspecified, node, source));
}

function jsDoc(node) {
  const docs = node.jsDoc;
  if (!docs || docs.length === 0) return "";
  return docs
    .map((doc) => typeof doc.comment === "string" ? doc.comment : "")
    .filter(Boolean)
    .join(" ")
    .trim();
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

function renderEntrypoints() {
  const rows = Object.keys(pkg.exports ?? {})
    .filter((key) => key !== "./package.json")
    .map((key) => `| ${code(packageEntryName(key))} | ${exportDescriptions.get(key) ?? "Package subpath export."} |`);

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

function renderGuideLinks(basePath) {
  const prefix = basePath ? `${basePath.replace(/\/$/, "")}/` : "";
  return [
    `[Overview](${prefix}overview.md)`,
    `[Examples](${prefix}examples.md)`,
    `[Data semantics](${prefix}data-semantics.md)`,
    `[Performance recipes](${prefix}performance-recipes.md)`,
    `[Built-in plugins](${prefix}built-in-plugins.md)`,
    `[Plugin authoring](${prefix}plugin-authoring.md)`,
    `[Theming and layout](${prefix}theming-and-layout.md)`,
    `[Troubleshooting](${prefix}troubleshooting.md)`,
    `[Roadmap](${prefix}roadmap.md)`,
  ].join(", ");
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
    "| Create and render a chart | `Chart`, `ChartOptions`, `chart.addLine(...)`, `chart.fitToData()`, `chart.start()` |",
    "| Static X/Y arrays | `StaticDataset` |",
    "| Live irregular data | `RingBuffer` |",
    "| Live fixed-rate data | `UniformRingBuffer` |",
    "| OHLC/candlesticks | `StaticOhlcDataset`, `OhlcRingBuffer`, `chart.addOhlc(...)`, `chart.addCandlestick(...)` |",
    "| Custom high-performance data | `Dataset`, `AcceleratedDataset`, range/copy dataset interfaces |",
    "| Pan/zoom and user interaction | `blazeplot/plugins/interactions`, `Camera2D`, viewport APIs |",
    "| Tooltips, legends, annotations, selection | `blazeplot/plugins/*` subpaths |",
    "| React | `blazeplot/react` and `BlazeChart` |",
    "| Linked dashboards | `blazeplot/linked` or `blazeplot/linked-core` |",
    "| Image/data export | `chart.screenshot()`, `blazeplot/export`, `blazeplot/data` |",
    "",
    `Guides: ${renderGuideLinks(guideBasePath)}.`,
  ].join("\n");

  const parts = [
    startMarker,
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
  parts.push(endMarker);
  return parts.join("\n");
}

const apiGeneratedBlock = renderGeneratedDocs({ guideBasePath: "." });
const apiGenerated = apiGeneratedBlock
  .replace(startMarker, "")
  .replace(endMarker, "")
  .trim();

writeFileSync(apiReferencePath, `${apiGenerated}\n`);
if (existsSync(readmePath)) {
  const readmeGeneratedBlock = renderGeneratedDocs({ guideBasePath: "docs" });
  const readme = readFileSync(readmePath, "utf-8");
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("README generated docs markers were not found.");
  }
  const before = readme.slice(0, start);
  const after = readme.slice(end + endMarker.length);
  writeFileSync(readmePath, `${before}${readmeGeneratedBlock}${after}`);
}
console.log("Generated docs/api-reference.md from TypeScript declarations.");
console.log("Updated README generated docs section.");
