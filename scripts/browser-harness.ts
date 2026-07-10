import { existsSync } from "node:fs";

interface CdpResponse {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string; data?: string };
}

interface RemoteObjectResult {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

/** Minimal Chrome DevTools Protocol client shared by browser scripts. */
export class CdpClient {
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

export function readPositiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} expects a positive integer, got ${raw}`);
  return value;
}

export function readNonNegativeInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} expects a non-negative integer, got ${raw}`);
  return value;
}

export function startVite(port: number): Bun.Subprocess {
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

export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
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

export async function createTarget(debugPort: number, url: string): Promise<{ webSocketDebuggerUrl: string }> {
  const endpoint = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(endpoint, { method: "PUT" });
  if (!response.ok) response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Could not create Chrome target: HTTP ${response.status}`);
  const payload = await response.json() as { webSocketDebuggerUrl?: string };
  if (!payload.webSocketDebuggerUrl) throw new Error("Chrome target response did not include webSocketDebuggerUrl");
  return { webSocketDebuggerUrl: payload.webSocketDebuggerUrl };
}

export async function evaluate(cdp: CdpClient, expression: string, awaitPromise: boolean): Promise<unknown> {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: false }) as RemoteObjectResult;
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Runtime.evaluate failed");
  return response.result?.value;
}

export function attachConsoleLogging(cdp: CdpClient, pageErrors: string[], label?: string): void {
  const prefix = label ? `page:${label}` : "page";
  cdp.on("Runtime.consoleAPICalled", (params) => {
    const event = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
    const text = event.args?.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ") ?? "";
    if (text) process.stderr.write(`[${prefix}:${event.type ?? "log"}] ${text}\n`);
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    const text = JSON.stringify(params);
    pageErrors.push(text);
    process.stderr.write(`[${prefix}:exception] ${text}\n`);
  });
}

export function throwIfPageErrored(pageErrors: readonly string[]): void {
  if (pageErrors.length) throw new Error(`Benchmark page threw ${pageErrors.length} exception(s). First exception: ${pageErrors[0]}`);
}

export function resolveChrome(explicit: string | undefined): string {
  const envPath = explicit ?? process.env.BLAZEPLOT_BENCH_CHROME ?? process.env.CHROME_PATH;
  if (envPath) {
    if (!existsSync(envPath)) throw new Error(`Chrome executable does not exist: ${envPath}`);
    return envPath;
  }

  for (const candidate of [
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
  ]) {
    if (candidate.startsWith("/") && existsSync(candidate)) return candidate;
    if (!candidate.startsWith("/")) {
      const proc = Bun.spawnSync({ cmd: ["which", candidate], stdout: "pipe", stderr: "ignore" });
      if (proc.exitCode === 0 && proc.stdout.toString().trim()) return proc.stdout.toString().trim();
    }
  }

  throw new Error("Could not find Chrome/Chromium/Brave. Pass --chrome <path> or set BLAZEPLOT_BENCH_CHROME.");
}

export function spawnChrome(cmd: string[]): Bun.Subprocess {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  drain(proc.stdout, "chrome");
  drain(proc.stderr, "chrome");
  return proc;
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
