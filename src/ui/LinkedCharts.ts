import { crosshairPlugin } from "./Crosshair.js";
import { tooltipPlugin } from "./Tooltip.js";
import { createLinkedChartsWithPlugins, linkedChartsPlugin } from "./LinkedChartsCore.js";
import type { LinkedChartPanelOptions, LinkedChartsCoreOptions, LinkedChartsHandle } from "./LinkedChartsCore.js";

/** Core linked-chart panel options and handle types. */
export type { LinkedChartPanelOptions, LinkedChartsHandle };

/** Options for linked charts with optional crosshair and tooltip synchronization. */
export interface LinkedChartsOptions extends LinkedChartsCoreOptions {
  readonly syncCrosshair?: boolean;
  readonly syncTooltips?: boolean;
}

/** Create a linked chart grid with optional synchronized overlays. */
export function createLinkedCharts(target: HTMLElement, options: LinkedChartsOptions): LinkedChartsHandle {
  return createLinkedChartsWithPlugins(target, options, {
    crosshair: (syncGroup) => crosshairPlugin({ group: syncGroup }),
    tooltip: (syncGroup) => tooltipPlugin({ syncGroup }),
  });
}

export { linkedChartsPlugin };
