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

const RAW_LINE_VERTEX_CAPACITY = 16_384;
const GRID_LINE_VERTEX_CAPACITY = 64;

export interface ChartOptions {
  readonly viewportPolicy?: ViewportPolicy;
  readonly grid?: boolean;
  readonly gridStyle?: Partial<SeriesStyle>;
}

export interface ChartFrameStats {
  fps: number;
  frameMs: number;
  pointsRendered: number;
  drawCalls: number;
  uploadBytes: number;
  renderMode: "none" | "raw" | "minmax" | "mixed";
}

export class Chart {
  private series: SeriesStore[] = [];
  private camera: Camera2D;
  private axis: AxisController;
  private renderer: Renderer;
  private input: InputController;
  private rawLineBuffer: GpuBuffer;
  private rawLineData: Float32Array;
  private instanceBuffer: GpuBuffer;
  private instanceData: Float32Array;
  private gridBuffer: GpuBuffer;
  private gridData: Float32Array;
  private gridStyle: SeriesStyle;
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];
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
    this.instanceData = new Float32Array(RAW_LINE_VERTEX_CAPACITY * 3);
    this.instanceBuffer = this.renderer.createFloatBuffer(this.instanceData.length);
    this.gridData = new Float32Array(GRID_LINE_VERTEX_CAPACITY * 2);
    this.gridBuffer = this.renderer.createFloatBuffer(this.gridData.length);
    this.gridStyle = {
      color: options.gridStyle?.color ?? [0.22, 0.30, 0.44, 0.45],
      lineWidth: options.gridStyle?.lineWidth ?? 1,
    };
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
    const resized = this.applyCanvasSize(dpr);
    if (resized) {
      this.renderer.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
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
      const visibleSamples = s.visibleSampleCount(viewport);
      const dense = s.hasLOD && visibleSamples > RAW_LINE_VERTEX_CAPACITY;

      if (dense) {
        const maxSegments = Math.min(this.canvas.width, RAW_LINE_VERTEX_CAPACITY >> 1);
        const segCount = s.copyMinMaxInstanced(viewport, this.instanceData, maxSegments);
        if (segCount < 2) continue;

        this.renderer.updateFloatBuffer(this.instanceBuffer, this.instanceData);
        this.renderer.drawMinMaxSegmentsInstanced(this.instanceBuffer, segCount, s.style, this.camera);
        this.recordRenderMode("minmax");
        this.stats.pointsRendered += segCount * 2;
        this.stats.uploadBytes += this.instanceData.byteLength;
      } else {
        const count = s.copyRawVisible(viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY);
        if (count < 2) continue;

        this.renderer.updateFloatBuffer(this.rawLineBuffer, this.rawLineData);
        this.renderer.drawLineStrip(this.rawLineBuffer, count, s.style, this.camera);
        this.recordRenderMode("raw");
        this.stats.pointsRendered += count;
        this.stats.uploadBytes += this.rawLineData.byteLength;
      }

      this.stats.drawCalls++;
    }

    this.stats.frameMs = performance.now() - frameStartedAt;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.input.dispose();
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

  private writeGridVertices(viewport: { xMin: number; xMax: number; yMin: number; yMax: number }): number {
    this.axis.getXTickValues(this.canvas.width, 12, this.xTicks);
    this.axis.getYTickValues(this.canvas.height, 8, this.yTicks);

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
