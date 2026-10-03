import type { SeriesConfig, SeriesStyle, SeriesStyleOptions, Dataset, SeriesMode, SeriesSample, SeriesYAxis, Viewport, XRange, RgbaColor } from "../core/types.js";
import { SeriesStore } from "../core/SeriesStore.js";
import type { SeriesChange } from "../core/SeriesStore.js";
import { RingBuffer } from "../core/RingBuffer.js";
import { UniformRingBuffer } from "../core/UniformRingBuffer.js";
import { HistogramDataset, histogram } from "../core/Histogram.js";
import type { HistogramOptions, HistogramResult } from "../core/Histogram.js";
import { Renderer } from "../render/Renderer.js";
import type { RenderProjection } from "../render/Renderer.js";
import { WebGL2Backend } from "../render/WebGL2Backend.js";
import type { GpuBackend, GpuBuffer } from "../render/types.js";
import { Camera2D } from "../interaction/Camera2D.js";
import { AxisController } from "../interaction/AxisController.js";
import type { AxisControllerAxisOptions } from "../interaction/AxisController.js";
import type { PanIntent, ViewportPolicy, ZoomIntent } from "../interaction/types.js";
import { AxisOverlay, X_TICK_LIMIT, Y_TICK_LIMIT } from "./AxisOverlay.js";
import { ChartLayout } from "./ChartLayout.js";
import type { AxisPosition, NormalizedAxisConfig } from "./ChartLayout.js";
import { resolveChartTheme, resolveThemeColor } from "./theme.js";
import type { ChartTheme, ResolvedChartTheme } from "./theme.js";

/** Vertices in the shared raw line/point/area upload buffer. */
const RAW_LINE_VERTEX_CAPACITY = 16_384;
const AREA_POINT_CAPACITY = RAW_LINE_VERTEX_CAPACITY >> 1;
/** Bars, min/max buckets, or candles expanded into triangles per draw. */
const BAR_TRIANGLE_CAPACITY = 4_096;
const FLOATS_PER_MINMAX_BUCKET = 3;
const FLOATS_PER_BAR_TRIANGLES = 12;
const FLOATS_PER_OHLC_TUPLE = 5;
/** Two vertices per grid line; tick generators may add one extra tick at each edge. */
const GRID_LINE_VERTEX_CAPACITY = (X_TICK_LIMIT + 2 + Y_TICK_LIMIT + 2) * 2;
const MAX_EXACT_SCATTER_POINTS = RAW_LINE_VERTEX_CAPACITY * 4;
const TITLE_TOP_PX = 6;
const SUBTITLE_TOP_PX = 26;
const TITLE_SIDE_INSET_PX = 8;
const AXIS_TITLE_INSET_PX = 4;

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

/** ARIA and keyboard-navigation options for the chart root. */
export interface ChartAccessibilityOptions {
  /** Accessible name. Defaults to the chart title and subtitle. */
  readonly label?: string;
  readonly description?: string;
  /** ARIA role for the chart root. Defaults to `"img"`. */
  readonly role?: string;
  /** Arrow-key pan, +/- zoom, and Home to fit. Pass `false` to disable. */
  readonly keyboard?: boolean | ChartKeyboardOptions;
}

/** Keyboard pan and zoom behavior for accessible charts. */
export interface ChartKeyboardOptions {
  /** Fraction of the viewport moved per arrow key. Defaults to 0.1. */
  readonly panFraction?: number;
  /** Zoom factor per +/- key. Defaults to 1.25. */
  readonly zoomFactor?: number;
}

/** Context passed to a custom GPU backend factory. */
export interface ChartBackendFactoryContext {
  readonly canvas: HTMLCanvasElement;
}

/** Creates the GPU backend used by a chart. */
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
  readonly plugins?: readonly ChartPlugin[];
  readonly theme?: ChartTheme;
  /** Advanced hook for supplying a custom GPU backend. Defaults to `WebGL2Backend`. */
  readonly backendFactory?: ChartBackendFactory;
}

/** Series configuration used by typed helpers such as `addLine`. */
export type TypedSeriesConfig = Omit<SeriesConfig, "mode">;

/** Identity and axis options shared by series that build their own dataset. */
export type SeriesIdentityConfig = Pick<SeriesConfig, "id" | "name" | "yAxis" | "downsample">;

/** `Chart.addHistogram(...)` config that bins raw one-dimensional values. */
export interface HistogramSeriesConfig extends SeriesIdentityConfig, HistogramOptions {
  readonly values: ArrayLike<number>;
  readonly histogram?: never;
}

