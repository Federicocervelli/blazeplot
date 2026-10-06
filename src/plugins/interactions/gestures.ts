/**
 * Gesture helpers for the interactions plugin: surface/axis mapping, pointer capture, wheel and
 * trackpad normalization, pan constraints, pinch metrics, and selection-axis zoom. Pure or context-only.
 */
import type { SeriesYAxis, Viewport } from "../../core/types.js";
import type { PanIntent, ZoomAxis } from "../../interaction/types.js";
import type { ChartPluginContext, ChartRect, ChartSurface } from "../../ui/PluginTypes.js";
import { asElement } from "../common/OverlayUtils.js";
import type { InteractionAxisOption } from "./types.js";


export type AxisSurface = Exclude<ChartSurface, "plot" | "root">;
export type GestureSurface = "plot" | AxisSurface;

export const AXIS_SURFACES: readonly AxisSurface[] = ["axis-x", "axis-y", "axis-y2"];
/** Gestures from this plugin report `viewportchange.source === "user"`. */
export const USER_VIEWPORT = { source: "user" } as const;

export function axisGestureConfig(surface: AxisSurface): { axis: ZoomAxis; yAxis?: SeriesYAxis } {
  if (surface === "axis-x") return { axis: "x" };
  return { axis: "y", yAxis: surface === "axis-y2" ? "right" : "left" };
}

/** Capture the pointer on the surface that received the press. */
export function capturePointer(event: PointerEvent): Element | null {
  const target = asElement(event.currentTarget);
  target?.setPointerCapture(event.pointerId);
  return target;
}

export function releasePointer(target: Element | null, pointerId: number): void {
  if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
}

/** Movement (CSS px) beyond which a touch is a drag, not a tap. */
export const TAP_SLOP_PX = 10;

export interface TouchPoint {
  x: number;
  y: number;
}

export type TouchGestureState =
  | { readonly mode: "pan"; readonly pointerId: number; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastX: number; lastY: number }
  | { readonly mode: "pinch"; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastDistance: number; lastCx: number; lastCy: number };

export type DragState =
  | {
      readonly mode: "pan";
      readonly pointerId: number;
      readonly axis: ZoomAxis;
      readonly captureTarget: Element | null;
      readonly yAxis?: SeriesYAxis;
      lastX: number;
      lastY: number;
    }
  | {
      readonly mode: "select";
      readonly pointerId: number;
      readonly captureTarget: Element | null;
      readonly startX: number;
      readonly startY: number;
      currentX: number;
      currentY: number;
    };

export function isApplePlatform(view: Window): boolean {
  return /Mac|iPhone|iPad/.test(view.navigator?.platform ?? "");
}

export function resolveAxis(axis: InteractionAxisOption | undefined): ZoomAxis {
  return typeof axis === "function" ? axis() : axis ?? "xy";
}

export function wheelDeltaPixels(event: WheelEvent, fallbackPageSize: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(1, fallbackPageSize);
  return event.deltaY;
}

export function wheelZoomFactor(event: WheelEvent, fallbackPageSize: number, wheelSensitivity: number, pinchSensitivity: number): number {
  const delta = Math.max(-600, Math.min(600, wheelDeltaPixels(event, fallbackPageSize)));
  const sensitivity = event.ctrlKey ? pinchSensitivity : wheelSensitivity;
  return Math.max(0.2, Math.min(5, Math.exp(-delta * sensitivity)));
}

export function isLikelyTrackpadPan(event: WheelEvent): boolean {
  if (event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false;
  const absX = Math.abs(event.deltaX);
  const absY = Math.abs(event.deltaY);
  if (absX > 0) return true;
  if (absY <= 0) return false;
  // Traditional mouse wheels commonly report coarse vertical-only ~100px pixel
  // deltas in Chromium. Keep those as zoom; trackpad two-finger slides emit
  // fine-grained smaller deltas and should pan.
  return absY < 80;
}

export function constrainPan(intent: PanIntent, axis: ZoomAxis): PanIntent {
  return {
    dx: axis === "y" ? 0 : intent.dx,
    dy: axis === "x" ? 0 : intent.dy,
  };
}

export function normalizeViewport(v: Viewport): Viewport {
  return { xMin: v.xMin, xMax: v.xMax, yMin: v.yMin, yMax: v.yMax };
}

export function clientToDataClamped(
  clientX: number,
  clientY: number,
  rect: ChartRect,
  chart: ChartPluginContext,
  yAxis: SeriesYAxis = "left",
): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return chart.coords.clientToData(
    rect.left + Math.max(0, Math.min(clientX - rect.left, rect.width)),
    rect.top + Math.max(0, Math.min(clientY - rect.top, rect.height)),
    yAxis,
  );
}

/** Centroid and spread of the first two active touch pointers. */
export function pinchMetrics(touches: ReadonlyMap<number, TouchPoint>): { cx: number; cy: number; distance: number } | null {
  if (touches.size < 2) return null;
  const [a, b] = touches.values();
  if (!a || !b) return null;
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

export function applySelectionAxis(
  current: Viewport,
  a: [number, number],
  b: [number, number],
  axis: ZoomAxis,
): Viewport {
  const xMin = Math.min(a[0], b[0]);
  const xMax = Math.max(a[0], b[0]);
  const yMin = Math.min(a[1], b[1]);
  const yMax = Math.max(a[1], b[1]);

  return {
    xMin: axis === "y" ? current.xMin : xMin,
    xMax: axis === "y" ? current.xMax : xMax,
    yMin: axis === "x" ? current.yMin : yMin,
    yMax: axis === "x" ? current.yMax : yMax,
  };
}

