import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { ChartPlugin, ChartPluginContext, ChartRect } from "./PluginHost.js";
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
  /**
   * Keyboard selection while the chart root has focus: Shift+Arrow keys extend a range from the
   * keyboard inspection cursor (or the plot center), Enter commits it, and Escape cancels it.
   * Progress is announced through a polite live region. Defaults to true; `false` disables it.
   */
  readonly keyboard?: boolean | SelectionKeyboardOptions;
  /** Called on `start`, `update`, `commit`, and `clear`; switch on `event.type`. */
  readonly onChange?: (event: SelectionEvent) => void;
}

/** Keyboard selection tuning for `selectionPlugin`. */
export interface SelectionKeyboardOptions {
  /** Fraction of the plot width (or height) one Shift+Arrow press moves the range edge. Defaults to 0.05. */
  readonly step?: number;
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
function clampedClientToData(chart: ChartPluginContext, clientX: number, clientY: number, rect: ChartRect, yAxis: SeriesYAxis): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return chart.coords.clientToData(
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

function plotBoundsForDrag(drag: DragState, rect: ChartRect, mode: SelectionMode): SelectionPlotBounds {
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
  /** Keyboard range being extended: data coordinates on `yAxis`. */
  let keyDrag: { readonly anchor: [number, number]; current: [number, number] } | null = null;
  let announce: ((text: string) => void) | null = null;

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
    const rect = chart.layout.plotRect();
    const start = clampedClientToData(chart, state.startX, state.startY, rect, yAxis);
    const end = clampedClientToData(chart, state.currentX, state.currentY, rect, yAxis);
    if (!start || !end) return null;
    return {
      mode,
      yAxis,
      bounds: normalizeBounds(start, end, chart.viewport.get(yAxis), mode),
      plotBounds: plotBoundsForDrag(state, rect, mode),
    };
  };

  const clearSelection = (sourceEvent?: KeyboardEvent): void => {
    const hadSelection = committedSelection !== null || keyDrag !== null;
    committedSelection = null;
    drag = null;
    keyDrag = null;
    setOverlay(null);
    chartRef?.events.emit("select", { selection: null });
    emit("clear", null, sourceEvent);
    if (hadSelection) announce?.("Selection cleared.");
  };

  return {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      // Pointer capture goes to the element that received the press (the plot surface).
      let captureTarget: Element | null = null;
      overlay = createOverlayLayer(options.className ?? "blazeplot-selection-brush", { zIndex: options.zIndex ?? 26 });
      const applyTheme = (): void => {
        if (!overlay) return;
        overlay.style.border = `1px solid ${options.stroke ?? chart.theme.selectionStrokeColor}`;
        overlay.style.background = options.fill ?? chart.theme.selectionFillColor;
      };
      applyTheme();
      const unmount = chart.dom.mount("plot", overlay);

      const onPointerDown = (event: PointerEvent): void => {
        if (drag || event.button !== 0) return;
        event.preventDefault();
        captureTarget = event.currentTarget instanceof Element ? event.currentTarget : null;
        captureTarget?.setPointerCapture(event.pointerId);
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
        if (captureTarget?.hasPointerCapture(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
        captureTarget = null;

        const dx = completed.currentX - completed.startX;
        const dy = completed.currentY - completed.startY;
        const selection = commit && Math.hypot(dx, dy) >= minDragDistancePx ? buildSelection(chart, completed) : null;
        if (!selection || selection.bounds.xMax <= selection.bounds.xMin || selection.bounds.yMax <= selection.bounds.yMin) {
          setOverlay(committedSelection?.plotBounds ?? null);
          return;
        }

        committedSelection = selection;
        setOverlay(selection.plotBounds);
        chart.events.emit("select", { selection });
        emit("commit", selection, event);
      };

      const onPointerUp = (event: PointerEvent): void => finishDrag(event, true);
      const onPointerCancel = (event: PointerEvent): void => finishDrag(event, false);
      // Escape belongs to this chart only when the latest press or focus move landed in it
      // (pressing the canvas does not move focus, so focus alone cannot tell).
      let escapeArmed = false;
      const armEscape = (event: Event): void => {
        escapeArmed = event.composedPath().some((target) => chart.dom.contains(target));
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        // A handler that already consumed Escape (e.g. leaving keyboard inspection) wins.
        if (options.clearOnEscape === false || event.key !== "Escape" || event.defaultPrevented || !escapeArmed || (!committedSelection && !drag)) return;
        clearSelection(event);
      };

      // Keyboard selection: a polite live region reports the range; the overlay shows it.
      const keyboard = options.keyboard === false ? null : (typeof options.keyboard === "object" ? options.keyboard : {});
      const keyStep = typeof keyboard?.step === "number" && Number.isFinite(keyboard.step) && keyboard.step > 0 ? Math.min(1, keyboard.step) : 0.05;
      let liveRegion: HTMLDivElement | null = null;
      if (keyboard) {
        liveRegion = document.createElement("div");
        liveRegion.className = "blazeplot-visually-hidden blazeplot-selection-status";
        liveRegion.setAttribute("role", "status");
        liveRegion.setAttribute("aria-live", "polite");
        liveRegion.setAttribute("aria-atomic", "true");
        chart.dom.mount("root", liveRegion);
        let toggle = false;
        announce = (text) => {
          // Alternate a trailing no-break space so repeating the same text is announced again.
          toggle = !toggle;
          if (liveRegion) liveRegion.textContent = toggle ? text : `${text} `;
        };
      }
      const describe = (bounds: Viewport): string => {
        const x = `X from ${chart.coords.format(bounds.xMin, "x", yAxis)} to ${chart.coords.format(bounds.xMax, "x", yAxis)}`;
        const y = `Y from ${chart.coords.format(bounds.yMin, "y", yAxis)} to ${chart.coords.format(bounds.yMax, "y", yAxis)}`;
        return mode === "x-range" ? x : mode === "y-range" ? y : `${x}, ${y}`;
      };
      const keySelection = (): SelectionState | null => {
        if (!keyDrag) return null;
        const rect = chart.layout.plotRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const bounds = normalizeBounds(keyDrag.anchor, keyDrag.current, chart.viewport.get(yAxis), mode);
        const [x0, y0] = chart.coords.dataToPlot(keyDrag.anchor[0], keyDrag.anchor[1], yAxis);
        const [x1, y1] = chart.coords.dataToPlot(keyDrag.current[0], keyDrag.current[1], yAxis);
        const corners = { pointerId: 0, startX: rect.left + x0, startY: rect.top + y0, currentX: rect.left + x1, currentY: rect.top + y1 };
        return { mode, yAxis, bounds, plotBounds: plotBoundsForDrag(corners, rect, mode) };
      };
      /** Start point: the keyboard inspection cursor when one is active, else the plot center. */
      const keyAnchor = (): [number, number] | null => {
        const rect = chart.layout.plotRect();
        const center = clampedClientToData(chart, rect.left + rect.width / 2, rect.top + rect.height / 2, rect, yAxis);
        const hover = chart.state.getHover();
        const item = hover?.source === "inspection" ? hover.items[0] : undefined;
        if (!item || !center) return center;
        return [item.x, (item.series.config.yAxis ?? "left") === yAxis ? item.y : center[1]];
      };
      const extendByKey = (event: KeyboardEvent, dxFraction: number, dyFraction: number): void => {
        const rect = chart.layout.plotRect();
        const starting = keyDrag === null;
        if (!keyDrag) {
          const anchor = keyAnchor();
          if (!anchor) return;
          keyDrag = { anchor, current: [anchor[0], anchor[1]] };
        }
        const [plotX, plotY] = chart.coords.dataToPlot(keyDrag.current[0], keyDrag.current[1], yAxis);
        const next = clampedClientToData(chart, rect.left + plotX + dxFraction * rect.width, rect.top + plotY + dyFraction * rect.height, rect, yAxis);
        if (next) keyDrag.current = next;
        const selection = keySelection();
        setOverlay(selection?.plotBounds ?? null);
        emit(starting ? "start" : "update", selection, event);
        if (selection) announce?.(`Selecting ${describe(selection.bounds)}.${starting ? " Enter commits, Escape cancels." : ""}`);
      };
      const commitKeySelection = (event: KeyboardEvent): boolean => {
        const selection = keySelection();
        if (!selection || selection.bounds.xMax <= selection.bounds.xMin || selection.bounds.yMax <= selection.bounds.yMin) return false;
        keyDrag = null;
        committedSelection = selection;
        setOverlay(selection.plotBounds);
        chart.events.emit("select", { selection });
        emit("commit", selection, event);
        announce?.(`Selected ${describe(selection.bounds)}.`);
        return true;
      };
      const onRootKeyDown = (event: KeyboardEvent): void => {
        // Only while the chart root itself has focus; controls inside it keep their keys.
        if (!keyboard || event.target !== event.currentTarget || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        let handled = true;
        switch (event.key) {
          case "ArrowLeft":
          case "ArrowRight":
            if (!event.shiftKey || mode === "y-range") return;
            extendByKey(event, event.key === "ArrowRight" ? keyStep : -keyStep, 0);
            break;
          case "ArrowUp":
          case "ArrowDown":
            if (!event.shiftKey || mode === "x-range") return;
            extendByKey(event, 0, event.key === "ArrowDown" ? keyStep : -keyStep);
            break;
          case "Enter":
            handled = keyDrag !== null && commitKeySelection(event);
            break;
          case "Escape":
            if (!keyDrag) return;
            keyDrag = null;
            setOverlay(committedSelection?.plotBounds ?? null);
            announce?.("Selection cancelled.");
            break;
          default:
            handled = false;
        }
        if (handled) event.preventDefault();
      };

      // Keep the committed rectangle on its data bounds as the chart pans, zooms, or resizes.
      const onRender = (): void => {
        if (drag) return;
        if (keyDrag) {
          setOverlay(keySelection()?.plotBounds ?? null);
          return;
        }
        if (!committedSelection) return;
        const rect = chart.layout.plotRect();
        const { bounds } = committedSelection;
        const [x0, y0] = chart.coords.dataToPlot(bounds.xMin, bounds.yMin, yAxis);
        const [x1, y1] = chart.coords.dataToPlot(bounds.xMax, bounds.yMax, yAxis);
        const corners = { pointerId: 0, startX: rect.left + x0, startY: rect.top + y0, currentX: rect.left + x1, currentY: rect.top + y1 };
        committedSelection = { ...committedSelection, plotBounds: plotBoundsForDrag(corners, rect, mode) };
        setOverlay(committedSelection.plotBounds);
      };

      const unlisten = [
        chart.dom.listen("plot", "pointerdown", onPointerDown),
        chart.dom.listen("plot", "pointermove", onPointerMove),
        chart.dom.listen("plot", "pointerup", onPointerUp),
        chart.dom.listen("plot", "pointercancel", onPointerCancel),
        // Capture runs before the chart's own Shift+Arrow pan on the same root element.
        chart.dom.listen("root", "keydown", onRootKeyDown, { capture: true }),
      ];
      globalThis.addEventListener("pointerdown", armEscape, { capture: true });
      globalThis.addEventListener("focusin", armEscape, { capture: true });
      globalThis.addEventListener("keydown", onKeyDown);
      const unsubscribeRender = chart.events.subscribe("render", onRender);

      return {
        onThemeChange: applyTheme,
        dispose() {
          for (const off of unlisten) off();
          globalThis.removeEventListener("pointerdown", armEscape, { capture: true });
          globalThis.removeEventListener("focusin", armEscape, { capture: true });
          globalThis.removeEventListener("keydown", onKeyDown);
          unsubscribeRender();
          unmount();
          overlay = null;
          chartRef = null;
          drag = null;
          captureTarget = null;
          committedSelection = null;
          keyDrag = null;
          announce = null;
          liveRegion = null;
        },
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
