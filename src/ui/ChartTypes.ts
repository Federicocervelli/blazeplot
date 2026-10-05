import type { SeriesConfig, SeriesMode, SeriesSample, SeriesYAxis, Viewport, XRange, RgbaColor } from "../core/types.js";
import type { AxisPosition } from "./ChartLayout.js";
import type { ChartSummary, ChartSummaryMessages } from "./ChartSummary.js";
import type { SeriesStore } from "../core/SeriesStore.js";
import type { ChartRendererFactory } from "../render/ChartRenderer.js";
import type { GpuBackend } from "../render/webgl2/types.js";
import type { AxisControllerAxisOptions } from "../interaction/AxisController.js";
import type { ViewportPolicy } from "../interaction/types.js";
import type { ChartTheme } from "./theme.js";
import type { SelectionState } from "./Selection.js";
import type { ChartPlugin, ChartPluginEventMap } from "./PluginHost.js";

/** Text and styling for an axis title. */
export interface TextOverlayConfig {
  readonly text: string;
  readonly color?: string;
  readonly font?: string;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

/** Chart title or subtitle text and alignment. */
export interface ChartTitleConfig extends TextOverlayConfig {
  readonly align?: "left" | "center" | "right";
}

/** Axis visibility, placement, scale, tick formatting, and title options. */
export interface AxisConfig extends AxisControllerAxisOptions {
  /** Hide tick labels while keeping the scale. Pass `false` instead of a config to hide an axis with default scale. */
  readonly visible?: boolean;
  readonly position?: AxisPosition;
  readonly title?: string | TextOverlayConfig;
  /**
   * Gutter size in CSS pixels for an `"outside"` axis, not counting room for the axis title.
   * Pass `"auto"` to size it from the widest (Y, Y2) or tallest (X) measured tick label; it
   * grows at once and shrinks only after the smaller size holds for about a second.
   * Defaults to 52 for Y and Y2 and 28 for X.
   */
  readonly size?: number | "auto";
}

/** Strategy used to find data points near a pointer location. */
export type ChartPickMode = "nearest-x" | "nearest-point";
/** Whether picks include all series sharing the same X value. */
export type ChartPickGroup = "x" | "none";

/** Options for hover and pointer hit-testing. */
export interface ChartPickOptions {
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
  readonly maxDistancePx?: number;
}

/** Overridable core accessibility strings. Unset keys keep their English defaults. */
export interface ChartAccessibilityMessages {
  /** Accessible name when the chart has no title. Defaults to `"BlazePlot chart"`. */
  readonly defaultLabel?: string;
  /** Wording of the generated summary (`aria-describedby`). */
  readonly summary?: Partial<ChartSummaryMessages>;
}

/** ARIA and high-contrast options for the chart root. Keyboard pan and zoom come from `interactionsPlugin`. */
export interface ChartAccessibilityOptions {
  /** BCP 47 locale for counts in generated text. Defaults to `"en-US"`. */
  readonly locale?: string;
  /** Override the generated core strings, for localization. */
  readonly messages?: ChartAccessibilityMessages;
  /** Accessible name. Defaults to the chart title and subtitle, then `"BlazePlot chart"`. */
  readonly label?: string;
  /**
   * Description referenced by the root's `aria-describedby`. Omit it for a generated data summary
   * (series names, X and Y ranges, latest values) refreshed at most once a second while data
   * changes. Pass a string for fixed text, a function to word the `ChartSummary` yourself, or
   * `""` for no description.
   */
  readonly description?: string | ((summary: ChartSummary) => string);
  /** ARIA role for the chart root. Defaults to `"figure"`. */
  readonly role?: string;
  /**
   * Follow the operating system's forced-colors (high-contrast) mode: the canvas switches to
   * system colors and DOM overlays get forced-colors styles, updating when the mode changes.
   * Defaults to true.
   */
  readonly forcedColors?: boolean;
}

/** @internal Context passed to a custom GPU backend factory. */
export interface ChartBackendFactoryContext {
  readonly canvas: HTMLCanvasElement;
}

/** @internal Creates the GPU backend used by a chart. */
export type ChartBackendFactory = (context: ChartBackendFactoryContext) => GpuBackend;

/** Render loop scheduling mode. */
export type ChartRenderLoop = "auto" | "continuous";

/** Constructor options for `Chart`. Boolean-or-object options accept `false` to disable and an object to configure. */
export interface ChartOptions {
  /** Hooks that constrain pan/zoom and adjust the camera before each render. */
  readonly viewportPolicy?: ViewportPolicy;
  /** Draw grid lines at axis ticks. Defaults to true; color comes from `theme.gridColor`. */
  readonly grid?: boolean;
  /** Axis configuration. `y2` is hidden unless configured. */
  readonly axes?: boolean | { x?: boolean | AxisConfig; y?: boolean | AxisConfig; y2?: boolean | AxisConfig };
  readonly title?: string | ChartTitleConfig;
  readonly subtitle?: string | ChartTitleConfig;
  /** Default pick behavior for hover state and pointer events. */
  readonly hover?: ChartPickOptions;
  /** ARIA attributes and keyboard navigation. Enabled by default. */
  readonly accessibility?: boolean | ChartAccessibilityOptions;
  /** Refit Y to the visible X range on every render. */
  readonly autoFitY?: boolean | ChartAutoFitYOptions;
  /** Keep the X viewport on the latest data. */
  readonly followX?: boolean | ChartFollowXOptions;
  /**
   * `"auto"` (default) renders once after `start()` and then only when chart
   * state changes. `"continuous"` renders every animation frame, for datasets
   * mutated outside BlazePlot.
   */
  readonly renderLoop?: ChartRenderLoop;
  /** Installed in this order when the chart is constructed; disposed in reverse order by `dispose()`. */
  readonly plugins?: readonly ChartPlugin[];
  readonly theme?: ChartTheme;
  /**
   * Rendering backend. Defaults to `"webgl2"`. Pass a factory from `blazeplot/renderers/canvas2d`
   * (`canvas2dRenderer()`, or `autoRenderer()` to fall back to Canvas 2D when WebGL2 is
   * unavailable) to render without WebGL2. Read the chosen backend from `chart.renderer`.
   */
  readonly renderer?: "webgl2" | ChartRendererFactory;
  /** @internal Hook for supplying a custom GPU backend (test fakes). Takes precedence over `renderer`. */
  readonly backendFactory?: ChartBackendFactory;
}

/** Series configuration used by typed helpers such as `addLine`. */
export type TypedSeriesConfig = Omit<SeriesConfig, "mode">;

/** Identity and axis options shared by series that build their own dataset. */
export type SeriesIdentityConfig = Pick<SeriesConfig, "id" | "name" | "yAxis" | "downsample">;

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

/**
 * What changed the viewport: a user gesture (`"user"`, passed by the interaction, navigator, and
 * keyboard plugins), latest-X following (`"follow"`), `fitToData`/`autoFitY` (`"fit"`), a linked
 * chart mirroring another panel (`"linked"`), or app code (`"api"`, the default).
 */
export type ChartViewportChangeSource = "user" | "follow" | "fit" | "api" | "linked";

/** Emitted after the visible domain changes. */
export interface ChartViewportChangeEvent {
  readonly viewport: Viewport;
  readonly rightViewport: Viewport;
  /** What changed the viewport. */
  readonly source: ChartViewportChangeSource;
}

/** Options for `chart.pan` and `chart.zoom`. */
export interface ChartViewportGestureOptions {
  /** Reported as `viewportchange.source`. Defaults to `"api"`. */
  readonly source?: ChartViewportChangeSource;
}

/** Options for `chart.setViewport`. */
export interface ChartSetViewportOptions extends ChartViewportGestureOptions {
  /** Pause latest-X following when X changes. Defaults to true. Linked charts pass false for mirrored updates. */
  readonly pauseFollow?: boolean;
}

/** Latest-X follow state change, emitted when following starts, stops, pauses, or resumes. */
export interface ChartFollowXChangeEvent {
  readonly state: ChartFollowXState;
}

/** Selection event payload emitted by selection plugins or custom code. `null` means the selection was cleared. */
export interface ChartSelectEvent {
  readonly selection: SelectionState | null;
}

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

/** Options for exporting the chart as an image blob. */
export interface ChartScreenshotOptions {
  /** Image MIME type. Defaults to `"image/png"`. */
  readonly type?: string;
  readonly quality?: number;
  /** CSS background color, or `null` for transparent. Defaults to the theme background. */
  readonly background?: string | null;
  /** Output pixel ratio. Defaults to `devicePixelRatio`. */
  readonly dpr?: number;
  readonly width?: number;
  readonly height?: number;
}

/** Fractional padding applied when fitting domains to data. */
export interface ChartFitToDataPadding {
  readonly x?: number;
  readonly y?: number;
}

/** Options for fitting the viewport to series data bounds. */
export interface ChartFitToDataOptions {
  readonly series?: readonly SeriesStore[];
  /** Include hidden series. Defaults to false. */
  readonly includeHidden?: boolean;
  /** Fit X. Defaults to true. */
  readonly x?: boolean;
  /** Fit Y. Defaults to true. */
  readonly y?: boolean;
  readonly yAxis?: SeriesYAxis | "both";
  readonly padding?: number | ChartFitToDataPadding;
  readonly includeZero?: boolean;
  /** Only consider samples at or after this X. */
  readonly xMin?: number;
  /** Only consider samples at or before this X. */
  readonly xMax?: number;
  /** Reported as `viewportchange.source`. Defaults to `"fit"`. */
  readonly source?: ChartViewportChangeSource;
}

/** Options for automatically refitting Y as the X viewport changes. */
export type ChartAutoFitYOptions = Pick<ChartFitToDataOptions, "series" | "includeHidden" | "yAxis" | "padding" | "includeZero">;

/** Options for keeping the X viewport anchored to the latest data. */
export interface ChartFollowXOptions {
  /** Visible X span. Defaults to the current span. */
  readonly window?: number;
  /** Pause following while the user pans or zooms. Defaults to true. */
  readonly pauseOnInteraction?: boolean;
  /** Resume automatically this many milliseconds after a pan/zoom interaction. */
  readonly resumeAfterMs?: number;
  /**
   * Optional live X clock for smooth scrolling streams. The follow window uses
   * the larger of the latest data X and `currentX()`, so time axes advance
   * continuously between batched updates.
   */
  readonly currentX?: () => number;
  readonly includeHidden?: boolean;
  readonly series?: readonly SeriesStore[];
}

/** Latest-X follow state: disabled, actively following, or paused by interaction. */
export type ChartFollowXState = "off" | "following" | "paused";

/** Render metrics from the last frame. */
export interface ChartFrameStats {
  fps: number;
  frameMs: number;
  pointsRendered: number;
  drawCalls: number;
  uploadBytes: number;
  renderMode: "none" | "raw" | "minmax" | "points" | "bars" | "area" | "mixed";
}
