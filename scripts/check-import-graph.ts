/**
 * Fails when `src/` has an import cycle (type-only imports included) or breaks a layering rule.
 *
 *   bun run test:imports
 */
import { buildImportGraph, findCycles, findLayerViolations } from "./import-graph.ts";

const graph = buildImportGraph();
const cycles = findCycles(graph);
const violations = findLayerViolations(graph);

for (const cycle of cycles) console.error(`Import cycle: ${cycle.join(" <-> ")}`);
for (const violation of violations) console.error(`Layer violation: ${violation}`);
if (cycles.length > 0 || violations.length > 0) process.exit(1);
console.log(`Import graph OK: ${graph.size} modules, no cycles, no layer violations.`);
