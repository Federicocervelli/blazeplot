import type { SeriesYAxis } from "../../core/types.js";
import type { ChartPickItem, ChartPickMode } from "../../ui/ChartEvents.js";
import type { ChartPlugin, ChartPluginContext } from "../../ui/PluginTypes.js";
import { createOverlayLayer, createSvgElement, installPluginStyle, singleChartPlugin } from "../common/OverlayUtils.js";
import { PICK_FORCED_COLORS_CSS, createPickMarker, createPickMarkerPool, createSyncRegistry, formatCompactNumber, installLongPress, pickAtDataX, placeAbsoluteWithinBox, renderPickItems } from "../common/PickOverlay.js";
import type { PickMarkerPool, SyncMembership } from "../common/PickOverlay.js";

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
  /** Line width in CSS pixels. Defaults to 1. */
  readonly widthPx?: number;
  /** SVG `stroke-dasharray` for the line, in CSS pixels (for example `"4 4"`). */
  readonly dash?: string;
  readonly label?: boolean;
  readonly labelBackgroundColor?: string;
  readonly labelColor?: string;
  readonly labelFont?: string;
  readonly labelPlacement?: CrosshairLabelPlacement;
  readonly zIndex?: number;
  readonly highlight?: boolean;
  /** Point marker diameter in CSS pixels. Defaults to 10. */
  readonly markerSizePx?: number;
  readonly markerStrokeColor?: string;
  /** Point marker outline width in CSS pixels. Defaults to 2. */
  readonly markerStrokeWidthPx?: number;
  /** Override default pick highlighting. Defaults to points, or a brightened X-interval for items with `xRange` (bars, histogram bins). */
  readonly renderHighlight?: CrosshairHighlightRenderer;
  /** Touch long-press delay in milliseconds, or `false` to disable. */
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
  const marker = chart.dom.document.createElement("div");
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

