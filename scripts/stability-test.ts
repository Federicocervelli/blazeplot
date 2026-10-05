#!/usr/bin/env bun
/**
 * Real-browser leak and stability tests (`bun run test:stability`).
 *
 * Drives `tests/browser/stability/` in headless Chrome over the DevTools Protocol. The page runs the
 * workloads (mount/unmount, resize, series churn, streaming, WebGL context loss); this script forces
 * a full GC through `HeapProfiler.collectGarbage` and compares JS heap, DOM node, document, and event
 * listener counts against a baseline taken after a warm-up. The page itself reports exact counters
 * (document elements, live WebGL objects and contexts) that must return to baseline with no tolerance.
 *
 * Default (CI) mode takes a few minutes at most. `--long` is the local soak: more iterations and a
 * 90 second streaming run (override with `--duration-s`).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ContextLossResult, PageProbe, StreamingConfig, StreamingStats, WorkloadResult } from "../tests/browser/stability/main.ts";
import { CdpClient, closeTarget, createTarget, evaluate, readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, waitForHttp } from "./browser-harness.js";

interface Options {
  long: boolean;
  cases: string[];
  durationS: number;
  width: number;
  height: number;
  port: number;
  debugPort: number;
  timeoutMs: number;
  outDir: string;
  verbose: boolean;
  url?: string;
  chrome?: string;
  keepBrowser: boolean;
}

interface Sample {
  /** V8 heap in use plus ArrayBuffer backing stores, after forced GC. */
  heapBytes: number;
  usedSize: number;
  backingBytes: number;
  nodes: number;
  listeners: number;
  documents: number;
}

interface Profile {
  mountIterations: number;
  /** Batches of 25 charts sharing one render context. */
  sharedIterations: number;
  resizeIterations: number;
  seriesIterations: number;
  contextCycles: number;
  streamSeries: number;
  streamCapacity: number;
  streamBatch: number;
  streamDurationS: number;
  streamSampleEveryS: number;
}

const CI_PROFILE: Profile = {
  mountIterations: 200,
  sharedIterations: 8,
  resizeIterations: 300,
  seriesIterations: 200,
  contextCycles: 5,
  streamSeries: 4,
  streamCapacity: 50_000,
  streamBatch: 200,
  streamDurationS: 20,
  streamSampleEveryS: 2,
};

const LONG_PROFILE: Profile = {
  mountIterations: 1_000,
  sharedIterations: 40,
  resizeIterations: 2_000,
  seriesIterations: 1_000,
  contextCycles: 25,
  streamSeries: 8,
  streamCapacity: 200_000,
  streamBatch: 250,
  streamDurationS: 90,
  streamSampleEveryS: 5,
};

const ALL_CASES = ["mount-unmount", "shared-context", "shared-context-loss", "resize-churn", "series-churn", "streaming", "context-loss", "detector-control"] as const;
type CaseName = typeof ALL_CASES[number];

const MiB = 1024 * 1024;
const KiB = 1024;

interface Failure {
  case: string;
  message: string;
}

interface CaseReport {
  case: string;
  ok: boolean;
  details: Record<string, unknown>;
}

const failures: Failure[] = [];
const reports: CaseReport[] = [];
let openTargetId: string | null = null;

