import { Chart, StaticDataset } from "@/index.ts";
import { createLinkedCharts } from "@/linked.ts";
import type { ChartHoverState, ChartPlugin, Viewport } from "@/index.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { selectionPlugin } from "@/plugins/selection.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import type { SelectionPlugin } from "@/plugins/selection.ts";
import { runRobustnessProbes } from "./robustness.ts";

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
  readonly error: string | null;
}

interface InteractionController {
  snapshot(): InteractionSnapshot;
  resetViewport(): void;
  setViewport(viewport: Partial<Viewport>): void;
}

declare global {
  interface Window {
    __blazeplotInteractionTest: InteractionController;
    __blazeplotRobustness?: typeof runRobustnessProbes;
  }
}

type InteractionCase = "interactions" | "selection" | "linked" | "mobile" | "mobile-longpress" | "lifecycle" | "render-loop" | "continuous-render-loop" | "live-follow" | "robustness";

const params = new URLSearchParams(window.location.search);
const rawCase = params.get("case");
const caseName: InteractionCase = rawCase === "selection"
  || rawCase === "linked"
  || rawCase === "mobile"
  || rawCase === "mobile-longpress"
  || rawCase === "lifecycle"
  || rawCase === "render-loop"
  || rawCase === "continuous-render-loop"
  || rawCase === "live-follow"
  || rawCase === "robustness"
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
let selection: SelectionPlugin | null = null;

if (caseName === "linked") {
  const linked = createLinkedCharts(chartTarget, {
    rows: 2,
    panels: [{}, {}],
    panelPlugins: (syncGroup) => [crosshairPlugin({ syncGroup }), tooltipPlugin({ syncGroup })],
    spacing: 6,
  });
  charts.push(...linked.charts);
} else {
  const plugins: ChartPlugin[] = caseName === "selection"
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
    followingLatestX: chart.getXFollowState() === "following",
    latestXFollowPaused: chart.getXFollowState() === "paused",
    error,
  }),
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
    const x = Float64Array.from({ length: 1_000 }, (_, i) => i);
    const y = Float32Array.from({ length: 1_000 }, (_, i) => Math.sin(i * 0.025 + chartIndex * 0.8));
    if (caseName === "render-loop") {
      const series = item.addLine({ capacity: 1_000, xStart: 0, xStep: 1, name: `interaction line ${chartIndex + 1}` }, { lineWidth: 2 });
      series.append({ y });
    } else {
      item.addLine({ dataset: new StaticDataset(x, y), name: `interaction line ${chartIndex + 1}` }, { lineWidth: 2 });
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
      item.followLatestX({ window: 100, pauseOnInteraction: true, resumeAfterMs: 120, currentX: () => epochLikeX + 1_020 + performance.now() - clockStartedAt });
    }
    if (caseName === "lifecycle") {
      item.start();
      item.start();
      item.stop();
    } else {
      item.start();
    }
  }
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
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function countVisible(selector: string): number {
  let total = 0;
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (getComputedStyle(element).display !== "none") total++;
  }
  return total;
}

function crosshairX(): number | null {
  const crosshair = document.querySelector<HTMLElement>(".blazeplot-crosshair");
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

function renderStatus(): void {
  statusTarget.textContent = state === "error" ? `error: ${error ?? "unknown"}` : `${state}: ${caseName}`;
}
