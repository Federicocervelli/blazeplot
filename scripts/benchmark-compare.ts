#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import officialConfig from "./benchmark-config.json";
import { REPORT_SCHEMA_VERSION, aggregateValues, readmeSummaryLines, renderReportMarkdown } from "./benchmark-compare-report.js";
import type { AggregatedMetric, CompareReport, LibraryResult, MetricDefinition, ScenarioResult } from "./benchmark-compare-report.js";
import { CdpClient, attachConsoleLogging, evaluate, readNonNegativeInteger as readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, waitForHttp } from "./browser-harness.js";

interface Options {
  scenarios: string[];
  libraries: string[];
  runs: number;
  width: number;
  height: number;
  port: number;
  debugPort: number;
  setupTimeoutMs: number;
  runTimeoutMs: number;
  initialDelayMs: number;
  setupWarmupRuns: number;
  outDir: string;
  url?: string;
  chrome?: string;
  scale: number;
  measureMs?: number;
  warmupMs?: number;
  headless: boolean;
  keepBrowser: boolean;
  dev: boolean;
  smoke: boolean;
  baseline?: string;
  noBaseline: boolean;
  aggregateOnly?: string;
}

interface BrowserVersion {
  protocolVersion?: string;
  product?: string;
  revision?: string;
  userAgent?: string;
  jsVersion?: string;
}

interface PageEnvironment {
  userAgent: string;
  devicePixelRatio: number;
  hardwareConcurrency: number;
  screen: { width: number; height: number; colorDepth: number };
  webglVendor: string | null;
  webglRenderer: string | null;
  webglVersion: string | null;
  headlessUserAgent: boolean;
  gcExposed: boolean;
}

/** What one page load reports (see tests/browser/compare/main.ts). */
interface RunRecord {
  scenario: string;
  library: string;
  runIndex: number;
  ok: boolean;
  error?: string;
  metrics: Record<string, number>;
  details: Record<string, number | string | boolean | null>;
  params?: { width: number; height: number; points: number; visible: number; seriesCount: number; scale: number };
  environment?: PageEnvironment;
}

interface ScenarioConfig {
  name: string;
  group: string;
  title: string;
  label?: string;
  headline?: boolean;
  metrics: string[];
  primary: string;
  notes?: string[];
  skip?: Record<string, string>;
}

