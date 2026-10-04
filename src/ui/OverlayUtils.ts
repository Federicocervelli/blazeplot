import type { SeriesYAxis } from "../core/types.js";
import type { ChartHoverState, ChartPickGroup, ChartPickItem, ChartPickMode } from "./Chart.js";
import type { ChartPluginContext } from "./PluginHost.js";
import { rgbaCss } from "./theme.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Create an SVG element in the SVG namespace. */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

/** A plugin instance that mirrors the pointer X of other charts in its sync group. */
export interface SyncPeer {
  showAt(dataX: number): void;
  hide(): void;
}

/** Membership returned by a sync registry. */
export interface SyncMembership {
  /** Show every other peer at `dataX`, or hide them all for `null`. */
  broadcast(dataX: number | null): void;
  leave(): void;
}

/**
 * Create a registry of named sync groups. Peers that render in response to a
 * broadcast cannot re-broadcast, so mirrored updates never loop.
 */
export function createSyncRegistry(): (group: string | undefined, peer: SyncPeer) => SyncMembership {
  const groups = new Map<string, Set<SyncPeer>>();
  let broadcasting = false;
  return (group, peer) => {
    if (!group) return { broadcast() {}, leave() {} };
    const peers = groups.get(group) ?? new Set<SyncPeer>();
    peers.add(peer);
    groups.set(group, peers);
    return {
      broadcast(dataX) {
        if (broadcasting) return;
        broadcasting = true;
        try {
          for (const other of peers) {
            if (other === peer) continue;
            if (dataX === null) other.hide();
            else other.showAt(dataX);
          }
        } finally {
          broadcasting = false;
        }
      },
      leave() {
        peers.delete(peer);
        if (peers.size === 0) groups.delete(group);
      },
    };
  };
}

/** Return the display label for a picked series item. */
export function labelOfPickItem(item: ChartPickItem): string {
  return item.name ?? item.id ?? `${item.mode} ${item.seriesIndex + 1}`;
}

/** Format a number compactly for overlay labels. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs > 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(3);
  return Number(value.toPrecision(6)).toString();
}

/** Clamp a number to an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Shared absolute overlay layer options. */
export interface OverlayLayerOptions {
  readonly zIndex?: number | string;
  readonly display?: string;
  readonly inset?: string;
  readonly pointerEvents?: string;
}

/** Create a plot overlay layer with consistent positioning and pointer behavior. */
export function createOverlayLayer(className: string, options: OverlayLayerOptions = {}): HTMLDivElement {
  const layer = document.createElement("div");
  layer.className = className;
  layer.style.position = "absolute";
  if (options.inset !== undefined) layer.style.inset = options.inset;
  layer.style.display = options.display ?? "none";
  layer.style.pointerEvents = options.pointerEvents ?? "none";
  if (options.zIndex !== undefined) layer.style.zIndex = String(options.zIndex);
  return layer;
}

/** Position a fixed element near a client point while keeping it onscreen. */
export function placeFixedWithinViewport(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  options: { readonly offsetX: number; readonly offsetY: number; readonly margin?: number; readonly size?: { readonly width: number; readonly height: number } },
): void {
  const rect = options.size ?? element.getBoundingClientRect();
  const margin = options.margin ?? 4;
  const doc = element.ownerDocument;
  const viewportWidth = Math.max(1, globalThis.innerWidth || doc.documentElement.clientWidth);
  const viewportHeight = Math.max(1, globalThis.innerHeight || doc.documentElement.clientHeight);
  const x = clamp(clientX + options.offsetX, margin, Math.max(margin, viewportWidth - rect.width - margin));
  const y = clamp(clientY + options.offsetY, margin, Math.max(margin, viewportHeight - rect.height - margin));
  element.style.transform = `translate(${x}px, ${y}px)`;
}

