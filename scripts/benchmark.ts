#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

interface Options {
  scenario: string;
  measureMs?: number;
  warmupMs?: number;
  width: number;
  height: number;
  port: number;
  debugPort: number;
  setupTimeoutMs: number;
  top: number;
  out?: string;
  url?: string;
  chrome?: string;
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

interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount?: number;
  children?: number[];
}

interface BottomUpFrame {
  functionName: string;
  url: string;
  line: number;
  column: number;
  selfMs: number;
  totalMs: number;
  selfSamples: number;
  totalSamples: number;
}

interface BenchmarkSnapshot {
  state: string;
  scenario: string;
  progress: number;
  result: unknown;
  error: string | null;
}

interface PerformanceMetric {
  name: string;
  value: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  const benchUrl = new URL("/bench/", serverUrl);
  benchUrl.searchParams.set("scenario", options.scenario);
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
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-bench-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    const target = await createTarget(options.debugPort, benchUrl.toString());
    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Profiler.enable");
      await cdp.send("Performance.enable");
      attachConsoleLogging(cdp);

      await waitForBenchmarkState(cdp, "ready", options.setupTimeoutMs);
      await cdp.send("Profiler.start");
      const benchmarkResult = await evaluate(cdp, "window.__blazeplotBench.start()", true);
      const profileResponse = await cdp.send("Profiler.stop") as { profile: CpuProfile };
      const metricsResponse = await cdp.send("Performance.getMetrics") as { metrics: PerformanceMetric[] };

      const report = {
        generatedAt: new Date().toISOString(),
        sceneUrl: benchUrl.toString(),
        browser: basename(chromePath),
        benchmark: benchmarkResult,
        performanceMetrics: metricsResponse.metrics,
        profile: summarizeProfile(profileResponse.profile, options.top),
      };

      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (options.out) await writeFile(options.out, json);
      process.stdout.write(json);
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
    scenario: "mixed-1m-live",
    width: 1280,
    height: 720,
    port: 41731,
    debugPort: 9223,
    setupTimeoutMs: 120_000,
    top: 40,
    headless: true,
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
        parsed.scenario = readValue();
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
      case "--top":
        parsed.top = readPositiveInteger(flag, readValue());
        break;
      case "--out":
        parsed.out = readValue();
        break;
      case "--url":
        parsed.url = readValue();
        break;
      case "--chrome":
        parsed.chrome = readValue();
        break;
      case "--headed":
        parsed.headless = false;
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

  return parsed;
}

function readPositiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new Error(`${flag} expects a non-negative integer, got ${raw}`);
  }
  return value;
}

function printHelpAndExit(): never {
  process.stdout.write(`Usage: bun run bench [options]\n\nOptions:\n  --scenario <name>          Benchmark scene scenario (default: mixed-1m-live)\n  --measure-ms <ms>          Override scenario measurement duration\n  --warmup-ms <ms>           Override scenario warmup duration\n  --width <px>               Browser viewport width (default: 1280)\n  --height <px>              Browser viewport height (default: 720)\n  --port <port>              Vite server port (default: 41731)\n  --debug-port <port>        Chrome DevTools port (default: 9223)\n  --setup-timeout-ms <ms>    Max time for data load + warmup (default: 120000)\n  --top <n>                  Number of bottom-up CPU frames to emit (default: 40)\n  --out <path>               Also write JSON report to this path\n  --url <url>                Use an already-running Vite server instead of starting one\n  --chrome <path>            Chrome/Chromium executable path\n  --headed                   Run browser visibly instead of headless\n  --keep-browser             Leave browser profile/process around for debugging\n`);
  process.exit(0);
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
    `--window-size=${opts.width},${opts.height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--use-gl=swiftshader",
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

async function waitForBenchmarkState(cdp: CdpClient, desiredState: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate(cdp, "window.__blazeplotBench?.snapshot?.() ?? null", true) as BenchmarkSnapshot | null;
    if (snapshot?.state === desiredState) return;
    if (snapshot?.state === "error") throw new Error(`Benchmark page failed: ${snapshot.error ?? "unknown error"}`);
    await sleep(250);
  }
  const snapshot = await evaluate(cdp, "window.__blazeplotBench?.snapshot?.() ?? null", true).catch(() => null);
  throw new Error(`Timed out waiting for benchmark state '${desiredState}'. Last snapshot: ${JSON.stringify(snapshot)}`);
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

function attachConsoleLogging(cdp: CdpClient): void {
  cdp.on("Runtime.consoleAPICalled", (params) => {
    const event = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
    const text = event.args?.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ") ?? "";
    if (text) process.stderr.write(`[page:${event.type ?? "log"}] ${text}\n`);
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    process.stderr.write(`[page:exception] ${JSON.stringify(params)}\n`);
  });
}

function summarizeProfile(profile: CpuProfile, top: number): { durationMs: number; sampleCount: number; bottomUp: BottomUpFrame[] } {
  const nodes = new Map<number, CpuProfileNode>();
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    nodes.set(node.id, node);
    for (const child of node.children ?? []) parents.set(child, node.id);
  }

  const samples = profile.samples ?? [];
  const durationUs = Math.max(0, profile.endTime - profile.startTime);
  const fallbackDeltaUs = samples.length > 0 ? durationUs / samples.length : 0;
  const byFrame = new Map<string, BottomUpFrame>();

  for (let i = 0; i < samples.length; i++) {
    const sampleId = samples[i];
    if (sampleId === undefined) continue;
    const deltaMs = ((profile.timeDeltas?.[i] ?? fallbackDeltaUs) / 1000);
    const selfNode = nodes.get(sampleId);
    if (!selfNode) continue;
    addFrame(byFrame, selfNode, deltaMs, true);

    let current: number | undefined = sampleId;
    const seen = new Set<number>();
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const node = nodes.get(current);
      if (node) addFrame(byFrame, node, deltaMs, false);
      current = parents.get(current);
    }
  }

  const bottomUp = [...byFrame.values()]
    .sort((a, b) => b.selfMs - a.selfMs || b.totalMs - a.totalMs)
    .slice(0, top)
    .map((frame) => ({
      ...frame,
      selfMs: round(frame.selfMs),
      totalMs: round(frame.totalMs),
    }));

  return { durationMs: round(durationUs / 1000), sampleCount: samples.length, bottomUp };
}

function addFrame(byFrame: Map<string, BottomUpFrame>, node: CpuProfileNode, deltaMs: number, self: boolean): void {
  const frame = normalizeFrame(node);
  const key = `${frame.functionName}\n${frame.url}\n${frame.line}\n${frame.column}`;
  const current = byFrame.get(key) ?? frame;
  if (self) {
    current.selfMs += deltaMs;
    current.selfSamples += 1;
  } else {
    current.totalMs += deltaMs;
    current.totalSamples += 1;
  }
  byFrame.set(key, current);
}

function normalizeFrame(node: CpuProfileNode): BottomUpFrame {
  const functionName = node.callFrame.functionName || "(anonymous)";
  return {
    functionName,
    url: simplifyUrl(node.callFrame.url),
    line: node.callFrame.lineNumber + 1,
    column: node.callFrame.columnNumber + 1,
    selfMs: 0,
    totalMs: 0,
    selfSamples: 0,
    totalSamples: 0,
  };
}

function simplifyUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
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

  throw new Error("Could not find Chrome/Chromium. Pass --chrome <path> or set BLAZEPLOT_BENCH_CHROME.");
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
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
    return new Promise((resolve, reject) => {
      socket.addEventListener("open", () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Could not connect to CDP websocket ${url}`)), { once: true });
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
