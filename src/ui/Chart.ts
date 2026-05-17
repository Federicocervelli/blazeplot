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

const RAW_LINE_VERTEX_CAPACITY = 16_384;
const GRID_LINE_VERTEX_CAPACITY = 64;
const LEFT_MARGIN_CSS = 52;
const BOTTOM_MARGIN_CSS = 28;

export interface AxisConfig {
  readonly visible?: boolean;
  readonly position?: "inside" | "outside";
}

export interface ChartOptions {
  readonly viewportPolicy?: ViewportPolicy;
  readonly grid?: boolean;
  readonly gridStyle?: Partial<SeriesStyle>;
  readonly axes?: boolean | { x?: boolean | AxisConfig; y?: boolean | AxisConfig };
}

export interface ChartFrameStats {
  fps: number;
  frameMs: number;
  pointsRendered: number;
  drawCalls: number;
  uploadBytes: number;
  renderMode: "none" | "raw" | "minmax" | "mixed";
}

type NormalizedAxisConfig = { visible: boolean; position: "inside" | "outside" };

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
  private gridBuffer: GpuBuffer;
  private gridData: Float32Array;
  private gridStyle: SeriesStyle;
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];
  private axisOverlay: AxisOverlay | null = null;
  private normalizedAxes: { x: NormalizedAxisConfig; y: NormalizedAxisConfig };
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

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: ChartOptions = {}) {
    this.applyCanvasSize();
    this.camera = new Camera2D();
    this.axis = new AxisController(this.camera);
    this.renderer = new Renderer(new ReglBackend(canvas));
    this.input = new InputController(canvas, this.camera, options.viewportPolicy);
    this.rawLineData = new Float32Array(RAW_LINE_VERTEX_CAPACITY * 2);
    this.rawLineBuffer = this.renderer.createFloatBuffer(this.rawLineData.length);
    this.gridData = new Float32Array(GRID_LINE_VERTEX_CAPACITY * 2);
    this.gridBuffer = this.renderer.createFloatBuffer(this.gridData.length);
    this.gridStyle = {
      color: options.gridStyle?.color ?? [0.22, 0.30, 0.44, 0.45],
      lineWidth: options.gridStyle?.lineWidth ?? 1,
    };

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

    if (this.normalizedAxes.x.visible || this.normalizedAxes.y.visible) {
      this.axisOverlay = new AxisOverlay(canvas, this.normalizedAxes);
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    }
  }

  addSeries(config: SeriesConfig, style?: Partial<SeriesStyle>): SeriesStore {
    const dataset: Dataset = config.dataset ?? new RingBuffer(config.capacity);
    const s = new SeriesStore(dataset, config, {
      color: style?.color ?? [0.3, 0.6, 1.0, 1.0],
      lineWidth: style?.lineWidth ?? 1,
    });
    this.series.push(s);
    return s;
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

  private getMargins(): { left: number; bottom: number } {
    return {
      left: this.normalizedAxes.y.visible && this.normalizedAxes.y.position === "outside" ? LEFT_MARGIN_CSS : 0,
      bottom: this.normalizedAxes.x.visible && this.normalizedAxes.x.position === "outside" ? BOTTOM_MARGIN_CSS : 0,
    };
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

    const margins = this.getMargins();
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const physLeft = Math.floor(margins.left * dpr);
    const physBottom = Math.floor(margins.bottom * dpr);

    this.options.viewportPolicy?.beforeRender?.(this.camera);

    // Clear full canvas
    this.renderer.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.renderer.clear(0.08, 0.10, 0.16, 1);

    // Draw content in inset viewport
    this.renderer.viewport(physLeft, physBottom, this.canvas.width - physLeft, this.canvas.height - physBottom);

    const viewport = this.camera.viewport;
    if (this.options.grid !== false) {
      const gridVertexCount = this.writeGridVertices(viewport, margins);
      if (gridVertexCount > 0) {
        this.renderer.updateFloatBuffer(this.gridBuffer, this.gridData);
        this.renderer.drawLines(this.gridBuffer, gridVertexCount, this.gridStyle, this.camera);
        this.stats.drawCalls++;
        this.stats.uploadBytes += this.gridData.byteLength;
      }
    }

    for (const s of this.series) {
      if (!s.visible) continue;
      const visibleSamples = s.visibleSampleCount(viewport);
      const dense = s.hasLOD && visibleSamples > RAW_LINE_VERTEX_CAPACITY;
      const count = dense
        ? s.copyMinMaxVisible(viewport, this.rawLineData, Math.min(this.canvas.width, RAW_LINE_VERTEX_CAPACITY >> 1))
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

    this.axisOverlay?.update(this.camera, this.axis, margins.left, margins.bottom);

    this.stats.frameMs = performance.now() - frameStartedAt;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.input.dispose();
    this.axisOverlay?.dispose();
    this.renderer.dispose();
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

  private writeGridVertices(
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
    margins: { left: number; bottom: number },
  ): number {
    const plotW = Math.max(1, this.canvas.clientWidth - margins.left);
    const plotH = Math.max(1, this.canvas.clientHeight - margins.bottom);
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

  private recordRenderMode(mode: "raw" | "minmax"): void {
    if (this.stats.renderMode === "none") {
      this.stats.renderMode = mode;
    } else if (this.stats.renderMode !== mode) {
      this.stats.renderMode = "mixed";
    }
  }
}
