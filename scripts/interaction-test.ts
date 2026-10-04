#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RobustnessResults } from "../tests/browser/interaction/robustness.ts";
import { CdpClient, closeTarget, createTarget, evaluate, readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, waitForHttp } from "./browser-harness.js";
import { decodePng, encodePng } from "./png-image.js";
import type { RgbaImage } from "./png-image.js";

interface Options {
  width: number;
  height: number;
  port: number;
  debugPort: number;
  timeoutMs: number;
  url?: string;
  chrome?: string;
  keepBrowser: boolean;
  /** Run only these cases (`--case`, repeatable); all cases when empty. */
  cases: string[];
  /** Where the forced-colors case writes its review screenshots. */
  outDir: string;
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
  a11y: {
    active: string;
    activeOutline: string;
    announcement: string;
    selectionStatus: string;
    hoverSource: string | null;
    hoverSeries: string | null;
    hoverIndex: number | null;
    annotationCount: number;
    annotationClicks: number;
    tableRows: number;
    describedBy: string;
  };
  error?: string | null;
}

// Each case gets a fresh page. Earlier pages are closed so their render loops
// (continuous mode, live follow) do not compete for CPU with timing-sensitive cases.
let openTargetId: string | null = null;
/** CDP modifier bit for Shift. */
const SHIFT = 8;

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

    const cases: ReadonlyArray<readonly [string, (options: Options, serverUrl: string) => Promise<void>]> = [
      ["interactions", runInteractionsCase],
      ["selection", runSelectionCase],
      ["linked", runLinkedCase],
      ["mobile", runMobileCase],
      ["mobile-longpress", runMobileLongPressCase],
      ["lifecycle", runLifecycleCase],
      ["render-loop", runRenderLoopCase],
      ["continuous-render-loop", runContinuousRenderLoopCase],
      ["live-follow", runLiveFollowCase],
      ["robustness", runRobustnessCase],
      ["a11y", runKeyboardA11yCase],
      ["forced-colors", runForcedColorsCase],
    ];
    const selected = options.cases.length > 0 ? cases.filter(([name]) => options.cases.includes(name)) : cases;
    if (selected.length === 0) throw new Error(`No interaction case matches --case ${options.cases.join(", ")}. Cases: ${cases.map(([name]) => name).join(", ")}`);
    for (const [, run] of selected) await run(options, serverUrl);
  } finally {
    if (chromeProc && !options.keepBrowser) chromeProc.kill();
    if (viteProc) viteProc.kill();
    // Windows can keep the profile locked briefly after Chrome exits; a failed cleanup must not mask test errors.
    if (userDataDir && !options.keepBrowser) await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
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
    const { zoom, log, loop } = result;
    assert(zoom.threw === null && zoom.span > 0, `deep zoom on a time axis stops at float precision (threw: ${zoom.threw})`);
    assert(log.fitYMin > 0 && log.rendered, "fitToData pads a log axis in log space and renders");
    assert(loop.whileInvalid === 0 && loop.logs === 1 && loop.recovered, "an invalid camera domain skips frames, logs once, and recovers");
    assert(result.failedChartLeftDom === 0 && result.failedLinkedLeftDom === 0 && result.canvasRestored, "failed construction leaves no DOM and restores the canvas");
    console.log("✓ robustness: zoom limits, scale-aware fits, invalid domains, and failed construction");
  } finally {
    cdp.close();
  }
}

