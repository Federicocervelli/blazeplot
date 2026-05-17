import type { Chart, ChartHoverState, ChartPickItem, ChartPickMode, ChartPlugin } from "./Chart.js";

export interface TooltipPluginOptions {
  readonly className?: string;
  readonly mode?: ChartPickMode;
  readonly maxDistancePx?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly highlight?: boolean;
  readonly formatter?: (item: ChartPickItem, state: ChartHoverState) => string;
  readonly render?: (state: ChartHoverState, container: HTMLElement, chart: Chart) => void;
}

function labelOf(item: ChartPickItem): string {
  return item.name ?? item.id ?? `${item.mode} ${item.seriesIndex + 1}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs > 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(3);
  return Number(value.toPrecision(6)).toString();
}

function renderDefaultTooltip(
  state: ChartHoverState,
  container: HTMLElement,
  formatter: TooltipPluginOptions["formatter"],
): void {
  const lines: string[] = [`x ${formatNumber(state.anchorX)}`];
  const pad = Math.max(1, ...state.items.map((item) => labelOf(item).length));
  for (const item of state.items) {
    const value = formatter ? formatter(item, state) : `(${formatNumber(item.x)}, ${formatNumber(item.y)})`;
    lines.push(`${labelOf(item).padEnd(pad)}  ${value}`);
  }
  container.textContent = lines.join("\n");
}

function rgba(color: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}

export function tooltipPlugin(options: TooltipPluginOptions = {}): ChartPlugin {
  return {
    install(chart: Chart) {
      const container = document.createElement("div");
      container.className = options.className ?? "blazeplot-tooltip";
      container.style.position = "absolute";
      container.style.zIndex = "30";
      container.style.display = "none";
      container.style.pointerEvents = "none";
      container.style.background = "rgba(4, 8, 16, 0.85)";
      container.style.color = "#bfd6ff";
      container.style.font = "11px/1.35 ui-monospace, monospace";
      container.style.padding = "8px 10px";
      container.style.whiteSpace = "pre";
      chart.rootElement.appendChild(container);

      const markerLayer = document.createElement("div");
      markerLayer.className = "blazeplot-tooltip-markers";
      markerLayer.style.position = "absolute";
      markerLayer.style.inset = "0";
      markerLayer.style.zIndex = "25";
      markerLayer.style.pointerEvents = "none";
      chart.plotElement.appendChild(markerLayer);

      const renderMarkers = (state: ChartHoverState | null): void => {
        markerLayer.replaceChildren();
        if (options.highlight === false || !state) return;

        for (const item of state.items) {
          const marker = document.createElement("div");
          marker.style.position = "absolute";
          marker.style.left = `${item.plotX}px`;
          marker.style.top = `${item.plotY}px`;
          marker.style.width = "10px";
          marker.style.height = "10px";
          marker.style.border = "2px solid #f8fafc";
          marker.style.borderRadius = "999px";
          marker.style.background = rgba(item.series.style.color);
          marker.style.boxShadow = "0 0 0 2px rgba(4, 8, 16, 0.85)";
          marker.style.transform = "translate(-50%, -50%)";
          markerLayer.appendChild(marker);
        }
      };

      const render = (state: ChartHoverState | null): void => {
        const effectiveState = state && (options.mode !== undefined || options.maxDistancePx !== undefined)
          ? chart.pick(state.clientX, state.clientY, options)
          : state;

        renderMarkers(effectiveState);
        if (!effectiveState || effectiveState.items.length === 0) {
          container.style.display = "none";
          return;
        }

        if (options.render) {
          options.render(effectiveState, container, chart);
        } else {
          renderDefaultTooltip(effectiveState, container, options.formatter);
        }

        const rootRect = chart.rootElement.getBoundingClientRect();
        const x = effectiveState.clientX - rootRect.left + (options.offsetX ?? 12);
        const y = effectiveState.clientY - rootRect.top + (options.offsetY ?? 12);
        container.style.transform = `translate(${x}px, ${y}px)`;
        container.style.display = "block";
      };

      const unsubscribe = chart.subscribe("hover", render);
      return () => {
        unsubscribe();
        markerLayer.remove();
        container.remove();
      };
    },
  };
}
