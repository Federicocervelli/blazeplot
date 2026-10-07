import type { RgbaColor, SeriesStyle, SeriesYAxis, Viewport } from "../core/types.js";
import type { SeriesStore } from "../core/SeriesStore.js";
import type { Camera2D } from "../interaction/Camera2D.js";
import type { AxisController } from "../interaction/AxisController.js";
import type { ChartRenderer, RenderProjection } from "./ChartRenderer.js";

/** Vertices in the shared raw line/point/area upload buffer. */
const RAW_LINE_VERTEX_CAPACITY = 16_384;
const AREA_POINT_CAPACITY = RAW_LINE_VERTEX_CAPACITY >> 1;
/** Bars, min/max buckets, or candles expanded into triangles per draw. */
const BAR_TRIANGLE_CAPACITY = 4_096;
const FLOATS_PER_MINMAX_BUCKET = 3;
const FLOATS_PER_BAR_TRIANGLES = 12;
const FLOATS_PER_OHLC_TUPLE = 5;
/** OHLC tuples staged per draw: what the raw scratch array holds, capped like the other expanded primitives. */
const MAX_CANDLES_PER_DRAW = Math.min(Math.floor((RAW_LINE_VERTEX_CAPACITY * 2) / FLOATS_PER_OHLC_TUPLE), BAR_TRIANGLE_CAPACITY);
const MAX_EXACT_SCATTER_POINTS = RAW_LINE_VERTEX_CAPACITY * 4;

/** Render mode reported in frame stats. */
export type PaintMode = "raw" | "minmax" | "points" | "bars" | "area";
type DrawMode = PaintMode;

/** Mutable per-frame draw counters the painter accumulates into. */
export interface PaintStats {
  pointsRendered: number;
  renderMode: "none" | PaintMode | "mixed";
}

/** Per-frame inputs for {@link SeriesPainter}. */
export interface PaintFrame {
  readonly renderer: ChartRenderer;
  readonly canvas: { readonly width: number; readonly height: number; readonly clientWidth: number; readonly clientHeight: number };
  readonly camera: Camera2D;
  readonly rightCamera: Camera2D;
  readonly axis: AxisController;
  readonly rightAxis: AxisController;
}

/**
 * Vertex staging arrays, allocated the first time a draw path needs each one and shared by every chart
 * in the module. A frame runs start to finish on the one JS thread, and every `ChartRenderer` draw call
 * copies its input before returning, so nothing in these arrays outlives a draw call. One set therefore
 * serves any number of charts: a page of 50 charts holds the 0.4 MiB once instead of 50 times, and a
 * chart that only draws raw lines never allocates the bucket or bar-triangle arrays.
 */
const lazyScratch = (floats: number): (() => Float32Array) => {
  let array: Float32Array | undefined;
  return () => (array ??= new Float32Array(floats));
};
const rawLineScratch = lazyScratch(RAW_LINE_VERTEX_CAPACITY * 2);
const minMaxBucketScratch = lazyScratch(BAR_TRIANGLE_CAPACITY * FLOATS_PER_MINMAX_BUCKET);
const barTriangleScratch = lazyScratch(BAR_TRIANGLE_CAPACITY * FLOATS_PER_BAR_TRIANGLES);

type MutableRenderProjection ={ scaleX: number; scaleY: number; offsetX: number; offsetY: number };

/**
 * Draws grid lines and every series mode through a `ChartRenderer`. Owns the scratch arrays used to
 * stage vertices; the chart supplies the per-frame cameras, axes, and renderer via `beginFrame`.
 */
export class SeriesPainter {
  private gridScratch: Float32Array | null = null;
  private readonly gridLineVertexCapacity: number;
  private readonly leftProjection: MutableRenderProjection = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  private readonly rightProjection: MutableRenderProjection = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  private renderer!: ChartRenderer;
  private canvas!: PaintFrame["canvas"];
  private camera!: Camera2D;
  private rightCamera!: Camera2D;
  private axis!: AxisController;
  private rightAxis!: AxisController;
  private currentXOrigin = 0;
  /** Per-frame Y origin of each Y axis (its camera `yMin` when linear, else 0), subtracted in float64 before upload. */
  private leftYOrigin = 0;
  private rightYOrigin = 0;