/** Keyboard-only: Tab focus, inspection cursor, keyboard selection, annotation activation/removal, focus rings. */
async function runKeyboardA11yCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "a11y");
  try {
    await waitForReady(cdp, options.timeoutMs);
    await sleep(1_200); // the summary (1 s) and data table (0.5 s) update on throttles
    let snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.describedBy.includes("interaction line 1") && snapshot.a11y.describedBy.includes("1,000 points"), `generated summary describes the series (${snapshot.a11y.describedBy})`);
    assert(snapshot.a11y.tableRows > 0, "a11y data table has rows");

    await key(cdp, "Tab", 9);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.active === "chart-root", `Tab focuses the chart root first (got ${snapshot.a11y.active})`);
    assert(snapshot.a11y.activeOutline.startsWith("solid 2px"), `chart root shows a 2px focus ring (got ${snapshot.a11y.activeOutline})`);

    await key(cdp, "Enter", 13);
    await sleep(120);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.hoverSource === "inspection", "Enter starts keyboard inspection");
    assert(snapshot.a11y.announcement.startsWith("interaction line 1: x"), `inspection announces the value (${snapshot.a11y.announcement})`);
    assert(snapshot.visibleTooltips >= 1 && snapshot.visibleCrosshairs >= 1, "tooltip and crosshair follow the inspection cursor");
    const startIndex = snapshot.a11y.hoverIndex ?? -1;
    const startCrosshairX = snapshot.crosshairX;

    for (let i = 0; i < 3; i++) await key(cdp, "ArrowRight", 39);
    await sleep(120);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.hoverIndex === startIndex + 3, `ArrowRight steps one sample at a time (${startIndex} -> ${snapshot.a11y.hoverIndex})`);
    assert(snapshot.crosshairX !== null && startCrosshairX !== null && snapshot.crosshairX > startCrosshairX, "crosshair moves with the cursor");
    assert(close(spanX(snapshot.viewport), spanX(snapshot.initialViewport), 1e-6) && snapshot.viewport.xMin === snapshot.initialViewport.xMin, "inspection keys do not pan the chart");

    await key(cdp, "ArrowDown", 40);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.hoverSeries === "interaction cosine", `ArrowDown switches series (${snapshot.a11y.hoverSeries})`);
    await key(cdp, "End", 35);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.hoverIndex === 999, `End jumps to the last visible sample (${snapshot.a11y.hoverIndex})`);
    await key(cdp, "Escape", 27);
    await sleep(120);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.hoverSource === null && snapshot.visibleTooltips === 0, "Escape ends inspection and hides the tooltip");
    console.log("✓ keyboard: Tab focus ring, inspection cursor drives tooltip and crosshair, series switch, End, Escape");

    for (let i = 0; i < 4; i++) await key(cdp, "ArrowRight", 39, SHIFT);
    await key(cdp, "Enter", 13);
    await sleep(120);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.selectionCommits === 1 && snapshot.selectionBounds !== null && snapshot.selectionBounds.xMax > snapshot.selectionBounds.xMin, "Shift+Arrow then Enter commits a keyboard selection");
    assert(snapshot.a11y.selectionStatus.startsWith("Selected X from"), `keyboard selection is announced (${snapshot.a11y.selectionStatus})`);
    console.log("✓ keyboard: Shift+Arrow selection committed with Enter");

    await key(cdp, "Tab", 9);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.active === "annotation:Deploy", `Tab reaches the first annotation (got ${snapshot.a11y.active})`);
    assert(snapshot.a11y.activeOutline.startsWith("solid 2px"), `annotation shows a focus ring (got ${snapshot.a11y.activeOutline})`);
    await key(cdp, "Enter", 13);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.annotationClicks === 1, "Enter activates the focused annotation");
    await key(cdp, "Delete", 46);
    await sleep(80);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.annotationCount === 1, "Delete removes a removable annotation");
    assert(snapshot.a11y.active === "annotation:Incident", `focus moves to the next annotation (got ${snapshot.a11y.active})`);
    await key(cdp, "Delete", 46);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.annotationCount === 1, "Delete leaves non-removable annotations alone");

    await key(cdp, "Tab", 9);
    snapshot = await getRequiredSnapshot(cdp);
    assert(snapshot.a11y.active.startsWith("legend:"), `Tab reaches the legend (got ${snapshot.a11y.active})`);
    assert(snapshot.a11y.activeOutline.startsWith("solid 2px"), `legend item shows a focus ring (got ${snapshot.a11y.activeOutline})`);
    console.log("✓ keyboard: annotation focus, activation, removal; legend focus ring");
  } finally {
    cdp.close();
  }
}

/**
 * Forced colors (Windows high-contrast) in a real browser: emulate `forced-colors: active` over CDP
 * on the all-plugins a11y fixture, check that the theme, series, canvas pixels, and DOM overlays
 * switch to system colors and stay visible, then turn emulation off and check that the caller
 * theme comes back through the `matchMedia` change listener, without a reload.
 */
