import type { SeriesConfig, SeriesStyle, Dataset } from "../core/types.js";
import { SeriesStore } from "../core/SeriesStore.js";
import { RingBuffer } from "../core/RingBuffer.js";
import { Renderer } from "../render/Renderer.js";
import { ReglBackend } from "../render/ReglBackend.js";
import type { GpuBuffer } from "../render/types.js";
import { InputController } from "../interaction/InputController.js";
import { Camera2D } from "../interaction/Camera2D.js";
import { AxisController } from "../interaction/AxisController.js";
import type { ViewportPolicy } from "../interaction/types.js";
import { AxisOverlay } from "./AxisOverlay.js";
import { ChartLayout } from "./ChartLayout.js";
import type { AxisPosition, NormalizedAxisConfig } from "./ChartLayout.js";

const RAW_LINE_VERTEX_CAPACITY = 16_384;
const AREA_POINT_CAPACITY = RAW_LINE_VERTEX_CAPACITY >> 1;
const MINMAX_SEGMENT_CAPACITY = RAW_LINE_VERTEX_CAPACITY >> 1;
const FLOATS_PER_MINMAX_SEGMENT_INSTANCE = 3;
const GRID_LINE_VERTEX_CAPACITY = 64;

export interface AxisConfig {
  readonly visible?: boolean;
  readonly position?: AxisPosition;
}

export interface ChartOptions {
  readonly viewportPolicy?: ViewportPolicy;
  readonly grid?: boolean;
  readonly gridStyle?: Partial<SeriesStyle>;
  readonly axes?: boolean | { x?: boolean | AxisConfig; y?: boolean | AxisConfig };
}

export type TypedSeriesConfig = Omit<SeriesConfig, "mode">;

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

