import type { Chart, ChartHoverState, ChartPickItem, ChartPickMode, ChartPlugin } from "./Chart.js";

export interface TooltipPluginOptions {
  readonly className?: string;
  readonly mode?: ChartPickMode;
  readonly maxDistancePx?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly formatter?: (item: ChartPickItem, state: ChartHoverState) => string;
  readonly render?: (state: ChartHoverState, container: HTMLElement, chart: Chart) => void;
}

function rgba(color: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
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
  container.replaceChildren();

  const title = document.createElement("div");
  title.style.marginBottom = "4px";
  title.style.color = "#bfdbfe";
  title.textContent = `x ${formatNumber(state.anchorX)}`;
  container.appendChild(title);

  for (const item of state.items) {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "10px auto auto";
    row.style.gap = "6px";
    row.style.alignItems = "center";

    const swatch = document.createElement("span");
    swatch.style.width = "8px";
    swatch.style.height = "8px";
    swatch.style.borderRadius = "999px";
    swatch.style.background = rgba(item.series.style.color);

    const label = document.createElement("span");
    label.style.color = "#dbeafe";
    label.textContent = item.name ?? item.id ?? `${item.mode} ${item.seriesIndex + 1}`;

    const value = document.createElement("span");
    value.style.color = "#e2e8f0";
    value.style.textAlign = "right";
    value.textContent = formatter ? formatter(item, state) : formatNumber(item.y);

    row.append(swatch, label, value);
    container.appendChild(row);
  }
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
      container.style.padding = "6px 8px";
      container.style.border = "1px solid rgba(148, 163, 184, 0.22)";
      container.style.borderRadius = "6px";
      container.style.background = "rgba(15, 23, 42, 0.86)";
      container.style.color = "#e2e8f0";
      container.style.font = "11px ui-monospace, monospace, sans-serif";
      container.style.boxShadow = "0 8px 22px rgba(0, 0, 0, 0.25)";
      container.style.whiteSpace = "nowrap";
      chart.rootElement.appendChild(container);

      const render = (state: ChartHoverState | null): void => {
        if (!state || state.items.length === 0) {
          container.style.display = "none";
          return;
        }

        if (options.render) {
          options.render(state, container, chart);
        } else {
          renderDefaultTooltip(state, container, options.formatter);
        }

        const rootRect = chart.rootElement.getBoundingClientRect();
        const x = state.clientX - rootRect.left + (options.offsetX ?? 12);
        const y = state.clientY - rootRect.top + (options.offsetY ?? 12);
        container.style.transform = `translate(${x}px, ${y}px)`;
        container.style.display = "block";
      };

      const usesCustomPick = options.mode !== undefined || options.maxDistancePx !== undefined;
      if (usesCustomPick) {
        const onMove = (event: PointerEvent): void => render(chart.pick(event.clientX, event.clientY, options));
        const onLeave = (): void => render(null);
        chart.canvas.addEventListener("pointermove", onMove);
        chart.canvas.addEventListener("pointerleave", onLeave);
        return () => {
          chart.canvas.removeEventListener("pointermove", onMove);
          chart.canvas.removeEventListener("pointerleave", onLeave);
          container.remove();
        };
      }

      const unsubscribe = chart.subscribe("hover", render);
      return () => {
        unsubscribe();
        container.remove();
      };
    },
  };
}