async function runForcedColorsCase(options: Options, serverUrl: string): Promise<void> {
  const cdp = await openCase(options, serverUrl, "a11y");
  try {
    await waitForReady(cdp, options.timeoutMs);
    await mkdir(options.outDir, { recursive: true });
    await sleep(200);

    const normal = await getColors(cdp);
    assert(!normal.forcedColorsMatches, "forced colors are off before emulation");
    assert(normal.seriesColors.length === 2, `fixture has two series (${normal.seriesColors.length})`);
    const normalBackground = rgb255(normal.theme.backgroundColor);
    const normalSeries = normal.seriesColors.map(rgb255);
    await expectCanvas(cdp, normalBackground, normalSeries, "normal theme", join(options.outDir, "normal-canvas.png"));
    await captureScreenshot(cdp, join(options.outDir, "normal.png"));

    // Dark scheme selects Chromium's dark forced palette, like a Windows dark Contrast theme.
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }, { name: "prefers-color-scheme", value: "dark" }] });
    let forced = await waitForThemeChange(cdp, normal.themeChanges, options.timeoutMs);
    assert(forced.forcedColorsMatches, "matchMedia reports forced colors after emulation");
    const system = mapRecord(forced.system, parseCssRgb);
    const canvasColor = system.Canvas;
    const textColor = system.CanvasText;
    assert(forced.theme.backgroundCssColor === "Canvas", `theme background is the Canvas system color (${forced.theme.backgroundCssColor})`);
    assertNear(rgb255(forced.theme.backgroundColor), canvasColor, 1, "theme background RGBA resolves to the Canvas system color");
    assert(forced.theme.axisColor === "CanvasText", `axis color is CanvasText (${forced.theme.axisColor})`);
    const systemSeries = [system.Highlight, system.LinkText, system.CanvasText, system.GrayText];
    const forcedSeries = forced.seriesColors.map(rgb255);
    forcedSeries.forEach((color, index) => {
      assert(systemSeries.some((candidate) => maxChannelDelta(candidate, color) <= 1), `series ${index} uses a system color (${color.join(",")})`);
      assert(maxChannelDelta(color, rgb255(forced.theme.seriesColors[index % forced.theme.seriesColors.length]!)) <= 1, `series ${index} follows the forced theme palette`);
      assert(contrastRatio(color, canvasColor) >= 3, `series ${index} has at least 3:1 contrast with Canvas (${contrastRatio(color, canvasColor).toFixed(2)})`);
    });
    assert(maxChannelDelta(forcedSeries[0]!, forcedSeries[1]!) > 32, "the two series get different system colors");
    assert(forced.seriesColors.every((color) => color[3] === 1) && forced.theme.backgroundColor[3] === 1, `forced series and background are opaque (${forced.seriesColors.map((color) => color[3]).join(", ")})`);
    assert(maxChannelDelta(forcedSeries[0]!, normalSeries[0]!) > 0 || maxChannelDelta(canvasColor, normalBackground) > 0, "forced palette differs from the normal theme");
    assertNear(parseCssRgb(forced.rootBackground), canvasColor, 1, "chart root background is Canvas");
    assert(forced.axisLabelColor !== null, "axis tick labels are rendered");
    assertNear(parseCssRgb(forced.axisLabelColor), textColor, 1, "axis tick labels use CanvasText");
    assert(forced.titleColor !== null, "chart title is rendered");
    assertNear(parseCssRgb(forced.titleColor), textColor, 1, "chart title uses CanvasText");
    assert(contrastRatio(textColor, canvasColor) >= 4.5, `CanvasText has at least 4.5:1 contrast with Canvas (${contrastRatio(textColor, canvasColor).toFixed(2)})`);
    assert(forced.legend !== null, "legend is visible");
    assertNear(parseCssRgb(forced.legend.background), canvasColor, 1, "legend background is Canvas");
    assertNear(parseCssRgb(forced.legend.color), textColor, 1, "legend text is CanvasText");
    assert(forced.legend.borderStyle === "solid", `legend keeps a visible border (${forced.legend.borderStyle})`);
    assertNear(parseCssRgb(forced.legend.borderColor), textColor, 1, "legend border is CanvasText");
    assertSwatches(forced.legendSwatchColors, forcedSeries, "legend swatches keep the series colors (forced-color-adjust: none)");
    assert(forced.navigatorWindowFill !== null, "navigator window is rendered");
    assert(isTransparentFill(forced.navigatorWindowFill), `navigator window does not wash over the overview series (fill ${forced.navigatorWindowFill})`);

    // Canvas cleared to Canvas, each series drawn in its system color.
    await expectCanvas(cdp, canvasColor, forcedSeries, "forced colors", join(options.outDir, "forced-canvas.png"));
    console.log(`✓ forced colors: theme, series (${forcedSeries.map((color) => color.join(",")).join(" / ")}), canvas pixels, axis text, and legend use system colors`);

    await key(cdp, "Tab", 9);
    forced = await getColors(cdp);
    assert(forced.activeOutlineColor !== null, "chart root is focused");
    assertNear(parseCssRgb(forced.activeOutlineColor), system.Highlight, 1, "focus ring uses Highlight");
    for (let i = 0; i < 4; i++) await key(cdp, "ArrowRight", 39, SHIFT);
    await key(cdp, "Enter", 13);
    await sleep(120);
    forced = await getColors(cdp);
    assert(forced.selectionBorderColor !== null, "keyboard selection brush is visible");
    assertNear(parseCssRgb(forced.selectionBorderColor), system.Highlight, 1, "selection brush border uses Highlight");
    await key(cdp, "Enter", 13);
    await sleep(150);
    forced = await getColors(cdp);
    assert(forced.tooltip !== null, "inspection tooltip is visible");
    assertNear(parseCssRgb(forced.tooltip.background), canvasColor, 1, "tooltip background is Canvas");
    assertNear(parseCssRgb(forced.tooltip.color), textColor, 1, "tooltip text is CanvasText");
    assert(forced.tooltip.borderStyle === "solid", `tooltip has a visible border (${forced.tooltip.borderStyle})`);
    assertNear(parseCssRgb(forced.tooltip.borderColor), textColor, 1, "tooltip border is CanvasText");
    assertSwatches(forced.tooltipSwatchColors, forcedSeries, "tooltip swatches keep the series colors");
    assertSwatches(forced.pickMarkerBackgrounds, forcedSeries, "inspection markers keep the series colors");
    await captureScreenshot(cdp, join(options.outDir, "forced-colors.png"));
    console.log("✓ forced colors: focus ring, selection brush, tooltip, swatches, and markers use system colors");

    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }, { name: "prefers-color-scheme", value: "dark" }] });
    const restored = await waitForThemeChange(cdp, forced.themeChanges, options.timeoutMs);
    assert(!restored.forcedColorsMatches, "matchMedia reports forced colors off");
    assert(restored.theme.backgroundCssColor === normal.theme.backgroundCssColor, `theme background restored (${restored.theme.backgroundCssColor})`);
    assertNear(rgb255(restored.theme.backgroundColor), normalBackground, 0, "theme background RGBA restored");
    assert(restored.theme.axisColor === normal.theme.axisColor, `axis color restored (${restored.theme.axisColor})`);
    restored.seriesColors.map(rgb255).forEach((color, index) => assertNear(color, normalSeries[index]!, 0, `series ${index} color restored`));
    assert(restored.rootBackground === normal.rootBackground, `root background restored (${restored.rootBackground})`);
    assert(restored.legend !== null && normal.legend !== null && restored.legend.background === normal.legend.background && restored.legend.color === normal.legend.color, "legend colors restored");
    assertSwatches(restored.legendSwatchColors, normalSeries, "legend swatches restored");
    assertSwatches(restored.tooltipSwatchColors, normalSeries, "tooltip swatches restored");
    assert(restored.navigatorWindowFill === normal.navigatorWindowFill, `navigator window fill restored (${restored.navigatorWindowFill})`);
    await expectCanvas(cdp, normalBackground, normalSeries, "restored theme", join(options.outDir, "restored-canvas.png"));
    await captureScreenshot(cdp, join(options.outDir, "restored.png"));
    console.log(`✓ forced colors: turning emulation off restores the theme without reload (screenshots in ${options.outDir})`);
  } finally {
    await cdp.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => undefined);
    cdp.close();
  }
}

