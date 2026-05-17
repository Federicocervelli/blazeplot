import type { SeriesConfig, SeriesStyle, Dataset, SeriesMode, SeriesSample, Viewport } from "../core/types.js";
import { SeriesStore } from "../core/SeriesStore.js";
import { RingBuffer } from "../core/RingBuffer.js";
import { Renderer } from "../render/Renderer.js";
import { ReglBackend } from "../render/ReglBackend.js";
import type { GpuBuffer } from "../render/types.js";
import { Camera2D } from "../interaction/Camera2D.js";
import { AxisController } from "../interaction/AxisController.js";
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
const GRID_LINE_VERTEX_CAPACITY = 64;

export interface AxisConfig {
  readonly visible?: boolean;
  readonly position?: AxisPosition;
}

export type ChartPickMode = "nearest-x" | "nearest-point";

export interface ChartPickOptions {
  readonly mode?: ChartPickMode;
  readonly maxDistancePx?: number;
}

export interface ChartPluginHandle {
  dispose(): void;
}

export interface ChartPlugin {
  install(chart: Chart): void | (() => void) | ChartPluginHandle;
}

export interface ChartOptions {
  readonly viewportPolicy?: ViewportPolicy;
  readonly grid?: boolean;
  readonly gridStyle?: Partial<SeriesStyle>;
  readonly axes?: boolean | { x?: boolean | AxisConfig; y?: boolean | AxisConfig };
  readonly hover?: ChartPickOptions;
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

export interface ChartHoverState {
  readonly clientX: number;
  readonly clientY: number;
  readonly plotX: number;
  readonly plotY: number;
  readonly dataX: number;
  readonly dataY: number;
  readonly anchorX: number;
  readonly mode: ChartPickMode;
  readonly items: readonly ChartPickItem[];
}

export interface ChartScreenshotOptions {
  readonly type?: string;
  readonly quality?: number;
  readonly background?: string;
  readonly dpr?: number;
}

export interface ChartFrameStats {
  fps: number;
  frameMs: number;
  pointsRendered: number;
  drawCalls: number;
  uploadBytes: number;
  renderMode: "none" | "raw" | "minmax" | "points" | "bars" | "area" | "mixed";
}

function normalizeAxisConfig(config: boolean | AxisConfig | undefined): NormalizedAxisConfig {
  if (config === false) return { visible: false, position: "inside" };
  if (config === true || config === undefined) return { visible: true, position: "inside" };
  return {
    visible: config.visible !== false,
    position: config.position ?? "inside",
  };
}

function normalizeAxesConfig(axes: ChartOptions["axes"]): { x: NormalizedAxisConfig; y: NormalizedAxisConfig } {
  if (axes === false) {
    return { x: { visible: false, position: "inside" }, y: { visible: false, position: "inside" } };
  }
  if (axes === true || axes === undefined) {
    return { x: { visible: true, position: "inside" }, y: { visible: true, position: "inside" } };
  }
  return {
    x: normalizeAxisConfig(axes.x),
    y: normalizeAxisConfig(axes.y),
  };
}

export class Chart {
  private series: SeriesStore[] = [];
  private camera: Camera2D;
  private axis: AxisController;
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
  private normalizedAxes: { x: NormalizedAxisConfig; y: NormalizedAxisConfig };
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
  private currentHover: ChartHoverState | null = null;
  private lastPointerClientX: number = 0;
  private lastPointerClientY: number = 0;
  private pointerInPlot: boolean = false;
  private lastFrameAt: number = 0;
  private _rafId: number = 0;
  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.pointerInPlot = true;
    this.lastPointerClientX = event.clientX;
    this.lastPointerClientY = event.clientY;
    this.refreshHover();
  };
  private readonly handlePointerLeave = (): void => {
    this.pointerInPlot = false;
    this.emitHover(null);
  };

  constructor(target: HTMLElement, private readonly options: ChartOptions = {}) {
    this.resolvedTheme = resolveChartTheme(options.theme, target);
    this.normalizedAxes = normalizeAxesConfig(options.axes);
    this._gridVisible = options.grid !== false;

    this.layout = new ChartLayout(target, this.normalizedAxes);
    this.layout.root.style.background = this.resolvedTheme.backgroundCssColor;
    this.applyCanvasSize();
    this.camera = new Camera2D();
    this.axis = new AxisController(this.camera);
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

    if (this.normalizedAxes.x.visible || this.normalizedAxes.y.visible) {
      this.axisOverlay = new AxisOverlay(this.layout, this.normalizedAxes, {
        color: this.resolvedTheme.axisColor,
        font: this.resolvedTheme.axisFont,
      });
    }

    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);

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

