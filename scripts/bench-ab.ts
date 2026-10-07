#!/usr/bin/env bun
/**
 * A/B performance comparison of two checkouts of this repo on the real GPU.
 *
 *   bun scripts/bench-ab.ts --a ../baseline --b . --scenarios hover-1m,line-1m-pan [--rounds 4] [--runs 3]
 *
 * Each round runs `scripts/benchmark-compare.ts` (headless, real GPU) once per side, alternating which side
 * goes first, so machine drift hits both sides equally; run values are pooled across rounds. uPlot runs in
 * both sides as a control: its A-to-B ratio should be about 1.00, and a larger drift means the machine was
 * not quiet. Verdicts use a Mann-Whitney U test (p < 0.01) on the pooled runs plus a minimum effect size, so a change is
 * only called better or worse when it is both statistically and practically real.
 *
 * The whole comparison holds the GPU lock (`C:\Users\proyo\bench.lock` or `BLAZEPLOT_BENCH_LOCK`), so concurrent
 * agents never measure at the same time. Not part of CI.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface Options {
  a: string;
  b: string;
  scenarios: string[];
  libraries: string[];
  rounds: number;
  runs: number;
  /** Smallest relative change that counts as real (default 2%). */
  minEffect: number;
  /** Only print rows with these metric ids (default: every metric of the scenario). */
  metrics: string[] | null;
}

interface MetricValues {
  values: number[];
}

interface ReportJson {
  metrics: Record<string, { direction: "min" | "max"; unit: string }>;
  scenarios: Array<{ name: string; metricIds: string[]; results: Array<{ library: string; metrics: Record<string, MetricValues> }> }>;
}

const LOCK = process.env.BLAZEPLOT_BENCH_LOCK ?? join(homedir(), "bench.lock");
const STALE_LOCK_MS = 2 * 60 * 60 * 1000;

function parse(args: readonly string[]): Options {
  const out: Options = { a: "", b: "", scenarios: [], libraries: ["blazeplot", "blazeplot-canvas2d", "uplot"], rounds: 4, runs: 3, minEffect: 0.02, metrics: null };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    const value = (): string => {
      const next = args[++i];
      if (next === undefined) throw new Error(`Missing value for ${flag}`);
      return next;
    };
    if (flag === "--a") out.a = resolve(value());
    else if (flag === "--b") out.b = resolve(value());
    else if (flag === "--scenarios" || flag === "--scenario") out.scenarios = value().split(",");
    else if (flag === "--libraries") out.libraries = value().split(",");
    else if (flag === "--rounds") out.rounds = Number(value());
    else if (flag === "--runs") out.runs = Number(value());
    else if (flag === "--min-effect") out.minEffect = Number(value());
    else if (flag === "--metrics") out.metrics = value().split(",");
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!out.a || !out.b || out.scenarios.length === 0) throw new Error("Usage: bun scripts/bench-ab.ts --a <baseline dir> --b <candidate dir> --scenarios <csv> [--libraries csv] [--rounds 4] [--runs 3] [--metrics csv] [--min-effect 0.02]");
  return out;
}

