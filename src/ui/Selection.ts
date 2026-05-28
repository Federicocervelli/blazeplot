import type { SeriesSample, SeriesYAxis, Viewport } from "../core/types.js";
import type { SeriesStore } from "../core/SeriesStore.js";
import type { ChartPlugin, ChartPluginContext, ChartSeriesState } from "./Chart.js";
import { clamp, createOverlayLayer } from "./OverlayUtils.js";

/** Geometry captured by the selection plugin. */
export type SelectionMode = "x-range" | "y-range" | "xy";
/** Lifecycle event emitted by a selection plugin. */
export type SelectionEventType = "start" | "update" | "commit" | "clear";
/** Selection phase used for collecting selected samples. */
export type SelectionSamplePhase = "commit" | "update" | "none";

/** Selected data-domain bounds. */
export interface SelectionBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** Selected plot-coordinate bounds in CSS pixels. */
export interface SelectionPlotBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Samples from one series captured by a selection. */
export interface SelectionSeriesSamples {
  readonly series: SeriesStore;
  readonly seriesIndex: number;
  readonly id?: string;
  readonly name?: string;
  readonly yAxis: SeriesYAxis;
  readonly samples: readonly SeriesSample[];
  readonly total: number;
  readonly truncated: boolean;
}

/** Current or committed selection state. */
export interface SelectionState {
  readonly mode: SelectionMode;
  readonly yAxis: SeriesYAxis;
  readonly bounds: SelectionBounds;
  readonly plotBounds: SelectionPlotBounds;
  readonly samples: readonly SelectionSeriesSamples[];
}

/** Event payload emitted during selection changes. */
export interface SelectionEvent {
  readonly type: SelectionEventType;
  readonly selection: SelectionState | null;
  readonly sourceEvent?: PointerEvent | KeyboardEvent;
}

/** Options for drag-to-select chart interaction. */
export interface SelectionPluginOptions {
  readonly mode?: SelectionMode;
  readonly yAxis?: SeriesYAxis;
  readonly minDragDistancePx?: number;
  readonly maxSamplesPerSeries?: number;
  readonly samplePhase?: SelectionSamplePhase;
  readonly className?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly zIndex?: number;
  readonly clearOnEscape?: boolean;
  readonly onStart?: (event: SelectionEvent) => void;
  readonly onUpdate?: (event: SelectionEvent) => void;
  readonly onCommit?: (event: SelectionEvent) => void;
  readonly onClear?: (event: SelectionEvent) => void;
  readonly onChange?: (event: SelectionEvent) => void;
  readonly onSeriesSelectionChange?: (series: ChartSeriesState, selected: boolean, samples: SelectionSeriesSamples | null, selection: SelectionState | null) => void;
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

const DEFAULT_FILL = "rgba(59, 130, 246, 0.16)";
const DEFAULT_STROKE = "rgba(147, 197, 253, 0.95)";

function normalizeBounds(a: [number, number], b: [number, number], current: Viewport, mode: SelectionMode): SelectionBounds {
  const xMin = Math.min(a[0], b[0]);
  const xMax = Math.max(a[0], b[0]);
  const yMin = Math.min(a[1], b[1]);
  const yMax = Math.max(a[1], b[1]);
  return {
    xMin: mode === "y-range" ? current.xMin : xMin,
    xMax: mode === "y-range" ? current.xMax : xMax,
    yMin: mode === "x-range" ? current.yMin : yMin,
    yMax: mode === "x-range" ? current.yMax : yMax,
  };
}

function pointerToData(clientX: number, clientY: number, rect: DOMRect, viewport: Viewport): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const plotX = clamp(clientX - rect.left, 0, rect.width);
  const plotY = clamp(clientY - rect.top, 0, rect.height);
  return [
    viewport.xMin + (plotX / rect.width) * (viewport.xMax - viewport.xMin),
    viewport.yMax - (plotY / rect.height) * (viewport.yMax - viewport.yMin),
  ];
}

function plotBoundsForDrag(drag: DragState, rect: DOMRect, mode: SelectionMode): SelectionPlotBounds {
  const x0 = clamp(drag.startX - rect.left, 0, rect.width);
  const y0 = clamp(drag.startY - rect.top, 0, rect.height);
  const x1 = clamp(drag.currentX - rect.left, 0, rect.width);
  const y1 = clamp(drag.currentY - rect.top, 0, rect.height);
  const left = mode === "y-range" ? 0 : Math.min(x0, x1);
  const top = mode === "x-range" ? 0 : Math.min(y0, y1);
  const width = mode === "y-range" ? rect.width : Math.abs(x1 - x0);
  const height = mode === "x-range" ? rect.height : Math.abs(y1 - y0);
  return { left, top, width, height };
}

