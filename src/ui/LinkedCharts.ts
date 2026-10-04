import { Chart } from "./Chart.js";
import type { ChartOptions, ChartPlugin } from "./Chart.js";

/** Options for one chart panel in a linked layout. */
export interface LinkedChartPanelOptions {
  readonly options?: ChartOptions;
  readonly className?: string;
}

/** Options for creating a grid of linked chart panels. */
export interface LinkedChartsOptions {
  readonly panels: readonly LinkedChartPanelOptions[];
  /** Grid rows. Defaults to one row per panel. */
  readonly rows?: number;
  readonly columns?: number;
  /** Keep every panel's X domain in sync. Defaults to true. */
  readonly sharedX?: boolean;
  /** Re-emit `select` events from one panel on the others. */
  readonly syncSelections?: boolean;
  /** Grid gap as CSS pixels or a CSS length. Defaults to 8px. */
  readonly spacing?: number | string;
  readonly className?: string;
  /**
   * Plugins added to every panel, created once per panel. `syncGroup` is unique
   * to this layout, so `(syncGroup) => [crosshairPlugin({ syncGroup }), tooltipPlugin({ syncGroup })]`
   * links crosshairs and tooltips across panels.
   */
  readonly panelPlugins?: (syncGroup: string) => readonly ChartPlugin[];
}

/** Handle returned by `createLinkedCharts`. */
export interface LinkedChartsHandle {
  readonly root: HTMLDivElement;
  readonly charts: readonly Chart[];
  /** Set the X domain on every panel. */
  setXRange(xMin: number, xMax: number): void;
  dispose(): void;
}

let linkedChartsId = 0;

/** Create a grid of charts that share X pans/zooms and, optionally, plugins and selections. */
export function createLinkedCharts(target: HTMLElement, options: LinkedChartsOptions): LinkedChartsHandle {
  const rows = Math.max(1, Math.floor(options.rows ?? options.panels.length));
  const columns = Math.max(1, Math.floor(options.columns ?? Math.ceil(options.panels.length / rows)));
  const root = document.createElement("div");
  const charts: Chart[] = [];
  const disposers: Array<() => void> = [];
  const syncGroup = `blazeplot-linked-${linkedChartsId++}`;
  let syncing = false;

  root.className = options.className ?? "blazeplot-linked-charts";
  Object.assign(root.style, {
    display: "grid",
    width: "100%",
    height: "100%",
    minWidth: "0",
    minHeight: "0",
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap: typeof options.spacing === "number" ? `${options.spacing}px` : options.spacing ?? "8px",
  });
  target.appendChild(root);

  for (const panel of options.panels) {
    const cell = document.createElement("div");
    cell.className = panel.className ?? "blazeplot-linked-panel";
    Object.assign(cell.style, { position: "relative", minWidth: "0", minHeight: "0" });
    root.appendChild(cell);
    const shared = options.panelPlugins?.(syncGroup) ?? [];
    const chartOptions = shared.length > 0 ? { ...panel.options, plugins: [...(panel.options?.plugins ?? []), ...shared] } : panel.options;
    try {
      charts.push(new Chart(cell, chartOptions));
    } catch (error) {
      // A panel failed (e.g. no WebGL2): release the panels already built.
      for (const chart of charts) chart.dispose();
      root.remove();
      throw error;
    }
  }

  /** Apply `update` to every chart except `source` without re-entering the sync listeners. */
  const syncOthers = (source: Chart | null, update: (chart: Chart) => void): void => {
    if (syncing) return;
    syncing = true;
    try {
      for (const chart of charts) {
        if (chart !== source) update(chart);
      }
    } finally {
      syncing = false;
    }
  };

  for (const chart of charts) {
    if (options.sharedX !== false) {
      disposers.push(chart.subscribe("viewportchange", ({ viewport }) => {
        syncOthers(chart, (other) => other.setViewport({ xMin: viewport.xMin, xMax: viewport.xMax }));
      }));
    }
    if (options.syncSelections) {
      disposers.push(chart.subscribe("select", ({ selection }) => {
        syncOthers(chart, (other) => other.emitSelect(selection));
      }));
    }
  }

  return {
    root,
    charts,
    setXRange(xMin: number, xMax: number): void {
      syncOthers(null, (chart) => chart.setViewport({ xMin, xMax }));
    },
    dispose(): void {
      for (const dispose of disposers.splice(0)) dispose();
      for (const chart of charts.splice(0)) chart.dispose();
      root.remove();
    },
  };
}
