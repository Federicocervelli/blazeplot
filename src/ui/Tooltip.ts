import type { Chart, ChartHoverState, ChartPickGroup, ChartPickItem, ChartPickMode, ChartPlugin, ChartPluginContext } from "./Chart.js";
import { formatCompactNumber, placeFixedWithinViewport, renderPickItems, rgba } from "./OverlayUtils.js";

export interface TooltipPluginOptions {
  readonly className?: string;
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
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
  readonly render?: (state: ChartHoverState, container: HTMLElement, chart: Chart) => void;
}

function renderDefaultTooltip(state: ChartHoverState, container: HTMLElement, formatter: TooltipPluginOptions["formatter"]): void {
  renderPickItems(
    container,
    state.items,
    state,
    formatter,
    (item) => `(${formatCompactNumber(item.x)}, ${formatCompactNumber(item.y)})`,
  );
}

interface TooltipPeer {
  showShared(dataX: number): void;
  hideShared(): void;
}

const tooltipGroups = new Map<string, Set<TooltipPeer>>();

function placeTooltip(container: HTMLElement, state: ChartHoverState, options: TooltipPluginOptions): void {
  placeFixedWithinViewport(container, state.clientX, state.clientY, {
    offsetX: options.offsetX ?? 12,
    offsetY: options.offsetY ?? 12,
  });
}

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
          container.setAttribute("aria-hidden", "true");
          resetTooltipWidth();
          return;
        }

        if (options.render) {
          options.render(effectiveState, container, chart as Chart);
        } else {
          renderDefaultTooltip(effectiveState, container, options.formatter);
        }

        container.style.display = "block";
        container.setAttribute("aria-hidden", "false");
        lockTooltipWidth();
        placeTooltip(container, effectiveState, options);
      };

      const renderSharedAtX = (dataX: number): void => {
        const viewport = chart.getViewport();
        const dataY = viewport.yMin + (viewport.yMax - viewport.yMin) * 0.5;
        const [plotX, plotY] = chart.dataToPlot(dataX, dataY);
        const rect = chart.canvas.getBoundingClientRect();
        render(chart.pick(rect.left + plotX, rect.top + plotY, {
          mode: options.mode ?? "nearest-x",
          group: options.group ?? "x",
          maxDistancePx: options.maxDistancePx,
        }));
      };

      let renderingShared = false;
      const peer: TooltipPeer | null = options.syncGroup ? {
        showShared(dataX: number): void {
          renderingShared = true;
          try {
            renderSharedAtX(dataX);
          } finally {
            renderingShared = false;
          }
        },
        hideShared(): void {
          renderingShared = true;
          try {
            render(null);
          } finally {
            renderingShared = false;
          }
        },
      } : null;

      if (peer && options.syncGroup) {
        const peers = tooltipGroups.get(options.syncGroup) ?? new Set<TooltipPeer>();
        peers.add(peer);
        tooltipGroups.set(options.syncGroup, peers);
      }

      const notifyPeers = (state: ChartHoverState | null): void => {
        if (!peer || !options.syncGroup || renderingShared) return;
        const peers = tooltipGroups.get(options.syncGroup);
        if (!peers) return;
        for (const other of peers) {
          if (other === peer) continue;
          if (state) other.showShared(state.anchorX);
          else other.hideShared();
        }
      };

      let longPressTimer: number | null = null;
      let longPressRaf = 0;
      let longPressActive = false;
      let longPressX = 0;
      let longPressY = 0;

      const clearLongPress = (): void => {
        if (longPressTimer !== null) window.clearTimeout(longPressTimer);
        if (longPressRaf !== 0) window.cancelAnimationFrame(longPressRaf);
        longPressTimer = null;
        longPressRaf = 0;
        longPressActive = false;
      };

      const showAtClientPoint = (clientX: number, clientY: number): void => {
        const state = chart.pick(clientX, clientY, {
          mode: options.mode ?? "nearest-x",
          group: options.group ?? "x",
          maxDistancePx: options.maxDistancePx,
        });
        render(state);
        notifyPeers(state);
      };

      const refreshLongPress = (): void => {
        if (!longPressActive) return;
        showAtClientPoint(longPressX, longPressY);
        longPressRaf = window.requestAnimationFrame(refreshLongPress);
      };

      const activateLongPress = (): void => {
        longPressTimer = null;
        longPressActive = true;
        showAtClientPoint(longPressX, longPressY);
        longPressRaf = window.requestAnimationFrame(refreshLongPress);
      };

      const scheduleLongPress = (clientX: number, clientY: number): void => {
        if (options.longPressMs === false || longPressActive) return;
        longPressX = clientX;
        longPressY = clientY;
        clearLongPress();
        longPressTimer = window.setTimeout(activateLongPress, options.longPressMs ?? 450);
      };

      const onTouchStart = (event: TouchEvent): void => {
        if (event.touches.length !== 1) {
          clearLongPress();
          return;
        }
        const touch = event.touches.item(0);
        if (!touch) return;
        scheduleLongPress(touch.clientX, touch.clientY);
      };

      const onTouchMove = (event: TouchEvent): void => {
        const touch = event.touches.item(0);
        if (!touch) return;
        if (longPressActive) {
          event.preventDefault();
          event.stopPropagation();
          longPressX = touch.clientX;
          longPressY = touch.clientY;
          showAtClientPoint(longPressX, longPressY);
          return;
        }
        if (longPressTimer !== null && Math.hypot(touch.clientX - longPressX, touch.clientY - longPressY) > 8) clearLongPress();
      };

      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType !== "touch") return;
        scheduleLongPress(event.clientX, event.clientY);
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (event.pointerType !== "touch") return;
        if (longPressActive) {
          event.preventDefault();
          event.stopPropagation();
          longPressX = event.clientX;
          longPressY = event.clientY;
          showAtClientPoint(longPressX, longPressY);
        } else if (longPressTimer !== null && Math.hypot(event.clientX - longPressX, event.clientY - longPressY) > 8) {
          clearLongPress();
        }
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (event.pointerType === "touch") clearLongPress();
      };

      chart.canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
      chart.canvas.addEventListener("pointermove", onPointerMove, { capture: true });
      chart.canvas.addEventListener("pointerup", onPointerUp, { capture: true });
      chart.canvas.addEventListener("pointercancel", onPointerUp, { capture: true });
      chart.canvas.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
      chart.canvas.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
      chart.canvas.addEventListener("touchend", clearLongPress);
      chart.canvas.addEventListener("touchcancel", clearLongPress);

      const unsubscribeHover = chart.subscribe("hover", (state) => {
        render(state);
        notifyPeers(state);
      });
      const unsubscribeTheme = chart.subscribe("themechange", () => {
        applyTheme();
        render(chart.getHoverState());
      });
      applyTheme();
      return () => {
        clearLongPress();
        chart.canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
        chart.canvas.removeEventListener("pointermove", onPointerMove, { capture: true });
        chart.canvas.removeEventListener("pointerup", onPointerUp, { capture: true });
        chart.canvas.removeEventListener("pointercancel", onPointerUp, { capture: true });
        chart.canvas.removeEventListener("touchstart", onTouchStart, { capture: true });
        chart.canvas.removeEventListener("touchmove", onTouchMove, { capture: true });
        chart.canvas.removeEventListener("touchend", clearLongPress);
        chart.canvas.removeEventListener("touchcancel", clearLongPress);
        unsubscribeHover();
        unsubscribeTheme();
        if (peer && options.syncGroup) {
          const peers = tooltipGroups.get(options.syncGroup);
          peers?.delete(peer);
          if (peers?.size === 0) tooltipGroups.delete(options.syncGroup);
        }
        markerLayer.remove();
        container.remove();
      };
    },
  };
}
