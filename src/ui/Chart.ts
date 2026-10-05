import type { SeriesConfig, SeriesStyle, SeriesStyleOptions, Dataset, SeriesYAxis, Viewport, RgbaColor } from "../core/types.js";
import { SeriesStore } from "../core/SeriesStore.js";
import type { SeriesChange } from "../core/SeriesStore.js";
import { RingBuffer } from "../core/RingBuffer.js";
import { UniformRingBuffer } from "../core/UniformRingBuffer.js";
import type { ChartRenderer, ChartRendererKind } from "../render/ChartRenderer.js";
import { Renderer } from "../render/Renderer.js";
import { SeriesPainter } from "../render/SeriesPainter.js";
import { releaseWebGLContext } from "../render/releaseWebGLContext.js";
import { webgl2Renderer } from "../render/webgl2Renderer.js";
import { Camera2D } from "../interaction/Camera2D.js";
import { AxisController } from "../interaction/AxisController.js";
import type { AxisControllerAxisOptions } from "../interaction/AxisController.js";
import type { PanIntent, ZoomIntent } from "../interaction/types.js";
import { AUTO_GUTTER_PADDING_PX, AxisOverlay, GutterTracker, X_TICK_LIMIT, Y_TICK_LIMIT } from "./AxisOverlay.js";
import { ChartLayout } from "./ChartLayout.js";
import { ChartPicker, hoverStatesEqual, insidePlot, plotToData } from "./ChartPicker.js";
import type { PlotRect } from "./ChartPicker.js";
import type { NormalizedAxisConfig } from "./ChartLayout.js";
import { forcedColorsTheme, resolveChartTheme, resolveThemeColor } from "./theme.js";
import type { ChartTheme, ResolvedChartTheme } from "./theme.js";
import { PluginHost } from "./PluginHost.js";
import type { ChartLayoutReservation, ChartPlugin } from "./PluginHost.js";
import { buildChartSummary, createSummaryMessages } from "./ChartSummary.js";
import type { ChartSummary } from "./ChartSummary.js";

const SERIES_MODES: ReadonlySet<string> = new Set(["line", "area", "scatter", "bar", "ohlc", "candlestick"]);
/** Two vertices per grid line; tick generators may add one extra tick at each edge. */
const GRID_LINE_VERTEX_CAPACITY = (X_TICK_LIMIT + 2 + Y_TICK_LIMIT + 2) * 2;
const TITLE_TOP_PX = 6;
/** Height of the subtitle line, reserved below the title. */
const SUBTITLE_ROW_PX = 20;
/** Smallest auto-sized gutter, so a short-label axis still leaves room for ticks. */
const MIN_AUTO_GUTTER_PX = 16;
const SUBTITLE_TOP_PX = 26;
const TITLE_SIDE_INSET_PX = 8;
const AXIS_TITLE_INSET_PX = 4;
/** Minimum delay between regenerated accessibility summaries while data changes. */
const SUMMARY_THROTTLE_MS = 1_000;
/** Class for content that is read by assistive technology but not drawn. */
const VISUALLY_HIDDEN_CLASS = "blazeplot-visually-hidden";
/**
 * Shared chart stylesheet: theme-aware `:focus-visible` rings for the root and every focusable
 * plugin control inside it, the visually-hidden utility, and forced-colors (high-contrast) rules
 * for DOM overlays. Selectors are global so the body-mounted tooltip is covered too.
 */
const CHART_STYLESHEET = [
  ".blazeplot-root:focus-visible{outline:2px solid var(--blazeplot-focus-ring,Highlight);outline-offset:-2px}",
  ".blazeplot-root :focus-visible{outline:2px solid var(--blazeplot-focus-ring,Highlight);outline-offset:2px}",
  `.${VISUALLY_HIDDEN_CLASS}{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important}`,
  "@media (forced-colors:active){",
  ".blazeplot-root:focus-visible,.blazeplot-root :focus-visible{outline-color:Highlight}",
  ".blazeplot-tooltip,.blazeplot-legend{border:1px solid CanvasText}",
  // Series swatches and markers carry series identity: keep their (already system) colors.
  ".blazeplot-legend-swatch,.blazeplot-pick-swatch,.blazeplot-pick-marker{forced-color-adjust:none}",
  ".blazeplot-selection-brush{border-color:Highlight!important}",
  // The navigator window is outlined; a filled wash would tint the overview series.
  ".blazeplot-navigator-window{fill:transparent}",
  "}",
].join("");
let nextSummaryId = 1;

export type { TextOverlayConfig, ChartTitleConfig, AxisConfig, ChartPickMode, ChartPickGroup, ChartPickOptions, ChartAccessibilityMessages, ChartAccessibilityOptions, ChartBackendFactoryContext, ChartBackendFactory, ChartRenderLoop, ChartOptions, TypedSeriesConfig, SeriesIdentityConfig, ChartSeriesState, ChartPickItem, ChartPointerEventType, ChartPointerEvent, ChartSeriesClickEvent, ChartViewportChangeSource, ChartViewportChangeEvent, ChartViewportGestureOptions, ChartSetViewportOptions, ChartFollowXChangeEvent, ChartSelectEvent, ChartHoverState, ChartInspectionTarget, ChartEventMap, ChartEventName, ChartScreenshotOptions, ChartFitToDataPadding, ChartFitToDataOptions, ChartAutoFitYOptions, ChartFollowXOptions, ChartFollowXState, ChartFrameStats };
import type { TextOverlayConfig, ChartTitleConfig, AxisConfig, ChartPickMode, ChartPickGroup, ChartPickOptions, ChartAccessibilityMessages, ChartAccessibilityOptions, ChartBackendFactoryContext, ChartBackendFactory, ChartRenderLoop, ChartOptions, TypedSeriesConfig, SeriesIdentityConfig, ChartSeriesState, ChartPickItem, ChartPointerEventType, ChartPointerEvent, ChartSeriesClickEvent, ChartViewportChangeSource, ChartViewportChangeEvent, ChartViewportGestureOptions, ChartSetViewportOptions, ChartFollowXChangeEvent, ChartSelectEvent, ChartHoverState, ChartInspectionTarget, ChartEventMap, ChartEventName, ChartScreenshotOptions, ChartFitToDataPadding, ChartFitToDataOptions, ChartAutoFitYOptions, ChartFollowXOptions, ChartFollowXState, ChartFrameStats } from "./ChartTypes.js";


