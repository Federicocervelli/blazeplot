import type { Viewport } from "../core/types.js";
import type { PanIntent, ViewportPolicy, ZoomAxis, ZoomIntent } from "../interaction/types.js";
import type { Chart, ChartPlugin } from "./Chart.js";

export type InteractionAxisOption = ZoomAxis | (() => ZoomAxis);

export interface InteractionsPluginOptions {
  readonly axis?: InteractionAxisOption;
  readonly viewportPolicy?: ViewportPolicy;
  readonly boxZoom?: boolean;
  readonly wheelZoom?: boolean;
  readonly axisInteractions?: boolean;
  readonly axisHover?: boolean;
  readonly axisHoverColor?: string;
  readonly axisHoverFilter?: string;
  readonly shiftDragPan?: boolean;
  readonly doubleClickReset?: boolean;
  readonly minDragDistancePx?: number;
  readonly selectionFill?: string;
  readonly selectionStroke?: string;
}

let nextInteractionsPluginId = 1;

type InteractionTarget = HTMLCanvasElement | HTMLElement;

type DragState =
  | {
      readonly mode: "pan";
      readonly pointerId: number;
      readonly axis: ZoomAxis;
      readonly target: InteractionTarget;
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
      const minDragDistancePx = options.minDragDistancePx ?? 6;
      const canvas = chart.canvas;
      const xAxis = chart.xAxisElement;
      const yAxis = chart.yAxisElement;
      const selection = document.createElement("div");
      const axisHoverClass = `blazeplot-axis-hover-${nextInteractionsPluginId++}`;
      const axisHoverStyle = document.createElement("style");
      const originalXAxisPointerEvents = xAxis.style.pointerEvents;
      const originalYAxisPointerEvents = yAxis.style.pointerEvents;
      const originalXAxisCursor = xAxis.style.cursor;
      const originalYAxisCursor = yAxis.style.cursor;
      const originalXAxisFilter = xAxis.style.filter;
      const originalYAxisFilter = yAxis.style.filter;
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

      axisHoverStyle.textContent = `.${axisHoverClass} > div { color: ${options.axisHoverColor ?? "#f8fafc"} !important; }`;
      if (options.axisInteractions !== false && options.axisHover !== false) {
        chart.rootElement.appendChild(axisHoverStyle);
      }

      if (options.axisInteractions !== false) {
        xAxis.style.pointerEvents = "auto";
        yAxis.style.pointerEvents = "auto";
        xAxis.style.cursor = "ew-resize";
        yAxis.style.cursor = "ns-resize";
      }

      const captureResetViewport = (): void => {
        resetViewport ??= normalizeViewport(chart.getViewport());
      };

      const applyPanPolicy = (intent: PanIntent, panAxis: ZoomAxis): PanIntent | null => {
        const constrained = constrainPan(intent, panAxis);
        return options.viewportPolicy?.beforePan?.(chart.getCamera(), constrained) ?? constrained;
      };

      const applyZoomPolicy = (intent: ZoomIntent): ZoomIntent | null => {
        return options.viewportPolicy?.beforeZoom?.(chart.getCamera(), intent) ?? intent;
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
        }
      };

      const onXAxisPointerEnter = (): void => setAxisHovered(xAxis, true);
      const onXAxisPointerLeave = (): void => setAxisHovered(xAxis, false);
      const onYAxisPointerEnter = (): void => setAxisHovered(yAxis, true);
      const onYAxisPointerLeave = (): void => setAxisHovered(yAxis, false);

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

      const beginPan = (event: PointerEvent, panAxis: ZoomAxis, target: InteractionTarget): void => {
        captureResetViewport();
        event.preventDefault();
        if (target !== canvas) setAxisHovered(target, true);
        target.setPointerCapture(event.pointerId);
        drag = {
          mode: "pan",
          pointerId: event.pointerId,
          axis: panAxis,
          target,
          lastX: event.clientX,
          lastY: event.clientY,
        };
      };

      const onCanvasPointerDown = (event: PointerEvent): void => {
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
        if (drag || event.button !== 0 || options.axisInteractions === false) return;
        beginPan(event, "x", xAxis);
      };

      const onYAxisPointerDown = (event: PointerEvent): void => {
        if (drag || event.button !== 0 || options.axisInteractions === false) return;
        beginPan(event, "y", yAxis);
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();

        if (drag.mode === "pan") {
          const rect = canvas.getBoundingClientRect();
          const dx = rect.width > 0 ? (drag.lastX - event.clientX) / rect.width : 0;
          const dy = rect.height > 0 ? (event.clientY - drag.lastY) / rect.height : 0;
          const intent = applyPanPolicy({ dx, dy }, drag.axis);
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

      const wheelOnAxis = (event: WheelEvent, zoomAxis: ZoomAxis): void => {
        if (options.wheelZoom === false) return;
        captureResetViewport();
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        const rect = canvas.getBoundingClientRect();
        const cx = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
        const cy = rect.height > 0 ? 1 - (event.clientY - rect.top) / rect.height : 0.5;
        const intent = applyZoomPolicy({ factor, cx, cy, axis: zoomAxis });
        if (intent) chart.zoom(intent);
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
        wheelOnAxis(event, "y");
      };

      const onDoubleClick = (event: MouseEvent): void => {
        if (options.doubleClickReset === false) return;
        event.preventDefault();
        const target = resetViewport ?? normalizeViewport(chart.getViewport());
        chart.setViewport(target);
      };

      const pointerTargets = [canvas, xAxis, yAxis];
      canvas.addEventListener("pointerdown", onCanvasPointerDown);
      canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
      canvas.addEventListener("dblclick", onDoubleClick);

      if (options.axisInteractions !== false) {
        xAxis.addEventListener("pointerdown", onXAxisPointerDown);
        yAxis.addEventListener("pointerdown", onYAxisPointerDown);
        xAxis.addEventListener("pointerenter", onXAxisPointerEnter);
        xAxis.addEventListener("pointerleave", onXAxisPointerLeave);
        yAxis.addEventListener("pointerenter", onYAxisPointerEnter);
        yAxis.addEventListener("pointerleave", onYAxisPointerLeave);
        xAxis.addEventListener("wheel", onXAxisWheel, { passive: false });
        yAxis.addEventListener("wheel", onYAxisWheel, { passive: false });
        xAxis.addEventListener("dblclick", onDoubleClick);
        yAxis.addEventListener("dblclick", onDoubleClick);
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
        xAxis.removeEventListener("pointerdown", onXAxisPointerDown);
        yAxis.removeEventListener("pointerdown", onYAxisPointerDown);
        xAxis.removeEventListener("pointerenter", onXAxisPointerEnter);
        xAxis.removeEventListener("pointerleave", onXAxisPointerLeave);
        yAxis.removeEventListener("pointerenter", onYAxisPointerEnter);
        yAxis.removeEventListener("pointerleave", onYAxisPointerLeave);
        xAxis.removeEventListener("wheel", onXAxisWheel);
        yAxis.removeEventListener("wheel", onYAxisWheel);
        xAxis.removeEventListener("dblclick", onDoubleClick);
        yAxis.removeEventListener("dblclick", onDoubleClick);
        for (const target of pointerTargets) {
          target.removeEventListener("pointermove", onPointerMove);
          target.removeEventListener("pointerup", onPointerUp);
          target.removeEventListener("pointercancel", onPointerCancel);
        }
        xAxis.style.pointerEvents = originalXAxisPointerEvents;
        yAxis.style.pointerEvents = originalYAxisPointerEvents;
        xAxis.style.cursor = originalXAxisCursor;
        yAxis.style.cursor = originalYAxisCursor;
        xAxis.style.filter = originalXAxisFilter;
        yAxis.style.filter = originalYAxisFilter;
        xAxis.classList.remove(axisHoverClass);
        yAxis.classList.remove(axisHoverClass);
        axisHoverStyle.remove();
        selection.remove();
      };
    },
  };
}