await main();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const profile = options.long ? { ...LONG_PROFILE } : { ...CI_PROFILE };
  if (options.durationS > 0) profile.streamDurationS = options.durationS;
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  let viteProc: Bun.Subprocess | null = null;
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;

  try {
    if (!options.url) {
      viteProc = startVite(options.port);
      await waitForHttp(serverUrl, 30_000);
    }
    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-stability-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    console.log(`stability: ${options.long ? "long" : "ci"} mode in ${basename(chromePath)}`);
    for (const name of options.cases as CaseName[]) {
      const startedAt = Date.now();
      try {
        await runCase(name, options, profile, serverUrl);
      } catch (error) {
        fail(name, error instanceof Error ? error.message : String(error));
      }
      console.log(`  (${name} took ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
    }

    await mkdir(options.outDir, { recursive: true });
    await writeFile(join(options.outDir, "report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), mode: options.long ? "long" : "ci", browser: basename(chromePath), cases: reports }, null, 2)}\n`);
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (viteProc) viteProc.kill();
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }

  if (failures.length) {
    console.error(`\n${failures.length} stability check(s) failed:`);
    for (const failure of failures) console.error(`  ✗ ${failure.case}: ${failure.message}`);
    process.exit(1);
  }
  console.log("\nAll stability checks passed.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Page session
// ---------------------------------------------------------------------------

interface Session {
  cdp: CdpClient;
  /** Uncaught exceptions and console.error output from the page. */
  pageErrors: string[];
  /** Browser warnings that the page created more WebGL contexts than it released. */
  contextCapWarnings: number;
  /** Other WebGL/browser warnings, kept for the report only. */
  warnings: number;
}

async function openSession(options: Options, serverUrl: string, caseName: string): Promise<Session> {
  if (openTargetId) {
    await closeTarget(options.debugPort, openTargetId).catch(() => undefined);
    openTargetId = null;
  }
  const target = await createTarget(options.debugPort, new URL("/stability/", serverUrl).toString());
  openTargetId = target.id;
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  const session: Session = { cdp, pageErrors: [], contextCapWarnings: 0, warnings: 0 };
  cdp.on("Runtime.exceptionThrown", (params) => {
    const text = JSON.stringify(params).slice(0, 600);
    session.pageErrors.push(text);
    process.stderr.write(`[stability:${caseName}:exception] ${text}\n`);
  });
  cdp.on("Runtime.consoleAPICalled", (params) => {
    const event = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
    if (event.type !== "error") return;
    const text = event.args?.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ") ?? "";
    session.pageErrors.push(`console.error: ${text.slice(0, 400)}`);
    process.stderr.write(`[stability:${caseName}:console.error] ${text}\n`);
  });
  cdp.on("Log.entryAdded", (params) => {
    const entry = (params as { entry?: { level?: string; text?: string } }).entry;
    const text = entry?.text ?? "";
    if (/Too many active WebGL contexts/i.test(text)) session.contextCapWarnings++;
    else if (/INVALID_OPERATION/i.test(text) && !/restoreContext/i.test(text)) {
      // E.g. deleting GL objects that belong to a lost context after restore. The harness's own restoreContext()
      // calls on a context that dispose already released are expected to warn and are not a library defect.
      session.pageErrors.push(`webgl ${entry?.level ?? "log"}: ${text.slice(0, 400)}`);
    } else if (entry?.level === "warning" || entry?.level === "error") session.warnings++;
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await waitForPage(cdp, 30_000);
  return session;
}

async function waitForPage(cdp: CdpClient, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, "window.__blazeplotStability?.ready === true", false)) return;
    await sleep(100);
  }
  throw new Error("Timed out waiting for the stability fixture page");
}

function page<T>(session: Session, expression: string, timeoutMs: number): Promise<T> {
  const call = evaluate(session.cdp, `window.__blazeplotStability.${expression}`, true) as Promise<T>;
  return withTimeout(call, timeoutMs, expression);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function probe(session: Session): Promise<PageProbe> {
  return page<PageProbe>(session, "probe()", 10_000);
}

/**
 * Force GC and read heap and DOM counters, reporting the floor over several rounds.
 *
 * Workloads that keep running while sampled (streaming with hover) allocate short-lived garbage
 * between a collection and the read that follows it, and Blink only drops dead DOM nodes from its
 * counters once they are swept, so any single reading can include a transient batch (a hover that
 * rebuilds the tooltip leaves ~60 dead nodes) that is unrelated to leaks. Garbage can only add to a
 * reading, while a real leak stays in every reading, so the minimum over a few collect-then-read
 * rounds is the retained size. Rounds stop once the minimum has not improved for two rounds.
 */
async function settle(cdp: CdpClient): Promise<Sample> {
  let best: Sample | null = null;
  let minNodes = Infinity;
  let minListeners = Infinity;
  let stable = 0;
  for (let round = 0; round < 12 && stable < 2; round++) {
    await cdp.send("HeapProfiler.collectGarbage");
    // Read right after the collection, before the page has time to allocate more garbage.
    const current = await readSample(cdp);
    const improved = !best || current.nodes < minNodes || current.listeners < minListeners || current.heapBytes < best.heapBytes - 64 * KiB;
    stable = improved ? 0 : stable + 1;
    minNodes = Math.min(minNodes, current.nodes);
    minListeners = Math.min(minListeners, current.listeners);
    if (!best || current.heapBytes < best.heapBytes) best = current;
    await sleep(40);
  }
  return { ...best!, nodes: minNodes, listeners: minListeners };
}

async function readSample(cdp: CdpClient): Promise<Sample> {
  const usage = await cdp.send("Runtime.getHeapUsage") as { usedSize: number; totalSize: number; embedderHeapUsedSize?: number; backingStorageSize?: number };
  const metrics = await cdp.send("Performance.getMetrics") as { metrics: Array<{ name: string; value: number }> };
  const byName = new Map(metrics.metrics.map((metric) => [metric.name, metric.value]));
  const backingBytes = usage.backingStorageSize ?? 0;
  return {
    heapBytes: usage.usedSize + backingBytes,
    usedSize: usage.usedSize,
    backingBytes,
    nodes: byName.get("Nodes") ?? 0,
    listeners: byName.get("JSEventListeners") ?? 0,
    documents: byName.get("Documents") ?? 0,
  };
}

function describe(sample: Sample): string {
  return `heap ${(sample.usedSize / MiB).toFixed(2)} MiB + ${(sample.backingBytes / MiB).toFixed(2)} MiB buffers, ${sample.nodes} nodes, ${sample.listeners} listeners, ${sample.documents} docs`;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

async function runCase(name: CaseName, options: Options, profile: Profile, serverUrl: string): Promise<void> {
  const session = await openSession(options, serverUrl, name);
  try {
    switch (name) {
      case "mount-unmount":
        await runChurnCase(name, session, options, profile.mountIterations, (n) => `mountUnmount(${n})`, "chart mount/unmount");
        break;
      case "shared-context":
        await runChurnCase(name, session, options, profile.sharedIterations, (n) => `sharedContextChurn(${n})`, "shared-context batches of 25 charts");
        break;
      case "resize-churn":
        await runChurnCase(name, session, options, profile.resizeIterations, (n) => `resizeChurn(${n})`, "resize");
        break;
      case "series-churn":
        await runChurnCase(name, session, options, profile.seriesIterations, (n) => `seriesChurn(${n})`, "series add/remove");
        break;
      case "streaming":
        await runStreamingCase(session, options, profile);
        break;
      case "shared-context-loss":
        await runContextLossCase(session, options, profile, name, "sharedContextLoss");
        break;
      case "context-loss":
        await runContextLossCase(session, options, profile);
        break;
      case "detector-control":
        await runDetectorControl(session);
        break;
    }
    assertQuiet(name, session);
  } finally {
    session.cdp.close();
  }
}

/** Page errors, uncaught exceptions, and WebGL context cap warnings fail every case. */
function assertQuiet(name: string, session: Session): void {
  if (session.pageErrors.length) fail(name, `page reported ${session.pageErrors.length} error(s); first: ${session.pageErrors[0]}`);
  if (session.contextCapWarnings > 0) {
    fail(name, `browser warned "Too many active WebGL contexts" ${session.contextCapWarnings} time(s): disposed charts are keeping their WebGL contexts alive`);
  }
}

interface Tolerance {
  heapBytes: number;
  nodes: number;
  listeners: number;
  documents: number;
}

function toleranceFor(iterations: number): Tolerance {
  return {
    // A leaked chart retains DOM, closures, and typed arrays worth far more than this per iteration.
    heapBytes: 2 * MiB + iterations * 2 * KiB,
    nodes: 40,
    listeners: 40,
    documents: 0,
  };
}

/**
 * Run `iterations` of one lifecycle workload in chunks. Heap and DOM counters are sampled after a
 * forced GC at the baseline (post warm-up) and after every chunk.
 */
async function runChurnCase(
  name: string,
  session: Session,
  options: Options,
  iterations: number,
  call: (count: number) => string,
  label: string,
): Promise<void> {
  const chunks = 4;
  const perChunk = Math.max(1, Math.round(iterations / chunks));
  const budgetMs = Math.max(options.timeoutMs, iterations * 400);

  // Warm up shader compilation, JIT, and lazily created caches so they are not mistaken for growth.
  await page<WorkloadResult>(session, call(Math.max(10, Math.round(iterations / 10))), budgetMs);
  const baseProbe = await probe(session);
  const baseline = await settle(session.cdp);
  if (options.verbose) console.log(`  [${name}] baseline: ${describe(baseline)}`);

  const samples: Sample[] = [baseline];
  let totalMs = 0;
  let totalRenders = 0;
  // Probed before the forced GC on purpose: contexts that only disappear once GC runs are the leak.
  let finalProbe = baseProbe;
  for (let chunk = 0; chunk < chunks; chunk++) {
    const result = await page<WorkloadResult>(session, call(perChunk), budgetMs);
    totalMs += result.ms;
    totalRenders += result.renders;
    finalProbe = await probe(session);
    const sample = await settle(session.cdp);
    samples.push(sample);
    if (options.verbose) console.log(`  [${name}] after ${(chunk + 1) * perChunk} ${label} iterations: ${describe(sample)}`);
  }
  const final = samples[samples.length - 1]!;
  const total = perChunk * chunks;

  const tolerance = toleranceFor(total);
  const growth = {
    heapBytes: final.heapBytes - baseline.heapBytes,
    nodes: final.nodes - baseline.nodes,
    listeners: final.listeners - baseline.listeners,
    documents: final.documents - baseline.documents,
  };

  check(name, growth.heapBytes <= tolerance.heapBytes, `JS heap grew ${(growth.heapBytes / MiB).toFixed(2)} MiB over ${total} ${label} iterations (limit ${(tolerance.heapBytes / MiB).toFixed(2)} MiB); baseline ${describe(baseline)}, final ${describe(final)}`);
  check(name, growth.nodes <= tolerance.nodes, `DOM node count grew by ${growth.nodes} (limit ${tolerance.nodes})`);
  check(name, growth.listeners <= tolerance.listeners, `JS event listener count grew by ${growth.listeners} (limit ${tolerance.listeners})`);
  check(name, growth.documents <= tolerance.documents, `document count grew by ${growth.documents}`);
  assertProbeAtBaseline(name, baseProbe, finalProbe);
  check(name, totalRenders > 0, "workload never rendered a frame");

  record(name, {
    iterations: total,
    renders: totalRenders,
    msPerIteration: Number((totalMs / total).toFixed(2)),
    baseline,
    final,
    growth,
    tolerance,
    gl: finalProbe.gl,
  });
  console.log(`${okMark(name)} ${name}: ${total} ${label} iterations, heap ${fmtSigned(growth.heapBytes)}, nodes ${fmtInt(growth.nodes)}, listeners ${fmtInt(growth.listeners)}, live GL buffers/programs ${finalProbe.gl.buffer}/${finalProbe.gl.program}, live contexts ${finalProbe.gl.liveContexts}`);
}

/** Exact page counters: nothing may remain after the chart is disposed. */
function assertProbeAtBaseline(name: string, baseline: PageProbe, final: PageProbe): void {
  check(name, final.elements === baseline.elements, `document element count changed ${baseline.elements} -> ${final.elements}`);
  check(name, final.canvases === 0, `${final.canvases} canvas element(s) remain in the document`);
  check(name, final.stageChildren === 0, `${final.stageChildren} chart host(s) remain mounted`);
  for (const kind of ["buffer", "program", "shader", "vertexArray", "texture", "framebuffer", "renderbuffer"] as const) {
    check(name, final.gl[kind] === 0, `${final.gl[kind]} live WebGL ${kind} object(s) remain after every chart was disposed`);
  }
  check(name, final.gl.liveContexts === 0, `${final.gl.liveContexts} WebGL context(s) are still live (not lost) after every chart was disposed; disposed charts must release their context instead of waiting for GC`);
}

async function runStreamingCase(session: Session, options: Options, profile: Profile): Promise<void> {
  const name = "streaming";
  const config: StreamingConfig = {
    series: profile.streamSeries,
    capacity: profile.streamCapacity,
    batch: profile.streamBatch,
    tickMs: 16,
    plugins: true,
  };
  const emptyProbe = await probe(session);
  const started = await page<StreamingStats>(session, `startStreaming(${JSON.stringify(config)})`, 60_000);
  check(name, started.retainedSamples === config.series * config.capacity, `ring buffers hold ${started.retainedSamples} samples after prefill, expected ${config.series * config.capacity}`);

  // Wrap every buffer at least once before sampling so the baseline is steady state, not fill-up.
  const expectedPerSecond = config.batch * (1000 / config.tickMs);
  const warmupS = Math.min(Math.max(3, (config.capacity / expectedPerSecond) * 1.25), profile.streamDurationS / 2);
  await sleep(warmupS * 1000);
  const baseProbe = await probe(session);
  const baseline = await settle(session.cdp);
  const baselineStats = await page<StreamingStats>(session, "streamingStats()", 10_000);
  if (options.verbose) console.log(`  [${name}] baseline after ${warmupS.toFixed(1)}s: ${describe(baseline)}`);

  const samples: Array<{ t: number; sample: Sample }> = [{ t: 0, sample: baseline }];
  const startedAt = Date.now();
  while ((Date.now() - startedAt) / 1000 < profile.streamDurationS) {
    await sleep(profile.streamSampleEveryS * 1000);
    const sample = await settle(session.cdp);
    const t = (Date.now() - startedAt) / 1000;
    samples.push({ t, sample });
    if (options.verbose) console.log(`  [${name}] t=${t.toFixed(0)}s: ${describe(sample)}`);
  }

  const stats = await page<StreamingStats>(session, "streamingStats()", 10_000);
  const midProbe = await probe(session);
  const final = samples[samples.length - 1]!.sample;
  const growth = final.heapBytes - baseline.heapBytes;
  const slope = slopeBytesPerSecond(samples.map(({ t, sample }) => [t, sample.heapBytes] as const));
  const appendedInWindow = (stats.appendedPerSeries - baselineStats.appendedPerSeries) * config.series;

  const growthLimit = 6 * MiB;
  const slopeLimit = 32 * KiB;
  check(name, stats.running, "streaming workload stopped on its own");
  check(name, stats.appendedPerSeries >= config.capacity * 2, `only ${stats.appendedPerSeries} samples per series were appended; buffers never wrapped twice, so the test did not exercise steady state`);
  check(name, stats.retainedSamples === config.series * config.capacity, `ring buffers hold ${stats.retainedSamples} samples, expected exactly ${config.series * config.capacity} (capacity)`);
  check(name, stats.renders > baselineStats.renders, "chart stopped rendering while data streamed in");
  check(name, growth <= growthLimit, `JS heap grew ${(growth / MiB).toFixed(2)} MiB over ${profile.streamDurationS}s of streaming at capacity (limit ${(growthLimit / MiB).toFixed(2)} MiB); ${describe(baseline)} -> ${describe(final)}`);
  // A short window is too noisy for a trend line; the soak mode has enough points to fit one.
  if (samples.length >= 8) check(name, slope <= slopeLimit, `JS heap trend is +${(slope / KiB).toFixed(1)} KiB/s over ${profile.streamDurationS}s (limit ${(slopeLimit / KiB).toFixed(0)} KiB/s): memory grows with streamed samples instead of staying bounded by the ring buffers`);
  check(name, midProbe.gl.buffer === baseProbe.gl.buffer && midProbe.gl.program === baseProbe.gl.program && midProbe.gl.texture === baseProbe.gl.texture,
    `live WebGL objects changed while streaming: buffers ${baseProbe.gl.buffer} -> ${midProbe.gl.buffer}, programs ${baseProbe.gl.program} -> ${midProbe.gl.program}, textures ${baseProbe.gl.texture} -> ${midProbe.gl.texture}`);
  check(name, final.nodes - baseline.nodes <= 40, `DOM node count grew by ${final.nodes - baseline.nodes} while streaming`);
  check(name, final.listeners - baseline.listeners <= 40, `JS event listener count grew by ${final.listeners - baseline.listeners} while streaming`);

  const stopped = await page<StreamingStats>(session, "stopStreaming()", 10_000);
  const afterProbe = await probe(session);
  const afterStop = await settle(session.cdp);
  assertProbeAtBaseline(name, emptyProbe, afterProbe);
  check(name, !stopped.running, "stopStreaming did not stop the stream");

  record(name, {
    durationS: profile.streamDurationS,
    config,
    appendedSamplesInWindow: appendedInWindow,
    samplesPerSecond: Math.round(appendedInWindow / profile.streamDurationS),
    renders: stats.renders,
    baseline,
    final,
    afterStop,
    growthBytes: growth,
    slopeBytesPerSecond: Math.round(slope),
    series: samples.map(({ t, sample }) => ({ t: Number(t.toFixed(1)), heapBytes: sample.heapBytes, usedSize: sample.usedSize, backingBytes: sample.backingBytes })),
  });
  console.log(`${okMark(name)} ${name}: ${profile.streamDurationS}s at capacity (${config.series}x${config.capacity}), ${Math.round(appendedInWindow / profile.streamDurationS)} samples/s, heap ${fmtSigned(growth)} (trend ${(slope / KiB).toFixed(1)} KiB/s), ${stats.renders} renders`);
}

/** Least-squares slope in bytes per second. */
function slopeBytesPerSecond(points: ReadonlyArray<readonly [number, number]>): number {
  const n = points.length;
  if (n < 2) return 0;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of points) {
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

async function runContextLossCase(session: Session, options: Options, profile: Profile, name = "context-loss", fn = "contextLoss"): Promise<void> {
  // Warm up once so the baseline already contains shader caches and the first restore path.
  await page<ContextLossResult>(session, `${fn}(1)`, 60_000);
  const baseProbe = await probe(session);
  const baseline = await settle(session.cdp);

  const result = await page<ContextLossResult>(session, `${fn}(${profile.contextCycles})`, Math.max(options.timeoutMs, profile.contextCycles * 10_000));
  const finalProbe = await probe(session);
  const final = await settle(session.cdp);

  check(name, result.lostEvents === profile.contextCycles, `saw ${result.lostEvents} webglcontextlost events, expected ${profile.contextCycles}`);
  check(name, result.restoredEvents === profile.contextCycles, `saw ${result.restoredEvents} webglcontextrestored events, expected ${profile.contextCycles}`);
  check(name, result.rendersAfterRestore >= profile.contextCycles, `chart rendered ${result.rendersAfterRestore} frame(s) after ${profile.contextCycles} restores`);
  check(name, result.drawCallsAfterRestore > 0, "restored chart issued no draw calls");
  check(name, result.litPixelsAfterRestore > 0, "restored chart produced only blank frames");
  check(name, result.disposedWhileLost, "dispose-while-lost scenario did not run");
  assertProbeAtBaseline(name, baseProbe, finalProbe);
  check(name, final.nodes - baseline.nodes <= 40, `DOM node count grew by ${final.nodes - baseline.nodes} across context loss cycles`);
  check(name, final.listeners - baseline.listeners <= 40, `JS event listener count grew by ${final.listeners - baseline.listeners} across context loss cycles`);
  check(name, final.heapBytes - baseline.heapBytes <= 2 * MiB + profile.contextCycles * 64 * KiB, `JS heap grew ${((final.heapBytes - baseline.heapBytes) / MiB).toFixed(2)} MiB across ${profile.contextCycles} context loss cycles`);

  record(name, { ...result, baseline, final, gl: finalProbe.gl });
  console.log(`${okMark(name)} ${name}: ${result.cycles} lose/restore cycles recovered and rendered (${result.drawCallsAfterRestore} draw calls), live GL buffers/programs ${finalProbe.gl.buffer}/${finalProbe.gl.program}`);
}

/**
 * Prove the measurements can see a leak: retain charts on purpose and require the same counters to
 * move, then release them and require the baseline back. A harness that cannot fail proves nothing.
 */
async function runDetectorControl(session: Session): Promise<void> {
  const name = "detector-control";
  const retained = 10;
  await page<WorkloadResult>(session, "mountUnmount(5)", 60_000);
  const baseProbe = await probe(session);
  const baseline = await settle(session.cdp);

  await page<WorkloadResult>(session, `mountRetained(${retained})`, 60_000);
  const leakedProbe = await probe(session);
  const leaked = await settle(session.cdp);
  const nodeGrowth = leaked.nodes - baseline.nodes;
  const listenerGrowth = leaked.listeners - baseline.listeners;

  check(name, leakedProbe.stageChildren === retained, `control expected ${retained} mounted charts, found ${leakedProbe.stageChildren}`);
  check(name, leakedProbe.elements - baseProbe.elements >= retained * 10, "page element counter did not detect retained charts");
  check(name, nodeGrowth >= retained * 10, `engine DOM node counter grew only ${nodeGrowth} for ${retained} retained charts; the leak check cannot detect leaks`);
  check(name, listenerGrowth >= retained * 3, `engine listener counter grew only ${listenerGrowth} for ${retained} retained charts; the leak check cannot detect leaks`);
  check(name, leaked.heapBytes - baseline.heapBytes > 64 * KiB, "JS heap measurement did not move for retained charts");
  check(name, leakedProbe.gl.buffer > 0, "live WebGL buffer counter did not detect retained charts");

  const released = await page<number>(session, "releaseRetained()", 10_000);
  check(name, released === retained, `released ${released} charts, expected ${retained}`);
  const afterProbe = await probe(session);
  const after = await settle(session.cdp);
  assertProbeAtBaseline(name, baseProbe, afterProbe);
  check(name, after.nodes - baseline.nodes <= 40, `DOM nodes did not return to baseline after release (+${after.nodes - baseline.nodes})`);

  record(name, { retained, baseline, leaked, after, nodeGrowth, listenerGrowth });
  console.log(`${okMark(name)} ${name}: ${retained} retained charts moved nodes +${nodeGrowth}, listeners +${listenerGrowth}, heap ${fmtSigned(leaked.heapBytes - baseline.heapBytes)}; all returned to baseline after release`);
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

function check(caseName: string, condition: boolean, message: string): void {
  if (!condition) fail(caseName, message);
}

function fail(caseName: string, message: string): void {
  failures.push({ case: caseName, message });
  console.error(`✗ ${caseName}: ${message}`);
}

function record(caseName: string, details: Record<string, unknown>): void {
  reports.push({ case: caseName, ok: !failures.some((failure) => failure.case === caseName), details });
}

function okMark(caseName: string): string {
  return failures.some((failure) => failure.case === caseName) ? "✗" : "✓";
}

function fmtSigned(bytes: number): string {
  return `${bytes >= 0 ? "+" : "-"}${(Math.abs(bytes) / KiB).toFixed(0)} KiB`;
}

function fmtInt(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = {
    long: false,
    cases: [...ALL_CASES],
    durationS: 0,
    width: 900,
    height: 600,
    port: 41735,
    debugPort: 9227,
    timeoutMs: 60_000,
    outDir: "build/stability",
    verbose: false,
    keepBrowser: false,
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
      case "--long": parsed.long = true; break;
      case "--duration-s": parsed.durationS = readPositiveInteger(flag, readValue()); break;
      case "--case": case "--cases": {
        const names = readValue().split(",").map((value) => value.trim()).filter(Boolean);
        for (const name of names) if (!(ALL_CASES as readonly string[]).includes(name)) throw new Error(`Unknown case ${name}. Cases: ${ALL_CASES.join(", ")}`);
        parsed.cases = names;
        break;
      }
      case "--width": parsed.width = readPositiveInteger(flag, readValue()); break;
      case "--height": parsed.height = readPositiveInteger(flag, readValue()); break;
      case "--port": parsed.port = readPositiveInteger(flag, readValue()); break;
      case "--debug-port": parsed.debugPort = readPositiveInteger(flag, readValue()); break;
      case "--timeout-ms": parsed.timeoutMs = readPositiveInteger(flag, readValue()); break;
      case "--out-dir": parsed.outDir = readValue(); break;
      case "--url": parsed.url = readValue(); break;
      case "--chrome": parsed.chrome = readValue(); break;
      case "--verbose": parsed.verbose = true; break;
      case "--keep-browser": parsed.keepBrowser = true; break;
      case "--help": case "-h": printHelpAndExit(); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run test:stability [options]

Real-browser leak and stability tests: chart mount/unmount, resize churn, series add/remove churn,
streaming at ring-buffer capacity, and WebGL context loss/restore. Needs Chrome/Chromium/Brave.

Options:
  --long             Local soak: more iterations and a 90s streaming run (CI mode is the default).
  --duration-s <n>   Streaming duration in seconds (overrides the mode default).
  --case <a,b>       Run only these cases: ${ALL_CASES.join(", ")}.
  --verbose          Print every heap/DOM sample, not just the verdicts.
  --out-dir <dir>    Where report.json is written (default build/stability).
  --chrome <path>    Browser executable (or set BLAZEPLOT_BENCH_CHROME / CHROME_PATH).
  --url <url>        Use an already running fixture server.
  --keep-browser     Leave Chrome running afterwards.
`);
  process.exit(0);
}

function launchChrome(chromePath: string, userDataDir: string, opts: Options): Bun.Subprocess {
  const cmd = [
    chromePath,
    "--headless=new",
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${opts.width},${opts.height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "about:blank",
  ];
  return spawnChrome(cmd);
}
