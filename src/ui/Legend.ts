import type { ChartSeriesState } from "./Chart.js";
import type { ChartPlugin, ChartPluginContext } from "./PluginHost.js";
import { rgbaCss } from "./theme.js";

/** Options for the built-in series legend plugin. */
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
  /** Replace the default rows. Called on install, series changes, and theme changes. */
  readonly render?: (state: readonly ChartSeriesState[], container: HTMLElement, chart: ChartPluginContext) => void;
}

function applyPosition(el: HTMLElement, position: NonNullable<LegendPluginOptions["position"]>): void {
  el.style.top = position.startsWith("top") ? "8px" : "auto";
  el.style.bottom = position.startsWith("bottom") ? "8px" : "auto";
  el.style.left = position.endsWith("left") ? "8px" : "auto";
  el.style.right = position.endsWith("right") ? "8px" : "auto";
}

function legendBorder(options: LegendPluginOptions, chart: ChartPluginContext): string {
  const color = options.borderColor ?? chart.theme.legendBorderColor;
  return color === "transparent" ? "0" : `1px solid ${color}`;
}

interface LegendRow {
  element: HTMLElement;
  swatch: HTMLElement;
  label: HTMLElement;
}

function renderDefaultLegend(
  state: readonly ChartSeriesState[],
  container: HTMLElement,
  chart: ChartPluginContext,
  toggleOnClick: boolean,
  options: LegendPluginOptions,
  rows: Map<ChartSeriesState["series"], LegendRow>,
): void {
  const current = new Set(state.map((item) => item.series));
  for (const [series, row] of rows) {
    if (!current.has(series)) { row.element.remove(); rows.delete(series); }
  }

  for (const [index, item] of state.entries()) {
    let entry = rows.get(item.series);
    if (!entry) {
      const row = chart.dom.document.createElement(toggleOnClick ? "button" : "span");
      if (toggleOnClick) {
        const button = row as HTMLButtonElement;
        button.type = "button";
        row.addEventListener("click", () => item.series.setVisible(!item.series.visible));
      }
      Object.assign(row.style, {
        display: "flex", alignItems: "center", gap: "6px", border: "0", margin: "0", padding: "0",
        appearance: "none", background: "transparent", font: "inherit", textAlign: "left",
        cursor: toggleOnClick ? "pointer" : "default", outlineOffset: "2px",
      });
      const swatch = chart.dom.document.createElement("span");
      swatch.textContent = "\u2588";
      swatch.className = "blazeplot-legend-swatch";
      swatch.setAttribute("aria-hidden", "true");
      swatch.style.flex = "0 0 auto";
      const label = chart.dom.document.createElement("span");
      row.append(swatch, label);
      entry = { element: row, swatch, label };
      rows.set(item.series, entry);
    }
    const { element, swatch, label } = entry;
    const name = item.name ?? item.id ?? `${item.mode} ${item.index + 1}`;
    if (toggleOnClick) {
      element.setAttribute("aria-pressed", String(item.visible));
      element.setAttribute("aria-label", name);
      element.title = `${item.visible ? "Hide" : "Show"} ${name}`;
    }
    element.style.color = item.visible
      ? options.textColor ?? chart.theme.legendTextColor
      : options.mutedTextColor ?? chart.theme.legendMutedTextColor;
    // Hidden series keep readable (4.5:1) muted text; the dimmed swatch and strike-through mark the state without color.
    swatch.style.opacity = item.visible ? "1" : "0.45";
    label.style.textDecoration = item.visible ? "none" : "line-through";
    swatch.style.color = rgbaCss(item.color);
    label.textContent = name;
    // Leave existing nodes in place so theme and series updates retain keyboard focus.
    const atIndex = container.children.item(index);
    if (atIndex !== element) container.insertBefore(element, atIndex);
  }
}

/** Create a plugin that renders a clickable series legend. */
export function legendPlugin(options: LegendPluginOptions = {}): ChartPlugin {
  return {
    install(chart: ChartPluginContext) {
      const container = chart.dom.document.createElement("div");
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
      container.setAttribute("data-blazeplot-screenshot-box", "");
      container.setAttribute("role", "group");
      container.setAttribute("aria-label", "Chart series legend");
      applyPosition(container, options.position ?? "top-right");
      const unmount = chart.dom.mount("root", container);

      const applyTheme = (): void => {
        container.style.border = legendBorder(options, chart);
        container.style.background = options.backgroundColor ?? chart.theme.legendBackgroundColor;
        container.style.color = options.textColor ?? chart.theme.legendTextColor;
        container.style.font = options.font ?? chart.theme.legendFont;
      };

      const rows = new Map<ChartSeriesState["series"], LegendRow>();
      const render = (): void => {
        applyTheme();
        const state = chart.state.getSeries();
        if (options.render) {
          options.render(state, container, chart);
        } else {
          renderDefaultLegend(state, container, chart, options.toggleOnClick !== false, options, rows);
        }
      };

      const unsubscribeSeries = chart.events.subscribe("serieschange", render);
      render();

      return {
        onThemeChange: render,
        dispose() {
          unsubscribeSeries();
          rows.clear();
          unmount();
        },
      };
    },
  };
}
