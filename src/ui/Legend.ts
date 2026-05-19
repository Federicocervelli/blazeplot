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
  readonly zIndex?: number;
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

function legendBorder(options: LegendPluginOptions, chart: Chart): string {
  const color = options.borderColor ?? chart.theme.legendBorderColor;
  return color === "transparent" ? "0" : `1px solid ${color}`;
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
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-pressed", String(item.visible));
    row.setAttribute("aria-label", `${item.visible ? "Hide" : "Show"} ${item.name ?? item.id ?? `${item.mode} ${item.index + 1}`}`);
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.border = "0";
    row.style.margin = "0";
    row.style.padding = "0";
    row.style.appearance = "none";
    row.style.background = "transparent";
    row.style.color = item.visible
      ? options.textColor ?? chart.theme.legendTextColor
      : options.mutedTextColor ?? chart.theme.legendMutedTextColor;
    row.style.font = "inherit";
    row.style.textAlign = "left";
    row.style.cursor = toggleOnClick ? "pointer" : "default";
    row.style.opacity = item.visible ? "1" : "0.45";

    const swatch = document.createElement("span");
    swatch.textContent = "\u2588";
    swatch.style.color = rgba(item.color);
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
      container.style.zIndex = String(options.zIndex ?? 40);
      container.style.pointerEvents = "auto";
      container.style.padding = "8px 10px";
      container.style.border = legendBorder(options, chart);
      container.style.background = options.backgroundColor ?? chart.theme.legendBackgroundColor;
      container.style.color = options.textColor ?? chart.theme.legendTextColor;
      container.style.font = options.font ?? chart.theme.legendFont;
      container.style.whiteSpace = "pre";
      container.style.userSelect = "none";
      container.setAttribute("role", "list");
      container.setAttribute("aria-label", "Chart series legend");
      applyPosition(container, options.position ?? "top-right");
      chart.rootElement.appendChild(container);

      const applyTheme = (): void => {
        container.style.border = legendBorder(options, chart);
        container.style.background = options.backgroundColor ?? chart.theme.legendBackgroundColor;
        container.style.color = options.textColor ?? chart.theme.legendTextColor;
        container.style.font = options.font ?? chart.theme.legendFont;
      };

      const render = (): void => {
        applyTheme();
        const state = chart.getSeriesState();
        if (options.render) {
          options.render(state, container, chart);
        } else {
          renderDefaultLegend(state, container, chart, options.toggleOnClick !== false, options);
        }
      };

      const unsubscribeSeries = chart.subscribe("serieschange", render);
      const unsubscribeTheme = chart.subscribe("themechange", render);
      render();

      return () => {
        unsubscribeSeries();
        unsubscribeTheme();
        container.remove();
      };
    },
  };
}
