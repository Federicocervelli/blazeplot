import type { ChartHoverState, ChartPickGroup, ChartPickItem, ChartPickMode } from "./Chart.js";
import type { ChartPlugin, ChartPluginContext } from "./PluginHost.js";
import { createLongPressTouchTracker, createOverlayLayer, createPickMarker, createSyncRegistry, formatCompactNumber, pickAtDataX, placeFixedWithinViewport, renderPickItems } from "./OverlayUtils.js";
import { rgbaCss } from "./theme.js";

/** Options for the built-in hover tooltip plugin. */
export interface TooltipPluginOptions {
  readonly className?: string;
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
  /** Charts whose tooltips share a `syncGroup` show values at the same X together. */
  readonly syncGroup?: string;
  readonly maxDistancePx?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly highlight?: boolean;
  readonly longPressMs?: number | false;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly font?: string;
  readonly zIndex?: number;
  readonly lockWidth?: boolean;
  readonly formatter?: (item: ChartPickItem, state: ChartHoverState) => string;
  readonly render?: (state: ChartHoverState, container: HTMLElement, chart: ChartPluginContext) => void;
}

function renderDefaultTooltip(state: ChartHoverState, container: HTMLElement, formatter: TooltipPluginOptions["formatter"]): void {
  renderPickItems(
    container,
    state.items,
    state,
    formatter,
    formatDefaultTooltipItem,
  );
}

function formatDefaultTooltipItem(item: ChartPickItem): string {
  if (item.xRange) {
    return `${formatXRange(item.xRange)}: ${formatCompactNumber(item.y)}`;
  }
  return `(${formatCompactNumber(item.x)}, ${formatCompactNumber(item.y)})`;
}

function formatXRange(range: NonNullable<ChartPickItem["xRange"]>): string {
  return `${formatCompactNumber(range.xStart)}–${formatCompactNumber(range.xEnd)}`;
}

const joinTooltipSyncGroup = createSyncRegistry();

function placeTooltip(container: HTMLElement, state: ChartHoverState, options: TooltipPluginOptions, size: { readonly width: number; readonly height: number }): void {
  placeFixedWithinViewport(container, state.clientX, state.clientY, {
    offsetX: options.offsetX ?? 12,
    offsetY: options.offsetY ?? 12,
    size: {
      width: Math.max(1, size.width || 240),
      height: Math.max(1, size.height || 80),
    },
  });
}

