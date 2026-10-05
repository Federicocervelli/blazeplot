import type { ChartSeriesState } from "./Chart.js";
import type { ChartPlugin, ChartPluginContext } from "./PluginHost.js";
import { installPluginStyle } from "./OverlayUtils.js";
import { rgbaCss } from "./theme.js";

const LEGEND_CSS = "@media (forced-colors:active){.blazeplot-legend{border:1px solid CanvasText}.blazeplot-legend-swatch{forced-color-adjust:none}}";

/** Every user-facing string of `legendPlugin`. Unset keys keep their English defaults. */
export interface LegendMessages {
  /** Accessible name of the legend group. */
  readonly ariaLabel: string;
  /** Tooltip (`title`) of a visible series' toggle button. */
  readonly hide: (name: string) => string;
  /** Tooltip (`title`) of a hidden series' toggle button. */
  readonly show: (name: string) => string;
  /** Fallback series name when it has neither `name` nor `id`. */
  readonly seriesName: (mode: string, index: number) => string;
}

/** English defaults for `LegendMessages`. */
export const DEFAULT_LEGEND_MESSAGES: LegendMessages = {
  ariaLabel: "Chart series legend",
  hide: (name) => `Hide ${name}`,
  show: (name) => `Show ${name}`,
  seriesName: (mode, index) => `${mode} ${index + 1}`,
};

/** Options for the built-in series legend plugin. */
export interface LegendPluginOptions {
  /** Override legend strings, for localization. */
  readonly messages?: Partial<LegendMessages>;
  readonly className?: string;
  /**
   * Corner placements overlay the plot. `"top"`, `"bottom"`, `"left"`, and `"right"` sit
   * outside it: the legend reserves space through `ctx.layout.reserve` and the plot shrinks to fit.
   * Defaults to `"top-right"`.
   */
  readonly position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "bottom" | "left" | "right";
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

type LegendPosition = NonNullable<LegendPluginOptions["position"]>;

const OUTSIDE_POSITIONS: ReadonlySet<LegendPosition> = new Set(["top", "bottom", "left", "right"]);
/** Gap between an outside legend and the chart edge, and between the legend and the plot. */
const OUTSIDE_LEGEND_GAP_PX = 8;

function applyPosition(el: HTMLElement, position: LegendPosition): void {
  if (OUTSIDE_POSITIONS.has(position)) {
    // Outside legends sit in space reserved at the chart edge, centered along it.
    const horizontal = position === "top" || position === "bottom";
    el.style.top = position === "top" ? `${OUTSIDE_LEGEND_GAP_PX}px` : position === "bottom" ? "auto" : "50%";
    el.style.bottom = position === "bottom" ? `${OUTSIDE_LEGEND_GAP_PX}px` : "auto";
    el.style.left = position === "left" ? `${OUTSIDE_LEGEND_GAP_PX}px` : position === "right" ? "auto" : "50%";
    el.style.right = position === "right" ? `${OUTSIDE_LEGEND_GAP_PX}px` : "auto";
    el.style.transform = horizontal ? "translateX(-50%)" : "translateY(-50%)";
    el.style.display = "flex";
    el.style.flexDirection = horizontal ? "row" : "column";
    el.style.gap = horizontal ? "14px" : "4px";
    return;
  }
  el.style.top = position.startsWith("top") ? "8px" : "auto";
  el.style.bottom = position.startsWith("bottom") ? "8px" : "auto";
  el.style.left = position.endsWith("left") ? "8px" : "auto";
  el.style.right = position.endsWith("right") ? "8px" : "auto";
  el.style.transform = "";
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
  const messages: LegendMessages = { ...DEFAULT_LEGEND_MESSAGES, ...options.messages };
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
    const name = item.name ?? item.id ?? messages.seriesName(item.mode, item.index);
    if (toggleOnClick) {
      element.setAttribute("aria-pressed", String(item.visible));
      element.setAttribute("aria-label", name);
      element.title = item.visible ? messages.hide(name) : messages.show(name);
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
      const releaseStyle = installPluginStyle(chart, "legend", LEGEND_CSS);
      const messages: LegendMessages = { ...DEFAULT_LEGEND_MESSAGES, ...options.messages };
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
      container.setAttribute("aria-label", messages.ariaLabel);
      const position = options.position ?? "top-right";
      applyPosition(container, position);
      chart.dom.mount("root", container);

      // Outside placements reserve the legend's measured size so the plot shrinks instead of being covered.
      let releaseReservation: (() => void) | null = null;
      let reserved = 0;
      const syncReservation = (): void => {
        if (!OUTSIDE_POSITIONS.has(position)) return;
        const rect = container.getBoundingClientRect();
        const size = position === "top" || position === "bottom" ? rect.height : rect.width;
        const amount = size > 0 ? Math.ceil(size + OUTSIDE_LEGEND_GAP_PX * 2) : 0;
        if (amount === reserved) return;
        reserved = amount;
        releaseReservation?.();
        releaseReservation = amount > 0 ? chart.layout.reserve({ [position]: amount }) : null;
      };

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
        syncReservation();
      };

      chart.events.subscribe("serieschange", render);
      render();

      return {
        onThemeChange: render,
        dispose() {
          releaseStyle();
          releaseReservation?.();
          releaseReservation = null;
          rows.clear();
        },
      };
    },
  };
}
