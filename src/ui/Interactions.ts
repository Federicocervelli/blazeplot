import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { PanIntent, ZoomAxis, ZoomIntent } from "../interaction/types.js";
import type { ChartPlugin, ChartPluginContext, ChartRect, ChartSurface } from "./PluginHost.js";

/** Static or dynamic axis choice for wheel and drag interactions. */
export type InteractionAxisOption = ZoomAxis | (() => ZoomAxis);

/** Options for mouse, wheel, touch, and keyboard chart interactions. */
export interface InteractionsPluginOptions {
  readonly axis?: InteractionAxisOption;
  readonly boxZoom?: boolean;
  readonly wheelZoom?: boolean;
  readonly wheelZoomSensitivity?: number;
  readonly trackpadPinchSensitivity?: number;
  readonly trackpadPan?: boolean;
  readonly trackpadPanSensitivity?: number;
  readonly axisInteractions?: boolean;
  readonly axisHover?: boolean;
  readonly axisHoverColor?: string;
  readonly axisHoverFilter?: string;
  readonly shiftDragPan?: boolean;
  readonly doubleClickReset?: boolean;
  /**
   * When double-click/tap reset is used on a live-follow chart, resume the
   * chart's latest-X follow after applying the reset viewport. Defaults to true.
   */
  readonly resumeFollowOnReset?: boolean;
  readonly resetViewport?: () => Viewport;
  readonly touchPan?: boolean;
  readonly pinchZoom?: boolean;
  readonly doubleTapReset?: boolean;
  readonly minDragDistancePx?: number;
}

let nextInteractionsPluginId = 1;

type AxisSurface = Exclude<ChartSurface, "plot" | "root">;
type GestureSurface = "plot" | AxisSurface;

const AXIS_SURFACES: readonly AxisSurface[] = ["axis-x", "axis-y", "axis-y2"];
/** Gestures from this plugin report `viewportchange.source === "user"`. */
const USER_VIEWPORT = { source: "user" } as const;

function axisGestureConfig(surface: AxisSurface): { axis: ZoomAxis; yAxis?: SeriesYAxis } {
  if (surface === "axis-x") return { axis: "x" };
  return { axis: "y", yAxis: surface === "axis-y2" ? "right" : "left" };
}

/** Capture the pointer on the surface that received the press. */
function capturePointer(event: PointerEvent): Element | null {
  const target = event.currentTarget instanceof Element ? event.currentTarget : null;
  target?.setPointerCapture(event.pointerId);
  return target;
}

function releasePointer(target: Element | null, pointerId: number): void {
  if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
}

type TouchGestureState =
  | { readonly mode: "pan"; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastX: number; lastY: number }
  | { readonly mode: "pinch"; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastDistance: number };

type DragState =
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

function resolveAxis(axis: InteractionAxisOption | undefined): ZoomAxis {
  return typeof axis === "function" ? axis() : axis ?? "xy";
}

function wheelDeltaPixels(event: WheelEvent, fallbackPageSize: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(1, fallbackPageSize);
  return event.deltaY;
}

function wheelZoomFactor(event: WheelEvent, fallbackPageSize: number, wheelSensitivity: number, pinchSensitivity: number): number {
  const delta = Math.max(-600, Math.min(600, wheelDeltaPixels(event, fallbackPageSize)));
  const sensitivity = event.ctrlKey ? pinchSensitivity : wheelSensitivity;
  return Math.max(0.2, Math.min(5, Math.exp(-delta * sensitivity)));
}

