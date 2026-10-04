import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { ChartPlugin, ChartPluginContext } from "./Chart.js";
import { clamp, createOverlayLayer } from "./OverlayUtils.js";

/** Geometry captured by the selection plugin. */
export type SelectionMode = "x-range" | "y-range" | "xy";
/** Lifecycle event emitted by a selection plugin. */
export type SelectionEventType = "start" | "update" | "commit" | "clear";

/** Selected plot-coordinate bounds in CSS pixels. */
export interface SelectionPlotBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Current or committed selection. Pass it to `exportChartData(chart, { range: selection })`
 * from `blazeplot/export` to collect the selected samples.
 */
export interface SelectionState {
  readonly mode: SelectionMode;
  readonly yAxis: SeriesYAxis;
  /** Selected data-domain bounds; unselected dimensions span the current viewport. */
  readonly bounds: Viewport;
  readonly plotBounds: SelectionPlotBounds;
}

/** Event payload emitted during selection changes. */
export interface SelectionEvent {
  readonly type: SelectionEventType;
  readonly selection: SelectionState | null;
  readonly sourceEvent?: PointerEvent | KeyboardEvent;
}

/** Options for drag-to-select chart interaction. */
export interface SelectionPluginOptions {
  /** Defaults to `"xy"`. */
  readonly mode?: SelectionMode;
  /** Y axis whose domain the selection measures. Defaults to `"left"`. */
  readonly yAxis?: SeriesYAxis;
  /** Drags shorter than this are ignored. Defaults to 4. */
  readonly minDragDistancePx?: number;
  readonly className?: string;
  /** Rectangle fill. Defaults to `theme.selectionFillColor`. */
  readonly fill?: string;
  /** Rectangle border. Defaults to `theme.selectionStrokeColor`. */
  readonly stroke?: string;
  readonly zIndex?: number;
  /** Clear the selection with Escape. Defaults to true. */
  readonly clearOnEscape?: boolean;
  /** Called on `start`, `update`, `commit`, and `clear`; switch on `event.type`. */
  readonly onChange?: (event: SelectionEvent) => void;
}

/** Selection plugin with imperative state access. */
export interface SelectionPlugin extends ChartPlugin {
  clear(): void;
  getSelection(): SelectionState | null;
}

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  currentX: number;
  currentY: number;
}

/** Convert a client point, clamped into the plot, to data coordinates using the axis scales. */
function clampedClientToData(chart: ChartPluginContext, clientX: number, clientY: number, rect: DOMRect, yAxis: SeriesYAxis): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return chart.clientToData(
    rect.left + clamp(clientX - rect.left, 0, rect.width),
    rect.top + clamp(clientY - rect.top, 0, rect.height),
    yAxis,
  );
}

function normalizeBounds(a: [number, number], b: [number, number], current: Viewport, mode: SelectionMode): Viewport {
  return {
    xMin: mode === "y-range" ? current.xMin : Math.min(a[0], b[0]),
    xMax: mode === "y-range" ? current.xMax : Math.max(a[0], b[0]),
    yMin: mode === "x-range" ? current.yMin : Math.min(a[1], b[1]),
    yMax: mode === "x-range" ? current.yMax : Math.max(a[1], b[1]),
  };
}

function plotBoundsForDrag(drag: DragState, rect: DOMRect, mode: SelectionMode): SelectionPlotBounds {
  const x0 = clamp(drag.startX - rect.left, 0, rect.width);
  const y0 = clamp(drag.startY - rect.top, 0, rect.height);
  const x1 = clamp(drag.currentX - rect.left, 0, rect.width);
  const y1 = clamp(drag.currentY - rect.top, 0, rect.height);
  return {
    left: mode === "y-range" ? 0 : Math.min(x0, x1),
    top: mode === "x-range" ? 0 : Math.min(y0, y1),
    width: mode === "y-range" ? rect.width : Math.abs(x1 - x0),
    height: mode === "x-range" ? rect.height : Math.abs(y1 - y0),
  };
}

