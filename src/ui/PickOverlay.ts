import type { SeriesYAxis } from "../core/types.js";
import type { ChartHoverState, ChartPickGroup, ChartPickItem, ChartPickMode } from "./ChartEvents.js";
import type { ChartPluginContext } from "./PluginTypes.js";
import { clamp } from "./OverlayUtils.js";
import { rgbaCss } from "./theme.js";

// Helpers shared by the tooltip and crosshair plugins: pick markers, pick rows, X sync groups, and
// long-press touch tracking. Kept apart from OverlayUtils so other plugins do not bundle them.

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
    if (index > 0) container.append(container.ownerDocument.createElement("br"));
    const swatch = container.ownerDocument.createElement("span");
    swatch.className = "blazeplot-pick-swatch";
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
export function createPickMarker(doc: Document, item: ChartPickItem, options: PickMarkerOptions): HTMLDivElement {
  const marker = doc.createElement("div");
  marker.className = "blazeplot-pick-marker";
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

/** Forced-colors rules for the pick swatches and markers shared by the tooltip and crosshair. */
export const PICK_FORCED_COLORS_CSS = "@media (forced-colors:active){.blazeplot-pick-swatch,.blazeplot-pick-marker{forced-color-adjust:none}}";

/** Layer of reusable point markers, one per picked item. */
export interface PickMarkerPool {
  /** Show one marker per item (hiding spares). Pass `[]` to hide them all. */
  update(items: readonly ChartPickItem[], options: PickMarkerOptions): void;
  /** Drop every marker element, e.g. before a caller draws its own highlights. */
  reset(): void;
}

/** Create a pool that reuses `createPickMarker` elements inside `layer`. */
export function createPickMarkerPool(layer: HTMLElement): PickMarkerPool {
  const markers: HTMLDivElement[] = [];
  return {
    update(items, options) {
      // Leftovers from custom highlights are not in the pool.
      if (markers.length === 0 && layer.firstChild) layer.replaceChildren();
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        let marker = markers[i];
        if (!marker) {
          marker = createPickMarker(layer.ownerDocument, item, options);
          markers[i] = marker;
          layer.appendChild(marker);
        }
        marker.style.display = "block";
        marker.style.left = `${item.plotX}px`;
        marker.style.top = `${item.plotY}px`;
        marker.style.background = rgbaCss(item.series.style.color);
        marker.style.borderColor = options.strokeColor;
      }
      for (let i = items.length; i < markers.length; i++) markers[i]!.style.display = "none";
    },
    reset() {
      layer.replaceChildren();
      markers.length = 0;
    },
  };
}

/**
 * Let a long press follow the finger sideways while the page can still scroll vertically.
 * `touch-action` decorations intersect, so a plugin that needs `none` (interactions,
 * selection) still wins.
 */
export function requestLongPressTouchAction(chart: ChartPluginContext, longPressMs: number | false | undefined): void {
  if (longPressMs === false) return;
  chart.dom.decorate("plot", { style: { touchAction: "pan-y" } });
}

/** Options for long-press touch tracking. */
export interface LongPressTouchTrackerOptions {
  /** Window that owns the chart, used for timers and animation frames. */
  readonly view: Window;
  readonly delayMs: () => number | false | undefined;
  readonly onPoint: (clientX: number, clientY: number) => void;
  /** Called when an active long press ends: finger lifted, cancelled, or a second finger arrived. */
  readonly onEnd?: () => void;
  readonly movementThresholdPx?: number;
}

/** Pointer handlers for long-press interactions. Only touch pointers take part. */
export interface LongPressTouchTracker {
  clear(): void;
  schedule(clientX: number, clientY: number): void;
  onPointerDown(event: PointerEvent): void;
  /** Returns true for touch pointers, which never drive hover. */
  onPointerMove(event: PointerEvent): boolean;
  /** Pointer up or cancel: forget the pointer and end any press. */
  clearIfTouchPointer(event: PointerEvent): void;
}

