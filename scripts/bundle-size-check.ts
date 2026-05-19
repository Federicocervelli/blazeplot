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

interface BundleSizeReport {
  readonly entryChunks: BundleSizeEntry[];
  readonly sharedChartChunk?: BundleSizeEntry;
  readonly sharedChartChunkCount: number;
}

const budgets: Budget[] = [
  { label: "core entry", path: "dist/index.js", maxBytes: 32_000 },
  { label: "react entry", path: "dist/react.js", maxBytes: 8_000 },
  { label: "linked entry", path: "dist/linked.js", maxBytes: 16_000 },
  { label: "export entry", path: "dist/export.js", maxBytes: 8_000 },
  { label: "interactions plugin", path: "dist/plugins/interactions.js", maxBytes: 24_000 },
  { label: "annotations plugin", path: "dist/plugins/annotations.js", maxBytes: 16_000 },
  { label: "navigator plugin", path: "dist/plugins/navigator.js", maxBytes: 16_000 },
  { label: "selection plugin", path: "dist/plugins/selection.js", maxBytes: 12_000 },
  { label: "legend plugin", path: "dist/plugins/legend.js", maxBytes: 8_000 },
];

const maxChartBytes = 140_000;

export async function collectBundleSizeReport(): Promise<BundleSizeReport> {
  const entryChunks = budgets.map((budget) => ({
    ...budget,
    sizeBytes: statSync(budget.path).size,
  }));

  const distFiles = await readdir("dist");
  const chartChunks = distFiles.filter((file) => /^Chart-.*\.js$/.test(file));
  const chartPath = chartChunks.length === 1 ? join("dist", chartChunks[0] ?? "") : undefined;
  const sharedChartChunk = chartPath
    ? { label: "shared Chart chunk", path: chartPath, maxBytes: maxChartBytes, sizeBytes: statSync(chartPath).size }
    : undefined;

  return {
    entryChunks,
    sharedChartChunk,
    sharedChartChunkCount: chartChunks.length,
  };
}

export function bundleSizeFailures(report: BundleSizeReport): string[] {
  const failures: string[] = [];
  for (const entry of [...report.entryChunks, ...(report.sharedChartChunk ? [report.sharedChartChunk] : [])]) {
    if (entry.sizeBytes > entry.maxBytes) {
      failures.push(`${entry.label} exceeds budget: ${entry.sizeBytes} > ${entry.maxBytes} bytes (${entry.path})`);
    }
  }

  if (report.sharedChartChunkCount !== 1) {
    failures.push(`Expected exactly one shared Chart chunk, found ${report.sharedChartChunkCount}.`);
  }

  return failures;
}

export function renderBundleSizeMarkdown(report: BundleSizeReport): string {
  const rows = [...report.entryChunks, ...(report.sharedChartChunk ? [report.sharedChartChunk] : [])]
    .map((entry) => {
      const remainingBytes = entry.maxBytes - entry.sizeBytes;
      return `| ${markdownEscape(entry.label)} | \`${entry.path}\` | ${formatBytes(entry.sizeBytes)} | ${formatBytes(entry.maxBytes)} | ${formatHeadroom(remainingBytes)} |`;
    });

  const lines = [
    "### Bundle size summary",
    "",
    "Generated from `dist/` after the package build. Budgets are enforced by `bun run test:bundle-size`.",
    "",
    "| Chunk | File | Size | Budget | Headroom |",
    "|---|---|---:|---:|---:|",
    ...rows,
  ];

  if (report.sharedChartChunkCount !== 1) {
    lines.push("", `> Expected exactly one shared Chart chunk, found ${report.sharedChartChunkCount}.`);
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
  console.log(`Bundle size check passed for ${budgets.length} entry chunks and ${report.sharedChartChunkCount} shared Chart chunk.`);
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

function formatHeadroom(bytes: number): string {
  const sign = bytes < 0 ? "over" : "free";
  return `${formatBytes(Math.abs(bytes))} ${sign}`;
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|");
}

await main();
