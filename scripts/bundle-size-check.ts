import { readdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";

interface Budget {
  readonly label: string;
  readonly path: string;
  readonly maxBytes: number;
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

let failed = false;
for (const budget of budgets) {
  const size = statSync(budget.path).size;
  if (size > budget.maxBytes) {
    console.error(`${budget.label} exceeds budget: ${size} > ${budget.maxBytes} bytes (${budget.path})`);
    failed = true;
  }
}

const distFiles = await readdir("dist");
const chartChunks = distFiles.filter((file) => /^Chart-.*\.js$/.test(file));
if (chartChunks.length !== 1) {
  console.error(`Expected exactly one shared Chart chunk, found ${chartChunks.length}.`);
  failed = true;
} else {
  const chartPath = join("dist", chartChunks[0]!);
  const chartSize = statSync(chartPath).size;
  const maxChartBytes = 140_000;
  if (chartSize > maxChartBytes) {
    console.error(`shared Chart chunk exceeds budget: ${chartSize} > ${maxChartBytes} bytes (${chartPath})`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Bundle size check passed for ${budgets.length} entry chunks and ${chartChunks.length} shared Chart chunk.`);
