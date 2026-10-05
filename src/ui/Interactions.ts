import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { PanIntent, ZoomAxis, ZoomIntent } from "../interaction/types.js";
import { dragModifierMatches } from "./OverlayUtils.js";
import type { ChartPlugin, ChartPluginContext, ChartRect, ChartSurface } from "./PluginHost.js";
import { asElement } from "./OverlayUtils.js";

/** Static or dynamic axis choice for wheel and drag interactions. */
export type InteractionAxisOption = ZoomAxis | (() => ZoomAxis);

/** Appearance and wording of the cooperative-gesture hint. */
export interface InteractionsGestureHintOptions {
  /** Shown when the wheel is used without the modifier. Defaults to "Use Ctrl + scroll to zoom" ("Use ⌘ + scroll to zoom" on Apple devices). */
  readonly wheelText?: string;
  /** Shown when one finger drags a `touchPan: "two-finger"` chart. Defaults to "Use two fingers to move the chart". */
  readonly touchText?: string;
  /** How long the hint stays visible. Defaults to 1200. */
  readonly durationMs?: number;
  readonly className?: string;
  /** Defaults to `theme.tooltipBackgroundColor`. */
  readonly backgroundColor?: string;
  /** Defaults to `theme.tooltipTextColor`. */
  readonly textColor?: string;
  /** Defaults to `theme.tooltipFont`. */
  readonly font?: string;
}

/** Keyboard pan and zoom step sizes for `interactionsPlugin({ keyboard })`. */
export interface InteractionsKeyboardOptions {
  /** Fraction of the viewport moved per arrow key. Defaults to 0.1. */
  readonly panFraction?: number;
  /** Zoom factor per +/- key. Defaults to 1.25. */
  readonly zoomFactor?: number;
}

/** Options for mouse, wheel, touch, and keyboard chart interactions. */
export interface InteractionsPluginOptions {
  /**
   * Arrow-key pan, +/- zoom, PageUp/PageDown Y zoom, and Home or 0 to fit, from the focused chart root.
   * Enabled by default; pass `false` to turn it off or an object to tune the step sizes.
   * The chart does not navigate by keyboard without this plugin.
   */
  readonly keyboard?: boolean | InteractionsKeyboardOptions;
  readonly axis?: InteractionAxisOption;
  /**
   * Drag a rectangle on the plot to zoom into it. Defaults to true. The drag starts on a plain
   * press (no modifier) unless `boxZoomModifier` says otherwise, and `selectionPlugin` takes a
   * plain drag first when both are installed; see `boxZoomModifier`.
   */
  readonly boxZoom?: boolean;
  /**
   * Modifier that starts a box zoom. By default any drag that is not a shift-drag pan zooms.
   * Set it to require exactly one modifier (or `"none"` for no modifier at all); use `"alt"`
   * or `"ctrl"` when `selectionPlugin` (or another plugin) owns the plain drag. `"shift"`
   * replaces shift-drag pan.
   */
  readonly boxZoomModifier?: "none" | "shift" | "alt" | "ctrl";
  /**
   * Wheel zoom and trackpad pan. `true` (the default) always handles the wheel over the plot and
   * axes. `"modifier"` is cooperative: the wheel scrolls the page unless Ctrl or Cmd is held
   * (trackpad pinch arrives as Ctrl+wheel, so it still zooms) and a hint explains the shortcut.
   * `false` leaves the wheel to the page.
   */
  readonly wheelZoom?: boolean | "modifier";
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
  /**
   * One-finger touch pan. `true` (the default) pans with one finger and blocks page scrolling
   * over the plot. `"two-finger"` is cooperative: one finger scrolls the page, and two fingers
   * pan and zoom the plot (a hint explains it). Axis gutters still pan with one finger.
   * `false` disables touch pan.
   */
  readonly touchPan?: boolean | "two-finger";
  readonly pinchZoom?: boolean;
  /**
   * The hint shown in cooperative modes (`wheelZoom: "modifier"`, `touchPan: "two-finger"`)
   * when the user scrolls or drags without the required modifier or second finger. Defaults to
   * true; `false` turns it off. The overlay is `aria-hidden` and takes its colors and font
   * from the chart theme's tooltip tokens unless overridden.
   */
  readonly gestureHint?: boolean | InteractionsGestureHintOptions;
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
  const target = asElement(event.currentTarget);
  target?.setPointerCapture(event.pointerId);
  return target;
}

