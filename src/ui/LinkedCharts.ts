import { Chart } from "./Chart.js";
import type { ChartOptions, ChartSelectEvent } from "./Chart.js";
import type { ChartPlugin } from "./PluginHost.js";

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
  readonly syncX?: boolean;
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
  /**
   * Renderer for every panel that does not set its own `options.renderer`, for example
   * `sharedRenderer()` from `blazeplot/renderers/shared` so all panels use one WebGL context.
   */
  readonly renderer?: ChartOptions["renderer"];
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
  const root = target.ownerDocument.createElement("div");
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

  // Re-emitting `select` on a panel goes through a tiny plugin, the same contract third-party plugins use.
  const selectRelays = new Map<Chart, (selection: ChartSelectEvent["selection"]) => void>();

  for (const panel of options.panels) {
    const cell = target.ownerDocument.createElement("div");
    cell.className = panel.className ?? "blazeplot-linked-panel";
    Object.assign(cell.style, { position: "relative", minWidth: "0", minHeight: "0" });
    root.appendChild(cell);
    let relay: ((selection: ChartSelectEvent["selection"]) => void) | null = null;
    const relayPlugin: ChartPlugin = {
      install(ctx) {
        relay = (selection) => ctx.events.emit("select", { selection });
      },
    };
    const shared = [...(options.panelPlugins?.(syncGroup) ?? []), ...(options.syncSelections ? [relayPlugin] : [])];
    const panelOptions = options.renderer && !panel.options?.renderer ? { ...panel.options, renderer: options.renderer } : panel.options;
    const chartOptions = shared.length > 0 ? { ...panelOptions, plugins: [...(panelOptions?.plugins ?? []), ...shared] } : panelOptions;
    try {
      const chart = new Chart(cell, chartOptions);
      charts.push(chart);
      if (relay) selectRelays.set(chart, relay);
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
    if (options.syncX !== false) {
      // Mirrored updates must not pause the receiving panel's live follow; the pause itself is mirrored
      // through `followxchange`, so a user pan pauses every panel and resuming resumes them all.
      disposers.push(chart.subscribe("viewportchange", ({ viewport }) => {
        syncOthers(chart, (other) => other.setViewport({ xMin: viewport.xMin, xMax: viewport.xMax }, "left", { source: "linked", pauseFollow: false }));
      }));
      disposers.push(chart.subscribe("followxchange", ({ state }) => {
        if (state === "off") return;
        syncOthers(chart, (other) => {
          if (other.getFollowXState() !== "off") other.setFollowXPaused(state === "paused");
        });
      }));
    }
    if (options.syncSelections) {
      disposers.push(chart.subscribe("select", ({ selection }) => {
        syncOthers(chart, (other) => selectRelays.get(other)?.(selection));
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