interface ColorSnapshot {
  forcedColorsMatches: boolean;
  themeChanges: number;
  system: Record<"Canvas" | "CanvasText" | "Highlight" | "LinkText" | "GrayText", string>;
  theme: { backgroundCssColor: string; backgroundColor: number[]; seriesColors: number[][]; axisColor: string };
  seriesColors: number[][];
  rootBackground: string;
  axisLabelColor: string | null;
  titleColor: string | null;
  legend: OverlayColors | null;
  tooltip: OverlayColors | null;
  selectionBorderColor: string | null;
  activeOutlineColor: string | null;
  legendSwatchColors: string[];
  tooltipSwatchColors: string[];
  pickMarkerBackgrounds: string[];
  navigatorWindowFill: string | null;
}

interface OverlayColors {
  background: string;
  color: string;
  borderColor: string;
  borderStyle: string;
}

type Rgb = readonly [number, number, number];

async function getColors(cdp: CdpClient): Promise<ColorSnapshot> {
  const colors = await evaluate(cdp, "window.__blazeplotInteractionTest?.colors?.() ?? null", true) as ColorSnapshot | null;
  if (!colors) throw new Error("Interaction controller colors() is not available");
  return colors;
}

/** Wait for the chart's `themechange` event, fired by its `(forced-colors: active)` listener. */
async function waitForThemeChange(cdp: CdpClient, previousChanges: number, timeoutMs: number): Promise<ColorSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < Math.min(timeoutMs, 5_000)) {
    const colors = await getColors(cdp);
    if (colors.themeChanges > previousChanges) return colors;
    await sleep(50);
  }
  throw new Error("Interaction assertion failed: the chart did not react to the forced-colors media change (no themechange event)");
}

