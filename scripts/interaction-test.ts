#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RobustnessResults } from "../tests/browser/interaction/robustness.ts";
import { CdpClient, closeTarget, createTarget, evaluate, readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, waitForHttp } from "./browser-harness.js";

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
  rightViewport: ViewportSnapshot;
  initialViewport: ViewportSnapshot;
  initialRightViewport: ViewportSnapshot;
  canvasRect: RectSnapshot;
  xAxisRect: RectSnapshot;
  yAxisRect: RectSnapshot;
  hoverItems: number;
  hoverEvents: number;
  crosshairMoves: number;
  selectionCommits: number;
  selectionBounds: ViewportSnapshot | null;
  hasSelection: boolean;
  selectionOverlay: { left: number; top: number; width: number; height: number } | null;
  visibleCrosshairs: number;
  visibleTooltips: number;
  crosshairX: number | null;
  tooltipLeft: number | null;
  renderEvents: number;
  followingLatestX: boolean;
  latestXFollowPaused: boolean;
  error?: string | null;
}

// Each case gets a fresh page. Earlier pages are closed so their render loops
// (continuous mode, live follow) do not compete for CPU with timing-sensitive cases.
let openTargetId: string | null = null;

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
    await runRenderLoopCase(options, serverUrl);
    await runContinuousRenderLoopCase(options, serverUrl);
    await runLiveFollowCase(options, serverUrl);
    await runRobustnessCase(options, serverUrl);
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

async function runRenderLoopCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "render-loop");
  try {
    const snapshot = await waitForReady(cdp, options.timeoutMs);
    assert(snapshot.renderEvents > 0, "default render loop renders the initial dirty frame");
    await sleep(250);
    const idle = await getRequiredSnapshot(cdp);
    assert(idle.renderEvents === snapshot.renderEvents, "default render loop does not continuously render static charts");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    const afterDirty = await getRequiredSnapshot(cdp);
    assert(afterDirty.renderEvents > idle.renderEvents, "default render loop renders again after chart state changes");
    await sleep(250);
    const afterIdle = await getRequiredSnapshot(cdp);
    assert(afterIdle.renderEvents === afterDirty.renderEvents, "default render loop returns to idle after the dirty frame");
    console.log("✓ render loop: default mode renders on demand and idles for static charts");
  } finally {
    cdp.close();
  }
}

async function runContinuousRenderLoopCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "continuous-render-loop");
  try {
    const snapshot = await waitForReady(cdp, options.timeoutMs);
    await sleep(250);
    const after = await getRequiredSnapshot(cdp);
    assert(after.renderEvents > snapshot.renderEvents + 2, "continuous render loop keeps rendering across frames");
    console.log("✓ render loop: continuous mode keeps requestAnimationFrame active");
  } finally {
    cdp.close();
  }
}

