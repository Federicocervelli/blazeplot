import type { Chart, ChartHoverState, ChartPickGroup, ChartPickItem, ChartPickMode, ChartPlugin } from "./Chart.js";

export interface TooltipPluginOptions {
  readonly className?: string;
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
  readonly maxDistancePx?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly highlight?: boolean;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly font?: string;
  readonly zIndex?: number;
  readonly lockWidth?: boolean;
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

function rgba(color: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}

function renderDefaultTooltip(
  state: ChartHoverState,
  container: HTMLElement,
  formatter: TooltipPluginOptions["formatter"],
): void {
  const pad = Math.max(1, ...state.items.map((item) => labelOf(item).length));
  let html = "";
  for (const item of state.items) {
    const value = formatter ? formatter(item, state) : `(${formatNumber(item.x)}, ${formatNumber(item.y)})`;
    const color = rgba(item.series.style.color);
    if (html) html += "<br>";
    html += `<span style="color:${color}">\u2588</span> ${labelOf(item).padEnd(pad)}  ${value}`;
  }
  container.innerHTML = html;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function placeTooltip(
  container: HTMLElement,
  state: ChartHoverState,
  options: TooltipPluginOptions,
): void {
  const offsetX = options.offsetX ?? 12;
  const offsetY = options.offsetY ?? 12;
  const tooltipRect = container.getBoundingClientRect();
  const margin = 4;
  const doc = container.ownerDocument;
  const viewportWidth = Math.max(1, globalThis.innerWidth || doc.documentElement.clientWidth);
  const viewportHeight = Math.max(1, globalThis.innerHeight || doc.documentElement.clientHeight);

  const viewportX = clamp(
    state.clientX + offsetX,
    margin,
    Math.max(margin, viewportWidth - tooltipRect.width - margin),
  );
  const viewportY = clamp(
    state.clientY + offsetY,
    margin,
    Math.max(margin, viewportHeight - tooltipRect.height - margin),
  );
  container.style.transform = `translate(${viewportX}px, ${viewportY}px)`;
}

export function tooltipPlugin(options: TooltipPluginOptions = {}): ChartPlugin {
  return {
    install(chart: Chart) {
      const container = document.createElement("div");
      container.className = options.className ?? "blazeplot-tooltip";
      container.style.position = "fixed";
      container.style.left = "0";
      container.style.top = "0";
      container.style.zIndex = String(options.zIndex ?? 10_000);
      container.style.display = "none";
      container.style.pointerEvents = "none";
      container.style.background = options.backgroundColor ?? chart.theme.tooltipBackgroundColor;
      container.style.color = options.textColor ?? chart.theme.tooltipTextColor;
      container.style.font = options.font ?? chart.theme.tooltipFont;
      container.style.padding = "8px 10px";
      container.style.whiteSpace = "pre";
      const tooltipParent = chart.rootElement.ownerDocument.body ?? chart.rootElement;
      tooltipParent.appendChild(container);

      const markerLayer = document.createElement("div");
      markerLayer.className = "blazeplot-tooltip-markers";
      markerLayer.style.position = "absolute";
      markerLayer.style.inset = "0";
      markerLayer.style.zIndex = "25";
      markerLayer.style.pointerEvents = "none";
      chart.plotElement.appendChild(markerLayer);

      let lockedTooltipWidth = 0;

      const lockTooltipWidth = (): void => {
        if (options.lockWidth === false) return;
        const width = Math.ceil(container.getBoundingClientRect().width);
        if (width <= lockedTooltipWidth) return;
        lockedTooltipWidth = width;
        container.style.minWidth = `${lockedTooltipWidth}px`;
      };

      const resetTooltipWidth = (): void => {
        lockedTooltipWidth = 0;
        container.style.minWidth = "";
      };

      const applyTheme = (): void => {
        container.style.background = options.backgroundColor ?? chart.theme.tooltipBackgroundColor;
        container.style.color = options.textColor ?? chart.theme.tooltipTextColor;
        container.style.font = options.font ?? chart.theme.tooltipFont;
      };

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
          marker.style.boxShadow = "0 0 0 1px rgba(4, 8, 16, 0.85)";
          marker.style.transform = "translate(-50%, -50%)";
          markerLayer.appendChild(marker);
        }
      };

      const render = (state: ChartHoverState | null): void => {
        const shouldRepick = state !== null && (
          (options.mode !== undefined && options.mode !== state.mode) ||
          (options.group !== undefined && options.group !== state.group) ||
          (options.maxDistancePx !== undefined && options.maxDistancePx !== state.maxDistancePx)
        );
        const effectiveState = shouldRepick ? chart.pick(state.clientX, state.clientY, options) : state;

        renderMarkers(effectiveState);
        if (!effectiveState || effectiveState.items.length === 0) {
          container.style.display = "none";
          resetTooltipWidth();
          return;
        }

        if (options.render) {
          options.render(effectiveState, container, chart);
        } else {
          renderDefaultTooltip(effectiveState, container, options.formatter);
        }

        container.style.display = "block";
        lockTooltipWidth();
        placeTooltip(container, effectiveState, options);
      };

      const unsubscribeHover = chart.subscribe("hover", render);
      const unsubscribeTheme = chart.subscribe("themechange", () => {
        applyTheme();
        render(chart.getHoverState());
      });
      applyTheme();
      return () => {
        unsubscribeHover();
        unsubscribeTheme();
        markerLayer.remove();
        container.remove();
      };
    },
  };
}
