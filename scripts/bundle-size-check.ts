import { readdir } from "node:fs/promises";
import { statSync } from "node:fs";
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

interface BundleSizeReport {
  readonly entryChunks: BundleSizeEntry[];
  readonly sharedChunks: SharedChunkResult[];
}

// Budgets are the built size plus about 1.5% (at least 100 bytes), rounded up to 100 bytes.
// Tighten them when a change shrinks a chunk; raise one only with a reason in the PR.
const budgets: Budget[] = [
  { label: "root entry", path: "dist/index.js", maxBytes: 12_000 },
  { label: "linked entry", path: "dist/linked.js", maxBytes: 2_300 },
  { label: "data entry", path: "dist/data.js", maxBytes: 1_800 },
  { label: "export entry", path: "dist/export.js", maxBytes: 3_900 },
  { label: "interactions plugin", path: "dist/plugins/interactions.js", maxBytes: 11_700 },
  { label: "annotations plugin", path: "dist/plugins/annotations.js", maxBytes: 15_200 },
  { label: "navigator plugin", path: "dist/plugins/navigator.js", maxBytes: 8_800 },
  { label: "selection plugin", path: "dist/plugins/selection.js", maxBytes: 8_600 },
  { label: "legend plugin", path: "dist/plugins/legend.js", maxBytes: 4_600 },
  { label: "tooltip plugin", path: "dist/plugins/tooltip.js", maxBytes: 4_800 },
  { label: "crosshair plugin", path: "dist/plugins/crosshair.js", maxBytes: 9_500 },
  { label: "flamegraph plugin", path: "dist/plugins/flamegraph.js", maxBytes: 21_100 },
  { label: "a11y plugin", path: "dist/plugins/a11y.js", maxBytes: 10_800 },
];

const sharedBudgets: SharedChunkBudget[] = [
  // 155_184 bytes in 1.0.0-rc.3 (plugin host, chart semantics, forced colors); 151_515 after #152.
  { label: "shared Chart chunk", pattern: /^Chart-.*\.js$/, maxBytes: 159_000 },
  // Theme module shared by the core and plugins (rgbaCss): dark, light, and forced-colors themes.
  { label: "shared theme chunk", pattern: /^theme-.*\.js$/, maxBytes: 6_900 },
  { label: "lazy screenshot chunk", pattern: /^screenshot-.*\.js$/, maxBytes: 6_400 },
  { label: "shared OverlayUtils chunk", pattern: /^OverlayUtils-.*\.js$/, maxBytes: 4_700 },
];

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

  return { entryChunks, sharedChunks };
}

export function bundleSizeFailures(report: BundleSizeReport): string[] {
  const failures: string[] = [];
  for (const entry of [...report.entryChunks, ...report.sharedChunks.flatMap((chunk) => chunk.entries)]) {
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
  const rows = [...report.entryChunks, ...report.sharedChunks.flatMap((chunk) => chunk.entries)]
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