  /** `gridLineVertexCapacity` is the most grid vertices (two per line) one frame may draw. */
  constructor(private readonly stats: PaintStats, gridLineVertexCapacity: number) {
    this.gridLineVertexCapacity = gridLineVertexCapacity;
  }

  private get rawLineData(): Float32Array {
    return rawLineScratch();
  }

  private get minMaxBucketData(): Float32Array {
    return minMaxBucketScratch();
  }

  private get barTriangleData(): Float32Array {
    return barTriangleScratch();
  }

  /** Bind this frame's renderer, cameras, and axes, and fix the float64 origins subtracted before upload. */
  beginFrame(frame: PaintFrame): void {
    this.renderer = frame.renderer;
    this.canvas = frame.canvas;
    this.camera = frame.camera;
    this.rightCamera = frame.rightCamera;
    this.axis = frame.axis;
    this.rightAxis = frame.rightAxis;
    this.currentXOrigin = this.camera.xMin;
    this.leftYOrigin = this.axis.isNonlinear("y") ? 0 : this.camera.yMin;
    this.rightYOrigin = this.rightAxis.isNonlinear("y") ? 0 : this.rightCamera.yMin;
  }

  private cameraFor(yAxis: SeriesYAxis | undefined): Camera2D {
    return yAxis === "right" ? this.rightCamera : this.camera;
  }

  private controllerFor(yAxis: SeriesYAxis | undefined): AxisController {
    return yAxis === "right" ? this.rightAxis : this.axis;
  }

  private projectionFor(yAxis: SeriesYAxis | undefined): RenderProjection {
    const camera = this.cameraFor(yAxis);
    const controller = this.controllerFor(yAxis);
    const projection = yAxis === "right" ? this.rightProjection : this.leftProjection;
    const scaledOrigin = controller.scaleValue(this.currentXOrigin, "x");
    const xMin = controller.scaleValue(camera.xMin, "x") - scaledOrigin;
    const xMax = controller.scaleValue(camera.xMax, "x") - scaledOrigin;
    const scaledYOrigin = controller.isNonlinear("y") ? 0 : this.yOriginFor(yAxis);
    const yMin = controller.scaleValue(camera.yMin, "y") - scaledYOrigin;
    const yMax = controller.scaleValue(camera.yMax, "y") - scaledYOrigin;
    projection.scaleX = (camera.xReversed ? -2 : 2) / (xMax - xMin);
    projection.scaleY = (camera.yReversed ? -2 : 2) / (yMax - yMin);
    projection.offsetX = (camera.xReversed ? 1 : -1) * (xMin + xMax) / (xMax - xMin);
    projection.offsetY = (camera.yReversed ? 1 : -1) * (yMin + yMax) / (yMax - yMin);
    return projection;
  }

  private yOriginFor(yAxis: SeriesYAxis | undefined): number {
    return yAxis === "right" ? this.rightYOrigin : this.leftYOrigin;
  }

  /** Whether both Y axes share a screen direction, so left-domain Y anchors map 1:1 onto the right axis. */

  drawGrid(xTicks: readonly number[], yTicks: readonly number[], color: RgbaColor): void {
    let vertexCount = 0;
    const gridData = (this.gridScratch ??= new Float32Array(this.gridLineVertexCapacity * 2));
    const pushLine = (x0: number, y0: number, x1: number, y1: number): boolean => {
      if (vertexCount + 2 > this.gridLineVertexCapacity) return false;
      const offset = vertexCount * 2;
      gridData[offset] = x0;
      gridData[offset + 1] = y0;
      gridData[offset + 2] = x1;
      gridData[offset + 3] = y1;
      vertexCount += 2;
      return true;
    };
    for (const x of xTicks) {
      const clipX = this.axis.valueToClip(x, "x");
      if (!pushLine(clipX, -1, clipX, 1)) break;
    }
    for (const y of yTicks) {
      const clipY = this.axis.valueToClip(y, "y");
      if (!pushLine(-1, clipY, 1, clipY)) break;
    }
    if (vertexCount === 0) return;

    this.renderer.drawClipLines(gridData, vertexCount, color);
  }