/** `Chart.addHistogram(...)` config for bins computed with `histogram(...)`. */
export interface PrecomputedHistogramSeriesConfig extends SeriesIdentityConfig {
  readonly histogram: HistogramResult;
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
export interface ChartPointerEventState {
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
export interface ChartSeriesClickEvent extends ChartPointerEventState {
  readonly item: ChartPickItem;
}

/** Emitted after the visible domain changes. */
export interface ChartViewportChangeEvent {
  readonly viewport: Viewport;
  readonly rightViewport: Viewport;
}

/** Selection event payload emitted by selection plugins or custom code. */
export interface ChartSelectEvent<T = unknown> {
  readonly selection: T;
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
}

/** Payload delivered to `chart.subscribe(event, callback)` for each chart event. */
export interface ChartEventMap {
  /** Hovered items changed, or `null` when the pointer left the plot. */
  hover: ChartHoverState | null;
  /** A series was added, removed, or shown/hidden. */
  serieschange: void;
  themechange: void;
  /** A frame finished drawing. */
  render: void;
  viewportchange: ChartViewportChangeEvent;
  select: ChartSelectEvent;
  seriesclick: ChartSeriesClickEvent;
  click: ChartPointerEventState;
  dblclick: ChartPointerEventState;
  pointerdown: ChartPointerEventState;
  pointerup: ChartPointerEventState;
  pointermove: ChartPointerEventState;
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
export type ChartXFollowState = "off" | "following" | "paused";

/** Extra CSS-pixel space reserved around the plot by plugins or overlays. */
export interface ChartLayoutReservation {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/** Render metrics from the last frame. */
export interface ChartFrameStats {
  fps: number;
  frameMs: number;
  pointsRendered: number;
  drawCalls: number;
  uploadBytes: number;
  renderMode: "none" | "raw" | "minmax" | "points" | "bars" | "area" | "mixed";
}

type DrawMode = Exclude<ChartFrameStats["renderMode"], "none" | "mixed">;

/** Chart API available to plugins. */
export interface ChartPluginContext {
  readonly canvas: HTMLCanvasElement;
  readonly rootElement: HTMLElement;
  readonly plotElement: HTMLElement;
  readonly xAxisElement: HTMLElement;
  readonly yAxisElement: HTMLElement;
  readonly y2AxisElement: HTMLElement;
  readonly theme: ResolvedChartTheme;
  getWebGLContext(): WebGL2RenderingContext | null;
  getCamera(yAxis?: SeriesYAxis): Camera2D;
  dataToPlot(x: number, y: number, yAxis?: SeriesYAxis): [number, number];
  clientToData(clientX: number, clientY: number, yAxis?: SeriesYAxis): [number, number] | null;
  getViewport(yAxis?: SeriesYAxis): Viewport;
  setViewport(viewport: Partial<Viewport>, yAxis?: SeriesYAxis): void;
  pan(intent: PanIntent, yAxis?: SeriesYAxis): void;
  zoom(intent: ZoomIntent, yAxis?: SeriesYAxis): void;
  fitToData(options?: ChartFitToDataOptions): boolean;
  getSeriesState(): ChartSeriesState[];
  followLatestX(options?: ChartFollowXOptions): void;
  stopFollowingLatestX(): void;
  setXFollowPaused(paused: boolean): void;
  getXFollowState(): ChartXFollowState;
  getFrameStats(target?: ChartFrameStats): ChartFrameStats;
  getHoverState(): ChartHoverState | null;
  setLayoutReservation(id: string, reservation: ChartLayoutReservation | null): void;
  requestRender(): void;
  subscribe<K extends ChartEventName>(event: K, callback: (payload: ChartEventMap[K]) => void): () => void;
  pick(clientX: number, clientY: number, options?: ChartPickOptions): ChartHoverState | null;
  emitSelect(selection: unknown): void;
}

/** Disposable handle returned by a plugin. */
export interface ChartPluginHandle {
  dispose(): void;
}

/** Plugin installer for extending chart behavior. */
export interface ChartPlugin {
  install(chart: ChartPluginContext): void | (() => void) | ChartPluginHandle;
}

type ResolvedAxisConfig = NormalizedAxisConfig & AxisControllerAxisOptions & { readonly title?: string | TextOverlayConfig };

type ResolvedAxesConfig = { x: ResolvedAxisConfig; y: ResolvedAxisConfig; y2: ResolvedAxisConfig };

type MutableRenderProjection = {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

type Listener<K extends ChartEventName> = (payload: ChartEventMap[K]) => void;

interface PickCandidate {
  readonly sample: SeriesSample;
  readonly series: SeriesStore;
  readonly seriesIndex: number;
}

interface PlotRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface ChartGpuResources {
  readonly renderer: Renderer;
  readonly rawLineBuffer: GpuBuffer;
  readonly barTriangleBuffer: GpuBuffer;
  readonly gridBuffer: GpuBuffer;
}

function normalizeAxisConfig(config: boolean | AxisConfig | undefined, defaultVisible: boolean): ResolvedAxisConfig {
  if (config === undefined) return { visible: defaultVisible, position: "outside" };
  if (typeof config === "boolean") return { visible: config, position: "outside" };
  return { ...config, visible: config.visible !== false, position: config.position ?? "outside" };
}

function normalizeAxesConfig(axes: ChartOptions["axes"]): ResolvedAxesConfig {
  if (typeof axes === "boolean") {
    return { x: normalizeAxisConfig(axes, axes), y: normalizeAxisConfig(axes, axes), y2: normalizeAxisConfig(false, false) };
  }
  return {
    x: normalizeAxisConfig(axes?.x, true),
    y: normalizeAxisConfig(axes?.y, true),
    y2: normalizeAxisConfig(axes?.y2, false),
  };
}

function normalizeFitPadding(padding: number | ChartFitToDataPadding | undefined): Required<ChartFitToDataPadding> {
  const clean = (value: number | undefined): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  return typeof padding === "number" ? { x: clean(padding), y: clean(padding) } : { x: clean(padding?.x), y: clean(padding?.y) };
}

function domainsAlmostEqual(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  const scale = Math.max(1, Math.abs(aMax - aMin), Math.abs(bMax - bMin));
  const epsilon = scale * 1e-9;
  return Math.abs(aMin - bMin) <= epsilon && Math.abs(aMax - bMax) <= epsilon;
}

/**
 * Pad a data domain in the axis's scale space, so log and symlog axes pad
 * proportionally instead of past zero. Returns `null` when no valid domain exists
 * for the scale, e.g. non-positive data or `includeZero` on a log axis.
 */
function paddedAxisDomain(
  controller: AxisController,
  axis: "x" | "y",
  min: number,
  max: number,
  padding: number,
  includeZero: boolean,
): { min: number; max: number } | null {
  const from = includeZero ? Math.min(0, min) : min;
  const to = includeZero ? Math.max(0, max) : max;
  let domain = paddedDomain(from, to, padding);
  if (controller.isNonlinear(axis)) {
    try {
      const scaled = paddedDomain(controller.scaleValue(from, axis), controller.scaleValue(to, axis), padding);
      domain = { min: controller.unscaleValue(scaled.min, axis), max: controller.unscaleValue(scaled.max, axis) };
    } catch {
      // Custom scales without fromScreen() cannot map back; keep the linear padding.
    }
  }
  return controller.isValidDomain(axis, domain.min, domain.max) ? domain : null;
}

function paddedDomain(min: number, max: number, padding: number): { min: number; max: number } {
  let nextMin = min;
  let nextMax = max;
  let span = nextMax - nextMin;
  if (span <= 0) {
    const halfSpan = Math.max(1, Math.abs(nextMin)) * 0.5;
    nextMin -= halfSpan;
    nextMax += halfSpan;
    span = nextMax - nextMin;
  }
  const amount = span * padding;
  return { min: nextMin - amount, max: nextMax + amount };
}

function titleText(config: string | TextOverlayConfig | undefined): string {
  return typeof config === "string" ? config : config?.text ?? "";
}

function withAlpha(color: RgbaColor, factor: number): RgbaColor {
  return [color[0], color[1], color[2], color[3] * factor];
}

/** Imperative WebGL chart instance for rendering, interaction, and plugins. */
export class Chart implements ChartPluginContext {
  private series: SeriesStore[] = [];
  private camera: Camera2D;
  private rightCamera: Camera2D;
  private axis: AxisController;
  private rightAxis: AxisController;
  private renderer!: Renderer;
  private rawLineBuffer!: GpuBuffer;
  private readonly rawLineData = new Float32Array(RAW_LINE_VERTEX_CAPACITY * 2);
  private readonly minMaxBucketData = new Float32Array(BAR_TRIANGLE_CAPACITY * FLOATS_PER_MINMAX_BUCKET);
  private barTriangleBuffer!: GpuBuffer;
  private readonly barTriangleData = new Float32Array(BAR_TRIANGLE_CAPACITY * FLOATS_PER_BAR_TRIANGLES);
  private gridBuffer!: GpuBuffer;
  private readonly gridData = new Float32Array(GRID_LINE_VERTEX_CAPACITY * 2);
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];
  private readonly y2Ticks: number[] = [];
  private axisOverlay: AxisOverlay | null = null;
  private normalizedAxes: ResolvedAxesConfig;
  private resolvedTheme: ResolvedChartTheme;
  private gridVisible: boolean;
  private layout: ChartLayout;
  private readonly stats: ChartFrameStats = { fps: 0, frameMs: 0, pointsRendered: 0, drawCalls: 0, uploadBytes: 0, renderMode: "none" };
  private resizeObserver: ResizeObserver | null = null;
  private readonly pluginDisposers: Array<() => void> = [];
  /** Listener sets keyed by event; `never` payloads let every typed listener share one map. */
  private readonly listeners = new Map<ChartEventName, Set<(payload: never) => void>>();
  private readonly layoutReservations = new Map<string, ChartLayoutReservation>();
  private currentHover: ChartHoverState | null = null;
  private readonly leftProjection: MutableRenderProjection = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  private readonly rightProjection: MutableRenderProjection = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  private lastPointerClientX: number = 0;
  private lastPointerClientY: number = 0;
  private lastPointerPlotX: number = 0;
  private lastPointerPlotY: number = 0;
  private lastPointerButtons: number = 0;
  private pointerInPlot: boolean = false;
  private lastFrameAt: number = 0;
  private currentXOrigin: number = 0;
  private followXConfig: ChartFollowXOptions | null = null;
  private xFollowPaused: boolean = false;
  private xFollowResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number = 0;
  private hoverRafId: number = 0;
  private restoreRenderRafId: number = 0;
  private running: boolean = false;
  private webglContextLost: boolean = false;
  /** Last invalid-domain message reported, so a persistent problem logs once rather than every frame. */
  private reportedDomainError: string | null = null;
  private readonly options: ChartOptions;
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") {
      this.pointerInPlot = true;
      this.lastPointerClientX = event.clientX;
      this.lastPointerClientY = event.clientY;
      this.lastPointerPlotX = event.offsetX;
      this.lastPointerPlotY = event.offsetY;
      this.lastPointerButtons = event.buttons;
      this.scheduleHoverRefresh();
    }
    if (this.hasListeners("pointermove")) this.emitPointerEvent("pointermove", event);
  };
  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.lastPointerButtons = event.buttons;
    if (event.pointerType === "touch") {
      this.pointerInPlot = false;
      this.setHover(null);
    }
    this.emitPointerEvent("pointerdown", event);
  };
  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.lastPointerButtons = event.buttons;
    this.emitPointerEvent("pointerup", event);
    this.refreshHover();
  };
  private readonly handleClick = (event: MouseEvent): void => {
    const pointerEvent = this.emitPointerEvent("click", event);
    const item = pointerEvent?.items[0];
    if (pointerEvent && item) this.emit("seriesclick", { ...pointerEvent, item });
  };
  private readonly handleDoubleClick = (event: MouseEvent): void => {
    this.emitPointerEvent("dblclick", event);
  };
  private readonly handlePointerLeave = (): void => {
    this.pointerInPlot = false;
    this.lastPointerButtons = 0;
    this.setHover(null);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.handleKeyboardNavigation(event);
  };
  private readonly handleWebGLContextLost = (event: Event): void => {
    event.preventDefault();
    this.webglContextLost = true;
    if (this.restoreRenderRafId !== 0) {
      cancelAnimationFrame(this.restoreRenderRafId);
      this.restoreRenderRafId = 0;
    }
    this.resetFrameStats();
  };
  private readonly handleWebGLContextRestored = (): void => {
    const oldRenderer = this.renderer;
    let nextResources: ChartGpuResources;
    try {
      nextResources = this.createGpuResources();
    } catch (error) {
      this.webglContextLost = true;
      console.error("BlazePlot failed to restore WebGL resources after context restoration.", error);
      return;
    }

    this.installGpuResources(nextResources);
    this.disposeRenderer(oldRenderer);
    this.webglContextLost = false;
    this.applyCanvasSize();
    this.scheduleRenderAfterRestore();
  };