/**
 * Poll plot-area screenshots until the background is the dominant color and every series color
 * covers at least 200 px (a frame may still be pending after a theme change). On timeout, save the
 * last capture to `failurePath` and fail with the colors that were found.
 */
async function expectCanvas(cdp: CdpClient, background: Rgb, seriesColors: readonly Rgb[], label: string, failurePath: string): Promise<void> {
  const startedAt = Date.now();
  let problem = "";
  let image: RgbaImage | null = null;
  while (Date.now() - startedAt < 5_000) {
    const capture = await captureCanvas(cdp);
    image = capture;
    const dominant = dominantColor(capture);
    const counts = seriesColors.map((color) => countNear(capture, color, 24));
    problem = maxChannelDelta(dominant, background) > 6
      ? `background is ${dominant.join(",")}, expected ${background.join(",")}`
      : counts.some((count) => count < 200)
        ? `series pixel counts ${counts.join(" / ")} for ${seriesColors.map((color) => color.join(",")).join(" / ")} (need 200 each)`
        : "";
    if (!problem) return;
    await sleep(100);
  }
  if (image) await writeFile(failurePath, encodePng(image));
  throw new Error(`Interaction assertion failed: ${label} canvas pixels: ${problem}; top colors ${image ? topColors(image, 8) : "n/a"} (capture saved to ${failurePath})`);
}

function topColors(image: RgbaImage, limit: number): string {
  const counts = new Map<number, number>();
  for (let i = 0; i < image.data.length; i += 4) {
    const packed = (image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!;
    counts.set(packed, (counts.get(packed) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([packed, count]) => `${(packed >> 16) & 255},${(packed >> 8) & 255},${packed & 255}x${count}`).join(" ");
}

/** Screenshot the plot canvas area (WebGL pixels plus any overlays on top). */
async function captureCanvas(cdp: CdpClient): Promise<RgbaImage> {
  const rect = (await getRequiredSnapshot(cdp)).canvasRect;
  const clip = { x: Math.ceil(rect.left) + 2, y: Math.ceil(rect.top) + 2, width: Math.floor(rect.width) - 4, height: Math.floor(rect.height) - 4, scale: 1 };
  const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip }) as { data?: string };
  if (!response.data) throw new Error("Page.captureScreenshot returned no data");
  return decodePng(Buffer.from(response.data, "base64"));
}

async function captureScreenshot(cdp: CdpClient, path: string): Promise<void> {
  const response = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }) as { data?: string };
  if (!response.data) throw new Error("Page.captureScreenshot returned no data");
  await writeFile(path, Buffer.from(response.data, "base64"));
}

