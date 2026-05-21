#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Options {
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

interface RectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ViewportSnapshot {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface InteractionSnapshot {
  state?: string;
  caseName?: string;
  viewport: ViewportSnapshot;
  initialViewport: ViewportSnapshot;
  canvasRect: RectSnapshot;
  xAxisRect: RectSnapshot;
  yAxisRect: RectSnapshot;
  hoverItems: number;
  hoverEvents: number;
  crosshairMoves: number;
  selectionCommits: number;
  selectionBounds: ViewportSnapshot | null;
  visibleCrosshairs: number;
  visibleTooltips: number;
  crosshairX: number | null;
  tooltipLeft: number | null;
  renderEvents: number;
  error?: string | null;
}

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

    const chromePath = resolveChrome(options.chrome);
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-interaction-chrome-"));
    chromeProc = launchChrome(chromePath, userDataDir, options);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    await runInteractionsCase(options, serverUrl);
    await runSelectionCase(options, serverUrl);
    await runLinkedCase(options, serverUrl);
    await runMobileCase(options, serverUrl);
    await runMobileLongPressCase(options, serverUrl);
    await runLifecycleCase(options, serverUrl);
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (viteProc) viteProc.kill();
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true });
  }
}

async function runLifecycleCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "lifecycle");
  try {
    const snapshot = await waitForReady(cdp, options.timeoutMs);
    await sleep(250);
    const after = await getRequiredSnapshot(cdp);
    assert(after.renderEvents === snapshot.renderEvents, "stop cancels all render loops after duplicate start calls");
    console.log("✓ lifecycle: duplicate start is idempotent and stop cancels rendering");
  } finally {
    cdp.close();
  }
}

async function runInteractionsCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "interactions");
  try {
    let snapshot = await waitForReady(cdp, options.timeoutMs);
    const center = centerOf(snapshot.canvasRect);

    await mouseMove(cdp, center.x, center.y);
    await sleep(250);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.hoverEvents > 0, "hover event fired");
    assert(snapshot.crosshairMoves > 0, "crosshair move fired");

    const initialSpan = spanX(snapshot.viewport);
    await wheel(cdp, center.x, center.y, -400);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanX(snapshot.viewport) < initialSpan, "wheel zoom shrinks x span");

    const afterZoomXMin = snapshot.viewport.xMin;
    await drag(cdp, center.x, center.y, center.x + 120, center.y, 8);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(Math.abs(snapshot.viewport.xMin - afterZoomXMin) > 1, "shift-drag pan changes viewport");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    snapshot = await getRequiredSnapshot(cdp);
    const rect = snapshot.canvasRect;
    await drag(cdp, rect.left + rect.width * 0.25, rect.top + rect.height * 0.25, rect.left + rect.width * 0.75, rect.top + rect.height * 0.75, 0);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanX(snapshot.viewport) < spanX(snapshot.initialViewport) * 0.7, "box zoom shrinks x span");

    await doubleClick(cdp, center.x, center.y);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(close(spanX(snapshot.viewport), spanX(snapshot.initialViewport), 1), "double-click reset restores x span");

    console.log("✓ interactions: hover, crosshair, wheel zoom, shift pan, box zoom, reset");
  } finally {
    cdp.close();
  }
}

async function runMobileLongPressCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "mobile-longpress");
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const snapshot = await waitForReady(cdp, options.timeoutMs);
    const center = centerOf(snapshot.canvasRect);
    await touchStart(cdp, center.x, center.y);
    await sleep(700);
    let after = await getRequiredSnapshot(cdp);
    assert(after.visibleCrosshairs >= 1, "long press shows crosshair");
    assert(after.visibleTooltips >= 1, "long press shows tooltip");
    const initialCrosshairX = after.crosshairX;
    const initialTooltipLeft = after.tooltipLeft;
    assert(initialCrosshairX !== null, "long press exposes crosshair x");
    assert(initialTooltipLeft !== null, "long press exposes tooltip left");
    await touchMove(cdp, center.x + 90, center.y);
    await sleep(150);
    after = await getRequiredSnapshot(cdp);
    await touchEnd(cdp);
    assert(after.crosshairX !== null && Math.abs(after.crosshairX - initialCrosshairX!) > 30, "long-press crosshair follows finger");
    assert(after.tooltipLeft !== null && Math.abs(after.tooltipLeft - initialTooltipLeft!) > 20, "long-press tooltip follows finger");
    console.log("✓ mobile: long-press crosshair and tooltip");
  } finally {
    cdp.close();
  }
}

