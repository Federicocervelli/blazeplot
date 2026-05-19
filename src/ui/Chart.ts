import type { SeriesConfig, SeriesStyle, Dataset, SeriesMode, SeriesSample, SeriesYAxis, Viewport } from "../core/types.js";
import { SeriesStore } from "../core/SeriesStore.js";
import { RingBuffer } from "../core/RingBuffer.js";
import { Renderer } from "../render/Renderer.js";
import { ReglBackend } from "../render/ReglBackend.js";
import type { GpuBuffer } from "../render/types.js";
import { Camera2D } from "../interaction/Camera2D.js";
import { AxisController } from "../interaction/AxisController.js";
import type { AxisControllerAxisOptions, AxisScale, AxisTickFormat, AxisTimeZone } from "../interaction/AxisController.js";
import type { PanIntent, ViewportPolicy, ZoomIntent } from "../interaction/types.js";
import { AxisOverlay } from "./AxisOverlay.js";
import { ChartLayout } from "./ChartLayout.js";
import type { AxisPosition, NormalizedAxisConfig } from "./ChartLayout.js";
import { resolveChartTheme, rgbaCss } from "./theme.js";
import type { ChartTheme, ResolvedChartTheme } from "./theme.js";

const RAW_LINE_VERTEX_CAPACITY = 16_384;
const AREA_POINT_CAPACITY = RAW_LINE_VERTEX_CAPACITY >> 1;
const MINMAX_SEGMENT_CAPACITY = RAW_LINE_VERTEX_CAPACITY >> 1;
const FLOATS_PER_MINMAX_SEGMENT_INSTANCE = 3;
const BAR_TRIANGLE_CAPACITY = 4_096;
const FLOATS_PER_BAR_TRIANGLE = 12;
const FLOATS_PER_OHLC_CANDLE = 12;
const FLOATS_PER_OHLC_TUPLE = 5;
const GRID_LINE_VERTEX_CAPACITY = 64;
const DEFAULT_POINT_SIZE_PX = 4;
const MAX_EXACT_SCATTER_POINTS = RAW_LINE_VERTEX_CAPACITY * 4;

function normalizeFitPadding(padding: number | ChartFitToDataPadding | undefined): Required<ChartFitToDataPadding> {
  if (typeof padding === "number") {
    const value = Number.isFinite(padding) ? Math.max(0, padding) : 0;
    return { x: value, y: value };
  }
  const x = padding?.x;
  const y = padding?.y;
  return {
    x: typeof x === "number" && Number.isFinite(x) ? Math.max(0, x) : 0,
    y: typeof y === "number" && Number.isFinite(y) ? Math.max(0, y) : 0,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load SVG overlay for screenshot export."));
    image.src = src;
  });
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