  drawSeries(series: SeriesStore): void {
    const viewport = this.cameraFor(series.config.yAxis).viewport;
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
    const yOrigin = this.yOriginFor(series.config.yAxis);
    const dense = series.hasServerMinMax || (series.downsampled && series.visibleSampleCount(viewport) > RAW_LINE_VERTEX_CAPACITY - 2);
    if (dense) {
      const bucketCount = series.copyMinMaxInstanced(viewport, this.minMaxBucketData, BAR_TRIANGLE_CAPACITY, this.currentXOrigin, yOrigin);
      this.padBucketsToLineWidth(bucketCount, viewport, series);
      this.drawBucketColumns(bucketCount, viewport, series.style.color, projection, "minmax");
      return;
    }

    for (let start = 0, done = false; !done;) {
      const chunk = series.copyRawClippedChunk(viewport, start, this.rawLineData, RAW_LINE_VERTEX_CAPACITY, this.currentXOrigin, yOrigin);
      this.drawRawLine(chunk.count, series.style, projection, "raw");
      // Resume at the last segment's end so consecutive chunks share a vertex and the seam stays closed.
      start = chunk.next;
      done = chunk.done || chunk.count === 0;
    }
  }

  private drawAreaSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const range = series.visibleIndexRange(viewport, 1);
    if (range.end - range.start < 2) return;

    const { style } = series;
    const yOrigin = this.yOriginFor(series.config.yAxis);
    const visibleSamples = range.end - range.start;
    if (series.hasServerMinMax || (series.downsampled && visibleSamples > AREA_POINT_CAPACITY)) {
      this.drawDenseArea(series, viewport, projection, yOrigin);
      return;
    }

    if (visibleSamples > AREA_POINT_CAPACITY) {
      // `downsample: "none"`: stable stride decimation keeps the strip within the buffer.
      this.drawAreaFill(series.copyAreaVisible(viewport, this.rawLineData, AREA_POINT_CAPACITY, style.baseline, this.currentXOrigin, yOrigin), style, projection);
      this.drawRawLine(series.copyRawVisible(viewport, this.rawLineData, AREA_POINT_CAPACITY, this.currentXOrigin, yOrigin), style, projection, "area");
      return;
    }

