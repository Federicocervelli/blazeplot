import { Chart, StaticDataset } from "@/index.ts";
import { createLinkedCharts } from "@/linked.ts";
import type { ChartHoverState, ChartPlugin, Viewport } from "@/index.ts";
import { a11yPlugin } from "@/plugins/a11y.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import type { AnnotationsPlugin } from "@/plugins/annotations.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { navigatorPlugin } from "@/plugins/navigator.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { selectionPlugin } from "@/plugins/selection.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import type { SelectionPlugin } from "@/plugins/selection.ts";
import { runRobustnessProbes } from "./robustness.ts";
import { testRenderer } from "../test-renderer.ts";

/** Engine for every chart on the page: WebGL2 unless the driving script passes `?renderer=`. */
const pageRenderer = testRenderer();

interface RectSnapshot {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface InteractionSnapshot {
  readonly state: "booting" | "ready" | "error";
  readonly caseName: string;
  readonly viewport: Viewport;
  readonly rightViewport: Viewport;
  readonly initialRightViewport: Viewport;
  readonly initialViewport: Viewport;
  readonly canvasRect: RectSnapshot;
  readonly xAxisRect: RectSnapshot;
  readonly yAxisRect: RectSnapshot;
  readonly hoverItems: number;
  readonly hoverEvents: number;
  readonly crosshairMoves: number;
  readonly selectionCommits: number;
  readonly selectionBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | null;
  readonly hasSelection: boolean;
  readonly selectionOverlay: RectSnapshot | null;
  readonly visibleCrosshairs: number;
  readonly visibleTooltips: number;
  readonly crosshairX: number | null;
  readonly tooltipLeft: number | null;
  readonly renderEvents: number;
  readonly followingLatestX: boolean;
  readonly latestXFollowPaused: boolean;
  readonly a11y: A11ySnapshot;
  readonly error: string | null;
}

/** Keyboard-only state for the `a11y` case. */
interface A11ySnapshot {
  /** `chart-root`, `annotation:<name>`, `legend:<name>`, the element's role, or `body`. */
  readonly active: string;
  /** Computed outline of the focused element, to check visible focus styles. */
  readonly activeOutline: string;
  readonly announcement: string;
  readonly selectionStatus: string;
  readonly hoverSource: string | null;
  readonly hoverSeries: string | null;
  readonly hoverIndex: number | null;
  readonly annotationCount: number;
  readonly annotationClicks: number;
  readonly tableRows: number;
  readonly describedBy: string;
}

/** Theme and computed overlay colors, for the forced-colors (high-contrast) check. */
interface ColorSnapshot {
  readonly forcedColorsMatches: boolean;
  readonly themeChanges: number;
  /** System colors as the browser resolves them right now. */
  readonly system: Readonly<Record<"Canvas" | "CanvasText" | "Highlight" | "LinkText" | "GrayText", string>>;
  readonly theme: {
    readonly backgroundCssColor: string;
    readonly backgroundColor: readonly number[];
    readonly seriesColors: readonly (readonly number[])[];
    readonly axisColor: string;
  };
  /** `style.color` of each series, in order. */
  readonly seriesColors: readonly (readonly number[])[];
  readonly rootBackground: string;
  readonly axisLabelColor: string | null;
  readonly titleColor: string | null;
  readonly legend: OverlayColors | null;
  readonly tooltip: OverlayColors | null;
  readonly selectionBorderColor: string | null;
  readonly activeOutlineColor: string | null;
  /** Computed `color` of the legend swatches and of the series swatches in the tooltip. */
  readonly legendSwatchColors: readonly string[];
  readonly tooltipSwatchColors: readonly string[];
  /** Computed `background-color` of the visible hover/inspection markers on the plot. */
  readonly pickMarkerBackgrounds: readonly string[];
  /** Computed SVG `fill` of the navigator's visible-range window. */
  readonly navigatorWindowFill: string | null;
}

interface OverlayColors {
  readonly background: string;
  readonly color: string;
  readonly borderColor: string;
  readonly borderStyle: string;
}

interface InteractionController {
  snapshot(): InteractionSnapshot;
  colors(): ColorSnapshot;
  resetViewport(): void;
  setViewport(viewport: Partial<Viewport>): void;
  /** Viewport and canvas rectangle (page coordinates) of every chart, for multi-chart cases. */
  panels(): Array<{ viewport: Viewport; canvasRect: RectSnapshot }>;
  /** Fraction of plot pixels in a fresh `chart.screenshot()` that differ from the background. */
  screenshotInk(): Promise<number>;
}

declare global {
  interface Window {
    __blazeplotInteractionTest: InteractionController;
    __blazeplotRobustness?: typeof runRobustnessProbes;
    /** iframe case: calls made from `src/` into the parent window or document (there should be none). */
    __blazeplotIframeProbe?: { hits(): string[] };
  }
}

type InteractionCase = "interactions" | "selection" | "linked" | "mobile" | "mobile-longpress" | "lifecycle" | "render-loop" | "continuous-render-loop" | "live-follow" | "robustness" | "a11y" | "arbitration" | "plain" | "cooperative" | "iframe" | "site-linked";

const params = new URLSearchParams(window.location.search);
const rawCase = params.get("case");
const caseName: InteractionCase = rawCase === "selection"
  || rawCase === "a11y"
  || rawCase === "linked"
  || rawCase === "mobile"
  || rawCase === "mobile-longpress"
  || rawCase === "lifecycle"
  || rawCase === "render-loop"
  || rawCase === "continuous-render-loop"
  || rawCase === "live-follow"
  || rawCase === "robustness"
  || rawCase === "arbitration"
  || rawCase === "plain"
  || rawCase === "cooperative"
  || rawCase === "iframe"
  || rawCase === "site-linked"
  ? rawCase
  : "interactions";
const chartTarget = requireElement<HTMLElement>("chart");
const statusTarget = requireElement<HTMLElement>("status");
const caseTarget = requireElement<HTMLElement>("caseName");
caseTarget.textContent = caseName;

const initialViewport = { xMin: 0, xMax: 999, yMin: -1.6, yMax: 1.6 };
// Right axis uses a different scale and direction to catch shared-anchor mistakes.
const initialRightViewport = { xMin: 0, xMax: 999, yMin: 3_400, yMax: 6_600 };
let state: InteractionSnapshot["state"] = "booting";
let error: string | null = null;
let hoverItems = 0;
let hoverEvents = 0;
let renderEvents = 0;
let crosshairMoves = 0;
let selectionCommits = 0;
let selectionBounds: InteractionSnapshot["selectionBounds"] = null;

const charts: Chart[] = [];
const seriesHandles: Array<ReturnType<Chart["addLine"]>> = [];
let themeChanges = 0;
let selection: SelectionPlugin | null = null;
let annotations: AnnotationsPlugin | null = null;
let annotationClicks = 0;

if (caseName === "a11y") {
  // Every keyboard-reachable built-in, for keyboard-only and axe checks.
  selection = selectionPlugin({
    mode: "x-range",
    onChange: (event) => {
      if (event.type !== "commit") return;
      selectionCommits++;
      selectionBounds = event.selection?.bounds ?? null;
    },
  });
  annotations = annotationsPlugin({
    annotations: [
      { type: "x-line", x: 300, label: "Deploy", removable: true },
      { type: "x-range", xMin: 600, xMax: 700, label: "Incident" },
    ],
    onClick: () => { annotationClicks++; },
  });
  charts.push(new Chart(chartTarget, {
    renderer: pageRenderer,
    title: "Accessible interaction chart",
    axes: { x: { position: "outside" }, y: { position: "outside" } },
    plugins: [a11yPlugin(), tooltipPlugin(), crosshairPlugin({ snap: "nearest-x", label: true, onMove: () => { crosshairMoves++; } }), selection, annotations, legendPlugin(), navigatorPlugin({ height: 48 })],
  }));
} else if (caseName === "iframe") {
  charts.push(createIframeChart());
} else if (caseName === "site-linked") {
  // The website feature preview: synced time/log panels with default box zoom, shift pan, and a shared crosshair.
  const panelPlugins = (): ChartPlugin[] => [interactionsPlugin({ minDragDistancePx: 4, shiftDragPan: true }), crosshairPlugin({ syncGroup: "site-linked", snap: "nearest-x" })];
  const linked = createLinkedCharts(chartTarget, {
    renderer: pageRenderer,
    rows: 2,
    spacing: 8,
    syncX: true,
    panels: [
      { options: { axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } }, plugins: panelPlugins() } },
      { options: { axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside", scale: "log", logBase: 10 } }, plugins: panelPlugins() } },
    ],
  });
  charts.push(...linked.charts);
} else if (caseName === "linked") {
  const linked = createLinkedCharts(chartTarget, {
    renderer: pageRenderer,
    rows: 2,
    panels: [{}, {}],
    panelPlugins: (syncGroup) => [crosshairPlugin({ syncGroup }), tooltipPlugin({ syncGroup })],
    spacing: 6,
  });
  charts.push(...linked.charts);
} else {
  const plugins: ChartPlugin[] = caseName === "plain"
    ? []
    : caseName === "cooperative"
    ? [interactionsPlugin({ minDragDistancePx: 4, wheelZoom: "modifier", touchPan: "two-finger" })]
    : caseName === "arbitration"
    // Both plugins at their defaults: one plain drag must do exactly one thing.
    ? [interactionsPlugin({ minDragDistancePx: 4 }), selection = selectionPlugin({
        mode: "xy",
        minDragDistancePx: 4,
        onChange: (event) => {
          if (event.type !== "commit") return;
          selectionCommits++;
          selectionBounds = event.selection?.bounds ?? null;
        },
      })]
    : caseName === "selection"
    ? [selection = selectionPlugin({
        mode: "xy",
        minDragDistancePx: 4,
        onChange: (event) => {
          if (event.type !== "commit") return;
          selectionCommits++;
          selectionBounds = event.selection?.bounds ?? null;
        },
      })]
    : caseName === "mobile"
      ? [
          interactionsPlugin({ minDragDistancePx: 4 }),
          tooltipPlugin(),
          crosshairPlugin({ snap: "nearest-x", label: true, onMove: () => { crosshairMoves++; } }),
        ]
      : caseName === "mobile-longpress"
        ? [tooltipPlugin(), crosshairPlugin({ snap: "nearest-x", label: true, onMove: () => { crosshairMoves++; } })]
        : [
            interactionsPlugin({ minDragDistancePx: 4 }),
            tooltipPlugin(),
            crosshairPlugin({ snap: "none", label: true, onMove: () => { crosshairMoves++; } }),
          ];
  charts.push(new Chart(chartTarget, {
    renderer: pageRenderer,
    axes: { x: { position: "outside" }, y: { position: "outside" }, y2: { position: "outside", reversed: true } },
    grid: true,
    plugins,
    renderLoop: caseName === "continuous-render-loop" ? "continuous" : "auto",
  }));
}

const chart = charts[0];
if (!chart) throw new Error("Interaction test did not create a chart.");
for (const item of charts) {
  item.subscribe("hover", (hover: ChartHoverState | null) => {
    hoverEvents++;
    hoverItems = hover?.items.length ?? 0;
  });
  item.subscribe("render", () => {
    renderEvents++;
  });
  item.subscribe("themechange", () => {
    themeChanges++;
  });
}

window.__blazeplotInteractionTest = {
  snapshot: () => ({
    state,
    caseName,
    viewport: chart.getViewport(),
    rightViewport: chart.getViewport("right"),
    initialViewport,
    initialRightViewport,
    canvasRect: rectOf(chart.canvas),
    xAxisRect: rectOf(chart.xAxisElement),
    yAxisRect: rectOf(chart.yAxisElement),
    hoverItems,
    hoverEvents,
    crosshairMoves,
    selectionCommits,
    selectionBounds,
    hasSelection: selection?.getSelection() != null,
    selectionOverlay: selectionOverlayRect(),
    visibleCrosshairs: countVisible(".blazeplot-crosshair"),
    visibleTooltips: countVisible(".blazeplot-tooltip"),
    crosshairX: crosshairX(),
    tooltipLeft: tooltipLeft(),
    renderEvents,
    followingLatestX: chart.getFollowXState() === "following",
    latestXFollowPaused: chart.getFollowXState() === "paused",
    a11y: a11ySnapshot(),
    error,
  }),
  colors: colorSnapshot,
  panels: () => charts.map((item) => ({ viewport: item.getViewport(), canvasRect: rectOf(item.canvas) })),
  screenshotInk: async () => {
    const bitmap = await createImageBitmap(await chart.screenshot());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(Math.abs(data[i]! - data[0]!), Math.abs(data[i + 1]! - data[1]!), Math.abs(data[i + 2]! - data[2]!)) > 40) ink++;
    }
    return ink / (bitmap.width * bitmap.height);
  },
  setViewport: (viewport) => chart.setViewport(viewport),
  resetViewport: () => {
    for (const item of charts) {
      item.setViewport(initialViewport);
      if (caseName === "interactions") item.setViewport(initialRightViewport, "right");
    }
  },
};

