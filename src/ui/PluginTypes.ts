/**
 * Public plugin contract types: the context a plugin receives, its handle, and the surface/layout
 * vocabulary. A leaf module: depends only on chart state/event types, never on the host class or
 * `Chart`, so built-in and third-party plugins share one import path.
 */
import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { Camera2D } from "../interaction/Camera2D.js";
import type { PanIntent, ZoomIntent } from "../interaction/types.js";
import type { ChartEventMap, ChartEventName, ChartFrameStats, ChartHoverState, ChartInspectionTarget, ChartPickOptions, ChartPluginEventMap, ChartPluginEventName, ChartSeriesState } from "./ChartEvents.js";
import type { ChartFitToDataOptions, ChartFollowXOptions, ChartFollowXState, ChartSetViewportOptions, ChartViewportGestureOptions } from "./ChartViewportTypes.js";
import type { ChartRenderSurface, ChartRendererInfo } from "../render/ChartRenderer.js";
import type { ResolvedChartTheme } from "./theme.js";

/**
 * Where a plugin can attach its own DOM with `ctx.dom.mount(slot, element)`.
 *
 * - `"plot"`: the plot area, above the WebGL canvas. Coordinates match `ctx.coords` plot
 *   coordinates (CSS pixels from the plot's top-left). Overlays here should keep
 *   `pointer-events: none` unless they handle their own input.
 * - `"root"`: the whole chart box, including axis gutters and space reserved with
 *   `ctx.layout.reserve(...)`. Use it for legends, toolbars, and navigators.
 * - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters (bottom, left, right).
 * - `"body"`: the owning document's `<body>`, for `position: fixed` UI such as tooltips that
 *   must escape the chart's `overflow: hidden`.
 */
export type ChartMountSlot = "plot" | "root" | "axis-x" | "axis-y" | "axis-y2" | "body";

/**
 * Chart-owned element a plugin can listen on or decorate with `ctx.dom.listen` and `ctx.dom.decorate`.
 *
 * - `"plot"`: the interactive plot surface (it receives pointer, wheel, and touch input).
 * - `"root"`: the chart root; it is focusable and receives keyboard input when accessibility is enabled.
 * - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters. They ignore pointer input
 *   until a plugin decorates them with `pointerEvents: "auto"`.
 */
export type ChartSurface = "plot" | "root" | "axis-x" | "axis-y" | "axis-y2";

/** Inline style properties a plugin may set on a chart surface. */
export interface ChartSurfaceStyle {
  readonly cursor?: string;
  readonly touchAction?: string;
  readonly pointerEvents?: string;
  readonly filter?: string;
  readonly outline?: string;
  readonly outlineOffset?: string;
}

/** Styles, classes, and attributes applied to a chart surface by `ctx.dom.decorate`. */
export interface ChartSurfaceDecoration {
  readonly style?: ChartSurfaceStyle;
  readonly classes?: readonly string[];
  readonly attributes?: Readonly<Record<string, string>>;
}

/** A rectangle in CSS pixels. */
export interface ChartRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Plot-area size in CSS pixels, passed to `ChartPluginHandle.onResize`. */
export interface ChartPlotSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Extra CSS-pixel space reserved around the plot by a plugin, e.g. for a navigator or toolbar.
 * Reservations from every plugin add up.
 */
export interface ChartLayoutReservation {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}


/** Coordinate conversions between data, plot, and client (viewport) space. */
export interface ChartPluginCoords {
  /** Data coordinates to plot-local CSS pixels, using the axis scales. */
  dataToPlot(x: number, y: number, yAxis?: SeriesYAxis): [number, number];
  /** Client coordinates (e.g. `event.clientX/Y`) to data coordinates, or `null` outside the plot. */
  clientToData(clientX: number, clientY: number, yAxis?: SeriesYAxis): [number, number] | null;
  /** Client coordinates to plot-local CSS pixels. Points outside the plot are not clamped. */
  clientToPlot(clientX: number, clientY: number): [number, number];
  /** Plot-local CSS pixels to client coordinates. */
  plotToClient(plotX: number, plotY: number): [number, number];
  /**
   * Format a data value the way the axis labels it (tick format, time, categorical, or custom
   * scale formatting). Use it for text that should match the axes, such as announcements.
   */
  format(value: number, axis: "x" | "y", yAxis?: SeriesYAxis): string;
}

