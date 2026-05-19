#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);
const readmePath = resolve(root, "README.md");
const packagePath = resolve(root, "package.json");
const distIndexPath = resolve(root, "dist/index.d.ts");

const startMarker = "<!-- README_DOCS_START -->";
const endMarker = "<!-- README_DOCS_END -->";

const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
let readme = readFileSync(readmePath, "utf-8");

if (!existsSync(distIndexPath)) {
  throw new Error("dist/index.d.ts not found. Run `bun run build` before generating README docs.");
}

const exportDescriptions = new Map([
  [".", "Core chart, data, interaction, rendering types, and low-level primitives."],
  ["./react", "React wrapper component and hooks."],
  ["./linked", "Linked chart layout helpers."],
  ["./export", "Screenshot download and clipboard helpers."],
  ["./plugins/interactions", "Built-in pan, zoom, axis interaction, and reset plugin."],
  ["./plugins/legend", "Built-in legend plugin."],
  ["./plugins/tooltip", "Built-in tooltip plugin."],
  ["./plugins/annotations", "Built-in annotation overlay plugin."],
  ["./plugins/selection", "Built-in brush/range selection plugin."],
  ["./plugins/crosshair", "Built-in crosshair and ruler plugin."],
  ["./plugins/navigator", "Built-in overview/navigator plugin."],
]);

const keySymbols = [
  "Chart",
  "ChartOptions",
  "ChartTheme",
  "AxisConfig",
  "SeriesStore",
  "SeriesConfig",
  "SeriesStyle",
  "UniformRingBuffer",
  "RingBuffer",
  "StaticDataset",
  "OhlcRingBuffer",
  "Dataset",
  "AcceleratedDataset",
  "ViewportPolicy",
];

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

function renderPublicExports(exports) {
  const rows = exports.map((entry) => {
    const summary = entry.summary || "—";
    return `| ${code(entry.name)} | ${entry.kind} | ${code(entry.source)} | ${markdownEscape(summary)} |`;
  });

  return [
    "### All public exports",
    "",
    "<details>",
    "<summary>Generated from <code>dist/index.d.ts</code> after the package build</summary>",
    "",
    "| Export | Kind | Source | JSDoc summary |",
    "|---|---|---|---|",
    ...rows,
    "",
    "</details>",
  ].join("\n");
}

function paramsText(parameters, source) {
  return parameters.map((param) => nodeText(param, source)).join(", ");
}

function hasModifier(node, kind) {
  return !!node.modifiers?.some((modifier) => modifier.kind === kind);
}

function isPublicMember(member) {
  return !hasModifier(member, ts.SyntaxKind.PrivateKeyword) && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword);
}

function memberName(member, source) {
  if (ts.isConstructorDeclaration(member)) return "constructor";
  const name = member.name;
  if (!name) return "";
  return nodeText(name, source);
}

function memberSignature(member, source) {
  if (ts.isConstructorDeclaration(member)) return `constructor(${paramsText(member.parameters, source)})`;
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
    const name = memberName(member, source);
    const typeParams = member.typeParameters?.length ? `<${member.typeParameters.map((param) => nodeText(param, source)).join(", ")}>` : "";
    const ret = member.type ? nodeText(member.type, source) : "void";
    return `${name}${typeParams}(${paramsText(member.parameters, source)}): ${ret}`;
  }
  if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
    const opt = member.questionToken ? "?" : "";
    const type = member.type ? nodeText(member.type, source) : "unknown";
    return `${memberName(member, source)}${opt}: ${type}`;
  }
  if (ts.isGetAccessorDeclaration(member)) {
    const type = member.type ? nodeText(member.type, source) : "unknown";
    return `get ${memberName(member, source)}(): ${type}`;
  }
  if (ts.isSetAccessorDeclaration(member)) {
    return `set ${memberName(member, source)}(${paramsText(member.parameters, source)})`;
  }
  return nodeText(member, source);
}

function renderMembers(entry) {
  const declaration = entry.declaration;
  if (!declaration) return "";
  const { node, source } = declaration;
  if (!((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.members.length > 0)) return "";

  const rows = node.members
    .filter(isPublicMember)
    .map((member) => {
      const signature = memberSignature(member, source);
      if (!signature) return "";
      return `| ${code(signature)} | ${markdownEscape(jsDoc(member) || "—")} |`;
    })
    .filter(Boolean);

  if (rows.length === 0) return "";
  return [
    `<details>`,
    `<summary>${entry.kind} ${entry.name}</summary>`,
    "",
    "| Member |",
    "|---|",
    ...rows.map((row) => row.replace(/ \| — \|$/, " |")),
    "",
    `</details>`,
  ].join("\n");
}

function renderKeyDeclarations(exports) {
  const byName = new Map(exports.map((entry) => [entry.name, entry]));
  const sections = keySymbols
    .map((name) => byName.get(name))
    .filter(Boolean)
    .map(renderMembers)
    .filter(Boolean);

  if (sections.length === 0) return "";
  return [
    "### Selected generated declarations",
    "",
    "These member tables are generated from TypeScript declarations.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

function renderGeneratedDocs() {
  const publicExports = collectPublicExports();
  const selectedDeclarations = renderKeyDeclarations(publicExports);
  const parts = [
    startMarker,
    "## API reference",
    "",
    "This section is generated by `bun run docs:readme` from TypeScript declaration files and JSDoc comments. Do not edit it by hand.",
    "",
    "- [Quick start](#quick-start)",
    "- [Features](#features)",
    "- [Architecture](#architecture)",
    "- [Development](#development)",
    "- [Plugin authoring](docs/plugin-authoring.md)",
    "- [Theming and responsive layout](docs/theming-and-layout.md)",
    "- [Performance recipes](docs/performance-recipes.md)",
    "- [Data semantics](docs/data-semantics.md)",
    "- [Versioning and migration](docs/versioning-and-migration.md)",
    "- [Browser and dependency support](docs/browser-support.md)",
    "- [Example recipes](docs/examples.md)",
    "- [Roadmap](ROADMAP.md)",
    `- [Changelog for v${pkg.version}](changelogs/v${pkg.version}.md)`,
    "",
    renderEntrypoints(),
  ];
  if (selectedDeclarations) parts.push("", selectedDeclarations);
  parts.push("", renderPublicExports(publicExports));
  parts.push(endMarker);
  return parts.join("\n");
}

const generated = renderGeneratedDocs();
const start = readme.indexOf(startMarker);
const end = readme.indexOf(endMarker);

if (start !== -1 && end !== -1 && end > start) {
  readme = `${readme.slice(0, start)}${generated}${readme.slice(end + endMarker.length)}`;
} else {
  const insertBefore = readme.indexOf("\n## Development\n");
  if (insertBefore === -1) {
    throw new Error("Could not find README Development section to insert generated documentation block before.");
  }
  readme = `${readme.slice(0, insertBefore)}\n${generated}\n${readme.slice(insertBefore)}`;
}

writeFileSync(readmePath, readme.endsWith("\n") ? readme : `${readme}\n`);
console.log("Generated README documentation section from TypeScript declarations.");