function releasePointer(target: Element | null, pointerId: number): void {
  if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
}

/** Movement (CSS px) beyond which a touch is a drag, not a tap. */
const TAP_SLOP_PX = 10;

interface TouchPoint {
  x: number;
  y: number;
}

type TouchGestureState =
  | { readonly mode: "pan"; readonly pointerId: number; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastX: number; lastY: number }
  | { readonly mode: "pinch"; readonly axis: ZoomAxis; readonly yAxis?: SeriesYAxis; lastDistance: number; lastCx: number; lastCy: number };

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

function isApplePlatform(view: Window): boolean {
  return /Mac|iPhone|iPad/.test(view.navigator?.platform ?? "");
}

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

/** Centroid and spread of the first two active touch pointers. */
function pinchMetrics(touches: ReadonlyMap<number, TouchPoint>): { cx: number; cy: number; distance: number } | null {
  if (touches.size < 2) return null;
  const [a, b] = touches.values();
  if (!a || !b) return null;
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
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
      const selection = chart.dom.document.createElement("div");
      const axisHoverClass = `blazeplot-axis-hover-${nextInteractionsPluginId++}`;
      const axisHoverStyle = chart.dom.document.createElement("style");
      const hoverUndo = new Map<AxisSurface, () => void>();
      let drag: DragState | null = null;
      const touches = new Map<number, TouchPoint>();
      let touchGesture: TouchGestureState | null = null;
      let touchSurface: GestureSurface = "plot";
      let tapCandidate = false;
      /** True once a second finger joined since the last time all fingers were up (a real two-finger gesture). */
      let sawSecondFinger = false;
      let tapStartX = 0;
      let tapStartY = 0;
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
      chart.dom.mount("plot", selection);

      // Cooperative-gesture hint: created on first use, hidden again after a moment.
      const hintOptions = typeof options.gestureHint === "object" ? options.gestureHint : {};
      let hint: HTMLDivElement | null = null;
      let hintTimer: number | undefined;
      const showHint = (kind: "wheel" | "touch"): void => {
        if (options.gestureHint === false) return;
        if (!hint) {
          hint = chart.dom.document.createElement("div");
          hint.className = hintOptions.className ?? "blazeplot-gesture-hint";
          hint.setAttribute("aria-hidden", "true");
          Object.assign(hint.style, {
            position: "absolute",
            inset: "0",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: "30",
            textAlign: "center",
          });
          const label = chart.dom.document.createElement("div");
          Object.assign(label.style, { padding: "6px 12px", borderRadius: "6px", maxWidth: "90%" });
          hint.appendChild(label);
          chart.dom.mount("plot", hint);
        }
        const label = hint.firstElementChild as HTMLElement;
        label.textContent = kind === "wheel"
          ? hintOptions.wheelText ?? `Use ${isApplePlatform(chart.dom.view) ? "⌘" : "Ctrl"} + scroll to zoom`
          : hintOptions.touchText ?? "Use two fingers to move the chart";
        label.style.background = hintOptions.backgroundColor ?? chart.theme.tooltipBackgroundColor;
        label.style.color = hintOptions.textColor ?? chart.theme.tooltipTextColor;
        label.style.font = hintOptions.font ?? chart.theme.tooltipFont;
        hint.style.display = "flex";
        chart.dom.view.clearTimeout(hintTimer);
        hintTimer = chart.dom.view.setTimeout(() => {
          if (hint) hint.style.display = "none";
        }, hintOptions.durationMs ?? 1200);
      };

      axisHoverStyle.textContent = `.${axisHoverClass} > div { color: ${options.axisHoverColor ?? chart.theme.titleColor} !important; }`;
      if (axisInteractions && options.axisHover !== false) {
        chart.dom.mount("root", axisHoverStyle);
      }

      if (options.touchPan !== false || options.pinchZoom !== false) {
        // Cooperative mode leaves one-finger scrolling to the browser; two-finger input is ours.
        chart.dom.decorate("plot", { style: { touchAction: options.touchPan === "two-finger" ? "pan-x pan-y" : "none" } });
        if (axisInteractions) {
          for (const surface of AXIS_SURFACES) chart.dom.decorate(surface, { style: { touchAction: "none" } });
        }
      }

      if (axisInteractions) {
        for (const surface of AXIS_SURFACES) {
          chart.dom.decorate(surface, { style: { pointerEvents: "auto", cursor: surface === "axis-x" ? "ew-resize" : "ns-resize" } });
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
        if (!chart.dom.claimPointer(event)) return;
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
        if (event.pointerType === "touch") {
          onTouchDown(event, "plot");
          return;
        }
        if (drag || event.button !== 0) return;

        if (event.shiftKey && options.shiftDragPan !== false && options.boxZoomModifier !== "shift") {
          beginPan(event, resolveAxis(options.axis), "plot");
          return;
        }

        if (options.boxZoom === false || (options.boxZoomModifier !== undefined && !dragModifierMatches(event, options.boxZoomModifier)) || !chart.dom.claimPointer(event)) return;
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
        if (event.pointerType === "touch") {
          onTouchDown(event, surface);
          return;
        }
        if (drag || event.button !== 0) return;
        const config = axisGestureConfig(surface);
        beginPan(event, config.axis, surface, config.yAxis);
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (event.pointerType === "touch") {
          onTouchMove(event);
          return;
        }
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
        if (event.pointerType === "touch") {
          onTouchEnd(event);
          return;
        }
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
        if (event.pointerType === "touch") {
          onTouchEnd(event);
          return;
        }
        if (!drag || event.pointerId !== drag.pointerId) return;
        const completed = drag;
        drag = null;
        releasePointer(completed.captureTarget, event.pointerId);
        hideSelection();
      };

      const wheelOnAxis = (event: WheelEvent, zoomAxis: ZoomAxis, targetYAxis?: SeriesYAxis): void => {
        if (options.wheelZoom === false) return;
        if (options.wheelZoom === "modifier" && !event.ctrlKey && !event.metaKey) {
          // Cooperative: let the page scroll and say how to zoom.
          showHint("wheel");
          return;
        }
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

      const startPan = (pointerId: number, point: TouchPoint, config: { axis: ZoomAxis; yAxis?: SeriesYAxis }): void => {
        touchGesture = { mode: "pan", pointerId, axis: config.axis, yAxis: config.yAxis, lastX: point.x, lastY: point.y };
      };

      const startPinch = (config: { axis: ZoomAxis; yAxis?: SeriesYAxis }): void => {
        const metrics = pinchMetrics(touches);
        touchGesture = metrics && metrics.distance > 0
          ? { mode: "pinch", axis: config.axis, yAxis: config.yAxis, lastDistance: metrics.distance, lastCx: metrics.cx, lastCy: metrics.cy }
          : null;
      };

      /** Cooperative plot: one finger belongs to the page, two fingers to the chart. */
      const isCooperative = (surface: GestureSurface): boolean => options.touchPan === "two-finger" && surface === "plot";
      const twoFingerEnabled = (): boolean => options.pinchZoom !== false || isCooperative(touchSurface);

      function onTouchDown(event: PointerEvent, surface: GestureSurface): void {
        if (options.touchPan === false && options.pinchZoom === false) return;
        // The first finger of a cooperative plot is the page's; only a second finger starts a gesture.
        const idle = touches.size === 0 && isCooperative(surface);
        if (!idle && !chart.dom.claimPointer(event)) return;
        captureResetViewport();
        if (!idle) capturePointer(event);
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size === 1) {
          touchSurface = surface;
          tapCandidate = surface === "plot" && options.touchPan !== false && options.doubleTapReset !== false;
          tapStartX = event.clientX;
          tapStartY = event.clientY;
          if (options.touchPan !== false && !idle) startPan(event.pointerId, touches.get(event.pointerId)!, touchTargetConfig(surface));
          return;
        }
        tapCandidate = false;
        sawSecondFinger = true;
        if (twoFingerEnabled()) startPinch(touchTargetConfig(touchSurface));
      }

      function onTouchMove(event: PointerEvent): void {
        const point = touches.get(event.pointerId);
        if (!point) return;
        point.x = event.clientX;
        point.y = event.clientY;
        // Another plugin (a long-press tooltip) owns this move.
        if (event.defaultPrevented) return;
        if (tapCandidate && Math.hypot(point.x - tapStartX, point.y - tapStartY) > TAP_SLOP_PX) tapCandidate = false;
        const rect = chart.layout.plotRect();
        if (touches.size >= 2 && twoFingerEnabled()) {
          const metrics = pinchMetrics(touches);
          if (!metrics) return;
          if (touchGesture?.mode !== "pinch" || touchGesture.lastDistance <= 0) {
            startPinch(touchTargetConfig(touchSurface));
            return;
          }
          const gesture = touchGesture;
          if (isCooperative(touchSurface)) {
            // Two fingers move the chart too: pan by the centroid, then zoom around it.
            const dx = rect.width > 0 ? (gesture.lastCx - metrics.cx) / rect.width : 0;
            const dy = rect.height > 0 ? (metrics.cy - gesture.lastCy) / rect.height : 0;
            chart.viewport.pan(directPan({ dx, dy }, gesture.axis, gesture.yAxis ?? "left"), gesture.yAxis, USER_VIEWPORT);
          }
          if (options.pinchZoom !== false) {
            const factor = metrics.distance / gesture.lastDistance;
            const cx = rect.width > 0 ? (metrics.cx - rect.left) / rect.width : 0.5;
            const cy = rect.height > 0 ? 1 - (metrics.cy - rect.top) / rect.height : 0.5;
            chart.viewport.zoom(directZoom({ factor, cx, cy, axis: gesture.axis }, gesture.yAxis ?? "left"), gesture.yAxis, USER_VIEWPORT);
          }
          touchGesture = { ...gesture, lastDistance: metrics.distance, lastCx: metrics.cx, lastCy: metrics.cy };
          return;
        }
        if (touches.size === 1 && !touchGesture && isCooperative(touchSurface) && Math.hypot(point.x - tapStartX, point.y - tapStartY) > TAP_SLOP_PX) {
          showHint("touch");
          return;
        }
        if (touchGesture?.mode !== "pan" || touchGesture.pointerId !== event.pointerId) return;
        const dx = rect.width > 0 ? (touchGesture.lastX - point.x) / rect.width : 0;
        const dy = rect.height > 0 ? (point.y - touchGesture.lastY) / rect.height : 0;
        chart.viewport.pan(directPan({ dx, dy }, touchGesture.axis, touchGesture.yAxis ?? "left"), touchGesture.yAxis, USER_VIEWPORT);
        touchGesture.lastX = point.x;
        touchGesture.lastY = point.y;
      }

      function onTouchEnd(event: PointerEvent): void {
        if (!touches.delete(event.pointerId)) return;
        const config = touchTargetConfig(touchSurface);
        if (touches.size >= 2 && twoFingerEnabled()) {
          startPinch(config);
          return;
        }
        if (touches.size === 1) {
          const [remaining] = touches;
          touchGesture = null;
          if (remaining && options.touchPan !== false && !isCooperative(touchSurface)) startPan(remaining[0], remaining[1], config);
          return;
        }
        touchGesture = null;
        // The browser took a one-finger drag on a cooperative chart for page scroll.
        // A pointercancel that ends a two-finger gesture (the browser tearing down the touch sequence) is not a scroll takeover.
        if (event.type === "pointercancel" && isCooperative(touchSurface) && !sawSecondFinger) showHint("touch");
        sawSecondFinger = false;
        const wasTap = tapCandidate && event.type === "pointerup";
        tapCandidate = false;
        if (touches.size > 0 || !wasTap) return;
        const now = event.timeStamp;
        if (now - lastTapTime <= 320 && Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) <= 24) {
          event.preventDefault();
          resetToCapturedViewport();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
        lastTapX = event.clientX;
        lastTapY = event.clientY;
      }

      chart.dom.listen("plot", "pointerdown", onPlotPointerDown);
      chart.dom.listen("plot", "wheel", (event) => wheelOnAxis(event, resolveAxis(options.axis)), { passive: false });
      chart.dom.listen("plot", "dblclick", onDoubleClick);

      if (axisInteractions) {
        for (const surface of AXIS_SURFACES) {
          const config = axisGestureConfig(surface);
          chart.dom.listen(surface, "pointerdown", (event) => onAxisPointerDown(event, surface));
          chart.dom.listen(surface, "pointerenter", () => setAxisHovered(surface, true));
          chart.dom.listen(surface, "pointerleave", () => setAxisHovered(surface, false));
          chart.dom.listen(surface, "wheel", (event) => wheelOnAxis(event, config.axis, config.yAxis), { passive: false });
          chart.dom.listen(surface, "dblclick", onDoubleClick);
        }
      }

      for (const surface of ["plot", ...AXIS_SURFACES] as const) {
        chart.dom.listen(surface, "pointermove", onPointerMove);
        chart.dom.listen(surface, "pointerup", onPointerUp);
        chart.dom.listen(surface, "pointercancel", onPointerCancel);
      }

      if (options.keyboard !== false) {
        const config = typeof options.keyboard === "object" ? options.keyboard : undefined;
        const panFraction = typeof config?.panFraction === "number" && Number.isFinite(config.panFraction) ? Math.max(0, config.panFraction) : 0.1;
        const zoomFactor = typeof config?.zoomFactor === "number" && Number.isFinite(config.zoomFactor) && config.zoomFactor > 1 ? config.zoomFactor : 1.25;
        const zoomAtCenter = (factor: number, axis: ZoomAxis): void => chart.viewport.zoom({ factor, cx: 0.5, cy: 0.5, axis }, undefined, USER_VIEWPORT);
        // Bubble phase: the a11y plugin's inspection keys (capture) and any child handler run first.
        chart.dom.listen("root", "keydown", (event) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
          const target = event.target;
          const tag = (target as { tagName?: unknown } | null)?.tagName;
          if ((typeof tag === "string" && /^(INPUT|TEXTAREA|SELECT)$/i.test(tag)) || (target as { isContentEditable?: unknown } | null)?.isContentEditable === true) return;
          const panStep = panFraction * (event.shiftKey ? 2.5 : 1);
          let handled = true;
          switch (event.key) {
            case "ArrowLeft": chart.viewport.pan({ dx: -panStep, dy: 0 }, undefined, USER_VIEWPORT); break;
            case "ArrowRight": chart.viewport.pan({ dx: panStep, dy: 0 }, undefined, USER_VIEWPORT); break;
            case "ArrowUp": chart.viewport.pan({ dx: 0, dy: panStep }, undefined, USER_VIEWPORT); break;
            case "ArrowDown": chart.viewport.pan({ dx: 0, dy: -panStep }, undefined, USER_VIEWPORT); break;
            case "+":
            case "=": zoomAtCenter(zoomFactor, "xy"); break;
            case "-":
            case "_": zoomAtCenter(1 / zoomFactor, "xy"); break;
            case "PageUp": zoomAtCenter(zoomFactor, "y"); break;
            case "PageDown": zoomAtCenter(1 / zoomFactor, "y"); break;
            case "Home":
            case "0": handled = chart.viewport.fitToData({ padding: 0.05, source: "user" }); break;
            default: handled = false; break;
          }
          if (handled) event.preventDefault();
        });
      }

      return () => chart.dom.view.clearTimeout(hintTimer);
    },
  };
}