/** Create a plugin that lets users select chart ranges by dragging. */
export function selectionPlugin(options: SelectionPluginOptions = {}): SelectionPlugin {
  const mode = options.mode ?? "xy";
  const yAxis = options.yAxis ?? "left";
  const minDragDistancePx = options.minDragDistancePx ?? 4;
  let chartRef: ChartPluginContext | null = null;
  let overlay: HTMLDivElement | null = null;
  let drag: DragState | null = null;
  let committedSelection: SelectionState | null = null;

  const emit = (type: SelectionEventType, selection: SelectionState | null, sourceEvent?: PointerEvent | KeyboardEvent): void => {
    options.onChange?.({ type, selection, sourceEvent });
  };

  const setOverlay = (plotBounds: SelectionPlotBounds | null): void => {
    if (!overlay) return;
    if (!plotBounds || plotBounds.width <= 0 || plotBounds.height <= 0) {
      overlay.style.display = "none";
      return;
    }
    overlay.style.left = `${plotBounds.left}px`;
    overlay.style.top = `${plotBounds.top}px`;
    overlay.style.width = `${plotBounds.width}px`;
    overlay.style.height = `${plotBounds.height}px`;
    overlay.style.display = "block";
  };

  const buildSelection = (chart: ChartPluginContext, state: DragState): SelectionState | null => {
    const rect = chart.canvas.getBoundingClientRect();
    const start = clampedClientToData(chart, state.startX, state.startY, rect, yAxis);
    const end = clampedClientToData(chart, state.currentX, state.currentY, rect, yAxis);
    if (!start || !end) return null;
    return {
      mode,
      yAxis,
      bounds: normalizeBounds(start, end, chart.getViewport(yAxis), mode),
      plotBounds: plotBoundsForDrag(state, rect, mode),
    };
  };

  const clearSelection = (sourceEvent?: KeyboardEvent): void => {
    committedSelection = null;
    drag = null;
    setOverlay(null);
    chartRef?.emitSelect(null);
    emit("clear", null, sourceEvent);
  };

  return {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      const canvas = chart.canvas;
      overlay = createOverlayLayer(options.className ?? "blazeplot-selection-brush", { zIndex: options.zIndex ?? 26 });
      const applyTheme = (): void => {
        if (!overlay) return;
        overlay.style.border = `1px solid ${options.stroke ?? chart.theme.selectionStrokeColor}`;
        overlay.style.background = options.fill ?? chart.theme.selectionFillColor;
      };
      applyTheme();
      chart.plotElement.appendChild(overlay);

      const onPointerDown = (event: PointerEvent): void => {
        if (drag || event.button !== 0) return;
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          currentX: event.clientX,
          currentY: event.clientY,
        };
        const selection = buildSelection(chart, drag);
        setOverlay(selection?.plotBounds ?? null);
        emit("start", selection, event);
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        drag.currentX = event.clientX;
        drag.currentY = event.clientY;
        const selection = buildSelection(chart, drag);
        setOverlay(selection?.plotBounds ?? null);
        emit("update", selection, event);
      };

      const finishDrag = (event: PointerEvent, commit: boolean): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        const completed = drag;
        drag = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

        const dx = completed.currentX - completed.startX;
        const dy = completed.currentY - completed.startY;
        const selection = commit && Math.hypot(dx, dy) >= minDragDistancePx ? buildSelection(chart, completed) : null;
        if (!selection || selection.bounds.xMax <= selection.bounds.xMin || selection.bounds.yMax <= selection.bounds.yMin) {
          setOverlay(committedSelection?.plotBounds ?? null);
          return;
        }

        committedSelection = selection;
        setOverlay(selection.plotBounds);
        chart.emitSelect(selection);
        emit("commit", selection, event);
      };

      const onPointerUp = (event: PointerEvent): void => finishDrag(event, true);
      const onPointerCancel = (event: PointerEvent): void => finishDrag(event, false);
      // Escape belongs to this chart only when the latest press or focus move landed in it
      // (pressing the canvas does not move focus, so focus alone cannot tell).
      let escapeArmed = false;
      const armEscape = (event: Event): void => {
        escapeArmed = event.composedPath().includes(chart.rootElement);
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (options.clearOnEscape === false || event.key !== "Escape" || !escapeArmed || (!committedSelection && !drag)) return;
        clearSelection(event);
      };
      // Keep the committed rectangle on its data bounds as the chart pans, zooms, or resizes.
      const onRender = (): void => {
        if (!committedSelection || drag) return;
        const rect = canvas.getBoundingClientRect();
        const { bounds } = committedSelection;
        const [x0, y0] = chart.dataToPlot(bounds.xMin, bounds.yMin, yAxis);
        const [x1, y1] = chart.dataToPlot(bounds.xMax, bounds.yMax, yAxis);
        const corners = { pointerId: 0, startX: rect.left + x0, startY: rect.top + y0, currentX: rect.left + x1, currentY: rect.top + y1 };
        committedSelection = { ...committedSelection, plotBounds: plotBoundsForDrag(corners, rect, mode) };
        setOverlay(committedSelection.plotBounds);
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      globalThis.addEventListener("pointerdown", armEscape, { capture: true });
      globalThis.addEventListener("focusin", armEscape, { capture: true });
      globalThis.addEventListener("keydown", onKeyDown);
      const unsubscribeTheme = chart.subscribe("themechange", applyTheme);
      const unsubscribeRender = chart.subscribe("render", onRender);

      return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        globalThis.removeEventListener("pointerdown", armEscape, { capture: true });
        globalThis.removeEventListener("focusin", armEscape, { capture: true });
        globalThis.removeEventListener("keydown", onKeyDown);
        unsubscribeTheme();
        unsubscribeRender();
        overlay?.remove();
        overlay = null;
        chartRef = null;
        drag = null;
        committedSelection = null;
      };
    },
    clear(): void {
      clearSelection();
    },
    getSelection(): SelectionState | null {
      return committedSelection;
    },
  };
}
