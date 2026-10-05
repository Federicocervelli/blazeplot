/**
 * Public chart state and event payload types: series state, pick/hover results, pointer, viewport,
 * follow, and selection events, `ChartEventMap`, and frame stats. A leaf module (core types only),
 * so the plugin contract and the chart helpers can share it without importing `Chart`.
 */
import type { SeriesMode, SeriesSample, SeriesYAxis, Viewport, XRange, RgbaColor } from "../core/types.js";
import type { SeriesStore } from "../core/SeriesStore.js";
import type { ChartFollowXState, ChartViewportChangeSource } from "./ChartViewportTypes.js";

/** Strategy used to find data points near a pointer location. */
export type ChartPickMode = "nearest-x" | "nearest-point";
/** Whether picks include all series sharing the same X value. */
export type ChartPickGroup = "x" | "none";

/** Options for hover and pointer hit-testing. */
export interface ChartPickOptions {
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
  /** Largest pointer-to-sample distance, in CSS pixels, that still counts as a hit. */
  readonly maxDistancePx?: number;
}

/** Runtime state for one chart series. */
export interface ChartSeriesState {
  readonly series: SeriesStore;
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly mode: SeriesMode;
  readonly visible: boolean;
  readonly color: RgbaColor;
  readonly yAxis: SeriesYAxis;
}

/** A picked data point with series metadata and screen coordinates. */
export interface ChartPickItem extends SeriesSample {
  /** Represented X interval for interval-backed samples such as histogram bins. */
  readonly xRange?: XRange;
  readonly series: SeriesStore;
  readonly seriesIndex: number;
  readonly id?: string;
  readonly name?: string;
  readonly mode: SeriesMode;
  readonly plotX: number;
  readonly plotY: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Pointer events that can be subscribed to through `Chart.subscribe`. */
export type ChartPointerEventType = "click" | "dblclick" | "pointerdown" | "pointerup" | "pointermove";

/** Pointer event payload expressed in both screen and data coordinates. */
export interface ChartPointerEvent {
  readonly type: ChartPointerEventType;
  readonly clientX: number;
  readonly clientY: number;
  readonly plotX: number;
  readonly plotY: number;
  readonly dataX: number;
  readonly dataY: number;
  readonly button: number;
  readonly buttons: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly items: readonly ChartPickItem[];
}

/** Click payload for the nearest chart series item. */
export interface ChartSeriesClickEvent extends ChartPointerEvent {
  readonly item: ChartPickItem;
}

/** Emitted after the visible domain changes. */
export interface ChartViewportChangeEvent {
  readonly viewport: Viewport;
  readonly rightViewport: Viewport;
  /** What changed the viewport. */
  readonly source: ChartViewportChangeSource;
}

/** Latest-X follow state change, emitted when following starts, stops, pauses, or resumes. */
export interface ChartFollowXChangeEvent {
  readonly state: ChartFollowXState;
}

/** Selection event payload emitted by selection plugins or custom code. `null` means the selection was cleared. */
export interface ChartSelectEvent {
  readonly selection: SelectionState | null;
}

/** Geometry captured by the selection plugin. */
export type SelectionMode = "x-range" | "y-range" | "xy";

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

/**
 * Events plugins may emit with `ctx.events.emit(...)`. Chart users receive them through
 * `chart.subscribe(...)`, because `ChartEventMap` extends this map.
 *
 * Third-party plugins add their own events with declaration merging. Prefix names with your
 * plugin name to avoid collisions:
 *
 * ```ts
 * declare module "blazeplot" {
 *   interface ChartPluginEventMap {
 *     "my-plugin:change": { readonly value: number };
 *   }
 * }
 * ```
 */
export interface ChartPluginEventMap {
  /** A selection was committed or cleared. Emitted by `selectionPlugin` and linked layouts. */
  select: ChartSelectEvent;
}

/** Name of an event a plugin may emit. */
export type ChartPluginEventName = keyof ChartPluginEventMap;

/** Current hover hit-test result, including pointer position and picked items. */
export interface ChartHoverState {
  readonly clientX: number;
  readonly clientY: number;
  readonly plotX: number;
  readonly plotY: number;
  readonly dataX: number;
  readonly dataY: number;
  readonly anchorX: number;
  readonly mode: ChartPickMode;
  readonly group: ChartPickGroup;
  readonly maxDistancePx: number;
  readonly items: readonly ChartPickItem[];
  /**
   * What produced the state: `"pointer"` for hover and `pick()`, `"inspection"` for a sample
   * shown through `ctx.state.inspect(...)` (keyboard inspection). For inspection, the client,
   * plot, and data coordinates are those of the inspected sample, which is `items[0]`.
   */
  readonly source?: "pointer" | "inspection";
}

/** A sample to show as the hover state, set with `ctx.state.inspect(...)`. */
export interface ChartInspectionTarget {
  readonly series: SeriesStore;
  /** Logical sample index, as used by `series.sampleAt(index)`. */
  readonly index: number;
}

/**
 * Payload delivered to `chart.subscribe(event, callback)` for each chart event. Includes the
 * plugin events declared on `ChartPluginEventMap` (such as `select`).
 */
export interface ChartEventMap extends ChartPluginEventMap {
  /** Hovered items changed, or `null` when the pointer left the plot. */
  hover: ChartHoverState | null;
  /** A series was added, removed, or shown/hidden. */
  serieschange: void;
  themechange: void;
  /** A frame finished drawing. */
  render: void;
  viewportchange: ChartViewportChangeEvent;
  /** Latest-X following started, stopped, paused, or resumed. */
  followxchange: ChartFollowXChangeEvent;
  seriesclick: ChartSeriesClickEvent;
  click: ChartPointerEvent;
  dblclick: ChartPointerEvent;
  pointerdown: ChartPointerEvent;
  pointerup: ChartPointerEvent;
  pointermove: ChartPointerEvent;
}

/** Name of an event accepted by `Chart.subscribe`. */
export type ChartEventName = keyof ChartEventMap;

/** Render metrics from the last frame. */
export interface ChartFrameStats {
  fps: number;
  frameMs: number;
  pointsRendered: number;
  drawCalls: number;
  uploadBytes: number;
  renderMode: "none" | "raw" | "minmax" | "points" | "bars" | "area" | "mixed";
}
