import { readdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";

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

const budgets: Budget[] = [
  { label: "root entry", path: "dist/index.js", maxBytes: 32_000 },
  { label: "core subpath entry", path: "dist/core.js", maxBytes: 4_000 },
  { label: "interaction subpath entry", path: "dist/interaction.js", maxBytes: 2_000 },
  { label: "render subpath entry", path: "dist/render.js", maxBytes: 2_000 },
  { label: "react entry", path: "dist/react.js", maxBytes: 8_000 },
  { label: "linked entry", path: "dist/linked.js", maxBytes: 16_000 },
  { label: "linked core entry", path: "dist/linked-core.js", maxBytes: 8_000 },
  { label: "data entry", path: "dist/data.js", maxBytes: 12_000 },
  { label: "export entry", path: "dist/export.js", maxBytes: 8_000 },
  { label: "interactions plugin", path: "dist/plugins/interactions.js", maxBytes: 24_000 },
  { label: "annotations plugin", path: "dist/plugins/annotations.js", maxBytes: 16_000 },
  { label: "navigator plugin", path: "dist/plugins/navigator.js", maxBytes: 16_000 },
  { label: "selection plugin", path: "dist/plugins/selection.js", maxBytes: 12_000 },
  { label: "legend plugin", path: "dist/plugins/legend.js", maxBytes: 8_000 },
  { label: "tooltip plugin entry", path: "dist/plugins/tooltip.js", maxBytes: 4_000 },
  { label: "crosshair plugin entry", path: "dist/plugins/crosshair.js", maxBytes: 4_000 },
  { label: "flamegraph plugin", path: "dist/plugins/flamegraph.js", maxBytes: 48_000 },
];

const sharedBudgets: SharedChunkBudget[] = [
  { label: "shared Chart chunk", pattern: /^Chart-.*\.js$/, maxBytes: 140_000 },
  { label: "shared streaming data chunk", pattern: /^(RingBuffer|UniformRingBuffer)-.*\.js$/, maxBytes: 64_000 },
  { label: "shared OhlcDataset chunk", pattern: /^OhlcDataset-.*\.js$/, maxBytes: 24_000 },
  { label: "shared AxisController chunk", pattern: /^AxisController-.*\.js$/, maxBytes: 20_000 },
  { label: "shared WebGL2Backend chunk", pattern: /^WebGL2Backend-.*\.js$/, maxBytes: 24_000 },
  { label: "shared LinkedChartsCore chunk", pattern: /^LinkedChartsCore-.*\.js$/, maxBytes: 8_000 },
  { label: "lazy screenshot chunk", pattern: /^screenshot-.*\.js$/, maxBytes: 8_000 },
  { label: "shared OverlayUtils chunk", pattern: /^OverlayUtils-.*\.js$/, maxBytes: 8_000 },
  { label: "shared Tooltip chunk", pattern: /^Tooltip-.*\.js$/, maxBytes: 12_000 },
  { label: "shared Crosshair chunk", pattern: /^Crosshair-.*\.js$/, maxBytes: 16_000 },
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
        const path = join("dist", file);
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
    .map((entry) => `| ${markdownEscape(entry.label)} | \`${entry.path}\` | ${formatBytes(entry.sizeBytes)} |`);

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

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|");
}

await main();