function isLikelyTrackpadPan(event: WheelEvent): boolean {
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

function constrainPan(intent: PanIntent, axis: ZoomAxis): PanIntent {
  return {
    dx: axis === "y" ? 0 : intent.dx,
    dy: axis === "x" ? 0 : intent.dy,
  };
}

function normalizeViewport(v: Viewport): Viewport {
  return { xMin: v.xMin, xMax: v.xMax, yMin: v.yMin, yMax: v.yMax };
}

function clientToDataClamped(
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

function touchCenter(touches: TouchList): { x: number; y: number } | null {
  if (touches.length === 0) return null;
  let x = 0;
  let y = 0;
  for (let i = 0; i < touches.length; i++) {
    const touch = touches.item(i);
    if (!touch) continue;
    x += touch.clientX;
    y += touch.clientY;
  }
  return { x: x / touches.length, y: y / touches.length };
}

function touchDistance(touches: TouchList): number | null {
  const a = touches.item(0);
  const b = touches.item(1);
  if (!a || !b) return null;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function applySelectionAxis(
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

/** Create a plugin that enables pan, zoom, and touch interactions. */
export function interactionsPlugin(options: InteractionsPluginOptions = {}): ChartPlugin {
  return {
    install(chart: ChartPluginContext) {
      const minDragDistancePx = options.minDragDistancePx ?? 6;
      const axisInteractions = options.axisInteractions !== false;
      const selection = document.createElement("div");
      const axisHoverClass = `blazeplot-axis-hover-${nextInteractionsPluginId++}`;
      const axisHoverStyle = document.createElement("style");
      const cleanups: Array<() => void> = [];
      const hoverUndo = new Map<AxisSurface, () => void>();
      let drag: DragState | null = null;
      let touchGesture: TouchGestureState | null = null;
      let resetViewport: Viewport | null = null;
      let resetRightViewport: Viewport | null = null;
      let lastTapTime = 0;
      let lastTapX = 0;
      let lastTapY = 0;

      selection.className = "blazeplot-selection";
      selection.style.position = "absolute";
      selection.style.display = "none";
      selection.style.pointerEvents = "none";
      selection.style.zIndex = "24";
      selection.style.border = `1px solid ${chart.theme.selectionStrokeColor}`;
      selection.style.background = chart.theme.selectionFillColor;
      cleanups.push(chart.dom.mount("plot", selection));

      axisHoverStyle.textContent = `.${axisHoverClass} > div { color: ${options.axisHoverColor ?? chart.theme.titleColor} !important; }`;
      if (axisInteractions && options.axisHover !== false) {
        cleanups.push(chart.dom.mount("root", axisHoverStyle));
      }

      if (options.touchPan !== false || options.pinchZoom !== false) {
        cleanups.push(chart.dom.decorate("plot", { style: { touchAction: "none" } }));
        if (axisInteractions) {
          for (const surface of AXIS_SURFACES) cleanups.push(chart.dom.decorate(surface, { style: { touchAction: "none" } }));
        }
      }

      if (axisInteractions) {
        for (const surface of AXIS_SURFACES) {
          cleanups.push(chart.dom.decorate(surface, { style: { pointerEvents: "auto", cursor: surface === "axis-x" ? "ew-resize" : "ns-resize" } }));
        }
      }

      const captureResetViewport = (): void => {
        resetViewport ??= normalizeViewport(chart.viewport.get());
        resetRightViewport ??= normalizeViewport(chart.viewport.get("right"));
      };

      /** Map screen-direction gestures onto reversed axes; the chart applies its viewport policy. */
      const directPan = (intent: PanIntent, panAxis: ZoomAxis, targetYAxis: SeriesYAxis = "left"): PanIntent => {
        const constrained = constrainPan(intent, panAxis);
        return {
          dx: chart.viewport.isReversed("x", targetYAxis) ? -constrained.dx : constrained.dx,
          dy: chart.viewport.isReversed("y", targetYAxis) ? -constrained.dy : constrained.dy,
        };
      };

      const directZoom = (intent: ZoomIntent, targetYAxis: SeriesYAxis = "left"): ZoomIntent => ({
        ...intent,
        cx: chart.viewport.isReversed("x", targetYAxis) ? 1 - intent.cx : intent.cx,
        cy: chart.viewport.isReversed("y", targetYAxis) ? 1 - intent.cy : intent.cy,
      });

      const hideSelection = (): void => {
        selection.style.display = "none";
      };

      const setAxisHovered = (surface: AxisSurface, hovered: boolean): void => {
        if (options.axisHover === false) return;
        hoverUndo.get(surface)?.();
        hoverUndo.delete(surface);
        if (!hovered) return;
        hoverUndo.set(surface, chart.dom.decorate(surface, {
          style: { filter: options.axisHoverFilter ?? "brightness(1.18)" },
          classes: [axisHoverClass],
        }));
      };

      const updateSelection = (state: Extract<DragState, { mode: "select" }>): void => {
        const rect = chart.layout.plotRect();
        const x0 = Math.max(0, Math.min(state.startX - rect.left, rect.width));
        const y0 = Math.max(0, Math.min(state.startY - rect.top, rect.height));
        const x1 = Math.max(0, Math.min(state.currentX - rect.left, rect.width));
        const y1 = Math.max(0, Math.min(state.currentY - rect.top, rect.height));
        const selectionAxis = resolveAxis(options.axis);
        const left = selectionAxis === "y" ? 0 : Math.min(x0, x1);
        const top = selectionAxis === "x" ? 0 : Math.min(y0, y1);
        const width = selectionAxis === "y" ? rect.width : Math.abs(x1 - x0);
        const height = selectionAxis === "x" ? rect.height : Math.abs(y1 - y0);

        selection.style.left = `${left}px`;
        selection.style.top = `${top}px`;
        selection.style.width = `${width}px`;
        selection.style.height = `${height}px`;
        selection.style.display = "block";
      };

      const beginPan = (event: PointerEvent, panAxis: ZoomAxis, surface: GestureSurface, targetYAxis?: SeriesYAxis): void => {
        captureResetViewport();
        event.preventDefault();
        if (surface !== "plot") setAxisHovered(surface, true);
        drag = {
          mode: "pan",
          pointerId: event.pointerId,
          axis: panAxis,
          captureTarget: capturePointer(event),
          yAxis: targetYAxis,
          lastX: event.clientX,
          lastY: event.clientY,
        };
      };

      const onPlotPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "touch") return;
        if (drag || event.button !== 0) return;

        if (event.shiftKey && options.shiftDragPan !== false) {
          beginPan(event, resolveAxis(options.axis), "plot");
          return;
        }

        if (options.boxZoom === false) return;
        captureResetViewport();
        event.preventDefault();
        drag = {
          mode: "select",
          pointerId: event.pointerId,
          captureTarget: capturePointer(event),
          startX: event.clientX,
          startY: event.clientY,
          currentX: event.clientX,
          currentY: event.clientY,
        };
        updateSelection(drag);
      };

      const onAxisPointerDown = (event: PointerEvent, surface: AxisSurface): void => {
        if (event.pointerType === "touch") return;
        if (drag || event.button !== 0) return;
        const config = axisGestureConfig(surface);
        beginPan(event, config.axis, surface, config.yAxis);
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();

        if (drag.mode === "pan") {
          const rect = chart.layout.plotRect();
          const dx = rect.width > 0 ? (drag.lastX - event.clientX) / rect.width : 0;
          const dy = rect.height > 0 ? (event.clientY - drag.lastY) / rect.height : 0;
          chart.viewport.pan(directPan({ dx, dy }, drag.axis, drag.yAxis ?? "left"), drag.yAxis, USER_VIEWPORT);
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          return;
        }

        drag.currentX = event.clientX;
        drag.currentY = event.clientY;
        updateSelection(drag);
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();

        const completed = drag;
        drag = null;
        releasePointer(completed.captureTarget, event.pointerId);
        hideSelection();

        if (completed.mode !== "select") return;

        const dx = event.clientX - completed.startX;
        const dy = event.clientY - completed.startY;
        if (Math.hypot(dx, dy) < minDragDistancePx) return;

        const current = chart.viewport.get();
        const rect = chart.layout.plotRect();
        const start = clientToDataClamped(completed.startX, completed.startY, rect, chart);
        const end = clientToDataClamped(event.clientX, event.clientY, rect, chart);
        if (!start || !end) return;

        const selectionAxis = resolveAxis(options.axis);
        const next = applySelectionAxis(current, start, end, selectionAxis);
        if (!(next.xMax > next.xMin && next.yMax > next.yMin)) return;
        // The right axis has its own scale, so map the same pixel rectangle through its camera.
        const rightStart = selectionAxis === "x" ? null : clientToDataClamped(completed.startX, completed.startY, rect, chart, "right");
        const rightEnd = selectionAxis === "x" ? null : clientToDataClamped(event.clientX, event.clientY, rect, chart, "right");
        chart.viewport.set(next);
        if (!rightStart || !rightEnd) return;
        const rightYMin = Math.min(rightStart[1], rightEnd[1]);
        const rightYMax = Math.max(rightStart[1], rightEnd[1]);
        if (rightYMax > rightYMin) chart.viewport.set({ yMin: rightYMin, yMax: rightYMax }, "right", USER_VIEWPORT);
      };

      const onPointerCancel = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const completed = drag;
        drag = null;
        releasePointer(completed.captureTarget, event.pointerId);
        hideSelection();
      };

      const wheelOnAxis = (event: WheelEvent, zoomAxis: ZoomAxis, targetYAxis?: SeriesYAxis): void => {
        if (options.wheelZoom === false) return;
        captureResetViewport();
        event.preventDefault();
        const rect = chart.layout.plotRect();

        if (options.trackpadPan !== false && isLikelyTrackpadPan(event)) {
          const sensitivity = options.trackpadPanSensitivity ?? 1.6;
          const panIntent = directPan({
            dx: rect.width > 0 && zoomAxis !== "y" ? (event.deltaX * sensitivity) / rect.width : 0,
            dy: rect.height > 0 && zoomAxis !== "x" ? (-event.deltaY * sensitivity) / rect.height : 0,
          }, zoomAxis, targetYAxis ?? "left");
          if ((Math.abs(panIntent.dx) < 1e-6 && Math.abs(panIntent.dy) < 1e-6)) return;
          chart.viewport.pan(panIntent, targetYAxis, USER_VIEWPORT);
          return;
        }

        const factor = wheelZoomFactor(
          event,
          rect.height,
          options.wheelZoomSensitivity ?? 0.001,
          options.trackpadPinchSensitivity ?? 0.0045,
        );
        const cx = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
        const cy = rect.height > 0 ? 1 - (event.clientY - rect.top) / rect.height : 0.5;
        if (Math.abs(1 - factor) < 1e-4) return;
        chart.viewport.zoom(directZoom({ factor, cx, cy, axis: zoomAxis }, targetYAxis ?? "left"), targetYAxis, USER_VIEWPORT);
      };

      const resetToCapturedViewport = (): void => {
        const target = options.resetViewport?.() ?? resetViewport ?? normalizeViewport(chart.viewport.get());
        chart.viewport.set(target, undefined, USER_VIEWPORT);
        if (resetRightViewport) chart.viewport.set({ yMin: resetRightViewport.yMin, yMax: resetRightViewport.yMax }, "right", USER_VIEWPORT);
        if (options.resumeFollowOnReset !== false) chart.viewport.setFollowXPaused(false);
      };

      const onDoubleClick = (event: MouseEvent): void => {
        if (options.doubleClickReset === false) return;
        event.preventDefault();
        resetToCapturedViewport();
      };

      const touchTargetConfig = (surface: GestureSurface): { axis: ZoomAxis; yAxis?: SeriesYAxis } =>
        surface === "plot" ? { axis: resolveAxis(options.axis) } : axisGestureConfig(surface);

      const onTouchStart = (event: TouchEvent, surface: GestureSurface): void => {
        if (event.touches.length === 0) return;
        const config = touchTargetConfig(surface);
        captureResetViewport();
        if (event.touches.length >= 2 && options.pinchZoom !== false) {
          event.preventDefault();
          const distance = touchDistance(event.touches);
          if (distance && distance > 0) touchGesture = { mode: "pinch", axis: config.axis, yAxis: config.yAxis, lastDistance: distance };
          return;
        }
        if (options.touchPan === false) return;
        const touch = event.touches.item(0);
        if (!touch) return;
        event.preventDefault();
        touchGesture = { mode: "pan", axis: config.axis, yAxis: config.yAxis, lastX: touch.clientX, lastY: touch.clientY };
      };

      const onTouchMove = (event: TouchEvent): void => {
        if (!touchGesture) return;
        const rect = chart.layout.plotRect();
        if (event.touches.length >= 2 && options.pinchZoom !== false) {
          event.preventDefault();
          const distance = touchDistance(event.touches);
          const center = touchCenter(event.touches);
          if (!distance || !center) return;
          if (touchGesture.mode !== "pinch" || touchGesture.lastDistance <= 0) {
            touchGesture = { mode: "pinch", axis: touchGesture.axis, yAxis: touchGesture.yAxis, lastDistance: distance };
            return;
          }
          const factor = distance / touchGesture.lastDistance;
          const cx = rect.width > 0 ? (center.x - rect.left) / rect.width : 0.5;
          const cy = rect.height > 0 ? 1 - (center.y - rect.top) / rect.height : 0.5;
          chart.viewport.zoom(directZoom({ factor, cx, cy, axis: touchGesture.axis }, touchGesture.yAxis ?? "left"), touchGesture.yAxis, USER_VIEWPORT);
          touchGesture = { mode: "pinch", axis: touchGesture.axis, yAxis: touchGesture.yAxis, lastDistance: distance };
          return;
        }
        if (touchGesture.mode !== "pan" || options.touchPan === false) return;
        const touch = event.touches.item(0);
        if (!touch) return;
        event.preventDefault();
        const dx = rect.width > 0 ? (touchGesture.lastX - touch.clientX) / rect.width : 0;
        const dy = rect.height > 0 ? (touch.clientY - touchGesture.lastY) / rect.height : 0;
        chart.viewport.pan(directPan({ dx, dy }, touchGesture.axis, touchGesture.yAxis ?? "left"), touchGesture.yAxis, USER_VIEWPORT);
        touchGesture = { mode: "pan", axis: touchGesture.axis, yAxis: touchGesture.yAxis, lastX: touch.clientX, lastY: touch.clientY };
      };

      const onTouchEnd = (event: TouchEvent, surface: GestureSurface): void => {
        if (event.touches.length >= 2 && options.pinchZoom !== false && touchGesture) {
          const distance = touchDistance(event.touches);
          if (distance && distance > 0) touchGesture = { mode: "pinch", axis: touchGesture.axis, yAxis: touchGesture.yAxis, lastDistance: distance };
          return;
        }
        if (event.touches.length === 1 && options.touchPan !== false && touchGesture) {
          const touch = event.touches.item(0);
          if (touch) touchGesture = { mode: "pan", axis: touchGesture.axis, yAxis: touchGesture.yAxis, lastX: touch.clientX, lastY: touch.clientY };
          return;
        }
        const completedOnCanvas = touchGesture !== null && (surface === "plot" || !touchGesture.yAxis && touchGesture.axis === resolveAxis(options.axis));
        touchGesture = null;
        if (!completedOnCanvas || options.doubleTapReset === false || event.changedTouches.length !== 1) return;
        const touch = event.changedTouches.item(0);
        if (!touch) return;
        const now = event.timeStamp;
        if (now - lastTapTime <= 320 && Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY) <= 24) {
          event.preventDefault();
          resetToCapturedViewport();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
        lastTapX = touch.clientX;
        lastTapY = touch.clientY;
      };

      const listenTouch = (surface: GestureSurface): void => {
        cleanups.push(
          chart.dom.listen(surface, "touchstart", (event) => onTouchStart(event, surface), { passive: false }),
          chart.dom.listen(surface, "touchmove", onTouchMove, { passive: false }),
          chart.dom.listen(surface, "touchend", (event) => onTouchEnd(event, surface), { passive: false }),
          chart.dom.listen(surface, "touchcancel", (event) => onTouchEnd(event, surface), { passive: false }),
        );
      };

      cleanups.push(
        chart.dom.listen("plot", "pointerdown", onPlotPointerDown),
        chart.dom.listen("plot", "wheel", (event) => wheelOnAxis(event, resolveAxis(options.axis)), { passive: false }),
        chart.dom.listen("plot", "dblclick", onDoubleClick),
      );
      listenTouch("plot");

      if (axisInteractions) {
        for (const surface of AXIS_SURFACES) {
          const config = axisGestureConfig(surface);
          cleanups.push(
            chart.dom.listen(surface, "pointerdown", (event) => onAxisPointerDown(event, surface)),
            chart.dom.listen(surface, "pointerenter", () => setAxisHovered(surface, true)),
            chart.dom.listen(surface, "pointerleave", () => setAxisHovered(surface, false)),
            chart.dom.listen(surface, "wheel", (event) => wheelOnAxis(event, config.axis, config.yAxis), { passive: false }),
            chart.dom.listen(surface, "dblclick", onDoubleClick),
          );
          listenTouch(surface);
        }
      }

      for (const surface of ["plot", ...AXIS_SURFACES] as const) {
        cleanups.push(
          chart.dom.listen(surface, "pointermove", onPointerMove),
          chart.dom.listen(surface, "pointerup", onPointerUp),
          chart.dom.listen(surface, "pointercancel", onPointerCancel),
        );
      }

      return () => {
        for (const undo of hoverUndo.values()) undo();
        hoverUndo.clear();
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
        drag = null;
        touchGesture = null;
      };
    },
  };
}