export class Chart {
  private series: SeriesStore[] = [];
  private camera: Camera2D;
  private axis: AxisController;
  private renderer: Renderer;
  private input: InputController;
  private rawLineBuffer: GpuBuffer;
  private rawLineData: Float32Array;
  private minMaxInstanceBuffer: GpuBuffer;
  private minMaxInstanceData: Float32Array;
  private gridBuffer: GpuBuffer;
  private gridData: Float32Array;
  private gridStyle: SeriesStyle;
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];
  private axisOverlay: AxisOverlay | null = null;
  private normalizedAxes: { x: NormalizedAxisConfig; y: NormalizedAxisConfig };
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
  private lastFrameAt: number = 0;
  private _rafId: number = 0;

  constructor(target: HTMLElement, private readonly options: ChartOptions = {}) {
    const axesOpt = options.axes;
    if (axesOpt === false) {
      this.normalizedAxes = { x: { visible: false, position: "inside" }, y: { visible: false, position: "inside" } };
    } else if (axesOpt === true || axesOpt === undefined) {
      this.normalizedAxes = { x: { visible: true, position: "inside" }, y: { visible: true, position: "inside" } };
    } else {
      this.normalizedAxes = {
        x: normalizeAxisConfig(axesOpt.x),
        y: normalizeAxisConfig(axesOpt.y),
      };
    }

    this.layout = new ChartLayout(target, this.normalizedAxes);
    this.applyCanvasSize();
    this.camera = new Camera2D();
    this.axis = new AxisController(this.camera);
    this.renderer = new Renderer(new ReglBackend(this.layout.canvas));
    this.input = new InputController(this.layout.canvas, this.camera, options.viewportPolicy);
    this.rawLineData = new Float32Array(RAW_LINE_VERTEX_CAPACITY * 2);
    this.rawLineBuffer = this.renderer.createFloatBuffer(this.rawLineData.length);
    this.minMaxInstanceData = new Float32Array(MINMAX_SEGMENT_CAPACITY * FLOATS_PER_MINMAX_SEGMENT_INSTANCE);
    this.minMaxInstanceBuffer = this.renderer.createFloatBuffer(this.minMaxInstanceData.length);
    this.gridData = new Float32Array(GRID_LINE_VERTEX_CAPACITY * 2);
    this.gridBuffer = this.renderer.createFloatBuffer(this.gridData.length);
    this.gridStyle = {
      color: options.gridStyle?.color ?? [0.22, 0.30, 0.44, 0.45],
      lineWidth: options.gridStyle?.lineWidth ?? 1,
    };

    if (this.normalizedAxes.x.visible || this.normalizedAxes.y.visible) {
      this.axisOverlay = new AxisOverlay(this.layout, this.normalizedAxes);
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.layout.plot);
    }
  }

  get canvas(): HTMLCanvasElement {
    return this.layout.canvas;
  }

  addSeries(config: SeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    const dataset: Dataset = config.dataset ?? new RingBuffer(config.capacity);
    const color = style?.color ?? [0.3, 0.6, 1.0, 1.0];
    const s = new SeriesStore(dataset, config, {
      color,
      lineWidth: style?.lineWidth ?? 1,
      pointSize: style?.pointSize ?? 4,
      barWidth: style?.barWidth ?? 0.8,
      baseline: style?.baseline ?? 0,
      fillColor: style?.fillColor ?? [color[0], color[1], color[2], color[3] * 0.25],
    });
    this.series.push(s);
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

  removeSeries(series: SeriesStore): boolean {
    const index = this.series.indexOf(series);
    if (index === -1) return false;

    this.series.splice(index, 1);
    return true;
  }

  setViewport(v: { xMin?: number; xMax?: number; yMin?: number; yMax?: number }): void {
    this.camera.setViewport(v);
  }

  resize(dpr: number = globalThis.devicePixelRatio): boolean {
    return this.applyCanvasSize(dpr);
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

    this.renderer.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.renderer.clear(0.08, 0.10, 0.16, 1);

    const viewport = this.camera.viewport;
    if (this.options.grid !== false) {
      const gridVertexCount = this.writeGridVertices(viewport);
      if (gridVertexCount > 0) {
        this.renderer.updateFloatBuffer(this.gridBuffer, this.gridData);
        this.renderer.drawLines(this.gridBuffer, gridVertexCount, this.gridStyle, this.camera);
        this.stats.drawCalls++;
        this.stats.uploadBytes += this.gridData.byteLength;
      }
    }

    for (const s of this.series) {
      if (!s.visible) continue;
      if (s.config.mode === "scatter") {
        this.drawScatterSeries(s, viewport);
        continue;
      }
      if (s.config.mode === "bar") {
        this.drawBarSeries(s, viewport);
        continue;
      }
      if (s.config.mode === "area") {
        this.drawAreaSeries(s, viewport);
        continue;
      }

      const visibleSamples = s.visibleSampleCount(viewport);
      const dense = s.hasLOD && visibleSamples > RAW_LINE_VERTEX_CAPACITY;
      if (dense && this.renderer.supportsInstancedSegments) {
        const segmentCount = s.copyMinMaxInstanced(viewport, this.minMaxInstanceData, this.maxMinMaxSegments());
        if (segmentCount <= 0) continue;
        this.renderer.updateFloatBuffer(this.minMaxInstanceBuffer, this.minMaxInstanceData);
        this.renderer.drawMinMaxSegmentsInstanced(this.minMaxInstanceBuffer, segmentCount, s.style, this.camera);
        this.recordRenderMode("minmax");
        this.stats.pointsRendered += segmentCount * 2;
        this.stats.drawCalls++;
        this.stats.uploadBytes += this.minMaxInstanceData.byteLength;
        continue;
      }

      const count = dense
        ? s.copyMinMaxVisible(viewport, this.rawLineData, this.maxMinMaxSegments())
        : s.copyRawVisible(viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY);
      if (count < 2) continue;
      this.renderer.updateFloatBuffer(this.rawLineBuffer, this.rawLineData);
      if (dense) {
        this.renderer.drawMinMaxSegments(this.rawLineBuffer, count, s.style, this.camera);
        this.recordRenderMode("minmax");
      } else {
        this.renderer.drawLineStrip(this.rawLineBuffer, count, s.style, this.camera);
        this.recordRenderMode("raw");
      }
      this.stats.pointsRendered += count;
      this.stats.drawCalls++;
      this.stats.uploadBytes += this.rawLineData.byteLength;
    }

    this.axisOverlay?.update(this.camera, this.axis);

    this.stats.frameMs = performance.now() - frameStartedAt;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.input.dispose();
    this.axisOverlay?.dispose();
    this.renderer.dispose();
    this.layout.dispose();
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

  private drawAreaSeries(
    series: SeriesStore,
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
  ): void {
    const baseline = series.style.baseline ?? 0;
    const areaVertexCount = series.copyAreaVisible(viewport, this.rawLineData, AREA_POINT_CAPACITY, baseline);
    if (areaVertexCount < 4) return;

    this.renderer.updateFloatBuffer(this.rawLineBuffer, this.rawLineData);
    this.renderer.drawAreaStrip(this.rawLineBuffer, areaVertexCount, series.style, this.camera);
    this.stats.pointsRendered += areaVertexCount;
    this.stats.drawCalls++;
    this.stats.uploadBytes += this.rawLineData.byteLength;

    const lineVertexCount = this.uploadRawInstances(series, viewport, AREA_POINT_CAPACITY);
    if (lineVertexCount >= 2) {
      this.renderer.drawLineStrip(this.rawLineBuffer, lineVertexCount, series.style, this.camera);
      this.stats.pointsRendered += lineVertexCount;
      this.stats.drawCalls++;
    }

    this.recordRenderMode("area");
  }

  private drawScatterSeries(
    series: SeriesStore,
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
  ): void {
    if (!this.renderer.supportsInstancedPoints) return;
    const count = this.uploadRawInstances(series, viewport, RAW_LINE_VERTEX_CAPACITY);
    if (count <= 0) return;

    this.renderer.drawPointsInstanced(this.rawLineBuffer, count, series.style, this.camera, this.canvas.width, this.canvas.height);
    this.recordInstancedDraw("points", count);
  }

  private drawBarSeries(
    series: SeriesStore,
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
  ): void {
    if (!this.renderer.supportsInstancedBars) return;
    const count = this.uploadRawInstances(series, viewport, RAW_LINE_VERTEX_CAPACITY);
    if (count <= 0) return;

    this.renderer.drawBarsInstanced(this.rawLineBuffer, count, series.style, this.camera);
    this.recordInstancedDraw("bars", count);
  }

  private uploadRawInstances(
    series: SeriesStore,
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
    maxPoints: number,
  ): number {
    const count = series.copyRawVisible(viewport, this.rawLineData, maxPoints);
    if (count <= 0) return 0;

    this.renderer.updateFloatBuffer(this.rawLineBuffer, this.rawLineData);
    this.stats.uploadBytes += this.rawLineData.byteLength;
    return count;
  }

  private recordInstancedDraw(mode: "points" | "bars", count: number): void {
    this.recordRenderMode(mode);
    this.stats.pointsRendered += count;
    this.stats.drawCalls++;
  }

  private maxMinMaxSegments(): number {
    return Math.min(this.canvas.width, MINMAX_SEGMENT_CAPACITY);
  }

  private writeGridVertices(
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
  ): number {
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