/** Viewport reads, changes, and latest-X follow control. Changes go through the chart's `ViewportPolicy`. */
export interface ChartPluginViewport {
  /** Visible data domain for the requested Y axis (defaults to `"left"`). */
  get(yAxis?: SeriesYAxis): Viewport;
  /** Set any viewport edges. X is shared by both Y axes; changing X pauses latest-X following unless `options.pauseFollow` is false. Pass `{ source: "user" }` for gestures. */
  set(viewport: Partial<Viewport>, yAxis?: SeriesYAxis, options?: ChartSetViewportOptions): void;
  /** Pan in scale space. Omit `yAxis` to pan Y on both axes like a plot gesture. */
  pan(intent: PanIntent, yAxis?: SeriesYAxis, options?: ChartViewportGestureOptions): void;
  /** Zoom in scale space around a normalized anchor. Omit `yAxis` to zoom Y on both axes. */
  zoom(intent: ZoomIntent, yAxis?: SeriesYAxis, options?: ChartViewportGestureOptions): void;
  /** Fit the viewport to data bounds; returns `false` when nothing changed. */
  fitToData(options?: ChartFitToDataOptions): boolean;
  /** Whether an axis runs right-to-left (`"x"`) or top-to-bottom (`"y"`) on screen. */
  isReversed(axis: "x" | "y", yAxis?: SeriesYAxis): boolean;
  /** Keep the X viewport on the latest data, replacing any previous follow options. */
  followX(options?: ChartFollowXOptions): void;
  /** Disable latest-X following. */
  stopFollowX(): void;
  /** Pause or resume latest-X following without changing its options. */
  setFollowXPaused(paused: boolean): void;
  getFollowXState(): ChartFollowXState;
}

/** Read-only chart state. */
export interface ChartPluginState {
  /** Metadata for every attached series, in draw order. */
  getSeries(): ChartSeriesState[];
  /** The current hover state, or `null` when nothing is hovered. */
  getHover(): ChartHoverState | null;
  /** Hit-test a client point against visible series. */
  pick(clientX: number, clientY: number, options?: ChartPickOptions): ChartHoverState | null;
  /** Copy the latest render metrics into `target` and return it. */
  getFrameStats(target?: ChartFrameStats): ChartFrameStats;
  /**
   * Show one sample as the chart's hover state, as if the pointer were on it, so the tooltip,
   * crosshair, and `hover` subscribers follow a keyboard cursor. The state has
   * `source: "inspection"` and the sample as `items[0]`, and is re-projected every frame.
   * Pass `null` to end inspection; a pointer moving over the plot also ends it. Returns the new
   * hover state, which is `null` while the sample is hidden, a gap, or outside the plot.
   * Throws a `RangeError` for a series that is not on this chart or an index outside it.
   */
  inspect(target: ChartInspectionTarget | null): ChartHoverState | null;
  /** The sample being inspected, or `null` when no inspection is active. */
  getInspection(): ChartInspectionTarget | null;
}

/** Layout geometry and space reservations. */
export interface ChartPluginLayout {
  /** The plot area in client (viewport) coordinates. */
  plotRect(): ChartRect;
  /** The whole chart box (the `"root"` slot) in client coordinates. */
  rootRect(): ChartRect;
  /** Reserve space around the plot. Returns a function that releases the reservation. */
  reserve(reservation: ChartLayoutReservation): () => void;
}

/** DOM attachment and input on chart-owned elements. Everything is released when the plugin is disposed. */
export interface ChartPluginDom {
  /** The document that owns the chart. Differs from the global `document` inside an iframe, popup, or Document Picture-in-Picture window. */
  readonly document: Document;
  /** The window that owns the chart (`document.defaultView`, else the global). Use it for `devicePixelRatio`, `matchMedia`, and animation frames. */
  readonly view: Window & typeof globalThis;
  /** Create an HTML element in the chart's document. Plugins should use this instead of the global `document`. */
  create<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
  /** Create an SVG element in the chart's document. */
  createSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K];
  /** Append `element` to a mount slot. Returns a function that removes it. */
  mount(slot: ChartMountSlot, element: Element): () => void;
  /** Listen for a DOM event on a chart surface. Returns a function that removes the listener. */
  listen<K extends keyof HTMLElementEventMap>(
    surface: ChartSurface,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
  /**
   * Apply styles, classes, and attributes to a chart surface. Returns a function that restores
   * the previous values; undo decorations in reverse order when several touch the same property.
   */
  decorate(surface: ChartSurface, decoration: ChartSurfaceDecoration): () => void;
  /** Whether `target` is inside the chart (its root element or a descendant). */
  contains(target: EventTarget | null | undefined): boolean;
  /**
   * Claim the pointer behind a `pointerdown` event for this plugin's gesture (a drag, a pan, a
   * brush). Returns `true` when this plugin now owns the pointer and `false` when another plugin
   * already claimed it; in that case do not start the gesture. The first plugin to claim wins, and
   * listeners run in plugin install order. Claiming again from the same plugin returns `true`.
   * A claim ends when the pointer is released or cancelled, or when the plugin is disposed.
   * Built-in plugins claim their drags and skip pointers claimed by others.
   */
  claimPointer(event: PointerEvent): boolean;
}