type ResolvedAxisConfig = NormalizedAxisConfig & AxisControllerAxisOptions & { readonly title?: string | TextOverlayConfig };

type ResolvedAxesConfig = { x: ResolvedAxisConfig; y: ResolvedAxisConfig; y2: ResolvedAxisConfig };

type Listener<K extends ChartEventName> = (payload: ChartEventMap[K]) => void;

interface ChartGpuResources {
  readonly renderer: ChartRenderer;
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

/** Pad a fit domain in the axis's scale space, so log axes stay positive; `null` when no usable domain results. */
function paddedAxisDomain(controller: AxisController, axis: "x" | "y", min: number, max: number, padding: number, includeZero: boolean): { min: number; max: number } | null {
  let domain = paddedDomain(min, max, padding, includeZero);
  if (controller.isNonlinear(axis)) {
    try {
      const from = includeZero ? Math.min(0, min) : min;
      const to = includeZero ? Math.max(0, max) : max;
      const scaled = paddedDomain(controller.scaleValue(from, axis), controller.scaleValue(to, axis), padding, false);
      domain = { min: controller.unscaleValue(scaled.min, axis), max: controller.unscaleValue(scaled.max, axis) };
    } catch {
      // Custom scales without fromScreen() cannot map back; keep the linear padding.
    }
  }
  return controller.isValidDomain(axis, domain.min, domain.max) ? domain : null;
}

function paddedDomain(min: number, max: number, padding: number, includeZero: boolean): { min: number; max: number } {
  let nextMin = includeZero ? Math.min(0, min) : min;
  let nextMax = includeZero ? Math.max(0, max) : max;
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
export class Chart {
  private series: SeriesStore[] = [];
  private camera: Camera2D;
  private rightCamera: Camera2D;
  private axis: AxisController;
  private rightAxis: AxisController;
  private rendererImpl!: ChartRenderer;
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];
  private readonly y2Ticks: number[] = [];
  private axisOverlay: AxisOverlay | null = null;
  private gutterTrackers = { x: new GutterTracker(), y: new GutterTracker(), y2: new GutterTracker() };
  private normalizedAxes: ResolvedAxesConfig;
  private resolvedTheme: ResolvedChartTheme;
  private gridVisible: boolean;
  private layout: ChartLayout;
  private readonly stats: ChartFrameStats = { fps: 0, frameMs: 0, pointsRendered: 0, drawCalls: 0, uploadBytes: 0, renderMode: "none" };
  private readonly picker = new ChartPicker({
    series: () => this.series,
    camera: (yAxis) => this.getCamera(yAxis),
    controller: (yAxis) => this.controllerFor(yAxis),
    hoverDefaults: () => this.options.hover,
  });
  private readonly painter = new SeriesPainter(this.stats, GRID_LINE_VERTEX_CAPACITY);
  private resizeObserver: ResizeObserver | null = null;
  private readonly plugins: PluginHost;
  /** Listener sets keyed by event; `never` payloads let every typed listener share one map. */
  private readonly listeners = new Map<ChartEventName, Set<(payload: never) => void>>();
  private readonly layoutReservations = new Map<string, ChartLayoutReservation>();
  private currentHover: ChartHoverState | null = null;
  private lastPointerClientX: number = 0;
  private lastPointerClientY: number = 0;
  private lastPointerPlotX: number = 0;
  private lastPointerPlotY: number = 0;
  private lastPointerButtons: number = 0;
  private pointerInPlot: boolean = false;
  private lastFrameAt: number = 0;
  private followXConfig: ChartFollowXOptions | null = null;
  private xFollowPaused: boolean = false;
  private xFollowResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number = 0;
  private hoverRafId: number = 0;
  private restoreRenderRafId: number = 0;
  private running: boolean = false;
  private disposed: boolean = false;
  private webglContextLost: boolean = false;
  private domainErrorLogged: boolean = false;
  private readonly options: ChartOptions;
  /** Caller theme before forced-colors substitution; `setTheme` replaces it. */
  private userTheme: ChartTheme | undefined;
  /** Resolved caller theme; differs from `resolvedTheme` while forced colors are active. */
  private baseTheme: ResolvedChartTheme;
  private forcedColorsQuery: MediaQueryList | null = null;
  private forcedColorsActive: boolean = false;
  /** Series styles saved while forced colors replace them. */
  private readonly forcedOriginalStyles = new Map<SeriesStore, SeriesStyle>();
  /** Caller style options per series, plus the theme palette slot it follows (`null` once a color is pinned). */
  private readonly seriesStyleState = new WeakMap<SeriesStore, { options: SeriesStyleOptions; paletteIndex: number | null }>();
  private summaryElement: HTMLElement | null = null;
  private summaryTimer: ReturnType<typeof setTimeout> | null = null;
  private summaryDirty: boolean = false;
  private inspection: ChartInspectionTarget | null = null;
  private readonly handleForcedColorsChange = (): void => {
    this.applyTheme();
  };
  private readonly handleRootFocusIn = (): void => {
    if (this.summaryDirty) this.updateSummary();
  };
  private readonly flushSummary = (): void => {
    this.summaryTimer = null;
    this.updateSummary();
  };
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") {
      // A real pointer over the plot takes over from keyboard inspection.
      this.inspection = null;
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
      this.setHover(this.inspectionHoverState());
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
    this.setHover(this.inspectionHoverState());
  };
  private readonly handleWebGLContextLost = (event: Event): void => {
    event.preventDefault();
    this.webglContextLost = true;
    if (this.restoreRenderRafId !== 0) {
      this.layout.view.cancelAnimationFrame(this.restoreRenderRafId);
      this.restoreRenderRafId = 0;
    }
    this.resetFrameStats();
    this.plugins.notify("onContextLost");
  };
  private readonly handleWebGLContextRestored = (): void => {
    const oldRenderer = this.rendererImpl;
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
    this.plugins.notify("onContextRestored");
    this.scheduleRenderAfterRestore();
  };

