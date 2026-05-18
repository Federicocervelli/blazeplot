import type { SeriesYAxis } from "../core/types.js";
import type { Chart, ChartPickItem, ChartPickMode, ChartPlugin } from "./Chart.js";

export type CrosshairAxis = "x" | "y" | "xy";
export type CrosshairSnapMode = "none" | "nearest-x" | "nearest-point";
export type CrosshairMode = "crosshair" | "ruler";

export interface CrosshairPosition {
  readonly dataX: number;
  readonly dataY: number;
  readonly plotX: number;
  readonly plotY: number;
  readonly items: readonly ChartPickItem[];
}

export interface RulerMeasurement {
  readonly start: CrosshairPosition;
  readonly end: CrosshairPosition;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly slope: number;
  readonly sampleCount: number;
}

export interface CrosshairPluginOptions {
  readonly mode?: CrosshairMode;
  readonly axis?: CrosshairAxis;
  readonly yAxis?: SeriesYAxis;
  readonly snap?: CrosshairSnapMode;
  readonly group?: string;
  readonly color?: string;
  readonly width?: number;
  readonly dash?: string;
  readonly label?: boolean;
  readonly labelBackground?: string;
  readonly labelColor?: string;
  readonly labelFont?: string;
  readonly zIndex?: number;
  readonly highlight?: boolean;
  readonly markerSize?: number;
  readonly markerStrokeColor?: string;
  readonly markerStrokeWidth?: number;
  readonly rulerModifier?: "none" | "ctrl" | "shift" | "alt" | "meta";
  readonly formatX?: (value: number) => string;
  readonly formatY?: (value: number) => string;
  readonly formatter?: (item: ChartPickItem, position: CrosshairPosition) => string;
  readonly render?: (position: CrosshairPosition, container: HTMLElement, chart: Chart) => void;
  readonly onMove?: (position: CrosshairPosition | null) => void;
  readonly onMeasureStart?: (position: CrosshairPosition) => void;
  readonly onMeasureChange?: (measurement: RulerMeasurement) => void;
  readonly onMeasureEnd?: (measurement: RulerMeasurement) => void;
  readonly onMeasure?: (measurement: RulerMeasurement) => void;
}

interface Peer {
  showShared(dataX: number, source: Peer): void;
  hideShared(source: Peer): void;
}

const groups = new Map<string, Set<Peer>>();

function formatNumber(value: number): string {
  if (Math.abs(value) < 1e-12) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-3) return value.toExponential(2);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function labelOf(item: ChartPickItem): string {
  return item.name ?? item.id ?? `${item.mode} ${item.seriesIndex + 1}`;
}