async function runMobileCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "mobile");
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    let snapshot = await waitForReady(cdp, options.timeoutMs);
    const rect = snapshot.canvasRect;
    const center = centerOf(rect);
    const initialSpan = spanX(snapshot.viewport);

    await touchDrag(cdp, center.x, center.y, center.x + 120, center.y);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(Math.abs(snapshot.viewport.xMin - snapshot.initialViewport.xMin) > 1, "single-touch pan changes viewport");
    assert(snapshot.visibleCrosshairs === 0, "touch pan does not show crosshair");
    assert(snapshot.visibleTooltips === 0, "touch pan does not show tooltip");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    await pinch(cdp, center.x, center.y, 48, 112);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanX(snapshot.viewport) < initialSpan * 0.8, "pinch-out zoom shrinks x span");
    assert(snapshot.visibleCrosshairs === 0, "pinch does not show crosshair");
    assert(snapshot.visibleTooltips === 0, "pinch does not show tooltip");

    await doubleTap(cdp, center.x, center.y);
    await sleep(250);
    snapshot = await getRequiredSnapshot(cdp);
    assert(close(spanX(snapshot.viewport), initialSpan, 1), "double-tap reset restores x span");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    snapshot = await getRequiredSnapshot(cdp);
    const xAxisCenter = centerOf(snapshot.xAxisRect);
    const yAxisCenter = centerOf(snapshot.yAxisRect);
    await touchDrag(cdp, xAxisCenter.x, xAxisCenter.y, xAxisCenter.x + 110, xAxisCenter.y);
    await sleep(150);
    snapshot = await getRequiredSnapshot(cdp);
    assert(Math.abs(snapshot.viewport.xMin - snapshot.initialViewport.xMin) > 1, "x-axis touch drag pans x");
    assert(close(spanY(snapshot.viewport), spanY(snapshot.initialViewport), 0.01), "x-axis touch drag preserves y span");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    await pinch(cdp, xAxisCenter.x, xAxisCenter.y, 42, 96);
    await sleep(150);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanX(snapshot.viewport) < initialSpan * 0.8, "x-axis pinch zooms x");
    assert(close(spanY(snapshot.viewport), spanY(snapshot.initialViewport), 0.01), "x-axis pinch preserves y span");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    await touchDrag(cdp, yAxisCenter.x, yAxisCenter.y, yAxisCenter.x, yAxisCenter.y + 80);
    await sleep(150);
    snapshot = await getRequiredSnapshot(cdp);
    assert(Math.abs(snapshot.viewport.yMin - snapshot.initialViewport.yMin) > 0.05, "y-axis touch drag pans y");
    assert(close(spanX(snapshot.viewport), spanX(snapshot.initialViewport), 1), "y-axis touch drag preserves x span");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    await pinchVertical(cdp, yAxisCenter.x, center.y, 34, 86);
    await sleep(150);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanY(snapshot.viewport) < spanY(snapshot.initialViewport) * 0.8, "y-axis pinch zooms y");
    assert(close(spanX(snapshot.viewport), spanX(snapshot.initialViewport), 1), "y-axis pinch preserves x span");
    console.log("✓ mobile: touch pan, pinch zoom, axis gestures, double-tap reset");
  } finally {
    cdp.close();
  }
}

async function runLinkedCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "linked");
  try {
    const snapshot = await waitForReady(cdp, options.timeoutMs);
    const rect = snapshot.canvasRect;
    await mouseMove(cdp, rect.left + rect.width * 0.45, rect.top + rect.height * 0.5);
    await sleep(250);
    const after = await getRequiredSnapshot(cdp);
    assert(after.visibleCrosshairs >= 2, "linked crosshairs are visible on both charts");
    assert(after.visibleTooltips >= 2, "linked tooltips are visible on both charts");
    console.log("✓ linked: synchronized crosshair and tooltip");
  } finally {
    cdp.close();
  }
}

async function runSelectionCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "selection");
  try {
    const snapshot = await waitForReady(cdp, options.timeoutMs);
    const rect = snapshot.canvasRect;
    await drag(cdp, rect.left + rect.width * 0.2, rect.top + rect.height * 0.2, rect.left + rect.width * 0.7, rect.top + rect.height * 0.65, 0);
    await sleep(200);
    const after = await getRequiredSnapshot(cdp);
    assert(after.selectionCommits > 0, "selection commit fired");
    assert(after.selectionBounds !== null && after.selectionBounds.xMax > after.selectionBounds.xMin, "selection bounds are valid");
    console.log("✓ selection: drag commit and data bounds");
  } finally {
    cdp.close();
  }
}

