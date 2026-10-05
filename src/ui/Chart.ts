import type { SeriesConfig, SeriesStyle, SeriesStyleOptions, Dataset, SeriesYAxis, Viewport } from "../core/types.js";
import { SeriesStore } from "../core/SeriesStore.js";
import type { SeriesChange } from "../core/SeriesStore.js";
import { RingBuffer } from "../core/RingBuffer.js";
import { UniformRingBuffer } from "../core/UniformRingBuffer.js";
import { toRenderSurface } from "../render/ChartRenderer.js";
import type { ChartRenderSurface, ChartRenderer, ChartRendererInfo, RendererLossState, RendererName } from "../render/ChartRenderer.js";
import { createEngine } from "../render/engines.js";
import { SeriesPainter } from "../render/SeriesPainter.js";
import { Camera2D } from "../interaction/Camera2D.js";
import { AxisController } from "../interaction/AxisController.js";
import type { PanIntent, ZoomIntent } from "../interaction/types.js";
import { AUTO_GUTTER_PADDING_PX, AxisOverlay, GutterTracker, X_TICK_LIMIT, Y_TICK_LIMIT } from "./AxisOverlay.js";
import { ChartLayout } from "./ChartLayout.js";
import { ChartEmitter } from "./ChartEmitter.js";
import { ChartHover } from "./ChartHover.js";
import { ChartPicker, insidePlot, plotToData } from "./ChartPicker.js";
import { forcedColorsTheme, resolveChartTheme } from "./theme.js";
import type { ChartTheme, ResolvedChartTheme } from "./theme.js";
import { PluginHost } from "./PluginHost.js";
import type { ChartLayoutReservation, ChartPlugin } from "./PluginHost.js";
import { FollowXController } from "./FollowX.js";
import { ChartAccessibility } from "./ChartAccessibility.js";
import { domainsAlmostEqual, normalizeAxesConfig, normalizeFitPadding, paddedAxisDomain, resolveSeriesStyle } from "./ChartConfig.js";
import type { ResolvedAxesConfig } from "./ChartConfig.js";
import { buildChartSummary, createSummaryMessages } from "./ChartSummary.js";
import type { ChartSummary } from "./ChartSummary.js";

const SERIES_MODES: ReadonlySet<string> = new Set(["line", "area", "scatter", "bar", "ohlc", "candlestick"]);
/** Two vertices per grid line; tick generators may add one extra tick at each edge. */
const GRID_LINE_VERTEX_CAPACITY = (X_TICK_LIMIT + 2 + Y_TICK_LIMIT + 2) * 2;
/** Smallest auto-sized gutter, so a short-label axis still leaves room for ticks. */
const MIN_AUTO_GUTTER_PX = 16;
export type { TextOverlayConfig, ChartTitleConfig, AxisConfig, ChartPickMode, ChartPickGroup, ChartPickOptions, ChartAccessibilityMessages, ChartAccessibilityOptions, ChartRenderLoop, ChartOptions, TypedSeriesConfig, SeriesIdentityConfig, ChartSeriesState, ChartPickItem, ChartPointerEventType, ChartPointerEvent, ChartSeriesClickEvent, ChartViewportChangeSource, ChartViewportChangeEvent, ChartViewportGestureOptions, ChartSetViewportOptions, ChartFollowXChangeEvent, ChartSelectEvent, ChartHoverState, ChartInspectionTarget, ChartEventMap, ChartEventName, ChartScreenshotOptions, ChartFitToDataPadding, ChartFitToDataOptions, ChartAutoFitYOptions, ChartFollowXOptions, ChartFollowXState, ChartFrameStats };
import type { TextOverlayConfig, ChartTitleConfig, AxisConfig, ChartPickMode, ChartPickGroup, ChartPickOptions, ChartAccessibilityMessages, ChartAccessibilityOptions, ChartRenderLoop, ChartOptions, TypedSeriesConfig, SeriesIdentityConfig, ChartSeriesState, ChartPickItem, ChartPointerEventType, ChartPointerEvent, ChartSeriesClickEvent, ChartViewportChangeSource, ChartViewportChangeEvent, ChartViewportGestureOptions, ChartSetViewportOptions, ChartFollowXChangeEvent, ChartSelectEvent, ChartHoverState, ChartInspectionTarget, ChartEventMap, ChartEventName, ChartScreenshotOptions, ChartFitToDataPadding, ChartFitToDataOptions, ChartAutoFitYOptions, ChartFollowXOptions, ChartFollowXState, ChartFrameStats } from "./ChartTypes.js";


