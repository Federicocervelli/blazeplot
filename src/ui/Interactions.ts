import type { Viewport } from "../core/types.js";
import type { PanIntent, ViewportPolicy, ZoomAxis, ZoomIntent } from "../interaction/types.js";
import type { Chart, ChartPlugin } from "./Chart.js";

export interface InteractionsPluginOptions {
  readonly axis?: ZoomAxis;
  readonly viewportPolicy?: ViewportPolicy;
  readonly boxZoom?: boolean;
  readonly wheelZoom?: boolean;
  readonly shiftDragPan?: boolean;
  readonly doubleClickReset?: boolean;
  readonly minDragDistancePx?: number;
  readonly selectionFill?: string;
  readonly selectionStroke?: string;
}

type DragState =
  | {
      readonly mode: "pan";
      readonly pointerId: number;
      lastX: number;
      lastY: number;
    }
  | {
      readonly mode: "select";
      readonly pointerId: number;
      readonly startX: number;
      readonly startY: number;
      currentX: number;
      currentY: number;
    };

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

export function interactionsPlugin(options: InteractionsPluginOptions = {}): ChartPlugin {
  return {
    install(chart: Chart) {
      const axis = options.axis ?? "xy";
      const minDragDistancePx = options.minDragDistancePx ?? 6;
      const canvas = chart.canvas;
      const selection = document.createElement("div");
      let drag: DragState | null = null;
      let resetViewport: Viewport | null = null;

      selection.className = "blazeplot-selection";
      selection.style.position = "absolute";
      selection.style.display = "none";
      selection.style.pointerEvents = "none";
      selection.style.zIndex = "24";
      selection.style.border = `1px solid ${options.selectionStroke ?? "rgba(147, 197, 253, 0.95)"}`;
      selection.style.background = options.selectionFill ?? "rgba(59, 130, 246, 0.18)";
      chart.plotElement.appendChild(selection);

      const captureResetViewport = (): void => {
        resetViewport ??= normalizeViewport(chart.getViewport());
      };

      const applyPanPolicy = (intent: PanIntent): PanIntent | null => {
        const constrained = constrainPan(intent, axis);
        return options.viewportPolicy?.beforePan?.(chart.getCamera(), constrained) ?? constrained;
      };

      const applyZoomPolicy = (intent: ZoomIntent): ZoomIntent | null => {
        return options.viewportPolicy?.beforeZoom?.(chart.getCamera(), intent) ?? intent;
      };

      const hideSelection = (): void => {
        selection.style.display = "none";
      };

      const updateSelection = (state: Extract<DragState, { mode: "select" }>): void => {
        const rect = canvas.getBoundingClientRect();
        const x0 = Math.max(0, Math.min(state.startX - rect.left, rect.width));
        const y0 = Math.max(0, Math.min(state.startY - rect.top, rect.height));
        const x1 = Math.max(0, Math.min(state.currentX - rect.left, rect.width));
        const y1 = Math.max(0, Math.min(state.currentY - rect.top, rect.height));
        const left = axis === "y" ? 0 : Math.min(x0, x1);
        const top = axis === "x" ? 0 : Math.min(y0, y1);
        const width = axis === "y" ? rect.width : Math.abs(x1 - x0);
        const height = axis === "x" ? rect.height : Math.abs(y1 - y0);

        selection.style.left = `${left}px`;
        selection.style.top = `${top}px`;
        selection.style.width = `${width}px`;
        selection.style.height = `${height}px`;
        selection.style.display = "block";
      };

      const onPointerDown = (event: PointerEvent): void => {
        if (drag || event.button !== 0) return;

        if (event.shiftKey && options.shiftDragPan !== false) {
          captureResetViewport();
          event.preventDefault();
          canvas.setPointerCapture(event.pointerId);
          drag = { mode: "pan", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
          return;
        }

        if (options.boxZoom === false) return;
        captureResetViewport();
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        drag = {
          mode: "select",
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          currentX: event.clientX,
          currentY: event.clientY,
        };
        updateSelection(drag);
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();

        if (drag.mode === "pan") {
          const rect = canvas.getBoundingClientRect();
          const dx = rect.width > 0 ? (drag.lastX - event.clientX) / rect.width : 0;
          const dy = rect.height > 0 ? (event.clientY - drag.lastY) / rect.height : 0;
          const intent = applyPanPolicy({ dx, dy });
          if (intent) chart.pan(intent);
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
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
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

        const next = applySelectionAxis(current, start, end, axis);
        if (next.xMax > next.xMin && next.yMax > next.yMin) chart.setViewport(next);
      };

      const onPointerCancel = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        hideSelection();
      };

      const onWheel = (event: WheelEvent): void => {
        if (options.wheelZoom === false) return;
        captureResetViewport();
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
        const cy = rect.height > 0 ? 1 - (event.clientY - rect.top) / rect.height : 0.5;
        const intent = applyZoomPolicy({ factor, cx, cy, axis });
        if (intent) chart.zoom(intent);
      };

      const onDoubleClick = (event: MouseEvent): void => {
        if (options.doubleClickReset === false) return;
        event.preventDefault();
        const target = resetViewport ?? normalizeViewport(chart.getViewport());
        chart.setViewport(target);
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("dblclick", onDoubleClick);

      return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("dblclick", onDoubleClick);
        selection.remove();
      };
    },
  };
}