function rgb255(color: readonly number[]): Rgb {
  return [Math.round((color[0] ?? 0) * 255), Math.round((color[1] ?? 0) * 255), Math.round((color[2] ?? 0) * 255)];
}

function parseCssRgb(css: string): Rgb {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css);
  if (!match) throw new Error(`Interaction assertion failed: cannot parse CSS color ${css}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function mapRecord<K extends string, V, R>(record: Record<K, V>, map: (value: V) => R): Record<K, R> {
  return Object.fromEntries(Object.entries(record).map(([name, value]) => [name, map(value as V)])) as Record<K, R>;
}

/** Every swatch is one of the series colors and every series color appears. */
function assertSwatches(swatches: readonly string[], seriesColors: readonly Rgb[], label: string): void {
  assert(swatches.length >= seriesColors.length, `${label}: expected ${seriesColors.length} swatches, found ${swatches.length}`);
  const parsed = swatches.map(parseCssRgb);
  for (const swatch of parsed) {
    assert(seriesColors.some((color) => maxChannelDelta(color, swatch) <= 1), `${label} (swatch ${swatch.join(",")} is not a series color ${seriesColors.map((color) => color.join(",")).join(" / ")})`);
  }
  for (const color of seriesColors) {
    assert(parsed.some((swatch) => maxChannelDelta(color, swatch) <= 1), `${label} (no swatch for ${color.join(",")})`);
  }
}

function isTransparentFill(fill: string): boolean {
  return fill === "none" || fill === "transparent" || /^rgba\(.*,\s*0\)$/.test(fill);
}

function maxChannelDelta(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function assertNear(actual: Rgb, expected: Rgb, tolerance: number, label: string): void {
  assert(maxChannelDelta(actual, expected) <= tolerance, `${label} (got ${actual.join(",")}, expected ${expected.join(",")})`);
}

/** WCAG 2 contrast ratio between two sRGB colors. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const luminance = (color: Rgb): number => {
    const [r, g, b2] = color.map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Most frequent opaque pixel color. */
function dominantColor(image: RgbaImage): Rgb {
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < image.data.length; i += 4) {
    const packed = (image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!;
    const count = (counts.get(packed) ?? 0) + 1;
    counts.set(packed, count);
    if (count > bestCount) {
      best = packed;
      bestCount = count;
    }
  }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

function countNear(image: RgbaImage, color: Rgb, tolerance: number): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (Math.abs(image.data[i]! - color[0]) <= tolerance && Math.abs(image.data[i + 1]! - color[1]) <= tolerance && Math.abs(image.data[i + 2]! - color[2]) <= tolerance) count++;
  }
  return count;
}

async function key(cdp: CdpClient, name: string, keyCode: number, modifiers = 0): Promise<void> {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: keyCode, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: keyCode, modifiers });
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
  const parsed: Options = { width: 900, height: 520, port: 41733, debugPort: 9225, timeoutMs: 30_000, keepBrowser: false, cases: [], outDir: "build/visual-tests/forced-colors" };
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
      case "--case": parsed.cases.push(readValue()); break;
      case "--out-dir": parsed.outDir = readValue(); break;
      case "--help": case "-h": printHelpAndExit(); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run test:interaction [options]\n\nRuns automated browser interaction tests for hover, crosshair, wheel zoom, pan, box zoom, reset, selection, linked sync, keyboard accessibility, and forced colors.\n\nOptions:\n  --case <name>      Run one case (repeatable), e.g. --case forced-colors\n  --out-dir <dir>    Forced-colors screenshot directory (default build/visual-tests/forced-colors)\n  --chrome <path>    Browser executable\n  --keep-browser     Leave Chrome running\n`);
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