const SCENARIO_CONFIGS = officialConfig.scenarios as ScenarioConfig[];
const OFFICIAL_SCENARIOS = SCENARIO_CONFIGS.map((entry) => entry.name);
const OFFICIAL_LIBRARIES = officialConfig.libraries;
const METRICS = officialConfig.metrics as Record<string, MetricDefinition>;
const DEFAULT_BASELINE = "benchmarks/baseline-before-perf-pass.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });
  const rawPath = join(options.outDir, "latest-runs.jsonl");

  let records: RunRecord[];
  let browserVersion: BrowserVersion = {};
  let executable = "unknown";
  if (options.aggregateOnly) {
    records = (await readFile(options.aggregateOnly, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunRecord);
    const meta = records.find((record) => (record as unknown as { meta?: unknown }).meta) as unknown as { meta?: { browser: BrowserVersion; executable: string } } | undefined;
    browserVersion = meta?.meta?.browser ?? {};
    executable = meta?.meta?.executable ?? "unknown";
    records = records.filter((record) => record.scenario);
  } else {
    await writeFile(rawPath, "");
    const collected = await collectRuns(options, rawPath);
    records = collected.records;
    browserVersion = collected.browser;
    executable = collected.executable;
  }

  const report = await createReport(options, executable, browserVersion, records);
  const baseline = await loadBaseline(options);
  await writeFile(join(options.outDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(options.outDir, "latest.md"), renderReportMarkdown(report, { baseline }));

  const { scoreboard, summary } = readmeSummaryLines(report);
  process.stdout.write(`${scoreboard.join("\n")}\n\n${summary}\n`);
  console.error(`\nWrote ${join(options.outDir, "latest.json")} and ${join(options.outDir, "latest.md")} (raw runs: ${rawPath})`);
  if (report.warnings.length > 0) console.error(`Warnings:\n- ${report.warnings.join("\n- ")}`);
}

// --------------------------------------------------------------------- driving

async function collectRuns(options: Options, rawPath: string): Promise<{ records: RunRecord[]; browser: BrowserVersion; executable: string }> {
  let viteProc: Bun.Subprocess | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;
  const records: RunRecord[] = [];

  try {
    let serverUrl = options.url;
    if (!serverUrl) {
      if (options.dev) {
        viteProc = startVite(options.port);
        serverUrl = `http://127.0.0.1:${options.port}`;
        await waitForHttp(serverUrl, 30_000);
      } else {
        await buildSite();
        server = serveSite(resolve("build/compare-site"), options.port);
        serverUrl = `http://127.0.0.1:${options.port}`;
      }
    }

    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-compare-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);
    const version = await (await fetch(`http://127.0.0.1:${options.debugPort}/json/version`)).json() as BrowserVersion & { webSocketDebuggerUrl: string };
    const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
    const browserVersion = await browser.send("Browser.getVersion") as BrowserVersion;
    await appendFile(rawPath, `${JSON.stringify({ meta: { browser: browserVersion, executable: basename(chromePath) } })}\n`);

    try {
      await warmGpuProcess(browser, options, serverUrl);
      const scenarios = options.scenarios.map((name) => SCENARIO_CONFIGS.find((entry) => entry.name === name)).filter((entry): entry is ScenarioConfig => entry !== undefined);
      let totalPages = 0;
      for (const scenario of scenarios) totalPages += options.libraries.filter((id) => !scenario.skip?.[id]).length * options.runs;
      let completed = 0;
      const startedAt = Date.now();

      for (const [scenarioIndex, scenario] of scenarios.entries()) {
        for (let runIndex = 0; runIndex < options.runs; runIndex++) {
          // Rotate the library order every run so no library is always first (or last) on a warm GPU process.
          const runnable = options.libraries.filter((id) => !scenario.skip?.[id]);
          const offset = (runIndex + scenarioIndex) % Math.max(1, runnable.length);
          const order = [...runnable.slice(offset), ...runnable.slice(0, offset)];
          for (const library of order) {
            const record = await runPage(browser, options, serverUrl, scenario.name, library, runIndex);
            records.push(record);
            await appendFile(rawPath, `${JSON.stringify(record)}\n`);
            completed++;
            const elapsedMin = (Date.now() - startedAt) / 60_000;
            const etaMin = (elapsedMin / completed) * (totalPages - completed);
            console.error(`[${completed}/${totalPages}] ${scenario.name} / ${library} run ${runIndex + 1}/${options.runs}: ${record.ok ? summarizeRecord(scenario, record) : `FAILED ${record.error?.split("\n")[0]}`} (eta ${etaMin.toFixed(1)} min)`);
          }
        }
      }
      return { records, browser: browserVersion, executable: basename(chromePath) };
    } finally {
      browser.close();
    }
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (viteProc) viteProc.kill();
    server?.stop(true);
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
}

function summarizeRecord(scenario: ScenarioConfig, record: RunRecord): string {
  const id = scenario.primary;
  const value = record.metrics[id];
  return `${id}=${typeof value === "number" ? value.toFixed(2) : "n/a"}`;
}

async function buildSite(): Promise<void> {
  console.error("Building the comparison page (production bundle)...");
  const proc = Bun.spawn({ cmd: ["node", "node_modules/vite/bin/vite.js", "build", "--config", "vite.compare.config.ts", "--logLevel", "warn"], stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`vite build of the comparison page failed with exit code ${code}`);
}

/** Static server with cross-origin isolation headers, which give performance.now() microsecond resolution. */
function serveSite(root: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(root) || !existsSync(file)) return new Response("not found", { status: 404 });
      const type = contentType(extname(file));
      return new Response(Bun.file(file), {
        headers: {
          "Content-Type": type,
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
          "Cache-Control": "no-store",
        },
      });
    },
  });
}

