#!/usr/bin/env bun
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

interface Snippet {
  sourcePath: string;
  index: number;
  code: string;
}

const root = resolve(new URL("..", import.meta.url).pathname);
const docsDir = resolve(root, "docs");
const snippetFence = /```(?:ts|typescript)\s*\n([\s\S]*?)```/g;

const skipPatterns = [
  /import\.meta/,
];

async function main(): Promise<void> {
  const snippets = await collectSnippets();
  if (snippets.length === 0) throw new Error("No TypeScript documentation snippets found.");

  const temp = mkdtempSync(join(tmpdir(), "blazeplot-doc-snippets-"));
  try {
    writeSnippetProject(temp, snippets);
    const proc = Bun.spawnSync(["bunx", "tsc", "-p", join(temp, "tsconfig.json")], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      process.stderr.write(proc.stdout.toString());
      process.stderr.write(proc.stderr.toString());
      process.exit(proc.exitCode);
    }
    console.log(`Typechecked ${snippets.length} documentation TypeScript snippets.`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function collectSnippets(): Promise<Snippet[]> {
  const files = [resolve(root, "README.md"), ...(await markdownFiles(docsDir))];
  const snippets: Snippet[] = [];
  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    let index = 0;
    for (const match of markdown.matchAll(snippetFence)) {
      index += 1;
      const code = match[1]?.trim() ?? "";
      if (!code || code.includes("@blazeplot-docs-skip-typecheck") || skipPatterns.some((pattern) => pattern.test(code))) continue;
      // Many guide snippets are intentionally partial continuations. Typecheck
      // complete API snippets that import BlazePlot and declare their own setup
      // so renamed public exports are caught without forcing every narrative
      // fragment to become standalone.
      if (!/from\s+["']blazeplot(?:\/[^"']*)?["']/.test(code)) continue;
      if (referencesImplicitExampleContext(code)) continue;
      snippets.push({ sourcePath: relative(root, file), index, code });
    }
  }
  return snippets;
}

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "internal") continue;
      files.push(...await markdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files.sort();
}

function referencesImplicitExampleContext(code: string): boolean {
  const implicitNames = [
    "element",
    "dashboardElement",
    "chart",
    "x",
    "high",
    "low",
    "socket",
    "priceSeries",
    "bucketStarts",
    "bucketEnds",
    "bucketMins",
    "bucketMaxes",
    "priceDataset",
    "volumeDataset",
    "latencyDataset",
    "requestDataset",
    "renderStaticFallback",
    "showUnsupportedBrowserMessage",
  ];
  return implicitNames.some((name) => new RegExp(`\\b${name}\\b`).test(code) && !new RegExp(`(?:const|let|var|function)\\s+${name}\\b`).test(code));
}

function writeSnippetProject(temp: string, snippets: readonly Snippet[]): void {
  const files: string[] = [];
  snippets.forEach((snippet, i) => {
    const safeName = `${String(i + 1).padStart(3, "0")}-${basename(snippet.sourcePath, ".md")}-${snippet.index}.ts`;
    files.push(safeName);
    writeFileSync(join(temp, safeName), renderSnippet(snippet), "utf8");
  });

  writeFileSync(join(temp, "env.d.ts"), 'declare module "*?raw" { const value: string; export default value; }\n', "utf8");

  writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      paths: {
        blazeplot: [join(root, "src/index.ts")],
        "blazeplot/core": [join(root, "src/core/index.ts")],
        "blazeplot/interaction": [join(root, "src/interaction/index.ts")],
        "blazeplot/render": [join(root, "src/render/index.ts")],
        "blazeplot/linked": [join(root, "src/linked.ts")],
        "blazeplot/linked-core": [join(root, "src/linked-core.ts")],
        "blazeplot/data": [join(root, "src/data.ts")],
        "blazeplot/export": [join(root, "src/export.ts")],
        "blazeplot/plugins/*": [join(root, "src/plugins/*.ts")],
      },
    },
    files: ["env.d.ts", ...files],
  }, null, 2));
}

function renderSnippet(snippet: Snippet): string {
  return `// ${snippet.sourcePath} snippet ${snippet.index}\nexport {};\n\n${snippet.code}\n`;
}

await main();