async function runLiveFollowCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "live-follow");
  try {
    let snapshot = await waitForReady(cdp, options.timeoutMs);
    const epochLikeX = 1_700_000_000_000;
    assert(snapshot.viewport.xMax >= epochLikeX + 1_020, "followLatestX can use a live x clock ahead of the newest sample");
    assert(close(spanX(snapshot.viewport), 100, 0.1), "followLatestX uses the configured rolling window");
    const initialRenderEvents = snapshot.renderEvents;
    await sleep(120);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.viewport.xMax >= epochLikeX + 1_080, "live x clock advances follow viewport between data appends");
    assert(snapshot.renderEvents > initialRenderEvents + 2, "live x clock keeps auto render loop active while following");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(40);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.latestXFollowPaused, "setViewport pauses live follow for interaction-style changes");
    assert(close(spanX(snapshot.viewport), spanX(snapshot.initialViewport), 1), "setViewport applies the requested historical viewport while paused");

    const center = centerOf(snapshot.canvasRect);
    await doubleClick(cdp, center.x, center.y);
    await sleep(80);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.followingLatestX, "double-click reset resumes latest-X follow by default");
    assert(snapshot.viewport.xMax >= epochLikeX + 1_100, "double-click reset returns a live-follow chart to the latest x window");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(40);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.latestXFollowPaused, "setViewport can pause live follow again after reset");
    await sleep(180);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.viewport.xMax >= epochLikeX + 1_200, "resumeAfterMs resumes live follow after inactivity");
    console.log("✓ live follow: helper pins, pauses, reset-resumes, and auto-resumes the rolling x window");
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
    // Wheel off-center so a wrong anchor or reversed-axis mapping shows up as drift.
    const wheelY = snapshot.canvasRect.top + snapshot.canvasRect.height * 0.25;
    const leftAnchor = valueAtFromTop(snapshot.viewport, 0.25, false);
    const rightAnchor = valueAtFromTop(snapshot.rightViewport, 0.25, true);
    await wheel(cdp, center.x, wheelY, -400);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanX(snapshot.viewport) < initialSpan, "wheel zoom shrinks x span");
    const leftRatio = spanY(snapshot.viewport) / spanY(snapshot.initialViewport);
    const rightRatio = spanY(snapshot.rightViewport) / spanY(snapshot.initialRightViewport);
    assert(leftRatio < 0.95, "wheel zoom shrinks left y span");
    assert(close(rightRatio, leftRatio, 1e-6), "wheel zoom scales right y span by the same factor");
    // CDP input coordinates are pixel-rounded, so allow ~1.5px of anchor drift.
    const anchorTolerance = (v: ViewportSnapshot): number => (spanY(v) / snapshot.canvasRect.height) * 1.5;
    assert(close(valueAtFromTop(snapshot.viewport, 0.25, false), leftAnchor, anchorTolerance(snapshot.viewport)), "wheel zoom keeps the left y anchor under the cursor");
    assert(close(valueAtFromTop(snapshot.rightViewport, 0.25, true), rightAnchor, anchorTolerance(snapshot.rightViewport)), "wheel zoom keeps the reversed right y anchor under the cursor");

    const afterZoomXMin = snapshot.viewport.xMin;
    const afterZoomRight = snapshot.rightViewport;
    await drag(cdp, center.x, center.y, center.x + 120, center.y + 40, 8);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(Math.abs(snapshot.viewport.xMin - afterZoomXMin) > 1, "shift-drag pan changes viewport");
    // Dragging down moves content down: left values grow, reversed right values shrink.
    assert(snapshot.rightViewport.yMin < afterZoomRight.yMin, "shift-drag pan moves the reversed right y axis with the content");
    assert(close(spanY(snapshot.rightViewport), spanY(afterZoomRight), spanY(afterZoomRight) * 1e-6), "shift-drag pan keeps right y span");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    snapshot = await getRequiredSnapshot(cdp);
    await wheel(cdp, snapshot.yAxisRect.left + snapshot.yAxisRect.width / 2, center.y, -400);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanY(snapshot.viewport) < spanY(snapshot.initialViewport), "left y-axis gutter wheel zooms left y");
    assert(close(spanY(snapshot.rightViewport), spanY(snapshot.initialRightViewport), 1e-6), "left y-axis gutter wheel leaves right y untouched");

    await evaluate(cdp, "window.__blazeplotInteractionTest.resetViewport()", true);
    await sleep(100);
    snapshot = await getRequiredSnapshot(cdp);
    const rect = snapshot.canvasRect;
    await drag(cdp, rect.left + rect.width * 0.25, rect.top + rect.height * 0.25, rect.left + rect.width * 0.75, rect.top + rect.height * 0.75, 0);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(spanX(snapshot.viewport) < spanX(snapshot.initialViewport) * 0.7, "box zoom shrinks x span");
    const initialRight = snapshot.initialRightViewport;
    const pixelTolerance = spanY(initialRight) * 0.02;
    assert(close(snapshot.rightViewport.yMin, valueAtFromTop(initialRight, 0.25, true), pixelTolerance), "box zoom maps top edge through the reversed right axis");
    assert(close(snapshot.rightViewport.yMax, valueAtFromTop(initialRight, 0.75, true), pixelTolerance), "box zoom maps bottom edge through the reversed right axis");

    await doubleClick(cdp, center.x, center.y);
    await sleep(200);
    snapshot = await getRequiredSnapshot(cdp);
    assert(close(spanX(snapshot.viewport), spanX(snapshot.initialViewport), 1), "double-click reset restores x span");
    assert(close(spanY(snapshot.rightViewport), spanY(snapshot.initialRightViewport), 1e-6), "double-click reset restores right y span");

    console.log("✓ interactions: hover, crosshair, wheel zoom, shift pan, box zoom, reset (both y axes)");
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

    const committed = after.selectionOverlay;
    assert(committed !== null, "committed selection rectangle is visible");
    const viewport = after.viewport;
    const span = viewport.xMax - viewport.xMin;
    await evaluate(cdp, `window.__blazeplotInteractionTest.setViewport({ xMin: ${viewport.xMin - span / 2}, xMax: ${viewport.xMax + span / 2} })`, true);
    await sleep(150);
    const zoomedOut = await getRequiredSnapshot(cdp);
    assert(zoomedOut.selectionOverlay !== null && Math.abs(zoomedOut.selectionOverlay.width - committed.width / 2) < 3, "selection rectangle follows the data when the viewport zooms out");
    console.log("✓ selection: committed rectangle tracks viewport changes");

    const input = await evaluate(cdp, "(() => { const r = document.getElementById('outside-input').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()", true) as { x: number; y: number };
    await click(cdp, input.x, input.y);
    await pressKey(cdp, "Escape", 27);
    await sleep(100);
    assert((await getRequiredSnapshot(cdp)).hasSelection, "Escape typed in an unrelated input keeps the chart selection");

    // Pressing on the canvas does not move focus; re-focus the input so the focus move is explicit.
    await click(cdp, rect.left + rect.width * 0.9, rect.top + rect.height * 0.9);
    await evaluate(cdp, "(() => { const input = document.getElementById('outside-input'); input.blur(); input.focus(); })()", true);
    await pressKey(cdp, "Escape", 27);
    await sleep(100);
    assert((await getRequiredSnapshot(cdp)).hasSelection, "Escape after moving focus out of the chart keeps the selection");

    await click(cdp, rect.left + rect.width * 0.9, rect.top + rect.height * 0.9);
    await pressKey(cdp, "Escape", 27);
    await sleep(100);
    const cleared = await getRequiredSnapshot(cdp);
    assert(!cleared.hasSelection && cleared.selectionOverlay === null, "Escape after clicking the chart clears its selection");
    console.log("✓ selection: Escape is scoped to the chart");
  } finally {
    cdp.close();
  }
}