/** Imperative chart instance for rendering, interaction, and plugins. */
export class Chart {
  private series: SeriesStore[] = [];
  private camera: Camera2D;
  private rightCamera: Camera2D;
  private axis: AxisController;
  private rightAxis: AxisController;
  private engine!: ChartRenderer;
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
  private readonly events = new ChartEmitter();
  private readonly layoutReservations = new Map<string, ChartLayoutReservation>();
  private readonly hover: ChartHover = new ChartHover({
    picker: this.picker,
    canvas: () => this.canvas,
    view: () => this.layout.view,
    series: () => this.series,
    hoverOptions: () => this.options.hover,
    axis: () => this.axis,
    emit: (event, payload) => this.events.emit(event, payload),
    hasListeners: (event) => this.events.has(event),
  });
  private lastFrameAt: number = 0;
  private readonly followXPolicy: FollowXController = new FollowXController({
    camera: () => this.camera,
    axis: () => this.axis,
    candidates: (config) => this.candidateSeries(config),
    onStateChange: () => this.emitFollowXChange(),
    onViewportChange: () => {
      this.syncRightCameraX();
      this.emitViewportChange("follow");
    },
    requestRender: () => this.requestRender(),
  });
  private rafId: number = 0;
  private restoreRenderRafId: number = 0;
  private running: boolean = false;
  private disposed: boolean = false;
  private rendererLost: boolean = false;
  private domainErrorLogged: boolean = false;
  private readonly options: ChartOptions;
  /** Caller theme before forced-colors substitution; `setTheme` replaces it. */
  private userTheme: ChartTheme | undefined;
  /** Resolved caller theme; differs from `resolvedTheme` while forced colors are active. */
  private baseTheme: ResolvedChartTheme;
  private readonly a11y: ChartAccessibility = new ChartAccessibility({
    options: () => this.options.accessibility,
    titles: () => ({ title: this.options.title, subtitle: this.options.subtitle }),
    layout: () => this.layout,
    getSummary: () => this.getSummary(),
    disposed: () => this.disposed,
    series: () => this.series,
    seriesColors: () => this.resolvedTheme.seriesColors,
    onForcedColorsChange: () => this.applyTheme(),
  });
  /** Caller style options per series, plus the theme palette slot it follows (`null` once a color is pinned). */
  private readonly seriesStyleState = new WeakMap<SeriesStore, { options: SeriesStyleOptions; paletteIndex: number | null }>();
  private readonly handleRootFocusIn = (): void => {
    this.a11y.flushIfDirty();
  };
  /** The one place the engine's context state lands: stop drawing while lost, resume after restore. */
  private readonly onRendererState = (state: RendererLossState): void => {
    if (this.disposed) return;
    if (state === "lost") {
      this.rendererLost = true;
      if (this.restoreRenderRafId !== 0) {
        this.layout.view.cancelAnimationFrame(this.restoreRenderRafId);
        this.restoreRenderRafId = 0;
      }
      this.resetFrameStats();
      this.plugins.notify("onContextLost");
      return;
    }
    this.rendererLost = false;
    this.applyCanvasSize();
    this.plugins.notify("onContextRestored");
    this.scheduleRenderAfterRestore();
  };