export interface TextOverlayConfig {
  readonly text: string;
  readonly visible?: boolean;
  readonly color?: string;
  readonly font?: string;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface AxisTitleConfig extends TextOverlayConfig {}

export interface ChartTitleConfig extends TextOverlayConfig {
  readonly align?: "left" | "center" | "right";
}

export interface AxisConfig extends AxisControllerAxisOptions {
  readonly visible?: boolean;
  readonly position?: AxisPosition;
  readonly scale?: AxisScale;
  readonly tickFormat?: AxisTickFormat;
  readonly timezone?: AxisTimeZone;
  readonly title?: string | AxisTitleConfig;
}

export type ChartPickMode = "nearest-x" | "nearest-point";
export type ChartPickGroup = "x" | "none";

export interface ChartPickOptions {
  readonly mode?: ChartPickMode;
  readonly group?: ChartPickGroup;
  readonly maxDistancePx?: number;
}

export interface ChartPluginHandle {
  dispose(): void;
}

export interface ChartPlugin {
  install(chart: Chart): void | (() => void) | ChartPluginHandle;
}

export interface ChartAccessibilityOptions {
  readonly enabled?: boolean;
  readonly label?: string;
  readonly description?: string;
  readonly role?: string;
  readonly keyboard?: boolean | ChartKeyboardOptions;
}

export interface ChartKeyboardOptions {
  readonly enabled?: boolean;
  readonly panFraction?: number;
  readonly zoomFactor?: number;
}

export interface ChartOptions {
  readonly viewportPolicy?: ViewportPolicy;
  readonly grid?: boolean;
  readonly gridStyle?: Partial<SeriesStyle>;
  readonly axes?: boolean | { x?: boolean | AxisConfig; y?: boolean | AxisConfig; y2?: boolean | AxisConfig };
  readonly title?: string | ChartTitleConfig;
  readonly subtitle?: string | ChartTitleConfig;
  readonly hover?: ChartPickOptions;
  readonly accessibility?: boolean | ChartAccessibilityOptions;
  readonly plugins?: readonly ChartPlugin[];
  readonly theme?: ChartTheme;
}

export type TypedSeriesConfig = Omit<SeriesConfig, "mode">;

export interface ChartSeriesState {
  readonly series: SeriesStore;
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly mode: SeriesMode;
  readonly visible: boolean;
  readonly color: readonly [number, number, number, number];
  readonly yAxis: SeriesYAxis;
}

export interface ChartPickItem extends SeriesSample {
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

export type ChartPointerEventType = "click" | "dblclick" | "pointerdown" | "pointerup" | "pointermove";

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

export interface ChartSeriesClickEvent extends ChartPointerEventState {
  readonly item: ChartPickItem;
}

export interface ChartViewportChangeEvent {
  readonly viewport: Viewport;
  readonly rightViewport: Viewport;
}

export interface ChartSelectEvent<T = unknown> {
  readonly selection: T;
}

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

export interface ChartScreenshotOptions {
  readonly type?: string;
  readonly quality?: number;
  readonly background?: string | null;
  readonly dpr?: number;
  readonly width?: number;
  readonly height?: number;
  readonly transparent?: boolean;
}

export interface ChartFitToDataPadding {
  readonly x?: number;
  readonly y?: number;
}

export interface ChartFitToDataOptions {
  readonly series?: readonly SeriesStore[];
  readonly visibleOnly?: boolean;
  readonly x?: boolean;
  readonly y?: boolean;
  readonly yAxis?: SeriesYAxis | "both";
  readonly padding?: number | ChartFitToDataPadding;
  readonly includeZero?: boolean;
  readonly xMin?: number;
  readonly xMax?: number;
}

export interface ChartLayoutReservation {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

export interface ChartFrameStats {
  fps: number;
  frameMs: number;
  pointsRendered: number;
  drawCalls: number;
  uploadBytes: number;
  renderMode: "none" | "raw" | "minmax" | "points" | "bars" | "area" | "mixed";
}

type ResolvedAxisConfig = NormalizedAxisConfig & AxisControllerAxisOptions & { readonly title?: string | AxisTitleConfig };

type ResolvedAxesConfig = { x: ResolvedAxisConfig; y: ResolvedAxisConfig; y2: ResolvedAxisConfig };

function normalizeAxisConfig(config: boolean | AxisConfig | undefined): ResolvedAxisConfig {
  if (config === false) return { visible: false, position: "inside" };
  if (config === true || config === undefined) return { visible: true, position: "inside" };
  return {
    visible: config.visible !== false,
    position: config.position ?? "inside",
    scale: config.scale,
    tickFormat: config.tickFormat,
    timezone: config.timezone,
    logBase: config.logBase,
    symlogConstant: config.symlogConstant,
    categories: config.categories,
    reversed: config.reversed,
    title: config.title,
  };
}

function normalizeAxesConfig(axes: ChartOptions["axes"]): ResolvedAxesConfig {
  if (axes === false) {
    return {
      x: { visible: false, position: "inside" },
      y: { visible: false, position: "inside" },
      y2: { visible: false, position: "inside" },
    };
  }
  if (axes === true || axes === undefined) {
    return {
      x: { visible: true, position: "inside" },
      y: { visible: true, position: "inside" },
      y2: { visible: false, position: "inside" },
    };
  }
  return {
    x: normalizeAxisConfig(axes.x),
    y: normalizeAxisConfig(axes.y),
    y2: normalizeAxisConfig(axes.y2 ?? false),
  };
}

function textOverlayText(config: string | TextOverlayConfig | undefined): string {
  return typeof config === "string" ? config : config?.text ?? "";
}

function textOverlayVisible(config: string | TextOverlayConfig | undefined): boolean {
  return typeof config === "string" ? config.length > 0 : !!config && config.visible !== false && config.text.length > 0;
}

function textOverlayOffsetX(config: string | TextOverlayConfig | undefined): number {
  return typeof config === "string" ? 0 : config?.offsetX ?? 0;
}

function textOverlayOffsetY(config: string | TextOverlayConfig | undefined): number {
  return typeof config === "string" ? 0 : config?.offsetY ?? 0;
}

interface PickCandidate {
  readonly sample: SeriesSample;
  readonly series: SeriesStore;
  readonly seriesIndex: number;
}

export class Chart {
  private series: SeriesStore[] = [];
  private camera: Camera2D;
  private rightCamera: Camera2D;
  private axis: AxisController;
  private rightAxis: AxisController;
  private renderer: Renderer;
  private rawLineBuffer: GpuBuffer;
  private rawLineData: Float32Array;
  private minMaxInstanceBuffer: GpuBuffer;
  private minMaxInstanceData: Float32Array;
  private barTriangleBuffer: GpuBuffer;
  private barTriangleData: Float32Array;
  private gridBuffer: GpuBuffer;
  private gridData: Float32Array;
  private gridStyle: SeriesStyle;
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];
  private axisOverlay: AxisOverlay | null = null;
  private normalizedAxes: ResolvedAxesConfig;
  private resolvedTheme: ResolvedChartTheme;
  private _gridVisible: boolean;
  private layout: ChartLayout;
  private stats: ChartFrameStats = {
    fps: 0,
    frameMs: 0,
    pointsRendered: 0,
    drawCalls: 0,
    uploadBytes: 0,
    renderMode: "none",
  };
  private resizeObserver: ResizeObserver | null = null;
  private readonly pluginDisposers: Array<() => void> = [];
  private readonly hoverSubscribers = new Set<(state: ChartHoverState | null) => void>();
  private readonly seriesSubscribers = new Set<() => void>();
  private readonly themeSubscribers = new Set<() => void>();
  private readonly renderSubscribers = new Set<(chart: Chart) => void>();
  private readonly layoutReservations = new Map<string, ChartLayoutReservation>();
  private readonly viewportSubscribers = new Set<(event: ChartViewportChangeEvent) => void>();
  private readonly selectSubscribers = new Set<(event: ChartSelectEvent) => void>();
  private readonly seriesClickSubscribers = new Set<(event: ChartSeriesClickEvent) => void>();
  private readonly pointerSubscribers: Record<ChartPointerEventType, Set<(event: ChartPointerEventState) => void>> = {
    click: new Set(),
    dblclick: new Set(),
    pointerdown: new Set(),
    pointerup: new Set(),
    pointermove: new Set(),
  };
  private currentHover: ChartHoverState | null = null;
  private lastPointerClientX: number = 0;
  private lastPointerClientY: number = 0;
  private pointerInPlot: boolean = false;
  private lastFrameAt: number = 0;
  private currentXOrigin: number = 0;
  private _rafId: number = 0;
  private _hoverRafId: number = 0;
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") {
      this.pointerInPlot = true;
      this.lastPointerClientX = event.clientX;
      this.lastPointerClientY = event.clientY;
      this.scheduleHoverRefresh();
    }
    if (this.pointerSubscribers.pointermove.size > 0) this.emitPointerEvent("pointermove", event);
  };
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.pointerInPlot = false;
      this.emitHover(null);
    }
    this.emitPointerEvent("pointerdown", event);
  };
  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.emitPointerEvent("pointerup", event);
  };
  private readonly handleClick = (event: MouseEvent): void => {
    const pointerEvent = this.emitPointerEvent("click", event);
    const item = pointerEvent?.items[0];
    if (pointerEvent && item) this.emitSeriesClick({ ...pointerEvent, item });
  };
  private readonly handleDoubleClick = (event: MouseEvent): void => {
    this.emitPointerEvent("dblclick", event);
  };
  private readonly handlePointerLeave = (): void => {
    this.pointerInPlot = false;
    this.emitHover(null);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.handleKeyboardNavigation(event);
  };

  constructor(target: HTMLElement, private readonly options: ChartOptions = {}) {
    this.resolvedTheme = resolveChartTheme(options.theme, target);
    this.normalizedAxes = normalizeAxesConfig(options.axes);
    this._gridVisible = options.grid !== false;

    this.layout = new ChartLayout(target, this.normalizedAxes);
    this.layout.root.style.background = this.resolvedTheme.backgroundCssColor;
    this.applyAccessibility();
    this.applyCanvasSize();
    this.camera = new Camera2D();
    this.rightCamera = new Camera2D();
    this.applyAxisDirections();
    this.axis = new AxisController(this.camera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y });
    this.rightAxis = new AxisController(this.rightCamera, { x: this.normalizedAxes.x, y: this.normalizedAxes.y2 });
    this.renderer = new Renderer(new ReglBackend(this.layout.canvas));
    this.rawLineData = new Float32Array(RAW_LINE_VERTEX_CAPACITY * 2);
    this.rawLineBuffer = this.renderer.createFloatBuffer(this.rawLineData.length);
    this.minMaxInstanceData = new Float32Array(MINMAX_SEGMENT_CAPACITY * FLOATS_PER_MINMAX_SEGMENT_INSTANCE);
    this.minMaxInstanceBuffer = this.renderer.createFloatBuffer(this.minMaxInstanceData.length);
    this.barTriangleData = new Float32Array(BAR_TRIANGLE_CAPACITY * FLOATS_PER_BAR_TRIANGLE);
    this.barTriangleBuffer = this.renderer.createFloatBuffer(this.barTriangleData.length);
    this.gridData = new Float32Array(GRID_LINE_VERTEX_CAPACITY * 2);
    this.gridBuffer = this.renderer.createFloatBuffer(this.gridData.length);
    this.gridStyle = {
      color: options.gridStyle?.color ?? this.resolvedTheme.gridColor,
      lineWidth: options.gridStyle?.lineWidth ?? 1,
    };

    if (this.normalizedAxes.x.visible || this.normalizedAxes.y.visible || this.normalizedAxes.y2.visible) {
      this.axisOverlay = new AxisOverlay(this.layout, this.normalizedAxes, {
        color: this.resolvedTheme.axisColor,
        font: this.resolvedTheme.axisFont,
      });
    }
    this.updateTextOverlays();

    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("dblclick", this.handleDoubleClick);
    this.layout.root.addEventListener("keydown", this.handleKeyDown);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.layout.plot);
    }

    for (const plugin of options.plugins ?? []) {
      const installed = plugin.install(this);
      if (typeof installed === "function") {
        this.pluginDisposers.push(installed);
      } else if (installed) {
        this.pluginDisposers.push(() => installed.dispose());
      }
    }
  }

  get canvas(): HTMLCanvasElement {
    return this.layout.canvas;
  }

  get rootElement(): HTMLElement {
    return this.layout.root;
  }

  get plotElement(): HTMLElement {
    return this.layout.plot;
  }

  get xAxisElement(): HTMLElement {
    return this.layout.xAxis;
  }

  get yAxisElement(): HTMLElement {
    return this.layout.yAxis;
  }

  get y2AxisElement(): HTMLElement {
    return this.layout.y2Axis;
  }

  get theme(): ResolvedChartTheme {
    return this.resolvedTheme;
  }

  getWebGLContext(): WebGL2RenderingContext | null {
    return this.renderer.getWebGLContext();
  }

  getCamera(yAxis: SeriesYAxis = "left"): Camera2D {
    return yAxis === "right" ? this.rightCamera : this.camera;
  }

  dataToPlot(x: number, y: number, yAxis: SeriesYAxis = "left"): [number, number] {
    const camera = this.getCamera(yAxis);
    const [clipX, clipY] = camera.toClip(x, y);
    return camera.toScreen(clipX, clipY, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  clientToData(clientX: number, clientY: number, yAxis: SeriesYAxis = "left"): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const plotX = clientX - rect.left;
    const plotY = clientY - rect.top;
    if (plotX < 0 || plotY < 0 || plotX > rect.width || plotY > rect.height) return null;

    return this.getCamera(yAxis).screenToData(plotX, plotY, rect.width, rect.height);
  }

  getViewport(yAxis: SeriesYAxis = "left"): Viewport {
    return this.getCamera(yAxis).viewport;
  }

  pan(intent: PanIntent): void {
    this.camera.pan(intent);
    this.syncRightCameraX();
    this.emitViewportChange();
    this.refreshHover();
  }

  zoom(intent: ZoomIntent): void {
    this.camera.zoom(intent);
    this.syncRightCameraX();
    this.emitViewportChange();
    this.refreshHover();
  }

  addSeries(config: SeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    if ((config.mode === "ohlc" || config.mode === "candlestick") && !config.dataset) {
      throw new TypeError("OHLC and candlestick series require an OhlcDataset.");
    }
    const dataset: Dataset = config.dataset ?? this.createDefaultDataset(config);
    const palette = this.resolvedTheme.seriesColors;
    const paletteColor = palette[this.series.length % palette.length] ?? this.resolvedTheme.seriesColors[0]!;
    const color = style?.color ?? paletteColor;
    const s = new SeriesStore(dataset, config, {
      color,
      lineWidth: style?.lineWidth ?? 1,
      pointSize: style?.pointSize ?? 4,
      barWidth: style?.barWidth ?? 0.8,
      baseline: style?.baseline ?? 0,
      fillColor: style?.fillColor ?? [color[0], color[1], color[2], color[3] * 0.25],
      tickWidth: style?.tickWidth ?? style?.barWidth ?? 0.8,
      upColor: style?.upColor ?? color,
      downColor: style?.downColor ?? style?.fillColor ?? [color[0], color[1], color[2], color[3] * 0.45],
      wickColor: style?.wickColor ?? color,
    });
    this.series.push(s);
    this.emitSeriesChange();
    return s;
  }

  addLine(config: TypedSeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    return this.addSeries({ ...config, mode: "line" }, style);
  }

  addArea(config: TypedSeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    return this.addSeries({ ...config, mode: "area" }, style);
  }

  addScatter(config: TypedSeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    return this.addSeries({ ...config, mode: "scatter" }, style);
  }

  addBar(config: TypedSeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    return this.addSeries({ ...config, mode: "bar" }, style);
  }

  addOhlc(config: TypedSeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    return this.addSeries({ ...config, mode: "ohlc" }, style);
  }

  addCandlestick(config: TypedSeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    return this.addSeries({ ...config, mode: "candlestick" }, style);
  }

  private createDefaultDataset(config: SeriesConfig): Dataset {
    const { capacity } = config;
    if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0) {
      throw new TypeError("Series capacity must be a positive integer when no dataset is provided.");
    }
    return new RingBuffer(capacity, { overflow: config.overflow });
  }

  removeSeries(series: SeriesStore): boolean {
    const index = this.series.indexOf(series);
    if (index === -1) return false;

    this.series.splice(index, 1);
    this.emitSeriesChange();
    return true;
  }

  setSeriesVisible(series: SeriesStore, visible: boolean): boolean {
    if (!this.series.includes(series)) return false;
    if (series.visible === visible) return true;
    series.setVisible(visible);
    this.emitSeriesChange();
    return true;
  }

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

  setViewport(v: { xMin?: number; xMax?: number; yMin?: number; yMax?: number }): void {
    this.camera.setViewport(v);
    this.rightCamera.setViewport(v);
    this.emitViewportChange();
    this.refreshHover();
  }

  setYViewport(yAxis: SeriesYAxis, v: { yMin?: number; yMax?: number }): void {
    this.getCamera(yAxis).setViewport(v);
    this.emitViewportChange();
    this.refreshHover();
  }

  fitToData(options: ChartFitToDataOptions = {}): boolean {
    const fitX = options.x !== false;
    const fitY = options.y !== false;
    if (!fitX && !fitY) return false;

    const visibleOnly = options.visibleOnly !== false;
    const yAxis = options.yAxis ?? "both";
    const padding = normalizeFitPadding(options.padding);
    let xMin = Infinity;
    let xMax = -Infinity;
    let leftYMin = Infinity;
    let leftYMax = -Infinity;
    let rightYMin = Infinity;
    let rightYMax = -Infinity;

    const candidates = options.series ?? this.series;
    for (const series of candidates) {
      if (!this.series.includes(series)) continue;
      if (visibleOnly && !series.visible) continue;
      const bounds = series.dataBounds({ xMin: options.xMin, xMax: options.xMax });
      if (!bounds) continue;

      xMin = Math.min(xMin, bounds.xMin);
      xMax = Math.max(xMax, bounds.xMax);
      const targetYAxis = series.config.yAxis ?? "left";
      if (targetYAxis === "right") {
        rightYMin = Math.min(rightYMin, bounds.yMin);
        rightYMax = Math.max(rightYMax, bounds.yMax);
      } else {
        leftYMin = Math.min(leftYMin, bounds.yMin);
        leftYMax = Math.max(leftYMax, bounds.yMax);
      }
    }

    let changed = false;
    if (fitX && Number.isFinite(xMin) && Number.isFinite(xMax)) {
      const xDomain = paddedDomain(xMin, xMax, padding.x, false);
      this.camera.setViewport({ xMin: xDomain.min, xMax: xDomain.max });
      this.rightCamera.setViewport({ xMin: xDomain.min, xMax: xDomain.max });
      changed = true;
    }

    if (fitY && (yAxis === "left" || yAxis === "both") && Number.isFinite(leftYMin) && Number.isFinite(leftYMax)) {
      const yDomain = paddedDomain(leftYMin, leftYMax, padding.y, options.includeZero === true);
      this.camera.setViewport({ yMin: yDomain.min, yMax: yDomain.max });
      changed = true;
    }

    if (fitY && (yAxis === "right" || yAxis === "both") && Number.isFinite(rightYMin) && Number.isFinite(rightYMax)) {
      const yDomain = paddedDomain(rightYMin, rightYMax, padding.y, options.includeZero === true);
      this.rightCamera.setViewport({ yMin: yDomain.min, yMax: yDomain.max });
      changed = true;
    }

    if (changed) {
      this.syncRightCameraX();
      this.emitViewportChange();
      this.refreshHover();
    }
    return changed;
  }

  resize(dpr: number = globalThis.devicePixelRatio): boolean {
    const resized = this.applyCanvasSize(dpr);
    if (resized) this.refreshHover();
    return resized;
  }

  getFrameStats(target: ChartFrameStats = { fps: 0, frameMs: 0, pointsRendered: 0, drawCalls: 0, uploadBytes: 0, renderMode: "none" }): ChartFrameStats {
    target.fps = this.stats.fps;
    target.frameMs = this.stats.frameMs;
    target.pointsRendered = this.stats.pointsRendered;
    target.drawCalls = this.stats.drawCalls;
    target.uploadBytes = this.stats.uploadBytes;
    target.renderMode = this.stats.renderMode;
    return target;
  }

  getHoverState(): ChartHoverState | null {
    return this.currentHover;
  }

  setLayoutReservation(id: string, reservation: ChartLayoutReservation | null): void {
    if (reservation) {
      this.layoutReservations.set(id, reservation);
    } else {
      this.layoutReservations.delete(id);
    }
    this.applyLayoutReservations();
    this.resize();
  }

  subscribe(event: "hover", callback: (state: ChartHoverState | null) => void): () => void;
  subscribe(event: "serieschange", callback: () => void): () => void;
  subscribe(event: "themechange", callback: () => void): () => void;
  subscribe(event: "render", callback: (chart: Chart) => void): () => void;
  subscribe(event: "viewportchange", callback: (event: ChartViewportChangeEvent) => void): () => void;
  subscribe(event: "select", callback: (event: ChartSelectEvent) => void): () => void;
  subscribe(event: "seriesclick", callback: (event: ChartSeriesClickEvent) => void): () => void;
  subscribe(event: ChartPointerEventType, callback: (event: ChartPointerEventState) => void): () => void;
  subscribe(
    event: "hover" | "serieschange" | "themechange" | "render" | "viewportchange" | "select" | "seriesclick" | ChartPointerEventType,
    callback:
      | ((state: ChartHoverState | null) => void)
      | (() => void)
      | ((chart: Chart) => void)
      | ((event: ChartViewportChangeEvent) => void)
      | ((event: ChartSelectEvent) => void)
      | ((event: ChartSeriesClickEvent) => void)
      | ((event: ChartPointerEventState) => void),
  ): () => void {
    if (event === "hover") {
      const cb = callback as (state: ChartHoverState | null) => void;
      this.hoverSubscribers.add(cb);
      return () => this.hoverSubscribers.delete(cb);
    }

    if (event === "themechange") {
      const cb = callback as () => void;
      this.themeSubscribers.add(cb);
      return () => this.themeSubscribers.delete(cb);
    }

    if (event === "render") {
      const cb = callback as (chart: Chart) => void;
      this.renderSubscribers.add(cb);
      return () => this.renderSubscribers.delete(cb);
    }

    if (event === "viewportchange") {
      const cb = callback as (event: ChartViewportChangeEvent) => void;
      this.viewportSubscribers.add(cb);
      return () => this.viewportSubscribers.delete(cb);
    }

    if (event === "select") {
      const cb = callback as (event: ChartSelectEvent) => void;
      this.selectSubscribers.add(cb);
      return () => this.selectSubscribers.delete(cb);
    }

    if (event === "seriesclick") {
      const cb = callback as (event: ChartSeriesClickEvent) => void;
      this.seriesClickSubscribers.add(cb);
      return () => this.seriesClickSubscribers.delete(cb);
    }

    if (event in this.pointerSubscribers) {
      const cb = callback as (event: ChartPointerEventState) => void;
      this.pointerSubscribers[event as ChartPointerEventType].add(cb);
      return () => this.pointerSubscribers[event as ChartPointerEventType].delete(cb);
    }

    const cb = callback as () => void;
    this.seriesSubscribers.add(cb);
    return () => this.seriesSubscribers.delete(cb);
  }

  emitSelect(selection: unknown): void {
    const event: ChartSelectEvent = { selection };
    for (const callback of this.selectSubscribers) callback(event);
  }

  setTheme(theme?: ChartTheme): void {
    this.resolvedTheme = resolveChartTheme(theme, this.layout.root);
    this.applyTheme();
    this.emitThemeChange();
    this.refreshHover();
  }

  setGridVisible(visible: boolean): void {
    this._gridVisible = visible;
  }

  getGridVisible(): boolean {
    return this._gridVisible;
  }

  setAxes(axes: ChartOptions["axes"]): void {
    this.normalizedAxes = normalizeAxesConfig(axes);
    this.applyAxisDirections();
    this.axis.setOptions({ x: this.normalizedAxes.x, y: this.normalizedAxes.y });
    this.rightAxis.setOptions({ x: this.normalizedAxes.x, y: this.normalizedAxes.y2 });
    this.layout.update(this.normalizedAxes);
    this.axisOverlay?.dispose();
    this.axisOverlay = null;
    if (this.normalizedAxes.x.visible || this.normalizedAxes.y.visible || this.normalizedAxes.y2.visible) {
      this.axisOverlay = new AxisOverlay(this.layout, this.normalizedAxes, {
        color: this.resolvedTheme.axisColor,
        font: this.resolvedTheme.axisFont,
      });
    }
    this.updateTextOverlays();
    this.resize();
    this.refreshHover();
  }

  pick(clientX: number, clientY: number, options: ChartPickOptions = {}): ChartHoverState | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const plotX = clientX - rect.left;
    const plotY = clientY - rect.top;
    if (plotX < 0 || plotY < 0 || plotX > rect.width || plotY > rect.height) return null;

    const viewport = this.camera.viewport;
    const dataX = viewport.xMin + (plotX / rect.width) * (viewport.xMax - viewport.xMin);
    const dataY = viewport.yMax - (plotY / rect.height) * (viewport.yMax - viewport.yMin);
    const mode = options.mode ?? this.options.hover?.mode ?? "nearest-x";
    const group = options.group ?? this.options.hover?.group ?? "x";
    const maxDistancePx = options.maxDistancePx ?? this.options.hover?.maxDistancePx ?? Infinity;
    const selected = mode === "nearest-point"
      ? this.findNearestPointCandidate(dataX, plotY, rect.width, rect.height, maxDistancePx)
      : this.findNearestXCandidate(dataX, rect.width, maxDistancePx);

    if (!selected) return null;

    const anchorX = selected.sample.x;
    const items = group === "none"
      ? [this.createPickItem(selected.sample, selected.series, selected.seriesIndex, clientX, clientY, rect)]
      : this.collectPickItems(anchorX, clientX, clientY, rect);
    return { clientX, clientY, plotX, plotY, dataX, dataY, anchorX, mode, group, maxDistancePx, items };
  }

  async screenshot(options: ChartScreenshotOptions = {}): Promise<Blob> {
    this.render();

    const rootRect = this.layout.root.getBoundingClientRect();
    const plotRect = this.layout.plot.getBoundingClientRect();
    const dpr = Number.isFinite(options.dpr) ? Math.max(1, options.dpr!) : Math.max(1, globalThis.devicePixelRatio || 1);
    const width = Number.isFinite(options.width) ? Math.max(1, Math.round(options.width!)) : Math.max(1, Math.round(rootRect.width * dpr));
    const height = Number.isFinite(options.height) ? Math.max(1, Math.round(options.height!)) : Math.max(1, Math.round(rootRect.height * dpr));
    const scaleX = width / Math.max(1, rootRect.width);
    const scaleY = height / Math.max(1, rootRect.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create a 2D canvas context for screenshot export.");

    const background = options.background === undefined && options.transparent !== true
      ? rgbaCss(this.resolvedTheme.backgroundColor)
      : options.background;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(
      this.canvas,
      (plotRect.left - rootRect.left) * scaleX,
      (plotRect.top - rootRect.top) * scaleY,
      plotRect.width * scaleX,
      plotRect.height * scaleY,
    );
    await this.drawSvgOverlaysForScreenshot(ctx, rootRect, scaleX, scaleY);
    this.drawDomTextForScreenshot(ctx, rootRect, scaleX, scaleY);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Unable to encode chart screenshot.")),
        options.type ?? "image/png",
        options.quality,
      );
    });
  }

  start(): void {
    const frame = (): void => {
      this._rafId = requestAnimationFrame(frame);
      this.render();
    };
    this._rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this._rafId);
  }

  private render(): void {
    const frameStartedAt = performance.now();
    if (this.lastFrameAt > 0) {
      this.stats.fps = 1000 / (frameStartedAt - this.lastFrameAt);
    }
    this.lastFrameAt = frameStartedAt;
    this.stats.pointsRendered = 0;
    this.stats.drawCalls = 0;
    this.stats.uploadBytes = 0;
    this.stats.renderMode = "none";

    this.options.viewportPolicy?.beforeRender?.(this.camera);
    this.syncRightCameraX();

    const [r, g, b, a] = this.resolvedTheme.backgroundColor;
    this.renderer.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.renderer.clear(r, g, b, a);

    const viewport = this.camera.viewport;
    this.currentXOrigin = viewport.xMin;
    this.renderer.setXOrigin(this.currentXOrigin);
    if (this._gridVisible) {
      const gridVertexCount = this.writeGridVertices(viewport);
      if (gridVertexCount > 0) {
        this.uploadGridData(gridVertexCount);
        this.renderer.drawClipLines(this.gridBuffer, gridVertexCount, this.gridStyle);
        this.stats.drawCalls++;
      }
    }

    for (const s of this.series) {
      if (!s.visible) continue;
      s.rebuildPyramid();
      this.drawSeries(s);
    }

    this.axisOverlay?.update(this.camera, this.axis, this.rightCamera, this.rightAxis);
    this.emitRender();

    this.stats.frameMs = performance.now() - frameStartedAt;
    if (this._hoverRafId !== 0) {
      cancelAnimationFrame(this._hoverRafId);
      this._hoverRafId = 0;
    }
    this.refreshHover();
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    if (this._hoverRafId !== 0) cancelAnimationFrame(this._hoverRafId);
    this._hoverRafId = 0;
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("dblclick", this.handleDoubleClick);
    this.layout.root.removeEventListener("keydown", this.handleKeyDown);
    for (const dispose of this.pluginDisposers.splice(0)) dispose();
    this.axisOverlay?.dispose();
    this.renderer.dispose();
    this.layout.dispose();
  }

  private applyAccessibility(): void {
    const option = this.options.accessibility;
    const enabled = option !== false;
    if (!enabled) return;

    const config = typeof option === "object" ? option : undefined;
    const label = config?.label ?? this.accessibleTitleText() ?? "BlazePlot chart";
    this.layout.root.tabIndex = this.layout.root.tabIndex >= 0 ? this.layout.root.tabIndex : 0;
    this.layout.root.setAttribute("role", config?.role ?? "img");
    this.layout.root.setAttribute("aria-label", label);
    if (config?.description) this.layout.root.setAttribute("aria-description", config.description);
    this.layout.plot.setAttribute("role", "presentation");
    this.canvas.setAttribute("aria-hidden", "true");
    this.xAxisElement.setAttribute("aria-hidden", "true");
    this.yAxisElement.setAttribute("aria-hidden", "true");
    this.y2AxisElement.setAttribute("aria-hidden", "true");
  }

  private accessibleTitleText(): string | null {
    const title = typeof this.options.title === "string" ? this.options.title : this.options.title?.text;
    const subtitle = typeof this.options.subtitle === "string" ? this.options.subtitle : this.options.subtitle?.text;
    return [title, subtitle].filter((part): part is string => Boolean(part)).join(" — ") || null;
  }

  private keyboardOptions(): Required<ChartKeyboardOptions> | null {
    const accessibility = this.options.accessibility;
    if (accessibility === false) return null;
    const keyboard = typeof accessibility === "object" ? accessibility.keyboard : undefined;
    if (keyboard === false) return null;
    const config = typeof keyboard === "object" ? keyboard : undefined;
    if (config?.enabled === false) return null;
    const panFraction = typeof config?.panFraction === "number" && Number.isFinite(config.panFraction)
      ? Math.max(0, config.panFraction)
      : 0.1;
    const zoomFactor = typeof config?.zoomFactor === "number" && Number.isFinite(config.zoomFactor) && config.zoomFactor > 1
      ? config.zoomFactor
      : 1.25;
    return { enabled: true, panFraction, zoomFactor };
  }

  private handleKeyboardNavigation(event: KeyboardEvent): void {
    const keyboard = this.keyboardOptions();
    if (!keyboard || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

    const panStep = keyboard.panFraction * (event.shiftKey ? 2.5 : 1);
    const zoomIn = keyboard.zoomFactor;
    const zoomOut = 1 / keyboard.zoomFactor;
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
        this.zoom({ factor: zoomIn, cx: 0.5, cy: 0.5, axis: "xy" });
        break;
      case "-":
      case "_":
        this.zoom({ factor: zoomOut, cx: 0.5, cy: 0.5, axis: "xy" });
        break;
      case "PageUp":
        this.zoom({ factor: zoomIn, cx: 0.5, cy: 0.5, axis: "y" });
        break;
      case "PageDown":
        this.zoom({ factor: zoomOut, cx: 0.5, cy: 0.5, axis: "y" });
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

  private applyTheme(): void {
    this.layout.root.style.background = this.resolvedTheme.backgroundCssColor;
    if (this.options.gridStyle?.color === undefined) {
      this.gridStyle = { ...this.gridStyle, color: this.resolvedTheme.gridColor };
    }
    this.axisOverlay?.setOptions({
      color: this.resolvedTheme.axisColor,
      font: this.resolvedTheme.axisFont,
    });
    this.updateTextOverlays();
  }

  private updateTextOverlays(): void {
    this.applyChartTextOverlay(this.layout.title, this.options.title, {
      color: this.resolvedTheme.titleColor,
      font: this.resolvedTheme.titleFont,
      top: 6,
    });
    this.applyChartTextOverlay(this.layout.subtitle, this.options.subtitle, {
      color: this.resolvedTheme.subtitleColor,
      font: this.resolvedTheme.subtitleFont,
      top: 26,
    });
    this.applyAxisTitleOverlay(this.layout.xAxisTitle, this.normalizedAxes.x.title, "x");
    this.applyAxisTitleOverlay(this.layout.yAxisTitle, this.normalizedAxes.y.title, "y");
    this.applyAxisTitleOverlay(this.layout.y2AxisTitle, this.normalizedAxes.y2.title, "y2");
  }

  private applyChartTextOverlay(
    el: HTMLElement,
    config: string | ChartTitleConfig | undefined,
    defaults: { readonly color: string; readonly font: string; readonly top: number },
  ): void {
    const visible = textOverlayVisible(config);
    el.textContent = textOverlayText(config);
    el.style.display = visible ? "block" : "none";
    if (!visible) return;

    const align = typeof config === "string" ? "center" : config?.align ?? "center";
    el.style.color = typeof config === "string" ? defaults.color : config?.color ?? defaults.color;
    el.style.font = typeof config === "string" ? defaults.font : config?.font ?? defaults.font;
    el.style.top = `${defaults.top + textOverlayOffsetY(config)}px`;
    el.style.left = align === "left" ? `${8 + textOverlayOffsetX(config)}px` : align === "right" ? "auto" : `calc(50% + ${textOverlayOffsetX(config)}px)`;
    el.style.right = align === "right" ? `${8 - textOverlayOffsetX(config)}px` : "auto";
    el.style.transform = align === "center" ? "translateX(-50%)" : "none";
    el.style.textAlign = align;
  }

  private applyAxisTitleOverlay(el: HTMLElement, config: string | AxisTitleConfig | undefined, axis: "x" | "y" | "y2"): void {
    const visible = textOverlayVisible(config);
    el.textContent = textOverlayText(config);
    el.style.display = visible ? "block" : "none";
    if (!visible) return;

    el.style.color = typeof config === "string" ? this.resolvedTheme.axisTitleColor : config?.color ?? this.resolvedTheme.axisTitleColor;
    el.style.font = typeof config === "string" ? this.resolvedTheme.axisTitleFont : config?.font ?? this.resolvedTheme.axisTitleFont;
    if (axis === "x") {
      el.style.left = `calc(50% + ${textOverlayOffsetX(config)}px)`;
      el.style.bottom = `${4 - textOverlayOffsetY(config)}px`;
      el.style.transform = "translateX(-50%)";
    } else if (axis === "y") {
      el.style.left = `${4 + textOverlayOffsetX(config)}px`;
      el.style.top = `calc(50% + ${textOverlayOffsetY(config)}px)`;
      el.style.transform = "translateY(-50%) rotate(-90deg)";
    } else {
      el.style.right = `${4 - textOverlayOffsetX(config)}px`;
      el.style.top = `calc(50% + ${textOverlayOffsetY(config)}px)`;
      el.style.transform = "translateY(-50%) rotate(90deg)";
    }
  }

  private applyLayoutReservations(): void {
    let top = 0;
    let right = 0;
    let bottom = 0;
    let left = 0;
    for (const reservation of this.layoutReservations.values()) {
      top += Math.max(0, reservation.top ?? 0);
      right += Math.max(0, reservation.right ?? 0);
      bottom += Math.max(0, reservation.bottom ?? 0);
      left += Math.max(0, reservation.left ?? 0);
    }
    this.layout.root.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
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

  private cameraForSeries(series: SeriesStore): Camera2D {
    return series.config.yAxis === "right" ? this.rightCamera : this.camera;
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

  private drawSeries(series: SeriesStore): void {
    const camera = this.cameraForSeries(series);
    const viewport = camera.viewport;
    switch (series.config.mode) {
      case "area":
        this.drawAreaSeries(series, viewport, camera);
        return;
      case "bar":
        this.drawBarSeries(series, viewport, camera);
        return;
      case "ohlc":
        this.drawOhlcSeries(series, viewport, camera);
        return;
      case "candlestick":
        this.drawCandlestickSeries(series, viewport, camera);
        return;
      case "scatter":
        this.drawScatterSeries(series, viewport, camera);
        return;
      default:
        this.drawLineSeries(series, viewport, camera);
    }
  }

  private drawLineSeries(series: SeriesStore, viewport: Viewport, camera: Camera2D): void {
    const visibleSamples = series.visibleSampleCount(viewport);
    const dense = series.hasLOD && visibleSamples > RAW_LINE_VERTEX_CAPACITY - 2;
    if (dense && this.renderer.supportsInstancedSegments) {
      const segmentCount = series.copyMinMaxInstanced(viewport, this.minMaxInstanceData, this.maxMinMaxSegments(), this.currentXOrigin);
      if (segmentCount <= 0) return;
      this.uploadMinMaxInstanceData(segmentCount);
      this.renderer.drawMinMaxSegmentsInstanced(this.minMaxInstanceBuffer, segmentCount, series.style, camera);
      this.recordDraw("minmax", segmentCount * 2);
      return;
    }

    if (dense) {
      const count = series.copyMinMaxVisible(viewport, this.rawLineData, this.maxMinMaxSegments(), this.currentXOrigin);
      if (count < 2) return;
      this.uploadRawLineData(count);
      this.renderer.drawMinMaxSegments(this.rawLineBuffer, count, series.style, camera);
      this.recordDraw("minmax", count);
      return;
    }

    const count = series.copyRawVisibleClipSpace(viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY);
    if (count < 2) return;
    this.uploadRawLineData(count);
    this.renderer.drawClipLineStrip(this.rawLineBuffer, count, series.style);
    this.recordDraw("raw", count);
  }

  private drawAreaSeries(series: SeriesStore, viewport: Viewport, camera: Camera2D): void {
    const range = series.visibleIndexRange(viewport, 1);
    if (range.end - range.start < 2) return;

    const baseline = series.style.baseline ?? 0;
    if (range.end - range.start > AREA_POINT_CAPACITY) {
      const areaVertexCount = series.copyAreaVisible(viewport, this.rawLineData, AREA_POINT_CAPACITY, baseline, this.currentXOrigin);
      if (areaVertexCount >= 4) {
        this.uploadRawLineData(areaVertexCount);
        this.renderer.drawAreaStrip(this.rawLineBuffer, areaVertexCount, series.style, camera);
        this.recordDraw("area", areaVertexCount);
      }

      const lineVertexCount = series.copyRawVisible(viewport, this.rawLineData, AREA_POINT_CAPACITY, this.currentXOrigin);
      if (lineVertexCount >= 2) {
        this.uploadRawLineData(lineVertexCount);
        this.renderer.drawLineStrip(this.rawLineBuffer, lineVertexCount, series.style, camera);
        this.recordDraw("area", lineVertexCount);
      }
      return;
    }

    for (let start = range.start; start < range.end;) {
      const areaVertexCount = series.copyAreaRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY, baseline, this.currentXOrigin);
      if (areaVertexCount < 4) break;

      this.uploadRawLineData(areaVertexCount);
      this.renderer.drawAreaStrip(this.rawLineBuffer, areaVertexCount, series.style, camera);
      this.recordDraw("area", areaVertexCount);
      start += Math.max(1, (areaVertexCount >> 1) - 1);
    }

    for (let start = range.start; start < range.end;) {
      const lineVertexCount = series.copyRawRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY, this.currentXOrigin);
      if (lineVertexCount < 2) break;

      this.uploadRawLineData(lineVertexCount);
      this.renderer.drawLineStrip(this.rawLineBuffer, lineVertexCount, series.style, camera);
      this.recordDraw("area", lineVertexCount);
      start += Math.max(1, lineVertexCount - 1);
    }

  }

  private drawOhlcSeries(series: SeriesStore, viewport: Viewport, camera: Camera2D): void {
    const range = series.visibleIndexRange(viewport);
    const maxCandles = Math.floor(this.rawLineData.length / FLOATS_PER_OHLC_CANDLE);
    for (let start = range.start; start < range.end;) {
      const candleCount = series.copyOhlcRange(start, range.end, this.rawLineData, maxCandles, series.style.tickWidth ?? series.style.barWidth ?? 0.8, this.currentXOrigin);
      if (candleCount <= 0) break;

      const vertexCount = candleCount * 6;
      this.uploadRawLineData(vertexCount);
      this.renderer.drawLines(this.rawLineBuffer, vertexCount, series.style, camera);
      this.recordDraw("raw", vertexCount);
      start += candleCount;
    }
  }

  private drawCandlestickSeries(series: SeriesStore, viewport: Viewport, camera: Camera2D): void {
    const range = series.visibleIndexRange(viewport, 1);
    const maxCandles = Math.min(
      Math.floor(this.rawLineData.length / FLOATS_PER_OHLC_TUPLE),
      this.maxBarTriangleBars(),
    );
    const wickStyle: SeriesStyle = { ...series.style, color: series.style.wickColor ?? series.style.color };
    const upStyle: SeriesStyle = { ...series.style, color: series.style.upColor ?? series.style.color };
    const downStyle: SeriesStyle = { ...series.style, color: series.style.downColor ?? series.style.fillColor ?? series.style.color };

    for (let start = range.start; start < range.end;) {
      const candleCount = series.copyOhlcTuplesRange(start, range.end, this.rawLineData, maxCandles, this.currentXOrigin);
      if (candleCount <= 0) break;

      const wickVertexCount = this.writeCandlestickWicks(candleCount);
      if (wickVertexCount > 0) {
        this.uploadBarTriangleData(wickVertexCount);
        this.renderer.drawLines(this.barTriangleBuffer, wickVertexCount, wickStyle, camera);
        this.recordDraw("raw", wickVertexCount);
      }

      const bodyWidth = series.style.barWidth ?? series.style.tickWidth ?? 0.8;
      this.drawCandlestickBodies(candleCount, bodyWidth, "up", upStyle, camera);
      this.drawCandlestickBodies(candleCount, bodyWidth, "down", downStyle, camera);
      start += candleCount;
    }
  }

  private drawScatterSeries(series: SeriesStore, viewport: Viewport, camera: Camera2D): void {
    const pointSize = series.style.pointSize ?? DEFAULT_POINT_SIZE_PX;

    const visibleSamples = series.visibleSampleCount(viewport);
    if (series.config.downsample === "none" && visibleSamples <= MAX_EXACT_SCATTER_POINTS) {
      const range = series.visibleIndexRange(viewport);
      for (let start = range.start; start < range.end; start += RAW_LINE_VERTEX_CAPACITY) {
        const count = series.copyScatterRange(
          start,
          Math.min(range.end, start + RAW_LINE_VERTEX_CAPACITY),
          viewport,
          this.rawLineData,
          RAW_LINE_VERTEX_CAPACITY,
          this.currentXOrigin,
          this.canvas.height,
          pointSize,
        );
        if (count <= 0) continue;

        this.uploadRawLineData(count);
        this.renderer.drawPoints(this.rawLineBuffer, count, series.style, camera, this.canvas.width, this.canvas.height);
        this.recordDraw("points", count);
      }
      return;
    }

    const count = series.copyScatterVisible(
      viewport,
      this.rawLineData,
      RAW_LINE_VERTEX_CAPACITY,
      this.canvas.width,
      this.canvas.height,
      pointSize,
      this.currentXOrigin,
    );
    if (count <= 0) return;

    this.uploadRawLineData(count);
    this.renderer.drawPoints(this.rawLineBuffer, count, series.style, camera, this.canvas.width, this.canvas.height);
    this.recordDraw("points", count);
  }

  private drawBarSeries(series: SeriesStore, viewport: Viewport, camera: Camera2D): void {
    const visibleSamples = series.visibleSampleCount(viewport);
    const rawBarCapacity = this.maxRawBarInstances();
    if (series.hasLOD && visibleSamples > rawBarCapacity) {
      const sampledCount = series.copyMinMaxInstanced(viewport, this.minMaxInstanceData, this.maxBarTriangleBars(), this.currentXOrigin);
      if (sampledCount <= 0) return;

      this.includeBaselineInBarRanges(sampledCount, series.style.baseline ?? 0);
      const vertexCount = this.writeBarBucketTriangles(sampledCount, viewport);
      this.drawBarTriangles(vertexCount, series.style, camera);
      return;
    }

    const range = series.visibleIndexRange(viewport, 1);
    const count = series.copyRawRange(range.start, range.end, this.rawLineData, rawBarCapacity, this.currentXOrigin);
    if (count <= 0) return;

    if (this.renderer.supportsInstancedBars) {
      this.uploadRawLineData(count);
      this.renderer.drawBarsInstanced(this.rawLineBuffer, count, series.style, camera);
      this.recordDraw("bars", count);
      return;
    }

    const vertexCount = this.writeBarTriangles(count, series.style.baseline ?? 0, series.style.barWidth ?? 0.8);
    this.drawBarTriangles(vertexCount, series.style, camera);
  }

  private uploadRawLineData(vertexCount: number): void {
    this.uploadFloatData(this.rawLineBuffer, this.rawLineData, vertexCount * 2);
  }

  private uploadMinMaxInstanceData(instanceCount: number): void {
    this.uploadFloatData(this.minMaxInstanceBuffer, this.minMaxInstanceData, instanceCount * FLOATS_PER_MINMAX_SEGMENT_INSTANCE);
  }

  private uploadBarTriangleData(vertexCount: number): void {
    this.uploadFloatData(this.barTriangleBuffer, this.barTriangleData, vertexCount * 2);
  }

  private uploadGridData(vertexCount: number): void {
    this.uploadFloatData(this.gridBuffer, this.gridData, vertexCount * 2);
  }

  private uploadFloatData(buffer: GpuBuffer, data: Float32Array, floatCount: number): void {
    const count = Math.max(0, Math.min(floatCount, data.length));
    this.renderer.updateFloatBuffer(buffer, data, count);
    this.stats.uploadBytes += count * Float32Array.BYTES_PER_ELEMENT;
  }


  private includeBaselineInBarRanges(barCount: number, baseline: number): void {
    for (let i = 0; i < barCount; i++) {
      const offset = i * FLOATS_PER_MINMAX_SEGMENT_INSTANCE;
      const minY = this.minMaxInstanceData[offset + 1]!;
      const maxY = this.minMaxInstanceData[offset + 2]!;
      this.minMaxInstanceData[offset + 1] = Math.min(baseline, minY);
      this.minMaxInstanceData[offset + 2] = Math.max(baseline, maxY);
    }
  }

  private writeBarTriangles(barCount: number, baseline: number, barWidth: number): number {
    const count = Math.min(barCount, this.maxBarTriangleBars());
    for (let i = 0; i < count; i++) {
      const x = this.rawLineData[i * 2]!;
      const y = this.rawLineData[i * 2 + 1]!;
      this.writeBarTriangle(i, x - barWidth * 0.5, x + barWidth * 0.5, baseline, y);
    }
    return count * 6;
  }

  private writeBarBucketTriangles(
    barCount: number,
    viewport: Viewport,
  ): number {
    const count = Math.min(barCount, this.maxBarTriangleBars());
    for (let i = 0; i < count; i++) {
      const minY = this.minMaxInstanceData[i * 3 + 1]!;
      const maxY = this.minMaxInstanceData[i * 3 + 2]!;
      const [x0, x1] = this.barBucketBounds(i, count, viewport);
      this.writeBarTriangle(i, x0, x1, minY, maxY);
    }
    return count * 6;
  }

  private barBucketBounds(
    index: number,
    count: number,
    viewport: { xMin: number; xMax: number },
  ): [number, number] {
    const x = this.minMaxInstanceData[index * 3]!;
    const viewportXMin = viewport.xMin - this.currentXOrigin;
    const viewportXMax = viewport.xMax - this.currentXOrigin;
    const viewportWidth = viewportXMax - viewportXMin;

    if (count <= 1) {
      const halfWidth = Math.max(0, viewportWidth * 0.5);
      return [
        Math.max(viewportXMin, x - halfWidth),
        Math.min(viewportXMax, x + halfWidth),
      ];
    }

    const prevX = index > 0 ? this.minMaxInstanceData[(index - 1) * 3]! : NaN;
    const nextX = index + 1 < count ? this.minMaxInstanceData[(index + 1) * 3]! : NaN;
    let x0 = index === 0 ? x - (nextX - x) * 0.5 : (prevX + x) * 0.5;
    let x1 = index + 1 === count ? x + (x - prevX) * 0.5 : (x + nextX) * 0.5;

    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) {
      const bucketWidth = viewportWidth / Math.max(1, count);
      x0 = viewportXMin + index * bucketWidth;
      x1 = index + 1 === count ? viewportXMax : x0 + bucketWidth;
    }

    return [
      Math.max(viewportXMin, x0),
      Math.min(viewportXMax, x1),
    ];
  }

  private writeCandlestickWicks(candleCount: number): number {
    for (let i = 0; i < candleCount; i++) {
      const src = i * FLOATS_PER_OHLC_TUPLE;
      const dst = i * 4;
      const x = this.rawLineData[src]!;
      const high = this.rawLineData[src + 2]!;
      const low = this.rawLineData[src + 3]!;
      this.barTriangleData[dst] = x;
      this.barTriangleData[dst + 1] = low;
      this.barTriangleData[dst + 2] = x;
      this.barTriangleData[dst + 3] = high;
    }
    return candleCount * 2;
  }

  private drawCandlestickBodies(
    candleCount: number,
    bodyWidth: number,
    direction: "up" | "down",
    style: SeriesStyle,
    camera: Camera2D,
  ): void {
    const halfWidth = bodyWidth * 0.5;
    let bodyCount = 0;
    for (let i = 0; i < candleCount && bodyCount < this.maxBarTriangleBars(); i++) {
      const src = i * FLOATS_PER_OHLC_TUPLE;
      const x = this.rawLineData[src]!;
      const open = this.rawLineData[src + 1]!;
      const close = this.rawLineData[src + 4]!;
      const isUp = close >= open;
      if ((direction === "up") !== isUp) continue;

      this.writeBarTriangle(bodyCount, x - halfWidth, x + halfWidth, Math.min(open, close), Math.max(open, close));
      bodyCount++;
    }

    this.drawBarTriangles(bodyCount * 6, style, camera);
  }

  private writeBarTriangle(index: number, x0: number, x1: number, y0: number, y1: number): void {
    const o = index * FLOATS_PER_BAR_TRIANGLE;
    this.barTriangleData[o] = x0;
    this.barTriangleData[o + 1] = y0;
    this.barTriangleData[o + 2] = x1;
    this.barTriangleData[o + 3] = y0;
    this.barTriangleData[o + 4] = x0;
    this.barTriangleData[o + 5] = y1;
    this.barTriangleData[o + 6] = x0;
    this.barTriangleData[o + 7] = y1;
    this.barTriangleData[o + 8] = x1;
    this.barTriangleData[o + 9] = y0;
    this.barTriangleData[o + 10] = x1;
    this.barTriangleData[o + 11] = y1;
  }

  private drawBarTriangles(
    vertexCount: number,
    style: SeriesStyle,
    camera: Camera2D,
    mode: "bars" | "area" = "bars",
  ): void {
    if (vertexCount <= 0) return;
    this.uploadBarTriangleData(vertexCount);
    this.renderer.drawBarTriangles(this.barTriangleBuffer, vertexCount, style, camera);
    this.recordDraw(mode, vertexCount);
  }

  private recordDraw(mode: "raw" | "minmax" | "points" | "bars" | "area", points: number, drawCalls: number = 1): void {
    this.recordRenderMode(mode);
    this.stats.pointsRendered += points;
    this.stats.drawCalls += drawCalls;
  }

  private findNearestXCandidate(
    dataX: number,
    plotWidth: number,
    maxDistancePx: number,
  ): PickCandidate | null {
    let best: PickCandidate | null = null;
    let bestDistancePx = Infinity;

    for (let seriesIndex = 0; seriesIndex < this.series.length; seriesIndex++) {
      const series = this.series[seriesIndex]!;
      if (!series.visible) continue;
      const viewport = this.cameraForSeries(series).viewport;
      const xScale = plotWidth / (viewport.xMax - viewport.xMin);
      const sample = series.nearestSampleByX(dataX, viewport);
      if (!sample) continue;
      const distancePx = Math.abs(sample.x - dataX) * xScale;
      if (distancePx < bestDistancePx) {
        best = { sample, series, seriesIndex };
        bestDistancePx = distancePx;
      }
    }

    return best && bestDistancePx <= maxDistancePx ? best : null;
  }

  private findNearestPointCandidate(
    dataX: number,
    plotY: number,
    plotWidth: number,
    plotHeight: number,
    maxDistancePx: number,
  ): PickCandidate | null {
    let best: PickCandidate | null = null;
    for (let seriesIndex = 0; seriesIndex < this.series.length; seriesIndex++) {
      const series = this.series[seriesIndex]!;
      if (!series.visible) continue;
      const viewport = this.cameraForSeries(series).viewport;
      const dataY = viewport.yMax - (plotY / plotHeight) * (viewport.yMax - viewport.yMin);
      const sample = series.nearestSampleByPoint(dataX, dataY, viewport, plotWidth, plotHeight, maxDistancePx);
      if (!sample) continue;
      if (!best || (sample.distancePx ?? Infinity) < (best.sample.distancePx ?? Infinity)) {
        best = { sample, series, seriesIndex };
      }
    }

    return best && (best.sample.distancePx ?? Infinity) <= maxDistancePx ? best : null;
  }

  private collectPickItems(
    anchorX: number,
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ): ChartPickItem[] {
    const items: ChartPickItem[] = [];
    for (let seriesIndex = 0; seriesIndex < this.series.length; seriesIndex++) {
      const series = this.series[seriesIndex]!;
      if (!series.visible) continue;
      const sample = series.nearestSampleByX(anchorX, this.cameraForSeries(series).viewport);
      if (!sample) continue;
      items.push(this.createPickItem(sample, series, seriesIndex, clientX, clientY, rect));
    }
    return items;
  }

  private createPickItem(
    sample: SeriesSample,
    series: SeriesStore,
    seriesIndex: number,
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ): ChartPickItem {
    const camera = this.cameraForSeries(series);
    const [clipX, clipY] = camera.toClip(sample.x, sample.y);
    const [plotX, plotY] = camera.toScreen(clipX, clipY, rect.width, rect.height);
    const itemClientX = rect.left + plotX;
    const itemClientY = rect.top + plotY;
    const dx = itemClientX - clientX;
    const dy = itemClientY - clientY;
    return {
      ...sample,
      distancePx: Math.hypot(dx, dy),
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
    if (this._hoverRafId !== 0) return;
    this._hoverRafId = requestAnimationFrame(() => {
      this._hoverRafId = 0;
      this.refreshHover();
    });
  }

  private refreshHover(): void {
    if (!this.pointerInPlot) return;
    this.emitHover(this.pick(this.lastPointerClientX, this.lastPointerClientY));
  }

  private emitHover(state: ChartHoverState | null): void {
    this.currentHover = state;
    for (const callback of this.hoverSubscribers) callback(state);
  }

  private emitPointerEvent(type: ChartPointerEventType, source: MouseEvent | PointerEvent): ChartPointerEventState | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const plotX = source.clientX - rect.left;
    const plotY = source.clientY - rect.top;
    if (plotX < 0 || plotY < 0 || plotX > rect.width || plotY > rect.height) return null;

    const viewport = this.camera.viewport;
    const dataX = viewport.xMin + (plotX / rect.width) * (viewport.xMax - viewport.xMin);
    const dataY = viewport.yMax - (plotY / rect.height) * (viewport.yMax - viewport.yMin);
    const hover = this.pick(source.clientX, source.clientY, this.options.hover);
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
    for (const callback of this.pointerSubscribers[type]) callback(event);
    return event;
  }

  private emitSeriesClick(event: ChartSeriesClickEvent): void {
    for (const callback of this.seriesClickSubscribers) callback(event);
  }

  private emitViewportChange(): void {
    const event: ChartViewportChangeEvent = {
      viewport: this.camera.viewport,
      rightViewport: this.rightCamera.viewport,
    };
    for (const callback of this.viewportSubscribers) callback(event);
  }

  private emitSeriesChange(): void {
    for (const callback of this.seriesSubscribers) callback();
    this.refreshHover();
  }

  private emitThemeChange(): void {
    for (const callback of this.themeSubscribers) callback();
  }

  private emitRender(): void {
    for (const callback of this.renderSubscribers) callback(this);
  }

  private async drawSvgOverlaysForScreenshot(ctx: CanvasRenderingContext2D, rootRect: DOMRect, scaleX: number, scaleY: number): Promise<void> {
    const svgs = this.layout.root.querySelectorAll<SVGSVGElement>("svg");
    const serializer = new XMLSerializer();
    for (const source of svgs) {
      const style = getComputedStyle(source);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      const rect = source.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const clone = source.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(rect.width));
      clone.setAttribute("height", String(rect.height));
      if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      const blob = new Blob([serializer.serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const image = await loadImage(url);
        ctx.save();
        ctx.globalAlpha = Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : 1;
        ctx.drawImage(
          image,
          (rect.left - rootRect.left) * scaleX,
          (rect.top - rootRect.top) * scaleY,
          rect.width * scaleX,
          rect.height * scaleY,
        );
        ctx.restore();
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  private drawDomTextForScreenshot(ctx: CanvasRenderingContext2D, rootRect: DOMRect, scaleX: number, scaleY: number): void {
    const elements = this.layout.root.querySelectorAll<HTMLElement>("div");
    for (const el of elements) {
      const text = el.textContent;
      if (!text || el.children.length > 0) continue;

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      ctx.save();
      ctx.scale(scaleX, scaleY);
      ctx.font = style.font;
      ctx.fillStyle = style.color;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(text, rect.left - rootRect.left, rect.top - rootRect.top);
      ctx.restore();
    }
  }

  private maxMinMaxSegments(): number {
    return Math.min(this.canvas.width, MINMAX_SEGMENT_CAPACITY);
  }

  private maxBarTriangleBars(): number {
    return Math.min(BAR_TRIANGLE_CAPACITY, RAW_LINE_VERTEX_CAPACITY);
  }

  private maxRawBarInstances(): number {
    return this.renderer.supportsInstancedBars ? RAW_LINE_VERTEX_CAPACITY : this.maxBarTriangleBars();
  }

  private writeGridVertices(viewport: Viewport): number {
    const plotW = Math.max(1, this.canvas.clientWidth);
    const plotH = Math.max(1, this.canvas.clientHeight);
    this.axis.getXTickValues(plotW, 12, this.xTicks);
    this.axis.getYTickValues(plotH, 8, this.yTicks);

    let vertexCount = 0;
    for (const x of this.xTicks) {
      if (vertexCount + 2 > GRID_LINE_VERTEX_CAPACITY) return vertexCount;
      this.gridData[vertexCount * 2] = this.xToClip(x, viewport);
      this.gridData[vertexCount * 2 + 1] = -1;
      vertexCount++;
      this.gridData[vertexCount * 2] = this.xToClip(x, viewport);
      this.gridData[vertexCount * 2 + 1] = 1;
      vertexCount++;
    }

    for (const y of this.yTicks) {
      if (vertexCount + 2 > GRID_LINE_VERTEX_CAPACITY) return vertexCount;
      this.gridData[vertexCount * 2] = -1;
      this.gridData[vertexCount * 2 + 1] = this.yToClip(y, viewport);
      vertexCount++;
      this.gridData[vertexCount * 2] = 1;
      this.gridData[vertexCount * 2 + 1] = this.yToClip(y, viewport);
      vertexCount++;
    }

    return vertexCount;
  }

  private xToClip(x: number, viewport: Viewport): number {
    return ((x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * 2 - 1;
  }

  private yToClip(y: number, viewport: Viewport): number {
    return ((y - viewport.yMin) / (viewport.yMax - viewport.yMin)) * 2 - 1;
  }

  private recordRenderMode(mode: "raw" | "minmax" | "points" | "bars" | "area"): void {
    if (this.stats.renderMode === "none") {
      this.stats.renderMode = mode;
    } else if (this.stats.renderMode !== mode) {
      this.stats.renderMode = "mixed";
    }
  }
}
