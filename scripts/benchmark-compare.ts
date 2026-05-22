#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { basename, join, resolve } from "node:path";

interface Options {
  scenarios: string[];
  libraries: string[];
  width: number;
  height: number;
  port: number;
  debugPort: number;
  setupTimeoutMs: number;
  initialDelayMs: number;
  setupWarmupRuns: number;
  outDir: string;
  url?: string;
  chrome?: string;
  measureMs?: number;
  warmupMs?: number;
  headless: boolean;
  keepBrowser: boolean;
}

interface CdpResponse {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string; data?: string };
}

interface RemoteObjectResult {
  result?: { value?: unknown; description?: string; subtype?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

interface CompareSnapshot {
  state: "prewarming" | "ready" | "running" | "done" | "error";
  progress: number;
  result: PageBenchmarkResult | null;
  error: string | null;
}

interface BrowserVersion {
  protocolVersion?: string;
  product?: string;
  revision?: string;
  userAgent?: string;
  jsVersion?: string;
}

interface NumericSummary {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
}

interface MeasurementResult {
  durationMs: number;
  frames: number;
  rafFps: number;
  rafFrameMs: NumericSummary;
  updateMs: NumericSummary;
  chartFrameMs?: NumericSummary;
  pointsRendered?: NumericSummary;
  drawCalls?: NumericSummary;
  uploadBytes?: NumericSummary;
  samplesAppended: number;
}

interface LibraryResult {
  library: string;
  ok: boolean;
  readyMs?: number;
  heapBeforeBytes?: number | null;
  heapAfterReadyBytes?: number | null;
  heapAfterMeasureBytes?: number | null;
  firstFrame?: {
    fps?: number;
    frameMs?: number;
    pointsRendered?: number;
    drawCalls?: number;
    uploadBytes?: number;
    renderMode?: string;
  };
  measurement?: MeasurementResult;
  error?: string;
}

interface ScenarioResult {
  name: string;
  title: string;
  operation: "static" | "pan" | "stream";
  sampleCount: number;
  viewportSamples: number;
  measureMs: number;
  warmupMs: number;
  streamBatchSize?: number;
  dataPrepMs: number;
  results: LibraryResult[];
}

interface BrowserEnvironment {
  userAgent: string;
  language: string;
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  screen: { width: number; height: number; colorDepth: number };
  webglVendor: string | null;
  webglRenderer: string | null;
  webglVersion: string | null;
  headlessUserAgent: boolean;
}

interface PageBenchmarkResult {
  environment: BrowserEnvironment;
  canvas: { width: number; height: number };
  libraries: string[];
  prewarmMs?: number;
  scenarios: ScenarioResult[];
}

interface MachineInfo {
  label: string;
  platform: string;
  release: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
}

interface LibraryInfo {
  name: string;
  version: string;
}

const OFFICIAL_SCENARIOS = ["line-100k-static", "line-1m-static", "line-1m-pan", "line-1m-stream", "line-10m-pan"] as const;
const OFFICIAL_LIBRARIES = ["blazeplot", "uplot", "chartjs"] as const;
const RUNTIME_COMPARISONS = [
  { primaryLibrary: "blazeplot", referenceLibrary: "uplot" },
] as const;

interface CompareReport {
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  publishable: boolean;
  warnings: string[];
  options: {
    scenarios: string[];
    libraries: string[];
    width: number;
    height: number;
    measureMs?: number;
    warmupMs?: number;
    initialDelayMs: number;
    setupWarmupRuns: number;
    headed: boolean;
  };
  environment: {
    machine: MachineInfo;
    browser: BrowserVersion;
    executable: string;
    page: BrowserEnvironment;
  };
  prewarmMs?: number;
  libraries: Record<string, LibraryInfo>;
  scenarios: ScenarioResult[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  const benchUrl = new URL("/compare/", serverUrl);
  benchUrl.searchParams.set("scenarios", options.scenarios.join(","));
  benchUrl.searchParams.set("libraries", options.libraries.join(","));
  benchUrl.searchParams.set("width", String(options.width));
  benchUrl.searchParams.set("height", String(options.height));
  benchUrl.searchParams.set("setupWarmupRuns", String(options.setupWarmupRuns));
  if (options.measureMs !== undefined) benchUrl.searchParams.set("measureMs", String(options.measureMs));
  if (options.warmupMs !== undefined) benchUrl.searchParams.set("warmupMs", String(options.warmupMs));

  let viteProc: Bun.Subprocess | null = null;
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;

  try {
    if (!options.url) {
      viteProc = startVite(options.port);
      await waitForHttp(serverUrl, 30_000);
    }

    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-compare-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    const target = await createTarget(options.debugPort, benchUrl.toString());
    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      const pageErrors: string[] = [];
      attachConsoleLogging(cdp, pageErrors);
      await waitForBenchmarkState(cdp, "ready", options.setupTimeoutMs);
      throwIfPageErrored(pageErrors);
      if (options.initialDelayMs > 0) await sleep(options.initialDelayMs);
      throwIfPageErrored(pageErrors);

      const browserVersion = await cdp.send("Browser.getVersion") as BrowserVersion;
      const pageResult = await evaluate(cdp, "window.__blazeplotCompare.start()", true) as PageBenchmarkResult;
      throwIfPageErrored(pageErrors);

      const report = await createReport(options, chromePath, browserVersion, pageResult);
      await writeLatestResults(options.outDir, report);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      console.error(`\nWrote ${join(options.outDir, "latest.json")} and ${join(options.outDir, "latest.md")}`);
      if (report.warnings.length > 0) {
        console.error(`Warnings:\n- ${report.warnings.join("\n- ")}`);
      }
    } finally {
      cdp.close();
    }
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (viteProc) viteProc.kill();
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true });
  }
}

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = {
    scenarios: [...OFFICIAL_SCENARIOS],
    libraries: [...OFFICIAL_LIBRARIES],
    width: 1280,
    height: 720,
    port: 41732,
    debugPort: 9224,
    setupTimeoutMs: 600_000,
    initialDelayMs: 1_000,
    setupWarmupRuns: 1,
    outDir: "benchmarks",
    headless: false,
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
      case "--scenario":
      case "--scenarios":
        parsed.scenarios = readCsv(readValue());
        break;
      case "--library":
      case "--libraries":
        parsed.libraries = readCsv(readValue());
        break;
      case "--measure-ms":
        parsed.measureMs = readPositiveInteger(flag, readValue());
        break;
      case "--warmup-ms":
        parsed.warmupMs = readPositiveInteger(flag, readValue());
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

  if (parsed.scenarios.length === 0) throw new Error("At least one scenario is required.");
  if (parsed.libraries.length === 0) throw new Error("At least one library is required.");
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run bench:compare [options]\n\nRuns the public comparison suite in a headed browser by default and overwrites benchmarks/latest.json + benchmarks/latest.md. No user interaction is required after launch.\n\nOptions:\n  --scenario <name[,name]>   Scenario(s) to run (default: line-100k-static,line-1m-static,line-1m-pan,line-1m-stream,line-10m-pan)\n  --library <name[,name]>    Libraries to run (default: blazeplot,uplot,chartjs)\n  --measure-ms <ms>          Override non-static scenario measurement duration\n  --warmup-ms <ms>           Override scenario warmup duration\n  --width <px>               Chart width in CSS pixels (default: 1280)\n  --height <px>              Chart height in CSS pixels (default: 720)\n  --port <port>              Vite server port (default: 41732)\n  --debug-port <port>        Chrome DevTools port (default: 9224)\n  --setup-timeout-ms <ms>    Page readiness timeout (default: 600000)\n  --initial-delay-ms <ms>    Settle delay after page ready before running (default: 1000)\n  --setup-warmup-runs <n>    Discarded setup runs before each measured library/scenario (default: 1)\n  --out-dir <path>           Output directory (default: benchmarks)\n  --url <url>                Use an already-running Vite server instead of starting one\n  --chrome <path>            Chrome/Chromium/Brave executable path\n  --headless                 Debug-only: run headless and mark the result non-publishable\n  --keep-browser             Leave browser profile/process around for debugging\n`);
  process.exit(0);
}

function readCsv(raw: string): string[] {
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function readPositiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new Error(`${flag} expects a non-negative integer, got ${raw}`);
  }
  return value;
}

async function createReport(options: Options, chromePath: string, browser: BrowserVersion, pageResult: PageBenchmarkResult): Promise<CompareReport> {
  const warnings = collectWarnings(options, pageResult);
  const libraries = await readLibraryInfo();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: ["bun run bench:compare", ...process.argv.slice(2)].join(" "),
    publishable: warnings.length === 0,
    warnings,
    options: {
      scenarios: options.scenarios,
      libraries: options.libraries,
      width: options.width,
      height: options.height,
      measureMs: options.measureMs,
      warmupMs: options.warmupMs,
      initialDelayMs: options.initialDelayMs,
      setupWarmupRuns: options.setupWarmupRuns,
      headed: !options.headless,
    },
    environment: {
      machine: collectMachineInfo(),
      browser,
      executable: basename(chromePath),
      page: pageResult.environment,
    },
    prewarmMs: pageResult.prewarmMs,
    libraries,
    scenarios: pageResult.scenarios,
  };
}

async function readLibraryInfo(): Promise<Record<string, LibraryInfo>> {
  const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
    version?: string;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return {
    blazeplot: { name: "BlazePlot", version: pkg.version ?? "local" },
    uplot: { name: "uPlot", version: cleanVersion(deps.uplot) },
    chartjs: { name: "Chart.js", version: cleanVersion(deps["chart.js"]) },
  };
}

function cleanVersion(value: string | undefined): string {
  return value?.replace(/^[~^]/, "") ?? "unknown";
}

function collectMachineInfo(): MachineInfo {
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

function collectWarnings(options: Options, pageResult: PageBenchmarkResult): string[] {
  const warnings: string[] = [];
  const environment = pageResult.environment;
  if (options.headless || environment.headlessUserAgent) warnings.push("Browser was headless; public comparison numbers should be collected headed.");
  if (environment.webglRenderer && isSoftwareRenderer(environment.webglRenderer)) {
    warnings.push(`WebGL renderer appears to be software (${environment.webglRenderer}); use a real GPU for publishable numbers.`);
  }
  if (!environment.webglRenderer) warnings.push("Could not read a WebGL renderer string for the benchmark environment.");

  const missingLibraries = OFFICIAL_LIBRARIES.filter((library) => !options.libraries.includes(library));
  if (missingLibraries.length > 0) warnings.push(`Run did not include every official comparison library: missing ${missingLibraries.join(", ")}.`);
  const missingScenarios = OFFICIAL_SCENARIOS.filter((scenario) => !options.scenarios.includes(scenario));
  if (missingScenarios.length > 0) warnings.push(`Run did not include every official comparison scenario: missing ${missingScenarios.join(", ")}.`);

  const failedRuns = pageResult.scenarios.flatMap((scenario) => scenario.results
    .filter((result) => !result.ok)
    .map((result) => `${scenario.name}/${result.library}`));
  if (failedRuns.length > 0) warnings.push(`One or more library benchmark runs failed: ${failedRuns.join(", ")}.`);
  return warnings;
}

function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|software|mesa offscreen|softpipe/i.test(renderer);
}

async function writeLatestResults(outDir: string, report: CompareReport): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outDir, "latest.md"), renderMarkdown(report));
}

function renderMarkdown(report: CompareReport): string {
  const lines: string[] = [
    "# Latest BlazePlot comparison benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    `Command: \`${report.command}\``,
    `Publishable: ${report.publishable ? "yes" : "no"}`,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:", ...report.warnings.map((warning) => `- ${warning}`));
  }

  lines.push(
    "",
    "## Environment",
    "",
    `- Machine: ${report.environment.machine.label}; ${report.environment.machine.cpuModel}; ${report.environment.machine.cpuCount} logical CPUs; ${formatBytes(report.environment.machine.totalMemoryBytes)} RAM`,
    `- OS: ${report.environment.machine.platform} ${report.environment.machine.release} ${report.environment.machine.arch}`,
    `- Browser: ${report.environment.browser.product ?? report.environment.page.userAgent}`,
    `- Executable: ${report.environment.executable}`,
    `- GPU/WebGL: ${report.environment.page.webglRenderer ?? "unknown"}`,
    `- Canvas: ${report.options.width}×${report.options.height} CSS px; DPR ${report.environment.page.devicePixelRatio}`,
    `- Library prewarm: ${report.prewarmMs !== undefined ? `${fixed(report.prewarmMs, 1)} ms before measured runs` : "not recorded"}`,
    `- Setup warmup runs: ${report.options.setupWarmupRuns} discarded run(s) before each measured library/scenario`,
    "",
    "## Scenario data preparation",
    "",
    "| Scenario | Samples | Visible samples | Data prep ms |",
    "|---|---:|---:|---:|",
  );

  for (const scenario of report.scenarios) {
    lines.push(`| ${escapeMd(scenario.name)} | ${integer(scenario.sampleCount)} | ${integer(scenario.viewportSamples)} | ${fixed(scenario.dataPrepMs, 1)} |`);
  }

  lines.push(
    "",
    "## Initial chart ready time",
    "",
    "Ready time includes library chart construction plus the first browser frame after shared scenario data has been prepared. Each displayed row follows the discarded setup warmup run(s) recorded in the environment section.",
    "",
    "| Scenario | Library | Version | Ready ms | Heap after ready | First frame details |",
    "|---|---|---:|---:|---:|---|",
  );

  for (const scenario of report.scenarios) {
    for (const result of scenario.results) {
      const library = report.libraries[result.library] ?? { name: result.library, version: "unknown" };
      lines.push(`| ${escapeMd(scenario.name)} | ${escapeMd(library.name)} | ${escapeMd(library.version)} | ${result.ok ? fixed(result.readyMs ?? 0, 1) : "failed"} | ${formatNullableBytes(result.heapAfterReadyBytes)} | ${escapeMd(firstFrameDetails(result))} |`);
    }
  }

  lines.push(
    "",
    "## Automated pan and streaming measurements",
    "",
    "These rows are collected without user interaction after the command starts. RAF columns measure browser frame cadence. Work columns use BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call.",
    "",
    "| Scenario | Library | RAF FPS | RAF p95 ms | Work p50 ms | Work p95 ms | Points p50 | Draws p50 | Appended | Heap after measure |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"
  );

  for (const scenario of report.scenarios.filter((entry) => entry.operation !== "static")) {
    for (const result of scenario.results) {
      const library = report.libraries[result.library] ?? { name: result.library, version: "unknown" };
      const measurement = result.measurement;
      const work = workSummary(result);
      lines.push([
        scenario.name,
        library.name,
        measurement ? fixed(measurement.rafFps, 1) : result.ok ? "—" : "failed",
        measurement ? fixed(measurement.rafFrameMs.p95, 2) : "—",
        work ? fixed(work.p50, 2) : "—",
        work ? fixed(work.p95, 2) : "—",
        measurement?.pointsRendered ? integer(measurement.pointsRendered.p50) : "—",
        measurement?.drawCalls ? fixed(measurement.drawCalls.p50, 0) : "—",
        measurement ? integer(measurement.samplesAppended) : "—",
        formatNullableBytes(result.heapAfterMeasureBytes),
      ].map(escapeMd).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }

  for (const runtimeComparison of runtimeComparisonTables(report)) {
    const { primaryLabel, referenceLabel } = runtimeComparison;
    lines.push(
      "",
      `## ${primaryLabel} vs ${referenceLabel} runtime delta`,
      "",
      `Higher ratios favor ${primaryLabel}. FPS ratio is ${primaryLabel} RAF FPS divided by ${referenceLabel} RAF FPS; work ratio is ${referenceLabel} p95 work time divided by ${primaryLabel} p95 work time.`,
      "",
      `| Scenario | FPS ratio | Work p95 ratio | ${primaryLabel} FPS | ${referenceLabel} FPS | ${primaryLabel} work p95 | ${referenceLabel} work p95 |`,
      "|---|---:|---:|---:|---:|---:|---:|",
      ...runtimeComparison.rows,
    );
  }

  lines.push("", "## Failures", "");
  const failures = report.scenarios.flatMap((scenario) => scenario.results
    .filter((result) => !result.ok)
    .map((result) => `- ${scenario.name} / ${result.library}: ${result.error ?? "unknown error"}`));
  if (failures.length > 0) lines.push(...failures);
  else lines.push("No library runs failed.");

  lines.push("", "");
  return lines.join("\n");
}

function workSummary(result: LibraryResult): NumericSummary | undefined {
  const measurement = result.measurement;
  return measurement?.chartFrameMs ?? measurement?.updateMs;
}

function runtimeComparisonTables(report: CompareReport): Array<{
  primaryLabel: string;
  referenceLabel: string;
  rows: string[];
}> {
  return RUNTIME_COMPARISONS
    .map(({ primaryLibrary, referenceLibrary }) => runtimeComparisonTable(report, primaryLibrary, referenceLibrary))
    .filter((table) => table.rows.length > 0);
}

function runtimeComparisonTable(report: CompareReport, primaryLibraryId: string, referenceLibraryId: string): {
  primaryLabel: string;
  referenceLabel: string;
  rows: string[];
} {
  return {
    primaryLabel: libraryDisplayName(report, primaryLibraryId),
    referenceLabel: libraryDisplayName(report, referenceLibraryId),
    rows: runtimeComparisonRows(report, primaryLibraryId, referenceLibraryId),
  };
}

function runtimeComparisonRows(report: CompareReport, primaryLibraryId: string, referenceLibraryId: string): string[] {
  return report.scenarios
    .filter((scenario) => scenario.operation !== "static")
    .flatMap((scenario) => {
      const primary = scenario.results.find((result) => result.library === primaryLibraryId);
      const reference = scenario.results.find((result) => result.library === referenceLibraryId);
      const primaryMeasurement = primary?.measurement;
      const referenceMeasurement = reference?.measurement;
      const primaryWork = primary ? workSummary(primary) : undefined;
      const referenceWork = reference ? workSummary(reference) : undefined;
      if (!primary?.ok || !reference?.ok || !primaryMeasurement || !referenceMeasurement || !primaryWork || !referenceWork) return [];
      return [formatMarkdownRow([
        scenario.name,
        formatRatio(primaryMeasurement.rafFps / referenceMeasurement.rafFps),
        formatRatio(referenceWork.p95 / primaryWork.p95),
        fixed(primaryMeasurement.rafFps, 1),
        fixed(referenceMeasurement.rafFps, 1),
        fixed(primaryWork.p95, 2),
        fixed(referenceWork.p95, 2),
      ])];
    });
}

function libraryDisplayName(report: CompareReport, libraryId: string): string {
  return report.libraries[libraryId]?.name ?? libraryId;
}

function formatMarkdownRow(cells: readonly string[]): string {
  return cells.map(escapeMd).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function formatRatio(value: number): string {
  return Number.isFinite(value) && value > 0 ? `${fixed(value, 2)}×` : "—";
}

function firstFrameDetails(result: LibraryResult): string {
  if (!result.ok) return result.error ?? "failed";
  const frame = result.firstFrame;
  if (!frame) return "—";
  const details = [];
  if (frame.renderMode) details.push(frame.renderMode);
  if (typeof frame.frameMs === "number") details.push(`${fixed(frame.frameMs, 2)} ms render`);
  if (typeof frame.pointsRendered === "number") details.push(`${integer(frame.pointsRendered)} pts`);
  if (typeof frame.drawCalls === "number") details.push(`${fixed(frame.drawCalls, 0)} draws`);
  return details.join(", ") || "—";
}

function startVite(port: number): Bun.Subprocess {
  const proc = Bun.spawn({
    cmd: ["bunx", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BLAZEPLOT_BENCH: "1" },
  });
  drain(proc.stdout, "vite");
  drain(proc.stderr, "vite");
  return proc;
}

function launchChrome(chromePath: string, userDataDir: string, opts: Options): Bun.Subprocess {
  const cmd = [
    chromePath,
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${opts.width + 80},${opts.height + 180}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-dev-shm-usage",
    "--disable-renderer-backgrounding",
    "--js-flags=--expose-gc",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    ...(platform() === "linux" ? ["--ozone-platform=x11"] : []),
    "about:blank",
  ];
  if (opts.headless) cmd.splice(1, 0, "--headless=new");
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  drain(proc.stdout, "chrome");
  drain(proc.stderr, "chrome");
  return proc;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function createTarget(debugPort: number, url: string): Promise<{ webSocketDebuggerUrl: string }> {
  const endpoint = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(endpoint, { method: "PUT" });
  if (!response.ok) response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Could not create Chrome target: HTTP ${response.status}`);
  const payload = await response.json() as { webSocketDebuggerUrl?: string };
  if (!payload.webSocketDebuggerUrl) throw new Error("Chrome target response did not include webSocketDebuggerUrl");
  return { webSocketDebuggerUrl: payload.webSocketDebuggerUrl };
}

async function waitForBenchmarkState(cdp: CdpClient, desiredState: CompareSnapshot["state"], timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate(cdp, "window.__blazeplotCompare?.snapshot?.() ?? null", true) as CompareSnapshot | null;
    if (snapshot?.state === desiredState) return;
    if (snapshot?.state === "error") throw new Error(`Benchmark page failed: ${snapshot.error ?? "unknown error"}`);
    await sleep(250);
  }
  const snapshot = await evaluate(cdp, "window.__blazeplotCompare?.snapshot?.() ?? null", true).catch(() => null);
  throw new Error(`Timed out waiting for comparison benchmark state '${desiredState}'. Last snapshot: ${JSON.stringify(snapshot)}`);
}

async function evaluate(cdp: CdpClient, expression: string, awaitPromise: boolean): Promise<unknown> {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: false,
  }) as RemoteObjectResult;
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return response.result?.value;
}

function attachConsoleLogging(cdp: CdpClient, pageErrors: string[]): void {
  cdp.on("Runtime.consoleAPICalled", (params) => {
    const event = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
    const text = event.args?.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ") ?? "";
    if (text) process.stderr.write(`[page:${event.type ?? "log"}] ${text}\n`);
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    const text = JSON.stringify(params);
    pageErrors.push(text);
    process.stderr.write(`[page:exception] ${text}\n`);
  });
}

function throwIfPageErrored(pageErrors: readonly string[]): void {
  if (pageErrors.length === 0) return;
  throw new Error(`Benchmark page threw ${pageErrors.length} exception(s). First exception: ${pageErrors[0]}`);
}

function resolveChrome(explicit: string | undefined): string {
  const envPath = explicit ?? process.env.BLAZEPLOT_BENCH_CHROME ?? process.env.CHROME_PATH;
  if (envPath) {
    if (!existsSync(envPath)) throw new Error(`Chrome executable does not exist: ${envPath}`);
    return envPath;
  }

  const candidates = [
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium",
    "chrome",
    "brave-browser",
    "brave-browser-stable",
    "brave",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];

  for (const candidate of candidates) {
    if (candidate.startsWith("/") && existsSync(candidate)) return candidate;
    if (!candidate.startsWith("/")) {
      const found = which(candidate);
      if (found) return found;
    }
  }

  throw new Error("Could not find Chrome/Chromium/Brave. Pass --chrome <path> or set BLAZEPLOT_BENCH_CHROME.");
}

function which(command: string): string | null {
  const proc = Bun.spawnSync({ cmd: ["which", command], stdout: "pipe", stderr: "ignore" });
  if (proc.exitCode !== 0) return null;
  const path = proc.stdout.toString().trim();
  return path.length > 0 ? path : null;
}

function drain(stream: ReadableStream<Uint8Array> | null, label: string): void {
  if (!stream) return;
  void (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true }).trimEnd();
      if (text) process.stderr.write(`[${label}] ${text}\n`);
    }
  })();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixed(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function integer(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const gib = 1024 * 1024 * 1024;
  if (value >= gib) return `${(value / gib).toFixed(1)} GiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatNullableBytes(value: number | null | undefined): string {
  return typeof value === "number" ? formatBytes(value) : "—";
}

function escapeMd(value: string | number): string {
  return String(value).replaceAll("|", "\\|");
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  private readonly handlers = new Map<string, Array<(params: unknown) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("CDP socket closed"));
      this.pending.clear();
    });
  }

  static connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    return new Promise((resolvePromise, reject) => {
      socket.addEventListener("open", () => resolvePromise(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Could not connect to CDP websocket ${url}`)), { once: true });
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(method: string, handler: (params: unknown) => void): void {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  close(): void {
    this.socket.close();
  }

  private handleMessage(data: unknown): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
    const message = JSON.parse(text) as CdpResponse;
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ""}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params);
    }
  }
}

void main();