  /** Create a chart inside `target`. Call `start()` to begin rendering. */
  constructor(target: HTMLElement, options: ChartOptions = {}) {
    this.options = options;
    this.followXPolicy.configure(options.followX ? (options.followX === true ? {} : options.followX) : null);
    this.userTheme = options.theme;
    this.baseTheme = resolveChartTheme(options.theme, target);
    this.resolvedTheme = this.baseTheme;
    this.normalizedAxes = normalizeAxesConfig(options.axes);
    this.gridVisible = options.grid !== false;

    this.layout = new ChartLayout(target, this.normalizedAxes);
    this.a11y.watchForcedColors();
    if (this.a11y.forcedColorsActive) this.resolvedTheme = forcedColorsTheme(this.baseTheme, this.layout.root);
    this.layout.root.style.background = this.resolvedTheme.backgroundCssColor;
    this.layout.root.style.setProperty("--blazeplot-focus-ring", this.resolvedTheme.focusRingColor);
    this.a11y.install();
    this.applyCanvasSize();
    this.camera = new Camera2D();
    this.rightCamera = new Camera2D();
    this.applyAxisDirections();
    this.axis = new AxisController(this.camera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y });
    this.rightAxis = new AxisController(this.rightCamera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y2 });
    try {
      this.engine = createEngine(options.renderer, this.canvas);
      this.engine.setLossListener(this.onRendererState);
    } catch (error) {
      // E.g. the chosen engine is unavailable: remove the half-built DOM and hand back a caller-supplied canvas.
      this.a11y.unwatchForcedColors();
      this.layout.dispose();
      throw error;
    }
    this.rebuildAxisOverlay();
    this.updateTitles();
    this.a11y.updateSummary();

    this.toggleDomListeners("addEventListener");

    const ResizeObserverCtor = this.layout.view.ResizeObserver ?? globalThis.ResizeObserver;
    if (typeof ResizeObserverCtor !== "undefined") {
      this.resizeObserver = new ResizeObserverCtor(() => this.resize());
      this.resizeObserver.observe(this.layout.plot);
    }

    this.plugins = new PluginHost(this, {
      emit: (event, payload) => this.events.emit(event, payload),
      setLayoutReservation: (id, reservation) => this.setLayoutReservation(id, reservation),
      inspect: (inspectTarget) => this.hover.inspect(inspectTarget),
      getInspection: () => this.hover.inspection,
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

  /** Rendering engine in use: `"webgl2"`, `"canvas2d"`, or `"shared"` (a WebGL2 context shared with other charts). */
  get renderer(): RendererName {
    return this.engine.info.name;
  }

  /** The engine in use, what was requested, whether `"auto"` fell back, and the engine's capabilities. */
  get rendererInfo(): ChartRendererInfo {
    return this.engine.info;
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

  /** @internal The engine's native WebGL2 context, when it owns one. Plugins use `ctx.unstable.getWebGLContext()`. */
  getWebGLContext(): WebGL2RenderingContext | null {
    return this.engine.webglContext?.() ?? null;
  }

  /** @internal A drawing surface for a plugin-owned canvas, on this chart's engine. Plugins use `ctx.unstable.createRenderSurface()`. */
  createRenderSurface(canvas: HTMLCanvasElement): ChartRenderSurface {
    return toRenderSurface(this.engine.createSurface(canvas));
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
      if (options.pauseFollow !== false) this.followXPolicy.pauseForInteraction();
      this.camera.setViewport({ xMin: viewport.xMin, xMax: viewport.xMax });
      this.syncRightCameraX();
    }
    if (viewport.yMin !== undefined || viewport.yMax !== undefined) {
      this.getCamera(yAxis).setViewport({ yMin: viewport.yMin, yMax: viewport.yMax });
    }
    this.emitViewportChange(options.source ?? "api");
    this.hover.refresh();
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
    this.applyGesture(options.source ?? "api", next.dx !== 0, () => {
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
    this.applyGesture(options.source ?? "api", next.axis !== "y", () => {
      if (yAxis === "right") {
        return (next.axis === "y" || this.axis.zoom({ ...next, axis: "x" })) && (next.axis === "x" || this.rightAxis.zoom({ ...next, axis: "y" }));
      }
      return this.axis.zoom(next)
        && (yAxis !== undefined || next.axis === "x" || this.rightAxis.zoom({ ...next, cy: this.rightYDirectionMatchesLeft() ? next.cy : 1 - next.cy, axis: "y" }));
    });
  }

  /**
   * Run a pan/zoom that moves one or both cameras; `movesX` says whether it changes the X viewport. If any step is rejected (invalid scale
   * domain or a span beyond float precision), restore both so the axes never drift apart.
   */
  private applyGesture(source: ChartViewportChangeSource, movesX: boolean, move: () => boolean): void {
    const left = this.camera.viewport;
    const right = this.rightCamera.viewport;
    if (!move()) {
      this.camera.setViewport(left);
      this.rightCamera.setViewport(right);
      return;
    }
    // Y-only gestures leave the X viewport alone, so they must not take the chart out of live follow.
    if (movesX) this.followXPolicy.pauseForInteraction();
    this.syncRightCameraX();
    this.emitViewportChange(source);
    this.hover.schedule();
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
    if (this.a11y.forcedColorsActive) this.a11y.applyForcedSeriesStyles();
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
    if (this.hover.inspection?.series === series) this.hover.inspection = null;
    const original = this.a11y.originalStyles.get(series);
    if (original) {
      series.applyResolvedStyle(original);
      this.a11y.originalStyles.delete(series);
      this.a11y.applyForcedSeriesStyles();
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
    this.followXPolicy.start(options);
  }

  /** Disable latest-X following. */
  stopFollowX(): void {
    this.followXPolicy.stop();
  }

  /** Pause or resume latest-X following without changing its options. */
  setFollowXPaused(paused: boolean): void {
    this.followXPolicy.setPaused(paused);
  }

  /** Return whether latest-X following is off, active, or paused by interaction. */
  getFollowXState(): ChartFollowXState {
    return this.followXPolicy.state;
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
      this.hover.refresh();
    }
    return changed;
  }

  /** Resize the canvas to match its layout size and device pixel ratio. */
  resize(dpr: number = this.layout.view.devicePixelRatio): boolean {
    const resized = this.applyCanvasSize(dpr);
    if (resized) {
      // `plugins` is unset while the constructor sizes the canvas, before any plugin exists.
      this.plugins?.notify("onResize", { width: this.canvas.clientWidth, height: this.canvas.clientHeight });
      this.hover.refresh();
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
    return this.hover.state;
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
    return this.events.subscribe(event, callback);
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
    const forcedColorsActive = this.a11y.refreshForcedColors();
    this.resolvedTheme = forcedColorsActive ? forcedColorsTheme(this.baseTheme, root) : this.baseTheme;
    root.style.background = this.resolvedTheme.backgroundCssColor;
    root.style.setProperty("--blazeplot-focus-ring", this.resolvedTheme.focusRingColor);
    this.refreshSeriesStyles();
    this.a11y.applyForcedSeriesStyles();
    this.axisOverlay?.setOptions({ color: this.resolvedTheme.axisColor, font: this.resolvedTheme.axisFont });
    this.updateTitles();
    this.plugins.notify("onThemeChange", this.resolvedTheme);
    this.events.emit("themechange", undefined);
    this.requestRender();
    this.hover.refresh();
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
    this.updateTitles();
    this.resize();
    this.hover.refresh();
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
    this.followXPolicy.clearTimer();
    this.resizeObserver?.disconnect();
    if (this.restoreRenderRafId !== 0) this.layout.view.cancelAnimationFrame(this.restoreRenderRafId);
    this.restoreRenderRafId = 0;
    this.toggleDomListeners("removeEventListener");
    this.a11y.dispose();
    this.hover.dispose();
    // Reverse registration order; plugin cleanup errors never block chart-owned cleanup.
    this.plugins?.disposeAll();
    this.axisOverlay?.dispose();
    try {
      this.engine.dispose();
    } catch {
      // Engines release their own resources; a browser may still reject cleanup while a context is lost.
    }
    this.layout.dispose();
  }

  private render(): void {
    const frameStartedAt = performance.now();
    if (this.lastFrameAt > 0) {
      this.stats.fps = 1000 / (frameStartedAt - this.lastFrameAt);
    }
    this.lastFrameAt = frameStartedAt;
    this.resetFrameStats();

    if (this.rendererLost || this.engine.isLost) {
      this.rendererLost = true;
      return;
    }

    this.options.viewportPolicy?.beforeRender?.(this.camera);
    this.syncRightCameraX();
    this.followXPolicy.apply();
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
      this.engine.beginFrame(this.canvas.width, this.canvas.height, pixelRatio);
      this.painter.beginFrame({ renderer: this.engine, canvas: this.canvas, camera: this.camera, rightCamera: this.rightCamera, axis: this.axis, rightAxis: this.rightAxis });
      this.updateTicks();
      if (this.gridVisible) this.painter.drawGrid(this.xTicks, this.yTicks, this.resolvedTheme.gridColor);

      for (const series of this.series) {
        if (!series.visible) continue;
        series.rebuildPyramid();
        this.painter.drawSeries(series);
      }
      const report = this.engine.endFrame();
      this.stats.drawCalls = report.drawCalls;
      this.stats.uploadBytes = report.uploadBytes;

      this.axisOverlay?.update(this.axis, this.rightAxis, this.xTicks, this.yTicks, this.y2Ticks);
      this.updateAutoGutters();
      this.events.emit("render", undefined);
    } catch (error) {
      if (this.engine.isLost) {
        this.rendererLost = true;
        this.resetFrameStats();
        return;
      }
      throw error;
    }

    this.stats.frameMs = performance.now() - frameStartedAt;
    this.hover.cancelScheduled();
    this.hover.refresh();
    if (this.running && this.options.renderLoop !== "continuous" && this.followXPolicy.options?.currentX && !this.followXPolicy.isPaused) {
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
    if (this.a11y.forcedColorsActive || this.a11y.originalStyles.has(series)) {
      this.a11y.originalStyles.set(series, resolved);
      this.a11y.applyForcedSeriesStyles();
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
      if (this.a11y.forcedColorsActive) this.a11y.originalStyles.set(series, resolved);
      else series.applyResolvedStyle(resolved);
    }
    if (!this.a11y.forcedColorsActive) this.a11y.originalStyles.clear();
  }

  private resolveSeriesStyle(style: SeriesStyleOptions, paletteIndex: number): SeriesStyle {
    // The caller palette, not the forced-colors one: forced styles are applied on top and undone later.
    const palette = this.baseTheme.seriesColors;
    return resolveSeriesStyle(style, palette[paletteIndex % palette.length]!, this.layout.root);
  }

  private handleSeriesChange(change: SeriesChange): void {
    if (change === "visibility") {
      this.emitSeriesChange();
    } else {
      this.requestRender();
      this.a11y.markSummaryDirty();
    }
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

  /** Attached series that pass the visibility and explicit-series filters. */
  private candidateSeries(options: { readonly series?: readonly SeriesStore[]; readonly includeHidden?: boolean }): SeriesStore[] {
    const candidates = options.series ? options.series.filter((series) => this.series.includes(series)) : this.series;
    return options.includeHidden ? candidates : candidates.filter((series) => series.visible);
  }

  private applyAutoFitYPolicy(): void {
    const option = this.options.autoFitY;
    if (!option) return;
    this.fitToData({ ...(option === true ? {} : option), x: false, xMin: this.camera.xMin, xMax: this.camera.xMax });
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
      [canvas, "pointermove", this.hover.onPointerMove],
      [canvas, "pointerdown", this.hover.onPointerDown],
      [canvas, "pointerup", this.hover.onPointerUp],
      [canvas, "pointerleave", this.hover.onPointerLeave],
      [canvas, "click", this.hover.onClick],
      [canvas, "dblclick", this.hover.onDoubleClick],
    ];
    if (this.a11y.hasSummary) listeners.push([root, "focusin", this.handleRootFocusIn]);
    for (const [target, type, listener] of listeners) target[method](type, listener as EventListener);
  }

  private scheduleRenderAfterRestore(): void {
    if (this.restoreRenderRafId !== 0) return;
    this.restoreRenderRafId = this.layout.view.requestAnimationFrame(() => {
      this.restoreRenderRafId = 0;
      this.render();
    });
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

  private updateTitles(): void {
    this.layout.applyTitles({ title: this.options.title, subtitle: this.options.subtitle, axes: this.normalizedAxes, theme: this.resolvedTheme });
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

  private emitViewportChange(source: ChartViewportChangeSource): void {
    this.events.emit("viewportchange", { viewport: this.camera.viewport, rightViewport: this.rightCamera.viewport, source });
    this.requestRender();
  }

  private emitFollowXChange(): void {
    if (this.events.has("followxchange")) this.events.emit("followxchange", { state: this.getFollowXState() });
  }

  private emitSeriesChange(): void {
    this.a11y.markSummaryDirty();
    this.events.emit("serieschange", undefined);
    this.hover.refresh();
    this.requestRender();
  }
}