  /** Create a chart inside `target`. Call `start()` to begin rendering. */
  constructor(target: HTMLElement, options: ChartOptions = {}) {
    this.options = options;
    this.followXConfig = options.followX ? (options.followX === true ? {} : options.followX) : null;
    this.resolvedTheme = resolveChartTheme(options.theme, target);
    this.normalizedAxes = normalizeAxesConfig(options.axes);
    this.gridVisible = options.grid !== false;

    this.layout = new ChartLayout(target, this.normalizedAxes);
    this.layout.root.style.background = this.resolvedTheme.backgroundCssColor;
    this.applyAccessibility();
    this.applyCanvasSize();
    this.camera = new Camera2D();
    this.rightCamera = new Camera2D();
    this.applyAxisDirections();
    this.axis = new AxisController(this.camera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y });
    this.rightAxis = new AxisController(this.rightCamera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y2 });
    try {
      this.installGpuResources(this.createGpuResources());
      this.rebuildAxisOverlay();
      this.updateTextOverlays();
    } catch (error) {
      // E.g. no WebGL2: remove the half-built DOM and hand back a caller-supplied canvas.
      this.axisOverlay?.dispose();
      if (this.renderer) this.disposeRenderer(this.renderer);
      this.layout.dispose();
      throw error;
    }

    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("dblclick", this.handleDoubleClick);
    this.canvas.addEventListener("webglcontextlost", this.handleWebGLContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleWebGLContextRestored);
    this.layout.root.addEventListener("keydown", this.handleKeyDown);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.layout.plot);
    }

    try {
      for (const plugin of options.plugins ?? []) {
        const installed = plugin.install(this);
        if (typeof installed === "function") {
          this.pluginDisposers.push(installed);
        } else if (installed) {
          this.pluginDisposers.push(() => installed.dispose());
        }
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Canvas element used for chart rendering. */
  get canvas(): HTMLCanvasElement {
    return this.layout.canvas;
  }

  /** Root DOM element managed by the chart. */
  get rootElement(): HTMLElement {
    return this.layout.root;
  }

  /** Plot-area DOM element containing the canvas. */
  get plotElement(): HTMLElement {
    return this.layout.plot;
  }

  /** X-axis DOM element. */
  get xAxisElement(): HTMLElement {
    return this.layout.xAxis;
  }

  /** Primary Y-axis DOM element. */
  get yAxisElement(): HTMLElement {
    return this.layout.yAxis;
  }

  /** Secondary Y-axis DOM element. */
  get y2AxisElement(): HTMLElement {
    return this.layout.y2Axis;
  }

  /** Resolved theme currently used by the chart. */
  get theme(): ResolvedChartTheme {
    return this.resolvedTheme;
  }

  /** Return the underlying WebGL2 context when the default backend is used. */
  getWebGLContext(): WebGL2RenderingContext | null {
    return this.renderer.getWebGLContext();
  }

  /** Return the camera controlling the requested Y axis. */
  getCamera(yAxis: SeriesYAxis = "left"): Camera2D {
    return yAxis === "right" ? this.rightCamera : this.camera;
  }

  /** Convert data coordinates to plot-local CSS-pixel coordinates. */
  dataToPlot(x: number, y: number, yAxis: SeriesYAxis = "left"): [number, number] {
    const controller = this.controllerFor(yAxis);
    // Use the same fractional plot size as clientToData so conversions round-trip exactly.
    const rect = this.canvas.getBoundingClientRect();
    return this.getCamera(yAxis).toScreen(
      controller.valueToClip(x, "x"),
      controller.valueToClip(y, "y"),
      rect.width,
      rect.height,
    );
  }

  /** Convert viewport client coordinates to data coordinates, or `null` outside the plot. */
  clientToData(clientX: number, clientY: number, yAxis: SeriesYAxis = "left"): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    const plotX = clientX - rect.left;
    const plotY = clientY - rect.top;
    if (!this.insidePlot(plotX, plotY, rect)) return null;
    return this.plotToData(plotX, plotY, rect, this.controllerFor(yAxis));
  }

  /** Return the visible data domain for the requested Y axis. */
  getViewport(yAxis: SeriesYAxis = "left"): Viewport {
    return this.getCamera(yAxis).viewport;
  }

  /**
   * Set any viewport edges. X is shared by both Y axes; Y edges apply to `yAxis`.
   * Changing X pauses latest-X following like a user pan would.
   */
  setViewport(viewport: Partial<Viewport>, yAxis: SeriesYAxis = "left"): void {
    const setsX = viewport.xMin !== undefined || viewport.xMax !== undefined;
    const setsY = viewport.yMin !== undefined || viewport.yMax !== undefined;
    const camera = this.getCamera(yAxis);
    const xMin = viewport.xMin ?? this.camera.xMin;
    const xMax = viewport.xMax ?? this.camera.xMax;
    const yMin = viewport.yMin ?? camera.yMin;
    const yMax = viewport.yMax ?? camera.yMax;
    // Validate both axes before mutating either, so a rejected call leaves the chart untouched.
    if (setsX && !this.axis.isValidDomain("x", xMin, xMax)) {
      throw new RangeError(`Chart.setViewport received an invalid X domain [${xMin}, ${xMax}] for the configured scale.`);
    }
    if (setsY && !(yAxis === "right" ? this.rightAxis : this.axis).isValidDomain("y", yMin, yMax)) {
      throw new RangeError(`Chart.setViewport received an invalid Y domain [${yMin}, ${yMax}] for the configured scale.`);
    }
    if (setsX) {
      this.pauseXFollowForInteraction();
      this.camera.setViewport({ xMin, xMax });
      this.syncRightCameraX();
    }
    if (setsY) camera.setViewport({ yMin, yMax });
    this.emitViewportChange();
    this.refreshHover();
  }

  /**
   * Pan in scale space, after `viewportPolicy.beforePan`. X always pans both axes.
   * Y pans only `yAxis` when given; omitted, Y pans both axes like a plot-area gesture.
   * The intent is normalized to the left axis domain (or `yAxis` when given).
   */
  pan(intent: PanIntent, yAxis?: SeriesYAxis): void {
    const policy = this.options.viewportPolicy;
    const next = policy?.beforePan ? policy.beforePan(this.getCamera(yAxis), intent) : intent;
    if (!next) return;
    const left = yAxis === "right" ? { dx: next.dx, dy: 0 } : next;
    const right = yAxis === "right"
      ? { dx: 0, dy: next.dy }
      : { dx: 0, dy: yAxis === undefined ? (this.rightYDirectionMatchesLeft() ? next.dy : -next.dy) : 0 };
    this.applyViewportChange(this.axis.panViewport(left), this.rightAxis.panViewport(right));
  }

  /**
   * Zoom in scale space around a normalized anchor, after `viewportPolicy.beforeZoom`. X always zooms both axes.
   * Y zooms only `yAxis` when given; omitted, Y zooms both axes like a plot-area gesture.
   * The anchor is normalized to the left axis domain (or `yAxis` when given).
   */
  zoom(intent: ZoomIntent, yAxis?: SeriesYAxis): void {
    const policy = this.options.viewportPolicy;
    const next = policy?.beforeZoom ? policy.beforeZoom(this.getCamera(yAxis), intent) : intent;
    if (!next) return;
    const zoomsY = next.axis !== "x";
    let left: Viewport | null = this.camera.viewport;
    let right: Viewport | null = this.rightCamera.viewport;
    if (yAxis === "right") {
      if (next.axis !== "y") left = this.axis.zoomViewport({ ...next, axis: "x" });
      if (zoomsY) right = this.rightAxis.zoomViewport({ ...next, axis: "y" });
    } else {
      left = this.axis.zoomViewport(next);
      if (yAxis === undefined && zoomsY) {
        right = this.rightAxis.zoomViewport({ ...next, cy: this.rightYDirectionMatchesLeft() ? next.cy : 1 - next.cy, axis: "y" });
      }
    }
    this.applyViewportChange(left, right);
  }

  /**
   * Apply a gesture's left/right viewports together. When either is unusable (an
   * invalid scale domain or a span beyond float precision) nothing changes, so a
   * gesture never leaves the two Y axes out of step.
   */
  private applyViewportChange(left: Viewport | null, right: Viewport | null): void {
    if (!left || !right) return;
    this.pauseXFollowForInteraction();
    this.camera.setViewport(left);
    this.rightCamera.setViewport({ yMin: right.yMin, yMax: right.yMax });
    this.syncRightCameraX();
    this.emitViewportChange();
    this.scheduleHoverRefresh();
  }

  /** Add a series with an explicit mode. Prefer the typed helpers such as `addLine`. */
  addSeries<D extends Dataset = Dataset>(config: SeriesConfig & { readonly dataset?: D }, style: SeriesStyleOptions = {}): SeriesStore<D> {
    if ((config.mode === "ohlc" || config.mode === "candlestick") && !config.dataset) {
      throw new TypeError("OHLC and candlestick series require an OhlcDataset.");
    }
    const dataset = (config.dataset ?? this.createDefaultDataset(config)) as D;
    const series = new SeriesStore(dataset, config, this.resolveSeriesStyle(style), (change) => this.handleSeriesChange(change));
    this.series.push(series);
    this.emitSeriesChange();
    return series;
  }

  /** Add a line series. */
  addLine<D extends Dataset = Dataset>(config: TypedSeriesConfig & { readonly dataset?: D }, style?: SeriesStyleOptions): SeriesStore<D> {
    return this.addSeries({ ...config, mode: "line" }, style);
  }

  /** Add an area series filled from `style.baseline`. */
  addArea<D extends Dataset = Dataset>(config: TypedSeriesConfig & { readonly dataset?: D }, style?: SeriesStyleOptions): SeriesStore<D> {
    return this.addSeries({ ...config, mode: "area" }, style);
  }

  /** Add a scatter series. */
  addScatter<D extends Dataset = Dataset>(config: TypedSeriesConfig & { readonly dataset?: D }, style?: SeriesStyleOptions): SeriesStore<D> {
    return this.addSeries({ ...config, mode: "scatter" }, style);
  }

  /** Add a bar series growing from `style.baseline`. */
  addBar<D extends Dataset = Dataset>(config: TypedSeriesConfig & { readonly dataset?: D }, style?: SeriesStyleOptions): SeriesStore<D> {
    return this.addSeries({ ...config, mode: "bar" }, style);
  }

  /** Add an OHLC bar series backed by an `OhlcDataset`. */
  addOhlc<D extends Dataset = Dataset>(config: TypedSeriesConfig & { readonly dataset?: D }, style?: SeriesStyleOptions): SeriesStore<D> {
    return this.addSeries({ ...config, mode: "ohlc" }, style);
  }

  /** Add a candlestick series backed by an `OhlcDataset`. */
  addCandlestick<D extends Dataset = Dataset>(config: TypedSeriesConfig & { readonly dataset?: D }, style?: SeriesStyleOptions): SeriesStore<D> {
    return this.addSeries({ ...config, mode: "candlestick" }, style);
  }

  /**
   * Add a histogram rendered as bars. Pass raw `values` plus `HistogramOptions`,
   * or a precomputed `histogram` result. Bars default to the bin width.
   */
  addHistogram(config: HistogramSeriesConfig | PrecomputedHistogramSeriesConfig, style: SeriesStyleOptions = {}): SeriesStore<HistogramDataset> {
    const result = "values" in config ? histogram(config.values, config) : config.histogram;
    if (result.binWidth === null && style.barWidth === undefined && result.bins.length > 0) {
      throw new TypeError("Chart.addHistogram requires style.barWidth for variable-width histogram bins.");
    }

    const { id, name, yAxis, downsample } = config;
    return this.addBar(
      { id, name, yAxis, downsample, dataset: new HistogramDataset(result) },
      { ...style, barWidth: style.barWidth ?? result.binWidth ?? undefined },
    );
  }

  /** Remove a series from the chart; returns `false` when it is not attached. */
  removeSeries(series: SeriesStore): boolean {
    const index = this.series.indexOf(series);
    if (index === -1) return false;

    this.series.splice(index, 1);
    this.emitSeriesChange();
    return true;
  }

  /** Return metadata for all attached series. */
  getSeriesState(): ChartSeriesState[] {
    return this.series.map((series, index) => ({
      series,
      index,
      id: series.config.id,
      name: series.config.name,
      mode: series.config.mode,
      visible: series.visible,
      color: series.style.color,
      yAxis: series.config.yAxis ?? "left",
    }));
  }

  /** Keep the X viewport on the latest data, replacing any previous follow options. */
  followLatestX(options: ChartFollowXOptions = {}): void {
    this.followXConfig = options;
    this.clearXFollowResumeTimer();
    this.xFollowPaused = false;
    this.applyFollowXPolicy();
    this.requestRender();
  }

  /** Disable latest-X following. */
  stopFollowingLatestX(): void {
    if (!this.followXConfig && !this.xFollowPaused) return;
    this.followXConfig = null;
    this.xFollowPaused = false;
    this.clearXFollowResumeTimer();
    this.requestRender();
  }

  /** Pause or resume latest-X following without changing its options. */
  setXFollowPaused(paused: boolean): void {
    this.clearXFollowResumeTimer();
    if (this.xFollowPaused === paused) return;
    this.xFollowPaused = paused;
    if (!paused) this.applyFollowXPolicy();
    this.requestRender();
  }

  /** Return whether latest-X following is off, active, or paused by interaction. */
  getXFollowState(): ChartXFollowState {
    if (!this.followXConfig) return "off";
    return this.xFollowPaused ? "paused" : "following";
  }

  /**
   * Fit the viewport to data bounds; returns `false` when nothing changed. Padding is
   * applied in scale space, and an axis is left unchanged when its data has no valid
   * domain for the scale (e.g. non-positive values on a log axis).
   */
  fitToData(options: ChartFitToDataOptions = {}): boolean {
    const fitX = options.x !== false;
    const fitY = options.y !== false;
    if (!fitX && !fitY) return false;

    const yAxis = options.yAxis ?? "both";
    const padding = normalizeFitPadding(options.padding);
    let xMin = Infinity;
    let xMax = -Infinity;
    let leftYMin = Infinity;
    let leftYMax = -Infinity;
    let rightYMin = Infinity;
    let rightYMax = -Infinity;

    for (const series of this.candidateSeries(options)) {
      const bounds = series.dataBounds({ xMin: options.xMin, xMax: options.xMax });
      if (!bounds) continue;

      xMin = Math.min(xMin, bounds.xMin);
      xMax = Math.max(xMax, bounds.xMax);
      if (series.config.yAxis === "right") {
        rightYMin = Math.min(rightYMin, bounds.yMin);
        rightYMax = Math.max(rightYMax, bounds.yMax);
      } else {
        leftYMin = Math.min(leftYMin, bounds.yMin);
        leftYMax = Math.max(leftYMax, bounds.yMax);
      }
    }

    let changed = false;
    if (fitX && Number.isFinite(xMin) && Number.isFinite(xMax)) {
      const xDomain = paddedAxisDomain(this.axis, "x", xMin, xMax, padding.x, false);
      if (xDomain && !domainsAlmostEqual(this.camera.xMin, this.camera.xMax, xDomain.min, xDomain.max)) {
        this.camera.setViewport({ xMin: xDomain.min, xMax: xDomain.max });
        changed = true;
      }
    }
    const fitYAxis = (camera: Camera2D, controller: AxisController, min: number, max: number): void => {
      if (!Number.isFinite(min) || !Number.isFinite(max)) return;
      const domain = paddedAxisDomain(controller, "y", min, max, padding.y, options.includeZero === true);
      if (!domain || domainsAlmostEqual(camera.yMin, camera.yMax, domain.min, domain.max)) return;
      camera.setViewport({ yMin: domain.min, yMax: domain.max });
      changed = true;
    };
    if (fitY && yAxis !== "right") fitYAxis(this.camera, this.axis, leftYMin, leftYMax);
    if (fitY && yAxis !== "left") fitYAxis(this.rightCamera, this.rightAxis, rightYMin, rightYMax);

    if (changed) {
      this.syncRightCameraX();
      this.emitViewportChange();
      this.refreshHover();
    }
    return changed;
  }

  /** Resize the canvas to match its layout size and device pixel ratio. */
  resize(dpr: number = globalThis.devicePixelRatio): boolean {
    const resized = this.applyCanvasSize(dpr);
    if (resized) {
      this.refreshHover();
      this.requestRender();
    }
    return resized;
  }

  /** Copy the latest render metrics into `target` (allocation-free polling) and return it. */
  getFrameStats(target: ChartFrameStats = { fps: 0, frameMs: 0, pointsRendered: 0, drawCalls: 0, uploadBytes: 0, renderMode: "none" }): ChartFrameStats {
    return Object.assign(target, this.stats);
  }

  /** Return the latest hover state, or `null` when nothing is hovered. */
  getHoverState(): ChartHoverState | null {
    return this.currentHover;
  }

  /** Reserve or release plot-adjacent layout space for a plugin or overlay. */
  setLayoutReservation(id: string, reservation: ChartLayoutReservation | null): void {
    if (reservation) {
      this.layoutReservations.set(id, reservation);
    } else {
      this.layoutReservations.delete(id);
    }
    let top = 0;
    let right = 0;
    let bottom = 0;
    let left = 0;
    for (const value of this.layoutReservations.values()) {
      top += Math.max(0, value.top ?? 0);
      right += Math.max(0, value.right ?? 0);
      bottom += Math.max(0, value.bottom ?? 0);
      left += Math.max(0, value.left ?? 0);
    }
    this.layout.root.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    this.resize();
  }

  /** Subscribe to a chart event; returns an unsubscribe function. */
  subscribe<K extends ChartEventName>(event: K, callback: (payload: ChartEventMap[K]) => void): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  /** Emit a `select` event, e.g. from a custom selection UI. */
  emitSelect(selection: unknown): void {
    this.emit("select", { selection });
  }

  /** Replace the chart theme and re-render. */
  setTheme(theme?: ChartTheme): void {
    this.resolvedTheme = resolveChartTheme(theme, this.layout.root);
    this.layout.root.style.background = this.resolvedTheme.backgroundCssColor;
    this.axisOverlay?.setOptions({ color: this.resolvedTheme.axisColor, font: this.resolvedTheme.axisFont });
    this.updateTextOverlays();
    this.emit("themechange", undefined);
    this.requestRender();
    this.refreshHover();
  }

  /** Show or hide grid lines. */
  setGridVisible(visible: boolean): void {
    if (this.gridVisible === visible) return;
    this.gridVisible = visible;
    this.requestRender();
  }

  /** Replace axis configuration and rebuild axis overlays. */
  setAxes(axes: ChartOptions["axes"]): void {
    this.normalizedAxes = normalizeAxesConfig(axes);
    this.applyAxisDirections();
    this.axis.setOptions({ x: this.normalizedAxes.x, y: this.normalizedAxes.y });
    this.rightAxis.setOptions({ x: this.normalizedAxes.x, y: this.normalizedAxes.y2 });
    this.layout.update(this.normalizedAxes);
    this.rebuildAxisOverlay();
    this.updateTextOverlays();
    this.resize();
    this.refreshHover();
  }

  /** Hit-test a client-coordinate point against visible series. */
  pick(clientX: number, clientY: number, options: ChartPickOptions = {}): ChartHoverState | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.pickAtPlot(clientX - rect.left, clientY - rect.top, clientX, clientY, rect, options);
  }

  /** Render the chart, including DOM overlays under the chart root, to an image blob. */
  async screenshot(options: ChartScreenshotOptions = {}): Promise<Blob> {
    this.render();
    const { composeChartScreenshot } = await import("./screenshot.js");
    return composeChartScreenshot({ layout: this.layout, canvas: this.canvas, theme: this.resolvedTheme }, options);
  }

  /** Start rendering according to `options.renderLoop`. */
  start(): void {
    if (!this.running) {
      this.running = true;
      this.lastFrameAt = 0;
    }
    this.requestRender();
  }

  /** Stop rendering. Data appends keep working and render after the next `start()`. */
  stop(): void {
    this.running = false;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Schedule a frame. Chart-owned changes call this automatically. */
  requestRender(): void {
    if (!this.running || this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.running) return;
      try {
        this.render();
      } finally {
        // Keep a continuous loop alive even if one frame throws.
        if (this.running && this.options.renderLoop === "continuous") this.requestRender();
      }
    });
  }

  /** Stop rendering and release DOM, plugin, and GPU resources. */
  dispose(): void {
    this.stop();
    this.clearXFollowResumeTimer();
    this.resizeObserver?.disconnect();
    if (this.hoverRafId !== 0) cancelAnimationFrame(this.hoverRafId);
    this.hoverRafId = 0;
    if (this.restoreRenderRafId !== 0) cancelAnimationFrame(this.restoreRenderRafId);
    this.restoreRenderRafId = 0;
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("dblclick", this.handleDoubleClick);
    this.canvas.removeEventListener("webglcontextlost", this.handleWebGLContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleWebGLContextRestored);
    this.layout.root.removeEventListener("keydown", this.handleKeyDown);
    for (const dispose of this.pluginDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        // Plugin cleanup must not prevent chart-owned resources from being released.
      }
    }
    this.axisOverlay?.dispose();
    this.disposeRenderer(this.renderer);
    this.layout.dispose();
  }

  private render(): void {
    const frameStartedAt = performance.now();
    if (this.lastFrameAt > 0) {
      this.stats.fps = 1000 / (frameStartedAt - this.lastFrameAt);
    }
    this.lastFrameAt = frameStartedAt;
    this.resetFrameStats();

    if (this.webglContextLost || this.renderer.getWebGLContext()?.isContextLost() === true) {
      this.webglContextLost = true;
      return;
    }

    this.options.viewportPolicy?.beforeRender?.(this.camera);
    this.syncRightCameraX();
    this.applyFollowXPolicy();
    this.applyAutoFitYPolicy();
    if (!this.hasRenderableDomains()) return;

    try {
      const pixelRatio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
      this.renderer.beginFrame(this.canvas.width, this.canvas.height, pixelRatio);
      this.currentXOrigin = this.camera.xMin;
      this.updateTicks();
      if (this.gridVisible) this.drawGrid();

      for (const series of this.series) {
        if (!series.visible) continue;
        series.rebuildPyramid();
        this.drawSeries(series);
      }

      this.axisOverlay?.update(this.axis, this.rightAxis, this.xTicks, this.yTicks, this.y2Ticks);
      this.emit("render", undefined);
    } catch (error) {
      if (this.renderer.getWebGLContext()?.isContextLost() === true) {
        this.webglContextLost = true;
        this.resetFrameStats();
        return;
      }
      throw error;
    }

    this.stats.frameMs = performance.now() - frameStartedAt;
    if (this.hoverRafId !== 0) {
      cancelAnimationFrame(this.hoverRafId);
      this.hoverRafId = 0;
    }
    this.refreshHover();
    if (this.running && this.options.renderLoop !== "continuous" && this.followXConfig?.currentX && !this.xFollowPaused) {
      this.requestRender();
    }
  }

  /**
   * Check every axis domain against its scale. An invalid one (e.g. a camera
   * moved below zero on a log axis) skips the frame and logs once instead of
   * throwing, so the chart recovers as soon as the domain is fixed.
   */
  private hasRenderableDomains(): boolean {
    try {
      this.axis.validateDomain("x");
      this.axis.validateDomain("y");
      this.rightAxis.validateDomain("y");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.reportedDomainError) {
        this.reportedDomainError = message;
        console.error(`BlazePlot skipped rendering: ${message}`);
      }
      return false;
    }
    this.reportedDomainError = null;
    return true;
  }

  private createDefaultDataset(config: SeriesConfig): Dataset {
    const { capacity } = config;
    if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0) {
      throw new TypeError("Series capacity must be a positive integer when no dataset is provided.");
    }
    if (config.xStep !== undefined || config.xStart !== undefined) {
      if (config.overflow !== undefined && config.overflow !== "wrap") {
        throw new TypeError("Series shorthand { capacity, xStep } uses UniformRingBuffer, which supports only wrap overflow.");
      }
      return new UniformRingBuffer(capacity, { xStart: config.xStart, xStep: config.xStep });
    }
    return new RingBuffer(capacity, { overflow: config.overflow });
  }

  private resolveSeriesStyle(style: SeriesStyleOptions): SeriesStyle {
    const palette = this.resolvedTheme.seriesColors;
    const root = this.layout.root;
    const color = resolveThemeColor(style.color, palette[this.series.length % palette.length]!, root);
    const fillColor = resolveThemeColor(style.fillColor, withAlpha(color, 0.25), root);
    const barWidth = style.barWidth ?? 0.8;
    return {
      color,
      lineWidth: style.lineWidth ?? 1,
      pointSize: style.pointSize ?? 4,
      barWidth,
      baseline: style.baseline ?? 0,
      fillColor,
      tickWidth: style.tickWidth ?? barWidth,
      upColor: resolveThemeColor(style.upColor, color, root),
      downColor: resolveThemeColor(style.downColor, style.fillColor === undefined ? withAlpha(color, 0.45) : fillColor, root),
      wickColor: resolveThemeColor(style.wickColor, color, root),
    };
  }

  private handleSeriesChange(change: SeriesChange): void {
    if (change === "visibility") this.emitSeriesChange();
    else this.requestRender();
  }

  /** Attached series that pass the visibility and explicit-series filters. */
  private candidateSeries(options: { readonly series?: readonly SeriesStore[]; readonly includeHidden?: boolean }): SeriesStore[] {
    const candidates = options.series ? options.series.filter((series) => this.series.includes(series)) : this.series;
    return options.includeHidden ? candidates : candidates.filter((series) => series.visible);
  }

  private pauseXFollowForInteraction(): void {
    const config = this.followXConfig;
    if (!config || config.pauseOnInteraction === false) return;
    this.xFollowPaused = true;
    this.clearXFollowResumeTimer();
    const resumeAfterMs = config.resumeAfterMs;
    if (typeof resumeAfterMs !== "number" || !Number.isFinite(resumeAfterMs) || resumeAfterMs <= 0) return;
    this.xFollowResumeTimer = setTimeout(() => {
      this.xFollowResumeTimer = null;
      this.setXFollowPaused(false);
    }, resumeAfterMs);
  }

  private clearXFollowResumeTimer(): void {
    if (this.xFollowResumeTimer === null) return;
    clearTimeout(this.xFollowResumeTimer);
    this.xFollowResumeTimer = null;
  }

  private applyFollowXPolicy(): void {
    const config = this.followXConfig;
    if (!config || this.xFollowPaused) return;

    let xMax = -Infinity;
    for (const series of this.candidateSeries(config)) {
      const range = series.xRange;
      if (range) xMax = Math.max(xMax, range.end);
    }
    const clockX = config.currentX?.();
    if (clockX !== undefined && Number.isFinite(clockX)) xMax = Math.max(xMax, clockX);
    if (!Number.isFinite(xMax)) return;

    const span = typeof config.window === "number" && Number.isFinite(config.window) && config.window > 0
      ? config.window
      : this.camera.xMax - this.camera.xMin;
    const xMin = xMax - span;
    if (domainsAlmostEqual(this.camera.xMin, this.camera.xMax, xMin, xMax) || !this.axis.isValidDomain("x", xMin, xMax)) return;
    this.camera.setViewport({ xMin, xMax });
    this.syncRightCameraX();
    this.emitViewportChange();
  }

  private applyAutoFitYPolicy(): void {
    const option = this.options.autoFitY;
    if (!option) return;
    this.fitToData({ ...(option === true ? {} : option), x: false, xMin: this.camera.xMin, xMax: this.camera.xMax });
  }

  private createGpuResources(): ChartGpuResources {
    const backend = this.options.backendFactory?.({ canvas: this.canvas }) ?? new WebGL2Backend(this.canvas);
    const renderer = new Renderer(backend);
    try {
      return {
        renderer,
        rawLineBuffer: renderer.createFloatBuffer(this.rawLineData.length),
        barTriangleBuffer: renderer.createFloatBuffer(this.barTriangleData.length),
        gridBuffer: renderer.createFloatBuffer(this.gridData.length),
      };
    } catch (error) {
      this.disposeRenderer(renderer);
      throw error;
    }
  }

  private installGpuResources(resources: ChartGpuResources): void {
    this.renderer = resources.renderer;
    this.rawLineBuffer = resources.rawLineBuffer;
    this.barTriangleBuffer = resources.barTriangleBuffer;
    this.gridBuffer = resources.gridBuffer;
  }

  private disposeRenderer(renderer: Renderer): void {
    try {
      renderer.dispose();
    } catch {
      // A browser may reject cleanup calls while the WebGL context is lost. The
      // context-restored path recreates all GPU objects, so cleanup failures here
      // should not tear down chart state.
    }
  }

  private resetFrameStats(): void {
    this.stats.pointsRendered = 0;
    this.stats.drawCalls = 0;
    this.stats.uploadBytes = 0;
    this.stats.renderMode = "none";
  }

  private scheduleRenderAfterRestore(): void {
    if (this.restoreRenderRafId !== 0) return;
    this.restoreRenderRafId = requestAnimationFrame(() => {
      this.restoreRenderRafId = 0;
      this.render();
    });
  }

  private applyAccessibility(): void {
    const option = this.options.accessibility;
    if (option === false) return;

    const config = typeof option === "object" ? option : undefined;
    const title = [titleText(this.options.title), titleText(this.options.subtitle)].filter(Boolean).join(" — ");
    const root = this.layout.root;
    if (root.tabIndex < 0) root.tabIndex = 0;
    root.setAttribute("role", config?.role ?? "img");
    root.setAttribute("aria-label", config?.label ?? (title || "BlazePlot chart"));
    if (config?.description) root.setAttribute("aria-description", config.description);
    this.layout.plot.setAttribute("role", "presentation");
    for (const element of [this.canvas, this.xAxisElement, this.yAxisElement, this.y2AxisElement]) {
      element.setAttribute("aria-hidden", "true");
    }
  }

  private keyboardOptions(): Required<ChartKeyboardOptions> | null {
    const accessibility = this.options.accessibility;
    if (accessibility === false) return null;
    const keyboard = typeof accessibility === "object" ? accessibility.keyboard : undefined;
    if (keyboard === false) return null;
    const config = typeof keyboard === "object" ? keyboard : undefined;
    const panFraction = config?.panFraction;
    const zoomFactor = config?.zoomFactor;
    return {
      panFraction: typeof panFraction === "number" && Number.isFinite(panFraction) ? Math.max(0, panFraction) : 0.1,
      zoomFactor: typeof zoomFactor === "number" && Number.isFinite(zoomFactor) && zoomFactor > 1 ? zoomFactor : 1.25,
    };
  }

  private handleKeyboardNavigation(event: KeyboardEvent): void {
    const keyboard = this.keyboardOptions();
    if (!keyboard || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

    const panStep = keyboard.panFraction * (event.shiftKey ? 2.5 : 1);
    const zoomAtCenter = (factor: number, axis: ZoomIntent["axis"]): void => this.zoom({ factor, cx: 0.5, cy: 0.5, axis });
    let handled = true;

    switch (event.key) {
      case "ArrowLeft":
        this.pan({ dx: -panStep, dy: 0 });
        break;
      case "ArrowRight":
        this.pan({ dx: panStep, dy: 0 });
        break;
      case "ArrowUp":
        this.pan({ dx: 0, dy: panStep });
        break;
      case "ArrowDown":
        this.pan({ dx: 0, dy: -panStep });
        break;
      case "+":
      case "=":
        zoomAtCenter(keyboard.zoomFactor, "xy");
        break;
      case "-":
      case "_":
        zoomAtCenter(1 / keyboard.zoomFactor, "xy");
        break;
      case "PageUp":
        zoomAtCenter(keyboard.zoomFactor, "y");
        break;
      case "PageDown":
        zoomAtCenter(1 / keyboard.zoomFactor, "y");
        break;
      case "Home":
      case "0":
        handled = this.fitToData({ padding: 0.05 });
        break;
      default:
        handled = false;
        break;
    }

    if (handled) event.preventDefault();
  }

  private rebuildAxisOverlay(): void {
    this.axisOverlay?.dispose();
    const axes = this.normalizedAxes;
    this.axisOverlay = axes.x.visible || axes.y.visible || axes.y2.visible
      ? new AxisOverlay(this.layout, axes, { color: this.resolvedTheme.axisColor, font: this.resolvedTheme.axisFont })
      : null;
  }

  private updateTextOverlays(): void {
    const theme = this.resolvedTheme;
    this.applyChartTitle(this.layout.title, this.options.title, theme.titleColor, theme.titleFont, TITLE_TOP_PX);
    this.applyChartTitle(this.layout.subtitle, this.options.subtitle, theme.subtitleColor, theme.subtitleFont, SUBTITLE_TOP_PX);
    this.applyAxisTitle(this.layout.xAxisTitle, this.normalizedAxes.x.title, "x");
    this.applyAxisTitle(this.layout.yAxisTitle, this.normalizedAxes.y.title, "y");
    this.applyAxisTitle(this.layout.y2AxisTitle, this.normalizedAxes.y2.title, "y2");
  }

  /** Set text and theme styling on a title element; returns the custom config when visible. */
  private applyTitleText(el: HTMLElement, config: string | TextOverlayConfig | undefined, color: string, font: string): TextOverlayConfig | null {
    const text = titleText(config);
    el.textContent = text;
    el.style.display = text ? "block" : "none";
    if (!text) return null;
    const custom = typeof config === "string" ? { text } : config!;
    el.style.color = custom.color ?? color;
    el.style.font = custom.font ?? font;
    return custom;
  }

  private applyChartTitle(el: HTMLElement, config: string | ChartTitleConfig | undefined, color: string, font: string, top: number): void {
    const custom = this.applyTitleText(el, config, color, font) as ChartTitleConfig | null;
    if (!custom) return;

    const align = custom.align ?? "center";
    const offsetX = custom.offsetX ?? 0;
    const style = el.style;
    style.top = `${top + (custom.offsetY ?? 0)}px`;
    style.left = align === "left" ? `${TITLE_SIDE_INSET_PX + offsetX}px` : align === "right" ? "auto" : `calc(50% + ${offsetX}px)`;
    style.right = align === "right" ? `${TITLE_SIDE_INSET_PX - offsetX}px` : "auto";
    style.transform = align === "center" ? "translateX(-50%)" : "none";
    style.textAlign = align;
  }

  private applyAxisTitle(el: HTMLElement, config: string | TextOverlayConfig | undefined, axis: "x" | "y" | "y2"): void {
    const custom = this.applyTitleText(el, config, this.resolvedTheme.axisTitleColor, this.resolvedTheme.axisTitleFont);
    if (!custom) return;

    const offsetX = custom.offsetX ?? 0;
    const offsetY = custom.offsetY ?? 0;
    const style = el.style;
    if (axis === "x") {
      style.left = `calc(50% + ${offsetX}px)`;
      style.bottom = `${AXIS_TITLE_INSET_PX - offsetY}px`;
      style.transform = "translateX(-50%)";
    } else if (axis === "y") {
      style.left = `${AXIS_TITLE_INSET_PX + offsetX}px`;
      style.top = `calc(50% + ${offsetY}px)`;
      style.transform = "translateY(-50%) rotate(-90deg)";
    } else {
      style.right = `${AXIS_TITLE_INSET_PX - offsetX}px`;
      style.top = `calc(50% + ${offsetY}px)`;
      style.transform = "translateY(-50%) rotate(90deg)";
    }
  }

  private applyCanvasSize(dpr: number = globalThis.devicePixelRatio): boolean {
    const scale = Number.isFinite(dpr) ? Math.max(1, dpr) : 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * scale));
    if (this.canvas.width === width && this.canvas.height === height) return false;

    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  private controllerFor(yAxis: SeriesYAxis | undefined): AxisController {
    return yAxis === "right" ? this.rightAxis : this.axis;
  }

  private insidePlot(plotX: number, plotY: number, rect: PlotRect): boolean {
    return rect.width > 0 && rect.height > 0 && plotX >= 0 && plotY >= 0 && plotX <= rect.width && plotY <= rect.height;
  }

  private plotToData(plotX: number, plotY: number, rect: PlotRect, controller: AxisController): [number, number] {
    return [
      controller.clipToValue((plotX / rect.width) * 2 - 1, "x"),
      controller.clipToValue(1 - (plotY / rect.height) * 2, "y"),
    ];
  }

  private projectionFor(yAxis: SeriesYAxis | undefined): RenderProjection {
    const right = yAxis === "right";
    const camera = right ? this.rightCamera : this.camera;
    const controller = right ? this.rightAxis : this.axis;
    const projection = right ? this.rightProjection : this.leftProjection;
    const scaledOrigin = controller.scaleValue(this.currentXOrigin, "x");
    const xMin = controller.scaleValue(camera.xMin, "x") - scaledOrigin;
    const xMax = controller.scaleValue(camera.xMax, "x") - scaledOrigin;
    const yMin = controller.scaleValue(camera.yMin, "y");
    const yMax = controller.scaleValue(camera.yMax, "y");
    projection.scaleX = (camera.xReversed ? -2 : 2) / (xMax - xMin);
    projection.scaleY = (camera.yReversed ? -2 : 2) / (yMax - yMin);
    projection.offsetX = (camera.xReversed ? 1 : -1) * (xMin + xMax) / (xMax - xMin);
    projection.offsetY = (camera.yReversed ? 1 : -1) * (yMin + yMax) / (yMax - yMin);
    return projection;
  }

  /** Whether both Y axes share a screen direction, so left-domain Y anchors map 1:1 onto the right axis. */
  private rightYDirectionMatchesLeft(): boolean {
    return this.camera.yReversed === this.rightCamera.yReversed;
  }

  private syncRightCameraX(): void {
    this.rightCamera.setViewport({ xMin: this.camera.xMin, xMax: this.camera.xMax });
    this.rightCamera.setReversed({ x: this.camera.xReversed });
  }

  private applyAxisDirections(): void {
    const xReversed = this.normalizedAxes.x.reversed === true;
    this.camera.setReversed({ x: xReversed, y: this.normalizedAxes.y.reversed === true });
    this.rightCamera.setReversed({ x: xReversed, y: this.normalizedAxes.y2.reversed === true });
  }

  /** Compute tick values once per frame for both grid lines and axis labels. */
  private updateTicks(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const axes = this.normalizedAxes;
    if (this.gridVisible || axes.x.visible) this.axis.getXTickValues(width, X_TICK_LIMIT, this.xTicks);
    else this.xTicks.length = 0;
    if (this.gridVisible || axes.y.visible) this.axis.getYTickValues(height, Y_TICK_LIMIT, this.yTicks);
    else this.yTicks.length = 0;
    if (axes.y2.visible) this.rightAxis.getYTickValues(height, Y_TICK_LIMIT, this.y2Ticks);
    else this.y2Ticks.length = 0;
  }

  private drawGrid(): void {
    let vertexCount = 0;
    const pushLine = (x0: number, y0: number, x1: number, y1: number): boolean => {
      if (vertexCount + 2 > GRID_LINE_VERTEX_CAPACITY) return false;
      const offset = vertexCount * 2;
      this.gridData[offset] = x0;
      this.gridData[offset + 1] = y0;
      this.gridData[offset + 2] = x1;
      this.gridData[offset + 3] = y1;
      vertexCount += 2;
      return true;
    };
    for (const x of this.xTicks) {
      const clipX = this.axis.valueToClip(x, "x");
      if (!pushLine(clipX, -1, clipX, 1)) break;
    }
    for (const y of this.yTicks) {
      const clipY = this.axis.valueToClip(y, "y");
      if (!pushLine(-1, clipY, 1, clipY)) break;
    }
    if (vertexCount === 0) return;

    this.uploadFloatData(this.gridBuffer, this.gridData, vertexCount * 2);
    this.renderer.drawClipLines(this.gridBuffer, vertexCount, this.resolvedTheme.gridColor);
    this.stats.drawCalls++;
  }

  private drawSeries(series: SeriesStore): void {
    const viewport = this.getCamera(series.config.yAxis).viewport;
    const projection = this.projectionFor(series.config.yAxis);
    switch (series.config.mode) {
      case "area":
        this.drawAreaSeries(series, viewport, projection);
        return;
      case "bar":
        this.drawBarSeries(series, viewport, projection);
        return;
      case "ohlc":
        this.drawOhlcSeries(series, viewport, projection);
        return;
      case "candlestick":
        this.drawCandlestickSeries(series, viewport, projection);
        return;
      case "scatter":
        this.drawScatterSeries(series, viewport, projection);
        return;
      default:
        this.drawLineSeries(series, viewport, projection);
    }
  }

  private drawLineSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const dense = series.hasServerMinMax || (series.downsampled && series.visibleSampleCount(viewport) > RAW_LINE_VERTEX_CAPACITY - 2);
    if (dense) {
      const bucketCount = series.copyMinMaxInstanced(viewport, this.minMaxBucketData, BAR_TRIANGLE_CAPACITY, this.currentXOrigin);
      this.padBucketsToLineWidth(bucketCount, viewport, series);
      this.drawBucketColumns(bucketCount, viewport, series.style.color, projection, "minmax");
      return;
    }

    const count = series.copyRawVisibleClipped(viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY, this.currentXOrigin);
    this.drawRawLine(count, series.style, projection, "raw");
  }

  private drawAreaSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const range = series.visibleIndexRange(viewport, 1);
    if (range.end - range.start < 2) return;

    const { style } = series;
    if (range.end - range.start > AREA_POINT_CAPACITY) {
      this.drawAreaFill(series.copyAreaVisible(viewport, this.rawLineData, AREA_POINT_CAPACITY, style.baseline, this.currentXOrigin), style, projection);
      this.drawRawLine(series.copyRawVisible(viewport, this.rawLineData, AREA_POINT_CAPACITY, this.currentXOrigin), style, projection, "area");
      return;
    }

    for (let start = range.start; start < range.end;) {
      const vertexCount = series.copyAreaRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY, style.baseline, this.currentXOrigin);
      if (vertexCount < 4) break;
      this.drawAreaFill(vertexCount, style, projection);
      start += Math.max(1, (vertexCount >> 1) - 1);
    }

    for (let start = range.start; start < range.end;) {
      const vertexCount = series.copyRawRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY, this.currentXOrigin);
      if (vertexCount < 2) break;
      this.drawRawLine(vertexCount, style, projection, "area");
      start += Math.max(1, vertexCount - 1);
    }
  }

  private drawOhlcSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const range = series.visibleIndexRange(viewport);
    const maxCandles = Math.min(Math.floor(this.rawLineData.length / FLOATS_PER_OHLC_TUPLE), BAR_TRIANGLE_CAPACITY);
    const { style } = series;

    for (let start = range.start; start < range.end;) {
      const candleCount = series.copyOhlcTuplesRange(start, range.end, this.rawLineData, maxCandles, this.currentXOrigin);
      if (candleCount <= 0) break;

      this.drawOhlcTicks(candleCount, style.tickWidth, true, style.upColor, style.lineWidth, projection);
      this.drawOhlcTicks(candleCount, style.tickWidth, false, style.downColor, style.lineWidth, projection);
      start += candleCount;
    }
  }

  private drawCandlestickSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const range = series.visibleIndexRange(viewport, 1);
    const maxCandles = Math.min(Math.floor(this.rawLineData.length / FLOATS_PER_OHLC_TUPLE), BAR_TRIANGLE_CAPACITY);
    const { style } = series;

    for (let start = range.start; start < range.end;) {
      const candleCount = series.copyOhlcTuplesRange(start, range.end, this.rawLineData, maxCandles, this.currentXOrigin);
      if (candleCount <= 0) break;

      for (let i = 0; i < candleCount; i++) {
        const src = i * FLOATS_PER_OHLC_TUPLE;
        const x = this.rawLineData[src]!;
        const dst = i * 4;
        this.barTriangleData[dst] = x;
        this.barTriangleData[dst + 1] = this.rawLineData[src + 3]!;
        this.barTriangleData[dst + 2] = x;
        this.barTriangleData[dst + 3] = this.rawLineData[src + 2]!;
      }
      this.uploadBarTriangleData(candleCount * 2, projection);
      this.renderer.drawLines(this.barTriangleBuffer, candleCount * 2, style.wickColor, style.lineWidth, projection, "lines");
      this.recordDraw("raw", candleCount * 2);

      this.drawCandlestickBodies(candleCount, style.barWidth, true, style.upColor, projection);
      this.drawCandlestickBodies(candleCount, style.barWidth, false, style.downColor, projection);
      start += candleCount;
    }
  }

  private drawScatterSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const { style } = series;
    if (series.config.downsample === "none" && series.visibleSampleCount(viewport) <= MAX_EXACT_SCATTER_POINTS) {
      const range = series.visibleIndexRange(viewport);
      for (let start = range.start; start < range.end; start += RAW_LINE_VERTEX_CAPACITY) {
        const end = Math.min(range.end, start + RAW_LINE_VERTEX_CAPACITY);
        const count = series.copyScatterRange(start, end, viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY, this.currentXOrigin, this.canvas.height, style.pointSize);
        this.drawPointBatch(count, style, projection);
      }
      return;
    }

    const count = series.copyScatterVisible(viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY, this.canvas.width, this.canvas.height, style.pointSize, this.currentXOrigin);
    this.drawPointBatch(count, style, projection);
  }

  private drawBarSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const { style } = series;
    const rawBarCapacity = this.renderer.supportsInstancing ? RAW_LINE_VERTEX_CAPACITY : BAR_TRIANGLE_CAPACITY;
    if (series.downsampled && series.visibleSampleCount(viewport) > rawBarCapacity) {
      const bucketCount = series.copyMinMaxInstanced(viewport, this.minMaxBucketData, BAR_TRIANGLE_CAPACITY, this.currentXOrigin);
      for (let i = 0; i < bucketCount; i++) {
        const offset = i * FLOATS_PER_MINMAX_BUCKET;
        this.minMaxBucketData[offset + 1] = Math.min(style.baseline, this.minMaxBucketData[offset + 1]!);
        this.minMaxBucketData[offset + 2] = Math.max(style.baseline, this.minMaxBucketData[offset + 2]!);
      }
      this.drawBucketColumns(bucketCount, viewport, style.color, projection, "bars");
      return;
    }

    const range = series.visibleIndexRange(viewport, 1);
    const count = series.copyRawRange(range.start, range.end, this.rawLineData, rawBarCapacity, this.currentXOrigin);
    if (count <= 0) return;

    const controller = this.controllerFor(series.config.yAxis);
    if (this.renderer.supportsInstancing && !controller.isNonlinear("x") && !controller.isNonlinear("y")) {
      this.uploadRawLineData(count, projection);
      this.renderer.drawBarsInstanced(this.rawLineBuffer, count, style, projection);
      this.recordDraw("bars", count);
      return;
    }

    const barCount = Math.min(count, BAR_TRIANGLE_CAPACITY);
    const halfWidth = style.barWidth * 0.5;
    for (let i = 0; i < barCount; i++) {
      const x = this.rawLineData[i * 2]!;
      this.writeBarTriangles(i, x - halfWidth, x + halfWidth, style.baseline, this.rawLineData[i * 2 + 1]!);
    }
    this.drawTriangleBatch(barCount * 6, style.color, projection, "bars");
  }

  private drawRawLine(vertexCount: number, style: SeriesStyle, projection: RenderProjection, mode: DrawMode): void {
    if (vertexCount < 2) return;
    this.uploadRawLineData(vertexCount, projection);
    this.renderer.drawLines(this.rawLineBuffer, vertexCount, style.color, style.lineWidth, projection);
    this.recordDraw(mode, vertexCount);
  }

  private drawAreaFill(vertexCount: number, style: SeriesStyle, projection: RenderProjection): void {
    if (vertexCount < 4) return;
    this.uploadRawLineData(vertexCount, projection);
    this.renderer.drawTriangles(this.rawLineBuffer, vertexCount, style.fillColor, projection, "triangle_strip");
    this.recordDraw("area", vertexCount);
  }

  private drawPointBatch(count: number, style: SeriesStyle, projection: RenderProjection): void {
    if (count <= 0) return;
    this.uploadRawLineData(count, projection);
    this.renderer.drawPoints(this.rawLineBuffer, count, style.color, style.pointSize, projection);
    this.recordDraw("points", count);
  }

  /** Grow min/max buckets to at least `lineWidth` CSS pixels tall so flat stretches of dense lines stay visible. */
  private padBucketsToLineWidth(bucketCount: number, viewport: Viewport, series: SeriesStore): void {
    const controller = this.controllerFor(series.config.yAxis);
    const scaledMin = controller.scaleValue(viewport.yMin, "y");
    const scaledMax = controller.scaleValue(viewport.yMax, "y");
    const halfHeight = (series.style.lineWidth * 0.5 * Math.abs(scaledMax - scaledMin)) / Math.max(1, this.canvas.clientHeight);
    const data = this.minMaxBucketData;
    for (let i = 0; i < bucketCount; i++) {
      const offset = i * FLOATS_PER_MINMAX_BUCKET;
      const low = controller.scaleValue(data[offset + 1]!, "y");
      const high = controller.scaleValue(data[offset + 2]!, "y");
      if (high - low >= halfHeight * 2) continue;
      const center = (low + high) * 0.5;
      data[offset + 1] = controller.unscaleValue(center - halfHeight, "y");
      data[offset + 2] = controller.unscaleValue(center + halfHeight, "y");
    }
  }

  /** Expand `[x, minY, maxY]` buckets into columns spanning the full bucket width so dense data has no gaps. */
  private drawBucketColumns(bucketCount: number, viewport: Viewport, color: RgbaColor, projection: RenderProjection, mode: DrawMode): void {
    const count = Math.min(bucketCount, BAR_TRIANGLE_CAPACITY);
    if (count <= 0) return;

    const data = this.minMaxBucketData;
    const viewportXMin = viewport.xMin - this.currentXOrigin;
    const viewportXMax = viewport.xMax - this.currentXOrigin;
    for (let i = 0; i < count; i++) {
      const x = data[i * 3]!;
      let x0: number;
      let x1: number;
      if (count === 1) {
        const halfWidth = Math.max(0, (viewportXMax - viewportXMin) * 0.5);
        x0 = x - halfWidth;
        x1 = x + halfWidth;
      } else {
        const prevX = i > 0 ? data[(i - 1) * 3]! : NaN;
        const nextX = i + 1 < count ? data[(i + 1) * 3]! : NaN;
        x0 = i === 0 ? x - (nextX - x) * 0.5 : (prevX + x) * 0.5;
        x1 = i + 1 === count ? x + (x - prevX) * 0.5 : (x + nextX) * 0.5;
        if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) {
          const bucketWidth = (viewportXMax - viewportXMin) / count;
          x0 = viewportXMin + i * bucketWidth;
          x1 = i + 1 === count ? viewportXMax : x0 + bucketWidth;
        }
      }
      this.writeBarTriangles(i, Math.max(viewportXMin, x0), Math.min(viewportXMax, x1), data[i * 3 + 1]!, data[i * 3 + 2]!);
    }
    this.drawTriangleBatch(count * 6, color, projection, mode);
  }

  private drawOhlcTicks(candleCount: number, tickWidth: number, rising: boolean, color: RgbaColor, lineWidth: number, projection: RenderProjection): void {
    const halfTick = tickWidth * 0.5;
    const out = this.barTriangleData;
    let vertexCount = 0;
    for (let i = 0; i < candleCount; i++) {
      const src = i * FLOATS_PER_OHLC_TUPLE;
      const x = this.rawLineData[src]!;
      const open = this.rawLineData[src + 1]!;
      const close = this.rawLineData[src + 4]!;
      if ((close >= open) !== rising) continue;

      const dst = vertexCount * 2;
      out[dst] = x;
      out[dst + 1] = this.rawLineData[src + 3]!;
      out[dst + 2] = x;
      out[dst + 3] = this.rawLineData[src + 2]!;
      out[dst + 4] = x - halfTick;
      out[dst + 5] = open;
      out[dst + 6] = x;
      out[dst + 7] = open;
      out[dst + 8] = x;
      out[dst + 9] = close;
      out[dst + 10] = x + halfTick;
      out[dst + 11] = close;
      vertexCount += 6;
    }

    if (vertexCount <= 0) return;
    this.uploadBarTriangleData(vertexCount, projection);
    this.renderer.drawLines(this.barTriangleBuffer, vertexCount, color, lineWidth, projection, "lines");
    this.recordDraw("raw", vertexCount);
  }

  private drawCandlestickBodies(candleCount: number, bodyWidth: number, rising: boolean, color: RgbaColor, projection: RenderProjection): void {
    const halfWidth = bodyWidth * 0.5;
    let bodyCount = 0;
    for (let i = 0; i < candleCount && bodyCount < BAR_TRIANGLE_CAPACITY; i++) {
      const src = i * FLOATS_PER_OHLC_TUPLE;
      const x = this.rawLineData[src]!;
      const open = this.rawLineData[src + 1]!;
      const close = this.rawLineData[src + 4]!;
      if ((close >= open) !== rising) continue;

      this.writeBarTriangles(bodyCount, x - halfWidth, x + halfWidth, Math.min(open, close), Math.max(open, close));
      bodyCount++;
    }

    this.drawTriangleBatch(bodyCount * 6, color, projection, "bars");
  }

  /** Write the two triangles of the axis-aligned rectangle `[x0, x1] x [y0, y1]` into bar slot `index`. */
  private writeBarTriangles(index: number, x0: number, x1: number, y0: number, y1: number): void {
    const out = this.barTriangleData;
    const o = index * FLOATS_PER_BAR_TRIANGLES;
    out[o] = x0;
    out[o + 1] = y0;
    out[o + 2] = x1;
    out[o + 3] = y0;
    out[o + 4] = x0;
    out[o + 5] = y1;
    out[o + 6] = x0;
    out[o + 7] = y1;
    out[o + 8] = x1;
    out[o + 9] = y0;
    out[o + 10] = x1;
    out[o + 11] = y1;
  }

  private drawTriangleBatch(vertexCount: number, color: RgbaColor, projection: RenderProjection, mode: DrawMode): void {
    if (vertexCount <= 0) return;
    this.uploadBarTriangleData(vertexCount, projection);
    this.renderer.drawTriangles(this.barTriangleBuffer, vertexCount, color, projection, "triangles");
    this.recordDraw(mode, vertexCount);
  }

  /** Apply nonlinear (log/symlog/...) axis scales on the CPU; linear scales are handled by the projection. */
  private transformVertices(data: Float32Array, vertexCount: number, projection: RenderProjection): void {
    const controller = projection === this.rightProjection ? this.rightAxis : this.axis;
    const transformX = controller.isNonlinear("x");
    const transformY = controller.isNonlinear("y");
    if (!transformX && !transformY) return;

    const scaledOrigin = transformX ? controller.scaleValue(this.currentXOrigin, "x") : 0;
    for (let i = 0; i < vertexCount; i++) {
      const offset = i * 2;
      if (transformX) data[offset] = controller.scaleValue(data[offset]! + this.currentXOrigin, "x") - scaledOrigin;
      if (transformY) data[offset + 1] = controller.scaleValue(data[offset + 1]!, "y");
    }
  }

  private uploadRawLineData(vertexCount: number, projection: RenderProjection): void {
    this.transformVertices(this.rawLineData, vertexCount, projection);
    this.uploadFloatData(this.rawLineBuffer, this.rawLineData, vertexCount * 2);
  }

  private uploadBarTriangleData(vertexCount: number, projection: RenderProjection): void {
    this.transformVertices(this.barTriangleData, vertexCount, projection);
    this.uploadFloatData(this.barTriangleBuffer, this.barTriangleData, vertexCount * 2);
  }

  private uploadFloatData(buffer: GpuBuffer, data: Float32Array, floatCount: number): void {
    const count = Math.max(0, Math.min(floatCount, data.length));
    this.renderer.updateFloatBuffer(buffer, data, count);
    this.stats.uploadBytes += count * Float32Array.BYTES_PER_ELEMENT;
  }

  private recordDraw(mode: DrawMode, points: number): void {
    this.stats.renderMode = this.stats.renderMode === "none" || this.stats.renderMode === mode ? mode : "mixed";
    this.stats.pointsRendered += points;
    this.stats.drawCalls++;
  }

  private pickAtPlot(
    plotX: number,
    plotY: number,
    clientX: number,
    clientY: number,
    rect: PlotRect,
    options: ChartPickOptions = {},
  ): ChartHoverState | null {
    if (!this.insidePlot(plotX, plotY, rect)) return null;

    const [dataX, dataY] = this.plotToData(plotX, plotY, rect, this.axis);
    const mode = options.mode ?? this.options.hover?.mode ?? "nearest-x";
    const group = options.group ?? this.options.hover?.group ?? "x";
    const maxDistancePx = options.maxDistancePx ?? this.options.hover?.maxDistancePx ?? Infinity;
    const selected = mode === "nearest-point"
      ? this.findNearestPointCandidate(dataX, plotY, rect, maxDistancePx)
      : this.findNearestXCandidate(dataX, rect.width, maxDistancePx);
    if (!selected) return null;

    const anchorX = selected.sample.x;
    const items = group === "none"
      ? [this.createPickItem(selected.sample, selected.series, selected.seriesIndex, clientX, clientY, rect)]
      : this.collectPickItems(anchorX, clientX, clientY, rect);
    return { clientX, clientY, plotX, plotY, dataX, dataY, anchorX, mode, group, maxDistancePx, items };
  }

  private findNearestXCandidate(dataX: number, plotWidth: number, maxDistancePx: number): PickCandidate | null {
    let best: PickCandidate | null = null;
    let bestDistancePx = Infinity;

    for (let seriesIndex = 0; seriesIndex < this.series.length; seriesIndex++) {
      const series = this.series[seriesIndex]!;
      if (!series.visible) continue;
      const viewport = this.getCamera(series.config.yAxis).viewport;
      const controller = this.controllerFor(series.config.yAxis);
      const sample = series.nearestSampleByX(dataX, viewport);
      if (!sample) continue;
      const xScale = plotWidth / (controller.scaleValue(viewport.xMax, "x") - controller.scaleValue(viewport.xMin, "x"));
      const distancePx = Math.abs(controller.scaleValue(sample.x, "x") - controller.scaleValue(dataX, "x")) * xScale;
      if (distancePx < bestDistancePx) {
        best = { sample, series, seriesIndex };
        bestDistancePx = distancePx;
      }
    }

    return best && bestDistancePx <= maxDistancePx ? best : null;
  }

  private findNearestPointCandidate(dataX: number, plotY: number, rect: PlotRect, maxDistancePx: number): PickCandidate | null {
    let best: PickCandidate | null = null;
    for (let seriesIndex = 0; seriesIndex < this.series.length; seriesIndex++) {
      const series = this.series[seriesIndex]!;
      if (!series.visible) continue;
      const viewport = this.getCamera(series.config.yAxis).viewport;
      const controller = this.controllerFor(series.config.yAxis);
      const dataY = controller.clipToValue(1 - (plotY / rect.height) * 2, "y");
      const sample = series.nearestSampleByPoint(
        dataX,
        dataY,
        viewport,
        rect.width,
        rect.height,
        maxDistancePx,
        controller.isNonlinear("x") ? (value) => controller.scaleValue(value, "x") : undefined,
        controller.isNonlinear("y") ? (value) => controller.scaleValue(value, "y") : undefined,
      );
      if (!sample) continue;
      if (!best || (sample.distancePx ?? Infinity) < (best.sample.distancePx ?? Infinity)) {
        best = { sample, series, seriesIndex };
      }
    }

    return best && (best.sample.distancePx ?? Infinity) <= maxDistancePx ? best : null;
  }

  private collectPickItems(anchorX: number, clientX: number, clientY: number, rect: PlotRect): ChartPickItem[] {
    const items: ChartPickItem[] = [];
    for (let seriesIndex = 0; seriesIndex < this.series.length; seriesIndex++) {
      const series = this.series[seriesIndex]!;
      if (!series.visible) continue;
      const sample = series.nearestSampleByX(anchorX, this.getCamera(series.config.yAxis).viewport);
      if (sample) items.push(this.createPickItem(sample, series, seriesIndex, clientX, clientY, rect));
    }
    return items;
  }

  private createPickItem(
    sample: SeriesSample,
    series: SeriesStore,
    seriesIndex: number,
    clientX: number,
    clientY: number,
    rect: PlotRect,
  ): ChartPickItem {
    const yAxis = series.config.yAxis;
    const controller = this.controllerFor(yAxis);
    const [plotX, plotY] = this.getCamera(yAxis).toScreen(
      controller.valueToClip(sample.x, "x"),
      controller.valueToClip(sample.y, "y"),
      rect.width,
      rect.height,
    );
    const itemClientX = rect.left + plotX;
    const itemClientY = rect.top + plotY;
    const xRange = series.xRangeAt(sample.index);
    return {
      index: sample.index,
      x: sample.x,
      y: sample.y,
      ...(xRange ? { xRange } : {}),
      distancePx: Math.hypot(itemClientX - clientX, itemClientY - clientY),
      series,
      seriesIndex,
      id: series.config.id,
      name: series.config.name,
      mode: series.config.mode,
      plotX,
      plotY,
      clientX: itemClientX,
      clientY: itemClientY,
    };
  }

  private scheduleHoverRefresh(): void {
    if (this.hoverRafId !== 0) return;
    this.hoverRafId = requestAnimationFrame(() => {
      this.hoverRafId = 0;
      this.refreshHover();
    });
  }

  /** Re-pick under the last pointer position; while a button is held, keep the same items and only reproject them. */
  private refreshHover(): void {
    if (!this.pointerInPlot) return;
    const rect: PlotRect = {
      left: this.lastPointerClientX - this.lastPointerPlotX,
      top: this.lastPointerClientY - this.lastPointerPlotY,
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    };
    if (this.lastPointerButtons !== 0) {
      this.setHover(this.reprojectHoverState(this.currentHover, rect));
      return;
    }
    this.setHover(this.pickAtPlot(this.lastPointerPlotX, this.lastPointerPlotY, this.lastPointerClientX, this.lastPointerClientY, rect));
  }

  private reprojectHoverState(state: ChartHoverState | null, rect: PlotRect): ChartHoverState | null {
    if (!state || state.items.length === 0 || rect.width <= 0 || rect.height <= 0) return null;
    const items: ChartPickItem[] = [];
    for (const item of state.items) {
      if (item.series.visible) items.push(this.createPickItem(item, item.series, item.seriesIndex, this.lastPointerClientX, this.lastPointerClientY, rect));
    }
    const anchor = items[0];
    if (!anchor || !this.insidePlot(anchor.plotX, anchor.plotY, rect)) return null;

    return {
      ...state,
      clientX: this.lastPointerClientX,
      clientY: this.lastPointerClientY,
      plotX: this.lastPointerPlotX,
      plotY: this.lastPointerPlotY,
      items,
    };
  }

  private setHover(state: ChartHoverState | null): void {
    this.currentHover = state;
    this.emit("hover", state);
  }

  private emitPointerEvent(type: ChartPointerEventType, source: MouseEvent | PointerEvent): ChartPointerEventState | null {
    const rect = this.canvas.getBoundingClientRect();
    const plotX = source.clientX - rect.left;
    const plotY = source.clientY - rect.top;
    if (!this.insidePlot(plotX, plotY, rect)) return null;

    const [dataX, dataY] = this.plotToData(plotX, plotY, rect, this.axis);
    const hover = this.pickAtPlot(plotX, plotY, source.clientX, source.clientY, rect, this.options.hover);
    const event: ChartPointerEventState = {
      type,
      clientX: source.clientX,
      clientY: source.clientY,
      plotX,
      plotY,
      dataX,
      dataY,
      button: source.button,
      buttons: source.buttons,
      altKey: source.altKey,
      ctrlKey: source.ctrlKey,
      metaKey: source.metaKey,
      shiftKey: source.shiftKey,
      items: hover?.items ?? [],
    };
    this.emit(type, event);
    return event;
  }

  private emitViewportChange(): void {
    this.emit("viewportchange", { viewport: this.camera.viewport, rightViewport: this.rightCamera.viewport });
    this.requestRender();
  }

  private emitSeriesChange(): void {
    this.emit("serieschange", undefined);
    this.refreshHover();
    this.requestRender();
  }

  private hasListeners(event: ChartEventName): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  private emit<K extends ChartEventName>(event: K, payload: ChartEventMap[K]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) (listener as Listener<K>)(payload);
  }
}