function rgba(color: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function countSamplesInRange(chart: Chart, xMin: number, xMax: number): number {
  const viewport = { xMin, xMax, yMin: -Infinity, yMax: Infinity };
  let total = 0;
  for (const state of chart.getSeriesState()) {
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

function resolvePosition(chart: Chart, clientX: number, clientY: number, yAxis: SeriesYAxis, snap: CrosshairSnapMode): CrosshairPosition | null {
  const rect = chart.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const pickMode: ChartPickMode = snap === "nearest-point" ? "nearest-point" : "nearest-x";
  if (snap !== "none") {
    const picked = chart.pick(clientX, clientY, { mode: pickMode, group: snap === "nearest-x" ? "x" : "none" });
    const item = picked?.items[0];
    if (item) {
      return { dataX: item.x, dataY: item.y, plotX: item.plotX, plotY: item.plotY, items: [item] };
    }
  }

  const data = chart.clientToData(clientX, clientY, yAxis);
  if (!data) return null;
  const [plotX, plotY] = chart.dataToPlot(data[0], data[1], yAxis);
  return { dataX: data[0], dataY: data[1], plotX, plotY, items: [] };
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

  const pad = Math.max(1, ...position.items.map((item) => labelOf(item).length));
  let html = "";
  for (const item of position.items) {
    const value = formatter ? formatter(item, position) : `(${formatX(item.x)}, ${formatY(item.y)})`;
    if (html) html += "<br>";
    html += `<span style="color:${rgba(item.series.style.color)}">\u2588</span> ${labelOf(item).padEnd(pad)}  ${value}`;
  }
  container.innerHTML = html;
}

export function crosshairPlugin(options: CrosshairPluginOptions = {}): ChartPlugin {
  const axis = options.axis ?? "xy";
  const yAxis = options.yAxis ?? "left";
  const snap = options.snap ?? "none";
  const mode = options.mode ?? "crosshair";
  const rulerModifier = options.rulerModifier ?? "none";
  let chartRef: Chart | null = null;
  let root: HTMLDivElement | null = null;
  let vertical: HTMLDivElement | null = null;
  let horizontal: HTMLDivElement | null = null;
  let markerLayer: HTMLDivElement | null = null;
  let label: HTMLDivElement | null = null;
  let rulerSvg: SVGSVGElement | null = null;
  let rulerLine: SVGLineElement | null = null;
  let rulerStart: CrosshairPosition | null = null;

  const formatX = options.formatX ?? formatNumber;
  const formatY = options.formatY ?? formatNumber;

  const setVisible = (visible: boolean): void => {
    if (root) root.style.display = visible ? "block" : "none";
  };

  const placeLabel = (position: CrosshairPosition): void => {
    const chart = chartRef;
    if (!chart || !label) return;
    const offsetX = 12;
    const offsetY = 12;
    const labelRect = label.getBoundingClientRect();
    const margin = 4;
    const plotWidth = Math.max(1, chart.canvas.clientWidth);
    const plotHeight = Math.max(1, chart.canvas.clientHeight);
    const left = clamp(
      position.plotX + offsetX,
      margin,
      Math.max(margin, plotWidth - labelRect.width - margin),
    );
    const top = clamp(
      position.plotY + offsetY,
      margin,
      Math.max(margin, plotHeight - labelRect.height - margin),
    );
    label.style.left = `${left}px`;
    label.style.top = `${top}px`;
  };

  const renderMarkers = (position: CrosshairPosition | null): void => {
    if (!markerLayer) return;
    markerLayer.replaceChildren();
    if (options.highlight === false || !position) return;

    const size = Math.max(2, options.markerSize ?? 10);
    const strokeWidth = Math.max(0, options.markerStrokeWidth ?? 2);
    for (const item of position.items) {
      const marker = document.createElement("div");
      marker.style.position = "absolute";
      marker.style.left = `${item.plotX}px`;
      marker.style.top = `${item.plotY}px`;
      marker.style.width = `${size}px`;
      marker.style.height = `${size}px`;
      marker.style.border = `${strokeWidth}px solid ${options.markerStrokeColor ?? "#f8fafc"}`;
      marker.style.borderRadius = "999px";
      marker.style.background = rgba(item.series.style.color);
      marker.style.boxShadow = "0 0 0 1px rgba(4, 8, 16, 0.85)";
      marker.style.transform = "translate(-50%, -50%)";
      markerLayer.appendChild(marker);
    }
  };

  const renderPosition = (position: CrosshairPosition | null): void => {
    renderMarkers(position);
    if (!position || !root || !vertical || !horizontal || !label) {
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

  const measurementFrom = (start: CrosshairPosition, end: CrosshairPosition, chart: Chart): RulerMeasurement => {
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
    options.onMeasureChange?.(measurementFrom(rulerStart, end, chart));
  };

  const emitShared = (position: CrosshairPosition): void => {
    if (!options.group || !peer) return;
    for (const target of groups.get(options.group) ?? []) {
      if (target !== peer) target.showShared(position.dataX, peer);
    }
  };

  const emitHideShared = (): void => {
    if (!options.group || !peer) return;
    for (const target of groups.get(options.group) ?? []) {
      if (target !== peer) target.hideShared(peer);
    }
  };

  const peer: Peer = {
    showShared(dataX: number, source: Peer): void {
      if (source === peer || !chartRef) return;
      const viewport = chartRef.getViewport(yAxis);
      const dataY = viewport.yMin + (viewport.yMax - viewport.yMin) * 0.5;
      const [plotX, plotY] = chartRef.dataToPlot(dataX, dataY, yAxis);
      renderPosition({ dataX, dataY, plotX, plotY, items: [] });
    },
    hideShared(source: Peer): void {
      if (source === peer) return;
      renderPosition(null);
    },
  };

  return {
    install(chart: Chart) {
      chartRef = chart;
      const color = options.color ?? "rgba(148, 163, 184, 0.55)";
      const width = `${options.width ?? 1}px`;
      const dash = options.dash;

      root = document.createElement("div");
      root.className = "blazeplot-crosshair";
      root.style.position = "absolute";
      root.style.inset = "0";
      root.style.display = "none";
      root.style.pointerEvents = "none";
      root.style.zIndex = String(options.zIndex ?? 10_000);

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

      markerLayer = document.createElement("div");
      markerLayer.className = "blazeplot-crosshair-markers";
      markerLayer.style.position = "absolute";
      markerLayer.style.inset = "0";
      markerLayer.style.zIndex = "2";
      markerLayer.style.pointerEvents = "none";

      label = document.createElement("div");
      label.style.position = "absolute";
      label.style.zIndex = "3";
      label.style.padding = "4px 6px";
      label.style.borderRadius = "3px";
      label.style.background = options.labelBackground ?? chart.theme.tooltipBackgroundColor;
      label.style.color = options.labelColor ?? chart.theme.tooltipTextColor;
      label.style.font = options.labelFont ?? chart.theme.tooltipFont;
      label.style.whiteSpace = "nowrap";

      rulerSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      rulerSvg.style.position = "absolute";
      rulerSvg.style.inset = "0";
      rulerSvg.style.width = "100%";
      rulerSvg.style.height = "100%";
      rulerSvg.style.display = "none";
      rulerSvg.style.overflow = "hidden";
      rulerSvg.style.zIndex = "1";
      rulerLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      rulerLine.setAttribute("stroke", color);
      rulerLine.setAttribute("stroke-width", String(options.width ?? 1));
      if (dash) rulerLine.setAttribute("stroke-dasharray", dash);
      rulerSvg.appendChild(rulerLine);

      root.appendChild(vertical);
      root.appendChild(horizontal);
      root.appendChild(rulerSvg);
      root.appendChild(markerLayer);
      root.appendChild(label);
      chart.plotElement.appendChild(root);

      if (options.group) {
        const set = groups.get(options.group) ?? new Set<Peer>();
        set.add(peer);
        groups.set(options.group, set);
      }

      const onPointerMove = (event: PointerEvent): void => {
        const position = resolvePosition(chart, event.clientX, event.clientY, yAxis, snap);
        renderPosition(position);
        options.onMove?.(position);
        if (position) emitShared(position);
        if (mode === "ruler") renderRuler(position);
      };

      const onPointerLeave = (): void => {
        if (!rulerStart) renderPosition(null);
        options.onMove?.(null);
        emitHideShared();
      };

      const onPointerDown = (event: PointerEvent): void => {
        if (mode !== "ruler" || event.button !== 0 || !hasModifier(event, rulerModifier)) return;
        rulerStart = resolvePosition(chart, event.clientX, event.clientY, yAxis, snap);
        if (rulerStart) {
          options.onMeasureStart?.(rulerStart);
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
        options.onMeasureEnd?.(measurement);
        options.onMeasure?.(measurement);
        rulerStart = null;
      };

      chart.canvas.addEventListener("pointermove", onPointerMove);
      chart.canvas.addEventListener("pointerleave", onPointerLeave);
      chart.canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
      chart.canvas.addEventListener("pointerup", onPointerUp, { capture: true });

      return () => {
        chart.canvas.removeEventListener("pointermove", onPointerMove);
        chart.canvas.removeEventListener("pointerleave", onPointerLeave);
        chart.canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
        chart.canvas.removeEventListener("pointerup", onPointerUp, { capture: true });
        if (options.group) {
          const set = groups.get(options.group);
          set?.delete(peer);
          if (set?.size === 0) groups.delete(options.group);
        }
        root?.remove();
        root = null;
        vertical = null;
        horizontal = null;
        markerLayer = null;
        label = null;
        rulerSvg = null;
        rulerLine = null;
        rulerStart = null;
        chartRef = null;
      };
    },
  };
}
