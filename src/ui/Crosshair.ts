import type { SeriesYAxis } from "../core/types.js";
import type { ChartPickItem, ChartPickMode } from "./Chart.js";
import type { ChartPlugin, ChartPluginContext } from "./PluginHost.js";
import { createLongPressTouchTracker, requestLongPressTouchAction,createOverlayLayer, createPickMarker, createSvgElement, createSyncRegistry, formatCompactNumber, pickAtDataX, placeAbsoluteWithinBox, renderPickItems } from "./OverlayUtils.js";
import type { SyncMembership } from "./OverlayUtils.js";

/** Axis drawn by the crosshair overlay. */
export type CrosshairAxis = "x" | "y" | "xy";
/** Optional snapping strategy for crosshair positions. */
export type CrosshairSnapMode = "none" | "nearest-x" | "nearest-point";
/** Crosshair display behavior. */
export type CrosshairMode = "crosshair" | "ruler";
/** Crosshair label placement relative to current position. */
export type CrosshairLabelPlacement = "bottom-right" | "top-right" | "bottom-left" | "top-left";

/** Custom renderer for crosshair pick highlights. */
export type CrosshairHighlightRenderer = (position: CrosshairPosition, container: HTMLElement, chart: ChartPluginContext) => void;

/** Crosshair position in data coordinates and plot-relative CSS pixels. */
export interface CrosshairPosition {
  readonly dataX: number;
  readonly dataY: number;
  readonly plotX: number;
  readonly plotY: number;
  readonly items: readonly ChartPickItem[];
}

/** Measurement emitted while ruler mode is active. */
export interface RulerMeasurement {
  readonly start: CrosshairPosition;
  readonly end: CrosshairPosition;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly slope: number;
  readonly sampleCount: number;
}

/** Options for crosshair and ruler overlays. */
export interface CrosshairPluginOptions {
  readonly mode?: CrosshairMode;
  readonly axis?: CrosshairAxis;
  readonly yAxis?: SeriesYAxis;
  readonly snap?: CrosshairSnapMode;
  /** Charts whose crosshairs share a `syncGroup` move together along X. */
  readonly syncGroup?: string;
  /** Line color. Defaults to `theme.crosshairColor`. */
  readonly color?: string;
  readonly width?: number;
  readonly dash?: string;
  readonly label?: boolean;
  readonly labelBackgroundColor?: string;
  readonly labelColor?: string;
  readonly labelFont?: string;
  readonly labelPlacement?: CrosshairLabelPlacement;
  readonly zIndex?: number;
  readonly highlight?: boolean;
  readonly markerSize?: number;
  readonly markerStrokeColor?: string;
  readonly markerStrokeWidth?: number;
  /** Override default pick highlighting. Defaults to points, or a brightened X-interval for items with `xRange` (bars, histogram bins). */
  readonly renderHighlight?: CrosshairHighlightRenderer;
  readonly longPressMs?: number | false;
  readonly rulerModifier?: "none" | "ctrl" | "shift" | "alt" | "meta";
  readonly formatX?: (value: number) => string;
  readonly formatY?: (value: number) => string;
  readonly formatter?: (item: ChartPickItem, position: CrosshairPosition) => string;
  readonly render?: (position: CrosshairPosition, container: HTMLElement, chart: ChartPluginContext) => void;
  readonly onMove?: (position: CrosshairPosition | null) => void;
  readonly onMeasureStart?: (position: CrosshairPosition) => void;
  readonly onMeasureChange?: (measurement: RulerMeasurement) => void;
  readonly onMeasureEnd?: (measurement: RulerMeasurement) => void;
}

const joinCrosshairSyncGroup = createSyncRegistry();

/** Crosshair plugin with imperative position and measurement access. */
export interface CrosshairPlugin extends ChartPlugin {
  getPosition(): CrosshairPosition | null;
  getMeasurement(): RulerMeasurement | null;
  clearMeasurement(): void;
}

function countSamplesInRange(chart: ChartPluginContext, xMin: number, xMax: number): number {
  const viewport = { xMin, xMax, yMin: -Infinity, yMax: Infinity };
  let total = 0;
  for (const state of chart.state.getSeries()) {
    if (!state.visible) continue;
    const range = state.series.visibleIndexRange(viewport);
    total += Math.max(0, range.end - range.start);
  }
  return total;
}

