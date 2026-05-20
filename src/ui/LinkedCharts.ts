import { crosshairPlugin } from "./Crosshair.js";
import { tooltipPlugin } from "./Tooltip.js";
import { createLinkedChartsWithPlugins, linkedChartsPlugin } from "./LinkedChartsCore.js";
import type { LinkedChartPanelOptions, LinkedChartsCoreOptions, LinkedChartsHandle } from "./LinkedChartsCore.js";

export type { LinkedChartPanelOptions, LinkedChartsHandle };

export interface LinkedChartsOptions extends LinkedChartsCoreOptions {
  readonly syncCrosshair?: boolean;
  readonly syncTooltips?: boolean;
}

export function createLinkedCharts(target: HTMLElement, options: LinkedChartsOptions): LinkedChartsHandle {
  return createLinkedChartsWithPlugins(target, options, {
    crosshair: (syncGroup) => crosshairPlugin({ group: syncGroup }),
    tooltip: (syncGroup) => tooltipPlugin({ syncGroup }),
  });
}

export { linkedChartsPlugin };