  get theme(): ResolvedChartTheme {
    return this.resolvedTheme;
  }

  getCamera(): Camera2D {
    return this.camera;
  }

  dataToPlot(x: number, y: number): [number, number] {
    const [clipX, clipY] = this.camera.toClip(x, y);
    return this.camera.toScreen(clipX, clipY, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  clientToData(clientX: number, clientY: number): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const plotX = clientX - rect.left;
    const plotY = clientY - rect.top;
    if (plotX < 0 || plotY < 0 || plotX > rect.width || plotY > rect.height) return null;

    const viewport = this.camera.viewport;
    return [
      viewport.xMin + (plotX / rect.width) * (viewport.xMax - viewport.xMin),
      viewport.yMax - (plotY / rect.height) * (viewport.yMax - viewport.yMin),
    ];
  }

  getViewport(): Viewport {
    return this.camera.viewport;
  }

  pan(intent: PanIntent): void {
    this.camera.pan(intent);
    this.refreshHover();
  }

  zoom(intent: ZoomIntent): void {
    this.camera.zoom(intent);
    this.refreshHover();
  }

  addSeries(config: SeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    if (config.mode === "ohlc" && !config.dataset) {
      throw new TypeError("OHLC series require an OhlcDataset.");
    }
    const dataset: Dataset = config.dataset ?? new RingBuffer(config.capacity, { overflow: config.overflow });
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
    }));
  }

  setViewport(v: { xMin?: number; xMax?: number; yMin?: number; yMax?: number }): void {
    this.camera.setViewport(v);
    this.refreshHover();
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

  subscribe(event: "hover", callback: (state: ChartHoverState | null) => void): () => void;
  subscribe(event: "serieschange", callback: () => void): () => void;
  subscribe(event: "themechange", callback: () => void): () => void;
  subscribe(event: "hover" | "serieschange" | "themechange", callback: ((state: ChartHoverState | null) => void) | (() => void)): () => void {
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

    const cb = callback as () => void;
    this.seriesSubscribers.add(cb);
    return () => this.seriesSubscribers.delete(cb);
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
    this.layout.update(this.normalizedAxes);
    this.axisOverlay?.dispose();
    this.axisOverlay = null;
    if (this.normalizedAxes.x.visible || this.normalizedAxes.y.visible) {
      this.axisOverlay = new AxisOverlay(this.layout, this.normalizedAxes, {
        color: this.resolvedTheme.axisColor,
        font: this.resolvedTheme.axisFont,
      });
    }
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
    const maxDistancePx = options.maxDistancePx ?? this.options.hover?.maxDistancePx ?? Infinity;
    const anchorX = mode === "nearest-point"
      ? this.findNearestPointAnchor(dataX, dataY, viewport, rect.width, rect.height, maxDistancePx)
      : this.findNearestXAnchor(dataX, viewport, rect.width, maxDistancePx);

    if (anchorX === null) return null;

    const items = this.collectPickItems(anchorX, clientX, clientY, viewport, rect);
    return { clientX, clientY, plotX, plotY, dataX, dataY, anchorX, mode, items };
  }

  async screenshot(options: ChartScreenshotOptions = {}): Promise<Blob> {
    this.render();

    const rootRect = this.layout.root.getBoundingClientRect();
    const plotRect = this.layout.plot.getBoundingClientRect();
    const dpr = Number.isFinite(options.dpr) ? Math.max(1, options.dpr!) : Math.max(1, globalThis.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rootRect.width * dpr));
    const height = Math.max(1, Math.round(rootRect.height * dpr));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create a 2D canvas context for screenshot export.");

    ctx.fillStyle = options.background ?? rgbaCss(this.resolvedTheme.backgroundColor);
    ctx.fillRect(0, 0, width, height);

    ctx.drawImage(
      this.canvas,
      (plotRect.left - rootRect.left) * dpr,
      (plotRect.top - rootRect.top) * dpr,
      plotRect.width * dpr,
      plotRect.height * dpr,
    );
    this.drawDomTextForScreenshot(ctx, rootRect, dpr);

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

    const [r, g, b, a] = this.resolvedTheme.backgroundColor;
    this.renderer.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.renderer.clear(r, g, b, a);

    const viewport = this.camera.viewport;
    if (this._gridVisible) {
      const gridVertexCount = this.writeGridVertices(viewport);
      if (gridVertexCount > 0) {
        this.uploadGridData(gridVertexCount);
        this.renderer.drawLines(this.gridBuffer, gridVertexCount, this.gridStyle, this.camera);
        this.stats.drawCalls++;
      }
    }

    for (const s of this.series) {
      if (!s.visible) continue;
      s.rebuildPyramid();
      this.drawSeries(s, viewport);
    }

    this.axisOverlay?.update(this.camera, this.axis);

    this.stats.frameMs = performance.now() - frameStartedAt;
    this.refreshHover();
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    for (const dispose of this.pluginDisposers.splice(0)) dispose();
    this.axisOverlay?.dispose();
    this.renderer.dispose();
    this.layout.dispose();
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

  private drawSeries(series: SeriesStore, viewport: Viewport): void {
    switch (series.config.mode) {
      case "area":
        this.drawAreaSeries(series, viewport);
        return;
      case "bar":
        this.drawBarSeries(series, viewport);
        return;
      case "ohlc":
        this.drawOhlcSeries(series, viewport);
        return;
      case "scatter":
        this.drawScatterSeries(series, viewport);
        return;
      default:
        this.drawLineSeries(series, viewport);
    }
  }

  private drawLineSeries(series: SeriesStore, viewport: Viewport): void {
    const visibleSamples = series.visibleSampleCount(viewport);
    const dense = series.hasLOD && visibleSamples > RAW_LINE_VERTEX_CAPACITY;
    if (dense && this.renderer.supportsInstancedSegments) {
      const segmentCount = series.copyMinMaxInstanced(viewport, this.minMaxInstanceData, this.maxMinMaxSegments());
      if (segmentCount <= 0) return;
      this.uploadMinMaxInstanceData(segmentCount);
      this.renderer.drawMinMaxSegmentsInstanced(this.minMaxInstanceBuffer, segmentCount, series.style, this.camera);
      this.recordDraw("minmax", segmentCount * 2);
      return;
    }

    if (dense) {
      const count = series.copyMinMaxVisible(viewport, this.rawLineData, this.maxMinMaxSegments());
      if (count < 2) return;
      this.uploadRawLineData(count);
      this.renderer.drawMinMaxSegments(this.rawLineBuffer, count, series.style, this.camera);
      this.recordDraw("minmax", count);
      return;
    }

    const range = series.visibleIndexRange(viewport, 1);
    this.drawLineStripRange(series, range.start, range.end, RAW_LINE_VERTEX_CAPACITY);
  }

  private drawLineStripRange(series: SeriesStore, start: number, end: number, maxPoints: number): void {
    for (let chunkStart = start; chunkStart < end;) {
      const count = series.copyRawRange(chunkStart, end, this.rawLineData, maxPoints);
      if (count < 2) break;

      this.uploadRawLineData(count);
      this.renderer.drawLineStrip(this.rawLineBuffer, count, series.style, this.camera);
      this.recordDraw("raw", count);
      chunkStart += Math.max(1, count - 1);
    }
  }

  private drawAreaSeries(series: SeriesStore, viewport: Viewport): void {
    const range = series.visibleIndexRange(viewport, 1);
    if (range.end - range.start < 2) return;

    const baseline = series.style.baseline ?? 0;
    for (let start = range.start; start < range.end;) {
      const areaVertexCount = series.copyAreaRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY, baseline);
      if (areaVertexCount < 4) break;

      this.uploadRawLineData(areaVertexCount);
      this.renderer.drawAreaStrip(this.rawLineBuffer, areaVertexCount, series.style, this.camera);
      this.recordDraw("area", areaVertexCount);
      start += Math.max(1, (areaVertexCount >> 1) - 1);
    }

    for (let start = range.start; start < range.end;) {
      const lineVertexCount = series.copyRawRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY);
      if (lineVertexCount < 2) break;

      this.uploadRawLineData(lineVertexCount);
      this.renderer.drawLineStrip(this.rawLineBuffer, lineVertexCount, series.style, this.camera);
      this.recordDraw("area", lineVertexCount);
      start += Math.max(1, lineVertexCount - 1);
    }

  }

  private drawOhlcSeries(series: SeriesStore, viewport: Viewport): void {
    const range = series.visibleIndexRange(viewport);
    const maxCandles = Math.floor(this.rawLineData.length / FLOATS_PER_OHLC_CANDLE);
    for (let start = range.start; start < range.end;) {
      const candleCount = series.copyOhlcRange(start, range.end, this.rawLineData, maxCandles, series.style.tickWidth ?? series.style.barWidth ?? 0.8);
      if (candleCount <= 0) break;

      const vertexCount = candleCount * 6;
      this.uploadRawLineData(vertexCount);
      this.renderer.drawLines(this.rawLineBuffer, vertexCount, series.style, this.camera);
      this.recordDraw("raw", vertexCount);
      start += candleCount;
    }
  }

  private drawScatterSeries(series: SeriesStore, viewport: Viewport): void {
    const range = series.visibleIndexRange(viewport);
    for (let start = range.start; start < range.end;) {
      const count = series.copyRawRange(start, range.end, this.rawLineData, RAW_LINE_VERTEX_CAPACITY);
      if (count <= 0) break;

      this.uploadRawLineData(count);
      this.renderer.drawPoints(this.rawLineBuffer, count, series.style, this.camera, this.canvas.width, this.canvas.height);
      this.recordDraw("points", count);
      start += count;
    }
  }

  private drawBarSeries(series: SeriesStore, viewport: Viewport): void {
    const visibleSamples = series.visibleSampleCount(viewport);
    const rawBarCapacity = this.maxRawBarInstances();
    if (series.hasLOD && visibleSamples > rawBarCapacity) {
      const sampledCount = series.copyMinMaxInstanced(viewport, this.minMaxInstanceData, this.maxBarTriangleBars());
      if (sampledCount <= 0) return;

      this.includeBaselineInBarRanges(sampledCount, series.style.baseline ?? 0);
      const vertexCount = this.writeBarBucketTriangles(sampledCount, viewport);
      this.drawBarTriangles(vertexCount, series.style);
      return;
    }

    const count = this.uploadRawInstances(series, viewport, rawBarCapacity);
    if (count <= 0) return;

    if (this.renderer.supportsInstancedBars) {
      this.renderer.drawBarsInstanced(this.rawLineBuffer, count, series.style, this.camera);
      this.recordDraw("bars", count);
      return;
    }

    const vertexCount = this.writeBarTriangles(count, series.style.baseline ?? 0, series.style.barWidth ?? 0.8);
    this.drawBarTriangles(vertexCount, series.style);
  }

  private uploadRawInstances(series: SeriesStore, viewport: Viewport, maxPoints: number): number {
    const count = series.copyRawVisible(viewport, this.rawLineData, maxPoints);
    if (count <= 0) return 0;

    this.uploadRawLineData(count);
    return count;
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
    const viewportWidth = viewport.xMax - viewport.xMin;

    if (count <= 1) {
      const halfWidth = Math.max(0, viewportWidth * 0.5);
      return [
        Math.max(viewport.xMin, x - halfWidth),
        Math.min(viewport.xMax, x + halfWidth),
      ];
    }

    const prevX = index > 0 ? this.minMaxInstanceData[(index - 1) * 3]! : NaN;
    const nextX = index + 1 < count ? this.minMaxInstanceData[(index + 1) * 3]! : NaN;
    let x0 = index === 0 ? x - (nextX - x) * 0.5 : (prevX + x) * 0.5;
    let x1 = index + 1 === count ? x + (x - prevX) * 0.5 : (x + nextX) * 0.5;

    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) {
      const bucketWidth = viewportWidth / Math.max(1, count);
      x0 = viewport.xMin + index * bucketWidth;
      x1 = index + 1 === count ? viewport.xMax : x0 + bucketWidth;
    }

    return [
      Math.max(viewport.xMin, x0),
      Math.min(viewport.xMax, x1),
    ];
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

  private drawBarTriangles(vertexCount: number, style: SeriesStyle): void {
    if (vertexCount <= 0) return;
    this.uploadBarTriangleData(vertexCount);
    this.renderer.drawBarTriangles(this.barTriangleBuffer, vertexCount, style, this.camera);
    this.recordDraw("bars", vertexCount);
  }

  private recordDraw(mode: "raw" | "minmax" | "points" | "bars" | "area", points: number, drawCalls: number = 1): void {
    this.recordRenderMode(mode);
    this.stats.pointsRendered += points;
    this.stats.drawCalls += drawCalls;
  }

  private findNearestXAnchor(
    dataX: number,
    viewport: Viewport,
    plotWidth: number,
    maxDistancePx: number,
  ): number | null {
    let best: SeriesSample | null = null;
    let bestDistancePx = Infinity;
    const xScale = plotWidth / (viewport.xMax - viewport.xMin);

    for (const series of this.series) {
      if (!series.visible) continue;
      const sample = series.nearestSampleByX(dataX, viewport);
      if (!sample) continue;
      const distancePx = Math.abs(sample.x - dataX) * xScale;
      if (distancePx < bestDistancePx) {
        best = sample;
        bestDistancePx = distancePx;
      }
    }

    if (!best || bestDistancePx > maxDistancePx) return null;
    return best.x;
  }

  private findNearestPointAnchor(
    dataX: number,
    dataY: number,
    viewport: Viewport,
    plotWidth: number,
    plotHeight: number,
    maxDistancePx: number,
  ): number | null {
    let best: SeriesSample | null = null;
    for (const series of this.series) {
      if (!series.visible) continue;
      const sample = series.nearestSampleByPoint(dataX, dataY, viewport, plotWidth, plotHeight);
      if (!sample) continue;
      if (!best || (sample.distancePx ?? Infinity) < (best.distancePx ?? Infinity)) {
        best = sample;
      }
    }

    if (!best || (best.distancePx ?? Infinity) > maxDistancePx) return null;
    return best.x;
  }

  private collectPickItems(
    anchorX: number,
    clientX: number,
    clientY: number,
    viewport: Viewport,
    rect: DOMRect,
  ): ChartPickItem[] {
    const items: ChartPickItem[] = [];
    for (let seriesIndex = 0; seriesIndex < this.series.length; seriesIndex++) {
      const series = this.series[seriesIndex]!;
      if (!series.visible) continue;
      const sample = series.nearestSampleByX(anchorX, viewport);
      if (!sample) continue;

      const [clipX, clipY] = this.camera.toClip(sample.x, sample.y);
      const [plotX, plotY] = this.camera.toScreen(clipX, clipY, rect.width, rect.height);
      const itemClientX = rect.left + plotX;
      const itemClientY = rect.top + plotY;
      const dx = itemClientX - clientX;
      const dy = itemClientY - clientY;
      items.push({
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
      });
    }
    return items;
  }

  private refreshHover(): void {
    if (!this.pointerInPlot) return;
    this.emitHover(this.pick(this.lastPointerClientX, this.lastPointerClientY));
  }

  private emitHover(state: ChartHoverState | null): void {
    this.currentHover = state;
    for (const callback of this.hoverSubscribers) callback(state);
  }

  private emitSeriesChange(): void {
    for (const callback of this.seriesSubscribers) callback();
    this.refreshHover();
  }

  private emitThemeChange(): void {
    for (const callback of this.themeSubscribers) callback();
  }

  private drawDomTextForScreenshot(ctx: CanvasRenderingContext2D, rootRect: DOMRect, dpr: number): void {
    const elements = this.layout.root.querySelectorAll<HTMLElement>("div");
    for (const el of elements) {
      const text = el.textContent;
      if (!text || el.children.length > 0) continue;

      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      ctx.save();
      ctx.scale(dpr, dpr);
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
      this.gridData[vertexCount * 2] = x;
      this.gridData[vertexCount * 2 + 1] = viewport.yMin;
      vertexCount++;
      this.gridData[vertexCount * 2] = x;
      this.gridData[vertexCount * 2 + 1] = viewport.yMax;
      vertexCount++;
    }

    for (const y of this.yTicks) {
      if (vertexCount + 2 > GRID_LINE_VERTEX_CAPACITY) return vertexCount;
      this.gridData[vertexCount * 2] = viewport.xMin;
      this.gridData[vertexCount * 2 + 1] = y;
      vertexCount++;
      this.gridData[vertexCount * 2] = viewport.xMax;
      this.gridData[vertexCount * 2 + 1] = y;
      vertexCount++;
    }

    return vertexCount;
  }

  private recordRenderMode(mode: "raw" | "minmax" | "points" | "bars" | "area"): void {
    if (this.stats.renderMode === "none") {
      this.stats.renderMode = mode;
    } else if (this.stats.renderMode !== mode) {
      this.stats.renderMode = "mixed";
    }
  }
}