/** Chart event subscription and typed plugin events. */
export interface ChartPluginEvents {
  /** Subscribe to a chart or plugin event. Returns an unsubscribe function. */
  subscribe<K extends ChartEventName>(event: K, callback: (payload: ChartEventMap[K]) => void): () => void;
  /** Emit a plugin event to every subscriber on this chart. */
  emit<K extends ChartPluginEventName>(event: K, payload: ChartPluginEventMap[K]): void;
}

/**
 * Escape hatches outside the stable plugin contract.
 *
 * @experimental May change in a minor release. See docs/stability.md.
 */
export interface ChartPluginUnstable {
  /** The chart's WebGL canvas. Prefer `ctx.dom` and `ctx.layout`. */
  readonly canvas: HTMLCanvasElement;
  /** Raw element behind a mount slot or surface. Prefer `ctx.dom.mount`, `listen`, and `decorate`. */
  element(slot: ChartMountSlot | ChartSurface): HTMLElement;
  /**
   * The chart's WebGL2 context, or `null` when its engine does not own one (Canvas 2D, and the shared
   * WebGL2 engine, whose context belongs to every chart that uses it). The chart may recreate GPU state
   * after context loss.
   */
  getWebGLContext(): WebGL2RenderingContext | null;
  /**
   * A drawing surface on `canvas` that uses the chart's rendering engine, so a plugin's own layer
   * follows the chart's engine (including the shared WebGL2 context) without writing WebGL or Canvas 2D.
   * Size `canvas` in device pixels. The surface is released when the plugin is disposed, or earlier
   * through its own `dispose()`. Throws when the engine cannot create another surface.
   */
  createRenderSurface(canvas: HTMLCanvasElement): ChartRenderSurface;
  /** The camera for a Y axis. Mutating it bypasses `ViewportPolicy`; prefer `ctx.viewport`. */
  getCamera(yAxis?: SeriesYAxis): Camera2D;
}

/**
 * The API a plugin receives in `install(ctx)`. Each plugin gets its own context; listeners,
 * subscriptions, mounted elements, decorations, and layout reservations created through it are
 * released automatically after the plugin is disposed.
 */
export interface ChartPluginContext {
  /** The resolved theme currently used by the chart. Re-read it in `onThemeChange`. */
  readonly theme: ResolvedChartTheme;
  /** Which rendering engine the chart uses and what it can do. Read-only; stable for the chart's lifetime. */
  readonly renderer: ChartRendererInfo;
  readonly coords: ChartPluginCoords;
  readonly viewport: ChartPluginViewport;
  readonly state: ChartPluginState;
  readonly layout: ChartPluginLayout;
  readonly dom: ChartPluginDom;
  readonly events: ChartPluginEvents;
  /** Schedule a frame. Chart-owned changes already request one. */
  requestRender(): void;
  /** @experimental Escape hatches; see `ChartPluginUnstable`. */
  readonly unstable: ChartPluginUnstable;
}

/**
 * Object a plugin's `install` may return. Every member is optional.
 *
 * Hooks run in plugin registration order; `dispose` runs in reverse registration order.
 */
export interface ChartPluginHandle {
  /** Release plugin-owned resources. Runs once, from `chart.dispose()` or a failed install. */
  dispose?(): void;
  /** The plot area changed size (including device-pixel-ratio changes). */
  onResize?(size: ChartPlotSize): void;
  /** `chart.setTheme(...)` replaced the theme. Runs before the `themechange` event. */
  onThemeChange?(theme: ResolvedChartTheme): void;
  /** The chart's rendering context was lost (WebGL2, shared WebGL2, or Canvas 2D). The chart stops drawing until it is restored. */
  onContextLost?(): void;
  /** The chart's rendering context was restored and the engine rebuilt what it needed. */
  onContextRestored?(): void;
}

/** Plugin installer for extending chart behavior. */
export interface ChartPlugin {
  /**
   * Called once when the chart is constructed, in the order plugins appear in `ChartOptions.plugins`.
   * Return nothing, a cleanup function, or a `ChartPluginHandle`.
   */
  install(ctx: ChartPluginContext): void | (() => void) | ChartPluginHandle;
}