/**
 * Create a plugin that renders synchronized crosshair or ruler overlays.
 *
 * Stateful: an instance serves one chart at a time. Installing it on a second chart while the first is
 * alive throws; create one instance per chart (linked layouts: `panelPlugins`). Disposing the chart frees it.
 */
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

  // Plain point markers are reused across updates; custom or interval highlights rebuild the layer.
  let markerPool: PickMarkerPool | null = null;

  const renderMarkers = (position: CrosshairPosition | null): void => {
    if (!markerLayer || !markerPool) return;
    const items = options.highlight === false || !position || options.renderHighlight ? [] : position.items;
    if (options.renderHighlight || items.some((item) => item.xRange)) {
      markerPool.reset();
      if (!position || options.highlight === false) return;
      if (options.renderHighlight && chartRef) {
        options.renderHighlight(position, markerLayer, chartRef);
        return;
      }
      const stroke = options.markerStrokeColor ?? chartRef?.theme.markerStrokeColor ?? "";
      for (const item of items) {
        if (item.xRange && chartRef) markerLayer.appendChild(createXRangeHighlight(item, chartRef, stroke));
        else markerLayer.appendChild(createPickMarker(markerLayer.ownerDocument, item, { sizePx: Math.max(2, options.markerSizePx ?? 10), strokeColor: stroke, strokeWidthPx: Math.max(0, options.markerStrokeWidthPx ?? 2) }));
      }
      return;
    }
    markerPool.update(items, {
      sizePx: Math.max(2, options.markerSizePx ?? 10),
      strokeColor: options.markerStrokeColor ?? chartRef?.theme.markerStrokeColor ?? "",
      strokeWidthPx: Math.max(0, options.markerStrokeWidthPx ?? 2),
    });
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

  return singleChartPlugin("crosshair", {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      const releaseStyle = installPluginStyle(chart, "pick", PICK_FORCED_COLORS_CSS);
      const color = options.color ?? chart.theme.crosshairColor;
      const width = `${options.widthPx ?? 1}px`;
      const dash = options.dash;

      root = chart.dom.document.createElement("div");
      root.className = "blazeplot-crosshair";
      root.style.position = "absolute";
      root.style.inset = "0";
      root.style.display = "none";
      root.style.pointerEvents = "none";

      lineLayer = createOverlayLayer(chart.dom.document, "blazeplot-crosshair-lines", { inset: "0", zIndex: options.zIndex ?? 0 });
      overlayLayer = createOverlayLayer(chart.dom.document, "blazeplot-crosshair-overlay", { inset: "0", zIndex: options.zIndex ?? 22 });

      vertical = chart.dom.document.createElement("div");
      vertical.style.position = "absolute";
      vertical.style.top = "0";
      vertical.style.bottom = "0";
      vertical.style.zIndex = "1";
      vertical.style.borderLeft = `${width} solid ${color}`;
      if (dash) vertical.style.borderLeftStyle = "dashed";

      horizontal = chart.dom.document.createElement("div");
      horizontal.style.position = "absolute";
      horizontal.style.left = "0";
      horizontal.style.right = "0";
      horizontal.style.zIndex = "1";
      horizontal.style.borderTop = `${width} solid ${color}`;
      if (dash) horizontal.style.borderTopStyle = "dashed";

      markerLayer = createOverlayLayer(chart.dom.document, "blazeplot-crosshair-markers", { inset: "0", display: "block", zIndex: 2 });
      markerPool = createPickMarkerPool(markerLayer);

      label = chart.dom.document.createElement("div");
      label.style.position = "absolute";
      label.style.zIndex = "3";
      label.style.padding = "4px 6px";
      label.style.borderRadius = "3px";
      label.style.background = options.labelBackgroundColor ?? chart.theme.tooltipBackgroundColor;
      label.style.color = options.labelColor ?? chart.theme.tooltipTextColor;
      label.style.font = options.labelFont ?? chart.theme.tooltipFont;
      label.style.whiteSpace = "nowrap";

      rulerSvg = createSvgElement(chart.dom.document, "svg");
      rulerSvg.style.position = "absolute";
      rulerSvg.style.inset = "0";
      rulerSvg.style.width = "100%";
      rulerSvg.style.height = "100%";
      rulerSvg.style.display = "none";
      rulerSvg.style.overflow = "hidden";
      rulerSvg.style.zIndex = "1";
      rulerLine = createSvgElement(chart.dom.document, "line");
      rulerLine.setAttribute("stroke", color);
      rulerLine.setAttribute("stroke-width", String(options.widthPx ?? 1));
      if (dash) rulerLine.setAttribute("stroke-dasharray", dash);
      rulerSvg.appendChild(rulerLine);

      lineLayer.appendChild(vertical);
      lineLayer.appendChild(horizontal);
      lineLayer.appendChild(rulerSvg);
      overlayLayer.appendChild(markerLayer);
      overlayLayer.appendChild(label);
      root.append(lineLayer, overlayLayer);
      chart.dom.mount("plot", root);

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


      const onPointerLeave = (): void => {
        activeClientPoint = null;
        if (!rulerStart) renderPosition(null);
        emitMove(null);
        sync?.broadcast(null);
      };

      const onPointerDown = (event: PointerEvent): void => {
        if (mode !== "ruler" || event.button !== 0 || !hasModifier(event, rulerModifier) || !chart.dom.claimPointer(event)) return;
        rulerStart =resolvePosition(chart, event.clientX, event.clientY, yAxis, snap);
        if (rulerStart) {
          emitMeasureStart(rulerStart);
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (mode !== "ruler" || !rulerStart) return;
        event.stopImmediatePropagation();
        const end = resolvePosition(chart, event.clientX, event.clientY, yAxis, snap);
        if (!end) return;
        const measurement = measurementFrom(rulerStart, end, chart);
        emitMeasureEnd(measurement);
        rulerStart = null;
      };

      const longPress = installLongPress(chart, {
        longPressMs: options.longPressMs,
        onPoint: showAtClientPoint,
        onEnd: onPointerLeave,
        beforeMove: (event) => {
          // Touch never drives the crosshair except through a long press: a finger scrolling the page must not
          // leave a tracked point behind for the render handler (or sync group) to draw.
          if (event.pointerType === "touch") return;
          activeClientPoint = { clientX: event.clientX, clientY: event.clientY };
        },
        onMove: (event) => updateAtClientPoint(event.clientX, event.clientY),
        onDown: onPointerDown,
        onUp: onPointerUp,
      });
      chart.dom.listen("plot", "pointerleave", onPointerLeave);

      chart.events.subscribe("render", () => {
        if (!activeClientPoint) return;
        updateAtClientPoint(activeClientPoint.clientX, activeClientPoint.clientY);
      });

      // Keyboard inspection (`ctx.state.inspect`) drives the crosshair to the inspected sample.
      let inspecting = false;
      chart.events.subscribe("hover", (state) => {
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
        releaseStyle();
        markerPool = null;
        sync?.leave();
        sync = null;
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
  });
}
