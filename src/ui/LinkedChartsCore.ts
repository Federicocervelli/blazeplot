import { Chart } from "./Chart.js";
import type { ChartOptions, ChartPlugin, ChartSelectEvent, ChartViewportChangeEvent } from "./Chart.js";

/** Options for one chart panel in a linked layout. */
export interface LinkedChartPanelOptions {
  readonly options?: ChartOptions;
  readonly className?: string;
}

/** Options for creating a grid of linked chart panels. */
export interface LinkedChartsCoreOptions {
  readonly rows?: number;
  readonly columns?: number;
  readonly panels: readonly LinkedChartPanelOptions[];
  readonly sharedX?: boolean;
  readonly syncSelections?: boolean;
  readonly spacing?: number | string;
  readonly className?: string;
}

/** Handle returned by linked chart helpers. */
export interface LinkedChartsHandle {
  readonly root: HTMLDivElement;
  readonly charts: readonly Chart[];
  setXRange(xMin: number, xMax: number): void;
  dispose(): void;
}

interface LinkedChartsPluginOptions extends LinkedChartsCoreOptions {
  readonly syncCrosshair?: boolean;
  readonly syncTooltips?: boolean;
}

interface LinkedChartsSyncPlugins {
  readonly crosshair?: (syncGroup: string) => ChartPlugin;
  readonly tooltip?: (syncGroup: string) => ChartPlugin;
}

function cssSize(value: number | string | undefined, fallback: string): string {
  return typeof value === "number" ? `${value}px` : value ?? fallback;
}

let linkedChartsId = 0;

/** Create linked charts without optional tooltip or crosshair sync plugins. */
export function createLinkedCharts(target: HTMLElement, options: LinkedChartsCoreOptions): LinkedChartsHandle {
  return createLinkedChartsWithPlugins(target, options);
}

/** Create linked charts with optional sync plugin factories. */
export function createLinkedChartsWithPlugins(
  target: HTMLElement,
  options: LinkedChartsPluginOptions,
  syncPlugins: LinkedChartsSyncPlugins = {},
): LinkedChartsHandle {
  const rows = Math.max(1, Math.floor(options.rows ?? options.panels.length));
  const columns = Math.max(1, Math.floor(options.columns ?? Math.ceil(options.panels.length / rows)));
  const root = document.createElement("div");
  const charts: Chart[] = [];
  const disposers: Array<() => void> = [];
  let syncingViewport = false;
  let syncingSelection = false;
  const syncGroup = `blazeplot-linked-${linkedChartsId++}`;

  root.className = options.className ?? "blazeplot-linked-charts";
  root.style.display = "grid";
  root.style.width = "100%";
  root.style.height = "100%";
  root.style.minWidth = "0";
  root.style.minHeight = "0";
  root.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  root.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  root.style.gap = cssSize(options.spacing, "8px");
  target.appendChild(root);

  for (const panel of options.panels) {
    const cell = document.createElement("div");
    cell.className = panel.className ?? "blazeplot-linked-panel";
    cell.style.position = "relative";
    cell.style.minWidth = "0";
    cell.style.minHeight = "0";
    root.appendChild(cell);
    const plugins = [...(panel.options?.plugins ?? [])];
    if (options.syncCrosshair && syncPlugins.crosshair) plugins.push(syncPlugins.crosshair(syncGroup));
    if (options.syncTooltips && syncPlugins.tooltip) plugins.push(syncPlugins.tooltip(syncGroup));
    const chartOptions = plugins.length > 0 ? { ...panel.options, plugins } : panel.options;
    charts.push(new Chart(cell, chartOptions));
  }

  const setXRange = (xMin: number, xMax: number): void => {
    syncingViewport = true;
    try {
      for (const chart of charts) chart.setViewport({ xMin, xMax });
    } finally {
      syncingViewport = false;
    }
  };

  if (options.sharedX !== false) {
    for (const chart of charts) {
      disposers.push(chart.subscribe("viewportchange", (event: ChartViewportChangeEvent) => {
        if (syncingViewport) return;
        syncingViewport = true;
        try {
          for (const other of charts) {
            if (other !== chart) other.setViewport({ xMin: event.viewport.xMin, xMax: event.viewport.xMax });
          }
        } finally {
          syncingViewport = false;
        }
      }));
    }
  }

  if (options.syncSelections) {
    for (const chart of charts) {
      disposers.push(chart.subscribe("select", (event: ChartSelectEvent) => {
        if (syncingSelection) return;
        syncingSelection = true;
        try {
          for (const other of charts) {
            if (other !== chart) other.emitSelect(event.selection);
          }
        } finally {
          syncingSelection = false;
        }
      }));
    }
  }

  return {
    root,
    charts,
    setXRange,
    dispose(): void {
      for (const dispose of disposers.splice(0)) dispose();
      for (const chart of charts.splice(0)) chart.dispose();
      root.remove();
    },
  };
}

/** Marker plugin for shared plugin arrays used by linked chart layouts. */
export function linkedChartsPlugin(): ChartPlugin {
  return {
    install() {
      // Marker plugin for codebases that share plugin arrays between single charts and linked layouts.
    },
  };
}