    for (let start = range.start; start < range.end;) {
      const vertexCount = series.copyAreaRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY, style.baseline, this.currentXOrigin, yOrigin);
      if (vertexCount < 4) break;
      this.drawAreaFill(vertexCount, style, projection);
      start += Math.max(1, (vertexCount >> 1) - 1);
    }

    for (let start = range.start; start < range.end;) {
      const vertexCount = series.copyRawRange(start, range.end, this.rawLineData, AREA_POINT_CAPACITY, this.currentXOrigin, yOrigin);
      if (vertexCount < 2) break;
      this.drawRawLine(vertexCount, style, projection, "area");
      start += Math.max(1, vertexCount - 1);
    }
  }

  /**
   * Dense area: min/max buckets rendered as full-width columns. The fill spans each bucket from the
   * baseline to its extreme, and the outline is the min/max envelope, so isolated spikes survive.
   */
  private drawDenseArea(series: SeriesStore, viewport: Viewport, projection: RenderProjection, yOrigin: number): void {
    const { style } = series;
    // At most one bucket per drawing-buffer column: narrower buckets can miss every pixel center and drop a spike.
    const maxBuckets = Math.max(1, Math.min(BAR_TRIANGLE_CAPACITY, this.canvas.width));
    const bucketCount = series.copyMinMaxInstanced(viewport, this.minMaxBucketData, maxBuckets, this.currentXOrigin, yOrigin);
    if (bucketCount <= 0) return;
    this.drawBucketColumns(bucketCount, viewport, style.fillColor, projection, "area", style.baseline - yOrigin);
    this.padBucketsToLineWidth(bucketCount, viewport, series);
    this.drawBucketColumns(bucketCount, viewport, style.color, projection, "area");
  }

  private drawOhlcSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const range = series.visibleIndexRange(viewport);
    const { style } = series;
    const yOrigin = this.yOriginFor(series.config.yAxis);

    for (let start = range.start; start < range.end;) {
      const candleCount = series.copyOhlcTuplesRange(start, range.end, this.rawLineData, MAX_CANDLES_PER_DRAW, this.currentXOrigin, yOrigin);
      if (candleCount <= 0) break;

      this.drawOhlcTicks(candleCount, style.tickWidth, true, style.upColor, style.lineWidth, projection);
      this.drawOhlcTicks(candleCount, style.tickWidth, false, style.downColor, style.lineWidth, projection);
      start += candleCount;
    }
  }

  private drawCandlestickSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const range = series.visibleIndexRange(viewport, 1);
    const { style } = series;
    const yOrigin = this.yOriginFor(series.config.yAxis);

    for (let start = range.start; start < range.end;) {
      const candleCount = series.copyOhlcTuplesRange(start, range.end, this.rawLineData, MAX_CANDLES_PER_DRAW, this.currentXOrigin, yOrigin);
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
      this.transformVertices(this.barTriangleData, candleCount * 2, projection);
      this.renderer.drawLines(this.barTriangleData, candleCount * 2, style.wickColor, style.lineWidth, projection, "lines");
      this.recordDraw("raw", candleCount * 2);

      this.drawCandlestickBodies(candleCount, style.barWidth, true, style.upColor, projection);
      this.drawCandlestickBodies(candleCount, style.barWidth, false, style.downColor, projection);
      start += candleCount;
    }
  }

  private drawScatterSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const { style } = series;
    const yOrigin = this.yOriginFor(series.config.yAxis);
    // Culling padding is measured in drawing-buffer pixels, so scale the CSS-pixel point size.
    const pointSizePx = style.pointSize * (this.canvas.width / Math.max(1, this.canvas.clientWidth));
    if (series.config.downsample === "none" && series.visibleSampleCount(viewport) <= MAX_EXACT_SCATTER_POINTS) {
      const range = series.visibleIndexRange(viewport);
      for (let start = range.start; start < range.end; start += RAW_LINE_VERTEX_CAPACITY) {
        const end = Math.min(range.end, start + RAW_LINE_VERTEX_CAPACITY);
        const count = series.copyScatterRange(start, end, viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY, this.currentXOrigin, this.canvas.height, pointSizePx, yOrigin);
        this.drawPointBatch(count, style, projection);
      }
      return;
    }

    const count = series.copyScatterVisible(viewport, this.rawLineData, RAW_LINE_VERTEX_CAPACITY, this.canvas.width, this.canvas.height, pointSizePx, this.currentXOrigin, yOrigin);
    this.drawPointBatch(count, style, projection);
  }

  private drawBarSeries(series: SeriesStore, viewport: Viewport, projection: RenderProjection): void {
    const { style } = series;
    const yOrigin = this.yOriginFor(series.config.yAxis);
    const baseline = style.baseline - yOrigin;
    if (series.downsampled && series.visibleSampleCount(viewport) > RAW_LINE_VERTEX_CAPACITY) {
      const bucketCount = series.copyMinMaxInstanced(viewport, this.minMaxBucketData, BAR_TRIANGLE_CAPACITY, this.currentXOrigin, yOrigin);
      for (let i = 0; i < bucketCount; i++) {
        const offset = i * FLOATS_PER_MINMAX_BUCKET;
        this.minMaxBucketData[offset + 1] = Math.min(baseline, this.minMaxBucketData[offset + 1]!);
        this.minMaxBucketData[offset + 2] = Math.max(baseline, this.minMaxBucketData[offset + 2]!);
      }
      this.drawBucketColumns(bucketCount, viewport, style.color, projection, "bars");
      return;
    }

    const range = series.visibleIndexRange(viewport, 1);
    const controller = this.controllerFor(series.config.yAxis);
    const instanced = !controller.isNonlinear("x") && !controller.isNonlinear("y");
    const halfWidth = style.barWidth * 0.5;

    // Draw every visible bar in upload-buffer sized chunks so exact series are never truncated.
    for (let start = range.start; start < range.end;) {
      const count = series.copyRawRange(start, range.end, this.rawLineData, RAW_LINE_VERTEX_CAPACITY, this.currentXOrigin, yOrigin);
      if (count <= 0) break;
      start += count;

      if (instanced) {
        this.transformVertices(this.rawLineData, count, projection);
        this.renderer.drawBarsInstanced(this.rawLineData, count, style, projection, yOrigin);
        this.recordDraw("bars", count);
        continue;
      }

      // Nonlinear axes scale vertices on the CPU, so bars are expanded into transformed triangles.
      for (let offset = 0; offset < count; offset += BAR_TRIANGLE_CAPACITY) {
        const batch = Math.min(BAR_TRIANGLE_CAPACITY, count - offset);
        for (let i = 0; i < batch; i++) {
          const x = this.rawLineData[(offset + i) * 2]!;
          this.writeBarTriangles(i, x - halfWidth, x + halfWidth, baseline, this.rawLineData[(offset + i) * 2 + 1]!);
        }
        this.drawTriangleBatch(batch * 6, style.color, projection, "bars");
      }
    }
  }

  private drawRawLine(vertexCount: number, style: SeriesStyle, projection: RenderProjection, mode: DrawMode): void {
    if (vertexCount < 2) return;
    this.transformVertices(this.rawLineData, vertexCount, projection);
    this.renderer.drawLines(this.rawLineData, vertexCount, style.color, style.lineWidth, projection);
    this.recordDraw(mode, vertexCount);
  }

  private drawAreaFill(vertexCount: number, style: SeriesStyle, projection: RenderProjection): void {
    if (vertexCount < 4) return;
    this.transformVertices(this.rawLineData, vertexCount, projection);
    this.renderer.drawTriangles(this.rawLineData, vertexCount, style.fillColor, projection, "triangle_strip");
    this.recordDraw("area", vertexCount);
  }

  private drawPointBatch(count: number, style: SeriesStyle, projection: RenderProjection): void {
    if (count <= 0) return;
    this.transformVertices(this.rawLineData, count, projection);
    this.renderer.drawPoints(this.rawLineData, count, style.color, style.pointSize, projection);
    this.recordDraw("points", count);
  }

  /** Grow min/max buckets to at least `lineWidth` CSS pixels tall so flat stretches of dense lines stay visible. */
  private padBucketsToLineWidth(bucketCount: number, viewport: Viewport, series: SeriesStore): void {
    const controller = this.controllerFor(series.config.yAxis);
    if (controller.isIdentityScale("y")) {
      // Linear-like axis: scale and unscale are the identity, so the per-bucket calls are skipped.
      const half = (series.style.lineWidth * 0.5 * Math.abs(viewport.yMax - viewport.yMin)) / Math.max(1, this.canvas.clientHeight);
      const buckets = this.minMaxBucketData;
      for (let i = 0; i < bucketCount; i++) {
        const offset = i * FLOATS_PER_MINMAX_BUCKET;
        const low = buckets[offset + 1]!;
        const high = buckets[offset + 2]!;
        if (high - low >= half * 2) continue;
        const center = (low + high) * 0.5;
        buckets[offset + 1] = center - half;
        buckets[offset + 2] = center + half;
      }
      return;
    }
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

  /**
   * Expand `[x, minY, maxY]` buckets into columns spanning the full bucket width so dense data has no gaps.
   * With `baseline`, each column is extended to include it (dense bars and area fills).
   */
  private drawBucketColumns(bucketCount: number, viewport: Viewport, color: RgbaColor, projection: RenderProjection, mode: DrawMode, baseline?: number): void {
    const count = Math.min(bucketCount, BAR_TRIANGLE_CAPACITY);
    if (count <= 0) return;

    const data = this.minMaxBucketData;
    const out = this.barTriangleData;
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
      const low = data[i * 3 + 1]!;
      const high = data[i * 3 + 2]!;
      // Written in place (the body of `writeBarTriangles`): a call with four double arguments allocates a
      // heap number per argument unless it is inlined, which is hundreds of KB of garbage per dense frame.
      const left = Math.max(viewportXMin, x0);
      const right = Math.min(viewportXMax, x1);
      const bottom = baseline === undefined ? low : Math.min(baseline, low);
      const top = baseline === undefined ? high : Math.max(baseline, high);
      const o = i * FLOATS_PER_BAR_TRIANGLES;
      out[o] = left;
      out[o + 1] = bottom;
      out[o + 2] = right;
      out[o + 3] = bottom;
      out[o + 4] = left;
      out[o + 5] = top;
      out[o + 6] = left;
      out[o + 7] = top;
      out[o + 8] = right;
      out[o + 9] = bottom;
      out[o + 10] = right;
      out[o + 11] = top;
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
    this.transformVertices(this.barTriangleData, vertexCount, projection);
    this.renderer.drawLines(this.barTriangleData, vertexCount, color, lineWidth, projection, "lines");
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
    this.transformVertices(this.barTriangleData, vertexCount, projection);
    this.renderer.drawTriangles(this.barTriangleData, vertexCount, color, projection, "triangles");
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

  private recordDraw(mode: DrawMode, points: number): void {
    this.stats.renderMode = this.stats.renderMode === "none" || this.stats.renderMode === mode ? mode : "mixed";
    this.stats.pointsRendered += points;
  }
}