if (caseName === "robustness") window.__blazeplotRobustness = runRobustnessProbes;
if (caseName === "selection") {
  // An unrelated text field, to check that Escape typed there leaves the chart selection alone.
  const outside = document.createElement("input");
  outside.id = "outside-input";
  outside.style.cssText = "position:fixed;right:8px;top:4px;width:120px";
  document.body.appendChild(outside);
}

try {
  for (const [chartIndex, item] of charts.entries()) {
    if (caseName === "site-linked") {
      const xs = Float64Array.from({ length: 1_000 }, (_, i) => i);
      const ys = Float32Array.from(xs, (value) => 5 + 4 * Math.sin(value * 0.025 + chartIndex));
      item.addLine({ dataset: new StaticDataset(xs, ys), name: `site line ${chartIndex + 1}` }, { lineWidth: 2 });
      item.setViewport(chartIndex === 0 ? { xMin: 0, xMax: 999, yMin: 0, yMax: 10 } : { xMin: 0, xMax: 999, yMin: 1, yMax: 12 });
      item.start();
      continue;
    }
    const x = Float64Array.from({ length: 1_000 }, (_, i) => i);
    const y = Float32Array.from({ length: 1_000 }, (_, i) => Math.sin(i * 0.025 + chartIndex * 0.8));
    if (caseName === "render-loop") {
      const series = item.addLine({ capacity: 1_000, xStart: 0, xStep: 1, name: `interaction line ${chartIndex + 1}` }, { lineWidth: 2 });
      series.append({ y });
    } else {
      seriesHandles.push(item.addLine({ dataset: new StaticDataset(x, y), name: `interaction line ${chartIndex + 1}` }, { lineWidth: 2 }));
    }
    if (caseName === "a11y") {
      seriesHandles.push(item.addLine({ dataset: new StaticDataset(x, Float32Array.from(x, (value) => Math.cos(value * 0.025))), name: "interaction cosine" }, { lineWidth: 2 }));
    }
    if (caseName === "interactions") {
      const rightY = Float32Array.from(y, (value) => value * 1_000 + 5_000);
      item.addLine({ dataset: new StaticDataset(x, rightY), yAxis: "right", name: "right line" }, { lineWidth: 2 });
      item.setViewport(initialRightViewport, "right");
    }
    item.setViewport(initialViewport);
    if (caseName === "live-follow") {
      const clockStartedAt = performance.now();
      const epochLikeX = 1_700_000_000_000;
      item.followX({ window: 100, pauseOnInteraction: true, resumeAfterMs: 120, currentX: () => epochLikeX + 1_020 + performance.now() - clockStartedAt });
    }
    if (caseName === "lifecycle") {
      item.start();
      item.start();
      item.stop();
    } else {
      item.start();
    }
  }
  // A requested engine must be the one in use, so a suite never passes by quietly measuring a fallback.
  for (const item of charts) if (pageRenderer !== "auto" && item.renderer !== pageRenderer) throw new Error(`Expected the ${pageRenderer} engine, got ${item.renderer}.`);
  window.setTimeout(() => {
    state = "ready";
    renderStatus();
  }, 120);
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
  state = "error";
  renderStatus();
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function rectOf(el: Element): RectSnapshot {
  const rect = el.getBoundingClientRect();
  // Elements inside an iframe are measured in the frame; add the frame offset to get page coordinates.
  const frame = el.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
  return { left: rect.left + (frame?.left ?? 0), top: rect.top + (frame?.top ?? 0), width: rect.width, height: rect.height };
}

/** A chart that lives in an iframe, with traps on the parent window/document to catch global DOM access from `src/`. */
function createIframeChart(): Chart {
  const hits: string[] = [];
  const record = (label: string): void => {
    const stack = new Error().stack ?? "";
    const frames = stack.split("\n").slice(2);
    const origin = frames.find((frame) => frame.includes("/src/"));
    if (origin) hits.push(`${label} <- ${origin.trim()}`);
  };
  const wrap = (target: object, name: string, label: string): void => {
    const original = (target as Record<string, unknown>)[name];
    if (typeof original !== "function") return;
    (target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]): unknown {
      record(label);
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  };
  for (const name of ["createElement", "createElementNS", "createTextNode", "querySelector", "querySelectorAll", "getElementById", "addEventListener", "removeEventListener", "createRange", "createTreeWalker", "elementFromPoint", "elementsFromPoint"]) {
    wrap(Document.prototype, name, `document.${name}`);
  }
  for (const name of ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "addEventListener", "removeEventListener", "matchMedia"]) {
    wrap(window, name, `window.${name}`);
  }
  for (const name of ["devicePixelRatio", "innerWidth", "innerHeight"]) {
    const value = (window as unknown as Record<string, number>)[name];
    Object.defineProperty(window, name, { configurable: true, get: () => { record(`window.${name}`); return value; } });
  }
  const activeElement = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
  if (activeElement?.get) Object.defineProperty(Document.prototype, "activeElement", { configurable: true, get() { record("document.activeElement"); return activeElement.get!.call(this); } });
  window.__blazeplotIframeProbe = { hits: () => [...hits] };

  const frame = document.createElement("iframe");
  frame.style.cssText = "display:block;width:100%;height:100%;border:0";
  frame.title = "chart frame";
  chartTarget.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error("iframe has no document");
  doc.documentElement.style.cssText = "height:100%";
  doc.body.style.cssText = "margin:0;height:100%;background:#000";
  const host = doc.createElement("div");
  host.style.cssText = "width:100%;height:100%";
  doc.body.appendChild(host);
  return new Chart(host, {
    renderer: pageRenderer,
    title: "Chart in an iframe",
    axes: { x: { position: "outside" }, y: { position: "outside" } },
    grid: true,
    plugins: [interactionsPlugin({ minDragDistancePx: 4 }), legendPlugin(), tooltipPlugin(), crosshairPlugin({ snap: "none", label: true, onMove: () => { crosshairMoves++; } })],
  });
}

