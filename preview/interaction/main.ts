import { Chart, StaticDataset } from "@/index.ts";
import { createLinkedCharts } from "@/linked.ts";
import type { ChartHoverState, ChartPlugin, Viewport } from "@/index.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { selectionPlugin } from "@/plugins/selection.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";

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
  readonly initialViewport: Viewport;
  readonly canvasRect: RectSnapshot;
  readonly xAxisRect: RectSnapshot;
  readonly yAxisRect: RectSnapshot;
  readonly hoverItems: number;
  readonly hoverEvents: number;
  readonly crosshairMoves: number;
  readonly selectionCommits: number;
  readonly selectionBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | null;
  readonly visibleCrosshairs: number;
  readonly visibleTooltips: number;
  readonly error: string | null;
}

interface InteractionController {
  snapshot(): InteractionSnapshot;
  resetViewport(): void;
}

declare global {
  interface Window {
    __blazeplotInteractionTest: InteractionController;
  }
}

type InteractionCase = "interactions" | "selection" | "linked" | "mobile" | "mobile-longpress";

const params = new URLSearchParams(window.location.search);
const rawCase = params.get("case");
const caseName: InteractionCase = rawCase === "selection" || rawCase === "linked" || rawCase === "mobile" || rawCase === "mobile-longpress" ? rawCase : "interactions";
const chartTarget = requireElement<HTMLElement>("chart");
const statusTarget = requireElement<HTMLElement>("status");
const caseTarget = requireElement<HTMLElement>("caseName");
caseTarget.textContent = caseName;

const initialViewport = { xMin: 0, xMax: 999, yMin: -1.6, yMax: 1.6 };
let state: InteractionSnapshot["state"] = "booting";
let error: string | null = null;
let hoverItems = 0;
let hoverEvents = 0;
let crosshairMoves = 0;
let selectionCommits = 0;
let selectionBounds: InteractionSnapshot["selectionBounds"] = null;

const charts: Chart[] = [];

if (caseName === "linked") {
  const linked = createLinkedCharts(chartTarget, {
    rows: 2,
    panels: [{}, {}],
    syncCrosshair: true,
    syncTooltips: true,
    spacing: 6,
  });
  charts.push(...linked.charts);
} else {
  const plugins: ChartPlugin[] = caseName === "selection"
    ? [selectionPlugin({
        mode: "xy",
        minDragDistancePx: 4,
        onCommit: (event) => {
          selectionCommits++;
          selectionBounds = event.selection?.bounds ?? null;
        },
      })]
    : caseName === "mobile"
      ? [interactionsPlugin({ minDragDistancePx: 4 })]
      : caseName === "mobile-longpress"
        ? [tooltipPlugin(), crosshairPlugin({ snap: "nearest-x", label: true, onMove: () => { crosshairMoves++; } })]
        : [
            interactionsPlugin({ minDragDistancePx: 4 }),
            tooltipPlugin(),
            crosshairPlugin({ snap: "none", label: true, onMove: () => { crosshairMoves++; } }),
          ];
  charts.push(new Chart(chartTarget, { axes: { x: { position: "outside" }, y: { position: "outside" } }, grid: true, plugins }));
}

const chart = charts[0];
if (!chart) throw new Error("Interaction test did not create a chart.");
for (const item of charts) {
  item.subscribe("hover", (hover: ChartHoverState | null) => {
    hoverEvents++;
    hoverItems = hover?.items.length ?? 0;
  });
}

window.__blazeplotInteractionTest = {
  snapshot: () => ({
    state,
    caseName,
    viewport: chart.getViewport(),
    initialViewport,
    canvasRect: rectOf(chart.canvas),
    xAxisRect: rectOf(chart.xAxisElement),
    yAxisRect: rectOf(chart.yAxisElement),
    hoverItems,
    hoverEvents,
    crosshairMoves,
    selectionCommits,
    selectionBounds,
    visibleCrosshairs: countVisible(".blazeplot-crosshair"),
    visibleTooltips: countVisible(".blazeplot-tooltip"),
    error,
  }),
  resetViewport: () => {
    for (const item of charts) item.setViewport(initialViewport);
  },
};

try {
  for (const [chartIndex, item] of charts.entries()) {
    const x = Float64Array.from({ length: 1_000 }, (_, i) => i);
    const y = Float32Array.from({ length: 1_000 }, (_, i) => Math.sin(i * 0.025 + chartIndex * 0.8));
    item.addLine({ dataset: new StaticDataset(x, y), name: `interaction line ${chartIndex + 1}` }, { lineWidth: 2 });
    item.setViewport(initialViewport);
    item.start();
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

function renderStatus(): void {
  statusTarget.textContent = state === "error" ? `error: ${error ?? "unknown"}` : `${state}: ${caseName}`;
}