function hasModifier(event: PointerEvent, modifier: CrosshairPluginOptions["rulerModifier"]): boolean {
  if (!modifier || modifier === "none") return true;
  if (modifier === "ctrl") return event.ctrlKey;
  if (modifier === "shift") return event.shiftKey;
  if (modifier === "alt") return event.altKey;
  return event.metaKey;
}

function positionFromPick(chart: ChartPluginContext, clientX: number, clientY: number, mode: ChartPickMode): CrosshairPosition | null {
  const picked = chart.state.pick(clientX, clientY, { mode, group: "none" });
  const item = picked?.items[0];
  return item ? { dataX: item.x, dataY: item.y, plotX: item.plotX, plotY: item.plotY, items: [item] } : null;
}

function resolvePosition(chart: ChartPluginContext, clientX: number, clientY: number, yAxis: SeriesYAxis, snap: CrosshairSnapMode): CrosshairPosition | null {
  const rect = chart.layout.plotRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const pickMode: ChartPickMode = snap === "nearest-point" ? "nearest-point" : "nearest-x";
  if (snap !== "none") {
    const picked = positionFromPick(chart, clientX, clientY, pickMode);
    if (picked) return picked;
  }

  const data = chart.coords.clientToData(clientX, clientY, yAxis);
  if (!data) return null;
  const [plotX, plotY] = chart.coords.dataToPlot(data[0], data[1], yAxis);
  return { dataX: data[0], dataY: data[1], plotX, plotY, items: [] };
}

function resolveSharedPosition(chart: ChartPluginContext, dataX: number, yAxis: SeriesYAxis): CrosshairPosition | null {
  const rect = chart.layout.plotRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const viewport = chart.viewport.get(yAxis);
  const dataY = viewport.yMin + (viewport.yMax - viewport.yMin) * 0.5;
  const [plotX, plotY] = chart.coords.dataToPlot(dataX, dataY, yAxis);
  const picked = pickAtDataX(chart, dataX, { yAxis, mode: "nearest-x", group: "none" });
  const item = picked?.items[0];
  if (item) return { dataX: item.x, dataY: item.y, plotX: item.plotX, plotY: item.plotY, items: [item] };
  return { dataX, dataY, plotX, plotY, items: [] };
}

/**
 * Brighten the hovered bin in place: a translucent wash over its exact X interval, never
 * narrower than one CSS pixel. It has no border or shadow, so it never hides neighbouring bins.
 */
function createXRangeHighlight(item: ChartPickItem, chart: ChartPluginContext, color: string): HTMLDivElement {
  const yAxis = item.series.config.yAxis ?? "left";
  const baseline = item.series.style.baseline;
  const [leftX, valueY] = chart.coords.dataToPlot(item.xRange!.xStart, item.y, yAxis);
  const [rightX, baselineY] = chart.coords.dataToPlot(item.xRange!.xEnd, baseline, yAxis);
  const width = Math.max(1, Math.abs(rightX - leftX));
  const marker = document.createElement("div");
  marker.style.position = "absolute";
  marker.style.left = `${(leftX + rightX) / 2 - width / 2}px`;
  marker.style.top = `${Math.min(valueY, baselineY)}px`;
  marker.style.width = `${width}px`;
  marker.style.height = `${Math.max(1, Math.abs(baselineY - valueY))}px`;
  marker.style.background = `color-mix(in srgb, ${color} 35%, transparent)`;
  return marker;
}

function renderDefaultLabel(
  position: CrosshairPosition,
  container: HTMLElement,
  formatX: (value: number) => string,
  formatY: (value: number) => string,
  formatter: CrosshairPluginOptions["formatter"],
): void {
  if (position.items.length === 0) {
    container.textContent = `x ${formatX(position.dataX)}  y ${formatY(position.dataY)}`;
    return;
  }

  renderPickItems(
    container,
    position.items,
    position,
    formatter,
    (item) => `(${formatX(item.x)}, ${formatY(item.y)})`,
  );
}