async function acquireLock(): Promise<() => Promise<void>> {
  for (;;) {
    try {
      const handle = await open(LOCK, "wx");
      await handle.writeFile(`bench-ab pid ${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      return async () => {
        await rm(LOCK, { force: true });
      };
    } catch {
      const age = Date.now() - (await stat(LOCK).then((s) => s.mtimeMs).catch(() => Date.now()));
      const text = await readFile(LOCK, "utf8").catch(() => "");
      if (age > STALE_LOCK_MS || (text !== "" && !holderAlive(text))) await rm(LOCK, { force: true });
      else {
        console.error(`GPU lock held (${LOCK}); waiting...`);
        await Bun.sleep(10_000);
      }
    }
  }
}

/** Whether the process that wrote the lock (`... pid N ...`) is still running; a dead holder never releases it. */
function holderAlive(text: string): boolean {
  const pid = Number(/pid (d+)/.exec(text)?.[1]);
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function chromePath(): string {
  const fromEnv = process.env.BLAZEPLOT_BENCH_CHROME ?? process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  const cache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cache)) {
    for (const entry of Bun.spawnSync({ cmd: ["ls", cache], stdout: "pipe" }).stdout.toString().split("\n").filter(Boolean).sort().reverse()) {
      const candidate = join(cache, entry, "chrome-win64", "chrome.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Set BLAZEPLOT_BENCH_CHROME to a Chrome executable.");
}

async function runSide(dir: string, options: Options, outDir: string, chrome: string): Promise<ReportJson> {
  await mkdir(outDir, { recursive: true });
  const proc = Bun.spawn({
    cmd: ["bun", "scripts/benchmark-compare.ts", "--headless", "--no-baseline", "--scenarios", options.scenarios.join(","), "--libraries", options.libraries.join(","), "--runs", String(options.runs), "--out-dir", outDir],
    cwd: dir,
    env: { ...process.env, BLAZEPLOT_REAL_GPU: "1", BLAZEPLOT_BENCH_CHROME: chrome },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`benchmark-compare failed in ${dir} (exit ${code}):\n${stderr.split("\n").slice(-15).join("\n")}`);
  return JSON.parse(await readFile(join(outDir, "latest.json"), "utf8")) as ReportJson;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Two-sided Mann-Whitney U p-value (normal approximation with average ranks for ties). */
function mannWhitneyP(x: readonly number[], y: readonly number[]): number {
  const all = [...x.map((v) => ({ v, g: 0 })), ...y.map((v) => ({ v, g: 1 }))].sort((p, q) => p.v - q.v);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1]!.v === all[i]!.v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  const n1 = x.length;
  const n2 = y.length;
  const r1 = all.reduce((sum, item, index) => sum + (item.g === 0 ? ranks[index]! : 0), 0);
  const u = r1 - (n1 * (n1 + 1)) / 2;
  const n = n1 + n2;
  const variance = (n1 * n2 / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  if (variance <= 0) return 1;
  const z = Math.abs(u - (n1 * n2) / 2) / Math.sqrt(variance);
  return 2 * (1 - normalCdf(z));
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 1 - p;
}

function pool(reports: readonly ReportJson[], scenario: string, library: string, metric: string): number[] {
  const out: number[] = [];
  for (const report of reports) {
    const values = report.scenarios.find((entry) => entry.name === scenario)?.results.find((entry) => entry.library === library)?.metrics[metric]?.values;
    if (values) out.push(...values);
  }
  return out;
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const chrome = chromePath();
  const work = await mkdtemp(join(tmpdir(), "bench-ab-"));
  const release = await acquireLock();
  const sides: { a: ReportJson[]; b: ReportJson[] } = { a: [], b: [] };
  try {
    for (let round = 0; round < options.rounds; round++) {
      const order: Array<"a" | "b"> = round % 2 === 0 ? ["a", "b"] : ["b", "a"];
      for (const side of order) {
        console.error(`round ${round + 1}/${options.rounds}: ${side.toUpperCase()}`);
        sides[side].push(await runSide(options[side], options, join(work, `${side}-${round}`), chrome));
      }
    }
  } finally {
    await release();
    await rm(work, { recursive: true, force: true });
  }

  const meta = sides.a[0]!;
  console.log(`A = ${options.a}\nB = ${options.b}\n${options.rounds} rounds x ${options.runs} runs per side, real GPU, headless. Ratio > 1.00 means B is better (direction-adjusted).\n`);
  console.log("scenario".padEnd(26) + "library".padEnd(20) + "metric".padEnd(13) + "A".padStart(10) + "B".padStart(10) + "ratio".padStart(8) + "  p      verdict");
  let better = 0;
  let worse = 0;
  const control: number[] = [];
  for (const scenario of options.scenarios) {
    const entry = meta.scenarios.find((item) => item.name === scenario);
    if (!entry) throw new Error(`Unknown scenario ${scenario}`);
    for (const library of options.libraries) {
      for (const metric of entry.metricIds) {
        if (options.metrics && !options.metrics.includes(metric)) continue;
        const a = pool(sides.a, scenario, library, metric);
        const b = pool(sides.b, scenario, library, metric);
        if (a.length === 0 || b.length === 0) continue;
        const ma = median(a);
        const mb = median(b);
        const ratio = meta.metrics[metric]!.direction === "min" ? ma / mb : mb / ma;
        const p = mannWhitneyP(a, b);
        const real = p < 0.01 && Math.abs(ratio - 1) > options.minEffect;
        const verdict = library === "uplot" ? "(control)" : real ? (ratio > 1 ? "BETTER" : "WORSE") : "same";
        if (library === "uplot") control.push(ratio);
        else if (real && ratio > 1) better++;
        else if (real) worse++;
        console.log(scenario.padEnd(26) + library.padEnd(20) + metric.padEnd(13) + ma.toPrecision(4).padStart(10) + mb.toPrecision(4).padStart(10) + `${ratio.toFixed(2)}x`.padStart(8) + `  ${p.toFixed(3)}  ${verdict}`);
      }
    }
  }
  const drift = control.length ? median(control) : 1;
  console.log(`\nBETTER: ${better}  WORSE: ${worse}  uPlot control median ratio: ${drift.toFixed(3)} (should be ~1.00; far from it means the machine was noisy, rerun)`);
  if (worse > 0) process.exitCode = 2;
}

await main();