/** Position an absolute element inside a plot-sized box. */
export function placeAbsoluteWithinBox(
  element: HTMLElement,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { readonly offsetX: number; readonly offsetY: number; readonly margin?: number },
): void {
  const rect = element.getBoundingClientRect();
  const margin = options.margin ?? 4;
  const left = clamp(x + options.offsetX, margin, Math.max(margin, width - rect.width - margin));
  const top = clamp(y + options.offsetY, margin, Math.max(margin, height - rect.height - margin));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

/** Render picked series values as text rows; formatter output is plain text, never HTML. */
export function renderPickItems<TContext>(
  container: HTMLElement,
  items: readonly ChartPickItem[],
  context: TContext,
  formatter: ((item: ChartPickItem, context: TContext) => string) | undefined,
  defaultFormatter: (item: ChartPickItem, context: TContext) => string,
): void {
  const pad = Math.max(1, ...items.map((item) => labelOfPickItem(item).length));
  container.replaceChildren();
  items.forEach((item, index) => {
    if (index > 0) container.append(document.createElement("br"));
    const swatch = document.createElement("span");
    swatch.style.color = rgbaCss(item.series.style.color);
    swatch.textContent = "\u2588";
    const value = formatter ? formatter(item, context) : defaultFormatter(item, context);
    container.append(swatch, ` ${labelOfPickItem(item).padEnd(pad)}  ${value}`);
  });
}

/** Visual options for the hover/selection pick marker. */
export interface PickMarkerOptions {
  /** Outline color; plugins pass `chart.theme.markerStrokeColor`. */
  readonly strokeColor: string;
  readonly sizePx?: number;
  readonly strokeWidthPx?: number;
}

/** Options for picking chart items at a data-X value. */
export interface PickAtDataXOptions {
  readonly yAxis?: SeriesYAxis;
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
  readonly maxDistancePx?: number;
}

/** Pick chart items at a data-X value using midpoint Y for pointer-based pick APIs. */
export function pickAtDataX(chart: ChartPluginContext, dataX: number, options: PickAtDataXOptions = {}): ChartHoverState | null {
  const yAxis = options.yAxis ?? "left";
  const rect = chart.layout.plotRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const viewport = chart.viewport.get(yAxis);
  const dataY = viewport.yMin + (viewport.yMax - viewport.yMin) * 0.5;
  const [plotX, plotY] = chart.coords.dataToPlot(dataX, dataY, yAxis);
  return chart.state.pick(rect.left + plotX, rect.top + plotY, {
    mode: options.mode ?? "nearest-x",
    group: options.group ?? "x",
    maxDistancePx: options.maxDistancePx,
  });
}

/** Create a marker element for a picked series point. */
export function createPickMarker(item: ChartPickItem, options: PickMarkerOptions): HTMLDivElement {
  const marker = document.createElement("div");
  marker.style.position = "absolute";
  marker.style.left = `${item.plotX}px`;
  marker.style.top = `${item.plotY}px`;
  marker.style.width = `${options.sizePx ?? 10}px`;
  marker.style.height = `${options.sizePx ?? 10}px`;
  marker.style.border = `${options.strokeWidthPx ?? 2}px solid ${options.strokeColor}`;
  marker.style.borderRadius = "999px";
  marker.style.background = rgbaCss(item.series.style.color);
  marker.style.boxShadow = "0 0 0 1px rgba(4, 8, 16, 0.85)";
  marker.style.transform = "translate(-50%, -50%)";
  return marker;
}

/** Options for long-press touch tracking. */
export interface LongPressTouchTrackerOptions {
  readonly delayMs: () => number | false | undefined;
  readonly onPoint: (clientX: number, clientY: number) => void;
  readonly movementThresholdPx?: number;
}

/** Touch/pointer handlers for long-press interactions. */
export interface LongPressTouchTracker {
  clear(): void;
  schedule(clientX: number, clientY: number): void;
  onTouchStart(event: TouchEvent): void;
  onTouchMove(event: TouchEvent): void;
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): boolean;
  clearIfTouchPointer(event: PointerEvent): void;
}

/** Create a touch tracker that activates after a stationary long press. */
export function createLongPressTouchTracker(options: LongPressTouchTrackerOptions): LongPressTouchTracker {
  const movementThresholdPx = options.movementThresholdPx ?? 8;
  let timer: number | null = null;
  let raf = 0;
  let active = false;
  let clientX = 0;
  let clientY = 0;

  const clear = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    if (raf !== 0) window.cancelAnimationFrame(raf);
    timer = null;
    raf = 0;
    active = false;
  };

  const refresh = (): void => {
    if (!active) return;
    options.onPoint(clientX, clientY);
    raf = window.requestAnimationFrame(refresh);
  };

  const activate = (): void => {
    timer = null;
    active = true;
    options.onPoint(clientX, clientY);
    raf = window.requestAnimationFrame(refresh);
  };

  const schedule = (nextClientX: number, nextClientY: number): void => {
    const delayMs = options.delayMs();
    if (delayMs === false || active) return;
    clientX = nextClientX;
    clientY = nextClientY;
    clear();
    timer = window.setTimeout(activate, delayMs ?? 450);
  };

  const handleMove = (event: TouchEvent | PointerEvent, nextClientX: number, nextClientY: number): void => {
    if (active) {
      event.preventDefault();
      event.stopPropagation();
      clientX = nextClientX;
      clientY = nextClientY;
      options.onPoint(clientX, clientY);
      return;
    }
    if (timer !== null && Math.hypot(nextClientX - clientX, nextClientY - clientY) > movementThresholdPx) clear();
  };

  return {
    clear,
    schedule,
    onTouchStart(event: TouchEvent): void {
      if (event.touches.length !== 1) {
        clear();
        return;
      }
      const touch = event.touches.item(0);
      if (!touch) return;
      schedule(touch.clientX, touch.clientY);
    },
    onTouchMove(event: TouchEvent): void {
      const touch = event.touches.item(0);
      if (!touch) return;
      handleMove(event, touch.clientX, touch.clientY);
    },
    onPointerDown(event: PointerEvent): void {
      if (event.pointerType !== "touch") return;
      schedule(event.clientX, event.clientY);
    },
    onPointerMove(event: PointerEvent): boolean {
      if (event.pointerType !== "touch") return false;
      handleMove(event, event.clientX, event.clientY);
      return true;
    },
    clearIfTouchPointer(event: PointerEvent): void {
      if (event.pointerType === "touch") clear();
    },
  };
}