async function openCase(options: Options, serverUrl: string, caseName: string): Promise<CdpClient> {
  const url = new URL("/interaction/", serverUrl);
  url.searchParams.set("case", caseName);
  const target = await createTarget(options.debugPort, url.toString());
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", (params) => {
    throw new Error(`Page exception in ${caseName}: ${JSON.stringify(params)}`);
  });
  return cdp;
}

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = { width: 900, height: 520, port: 41733, debugPort: 9225, timeoutMs: 30_000, keepBrowser: false };
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
      case "--width": parsed.width = readPositiveInteger(flag, readValue()); break;
      case "--height": parsed.height = readPositiveInteger(flag, readValue()); break;
      case "--port": parsed.port = readPositiveInteger(flag, readValue()); break;
      case "--debug-port": parsed.debugPort = readPositiveInteger(flag, readValue()); break;
      case "--timeout-ms": parsed.timeoutMs = readPositiveInteger(flag, readValue()); break;
      case "--url": parsed.url = readValue(); break;
      case "--chrome": parsed.chrome = readValue(); break;
      case "--keep-browser": parsed.keepBrowser = true; break;
      case "--help": case "-h": printHelpAndExit(); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run test:interaction [options]\n\nRuns automated browser interaction tests for hover, crosshair, wheel zoom, pan, box zoom, reset, selection, and linked sync.\n`);
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
  const cmd = [chromePath, "--headless=new", `--remote-debugging-port=${opts.debugPort}`, `--user-data-dir=${userDataDir}`, `--window-size=${opts.width},${opts.height}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-dev-shm-usage", "--no-sandbox", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "about:blank"];
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

async function waitForReady(cdp: CdpClient, timeoutMs: number): Promise<InteractionSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getSnapshot(cdp);
    if (snapshot?.state === "ready") return snapshot;
    if (snapshot?.state === "error") throw new Error(`Interaction page failed: ${snapshot.error ?? "unknown error"}`);
    await sleep(150);
  }
  throw new Error("Timed out waiting for interaction page");
}

async function getRequiredSnapshot(cdp: CdpClient): Promise<InteractionSnapshot> {
  const snapshot = await getSnapshot(cdp);
  if (!snapshot) throw new Error("Interaction controller is not available");
  return snapshot;
}

async function getSnapshot(cdp: CdpClient): Promise<InteractionSnapshot | null> {
  return await evaluate(cdp, "window.__blazeplotInteractionTest?.snapshot?.() ?? null", true) as InteractionSnapshot | null;
}

async function evaluate(cdp: CdpClient, expression: string, awaitPromise: boolean): Promise<unknown> {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: false }) as RemoteObjectResult;
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Runtime.evaluate failed");
  return response.result?.value;
}

async function mouseMove(cdp: CdpClient, x: number, y: number, modifiers = 0): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers, pointerType: "mouse" });
}

async function wheel(cdp: CdpClient, x: number, y: number, deltaY: number): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY, pointerType: "mouse" });
}

async function drag(cdp: CdpClient, x0: number, y0: number, x1: number, y1: number, modifiers: number): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0, modifiers, pointerType: "mouse" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", buttons: 1, clickCount: 1, modifiers, pointerType: "mouse" });
  await sleep(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1, button: "left", buttons: 1, modifiers, pointerType: "mouse" });
  await sleep(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", buttons: 0, clickCount: 1, modifiers, pointerType: "mouse" });
}

async function doubleClick(cdp: CdpClient, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 2, pointerType: "mouse" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 2, pointerType: "mouse" });
}

async function touchDrag(cdp: CdpClient, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1, y: y1, id: 1 }] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function pinch(cdp: CdpClient, centerX: number, centerY: number, startRadius: number, endRadius: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: centerX - startRadius, y: centerY, id: 1 },
    { x: centerX + startRadius, y: centerY, id: 2 },
  ] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    { x: centerX - endRadius, y: centerY, id: 1 },
    { x: centerX + endRadius, y: centerY, id: 2 },
  ] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function pinchVertical(cdp: CdpClient, centerX: number, centerY: number, startRadius: number, endRadius: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: centerX, y: centerY - startRadius, id: 1 },
    { x: centerX, y: centerY + startRadius, id: 2 },
  ] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    { x: centerX, y: centerY - endRadius, id: 1 },
    { x: centerX, y: centerY + endRadius, id: 2 },
  ] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function touchStart(cdp: CdpClient, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
}

async function touchMove(cdp: CdpClient, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
}

async function touchEnd(cdp: CdpClient): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function doubleTap(cdp: CdpClient, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(90);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

function centerOf(rect: RectSnapshot): { x: number; y: number } {
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
}

function spanX(v: ViewportSnapshot): number {
  return v.xMax - v.xMin;
}

function spanY(v: ViewportSnapshot): number {
  return v.yMax - v.yMin;
}

function close(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`Interaction assertion failed: ${label}`);
}

function resolveChrome(explicit: string | undefined): string {
  const envPath = explicit ?? process.env.BLAZEPLOT_BENCH_CHROME ?? process.env.CHROME_PATH;
  if (envPath) {
    if (!existsSync(envPath)) throw new Error(`Chrome executable does not exist: ${envPath}`);
    return envPath;
  }
  const candidates = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "chrome", "brave-browser", "brave-browser-stable", "brave", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
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
