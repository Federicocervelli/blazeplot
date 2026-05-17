import type { Chart, ChartPlugin, ChartSeriesState } from "./Chart.js";

export interface LegendPluginOptions {
  readonly className?: string;
  readonly position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  readonly toggleOnClick?: boolean;
  readonly backgroundColor?: string;
  readonly borderColor?: string;
  readonly textColor?: string;
  readonly mutedTextColor?: string;
  readonly font?: string;
  readonly render?: (state: readonly ChartSeriesState[], container: HTMLElement, chart: Chart) => void;
}

function rgba(color: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}

function applyPosition(el: HTMLElement, position: NonNullable<LegendPluginOptions["position"]>): void {
  el.style.top = position.startsWith("top") ? "8px" : "auto";
  el.style.bottom = position.startsWith("bottom") ? "8px" : "auto";
  el.style.left = position.endsWith("left") ? "8px" : "auto";
  el.style.right = position.endsWith("right") ? "8px" : "auto";
}

function renderDefaultLegend(
  state: readonly ChartSeriesState[],
  container: HTMLElement,
  chart: Chart,
  toggleOnClick: boolean,
  options: LegendPluginOptions,
): void {
  container.replaceChildren();

  for (const item of state) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.width = "100%";
    row.style.border = "0";
    row.style.padding = "2px 4px";
    row.style.background = "transparent";
    row.style.color = item.visible
      ? options.textColor ?? chart.theme.legendTextColor
      : options.mutedTextColor ?? chart.theme.legendMutedTextColor;
    row.style.font = options.font ?? chart.theme.legendFont;
    row.style.textAlign = "left";
    row.style.cursor = toggleOnClick ? "pointer" : "default";
    row.style.opacity = item.visible ? "1" : "0.45";

    const swatch = document.createElement("span");
    swatch.style.width = "10px";
    swatch.style.height = "10px";
    swatch.style.borderRadius = "2px";
    swatch.style.background = rgba(item.color);
    swatch.style.flex = "0 0 auto";

    const label = document.createElement("span");
    label.textContent = item.name ?? item.id ?? `${item.mode} ${item.index + 1}`;

    row.append(swatch, label);
    if (toggleOnClick) {
      row.addEventListener("click", () => {
        chart.setSeriesVisible(item.series, !item.visible);
      });
    }
    container.appendChild(row);
  }
}

export function legendPlugin(options: LegendPluginOptions = {}): ChartPlugin {
  return {
    install(chart: Chart) {
      const container = document.createElement("div");
      container.className = options.className ?? "blazeplot-legend";
      container.style.position = "absolute";
      container.style.zIndex = "20";
      container.style.pointerEvents = "auto";
      container.style.padding = "6px";
      container.style.border = `1px solid ${options.borderColor ?? chart.theme.legendBorderColor}`;
      container.style.borderRadius = "6px";
      container.style.background = options.backgroundColor ?? chart.theme.legendBackgroundColor;
      container.style.backdropFilter = "blur(4px)";
      container.style.userSelect = "none";
      applyPosition(container, options.position ?? "top-right");
      chart.rootElement.appendChild(container);

      const render = (): void => {
        const state = chart.getSeriesState();
        if (options.render) {
          options.render(state, container, chart);
        } else {
          renderDefaultLegend(state, container, chart, options.toggleOnClick !== false, options);
        }
      };

      const unsubscribe = chart.subscribe("serieschange", render);
      render();

      return () => {
        unsubscribe();
        container.remove();
      };
    },
  };
}