async function runRobustnessCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "robustness");
  try {
    await waitForReady(cdp, options.timeoutMs);
    const result = await evaluate(cdp, "window.__blazeplotRobustness()", true) as RobustnessResults;
    assert(result.zoomInThrew === null && result.zoomInSpan > 0, `deep zoom on a time axis stops at float precision (threw: ${result.zoomInThrew})`);
    assert(result.logFitYMin > 0 && result.logFitRendered, "fitToData pads a log axis in log space and renders");
    assert(!result.logIncludeZeroChangedY, "fitToData leaves a log axis alone when includeZero has no valid domain");
    assert(result.invalidSetViewportError !== null && result.invalidSetViewportUnchanged, "setViewport rejects an invalid log domain without partial changes");
    assert(result.rendersWhileInvalid === 0 && result.invalidDomainLogs === 1, "an invalid camera domain skips frames and logs once");
    assert(result.recoveredAfterInvalid, "the continuous loop resumes rendering once the domain is valid again");
    assert(result.failedChartLeftDom === 0 && result.failedChartRestoredCanvas, "a chart that fails to construct leaves no DOM and restores its canvas");
    assert(result.failedLinkedLeftDom === 0, "linked charts clean up when one panel fails to construct");
    console.log("✓ robustness: zoom limits, scale-aware fits, invalid domains, and failed construction");
  } finally {
    cdp.close();
  }
}

async function openCase(options: Options, serverUrl: string, caseName: string): Promise<CdpClient> {
  if (openTargetId) {
    await closeTarget(options.debugPort, openTargetId);
    openTargetId = null;
  }
  const url = new URL("/interaction/", serverUrl);
  url.searchParams.set("case", caseName);
  const target = await createTarget(options.debugPort, url.toString());
  openTargetId = target.id;
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

function launchChrome(chromePath: string, userDataDir: string, opts: Options): Bun.Subprocess {
  const cmd = [chromePath, "--headless=new", `--remote-debugging-port=${opts.debugPort}`, `--user-data-dir=${userDataDir}`, `--window-size=${opts.width},${opts.height}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-dev-shm-usage", "--no-sandbox", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "about:blank"];
  return spawnChrome(cmd);
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

async function click(cdp: CdpClient, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
}

async function pressKey(cdp: CdpClient, key: string, keyCode: number): Promise<void> {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: keyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode });
}

async function doubleClick(cdp: CdpClient, x: number, y: number): Promise<void> {
  await click(cdp, x, y);
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

function valueAtFromTop(viewport: ViewportSnapshot, fraction: number, reversed: boolean): number {
  return reversed ? viewport.yMin + spanY(viewport) * fraction : viewport.yMax - spanY(viewport) * fraction;
}

function close(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Interaction assertion failed: ${label}`);
}