  /** Create a chart inside `target`. Call `start()` to begin rendering. */
  constructor(target: HTMLElement, options: ChartOptions = {}) {
    this.options = options;
    this.followXConfig = options.followX ? (options.followX === true ? {} : options.followX) : null;
    this.userTheme = options.theme;
    this.baseTheme = resolveChartTheme(options.theme, target);
    this.resolvedTheme = this.baseTheme;
    this.normalizedAxes = normalizeAxesConfig(options.axes);
    this.gridVisible = options.grid !== false;

    this.layout = new ChartLayout(target, this.normalizedAxes);
    this.watchForcedColors();
    if (this.forcedColorsActive) this.resolvedTheme = forcedColorsTheme(this.baseTheme, this.layout.root);
    this.layout.root.style.background = this.resolvedTheme.backgroundCssColor;
    this.layout.root.style.setProperty("--blazeplot-focus-ring", this.resolvedTheme.focusRingColor);
    this.applyAccessibility();
    this.applyCanvasSize();
    this.camera = new Camera2D();
    this.rightCamera = new Camera2D();
    this.applyAxisDirections();
    this.axis = new AxisController(this.camera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y });
    this.rightAxis = new AxisController(this.rightCamera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y2 });
    try {
      this.installGpuResources(this.createGpuResources());
    } catch (error) {
      // E.g. no WebGL2: remove the half-built DOM and hand back a caller-supplied canvas.
      this.unwatchForcedColors();
      this.layout.dispose();
      throw error;
    }
    this.rebuildAxisOverlay();
    this.updateTextOverlays();
    this.updateSummary();

    this.toggleDomListeners("addEventListener");

    const ResizeObserverCtor = this.layout.view.ResizeObserver ?? globalThis.ResizeObserver;
    if (typeof ResizeObserverCtor !== "undefined") {
      this.resizeObserver = new ResizeObserverCtor(() => this.resize());
      this.resizeObserver.observe(this.layout.plot);
    }

    this.plugins = new PluginHost(this, {
      emit: (event, payload) => this.emit(event, payload),
      setLayoutReservation: (id, reservation) => this.setLayoutReservation(id, reservation),
      inspect: (inspectTarget) => this.inspect(inspectTarget),
      getInspection: () => this.inspection,
      formatValue: (value, axis, yAxis) => this.formatAxisValue(value, axis, yAxis),
    });
    try {
      for (const plugin of options.plugins ?? []) this.plugins.install(plugin);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /**
   * @internal Install a plugin on a live chart (tests and linked layouts). Returns a function
   * that disposes just that plugin; `dispose()` also disposes it.
   */
  installPlugin(plugin: ChartPlugin): () => void {
    return this.plugins.install(plugin);
  }

  /** Rendering backend in use: `"webgl2"` or `"canvas2d"`. */
  get renderer(): ChartRendererKind {
    return this.rendererImpl.kind;
  }

  /** @internal WebGL canvas. Plugins use `ctx.dom`, `ctx.layout`, or `ctx.unstable.canvas`. */
  get canvas(): HTMLCanvasElement {
    return this.layout.canvas;
  }

  /** Root DOM element managed by the chart, for app layout and styling. */
  get rootElement(): HTMLElement {
    return this.layout.root;
  }

  /** @internal Plot-area element. Plugins mount into the `"plot"` slot with `ctx.dom.mount`. */
  get plotElement(): HTMLElement {
    return this.layout.plot;
  }

  /** @internal X-axis element. Plugins use the `"axis-x"` surface. */
  get xAxisElement(): HTMLElement {
    return this.layout.xAxis;
  }

  /** @internal Primary Y-axis element. Plugins use the `"axis-y"` surface. */
  get yAxisElement(): HTMLElement {
    return this.layout.yAxis;
  }

  /** @internal Secondary Y-axis element. Plugins use the `"axis-y2"` surface. */
  get y2AxisElement(): HTMLElement {
    return this.layout.y2Axis;
  }

  /** Resolved theme currently used by the chart. */
  get theme(): ResolvedChartTheme {
    return this.resolvedTheme;
  }

  /** @internal WebGL2 context when the default backend is used. Plugins use `ctx.unstable.getWebGLContext()`. */
  getWebGLContext(): WebGL2RenderingContext | null {
    return this.rendererImpl.getWebGLContext();
  }

  /** @internal Camera for the requested Y axis. Plugins use `ctx.unstable.getCamera()`. */
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
    if (!insidePlot(plotX, plotY, rect)) return null;
    return plotToData(plotX, plotY, rect, this.controllerFor(yAxis));
  }

  /** Return the visible data domain for the requested Y axis. */
  getViewport(yAxis: SeriesYAxis = "left"): Viewport {
    return this.getCamera(yAxis).viewport;
  }

  /**
   * Set any viewport edges. X is shared by both Y axes; Y edges apply to `yAxis`.
   * Changing X pauses latest-X following like a user pan would.
   */
  setViewport(viewport: Partial<Viewport>, yAxis: SeriesYAxis = "left", options: ChartSetViewportOptions = {}): void {
    if (viewport.xMin !== undefined || viewport.xMax !== undefined) {
      if (options.pauseFollow !== false) this.pauseXFollowForInteraction();
      this.camera.setViewport({ xMin: viewport.xMin, xMax: viewport.xMax });
      this.syncRightCameraX();
    }
    if (viewport.yMin !== undefined || viewport.yMax !== undefined) {
      this.getCamera(yAxis).setViewport({ yMin: viewport.yMin, yMax: viewport.yMax });
    }
    this.emitViewportChange(options.source ?? "api");
    this.refreshHover();
  }

  /**
   * Pan in scale space, after `viewportPolicy.beforePan`. X always pans both axes.
   * Y pans only `yAxis` when given; omitted, Y pans both axes like a plot-area gesture.
   * The intent is normalized to the left axis domain (or `yAxis` when given).
   */
  pan(intent: PanIntent, yAxis?: SeriesYAxis, options: ChartViewportGestureOptions = {}): void {
    const policy = this.options.viewportPolicy;
    const next = policy?.beforePan ? policy.beforePan(this.getCamera(yAxis), intent) : intent;
    if (!next) return;
    this.applyGesture(options.source ?? "api", () => {
      if (yAxis === "right") {
        return (next.dx === 0 || this.axis.pan({ dx: next.dx, dy: 0 })) && (next.dy === 0 || this.rightAxis.pan({ dx: 0, dy: next.dy }));
      }
      return this.axis.pan(next)
        && (yAxis !== undefined || next.dy === 0 || this.rightAxis.pan({ dx: 0, dy: this.rightYDirectionMatchesLeft() ? next.dy : -next.dy }));
    });
  }

  /**
   * Zoom in scale space around a normalized anchor, after `viewportPolicy.beforeZoom`. X always zooms both axes.
   * Y zooms only `yAxis` when given; omitted, Y zooms both axes like a plot-area gesture.
   * The anchor is normalized to the left axis domain (or `yAxis` when given).
   */
  zoom(intent: ZoomIntent, yAxis?: SeriesYAxis, options: ChartViewportGestureOptions = {}): void {
    const policy = this.options.viewportPolicy;
    const next = policy?.beforeZoom ? policy.beforeZoom(this.getCamera(yAxis), intent) : intent;
    if (!next) return;
    this.applyGesture(options.source ?? "api", () => {
      if (yAxis === "right") {
        return (next.axis === "y" || this.axis.zoom({ ...next, axis: "x" })) && (next.axis === "x" || this.rightAxis.zoom({ ...next, axis: "y" }));
      }
      return this.axis.zoom(next)
        && (yAxis !== undefined || next.axis === "x" || this.rightAxis.zoom({ ...next, cy: this.rightYDirectionMatchesLeft() ? next.cy : 1 - next.cy, axis: "y" }));
    });
  }

  /**
   * Run a pan/zoom that moves one or both cameras. If any step is rejected (invalid scale
   * domain or a span beyond float precision), restore both so the axes never drift apart.
   */
  private applyGesture(source: ChartViewportChangeSource, move: () => boolean): void {
    const left = this.camera.viewport;
    const right = this.rightCamera.viewport;
    if (!move()) {
      this.camera.setViewport(left);
      this.rightCamera.setViewport(right);
      return;
    }
    this.pauseXFollowForInteraction();
    this.syncRightCameraX();
    this.emitViewportChange(source);
    this.scheduleHoverRefresh();
  }

  /** Add a series with an explicit mode. Prefer the typed helpers such as `addLine`. */
  addSeries<D extends Dataset = Dataset>(config: SeriesConfig & { readonly dataset?: D }, style: SeriesStyleOptions = {}): SeriesStore<D> {
    if (!SERIES_MODES.has(config.mode)) {
      throw new TypeError(`Chart.addSeries: unknown series mode ${JSON.stringify(config.mode)}. Expected one of ${[...SERIES_MODES].join(", ")}.`);
    }
    if ((config.mode === "ohlc" || config.mode === "candlestick") && !config.dataset) {
      throw new TypeError("OHLC and candlestick series require an OhlcDataset.");
    }
    const dataset = (config.dataset ?? this.createDefaultDataset(config)) as D;
    if (config.mode === "bar" && style.barWidth === undefined) style = this.datasetBarWidth(dataset, style);
    const slot = this.nextPaletteIndex();
    const series = new SeriesStore(dataset, config, this.resolveSeriesStyle(style, slot), (change) => this.handleSeriesChange(change));
    this.seriesStyleState.set(series, { options: { ...style }, paletteIndex: style.color ? null : slot });
    series.bindStyleHandler((target, options) => this.setSeriesStyle(target, options));
    this.series.push(series);
    if (this.forcedColorsActive) this.applyForcedSeriesStyles();
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

  /** Remove a series from the chart; returns `false` when it is not attached. */
  removeSeries(series: SeriesStore): boolean {
    const index = this.series.indexOf(series);
    if (index === -1) return false;

    this.series.splice(index, 1);
    if (this.inspection?.series === series) this.inspection = null;
    const original = this.forcedOriginalStyles.get(series);
    if (original) {
      series.applyResolvedStyle(original);
      this.forcedOriginalStyles.delete(series);
      this.applyForcedSeriesStyles();
    }
    this.emitSeriesChange();
    return true;
  }

  /**
   * Summarize the series for assistive technology: names, X and Y ranges, sample counts, and
   * latest values. Computed on demand; the chart's own `aria-describedby` text is refreshed at
   * most once a second from the same data.
   */
  getSummary(): ChartSummary {
    const option = this.options.accessibility;
    const config = typeof option === "object" ? option : undefined;
    return buildChartSummary(
      this.series,
      (value, axis, yAxis) => this.formatAxisValue(value, axis, yAxis),
      createSummaryMessages(config?.locale ?? "en-US", config?.messages?.summary),
    );
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
  followX(options: ChartFollowXOptions = {}): void {
    this.followXConfig = options;
    this.clearXFollowResumeTimer();
    this.xFollowPaused = false;
    this.emitFollowXChange();
    this.applyFollowXPolicy();
    this.requestRender();
  }

  /** Disable latest-X following. */
  stopFollowX(): void {
    if (!this.followXConfig && !this.xFollowPaused) return;
    this.followXConfig = null;
    this.xFollowPaused = false;
    this.clearXFollowResumeTimer();
    this.emitFollowXChange();
    this.requestRender();
  }

  /** Pause or resume latest-X following without changing its options. */
  setFollowXPaused(paused: boolean): void {
    this.clearXFollowResumeTimer();
    if (this.xFollowPaused === paused) return;
    this.xFollowPaused = paused;
    this.emitFollowXChange();
    if (!paused) this.applyFollowXPolicy();
    this.requestRender();
  }

  /** Return whether latest-X following is off, active, or paused by interaction. */
  getFollowXState(): ChartFollowXState {
    if (!this.followXConfig) return "off";
    return this.xFollowPaused ? "paused" : "following";
  }

  /**
   * Fit the viewport to data bounds; returns `false` when nothing changed. Padding applies in
   * scale space, and an axis with no usable domain (e.g. non-positive data on a log axis) is left alone.
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
      this.emitViewportChange(options.source ?? "fit");
      this.refreshHover();
    }
    return changed;
  }

  /** Resize the canvas to match its layout size and device pixel ratio. */
  resize(dpr: number = this.layout.view.devicePixelRatio): boolean {
    const resized = this.applyCanvasSize(dpr);
    if (resized) {
      // `plugins` is unset while the constructor sizes the canvas, before any plugin exists.
      this.plugins?.notify("onResize", { width: this.canvas.clientWidth, height: this.canvas.clientHeight });
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

  /** Reserve or release plot-adjacent layout space; plugins reach it through `ctx.layout.reserve`. */
  private setLayoutReservation(id: string, reservation: ChartLayoutReservation | null): void {
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

  /** Replace the chart theme and re-render. Plugin `onThemeChange` hooks run before the `themechange` event. */
  setTheme(theme?: ChartTheme): void {
    this.userTheme = theme;
    this.applyTheme();
  }

  /** Resolve the caller theme (and forced colors) and push it to the canvas, overlays, and plugins. */
  private applyTheme(): void {
    const root = this.layout.root;
    this.baseTheme = resolveChartTheme(this.userTheme, root);
    this.forcedColorsActive = this.forcedColorsQuery?.matches === true;
    this.resolvedTheme = this.forcedColorsActive ? forcedColorsTheme(this.baseTheme, root) : this.baseTheme;
    root.style.background = this.resolvedTheme.backgroundCssColor;
    root.style.setProperty("--blazeplot-focus-ring", this.resolvedTheme.focusRingColor);
    this.refreshSeriesStyles();
    this.applyForcedSeriesStyles();
    this.axisOverlay?.setOptions({ color: this.resolvedTheme.axisColor, font: this.resolvedTheme.axisFont });
    this.updateTextOverlays();
    this.plugins.notify("onThemeChange", this.resolvedTheme);
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
    return this.picker.pickAtPlot(clientX - rect.left, clientY - rect.top, clientX, clientY, rect, options);
  }

  /** Render the chart, including DOM overlays under the chart root, to an image blob. */
  async screenshot(options: ChartScreenshotOptions = {}): Promise<Blob> {
    // Load the chunk first, then render synchronously right before the compose step reads the
    // (non-preserved) drawing buffer, so a presented frame cannot clear it in between.
    const { composeChartScreenshot } = await import("./screenshot.js");
    this.render();
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
      this.layout.view.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Schedule a frame. Chart-owned changes call this automatically. */
  requestRender(): void {
    if (!this.running || this.rafId !== 0) return;
    this.rafId = this.layout.view.requestAnimationFrame(() => {
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
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.clearXFollowResumeTimer();
    this.resizeObserver?.disconnect();
    if (this.hoverRafId !== 0) this.layout.view.cancelAnimationFrame(this.hoverRafId);
    this.hoverRafId = 0;
    if (this.restoreRenderRafId !== 0) this.layout.view.cancelAnimationFrame(this.restoreRenderRafId);
    this.restoreRenderRafId = 0;
    this.toggleDomListeners("removeEventListener");
    this.unwatchForcedColors();
    if (this.summaryTimer !== null) clearTimeout(this.summaryTimer);
    this.summaryTimer = null;
    this.inspection = null;
    // Reverse registration order; plugin cleanup errors never block chart-owned cleanup.
    this.plugins?.disposeAll();
    this.axisOverlay?.dispose();
    const gl = this.rendererImpl.getWebGLContext();
    this.disposeRenderer(this.rendererImpl);
    releaseWebGLContext(gl);
    this.layout.dispose();
  }

  private render(): void {
    const frameStartedAt = performance.now();
    if (this.lastFrameAt > 0) {
      this.stats.fps = 1000 / (frameStartedAt - this.lastFrameAt);
    }
    this.lastFrameAt = frameStartedAt;
    this.resetFrameStats();

    if (this.webglContextLost || this.rendererImpl.getWebGLContext()?.isContextLost() === true) {
      this.webglContextLost = true;
      return;
    }

    this.options.viewportPolicy?.beforeRender?.(this.camera);
    this.syncRightCameraX();
    this.applyFollowXPolicy();
    this.applyAutoFitYPolicy();
    try {
      this.axis.validateDomain("x");
      this.axis.validateDomain("y");
      this.rightAxis.validateDomain("y");
      this.domainErrorLogged = false;
    } catch (error) {
      // Skip the frame instead of throwing out of requestAnimationFrame; log once until fixed.
      if (!this.domainErrorLogged) console.error("BlazePlot skipped rendering:", error);
      this.domainErrorLogged = true;
      return;
    }

    try {
      const pixelRatio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
      this.rendererImpl.beginFrame(this.canvas.width, this.canvas.height, pixelRatio);
      this.painter.beginFrame({ renderer: this.rendererImpl, canvas: this.canvas, camera: this.camera, rightCamera: this.rightCamera, axis: this.axis, rightAxis: this.rightAxis });
      this.updateTicks();
      if (this.gridVisible) this.painter.drawGrid(this.xTicks, this.yTicks, this.resolvedTheme.gridColor);

      for (const series of this.series) {
        if (!series.visible) continue;
        series.rebuildPyramid();
        this.painter.drawSeries(series);
      }
      this.rendererImpl.endFrame();

      this.axisOverlay?.update(this.axis, this.rightAxis, this.xTicks, this.yTicks, this.y2Ticks);
      this.updateAutoGutters();
      this.emit("render", undefined);
    } catch (error) {
      if (this.rendererImpl.getWebGLContext()?.isContextLost() === true) {
        this.webglContextLost = true;
        this.resetFrameStats();
        return;
      }
      throw error;
    }

    this.stats.frameMs = performance.now() - frameStartedAt;
    if (this.hoverRafId !== 0) {
      this.layout.view.cancelAnimationFrame(this.hoverRafId);
      this.hoverRafId = 0;
    }
    this.refreshHover();
    if (this.running && this.options.renderLoop !== "continuous" && this.followXConfig?.currentX && !this.xFollowPaused) {
      this.requestRender();
    }
  }

  /** Datasets with fixed-width buckets (such as `HistogramDataset`) expose `defaultBarWidth`; `null` means variable width. */
  private datasetBarWidth(dataset: Dataset, style: SeriesStyleOptions): SeriesStyleOptions {
    const width = (dataset as { readonly defaultBarWidth?: number | null }).defaultBarWidth;
    if (typeof width === "number") return { ...style, barWidth: width };
    if (width === null && dataset.length > 0) {
      throw new TypeError("Chart.addBar requires style.barWidth for variable-width histogram bins.");
    }
    return style;
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
      return new UniformRingBuffer(capacity, { xStart: config.xStart, xStep: config.xStep, valuePrecision: config.valuePrecision });
    }
    return new RingBuffer(capacity, { overflow: config.overflow, valuePrecision: config.valuePrecision, onInvalidSample: config.onInvalidSample });
  }

  /** First theme palette slot no attached palette-colored series uses (the next slot in order when all are taken). */
  private nextPaletteIndex(): number {
    const size = this.baseTheme.seriesColors.length;
    const used = new Set<number>();
    for (const series of this.series) {
      const slot = this.seriesStyleState.get(series)?.paletteIndex;
      if (slot !== null && slot !== undefined) used.add(slot);
    }
    for (let slot = 0; slot < size; slot++) if (!used.has(slot)) return slot;
    return this.series.length % size;
  }

  /** Merge `options` into a series' style: pin an explicit color, resolve, and respect forced colors. */
  private setSeriesStyle(series: SeriesStore, options: SeriesStyleOptions): void {
    const state = this.seriesStyleState.get(series);
    if (!state) return;
    const merged: Record<string, unknown> = { ...state.options };
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) merged[key] = value;
    }
    state.options = merged as SeriesStyleOptions;
    if (options.color) state.paletteIndex = null;
    const resolved = this.resolveSeriesStyle(state.options, state.paletteIndex ?? this.nextPaletteIndex());
    if (this.forcedColorsActive || this.forcedOriginalStyles.has(series)) {
      this.forcedOriginalStyles.set(series, resolved);
      this.applyForcedSeriesStyles();
    } else {
      series.applyResolvedStyle(resolved);
    }
    this.emitSeriesChange();
  }

  /** Re-resolve every series style from its stored options, so palette-colored series follow the theme. */
  private refreshSeriesStyles(): void {
    for (const series of this.series) {
      const state = this.seriesStyleState.get(series);
      if (!state) continue;
      const resolved = this.resolveSeriesStyle(state.options, state.paletteIndex ?? this.nextPaletteIndex());
      if (this.forcedColorsActive) this.forcedOriginalStyles.set(series, resolved);
      else series.applyResolvedStyle(resolved);
    }
    if (!this.forcedColorsActive) this.forcedOriginalStyles.clear();
  }

  private resolveSeriesStyle(style: SeriesStyleOptions, paletteIndex: number): SeriesStyle {
    // The caller palette, not the forced-colors one: forced styles are applied on top and undone later.
    const palette = this.baseTheme.seriesColors;
    const root = this.layout.root;
    const color = resolveThemeColor(style.color, palette[paletteIndex % palette.length]!, root);
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
    if (change === "visibility") {
      this.emitSeriesChange();
    } else {
      this.requestRender();
      this.markSummaryDirty();
    }
  }

  /** Watch `(forced-colors: active)` unless accessibility or `forcedColors` is turned off. */
  private watchForcedColors(): void {
    const option = this.options.accessibility;
    if (option === false || (typeof option === "object" && option.forcedColors === false)) return;
    const view = this.layout.view;
    if (typeof view.matchMedia !== "function") return;
    const query = view.matchMedia("(forced-colors: active)");
    this.forcedColorsQuery = query;
    this.forcedColorsActive = query.matches;
    query.addEventListener?.("change", this.handleForcedColorsChange);
  }

  private unwatchForcedColors(): void {
    this.forcedColorsQuery?.removeEventListener?.("change", this.handleForcedColorsChange);
    this.forcedColorsQuery = null;
  }

  /**
   * While forced colors are active, draw every series in the system palette (by series order)
   * and keep the caller styles to restore afterwards. Otherwise restore any saved styles.
   */
  private applyForcedSeriesStyles(): void {
    if (!this.forcedColorsActive) {
      for (const [series, style] of this.forcedOriginalStyles) series.applyResolvedStyle(style);
      this.forcedOriginalStyles.clear();
      return;
    }
    const palette = this.resolvedTheme.seriesColors;
    for (let index = 0; index < this.series.length; index++) {
      const series = this.series[index]!;
      let original = this.forcedOriginalStyles.get(series);
      if (!original) {
        original = series.style;
        this.forcedOriginalStyles.set(series, original);
      }
      const color = palette[index % palette.length]!;
      const contrast = palette[(index + 1) % palette.length]!;
      series.applyResolvedStyle({ ...original, color, fillColor: withAlpha(color, 0.35), upColor: color, downColor: contrast, wickColor: color });
    }
  }

  private markSummaryDirty(): void {
    if (!this.summaryElement || this.disposed) return;
    const option = this.options.accessibility;
    if (typeof option === "object" && typeof option.description === "string") return;
    this.summaryDirty = true;
    if (this.summaryTimer === null) this.summaryTimer = setTimeout(this.flushSummary, SUMMARY_THROTTLE_MS);
  }

  /** Write the `aria-describedby` text: the caller's string, or the (optionally reworded) generated summary. */
  private updateSummary(): void {
    const element = this.summaryElement;
    if (!element) return;
    this.summaryDirty = false;
    const option = this.options.accessibility;
    const description = typeof option === "object" ? option.description : undefined;
    const text = typeof description === "string"
      ? description
      : description ? description(this.getSummary()) : this.getSummary().text;
    if (element.textContent !== text) element.textContent = text;
  }

  /** Format a value the way the axis labels it; never throws. */
  private formatAxisValue(value: number, axis: "x" | "y", yAxis: SeriesYAxis = "left"): string {
    if (!Number.isFinite(value)) return String(value);
    try {
      return this.controllerFor(yAxis).formatValue(value, axis);
    } catch {
      return String(value);
    }
  }

  /** Show a sample as the hover state (keyboard inspection), or end inspection with `null`. */
  private inspect(target: ChartInspectionTarget | null): ChartHoverState | null {
    if (target) {
      if (!this.series.includes(target.series)) throw new RangeError("chart inspection target series is not attached to this chart.");
      if (!Number.isInteger(target.index) || target.index < 0 || target.index >= target.series.length) {
        throw new RangeError(`chart inspection index ${target.index} is outside the series (length ${target.series.length}).`);
      }
      this.inspection = { series: target.series, index: target.index };
      this.setHover(this.inspectionHoverState());
    } else {
      this.inspection = null;
      if (this.pointerInPlot) this.refreshHover();
      else this.setHover(null);
    }
    return this.currentHover;
  }

  /**
   * Hover state for the inspected sample: it is `items[0]`, followed by other visible series at
   * the same X when hover grouping is `"x"`. `null` when it is hidden, a gap, or outside the plot.
   */
  private inspectionHoverState(): ChartHoverState | null {
    const target = this.inspection;
    if (!target) return null;
    const { series } = target;
    const seriesIndex = this.series.indexOf(series);
    const sample = seriesIndex === -1 || !series.visible ? null : series.sampleAt(target.index);
    if (!sample) return null;
    const rect = this.canvas.getBoundingClientRect();
    const probe = this.picker.createPickItem(sample, series, seriesIndex, 0, 0, rect);
    if (!insidePlot(probe.plotX, probe.plotY, rect)) return null;
    const { clientX, clientY } = probe;
    const primary: ChartPickItem = { ...probe, distancePx: 0 };
    const group = this.options.hover?.group ?? "x";
    const items = group === "none"
      ? [primary]
      : [primary, ...this.picker.collectPickItems(sample.x, clientX, clientY, rect).filter((item) => item.series !== series)];
    return {
      clientX,
      clientY,
      plotX: primary.plotX,
      plotY: primary.plotY,
      dataX: sample.x,
      dataY: sample.y,
      anchorX: sample.x,
      mode: "nearest-x",
      group,
      maxDistancePx: Infinity,
      items,
      source: "inspection",
    };
  }

  /** Attached series that pass the visibility and explicit-series filters. */
  private candidateSeries(options: { readonly series?: readonly SeriesStore[]; readonly includeHidden?: boolean }): SeriesStore[] {
    const candidates = options.series ? options.series.filter((series) => this.series.includes(series)) : this.series;
    return options.includeHidden ? candidates : candidates.filter((series) => series.visible);
  }

  private pauseXFollowForInteraction(): void {
    const config = this.followXConfig;
    if (!config || config.pauseOnInteraction === false) return;
    const wasPaused = this.xFollowPaused;
    this.xFollowPaused = true;
    this.clearXFollowResumeTimer();
    if (!wasPaused) this.emitFollowXChange();
    const resumeAfterMs = config.resumeAfterMs;
    if (typeof resumeAfterMs !== "number" || !Number.isFinite(resumeAfterMs) || resumeAfterMs <= 0) return;
    this.xFollowResumeTimer = setTimeout(() => {
      this.xFollowResumeTimer = null;
      this.setFollowXPaused(false);
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
    this.emitViewportChange("follow");
  }

  private applyAutoFitYPolicy(): void {
    const option = this.options.autoFitY;
    if (!option) return;
    this.fitToData({ ...(option === true ? {} : option), x: false, xMin: this.camera.xMin, xMax: this.camera.xMax });
  }

  private createGpuResources(): ChartGpuResources {
    const { backendFactory } = this.options;
    const option = this.options.renderer;
    if (option !== undefined && option !== "webgl2" && typeof option !== "function") {
      throw new TypeError('ChartOptions.renderer must be "webgl2" or a factory such as canvas2dRenderer() from "blazeplot/renderers/canvas2d".');
    }
    const factory = typeof option === "function" ? option : webgl2Renderer();
    return { renderer: backendFactory ? new Renderer(backendFactory({ canvas: this.canvas })) : (factory({ canvas: this.canvas }) as ChartRenderer) };
  }

  private installGpuResources(resources: ChartGpuResources): void {
    this.rendererImpl = resources.renderer;
  }

  private disposeRenderer(renderer: ChartRenderer): void {
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

  /** Add or remove the chart's own canvas and root listeners. */
  private toggleDomListeners(method: "addEventListener" | "removeEventListener"): void {
    const canvas = this.canvas;
    const root = this.layout.root;
    const listeners: Array<[EventTarget, string, (event: never) => void]> = [
      [canvas, "pointermove", this.handlePointerMove],
      [canvas, "pointerdown", this.handlePointerDown],
      [canvas, "pointerup", this.handlePointerUp],
      [canvas, "pointerleave", this.handlePointerLeave],
      [canvas, "click", this.handleClick],
      [canvas, "dblclick", this.handleDoubleClick],
      [canvas, "webglcontextlost", this.handleWebGLContextLost],
      [canvas, "webglcontextrestored", this.handleWebGLContextRestored],
    ];
    if (this.summaryElement) listeners.push([root, "focusin", this.handleRootFocusIn]);
    for (const [target, type, listener] of listeners) target[method](type, listener as EventListener);
  }

  private scheduleRenderAfterRestore(): void {
    if (this.restoreRenderRafId !== 0) return;
    this.restoreRenderRafId = this.layout.view.requestAnimationFrame(() => {
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
    const doc = root.ownerDocument;
    if (root.tabIndex < 0) root.tabIndex = 0;
    root.setAttribute("role", config?.role ?? "figure");
    root.setAttribute("aria-label", config?.label ?? (title || config?.messages?.defaultLabel || "BlazePlot chart"));
    this.layout.plot.setAttribute("role", "presentation");
    for (const element of [this.canvas, this.xAxisElement, this.yAxisElement, this.y2AxisElement]) {
      element.setAttribute("aria-hidden", "true");
    }

    const style = doc.createElement("style");
    style.className = "blazeplot-style";
    style.textContent = CHART_STYLESHEET;
    root.appendChild(style);

    if (config?.description === "") return;
    const summary = doc.createElement("div");
    summary.id = `blazeplot-summary-${nextSummaryId++}`;
    summary.className = VISUALLY_HIDDEN_CLASS;
    root.appendChild(summary);
    root.setAttribute("aria-describedby", summary.id);
    this.summaryElement = summary;
  }

  /** Resize `size: "auto"` gutters from the labels measured this frame. */
  private updateAutoGutters(): void {
    const overlay = this.axisOverlay;
    if (!overlay) return;
    let changed = false;
    for (const axis of ["x", "y", "y2"] as const) {
      const config = this.normalizedAxes[axis];
      if (config.size !== "auto" || !config.visible || config.position !== "outside") continue;
      const extent = overlay.measuredExtent(axis);
      if (extent <= 0) continue;
      const next = this.gutterTrackers[axis].next(Math.max(MIN_AUTO_GUTTER_PX, extent + AUTO_GUTTER_PADDING_PX));
      if (next !== null && this.layout.setAutoSize(axis, next)) changed = true;
    }
    if (changed) {
      this.resize();
      this.requestRender();
    }
  }

  private rebuildAxisOverlay(): void {
    this.axisOverlay?.dispose();
    this.gutterTrackers = { x: new GutterTracker(), y: new GutterTracker(), y2: new GutterTracker() };
    for (const axis of ["x", "y", "y2"] as const) this.layout.setAutoSize(axis, null);
    const axes = this.normalizedAxes;
    this.axisOverlay = axes.x.visible || axes.y.visible || axes.y2.visible
      ? new AxisOverlay(this.layout, axes, { color: this.resolvedTheme.axisColor, font: this.resolvedTheme.axisFont })
      : null;
  }

  private updateTextOverlays(): void {
    const theme = this.resolvedTheme;
    const hasTitle = titleText(this.options.title) !== "";
    const hasSubtitle = titleText(this.options.subtitle) !== "";
    this.applyChartTitle(this.layout.title, this.options.title, theme.titleColor, theme.titleFont, TITLE_TOP_PX);
    this.applyChartTitle(this.layout.subtitle, this.options.subtitle, theme.subtitleColor, theme.subtitleFont, hasTitle ? SUBTITLE_TOP_PX : TITLE_TOP_PX);
    // Title and subtitle get their own grid row, so they never sit on top of the plot.
    this.layout.setTitleInset((hasTitle ? SUBTITLE_TOP_PX : 0) + (hasSubtitle ? SUBTITLE_ROW_PX : 0));
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

  private applyCanvasSize(dpr: number = this.layout.view.devicePixelRatio): boolean {
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

  private scheduleHoverRefresh(): void {
    if (this.hoverRafId !== 0) return;
    this.hoverRafId = this.layout.view.requestAnimationFrame(() => {
      this.hoverRafId = 0;
      this.refreshHover();
    });
  }

  /** Re-pick under the last pointer position; while a button is held, keep the same items and only reproject them. */
  private refreshHover(): void {
    if (this.inspection) {
      this.setHover(this.inspectionHoverState());
      return;
    }
    if (!this.pointerInPlot) return;
    const rect: PlotRect = {
      left: this.lastPointerClientX - this.lastPointerPlotX,
      top: this.lastPointerClientY - this.lastPointerPlotY,
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    };
    if (this.lastPointerButtons !== 0) {
      this.setHover(this.picker.reprojectHoverState(this.currentHover, rect, { clientX: this.lastPointerClientX, clientY: this.lastPointerClientY, plotX: this.lastPointerPlotX, plotY: this.lastPointerPlotY }));
      return;
    }
    this.setHover(this.picker.pickAtPlot(this.lastPointerPlotX, this.lastPointerPlotY, this.lastPointerClientX, this.lastPointerClientY, rect));
  }

  /** Emit `hover` only when the picked items or the anchor actually changed. */
  private setHover(state: ChartHoverState | null): void {
    if (hoverStatesEqual(this.currentHover, state)) return;
    this.currentHover = state;
    this.emit("hover", state);
  }

  private emitPointerEvent(type: ChartPointerEventType, source: MouseEvent | PointerEvent): ChartPointerEvent | null {
    const rect = this.canvas.getBoundingClientRect();
    const plotX = source.clientX - rect.left;
    const plotY = source.clientY - rect.top;
    if (!insidePlot(plotX, plotY, rect)) return null;

    const [dataX, dataY] = plotToData(plotX, plotY, rect, this.axis);
    const hover = this.picker.pickAtPlot(plotX, plotY, source.clientX, source.clientY, rect, this.options.hover);
    const event: ChartPointerEvent = {
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

  private emitViewportChange(source: ChartViewportChangeSource): void {
    this.emit("viewportchange", { viewport: this.camera.viewport, rightViewport: this.rightCamera.viewport, source });
    this.requestRender();
  }

  private emitFollowXChange(): void {
    if (this.hasListeners("followxchange")) this.emit("followxchange", { state: this.getFollowXState() });
  }

  private emitSeriesChange(): void {
    this.markSummaryDirty();
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
    // One throwing listener never stops the rest.
    for (const listener of listeners) {
      try {
        (listener as Listener<K>)(payload);
      } catch (error) {
        console.error(`BlazePlot ${event} listener failed:`, error);
      }
    }
  }
}

