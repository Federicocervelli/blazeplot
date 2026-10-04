#!/usr/bin/env bun
/**
 * Performance regression gate. Runs the deterministic `perf-gate` benchmark scenario several times
 * in one headless Chrome session, normalises timings by an in-page CPU calibration workload, and
 * fails when the median of any metric exceeds its limit in `benchmarks/thresholds.json`.
 * Methodology and update procedure: docs/release-and-benchmarks.md.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CdpClient, attachConsoleLogging, closeTarget, createTarget, evaluate, readNonNegativeInteger, readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, throwIfPageErrored, waitForHttp } from "./browser-harness.js";
import { evaluate as evaluateGate, extractMetrics, formatReport, parseThresholds, withBaselines, type GateRunInput, type MetricValues } from "./perf-gate-lib.js";

interface Options {
  thresholds: string;
  out: string;
  reps?: number;
  discard?: number;
  retryReps?: number;
  measureMs?: number;
  slowdownMs?: number;
  width: number;
  height: number;
  port: number;
  debugPort: number;
  chrome?: string;
  update: boolean;
  reportOnly: boolean;
}

interface BenchSnapshot {
  state: string;
  error: string | null;
}

interface BenchRunResult extends GateRunInput {
  userAgent?: string;
  scenario: string;
  raf: { frames: number; fps: number };
  finalStats: { renderMode?: string; drawCalls?: number; pointsRendered?: number };
}

const REPO_ROOT = join(import.meta.dir, "..");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const thresholds = parseThresholds(JSON.parse(await readFile(options.thresholds, "utf8")));
  const reps = options.reps ?? thresholds.repetitions;
  const discard = options.discard ?? thresholds.discardedRepetitions;
  const retryReps = options.retryReps ?? thresholds.retryRepetitions;

  const serverUrl = `http://127.0.0.1:${options.port}`;
  const benchUrl = new URL("/bench/", serverUrl);
  benchUrl.searchParams.set("scenario", thresholds.scenario);
  if (options.measureMs !== undefined) benchUrl.searchParams.set("measureMs", String(options.measureMs));
  if (options.slowdownMs !== undefined) benchUrl.searchParams.set("burnMs", String(options.slowdownMs));

  let viteProc: Bun.Subprocess | null = null;
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;
  let exitCode = 0;

  try {
    viteProc = startVite(options.port);
    await waitForHttp(serverUrl, 30_000);
    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-perf-gate-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    const runBenchmark = (label: string): Promise<BenchRunResult> => runOnce(options.debugPort, benchUrl.toString(), label);

    for (let i = 0; i < discard; i++) {
      const warm = await runBenchmark(`discarded warmup ${i + 1}/${discard}`);
      log(`discarded warmup ${i + 1}/${discard}: calibration ${warm.calibrationMs.toFixed(2)}ms`);
    }

    const runs: MetricValues[] = [];
    const raw: BenchRunResult[] = [];
    const collect = async (count: number): Promise<void> => {
      for (let i = 0; i < count; i++) {
        const result = await runBenchmark(`rep ${raw.length + 1}`);
        const metrics = extractMetrics(result);
        raw.push(result);
        runs.push(metrics);
        log(`rep ${raw.length}: calibration ${result.calibrationMs.toFixed(2)}ms, frame p50 ${result.chart.frameMs.p50.toFixed(2)}ms, p95 ${result.chart.frameMs.p95.toFixed(2)}ms, ingest ${result.ingestMs.toFixed(0)}ms, raf frames ${result.raf.frames}`);
      }
    };

    await collect(reps);
    let verdicts = evaluateGate(thresholds, runs);
    if (verdicts.some((v) => !v.pass) && retryReps > 0 && !options.update) {
      log(`first attempt exceeded a limit; running ${retryReps} more repetitions to rule out a noisy runner`);
      await collect(retryReps);
      verdicts = evaluateGate(thresholds, runs);
    }

    process.stdout.write(`\nPerformance gate: scenario '${thresholds.scenario}', ${runs.length} repetitions (median)\n${formatReport(verdicts)}\n`);

    const next = withBaselines(thresholds, runs);
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify({ generatedAt: new Date().toISOString(), browser: chromePath, userAgent: raw[0]?.userAgent, runs, raw, verdicts, suggestedThresholds: next }, null, 2)}\n`);
    log(`wrote ${options.out}`);

    if (options.update) {
      await writeFile(options.thresholds, `${JSON.stringify(next, null, 2)}\n`);
      log(`updated baselines in ${options.thresholds}; review the diff and the headroom values before committing`);
    } else {
      process.stdout.write(`\nMeasured baselines (to refresh the thresholds, copy these into benchmarks/thresholds.json or run 'bun run bench:gate -- --update'):\n${JSON.stringify(Object.fromEntries(Object.entries(next.metrics).map(([k, v]) => [k, v.baseline])))}\n`);
    }

    const failed = verdicts.filter((v) => !v.pass);
    if (failed.length > 0 && !options.reportOnly && !options.update) {
      process.stderr.write(`\nPerformance gate FAILED: ${failed.map((v) => `${v.name} ${v.ratioToBaseline.toFixed(2)}x baseline`).join(", ")}\nIf this is an intentional change, see 'Performance regression gate' in docs/release-and-benchmarks.md before updating benchmarks/thresholds.json.\n`);
      exitCode = 1;
    }
  } finally {
    if (chromeProc) chromeProc.kill();
    if (viteProc) viteProc.kill();
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
  process.exit(exitCode);
}

async function runOnce(debugPort: number, url: string, label: string): Promise<BenchRunResult> {
  const target = await createTarget(debugPort, url);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const pageErrors: string[] = [];
    attachConsoleLogging(cdp, pageErrors, label);
    await waitForReady(cdp, 90_000);
    throwIfPageErrored(pageErrors);
    const result = await evaluate(cdp, "window.__blazeplotBench.start()", true) as BenchRunResult;
    throwIfPageErrored(pageErrors);
    assertRendered(result);
    return result;
  } finally {
    cdp.close();
    await closeTarget(debugPort, target.id).catch(() => undefined);
  }
}

async function waitForReady(cdp: CdpClient, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate(cdp, "window.__blazeplotBench?.snapshot?.() ?? null", true) as BenchSnapshot | null;
    if (snapshot?.state === "ready") return;
    if (snapshot?.state === "error") throw new Error(`Benchmark page failed: ${snapshot.error ?? "unknown error"}`);
    await sleep(250);
  }
  throw new Error("Timed out waiting for the benchmark page to become ready");
}

function assertRendered(result: BenchRunResult): void {
  const stats = result.finalStats;
  if (!stats || stats.renderMode === "none" || !(stats.drawCalls && stats.drawCalls > 0) || !(stats.pointsRendered && stats.pointsRendered > 0)) {
    throw new Error("Benchmark completed without rendering chart content; refusing to record metrics");
  }
}

function launchChrome(chromePath: string, userDataDir: string, opts: Options): Bun.Subprocess {
  return spawnChrome([
    chromePath,
    "--headless=new",
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${opts.width},${opts.height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "about:blank",
  ]);
}

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = {
    thresholds: join(REPO_ROOT, "benchmarks", "thresholds.json"),
    out: join(REPO_ROOT, "build", "perf-gate", "result.json"),
    width: 1600,
    height: 900,
    port: 41741,
    debugPort: 9233,
    update: false,
    reportOnly: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    const [flag, inlineValue] = arg.split("=", 2) as [string, string?];
    const readValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[++i];
      if (!next) throw new Error(`Missing value for ${flag}`);
      return next;
    };
    switch (flag) {
      case "--thresholds": parsed.thresholds = readValue(); break;
      case "--out": parsed.out = readValue(); break;
      case "--reps": parsed.reps = readPositiveInteger(flag, readValue()); break;
      case "--discard": parsed.discard = readNonNegativeInteger(flag, readValue()); break;
      case "--retry-reps": parsed.retryReps = readNonNegativeInteger(flag, readValue()); break;
      case "--inject-slowdown-ms": parsed.slowdownMs = readPositiveInteger(flag, readValue()); break;
      case "--measure-ms": parsed.measureMs = readPositiveInteger(flag, readValue()); break;
      case "--width": parsed.width = readPositiveInteger(flag, readValue()); break;
      case "--height": parsed.height = readPositiveInteger(flag, readValue()); break;
      case "--port": parsed.port = readPositiveInteger(flag, readValue()); break;
      case "--debug-port": parsed.debugPort = readPositiveInteger(flag, readValue()); break;
      case "--chrome": parsed.chrome = readValue(); break;
      case "--update": parsed.update = true; break;
      case "--report-only": parsed.reportOnly = true; break;
      case "--help":
      case "-h":
        process.stdout.write(`Usage: bun run bench:gate [options]\n\nOptions:\n  --thresholds <path>   Thresholds file (default: benchmarks/thresholds.json)\n  --out <path>          Raw per-repetition JSON report (default: build/perf-gate/result.json)\n  --reps <n>            Measured repetitions (default from thresholds file)\n  --discard <n>         Discarded warmup repetitions (default from thresholds file)\n  --retry-reps <n>      Extra repetitions if the first attempt fails (default from thresholds file)\n  --measure-ms <ms>     Override the measurement window per repetition\n  --report-only         Print the report but never fail (for collecting noise data)\n  --update              Rewrite baselines in the thresholds file with the measured medians\n  --chrome <path>       Chrome/Chromium/Brave executable\n`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function log(message: string): void {
  process.stdout.write(`[perf-gate] ${message}\n`);
}

void main();
