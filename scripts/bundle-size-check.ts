import { readdir } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { posix } from "node:path";

interface Budget {
  readonly label: string;
  readonly path: string;
  readonly maxBytes: number;
}

interface BundleSizeEntry extends Budget {
  readonly sizeBytes: number;
}

interface SharedChunkBudget {
  readonly label: string;
  readonly pattern: RegExp;
  readonly maxBytes: number;
}

interface SharedChunkResult {
  readonly budget: SharedChunkBudget;
  readonly entries: BundleSizeEntry[];
}

/** A budget for everything a consumer downloads to use one entry: the entry plus every chunk it imports statically. */
interface GraphBudget {
  readonly label: string;
  readonly entry: string;
  readonly maxBytes: number;
}

interface BundleSizeReport {
  readonly entryChunks: BundleSizeEntry[];
  readonly sharedChunks: SharedChunkResult[];
  readonly graphs: BundleSizeEntry[];
}

// Budgets are the built size plus about 1.5% (at least 100 bytes), rounded up to 100 bytes.
// Tighten them when a change shrinks a chunk; raise one only with a reason in the PR.
// Legend, navigator, and selection grew a little (+130 to +220 bytes) because each now ships its own forced-colors CSS; the core chunk shrank by the same rules.
const budgets: Budget[] = [
  { label: "root entry", path: "dist/index.js", maxBytes: 21_100 },
  { label: "linked entry", path: "dist/linked.js", maxBytes: 2_500 },
  { label: "data entry", path: "dist/data.js", maxBytes: 1_800 },
  { label: "export entry", path: "dist/export.js", maxBytes: 4_300 },
  { label: "interactions plugin", path: "dist/plugins/interactions.js", maxBytes: 15_200 }, // +100 for localizable hint messages
  { label: "annotations plugin", path: "dist/plugins/annotations.js", maxBytes: 15_400 }, // +200 for localizable annotation names
  { label: "navigator plugin", path: "dist/plugins/navigator.js", maxBytes: 10_300 }, // +100 for localizable label and value text
  { label: "selection plugin", path: "dist/plugins/selection.js", maxBytes: 8_800 },
  { label: "legend plugin", path: "dist/plugins/legend.js", maxBytes: 4_800 },
  { label: "tooltip plugin", path: "dist/plugins/tooltip.js", maxBytes: 4_300 },
  { label: "crosshair plugin", path: "dist/plugins/crosshair.js", maxBytes: 9_400 },
  { label: "flamegraph plugin", path: "dist/plugins/flamegraph.js", maxBytes: 17_700 },
  { label: "a11y plugin", path: "dist/plugins/a11y.js", maxBytes: 11_900 },
];

const sharedBudgets: SharedChunkBudget[] = [
  // 155_184 bytes in 1.0.0-rc.3 (plugin host, chart semantics, forced colors); 151_515 after #152; 140_448 after the Chart split and histogram tree-shaking (#172).
  // 169_000 bytes with render surfaces (the rect program, fillRects, createSurface; the flame graph no longer carries its own GLSL, so its entry shrank by about 4.7 KB). 166_315 bytes after the engines moved into the core graph: the default renderer is "auto", so the Chart always ships WebGL2 (the old 12 KB chunk, now inlined), Canvas 2D, and the shared WebGL2 context (about +15 KB over the 143_500 budget plus the separate WebGL2 chunk before).
  { label: "shared Chart chunk (Chart + every engine)", pattern: /^Chart-.*.js$/, maxBytes: 174_100 }, // +400 for the Canvas 2D pixel-column polyline reducer (after trimming duplicated engine/painter code); +1_500 for the warm canvas pool and the idle release of the shared context (a disposed chart keeps its context and programs for the next one) and the layout/engine hook that hands a warm canvas to a new chart.
  // Theme module shared by the core and plugins (rgbaCss): dark, light, and forced-colors themes.
  { label: "shared theme chunk", pattern: /^theme-.*\.js$/, maxBytes: 6_900 },
  { label: "lazy screenshot chunk", pattern: /^screenshot-.*\.js$/, maxBytes: 6_400 },
  { label: "shared OverlayUtils chunk", pattern: /^OverlayUtils-.*\.js$/, maxBytes: 2_600 },
  // Tooltip and crosshair helpers (pick markers, sync groups, long press), kept out of OverlayUtils so other plugins skip them.
  { label: "shared PickOverlay chunk", pattern: /^PickOverlay-.*.js$/, maxBytes: 5_300 },
];

