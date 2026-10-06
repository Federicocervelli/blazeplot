import type { ChartHoverState, ChartPickGroup, ChartPickItem, ChartPickMode } from "../../ui/ChartEvents.js";
import type { ChartPlugin, ChartPluginContext } from "../../ui/PluginTypes.js";
import { createOverlayLayer, installPluginStyle, placeFixedWithinViewport } from "../common/OverlayUtils.js";
import { PICK_FORCED_COLORS_CSS, createPickMarkerPool, createSyncRegistry, formatCompactNumber, installLongPress, pickAtDataX, renderPickItems } from "../common/PickOverlay.js";

const TOOLTIP_CSS = "@media (forced-colors:active){.blazeplot-tooltip{border:1px solid CanvasText}}";

/** Options for the built-in hover tooltip plugin. */
export interface TooltipPluginOptions {
  readonly className?: string;
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
  /** Charts whose tooltips share a `syncGroup` show values at the same X together. */
  readonly syncGroup?: string;
  /** Largest pointer-to-sample distance, in CSS pixels, that shows a tooltip. */
  readonly maxDistancePx?: number;
  /** Gap between the pointer and the tooltip box, in CSS pixels. Defaults to 12. */
  readonly offsetXPx?: number;
  /** Gap between the pointer and the tooltip box, in CSS pixels. Defaults to 12. */
  readonly offsetYPx?: number;
  readonly highlight?: boolean;
  /** Touch long-press delay in milliseconds, or `false` to disable. */
  readonly longPressMs?: number | false;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly font?: string;
  readonly zIndex?: number;
  readonly lockWidth?: boolean;
  readonly formatter?: (item: ChartPickItem, state: ChartHoverState) => string;
  readonly render?: (state: ChartHoverState, container: HTMLElement, chart: ChartPluginContext) => void;
}

function renderDefaultTooltip(state: ChartHoverState, container: HTMLElement, formatter: TooltipPluginOptions["formatter"], chart: ChartPluginContext): void {
  // Time and categorical X axes print dates and category names; numeric X and all Y values stay compact numbers.
  const formatX = (value: number): string => chart.coords.formatReadout(value, "x") ?? formatCompactNumber(value);
  renderPickItems(
    container,
    state.items,
    state,
    formatter,
    (item) => {
      if (item.xRange) return `${formatX(item.xRange.xStart)}–${formatX(item.xRange.xEnd)}: ${formatCompactNumber(item.y)}`;
      return `(${formatX(item.x)}, ${formatCompactNumber(item.y)})`;
    },
  );
}

const joinTooltipSyncGroup = createSyncRegistry();

function placeTooltip(container: HTMLElement, state: ChartHoverState, options: TooltipPluginOptions, size: { readonly width: number; readonly height: number }): void {
  placeFixedWithinViewport(container, state.clientX, state.clientY, {
    offsetX: options.offsetXPx ?? 12,
    offsetY: options.offsetYPx ?? 12,
    size: {
      width: Math.max(1, size.width || 240),
      height: Math.max(1, size.height || 80),
    },
  });
}

/**
 * Create a plugin that displays picked data values in a tooltip.
 *
 * One instance may be passed to several charts: it keeps no per-chart state outside each install.
 */
export function tooltipPlugin(options: TooltipPluginOptions = {}): ChartPlugin {
  return {
    install(chart: ChartPluginContext) {
      const releaseStyles = [installPluginStyle(chart, "tooltip", TOOLTIP_CSS), installPluginStyle(chart, "pick", PICK_FORCED_COLORS_CSS)];
      const container = chart.dom.document.createElement("div");
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
      chart.dom.mount("body", container);

      const markerLayer = createOverlayLayer(chart.dom.document, "blazeplot-tooltip-markers", { inset: "0", display: "block", zIndex: 25 });
      chart.dom.mount("plot", markerLayer);

      let lockedTooltipWidth = 0;
      let tooltipSize = { width: 0, height: 0 };
      const markers = createPickMarkerPool(markerLayer);
      const ResizeObserverCtor = chart.dom.view.ResizeObserver ?? globalThis.ResizeObserver;
      const tooltipResizeObserver = typeof ResizeObserverCtor !== "undefined"
        ? new ResizeObserverCtor(() => {
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
        markers.update(options.highlight === false || !state ? [] : state.items, { strokeColor: chart.theme.markerStrokeColor });
      };

      // Visibility as last written (hidden at mount); the tooltip re-renders on every move, so skip unchanged writes.
      let shown = false;
      const setShown = (next: boolean): void => {
        if (next === shown) return;
        shown = next;
        container.style.display = next ? "block" : "none";
        container.setAttribute("aria-hidden", next ? "false" : "true");
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
          setShown(false);
          resetTooltipWidth();
          return;
        }

        if (options.render) {
          options.render(effectiveState, container, chart);
        } else {
          renderDefaultTooltip(effectiveState, container, options.formatter, chart);
        }

        setShown(true);
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
      // Peers re-pick and rebuild their DOM, so only tell them when the anchor actually moved.
      let lastBroadcastX: number | null | undefined;
      const notifyPeers = (state: ChartHoverState | null): void => {
        const anchorX = state ? state.anchorX : null;
        if (anchorX === lastBroadcastX) return;
        lastBroadcastX = anchorX;
        sync.broadcast(anchorX);
      };

      const showAtClientPoint = (clientX: number, clientY: number): void => {
        const state = chart.state.pick(clientX, clientY, {
          mode: options.mode ?? "nearest-x",
          group: options.group ?? "x",
          maxDistancePx: options.maxDistancePx,
        });
        render(state);
        notifyPeers(state);
      };

      const longPress = installLongPress(chart, {
        longPressMs: options.longPressMs,
        onPoint: showAtClientPoint,
        // Touch never drives hover, so nothing else hides the tooltip when the finger lifts.
        onEnd: () => {
          render(chart.state.getHover());
          notifyPeers(null);
        },
      });

      // `hover` runs after the frame it describes, so render synchronously: no extra frame of lag.
      chart.events.subscribe("hover", (state) => {
        render(state);
        notifyPeers(state);
      });
      applyTheme();
      return {
        onThemeChange() {
          applyTheme();
          render(chart.state.getHover());
        },
        dispose() {
          longPress.clear();
          sync.leave();
          tooltipResizeObserver?.disconnect();
          for (const release of releaseStyles) release();
        },
      };
    },
  };
}