function chartDocument(): Document {
  return charts[0]?.rootElement.ownerDocument ?? document;
}

function countVisible(selector: string): number {
  let total = 0;
  for (const element of chartDocument().querySelectorAll<HTMLElement>(selector)) {
    if (getComputedStyle(element).display !== "none") total++;
  }
  return total;
}

function crosshairX(): number | null {
  const crosshair = chartDocument().querySelector<HTMLElement>(".blazeplot-crosshair");
  const vertical = crosshair?.querySelector<HTMLElement>(".blazeplot-crosshair-lines > div");
  if (!crosshair || !vertical || getComputedStyle(crosshair).display === "none") return null;
  const value = Number.parseFloat(vertical.style.left);
  return Number.isFinite(value) ? value : null;
}

function selectionOverlayRect(): RectSnapshot | null {
  const overlay = document.querySelector<HTMLElement>(".blazeplot-selection-brush");
  if (!overlay || getComputedStyle(overlay).display === "none") return null;
  return rectOf(overlay);
}

function tooltipLeft(): number | null {
  const tooltip = document.querySelector<HTMLElement>(".blazeplot-tooltip");
  if (!tooltip || getComputedStyle(tooltip).display === "none") return null;
  const translated = /translate\(([-0-9.]+)px/.exec(tooltip.style.transform)?.[1];
  const value = Number.parseFloat(translated ?? tooltip.style.left);
  return Number.isFinite(value) ? value : null;
}

function describeActive(): string {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return "body";
  if (active === chart?.rootElement) return "chart-root";
  if (active.classList.contains("blazeplot-annotation-focus")) return `annotation:${active.getAttribute("aria-label") ?? ""}`;
  if (active.closest(".blazeplot-legend")) return `legend:${active.getAttribute("aria-label") ?? ""}`;
  return active.getAttribute("role") ?? active.tagName.toLowerCase();
}

function a11ySnapshot(): A11ySnapshot {
  const hover = chart?.getHoverState() ?? null;
  const active = document.activeElement as HTMLElement | null;
  const outline = active && active !== document.body ? getComputedStyle(active) : null;
  const describedBy = chart?.rootElement.getAttribute("aria-describedby");
  return {
    active: describeActive(),
    activeOutline: outline ? `${outline.outlineStyle} ${outline.outlineWidth} ${outline.outlineColor}` : "",
    announcement: (document.querySelector(".blazeplot-a11y-announcer")?.textContent ?? "").trim(),
    selectionStatus: (document.querySelector(".blazeplot-selection-status")?.textContent ?? "").trim(),
    hoverSource: hover?.source ?? null,
    hoverSeries: hover?.items[0]?.name ?? null,
    hoverIndex: hover?.items[0]?.index ?? null,
    annotationCount: annotations?.getAnnotations().length ?? 0,
    annotationClicks,
    tableRows: document.querySelectorAll(".blazeplot-a11y tbody tr").length,
    describedBy: describedBy ? document.getElementById(describedBy)?.textContent ?? "" : "",
  };
}

function colorSnapshot(): ColorSnapshot {
  const root = chart!.rootElement;
  const resolveSystem = (name: string): string => {
    const probe = document.createElement("span");
    probe.style.color = name;
    root.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  };
  const overlay = (selector: string): OverlayColors | null => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element || getComputedStyle(element).display === "none") return null;
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, borderColor: style.borderTopColor, borderStyle: style.borderTopStyle };
  };
  const colorOf = (selector: string): string | null => {
    const element = root.querySelector<HTMLElement>(selector);
    return element ? getComputedStyle(element).color : null;
  };
  const brush = document.querySelector<HTMLElement>(".blazeplot-selection-brush");
  const active = document.activeElement as HTMLElement | null;
  const theme = chart!.theme;
  return {
    forcedColorsMatches: window.matchMedia("(forced-colors: active)").matches,
    themeChanges,
    system: {
      Canvas: resolveSystem("Canvas"),
      CanvasText: resolveSystem("CanvasText"),
      Highlight: resolveSystem("Highlight"),
      LinkText: resolveSystem("LinkText"),
      GrayText: resolveSystem("GrayText"),
    },
    theme: {
      backgroundCssColor: theme.backgroundCssColor,
      backgroundColor: [...theme.backgroundColor],
      seriesColors: theme.seriesColors.map((color) => [...color]),
      axisColor: theme.axisColor,
    },
    seriesColors: seriesHandles.map((series) => [...series.style.color]),
    rootBackground: getComputedStyle(root).backgroundColor,
    axisLabelColor: colorOf(".blazeplot-axis-y div"),
    titleColor: colorOf(".blazeplot-title"),
    legend: overlay(".blazeplot-legend"),
    tooltip: overlay(".blazeplot-tooltip"),
    selectionBorderColor: brush && getComputedStyle(brush).display !== "none" ? getComputedStyle(brush).borderTopColor : null,
    activeOutlineColor: active && active !== document.body ? getComputedStyle(active).outlineColor : null,
    legendSwatchColors: [...document.querySelectorAll<HTMLElement>(".blazeplot-legend-swatch")].map((swatch) => getComputedStyle(swatch).color),
    tooltipSwatchColors: [...document.querySelectorAll<HTMLElement>(".blazeplot-tooltip .blazeplot-pick-swatch")].map((swatch) => getComputedStyle(swatch).color),
    pickMarkerBackgrounds: [...document.querySelectorAll<HTMLElement>(".blazeplot-tooltip-markers .blazeplot-pick-marker")]
      .filter((marker) => getComputedStyle(marker).display !== "none")
      .map((marker) => getComputedStyle(marker).backgroundColor),
    navigatorWindowFill: (() => {
      const windowRect = document.querySelector<SVGElement>(".blazeplot-navigator-window");
      return windowRect ? getComputedStyle(windowRect).fill : null;
    })(),
  };
}

function renderStatus(): void {
  statusTarget.textContent = state === "error" ? `error: ${error ?? "unknown"}` : `${state}: ${caseName}`;
}
