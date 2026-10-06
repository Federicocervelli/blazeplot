#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Snippet {
  sourcePath: string;
  index: number;
  language: "ts" | "tsx";
  code: string;
}

interface SkippedSnippet {
  sourcePath: string;
  index: number;
  reason: string;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const docsDir = resolve(root, "docs");
// A fenced ts/tsx block, optionally preceded (ignoring blank lines) by a skip marker.
const snippetFence = /(?:<!--\s*snippet:\s*([^>]*?)\s*-->[ \t]*\r?\n(?:[ \t]*\r?\n)*)?```(ts|typescript|tsx)[ \t]*\r?\n([\s\S]*?)```/g;
const anyMarker = /<!--\s*snippet:/g;

/**
 * Ambient context that docs snippets may rely on without declaring it. Every
 * name here is a conventional placeholder (`chart`, `element`, sample data) so
 * narrative fragments stay short. Keep this list in sync with the "Snippet
 * typechecking" section of docs/documentation-contributions.md. A snippet that
 * declares its own binding with the same name shadows the ambient one.
 */
const prelude = `
declare const element: HTMLElement;
declare const container: HTMLElement;
declare const canvas: HTMLCanvasElement;
declare const chart: import("blazeplot").Chart;
declare const series: import("blazeplot").SeriesStore;
declare const dataset: import("blazeplot").UniformRingBuffer;
`;

async function main(): Promise<void> {
  if (!existsSync(join(root, "dist", "index.d.ts"))) {
    throw new Error("dist/ declarations are missing. Run `bun run build` first: snippets are checked against the published declarations.");
  }
  const { snippets, skipped, total } = await collectSnippets();
  if (snippets.length === 0) throw new Error("No TypeScript documentation snippets found.");

  // The scratch project lives under build/ (gitignored) so snippets resolve
  // `react` and friends from the repository's node_modules.
  mkdirSync(join(root, "build"), { recursive: true });
  const temp = mkdtempSync(join(root, "build", "doc-snippets-"));
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
    for (const skip of skipped) console.log(`Skipped ${skip.sourcePath} snippet ${skip.index}: ${skip.reason}`);
    console.log(`Typechecked ${snippets.length} of ${total} documentation TypeScript snippets (${skipped.length} explicitly skipped).`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function collectSnippets(): Promise<{ snippets: Snippet[]; skipped: SkippedSnippet[]; total: number }> {
  const files = [resolve(root, "README.md"), ...(await markdownFiles(docsDir))];
  const snippets: Snippet[] = [];
  const skipped: SkippedSnippet[] = [];
  let total = 0;
  for (const file of files) {
    // Four-backtick fences hold literal markdown (for example the skip-marker example
    // in docs/documentation-contributions.md), not snippets.
    const markdown = (await readFile(file, "utf8")).replace(/^````[\s\S]*?^````/gm, "");
    const sourcePath = relative(root, file).replaceAll("\\", "/");
    const markerCount = markdown.match(anyMarker)?.length ?? 0;
    let usedMarkers = 0;
    let index = 0;
    for (const match of markdown.matchAll(snippetFence)) {
      index += 1;
      total += 1;
      const marker = match[1];
      const language = match[2] === "tsx" ? "tsx" : "ts";
      const code = match[3]?.trim() ?? "";
      if (marker !== undefined) {
        usedMarkers += 1;
        const parsed = /^skip\s+(\S[\s\S]*)$/.exec(marker);
        if (!parsed) throw new Error(`${sourcePath} snippet ${index}: use "<!-- snippet: skip <reason> -->" with a non-empty reason.`);
        skipped.push({ sourcePath, index, reason: parsed[1]!.trim() });
        continue;
      }
      if (!code) throw new Error(`${sourcePath} snippet ${index}: empty TypeScript snippet.`);
      snippets.push({ sourcePath, index, language, code });
    }
    if (usedMarkers !== markerCount) {
      throw new Error(`${sourcePath}: a "<!-- snippet: ... -->" marker is not directly followed by a ts/tsx code fence.`);
    }
  }
  return { snippets, skipped, total };
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

function writeSnippetProject(temp: string, snippets: readonly Snippet[]): void {
  const files: string[] = [];
  snippets.forEach((snippet, i) => {
    const safeName = `${String(i + 1).padStart(3, "0")}-${basename(snippet.sourcePath, ".md")}-${snippet.index}.${snippet.language}`;
    files.push(safeName);
    writeFileSync(join(temp, safeName), renderSnippet(snippet), "utf8");
  });

  writeFileSync(join(temp, "env.d.ts"), `declare module "*?raw" { const value: string; export default value; }\n${prelude}`, "utf8");

  writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      paths: publishedEntryPaths(),
    },
    files: ["env.d.ts", ...files],
  }, null, 2));
}

/**
 * Maps every public `blazeplot` specifier to its built declaration file, using
 * `package.json#exports` as the source of truth. Subpaths that are not exported
 * (removed entries, internal modules) therefore fail to resolve in snippets.
 */
function publishedEntryPaths(): Record<string, string[]> {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, { types?: string } | string>;
  };
  const paths: Record<string, string[]> = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === "string" || !target.types) continue;
    const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, "")}`;
    paths[specifier] = [resolve(root, target.types)];
  }
  return paths;
}

function renderSnippet(snippet: Snippet): string {
  return `// ${snippet.sourcePath} snippet ${snippet.index}\nexport {};\n\n${snippet.code}\n`;
}

await main();