/** Create a plugin that renders synchronized crosshair or ruler overlays. */
export function crosshairPlugin(options: CrosshairPluginOptions = {}): CrosshairPlugin {
  const axis = options.axis ?? "xy";
  const yAxis = options.yAxis ?? "left";
  const snap = options.snap ?? "none";
  const mode = options.mode ?? "crosshair";
  const rulerModifier = options.rulerModifier ?? "none";
  let chartRef: ChartPluginContext | null = null;
  let root: HTMLDivElement | null = null;
  let lineLayer: HTMLDivElement | null = null;
  let overlayLayer: HTMLDivElement | null = null;
  let vertical: HTMLDivElement | null = null;
  let horizontal: HTMLDivElement | null = null;
  let markerLayer: HTMLDivElement | null = null;
  let label: HTMLDivElement | null = null;
  let rulerSvg: SVGSVGElement | null = null;
  let rulerLine: SVGLineElement | null = null;
  let rulerStart: CrosshairPosition | null = null;

  const formatX = options.formatX ?? formatCompactNumber;
  const formatY = options.formatY ?? formatCompactNumber;
  let currentPosition: CrosshairPosition | null = null;
  let currentMeasurement: RulerMeasurement | null = null;
  let activeClientPoint: { clientX: number; clientY: number } | null = null;
  let sync: SyncMembership | null = null;

  const setVisible = (visible: boolean): void => {
    if (root) root.style.display = visible ? "block" : "none";
    if (lineLayer) lineLayer.style.display = visible ? "block" : "none";
    if (overlayLayer) overlayLayer.style.display = visible ? "block" : "none";
  };

  const emitMove = (position: CrosshairPosition | null): void => {
    currentPosition = position;
    options.onMove?.(position);
  };

  const emitMeasureStart = (position: CrosshairPosition): void => {
    options.onMeasureStart?.(position);
  };

  const emitMeasureChange = (measurement: RulerMeasurement): void => {
    currentMeasurement = measurement;
    options.onMeasureChange?.(measurement);
  };

  const emitMeasureEnd = (measurement: RulerMeasurement): void => {
    currentMeasurement = measurement;
    options.onMeasureEnd?.(measurement);
  };

  const placeLabel = (position: CrosshairPosition): void => {
    const chart = chartRef;
    if (!chart || !label) return;
    const placement = options.labelPlacement ?? "bottom-right";
    const rect = label.getBoundingClientRect();
    const offsetX = placement.endsWith("left") ? -rect.width - 12 : 12;
    const offsetY = placement.startsWith("top") ? -rect.height - 12 : 12;
    const plot = chart.layout.plotRect();
    placeAbsoluteWithinBox(label, position.plotX, position.plotY, plot.width, plot.height, { offsetX, offsetY });
  };

  const renderMarkers = (position: CrosshairPosition | null): void => {
    if (!markerLayer) return;
    markerLayer.replaceChildren();
    if (options.highlight === false || !position) return;
    if (options.renderHighlight && chartRef) {
      options.renderHighlight(position, markerLayer, chartRef);
      return;
    }

    const size = Math.max(2, options.markerSize ?? 10);
    const strokeWidth = Math.max(0, options.markerStrokeWidth ?? 2);
    for (const item of position.items) {
      if (item.xRange && chartRef) {
        markerLayer.appendChild(createXRangeHighlight(item, chartRef, options.markerStrokeColor ?? chartRef.theme.markerStrokeColor));
      } else {
        markerLayer.appendChild(createPickMarker(item, {
          sizePx: size,
          strokeColor: options.markerStrokeColor ?? chartRef?.theme.markerStrokeColor ?? "",
          strokeWidthPx: strokeWidth,
        }));
      }
    }
  };

  const renderPosition = (position: CrosshairPosition | null): void => {
    renderMarkers(position);
    if (!position || !lineLayer || !overlayLayer || !vertical || !horizontal || !label) {
      setVisible(false);
      return;
    }
    setVisible(true);
    vertical.style.display = axis === "y" ? "none" : "block";
    horizontal.style.display = axis === "x" ? "none" : "block";
    vertical.style.left = `${position.plotX}px`;
    horizontal.style.top = `${position.plotY}px`;
    if (options.label !== false) {
      label.style.display = "block";
      if (options.render) {
        options.render(position, label, chartRef!);
      } else {
        renderDefaultLabel(position, label, formatX, formatY, options.formatter);
      }
      placeLabel(position);
    } else {
      label.style.display = "none";
    }
  };

  const measurementFrom = (start: CrosshairPosition, end: CrosshairPosition, chart: ChartPluginContext): RulerMeasurement => {
    const deltaX = end.dataX - start.dataX;
    const deltaY = end.dataY - start.dataY;
    return {
      start,
      end,
      deltaX,
      deltaY,
      slope: deltaX === 0 ? Infinity : deltaY / deltaX,
      sampleCount: countSamplesInRange(chart, Math.min(start.dataX, end.dataX), Math.max(start.dataX, end.dataX)),
    };
  };

  const renderRuler = (end: CrosshairPosition | null): void => {
    const chart = chartRef;
    if (!chart || !rulerSvg || !rulerLine || !rulerStart || !end) return;
    rulerSvg.style.display = "block";
    rulerLine.setAttribute("x1", String(rulerStart.plotX));
    rulerLine.setAttribute("y1", String(rulerStart.plotY));
    rulerLine.setAttribute("x2", String(end.plotX));
    rulerLine.setAttribute("y2", String(end.plotY));
    emitMeasureChange(measurementFrom(rulerStart, end, chart));
  };

  return {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      const color = options.color ?? chart.theme.crosshairColor;
      const width = `${options.width ?? 1}px`;
      const dash = options.dash;

      root = document.createElement("div");
      root.className = "blazeplot-crosshair";
      root.style.position = "absolute";
      root.style.inset = "0";
      root.style.display = "none";
      root.style.pointerEvents = "none";

      lineLayer = createOverlayLayer("blazeplot-crosshair-lines", { inset: "0", zIndex: options.zIndex ?? 0 });
      overlayLayer = createOverlayLayer("blazeplot-crosshair-overlay", { inset: "0", zIndex: options.zIndex ?? 22 });

      vertical = document.createElement("div");
      vertical.style.position = "absolute";
      vertical.style.top = "0";
      vertical.style.bottom = "0";
      vertical.style.zIndex = "1";
      vertical.style.borderLeft = `${width} solid ${color}`;
      if (dash) vertical.style.borderLeftStyle = "dashed";

      horizontal = document.createElement("div");
      horizontal.style.position = "absolute";
      horizontal.style.left = "0";
      horizontal.style.right = "0";
      horizontal.style.zIndex = "1";
      horizontal.style.borderTop = `${width} solid ${color}`;
      if (dash) horizontal.style.borderTopStyle = "dashed";

      markerLayer = createOverlayLayer("blazeplot-crosshair-markers", { inset: "0", display: "block", zIndex: 2 });

      label = document.createElement("div");
      label.style.position = "absolute";
      label.style.zIndex = "3";
      label.style.padding = "4px 6px";
      label.style.borderRadius = "3px";
      label.style.background = options.labelBackgroundColor ?? chart.theme.tooltipBackgroundColor;
      label.style.color = options.labelColor ?? chart.theme.tooltipTextColor;
      label.style.font = options.labelFont ?? chart.theme.tooltipFont;
      label.style.whiteSpace = "nowrap";

      rulerSvg = createSvgElement("svg");
      rulerSvg.style.position = "absolute";
      rulerSvg.style.inset = "0";
      rulerSvg.style.width = "100%";
      rulerSvg.style.height = "100%";
      rulerSvg.style.display = "none";
      rulerSvg.style.overflow = "hidden";
      rulerSvg.style.zIndex = "1";
      rulerLine = createSvgElement("line");
      rulerLine.setAttribute("stroke", color);
      rulerLine.setAttribute("stroke-width", String(options.width ?? 1));
      if (dash) rulerLine.setAttribute("stroke-dasharray", dash);
      rulerSvg.appendChild(rulerLine);

      lineLayer.appendChild(vertical);
      lineLayer.appendChild(horizontal);
      lineLayer.appendChild(rulerSvg);
      overlayLayer.appendChild(markerLayer);
      overlayLayer.appendChild(label);
      root.append(lineLayer, overlayLayer);
      const unmount = chart.dom.mount("plot", root);

      sync = joinCrosshairSyncGroup(options.syncGroup, {
        showAt(dataX) {
          const position = resolveSharedPosition(chart, dataX, yAxis);
          renderPosition(position);
          emitMove(position);
        },
        hide() {
          renderPosition(null);
          emitMove(null);
        },
      });

      const updateAtClientPoint = (clientX: number, clientY: number): void => {
        const position = resolvePosition(chart, clientX, clientY, yAxis, snap);
        renderPosition(position);
        emitMove(position);
        if (position) sync?.broadcast(position.dataX);
        if (mode === "ruler") renderRuler(position);
      };

      const showAtClientPoint = (clientX: number, clientY: number): void => {
        activeClientPoint = { clientX, clientY };
        updateAtClientPoint(clientX, clientY);
      };

      requestLongPressTouchAction(chart, options.longPressMs);
      const longPress = createLongPressTouchTracker({
        delayMs: () => options.longPressMs,
        onPoint: showAtClientPoint,
      });

      const onPointerMove = (event: PointerEvent): void => {
        activeClientPoint = { clientX: event.clientX, clientY: event.clientY };
        if (longPress.onPointerMove(event)) return;
        updateAtClientPoint(event.clientX, event.clientY);
      };

      const onPointerLeave = (): void => {
        activeClientPoint = null;
        if (!rulerStart) renderPosition(null);
        emitMove(null);
        sync?.broadcast(null);
      };

      const onPointerDown = (event: PointerEvent): void => {
        longPress.onPointerDown(event);
        if (mode !== "ruler" || event.button !== 0 || !hasModifier(event, rulerModifier)) return;
        rulerStart = resolvePosition(chart, event.clientX, event.clientY, yAxis, snap);
        if (rulerStart) {
          emitMeasureStart(rulerStart);
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };

      const onPointerUp = (event: PointerEvent): void => {
        longPress.clearIfTouchPointer(event);
        if (mode !== "ruler" || !rulerStart) return;
        event.stopImmediatePropagation();
        const end = resolvePosition(chart, event.clientX, event.clientY, yAxis, snap);
        if (!end) return;
        const measurement = measurementFrom(rulerStart, end, chart);
        emitMeasureEnd(measurement);
        rulerStart = null;
      };

      const unlisten = [
        chart.dom.listen("plot", "pointermove", onPointerMove),
        chart.dom.listen("plot", "pointercancel", longPress.clear),
        chart.dom.listen("plot", "touchstart", longPress.onTouchStart, { capture: true, passive: true }),
        chart.dom.listen("plot", "touchmove", longPress.onTouchMove, { capture: true, passive: false }),
        chart.dom.listen("plot", "touchend", longPress.clear),
        chart.dom.listen("plot", "touchcancel", longPress.clear),
        chart.dom.listen("plot", "pointerleave", onPointerLeave),
        chart.dom.listen("plot", "pointerdown", onPointerDown, { capture: true }),
        chart.dom.listen("plot", "pointerup", onPointerUp, { capture: true }),
      ];

      const unsubscribeRender = chart.events.subscribe("render", () => {
        if (!activeClientPoint) return;
        updateAtClientPoint(activeClientPoint.clientX, activeClientPoint.clientY);
      });

      // Keyboard inspection (`ctx.state.inspect`) drives the crosshair to the inspected sample.
      let inspecting = false;
      const unsubscribeHover = chart.events.subscribe("hover", (state) => {
        if (state?.source === "inspection") {
          const item = state.items[0];
          if (!item) return;
          inspecting = true;
          activeClientPoint = null;
          const position: CrosshairPosition = { dataX: item.x, dataY: item.y, plotX: item.plotX, plotY: item.plotY, items: [item] };
          renderPosition(position);
          emitMove(position);
          sync?.broadcast(position.dataX);
          return;
        }
        if (!inspecting) return;
        inspecting = false;
        // The pointer took over; its own handlers already placed the crosshair.
        if (activeClientPoint) return;
        if (!rulerStart) renderPosition(null);
        emitMove(null);
        sync?.broadcast(null);
      });

      return () => {
        longPress.clear();
        for (const off of unlisten) off();
        unsubscribeRender();
        unsubscribeHover();
        sync?.leave();
        sync = null;
        unmount();
        root = null;
        lineLayer = null;
        overlayLayer = null;
        vertical = null;
        horizontal = null;
        markerLayer = null;
        label = null;
        rulerSvg = null;
        rulerLine = null;
        rulerStart = null;
        activeClientPoint = null;
        chartRef = null;
      };
    },
    getPosition(): CrosshairPosition | null {
      return currentPosition;
    },
    getMeasurement(): RulerMeasurement | null {
      return currentMeasurement;
    },
    clearMeasurement(): void {
      currentMeasurement = null;
      rulerStart = null;
      if (rulerSvg) rulerSvg.style.display = "none";
    },
  };
}
