/**
 * Runs the unit tests with coverage and enforces per-scope minimums.
 * Thresholds are floors set just under the baseline: raise them when
 * coverage improves, never lower them. Run with `bun run test:coverage`.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Scope {
  name: string;
  match: (file: string) => boolean;
  minLines: number;
  minFuncs: number;
}

// Theme resolution needs real computed styles; covered by `bun run test:browser`.
// (Also listed in bunfig.toml, but Bun does not always apply ignore patterns to loaded files.)
const browserOnly = new Set(["src/ui/theme.ts"]);

// Built-in plugin implementations plus linked charts. These run under happy-dom with the fake GPU
// backend (tests/ui). Drawing that needs a real WebGL2/2D canvas (FlameGraph rendering, screenshot
// compositing, WebGL2Backend) is covered by `bun run test:browser`, not here.
const isPluginImplementation = (file: string): boolean => /^src\/plugins\/[^/]+\//.test(file) || file.startsWith("src/linked/");

const scopes: Scope[] = [
  { name: "src/core", match: (f) => f.startsWith("src/core/"), minLines: 92, minFuncs: 94 },
  // Everything under src/ that unit tests load (browser-only UI helpers are ignored in bunfig.toml).
  { name: "src (all)", match: (f) => f.startsWith("src/") && !browserOnly.has(f), minLines: 87, minFuncs: 88 },
  { name: "plugins + linked", match: isPluginImplementation, minLines: 95, minFuncs: 95 },
  // The package entry barrels (src/index.ts, src/linked.ts, src/plugins/*): everything users import.
  { name: "public API", match: (f) => f === "src/index.ts" || f === "src/linked.ts" || /^src\/plugins\/[^/]+\.ts$/.test(f), minLines: 99, minFuncs: 99 },
];

const dir = mkdtempSync(join(tmpdir(), "blazeplot-cov-"));
const proc = Bun.spawnSync(
  ["bun", "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", `--coverage-dir=${dir}`],
  { stdout: "inherit", stderr: "inherit" },
);
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);

const totals = scopes.map(() => ({ lf: 0, lh: 0, fnf: 0, fnh: 0 }));
let file = "";
for (const line of readFileSync(join(dir, "lcov.info"), "utf8").split(/\r?\n/)) {
  if (line.startsWith("SF:")) file = line.slice(3).replace(/\\/g, "/");
  const m = /^(LF|LH|FNF|FNH):(\d+)$/.exec(line);
  if (!m) continue;
  scopes.forEach((s, i) => {
    if (!s.match(file)) return;
    const t = totals[i]!;
    const v = Number(m[2]);
    if (m[1] === "LF") t.lf += v;
    else if (m[1] === "LH") t.lh += v;
    else if (m[1] === "FNF") t.fnf += v;
    else t.fnh += v;
  });
}
rmSync(dir, { recursive: true, force: true });

let failed = false;
scopes.forEach((s, i) => {
  const t = totals[i]!;
  const lines = t.lf ? (t.lh / t.lf) * 100 : 0;
  const funcs = t.fnf ? (t.fnh / t.fnf) * 100 : 0;
  const ok = lines >= s.minLines && funcs >= s.minFuncs;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${s.name}: lines ${lines.toFixed(2)}% (min ${s.minLines}), functions ${funcs.toFixed(2)}% (min ${s.minFuncs})`,
  );
});
process.exit(failed ? 1 : 0);
