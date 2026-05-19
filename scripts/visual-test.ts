#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

interface Options {
  cases: string[];
  outDir: string;
  width: number;
  height: number;
  port: number;
  debugPort: number;
  timeoutMs: number;
  url?: string;
  chrome?: string;
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
  result?: { value?: unknown; description?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

interface VisualSnapshot {
  state?: string;
  caseName?: string;
  stats?: { drawCalls?: number; pointsRendered?: number; renderMode?: string } | null;
  assertions?: string[];
  error?: string | null;
}

const DEFAULT_CASES = [
  "line",
  "area",
  "scatter",
  "bar",
  "ohlc",
  "candlestick",
  "axes-title-grid",
  "legend",
  "tooltip",
  "crosshair",
  "annotations",
  "selection",
  "navigator",
  "scale-options",
  "overlay-layering",
  "context-restore",
];

await main();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  let viteProc: Bun.Subprocess | null = null;
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;

  try {
    if (!options.url) {
      viteProc = startVite(options.port);
      await waitForHttp(serverUrl, 30_000);
    }

    await rm(options.outDir, { recursive: true, force: true });
    await mkdir(options.outDir, { recursive: true });

    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-visual-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    const summary: Array<{ caseName: string; screenshot: string; chartScreenshotBytes: number; assertions: string[] }> = [];
    for (const caseName of options.cases) {
      const url = new URL("/visual/", serverUrl);
      url.searchParams.set("case", caseName);
      const target = await createTarget(options.debugPort, url.toString());
      const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
      try {
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        const pageErrors: string[] = [];
        attachConsoleLogging(cdp, pageErrors, caseName);
        const snapshot = await waitForVisualReady(cdp, options.timeoutMs);
        if (pageErrors.length > 0) throw new Error(`Page errors in ${caseName}: ${pageErrors[0]}`);
        assertVisualSnapshot(snapshot, caseName);
        const chartScreenshotBytes = await evaluate(cdp, "window.__blazeplotVisualTest.screenshot()", true) as number;
        if (!Number.isFinite(chartScreenshotBytes) || chartScreenshotBytes <= 1_000) {
          throw new Error(`chart.screenshot() for ${caseName} returned ${chartScreenshotBytes} bytes`);
        }
        const screenshotPath = join(options.outDir, `${caseName}.png`);
        await saveScreenshot(cdp, screenshotPath);
        summary.push({ caseName, screenshot: screenshotPath, chartScreenshotBytes, assertions: snapshot.assertions ?? [] });
        console.log(`✓ ${caseName}: ${(snapshot.assertions ?? []).join(", ")}`);
      } finally {
        cdp.close();
      }
    }

    const reportPath = join(options.outDir, "summary.json");
    await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), browser: basename(chromePath), cases: summary }, null, 2)}\n`);
    console.log(`Visual test screenshots written to ${options.outDir}`);
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (viteProc) viteProc.kill();
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true });
  }
}

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = {
    cases: DEFAULT_CASES,
    outDir: "build/visual-tests",
    width: 900,
    height: 520,
    port: 41732,
    debugPort: 9224,
    timeoutMs: 30_000,
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
      case "--case":
      case "--cases":
        parsed.cases = readValue().split(",").map((value) => value.trim()).filter(Boolean);
        break;
      case "--out-dir":
        parsed.outDir = readValue();
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
      case "--timeout-ms":
        parsed.timeoutMs = readPositiveInteger(flag, readValue());
        break;
      case "--url":
        parsed.url = readValue();
        break;
      case "--chrome":
        parsed.chrome = readValue();
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

function printHelpAndExit(): never {
  console.log(`Usage: bun run test:visual [options]\n\nOptions:\n  --cases <a,b>          Comma-separated visual cases\n  --out-dir <path>       Screenshot/report output directory\n  --width <px>           Browser width\n  --height <px>          Browser height\n  --port <port>          Vite port\n  --debug-port <port>    Chrome DevTools port\n  --timeout-ms <ms>      Per-case timeout\n  --url <url>            Use already-running server\n  --chrome <path>        Chrome/Chromium/Brave executable\n  --keep-browser         Keep browser profile/process\n`);
  process.exit(0);
}

function readPositiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) throw new Error(`${flag} expects a positive integer, got ${raw}`);
  return value;
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
  ];
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

async function waitForVisualReady(cdp: CdpClient, timeoutMs: number): Promise<VisualSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate(cdp, "window.__blazeplotVisualTest?.snapshot?.() ?? null", true) as VisualSnapshot | null;
    if (snapshot?.state === "ready") return snapshot;
    if (snapshot?.state === "error") throw new Error(`Visual page failed: ${snapshot.error ?? "unknown error"}`);
    await sleep(150);
  }
  const snapshot = await evaluate(cdp, "window.__blazeplotVisualTest?.snapshot?.() ?? null", true).catch(() => null);
  throw new Error(`Timed out waiting for visual test. Last snapshot: ${JSON.stringify(snapshot)}`);
}

function assertVisualSnapshot(snapshot: VisualSnapshot, caseName: string): void {
  if (snapshot.caseName !== caseName) throw new Error(`Expected case ${caseName}, got ${snapshot.caseName ?? "unknown"}`);
  if (!snapshot.stats) throw new Error(`Missing frame stats for ${caseName}`);
  if ((snapshot.stats.drawCalls ?? 0) <= 0) throw new Error(`No draw calls for ${caseName}`);
  if ((snapshot.stats.pointsRendered ?? 0) <= 0) throw new Error(`No rendered points for ${caseName}`);
  if (snapshot.stats.renderMode === "none") throw new Error(`No render mode for ${caseName}`);
}

async function evaluate(cdp: CdpClient, expression: string, awaitPromise: boolean): Promise<unknown> {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: false }) as RemoteObjectResult;
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Runtime.evaluate failed");
  return response.result?.value;
}

async function saveScreenshot(cdp: CdpClient, path: string): Promise<void> {
  const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }) as { data?: string };
  if (!response.data) throw new Error("Page.captureScreenshot returned no data");
  await writeFile(path, Buffer.from(response.data, "base64"));
}

function attachConsoleLogging(cdp: CdpClient, pageErrors: string[], label: string): void {
  cdp.on("Runtime.consoleAPICalled", (params) => {
    const event = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
    const text = event.args?.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ") ?? "";
    if (text) process.stderr.write(`[page:${label}:${event.type ?? "log"}] ${text}\n`);
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    const text = JSON.stringify(params);
    pageErrors.push(text);
    process.stderr.write(`[page:${label}:exception] ${text}\n`);
  });
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

  private handleMessage(raw: string | BufferSource): void {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const message = JSON.parse(text) as CdpResponse;
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params);
    }
  }
}
