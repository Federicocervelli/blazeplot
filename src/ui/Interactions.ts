import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { PanIntent, ViewportPolicy, ZoomAxis, ZoomIntent } from "../interaction/types.js";
import type { ChartPlugin, ChartPluginContext } from "./Chart.js";

/** Static or dynamic axis choice for wheel and drag interactions. */
export type InteractionAxisOption = ZoomAxis | (() => ZoomAxis);

/** Options for mouse, wheel, touch, and keyboard chart interactions. */
export interface InteractionsPluginOptions {
  readonly axis?: InteractionAxisOption;
  readonly viewportPolicy?: ViewportPolicy;
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
  readonly selectionFill?: string;
  readonly selectionStroke?: string;
}

let nextInteractionsPluginId = 1;

type InteractionTarget = HTMLCanvasElement | HTMLElement;

type TouchGestureState =
  | { readonly mode: "pan"; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastX: number; lastY: number }
  | { readonly mode: "pinch"; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastDistance: number };

type DragState =
  | {
      readonly mode: "pan";
      readonly pointerId: number;
      readonly axis: ZoomAxis;
      readonly target: InteractionTarget;
      readonly yAxis?: SeriesYAxis;
      lastX: number;
      lastY: number;
    }
  | {
      readonly mode: "select";
      readonly pointerId: number;
      readonly target: HTMLCanvasElement;
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
  rect: DOMRect,
  viewport: Viewport,
): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;

  const plotX = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const plotY = Math.max(0, Math.min(clientY - rect.top, rect.height));
  return [
    viewport.xMin + (plotX / rect.width) * (viewport.xMax - viewport.xMin),
    viewport.yMax - (plotY / rect.height) * (viewport.yMax - viewport.yMin),
  ];
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
      const canvas = chart.canvas;
      const xAxis = chart.xAxisElement;
      const yAxis = chart.yAxisElement;
      const y2Axis = chart.y2AxisElement;
      const selection = document.createElement("div");
      const axisHoverClass = `blazeplot-axis-hover-${nextInteractionsPluginId++}`;
      const axisHoverStyle = document.createElement("style");
      const originalXAxisPointerEvents = xAxis.style.pointerEvents;
      const originalYAxisPointerEvents = yAxis.style.pointerEvents;
      const originalY2AxisPointerEvents = y2Axis.style.pointerEvents;
      const originalXAxisCursor = xAxis.style.cursor;
      const originalCanvasTouchAction = canvas.style.touchAction;
      const originalXAxisTouchAction = xAxis.style.touchAction;
      const originalYAxisTouchAction = yAxis.style.touchAction;
      const originalY2AxisTouchAction = y2Axis.style.touchAction;
      const originalYAxisCursor = yAxis.style.cursor;
      const originalY2AxisCursor = y2Axis.style.cursor;
      const originalXAxisFilter = xAxis.style.filter;
      const originalYAxisFilter = yAxis.style.filter;
      const originalY2AxisFilter = y2Axis.style.filter;
      let drag: DragState | null = null;
      let touchGesture: TouchGestureState | null = null;
      let resetViewport: Viewport | null = null;
      let lastTapTime = 0;
      let lastTapX = 0;
      let lastTapY = 0;

      selection.className = "blazeplot-selection";
      selection.style.position = "absolute";
      selection.style.display = "none";
      selection.style.pointerEvents = "none";
      selection.style.zIndex = "24";
      selection.style.border = `1px solid ${options.selectionStroke ?? "rgba(147, 197, 253, 0.95)"}`;
      selection.style.background = options.selectionFill ?? "rgba(59, 130, 246, 0.18)";
      chart.plotElement.appendChild(selection);

      axisHoverStyle.textContent = `.${axisHoverClass} > div { color: ${options.axisHoverColor ?? "#f8fafc"} !important; }`;
      if (options.axisInteractions !== false && options.axisHover !== false) {
        chart.rootElement.appendChild(axisHoverStyle);
      }

      if (options.touchPan !== false || options.pinchZoom !== false) {
        canvas.style.touchAction = "none";
        if (options.axisInteractions !== false) {
          xAxis.style.touchAction = "none";
          yAxis.style.touchAction = "none";
          y2Axis.style.touchAction = "none";
        }
      }

      if (options.axisInteractions !== false) {
        xAxis.style.pointerEvents = "auto";
        yAxis.style.pointerEvents = "auto";
        y2Axis.style.pointerEvents = "auto";
        xAxis.style.cursor = "ew-resize";
        yAxis.style.cursor = "ns-resize";
        y2Axis.style.cursor = "ns-resize";
      }

      const captureResetViewport = (): void => {
        resetViewport ??= normalizeViewport(chart.getViewport());
      };

      const applyPanPolicy = (intent: PanIntent, panAxis: ZoomAxis, targetYAxis: SeriesYAxis = "left"): PanIntent | null => {
        const constrained = constrainPan(intent, panAxis);
        return options.viewportPolicy?.beforePan?.(chart.getCamera(targetYAxis), constrained) ?? constrained;
      };

      const applyZoomPolicy = (intent: ZoomIntent, targetYAxis: SeriesYAxis = "left"): ZoomIntent | null => {
        return options.viewportPolicy?.beforeZoom?.(chart.getCamera(targetYAxis), intent) ?? intent;
      };

      const hideSelection = (): void => {
        selection.style.display = "none";
      };

      const setAxisHovered = (target: HTMLElement, hovered: boolean): void => {
        if (options.axisHover === false) return;
        const filter = hovered ? options.axisHoverFilter ?? "brightness(1.18)" : null;
        target.classList.toggle(axisHoverClass, hovered);
        if (target === xAxis) {
          xAxis.style.filter = filter ?? originalXAxisFilter;
        } else if (target === yAxis) {
          yAxis.style.filter = filter ?? originalYAxisFilter;
        } else if (target === y2Axis) {
          y2Axis.style.filter = filter ?? originalY2AxisFilter;
        }
      };

      const onXAxisPointerEnter = (): void => setAxisHovered(xAxis, true);
      const onXAxisPointerLeave = (): void => setAxisHovered(xAxis, false);
      const onYAxisPointerEnter = (): void => setAxisHovered(yAxis, true);
      const onYAxisPointerLeave = (): void => setAxisHovered(yAxis, false);
      const onY2AxisPointerEnter = (): void => setAxisHovered(y2Axis, true);
      const onY2AxisPointerLeave = (): void => setAxisHovered(y2Axis, false);

      const updateSelection = (state: Extract<DragState, { mode: "select" }>): void => {
        const rect = canvas.getBoundingClientRect();
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

      const beginPan = (event: PointerEvent, panAxis: ZoomAxis, target: InteractionTarget, targetYAxis?: SeriesYAxis): void => {
        captureResetViewport();
        event.preventDefault();
        if (target !== canvas) setAxisHovered(target, true);
        target.setPointerCapture(event.pointerId);
        drag = {
          mode: "pan",
          pointerId: event.pointerId,
          axis: panAxis,
          target,
          yAxis: targetYAxis,
          lastX: event.clientX,
          lastY: event.clientY,
        };
      };

      const onCanvasPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "touch") return;
        if (drag || event.button !== 0) return;

        if (event.shiftKey && options.shiftDragPan !== false) {
          beginPan(event, resolveAxis(options.axis), canvas);
          return;
        }

        if (options.boxZoom === false) return;
        captureResetViewport();
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        drag = {
          mode: "select",
          pointerId: event.pointerId,
          target: canvas,
          startX: event.clientX,
          startY: event.clientY,
          currentX: event.clientX,
          currentY: event.clientY,
        };
        updateSelection(drag);
      };

      const onXAxisPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "touch") return;
        if (drag || event.button !== 0 || options.axisInteractions === false) return;
        beginPan(event, "x", xAxis);
      };

      const onYAxisPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "touch") return;
        if (drag || event.button !== 0 || options.axisInteractions === false) return;
        beginPan(event, "y", yAxis, "left");
      };

      const onY2AxisPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "touch") return;
        if (drag || event.button !== 0 || options.axisInteractions === false) return;
        beginPan(event, "y", y2Axis, "right");
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();

        if (drag.mode === "pan") {
          const rect = canvas.getBoundingClientRect();
          const dx = rect.width > 0 ? (drag.lastX - event.clientX) / rect.width : 0;
          const dy = rect.height > 0 ? (event.clientY - drag.lastY) / rect.height : 0;
          const intent = applyPanPolicy({ dx, dy }, drag.axis, drag.yAxis ?? "left");
          if (intent) {
            if (drag.yAxis && drag.axis === "y") {
              const next = chart.getCamera(drag.yAxis).clone();
              next.pan({ dx: 0, dy: intent.dy });
              chart.setYViewport(drag.yAxis, { yMin: next.yMin, yMax: next.yMax });
            } else {
              chart.pan(intent);
            }
          }
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
        if (completed.target.hasPointerCapture(event.pointerId)) completed.target.releasePointerCapture(event.pointerId);
        hideSelection();

        if (completed.mode !== "select") return;

        const dx = event.clientX - completed.startX;
        const dy = event.clientY - completed.startY;
        if (Math.hypot(dx, dy) < minDragDistancePx) return;

        const current = chart.getViewport();
        const rect = canvas.getBoundingClientRect();
        const start = clientToDataClamped(completed.startX, completed.startY, rect, current);
        const end = clientToDataClamped(event.clientX, event.clientY, rect, current);
        if (!start || !end) return;

        const next = applySelectionAxis(current, start, end, resolveAxis(options.axis));
        if (next.xMax > next.xMin && next.yMax > next.yMin) chart.setViewport(next);
      };

      const onPointerCancel = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const completed = drag;
        drag = null;
        if (completed.target.hasPointerCapture(event.pointerId)) completed.target.releasePointerCapture(event.pointerId);
        hideSelection();
      };

      const wheelOnAxis = (event: WheelEvent, zoomAxis: ZoomAxis, targetYAxis?: SeriesYAxis): void => {
        if (options.wheelZoom === false) return;
        captureResetViewport();
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();

        if (options.trackpadPan !== false && isLikelyTrackpadPan(event)) {
          const sensitivity = options.trackpadPanSensitivity ?? 1.6;
          const panIntent = applyPanPolicy({
            dx: rect.width > 0 && zoomAxis !== "y" ? (event.deltaX * sensitivity) / rect.width : 0,
            dy: rect.height > 0 && zoomAxis !== "x" ? (-event.deltaY * sensitivity) / rect.height : 0,
          }, zoomAxis, targetYAxis ?? "left");
          if (!panIntent || (Math.abs(panIntent.dx) < 1e-6 && Math.abs(panIntent.dy) < 1e-6)) return;
          if (targetYAxis && zoomAxis === "y") {
            const next = chart.getCamera(targetYAxis).clone();
            next.pan({ dx: 0, dy: panIntent.dy });
            chart.setYViewport(targetYAxis, { yMin: next.yMin, yMax: next.yMax });
          } else {
            chart.pan(panIntent);
          }
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
        const intent = applyZoomPolicy({ factor, cx, cy, axis: zoomAxis }, targetYAxis ?? "left");
        if (!intent) return;
        if (targetYAxis && zoomAxis === "y") {
          const next = chart.getCamera(targetYAxis).clone();
          next.zoom(intent);
          chart.setYViewport(targetYAxis, { yMin: next.yMin, yMax: next.yMax });
        } else {
          chart.zoom(intent);
        }
      };

      const onCanvasWheel = (event: WheelEvent): void => {
        wheelOnAxis(event, resolveAxis(options.axis));
      };

      const onXAxisWheel = (event: WheelEvent): void => {
        if (options.axisInteractions === false) return;
        wheelOnAxis(event, "x");
      };

      const onYAxisWheel = (event: WheelEvent): void => {
        if (options.axisInteractions === false) return;
        wheelOnAxis(event, "y", "left");
      };

      const onY2AxisWheel = (event: WheelEvent): void => {
        if (options.axisInteractions === false) return;
        wheelOnAxis(event, "y", "right");
      };

      const resetToCapturedViewport = (): void => {
        const target = options.resetViewport?.() ?? resetViewport ?? normalizeViewport(chart.getViewport());
        chart.setViewport(target);
        if (options.resumeFollowOnReset !== false) chart.resumeLatestXFollow();
      };

      const onDoubleClick = (event: MouseEvent): void => {
        if (options.doubleClickReset === false) return;
        event.preventDefault();
        resetToCapturedViewport();
      };

      const touchTargetConfig = (target: EventTarget | null): { axis: ZoomAxis; yAxis?: SeriesYAxis } | null => {
        if (target === xAxis) return { axis: "x" };
        if (target === yAxis) return { axis: "y", yAxis: "left" };
        if (target === y2Axis) return { axis: "y", yAxis: "right" };
        if (target === canvas) return { axis: resolveAxis(options.axis) };
        return null;
      };

      const applyTouchPan = (axis: ZoomAxis, yAxis: SeriesYAxis | undefined, dx: number, dy: number): void => {
        const intent = applyPanPolicy({ dx, dy }, axis, yAxis ?? "left");
        if (!intent) return;
        if (yAxis && axis === "y") {
          const next = chart.getCamera(yAxis).clone();
          next.pan({ dx: 0, dy: intent.dy });
          chart.setYViewport(yAxis, { yMin: next.yMin, yMax: next.yMax });
        } else {
          chart.pan(intent);
        }
      };

      const applyTouchZoom = (axis: ZoomAxis, yAxis: SeriesYAxis | undefined, factor: number, cx: number, cy: number): void => {
        const intent = applyZoomPolicy({ factor, cx, cy, axis }, yAxis ?? "left");
        if (!intent) return;
        if (yAxis && axis === "y") {
          const next = chart.getCamera(yAxis).clone();
          next.zoom(intent);
          chart.setYViewport(yAxis, { yMin: next.yMin, yMax: next.yMax });
        } else {
          chart.zoom(intent);
        }
      };

      const onTouchStart = (event: TouchEvent): void => {
        if (event.touches.length === 0) return;
        const config = touchTargetConfig(event.currentTarget);
        if (!config) return;
        if (event.currentTarget !== canvas && options.axisInteractions === false) return;
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
        const rect = canvas.getBoundingClientRect();
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
          applyTouchZoom(touchGesture.axis, touchGesture.yAxis, factor, cx, cy);
          touchGesture = { mode: "pinch", axis: touchGesture.axis, yAxis: touchGesture.yAxis, lastDistance: distance };
          return;
        }
        if (touchGesture.mode !== "pan" || options.touchPan === false) return;
        const touch = event.touches.item(0);
        if (!touch) return;
        event.preventDefault();
        const dx = rect.width > 0 ? (touchGesture.lastX - touch.clientX) / rect.width : 0;
        const dy = rect.height > 0 ? (touch.clientY - touchGesture.lastY) / rect.height : 0;
        applyTouchPan(touchGesture.axis, touchGesture.yAxis, dx, dy);
        touchGesture = { mode: "pan", axis: touchGesture.axis, yAxis: touchGesture.yAxis, lastX: touch.clientX, lastY: touch.clientY };
      };

      const onTouchEnd = (event: TouchEvent): void => {
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
        const completedOnCanvas = touchGesture !== null && (event.currentTarget === canvas || !touchGesture.yAxis && touchGesture.axis === resolveAxis(options.axis));
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

      const pointerTargets = [canvas, xAxis, yAxis, y2Axis];
      canvas.addEventListener("pointerdown", onCanvasPointerDown);
      canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
      canvas.addEventListener("dblclick", onDoubleClick);
      canvas.addEventListener("touchstart", onTouchStart, { passive: false });
      canvas.addEventListener("touchmove", onTouchMove, { passive: false });
      canvas.addEventListener("touchend", onTouchEnd, { passive: false });
      canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });

      if (options.axisInteractions !== false) {
        xAxis.addEventListener("pointerdown", onXAxisPointerDown);
        yAxis.addEventListener("pointerdown", onYAxisPointerDown);
        y2Axis.addEventListener("pointerdown", onY2AxisPointerDown);
        xAxis.addEventListener("pointerenter", onXAxisPointerEnter);
        xAxis.addEventListener("pointerleave", onXAxisPointerLeave);
        yAxis.addEventListener("pointerenter", onYAxisPointerEnter);
        yAxis.addEventListener("pointerleave", onYAxisPointerLeave);
        y2Axis.addEventListener("pointerenter", onY2AxisPointerEnter);
        y2Axis.addEventListener("pointerleave", onY2AxisPointerLeave);
        xAxis.addEventListener("wheel", onXAxisWheel, { passive: false });
        yAxis.addEventListener("wheel", onYAxisWheel, { passive: false });
        y2Axis.addEventListener("wheel", onY2AxisWheel, { passive: false });
        xAxis.addEventListener("dblclick", onDoubleClick);
        yAxis.addEventListener("dblclick", onDoubleClick);
        y2Axis.addEventListener("dblclick", onDoubleClick);
        xAxis.addEventListener("touchstart", onTouchStart, { passive: false });
        xAxis.addEventListener("touchmove", onTouchMove, { passive: false });
        xAxis.addEventListener("touchend", onTouchEnd, { passive: false });
        xAxis.addEventListener("touchcancel", onTouchEnd, { passive: false });
        yAxis.addEventListener("touchstart", onTouchStart, { passive: false });
        yAxis.addEventListener("touchmove", onTouchMove, { passive: false });
        yAxis.addEventListener("touchend", onTouchEnd, { passive: false });
        yAxis.addEventListener("touchcancel", onTouchEnd, { passive: false });
        y2Axis.addEventListener("touchstart", onTouchStart, { passive: false });
        y2Axis.addEventListener("touchmove", onTouchMove, { passive: false });
        y2Axis.addEventListener("touchend", onTouchEnd, { passive: false });
        y2Axis.addEventListener("touchcancel", onTouchEnd, { passive: false });
      }

      for (const target of pointerTargets) {
        target.addEventListener("pointermove", onPointerMove);
        target.addEventListener("pointerup", onPointerUp);
        target.addEventListener("pointercancel", onPointerCancel);
      }

      return () => {
        canvas.removeEventListener("pointerdown", onCanvasPointerDown);
        canvas.removeEventListener("wheel", onCanvasWheel);
        canvas.removeEventListener("dblclick", onDoubleClick);
        canvas.removeEventListener("touchstart", onTouchStart);
        canvas.removeEventListener("touchmove", onTouchMove);
        canvas.removeEventListener("touchend", onTouchEnd);
        canvas.removeEventListener("touchcancel", onTouchEnd);
        xAxis.removeEventListener("pointerdown", onXAxisPointerDown);
        yAxis.removeEventListener("pointerdown", onYAxisPointerDown);
        y2Axis.removeEventListener("pointerdown", onY2AxisPointerDown);
        xAxis.removeEventListener("pointerenter", onXAxisPointerEnter);
        xAxis.removeEventListener("pointerleave", onXAxisPointerLeave);
        yAxis.removeEventListener("pointerenter", onYAxisPointerEnter);
        yAxis.removeEventListener("pointerleave", onYAxisPointerLeave);
        y2Axis.removeEventListener("pointerenter", onY2AxisPointerEnter);
        y2Axis.removeEventListener("pointerleave", onY2AxisPointerLeave);
        xAxis.removeEventListener("wheel", onXAxisWheel);
        yAxis.removeEventListener("wheel", onYAxisWheel);
        y2Axis.removeEventListener("wheel", onY2AxisWheel);
        xAxis.removeEventListener("dblclick", onDoubleClick);
        yAxis.removeEventListener("dblclick", onDoubleClick);
        y2Axis.removeEventListener("dblclick", onDoubleClick);
        xAxis.removeEventListener("touchstart", onTouchStart);
        xAxis.removeEventListener("touchmove", onTouchMove);
        xAxis.removeEventListener("touchend", onTouchEnd);
        xAxis.removeEventListener("touchcancel", onTouchEnd);
        yAxis.removeEventListener("touchstart", onTouchStart);
        yAxis.removeEventListener("touchmove", onTouchMove);
        yAxis.removeEventListener("touchend", onTouchEnd);
        yAxis.removeEventListener("touchcancel", onTouchEnd);
        y2Axis.removeEventListener("touchstart", onTouchStart);
        y2Axis.removeEventListener("touchmove", onTouchMove);
        y2Axis.removeEventListener("touchend", onTouchEnd);
        y2Axis.removeEventListener("touchcancel", onTouchEnd);
        for (const target of pointerTargets) {
          target.removeEventListener("pointermove", onPointerMove);
          target.removeEventListener("pointerup", onPointerUp);
          target.removeEventListener("pointercancel", onPointerCancel);
        }
        xAxis.style.pointerEvents = originalXAxisPointerEvents;
        canvas.style.touchAction = originalCanvasTouchAction;
        yAxis.style.pointerEvents = originalYAxisPointerEvents;
        y2Axis.style.pointerEvents = originalY2AxisPointerEvents;
        xAxis.style.touchAction = originalXAxisTouchAction;
        yAxis.style.touchAction = originalYAxisTouchAction;
        y2Axis.style.touchAction = originalY2AxisTouchAction;
        xAxis.style.cursor = originalXAxisCursor;
        yAxis.style.cursor = originalYAxisCursor;
        y2Axis.style.cursor = originalY2AxisCursor;
        xAxis.style.filter = originalXAxisFilter;
        yAxis.style.filter = originalYAxisFilter;
        y2Axis.style.filter = originalY2AxisFilter;
        xAxis.classList.remove(axisHoverClass);
        yAxis.classList.remove(axisHoverClass);
        y2Axis.classList.remove(axisHoverClass);
        axisHoverStyle.remove();
        selection.remove();
      };
    },
  };
}