/** Create a tracker that activates after a stationary one-finger long press. */
export function createLongPressTouchTracker(options: LongPressTouchTrackerOptions): LongPressTouchTracker {
  const movementThresholdPx = options.movementThresholdPx ?? 8;
  const touchIds = new Set<number>();
  let timer: number | null = null;
  let raf = 0;
  let active = false;
  let clientX = 0;
  let clientY = 0;

  const clear = (): void => {
    if (timer !== null) options.view.clearTimeout(timer);
    if (raf !== 0) options.view.cancelAnimationFrame(raf);
    timer = null;
    raf = 0;
    active = false;
  };

  const end = (): void => {
    const wasActive = active;
    clear();
    if (wasActive) options.onEnd?.();
  };

  const refresh = (): void => {
    if (!active) return;
    options.onPoint(clientX, clientY);
    raf = options.view.requestAnimationFrame(refresh);
  };

  const activate = (): void => {
    timer = null;
    active = true;
    options.onPoint(clientX, clientY);
    raf = options.view.requestAnimationFrame(refresh);
  };

  const schedule = (nextClientX: number, nextClientY: number): void => {
    const delayMs = options.delayMs();
    if (delayMs === false || active) return;
    clientX = nextClientX;
    clientY = nextClientY;
    clear();
    timer = options.view.setTimeout(activate, delayMs ?? 450);
  };

  return {
    clear,
    schedule,
    onPointerDown(event: PointerEvent): void {
      if (event.pointerType !== "touch") return;
      touchIds.add(event.pointerId);
      // A second finger means pinch or pan, never a long press.
      if (touchIds.size !== 1) {
        end();
        return;
      }
      schedule(event.clientX, event.clientY);
    },
    onPointerMove(event: PointerEvent): boolean {
      if (event.pointerType !== "touch") return false;
      if (touchIds.size !== 1 || !touchIds.has(event.pointerId)) return true;
      if (active) {
        // Own the move: later listeners (pan) see it as handled.
        event.preventDefault();
        clientX = event.clientX;
        clientY = event.clientY;
        options.onPoint(clientX, clientY);
      } else if (timer !== null && Math.hypot(event.clientX - clientX, event.clientY - clientY) > movementThresholdPx) {
        clear();
      }
      return true;
    },
    clearIfTouchPointer(event: PointerEvent): void {
      if (event.pointerType !== "touch") return;
      touchIds.delete(event.pointerId);
      end();
    },
  };
}

/** Options for `installLongPress`. */
export interface InstallLongPressOptions {
  readonly longPressMs: number | false | undefined;
  /** Called with the finger position while a long press is active. */
  readonly onPoint: (clientX: number, clientY: number) => void;
  /** Called when an active long press ends, so the plugin can hide what the press showed. */
  readonly onEnd?: () => void;
  /** Runs for every pointer move, before the tracker sees it. */
  readonly beforeMove?: (event: PointerEvent) => void;
  /** Runs for pointer moves the tracker does not own (mouse and pen). */
  readonly onMove?: (event: PointerEvent) => void;
  /** Runs after the tracker has seen a pointer down. */
  readonly onDown?: (event: PointerEvent) => void;
  /** Runs after the tracker has seen a pointer up. */
  readonly onUp?: (event: PointerEvent) => void;
}

/**
 * Wire long-press touch tracking onto the plot surface: request `touch-action`, create the tracker,
 * and listen for pointer events. Listeners are released with the plugin; call `clear()` on the
 * returned tracker in the plugin's dispose to stop a pending timer.
 */
export function installLongPress(chart: ChartPluginContext, options: InstallLongPressOptions): LongPressTouchTracker {
  requestLongPressTouchAction(chart, options.longPressMs);
  const tracker = createLongPressTouchTracker({
    view: chart.dom.view,
    delayMs: () => options.longPressMs,
    onPoint: options.onPoint,
    onEnd: options.onEnd,
  });
  const listen = (type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", listener: (event: PointerEvent) => void): void => {
    chart.dom.listen("plot", type, listener, { capture: true });
  };
  listen("pointerdown", (event) => {
    tracker.onPointerDown(event);
    options.onDown?.(event);
  });
  listen("pointermove", (event) => {
    options.beforeMove?.(event);
    if (!tracker.onPointerMove(event)) options.onMove?.(event);
  });
  listen("pointerup", (event) => {
    tracker.clearIfTouchPointer(event);
    options.onUp?.(event);
  });
  listen("pointercancel", tracker.clearIfTouchPointer);
  return tracker;
}