function contentType(extension: string): string {
  switch (extension) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": case ".mjs": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

/** Start the GPU process and compile its shared state once, so run 1 of the first scenario is not special. */
async function warmGpuProcess(browser: CdpClient, options: Options, serverUrl: string): Promise<void> {
  const record = await runPage(browser, options, serverUrl, "line-100k-static", "blazeplot", -1, 0.01);
  if (!record.ok) throw new Error(`GPU warmup page failed: ${record.error}`);
}

async function runPage(browser: CdpClient, options: Options, serverUrl: string, scenario: string, library: string, runIndex: number, scaleOverride?: number): Promise<RunRecord> {
  const url = new URL("/compare/", serverUrl);
  url.searchParams.set("scenario", scenario);
  url.searchParams.set("library", library);
  url.searchParams.set("width", String(options.width));
  url.searchParams.set("height", String(options.height));
  url.searchParams.set("setupWarmupRuns", String(options.setupWarmupRuns));
  const scale = scaleOverride ?? options.scale;
  if (scale !== 1) url.searchParams.set("scale", String(scale));
  if (options.measureMs !== undefined) url.searchParams.set("measureMs", String(options.measureMs));
  if (options.warmupMs !== undefined) url.searchParams.set("warmupMs", String(options.warmupMs));

  const failed = (error: string): RunRecord => ({ scenario, library, runIndex, ok: false, error, metrics: {}, details: {} });
  let contextId: string | null = null;
  let cdp: CdpClient | null = null;
  try {
    // A new browser context gives the page its own renderer process and heap, like a freshly opened incognito window.
    const context = await browser.send("Target.createBrowserContext", { disposeOnDetach: true }) as { browserContextId: string };
    contextId = context.browserContextId;
    const target = await browser.send("Target.createTarget", { url: "about:blank", browserContextId: contextId, newWindow: true }) as { targetId: string };
    cdp = await CdpClient.connect(`ws://127.0.0.1:${options.debugPort}/devtools/page/${target.targetId}`);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    // Pin the layout viewport and device pixel ratio so every library plots into the same pixels on every run.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: options.width + 40, height: options.height + 320, deviceScaleFactor: 1, mobile: false });
    const pageErrors: string[] = [];
    attachConsoleLogging(cdp, pageErrors, `${scenario}/${library}`);
    await cdp.send("Page.navigate", { url: url.toString() });

    await waitForState(cdp, "ready", options.setupTimeoutMs, pageErrors);
    if (options.initialDelayMs > 0) await sleep(options.initialDelayMs);
    const result = await withTimeout(evaluate(cdp, "window.__blazeplotCompare.start()", true), options.runTimeoutMs, `${scenario}/${library} run`) as Omit<RunRecord, "runIndex"> & { ok: boolean };
    if (pageErrors.length > 0 && result.ok) return failed(`Page threw: ${pageErrors[0]}`);
    return { ...result, runIndex };
  } catch (caught) {
    return failed(caught instanceof Error ? caught.message : String(caught));
  } finally {
    cdp?.close();
    if (contextId) await browser.send("Target.disposeBrowserContext", { browserContextId: contextId }).catch(() => undefined);
  }
}

async function waitForState(cdp: CdpClient, desired: string, timeoutMs: number, pageErrors: readonly string[]): Promise<void> {
  const startedAt = Date.now();
  let last: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate(cdp, "window.__blazeplotCompare ? window.__blazeplotCompare.snapshot() : null", false).catch(() => null);
    const snapshot = last as { state?: string; error?: string } | null;
    if (snapshot?.state === desired) return;
    if (snapshot?.state === "error") throw new Error(`Benchmark page failed: ${snapshot.error ?? "unknown error"}`);
    if (pageErrors.length > 0) throw new Error(`Benchmark page threw: ${pageErrors[0]}`);
    await sleep(100);
  }
  throw new Error(`Timed out waiting for state '${desired}'. Last snapshot: ${JSON.stringify(last)}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms: ${label}`)), ms);
    promise.then((value) => { clearTimeout(timer); resolvePromise(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function launchChrome(chromePath: string, userDataDir: string, opts: Options): Bun.Subprocess {
  const cmd = [
    chromePath,
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${opts.width + 80},${opts.height + 380}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-dev-shm-usage",
    "--js-flags=--expose-gc",
    "--enable-precise-memory-info",
    "--force-device-scale-factor=1",
    "--disable-frame-rate-limit",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    ...(opts.smoke ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] : []),
    ...(platform() === "linux" ? ["--ozone-platform=x11"] : []),
    "about:blank",
  ];
  if (opts.headless) cmd.splice(1, 0, "--headless=new");
  return spawnChrome(cmd);
}

// ------------------------------------------------------------------- reporting

async function createReport(options: Options, executable: string, browser: BrowserVersion, records: RunRecord[]): Promise<CompareReport> {
  const scenarios: ScenarioResult[] = [];
  for (const name of options.scenarios) {
    const config = SCENARIO_CONFIGS.find((entry) => entry.name === name);
    if (!config) continue;
    const results: LibraryResult[] = options.libraries.map((library) => aggregateLibrary(config, library, records.filter((record) => record.scenario === name && record.library === library), options));
    const firstParams = records.find((record) => record.scenario === name && record.params)?.params;
    scenarios.push({
      name,
      title: config.title,
      ...(config.label ? { label: config.label } : {}),
      ...(config.headline ? { headline: true } : {}),
      group: config.group,
      primary: config.primary,
      metricIds: config.metrics,
      ...(config.notes ? { notes: config.notes } : {}),
      ...(firstParams ? { params: firstParams } : {}),
      results,
    });
  }

  const pageEnvironment = records.find((record) => record.ok && record.environment)?.environment;
  const warnings = collectWarnings(options, scenarios, records, pageEnvironment);
  const libraries = await readLibraryInfo();
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    command: ["bun run bench:compare", ...process.argv.slice(2)].join(" "),
    publishable: warnings.length === 0,
    warnings,
    noiseFloor: officialConfig.noiseFloor,
    metrics: METRICS,
    options: {
      scenarios: options.scenarios,
      libraries: options.libraries,
      width: options.width,
      height: options.height,
      runs: options.runs,
      setupWarmupRuns: options.setupWarmupRuns,
      headed: !options.headless,
      ...(options.scale !== 1 ? { scale: options.scale } : {}),
    },
    environment: {
      machine: collectMachineInfo(),
      browser,
      executable,
      page: {
        userAgent: pageEnvironment?.userAgent ?? "",
        devicePixelRatio: pageEnvironment?.devicePixelRatio ?? 0,
        webglRenderer: pageEnvironment?.webglRenderer ?? null,
        headlessUserAgent: pageEnvironment?.headlessUserAgent ?? false,
      },
    },
    libraries,
    scenarios,
  };
}

function aggregateLibrary(config: ScenarioConfig, library: string, records: RunRecord[], options: Options): LibraryResult {
  const skipped = config.skip?.[library];
  if (skipped) return { library, ok: false, skipped, runsRequested: 0, runsSucceeded: 0, runsFailed: 0, errors: [], metrics: {}, details: {} };
  const good = records.filter((record) => record.ok);
  const metrics: Record<string, AggregatedMetric> = {};
  for (const metricId of config.metrics) {
    const values = good.map((record) => record.metrics[metricId]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (values.length > 0) metrics[metricId] = aggregateValues(values);
  }
  const details: Record<string, number | string | boolean | null> = {};
  const detailKeys = new Set(good.flatMap((record) => Object.keys(record.details)));
  for (const key of detailKeys) {
    const values = good.map((record) => record.details[key]).filter((value) => value !== undefined);
    const numeric = values.filter((value): value is number => typeof value === "number");
    details[key] = numeric.length === values.length && numeric.length > 0 ? aggregateValues(numeric).median : (values[values.length - 1] ?? null);
  }
  return {
    library,
    ok: good.length > 0 && Object.keys(metrics).length > 0,
    runsRequested: options.runs,
    runsSucceeded: good.length,
    runsFailed: records.length - good.length,
    errors: [...new Set(records.filter((record) => !record.ok).map((record) => record.error ?? "unknown error"))],
    metrics,
    details,
  };
}

function collectWarnings(options: Options, scenarios: ScenarioResult[], records: RunRecord[], environment: PageEnvironment | undefined): string[] {
  const warnings: string[] = [];
  if (options.smoke) warnings.push("Smoke run with scaled-down data on software rendering; not a publishable measurement.");
  if (options.headless || environment?.headlessUserAgent) warnings.push("Browser was headless; public comparison numbers should be collected headed.");
  if (environment?.webglRenderer && isSoftwareRenderer(environment.webglRenderer)) {
    warnings.push(`WebGL renderer appears to be software (${environment.webglRenderer}); use a real GPU for publishable numbers.`);
  }
  if (!environment?.webglRenderer) warnings.push("Could not read a WebGL renderer string for the benchmark environment.");
  if (environment && !environment.gcExposed) warnings.push("window.gc() was not exposed, so heap numbers are not settled.");
  if (environment && environment.devicePixelRatio !== 1) warnings.push(`Device pixel ratio was ${environment.devicePixelRatio}, expected 1.`);
  if (options.scale !== 1) warnings.push(`Data sizes were scaled by ${options.scale}.`);
  if (options.runs < officialConfig.minRuns) warnings.push(`Only ${options.runs} run(s) per scenario and library; at least ${officialConfig.minRuns} are required for a publishable result.`);
  if (options.measureMs !== undefined || options.warmupMs !== undefined) warnings.push("Measurement or warmup duration was overridden.");

  const missingLibraries = OFFICIAL_LIBRARIES.filter((library) => !options.libraries.includes(library));
  if (missingLibraries.length > 0) warnings.push(`Run did not include every official comparison library: missing ${missingLibraries.join(", ")}.`);
  const missingScenarios = OFFICIAL_SCENARIOS.filter((scenario) => !options.scenarios.includes(scenario));
  if (missingScenarios.length > 0) warnings.push(`Run did not include every official comparison scenario: missing ${missingScenarios.join(", ")}.`);

  const failedRuns = scenarios.flatMap((scenario) => scenario.results.filter((result) => !result.ok && !result.skipped).map((result) => `${scenario.name}/${result.library}`));
  if (failedRuns.length > 0) warnings.push(`One or more library benchmark runs failed: ${failedRuns.join(", ")}.`);
  const partial = scenarios.flatMap((scenario) => scenario.results.filter((result) => result.ok && result.runsFailed > 0).map((result) => `${scenario.name}/${result.library}`));
  if (partial.length > 0) warnings.push(`Some runs failed and were excluded from the median: ${partial.join(", ")}.`);

  const hoverInactive = records.filter((record) => record.ok && record.scenario.startsWith("hover-1m") && record.details.hoverActive === false).map((record) => record.library);
  if (hoverInactive.length > 0) warnings.push(`Hover feedback was not active at the end of the hover scenario for: ${[...new Set(hoverInactive)].join(", ")}.`);

  // All libraries must plot into (nearly) the same rectangle or the comparison is not like for like.
  for (const scenario of scenarios) {
    const sizes = scenario.results.filter((result) => result.ok && typeof result.details.plotWidth === "number").map((result) => ({ library: result.library, width: result.details.plotWidth as number, height: result.details.plotHeight as number }));
    if (sizes.length < 2) continue;
    const widths = sizes.map((entry) => entry.width);
    const heights = sizes.map((entry) => entry.height);
    if (Math.max(...widths) - Math.min(...widths) > 4 || Math.max(...heights) - Math.min(...heights) > 4) {
      warnings.push(`Plot areas differ between libraries in ${scenario.name}: ${sizes.map((entry) => `${entry.library} ${entry.width}x${entry.height}`).join(", ")}.`);
    }
  }
  return warnings;
}

function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|software|mesa offscreen|softpipe/i.test(renderer);
}

async function loadBaseline(options: Options): Promise<CompareReport | null> {
  if (options.noBaseline) return null;
  const path = resolve(options.baseline ?? DEFAULT_BASELINE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as CompareReport;
    return parsed.schemaVersion === REPORT_SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

async function readLibraryInfo(): Promise<Record<string, { name: string; version: string }>> {
  const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
    version?: string;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const installed = async (name: string, fallback: string | undefined): Promise<string> => {
    try {
      const manifest = JSON.parse(await readFile(resolve("node_modules", name, "package.json"), "utf8")) as { version?: string };
      return manifest.version ?? cleanVersion(fallback);
    } catch {
      return cleanVersion(fallback);
    }
  };
  return {
    blazeplot: { name: "BlazePlot", version: pkg.version ?? "local" },
    "blazeplot-canvas2d": { name: "BlazePlot (Canvas 2D)", version: pkg.version ?? "local" },
    uplot: { name: "uPlot", version: await installed("uplot", deps.uplot) },
    chartjs: { name: "Chart.js", version: await installed("chart.js", deps["chart.js"]) },
  };
}

function cleanVersion(value: string | undefined): string {
  return value?.replace(/^[~^]/, "") ?? "unknown";
}

function collectMachineInfo(): CompareReport["environment"]["machine"] {
  const cpuList = cpus();
  return {
    label: process.env.BLAZEPLOT_BENCH_MACHINE ?? "local machine",
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuModel: cpuList[0]?.model ?? "unknown CPU",
    cpuCount: cpuList.length,
    totalMemoryBytes: totalmem(),
  };
}

// --------------------------------------------------------------------- options

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = {
    scenarios: [...OFFICIAL_SCENARIOS],
    libraries: [...OFFICIAL_LIBRARIES],
    runs: officialConfig.runs,
    width: 1280,
    height: 720,
    port: 41732,
    debugPort: 9224,
    setupTimeoutMs: 120_000,
    runTimeoutMs: 300_000,
    initialDelayMs: 300,
    setupWarmupRuns: 1,
    outDir: "benchmarks",
    scale: 1,
    headless: false,
    keepBrowser: false,
    dev: false,
    smoke: false,
    noBaseline: false,
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
      case "--scenario":
      case "--scenarios":
        parsed.scenarios = readCsv(readValue());
        break;
      case "--library":
      case "--libraries":
        parsed.libraries = readCsv(readValue());
        break;
      case "--runs":
        parsed.runs = readPositiveInteger(flag, readValue());
        break;
      case "--measure-ms":
        parsed.measureMs = readPositiveInteger(flag, readValue());
        break;
      case "--warmup-ms":
        parsed.warmupMs = readPositiveInteger(flag, readValue());
        break;
      case "--scale":
        parsed.scale = Number(readValue());
        if (!(parsed.scale > 0)) throw new Error("--scale expects a positive number");
        break;
      case "--width":
        parsed.width = readPositiveInteger(flag, readValue());
        break;
      case "--height":
        parsed.height = readPositiveInteger(flag, readValue());
        break;
      case "--port":
        parsed.port = readPositiveInteger(flag, readValue());
        break;
      case "--debug-port":
        parsed.debugPort = readPositiveInteger(flag, readValue());
        break;
      case "--setup-timeout-ms":
        parsed.setupTimeoutMs = readPositiveInteger(flag, readValue());
        break;
      case "--run-timeout-ms":
        parsed.runTimeoutMs = readPositiveInteger(flag, readValue());
        break;
      case "--initial-delay-ms":
        parsed.initialDelayMs = readPositiveInteger(flag, readValue());
        break;
      case "--setup-warmup-runs":
        parsed.setupWarmupRuns = readPositiveInteger(flag, readValue());
        break;
      case "--out-dir":
        parsed.outDir = readValue();
        break;
      case "--url":
        parsed.url = readValue();
        break;
      case "--chrome":
        parsed.chrome = readValue();
        break;
      case "--baseline":
        parsed.baseline = readValue();
        break;
      case "--no-baseline":
        parsed.noBaseline = true;
        break;
      case "--aggregate-only":
        parsed.aggregateOnly = readValue();
        break;
      case "--dev":
        parsed.dev = true;
        break;
      case "--smoke":
        parsed.smoke = true;
        break;
      case "--headless":
        parsed.headless = true;
        break;
      case "--keep-browser":
        parsed.keepBrowser = true;
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.smoke) {
    // CI-friendly self test of the harness: software GL, headless, tiny data, one run, nothing published.
    parsed.headless = true;
    if (!args.some((arg) => arg.startsWith("--runs"))) parsed.runs = 1;
    if (!args.some((arg) => arg.startsWith("--scale"))) parsed.scale = 0.01;
    if (!args.some((arg) => arg.startsWith("--out-dir"))) parsed.outDir = "build/compare-smoke";
    if (!args.some((arg) => arg.startsWith("--width"))) parsed.width = 800;
    if (!args.some((arg) => arg.startsWith("--height"))) parsed.height = 450;
    parsed.noBaseline = true;
  }

  const unknownScenarios = parsed.scenarios.filter((name) => !OFFICIAL_SCENARIOS.includes(name));
  if (unknownScenarios.length > 0) throw new Error(`Unknown scenario(s): ${unknownScenarios.join(", ")}. Known: ${OFFICIAL_SCENARIOS.join(", ")}`);
  const unknownLibraries = parsed.libraries.filter((id) => !OFFICIAL_LIBRARIES.includes(id));
  if (unknownLibraries.length > 0) throw new Error(`Unknown library: ${unknownLibraries.join(", ")}. Known: ${OFFICIAL_LIBRARIES.join(", ")}`);
  if (parsed.scenarios.length === 0) throw new Error("At least one scenario is required.");
  if (parsed.libraries.length === 0) throw new Error("At least one library is required.");
  if (parsed.runs < 1) throw new Error("--runs must be at least 1.");
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run bench:compare [options]

Runs the public comparison suite (BlazePlot WebGL and Canvas 2D, uPlot, Chart.js) in a headed browser and
overwrites benchmarks/latest.json + benchmarks/latest.md. Every sample is a fresh browser context; each
scenario/library pair is repeated --runs times and the median is reported. Fully automatic after launch.

Options:
  --scenario <name[,name]>   Scenario(s) to run (default: all ${OFFICIAL_SCENARIOS.length}: ${OFFICIAL_SCENARIOS.join(", ")})
  --library <name[,name]>    Libraries to run (default: ${OFFICIAL_LIBRARIES.join(", ")}; all are required for a publishable result)
  --runs <n>                 Fresh-page runs per scenario and library (default: ${officialConfig.runs}; fewer is non-publishable)
  --scale <factor>           Scale data sizes (debug only; non-publishable)
  --measure-ms <ms>          Override measurement duration (debug only; non-publishable)
  --warmup-ms <ms>           Override warmup duration (debug only; non-publishable)
  --width <px>               Chart width in CSS pixels (default: 1280)
  --height <px>              Chart height in CSS pixels (default: 720)
  --port <port>              Static/Vite server port (default: 41732)
  --debug-port <port>        Chrome DevTools port (default: 9224)
  --setup-timeout-ms <ms>    Page readiness timeout (default: 120000)
  --run-timeout-ms <ms>      Per-page measurement timeout (default: 300000)
  --initial-delay-ms <ms>    Settle delay after page ready before running (default: 300)
  --setup-warmup-runs <n>    Discarded full-size setup runs per page (default: 1)
  --out-dir <path>           Output directory (default: benchmarks)
  --baseline <path>          Report to compare against (default: ${DEFAULT_BASELINE} when present)
  --no-baseline              Skip the baseline comparison section
  --aggregate-only <jsonl>   Rebuild the report from a previous latest-runs.jsonl without running a browser
  --url <url>                Use an already-running server instead of building and serving the page
  --dev                      Serve the page from the Vite dev server instead of a production build
  --chrome <path>            Chrome/Chromium/Brave executable path
  --smoke                    Harness self-test: headless software GL, tiny data, one run, writes build/compare-smoke
  --headless                 Debug-only: run headless and mark the result non-publishable
  --keep-browser             Leave browser profile/process around for debugging

Set BLAZEPLOT_BENCH_CHROME to the browser executable; for a real-GPU run use a Chrome/Chromium that has hardware WebGL2.
`);
  process.exit(0);
}

function readCsv(raw: string): string[] {
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

void main();