// The chart-only import graph: `import { Chart } from "blazeplot"` with no plugin, so it is what every consumer pays.
// It holds the root entry, the Chart chunk (Chart, every rendering engine, the data engine), and the theme module.
// 196_943 bytes (rc.8: 182_613 = index 20_845 + Chart 142_844 + WebGL2 11_955 + release 176 + theme 6_793). The engines moved into the core graph (WebGL2, Canvas 2D, and the shared context ship in the
// root because the default renderer is "auto"), which is the whole +14.3 KB (+7.8%): Canvas 2D, the shared context, render surfaces, and engine-owned context loss.
const graphBudgets: GraphBudget[] = [{ label: "chart-only import graph (index + Chart + engines + theme)", entry: "dist/index.js", maxBytes: 202_100 }]; // +220 lazy canvas sizing (engine hook, first-frame sizing, cached plot size), after the axis label and layout PRs took 213 back (-31, -182); +400 Canvas 2D polyline reducer; 199_900 before the warm canvas pool and the shared context idle release (+1_560: pool, idle-release helper, layout hook).

/** Files `entry` imports statically, transitively (dynamic `import()` is excluded: it is not downloaded up front). */
function staticGraph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/(?:from|import)\s*"(\.\/[^"]+\.js)"/g)) visit(posix.join(posix.dirname(path), match[1]!));
  };
  visit(entry);
  return [...seen];
}

export async function collectBundleSizeReport(): Promise<BundleSizeReport> {
  const entryChunks = budgets.map((budget) => ({
    ...budget,
    sizeBytes: statSync(budget.path).size,
  }));

  const distFiles = await readdir("dist");
  const sharedChunks = sharedBudgets.map((budget) => ({
    budget,
    entries: distFiles
      .filter((file) => budget.pattern.test(file))
      .map((file) => {
        const path = posix.join("dist", file);
        return { label: budget.label, path, maxBytes: budget.maxBytes, sizeBytes: statSync(path).size };
      }),
  }));

  const graphs = graphBudgets.map((budget) => ({
    label: budget.label,
    path: budget.entry,
    maxBytes: budget.maxBytes,
    sizeBytes: staticGraph(budget.entry).reduce((total, file) => total + statSync(file).size, 0),
  }));

  return { entryChunks, sharedChunks, graphs };
}

export function bundleSizeFailures(report: BundleSizeReport): string[] {
  const failures: string[] = [];
  for (const entry of [...report.entryChunks, ...report.sharedChunks.flatMap((chunk) => chunk.entries), ...report.graphs]) {
    if (entry.sizeBytes > entry.maxBytes) {
      failures.push(`${entry.label} exceeds budget: ${entry.sizeBytes} > ${entry.maxBytes} bytes (${entry.path})`);
    }
  }

  for (const chunk of report.sharedChunks) {
    if (chunk.entries.length !== 1) failures.push(`Expected exactly one ${chunk.budget.label}, found ${chunk.entries.length}.`);
  }

  return failures;
}

export function renderBundleSizeMarkdown(report: BundleSizeReport): string {
  const rows = [...report.entryChunks, ...report.sharedChunks.flatMap((chunk) => chunk.entries), ...report.graphs]
    .map((entry) => `| ${markdownEscape(entry.label)} | \`${displayPath(entry.path)}\` | ${formatBytes(entry.sizeBytes)} |`);

  const lines = [
    "### Bundle size summary",
    "",
    "Generated from `dist/` after the package build.",
    "",
    "| Chunk | File | Size |",
    "|---|---|---:|",
    ...rows,
  ];

  for (const chunk of report.sharedChunks) {
    if (chunk.entries.length !== 1) lines.push("", `> Expected exactly one ${chunk.budget.label}, found ${chunk.entries.length}.`);
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await collectBundleSizeReport();

  if (options.markdown) {
    console.log(renderBundleSizeMarkdown(report));
    return;
  }

  const failures = bundleSizeFailures(report);
  for (const failure of failures) console.error(failure);

  if (failures.length > 0) process.exit(1);
  console.log(`Bundle size check passed for ${budgets.length} entry chunks and ${report.sharedChunks.length} shared chunks.`);
}

function parseArgs(args: readonly string[]): { markdown: boolean } {
  const options = { markdown: false };
  for (const arg of args) {
    switch (arg) {
      case "--markdown":
        options.markdown = true;
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun scripts/bundle-size-check.ts [--markdown]\n\nChecks built dist chunk sizes against package budgets.\n\nOptions:\n  --markdown   Print a README-ready markdown summary instead of enforcing budgets\n`);
  process.exit(0);
}

function displayPath(path: string): string {
  return path.replace(/-[A-Za-z0-9_-]+\.js$/u, "-*.js");
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KiB`;
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|");
}

await main();