/** Create a plugin that displays picked data values in a tooltip. */
export function tooltipPlugin(options: TooltipPluginOptions = {}): ChartPlugin {
  return {
    install(chart: ChartPluginContext) {
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
      container.setAttribute("role", "tooltip");
      container.setAttribute("aria-hidden", "true");
      const unmountContainer = chart.dom.mount("body", container);

      const markerLayer = createOverlayLayer("blazeplot-tooltip-markers", { inset: "0", display: "block", zIndex: 25 });
      const unmountMarkers = chart.dom.mount("plot", markerLayer);

      let lockedTooltipWidth = 0;
      let tooltipSize = { width: 0, height: 0 };
      const markers: HTMLDivElement[] = [];
      const tooltipResizeObserver = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            tooltipSize = { width: container.offsetWidth, height: container.offsetHeight };
          })
        : null;
      tooltipResizeObserver?.observe(container);

      const lockTooltipWidth = (): void => {
        if (options.lockWidth !== true) return;
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
        const items = options.highlight === false || !state ? [] : state.items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          let marker = markers[i];
          if (!marker) {
            marker = createPickMarker(item, { strokeColor: chart.theme.markerStrokeColor });
            markers[i] = marker;
            markerLayer.appendChild(marker);
          }
          marker.style.display = "block";
          marker.style.left = `${item.plotX}px`;
          marker.style.top = `${item.plotY}px`;
          marker.style.background = rgbaCss(item.series.style.color);
        }
        for (let i = items.length; i < markers.length; i++) {
          markers[i]!.style.display = "none";
        }
      };

      const render = (state: ChartHoverState | null): void => {
        // Keyboard inspection pins the tooltip to the inspected sample; never re-pick it.
        const shouldRepick = state !== null && state.source !== "inspection" && (
          (options.mode !== undefined && options.mode !== state.mode) ||
          (options.group !== undefined && options.group !== state.group) ||
          (options.maxDistancePx !== undefined && options.maxDistancePx !== state.maxDistancePx)
        );
        const effectiveState = shouldRepick ? chart.state.pick(state.clientX, state.clientY, options) : state;

        renderMarkers(effectiveState);
        if (!effectiveState || effectiveState.items.length === 0) {
          container.style.display = "none";
          container.setAttribute("aria-hidden", "true");
          resetTooltipWidth();
          return;
        }

        if (options.render) {
          options.render(effectiveState, container, chart);
        } else {
          renderDefaultTooltip(effectiveState, container, options.formatter);
        }

        container.style.display = "block";
        container.setAttribute("aria-hidden", "false");
        lockTooltipWidth();
        if (tooltipSize.width <= 0 || tooltipSize.height <= 0) {
          tooltipSize = { width: container.offsetWidth, height: container.offsetHeight };
        }
        placeTooltip(container, effectiveState, options, tooltipSize);
      };

      const renderSharedAtX = (dataX: number): void => {
        render(pickAtDataX(chart, dataX, {
          mode: options.mode ?? "nearest-x",
          group: options.group ?? "x",
          maxDistancePx: options.maxDistancePx,
        }));
      };

      const sync = joinTooltipSyncGroup(options.syncGroup, {
        showAt: renderSharedAtX,
        hide: () => render(null),
      });
      const notifyPeers = (state: ChartHoverState | null): void => sync.broadcast(state ? state.anchorX : null);

      const showAtClientPoint = (clientX: number, clientY: number): void => {
        const state = chart.state.pick(clientX, clientY, {
          mode: options.mode ?? "nearest-x",
          group: options.group ?? "x",
          maxDistancePx: options.maxDistancePx,
        });
        render(state);
        notifyPeers(state);
      };

      const longPress = createLongPressTouchTracker({
        delayMs: () => options.longPressMs,
        onPoint: showAtClientPoint,
      });

      const unlisten = [
        chart.dom.listen("plot", "pointerdown", longPress.onPointerDown, { capture: true }),
        chart.dom.listen("plot", "pointermove", longPress.onPointerMove, { capture: true }),
        chart.dom.listen("plot", "pointerup", longPress.clearIfTouchPointer, { capture: true }),
        chart.dom.listen("plot", "pointercancel", longPress.clearIfTouchPointer, { capture: true }),
        chart.dom.listen("plot", "touchstart", longPress.onTouchStart, { capture: true, passive: true }),
        chart.dom.listen("plot", "touchmove", longPress.onTouchMove, { capture: true, passive: false }),
        chart.dom.listen("plot", "touchend", longPress.clear),
        chart.dom.listen("plot", "touchcancel", longPress.clear),
      ];

      let hoverRaf = 0;
      let pendingHoverState: ChartHoverState | null = null;
      const flushHover = (): void => {
        hoverRaf = 0;
        const state = pendingHoverState;
        pendingHoverState = null;
        render(state);
        notifyPeers(state);
      };
      const unsubscribeHover = chart.events.subscribe("hover", (state) => {
        pendingHoverState = state;
        if (hoverRaf === 0) hoverRaf = requestAnimationFrame(flushHover);
      });
      applyTheme();
      return {
        onThemeChange() {
          applyTheme();
          render(chart.state.getHover());
        },
        dispose() {
          longPress.clear();
          for (const off of unlisten) off();
          if (hoverRaf !== 0) cancelAnimationFrame(hoverRaf);
          unsubscribeHover();
          sync.leave();
          tooltipResizeObserver?.disconnect();
          unmountMarkers();
          unmountContainer();
        },
      };
    },
  };
}