function collectSeriesSamples(
  seriesState: readonly ChartSeriesState[],
  bounds: SelectionBounds,
  mode: SelectionMode,
  yAxis: SeriesYAxis,
  maxSamplesPerSeries: number,
): SelectionSeriesSamples[] {
  const results: SelectionSeriesSamples[] = [];
  const xOnly = mode === "x-range";
  const xViewport = { xMin: bounds.xMin, xMax: bounds.xMax, yMin: -Infinity, yMax: Infinity };

  for (const state of seriesState) {
    if (!state.visible) continue;
    if (!xOnly && state.yAxis !== yAxis) continue;

    const range = state.series.visibleIndexRange(xViewport);
    const samples: SeriesSample[] = [];
    let total = 0;
    for (let index = range.start; index < range.end; index++) {
      const sample = state.series.sampleAt(index);
      if (!sample) continue;
      if (!xOnly && (sample.y < bounds.yMin || sample.y > bounds.yMax)) continue;
      total++;
      if (samples.length < maxSamplesPerSeries) samples.push(sample);
    }

    if (total === 0) continue;
    results.push({
      series: state.series,
      seriesIndex: state.index,
      id: state.id,
      name: state.name,
      yAxis: state.yAxis,
      samples,
      total,
      truncated: total > samples.length,
    });
  }

  return results;
}

/** Create a plugin that lets users select chart ranges by dragging. */
export function selectionPlugin(options: SelectionPluginOptions = {}): SelectionPlugin {
  const mode = options.mode ?? "xy";
  const yAxis = options.yAxis ?? "left";
  const minDragDistancePx = options.minDragDistancePx ?? 4;
  const maxSamplesPerSeries = Math.max(0, Math.floor(options.maxSamplesPerSeries ?? 5_000));
  const samplePhase = options.samplePhase ?? "commit";
  let chartRef: ChartPluginContext | null = null;
  let overlay: HTMLDivElement | null = null;
  let drag: DragState | null = null;
  let committedSelection: SelectionState | null = null;

  const notifySeriesSelection = (chart: ChartPluginContext | null, selection: SelectionState | null): void => {
    if (!chart || !options.onSeriesSelectionChange) return;
    for (const series of chart.getSeriesState()) {
      const samples = selection?.samples.find((entry) => entry.series === series.series) ?? null;
      options.onSeriesSelectionChange(series, samples !== null, samples, selection);
    }
  };

  const emit = (type: SelectionEventType, selection: SelectionState | null, sourceEvent?: PointerEvent | KeyboardEvent): void => {
    const event: SelectionEvent = { type, selection, sourceEvent };
    options.onChange?.(event);
    if (type === "start") options.onStart?.(event);
    if (type === "update") options.onUpdate?.(event);
    if (type === "commit") options.onCommit?.(event);
    if (type === "clear") options.onClear?.(event);
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

  const buildSelection = (chart: ChartPluginContext, state: DragState, includeSamples: boolean): SelectionState | null => {
    const canvas = chart.canvas;
    const rect = canvas.getBoundingClientRect();
    const current = chart.getViewport(yAxis);
    const start = pointerToData(state.startX, state.startY, rect, current);
    const end = pointerToData(state.currentX, state.currentY, rect, current);
    if (!start || !end) return null;

    const bounds = normalizeBounds(start, end, current, mode);
    const plotBounds = plotBoundsForDrag(state, rect, mode);
    const samples = includeSamples
      ? collectSeriesSamples(chart.getSeriesState(), bounds, mode, yAxis, maxSamplesPerSeries)
      : [];
    return { mode, yAxis, bounds, plotBounds, samples };
  };

  return {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      const canvas = chart.canvas;
      overlay = createOverlayLayer(options.className ?? "blazeplot-selection-brush", { zIndex: options.zIndex ?? 26 });
      overlay.style.border = `1px solid ${options.stroke ?? DEFAULT_STROKE}`;
      overlay.style.background = options.fill ?? DEFAULT_FILL;
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
        const selection = buildSelection(chart, drag, samplePhase === "update");
        setOverlay(selection?.plotBounds ?? null);
        emit("start", selection, event);
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        drag.currentX = event.clientX;
        drag.currentY = event.clientY;
        const selection = buildSelection(chart, drag, samplePhase === "update");
        setOverlay(selection?.plotBounds ?? null);
        if (samplePhase === "update") notifySeriesSelection(chart, selection);
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
        if (!commit || Math.hypot(dx, dy) < minDragDistancePx) {
          setOverlay(null);
          return;
        }

        const selection = buildSelection(chart, completed, samplePhase !== "none");
        if (!selection || selection.bounds.xMax <= selection.bounds.xMin || selection.bounds.yMax <= selection.bounds.yMin) {
          setOverlay(null);
          return;
        }

        committedSelection = selection;
        setOverlay(selection.plotBounds);
        notifySeriesSelection(chart, selection);
        chart.emitSelect(selection);
        emit("commit", selection, event);
      };

      const onPointerUp = (event: PointerEvent): void => finishDrag(event, true);
      const onPointerCancel = (event: PointerEvent): void => finishDrag(event, false);
      const onKeyDown = (event: KeyboardEvent): void => {
        if (options.clearOnEscape === false || event.key !== "Escape") return;
        committedSelection = null;
        setOverlay(null);
        notifySeriesSelection(chart, null);
        chart.emitSelect(null);
        emit("clear", null, event);
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      globalThis.addEventListener("keydown", onKeyDown);

      return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        globalThis.removeEventListener("keydown", onKeyDown);
        overlay?.remove();
        overlay = null;
        chartRef = null;
        drag = null;
        committedSelection = null;
      };
    },
    clear(): void {
      committedSelection = null;
      setOverlay(null);
      chartRef?.emitSelect(null);
      notifySeriesSelection(chartRef, null);
      emit("clear", null);
    },
    getSelection(): SelectionState | null {
      return committedSelection;
    },
  };
}
