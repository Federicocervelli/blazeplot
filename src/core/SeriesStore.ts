import type { Dataset, XRange, Viewport, TimeRange, SeriesConfig, SeriesStyle, SeriesStyleOptions, SeriesSample } from "./types.js";
import { hasAppendXY, hasAppendY, hasOhlcAppend, hasUpdate, hasUpdateY, resolveCaps, unsupported } from "./datasetCaps.js";
import type { DatasetCaps } from "./datasetCaps.js";
import { isOhlcAppendData, isOhlcUpdateData, toArrayLike } from "./SeriesInput.js";
import type { SeriesAppendData, SeriesAppendRow, SeriesObjectAppendData, SeriesOhlcUpdateData, SeriesReplaceData, SeriesUpdateData, SeriesXYUpdateData } from "./SeriesInput.js";
import { ScatterSampler } from "./ScatterSampler.js";
import { SeriesLod } from "./SeriesLod.js";
import { SeriesPicker, identity } from "./SeriesPicker.js";
import { SeriesSampler } from "./SeriesSampler.js";
import { SeriesSource } from "./SeriesSource.js";


/** OHLC sample returned by series queries. */
export interface SeriesOhlcSample extends SeriesSample {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** X-range filter for `SeriesStore.dataBounds`. */
export interface SeriesDataBoundsOptions {
  readonly xMin?: number;
  readonly xMax?: number;
}

/** What changed when a series notifies its owner. */
export type SeriesChange = "data" | "visibility";

/**
 * Handle for one chart series: append or update its data, toggle visibility,
 * and query samples. Create series with `chart.addLine(...)` and the other
 * `chart.add*` helpers rather than constructing this class directly.
 *
 * The class owns the series' identity, style, visibility, and mutation API. Reading the data back
 * for rendering and picking is delegated to the `SeriesSampler`, `ScatterSampler`, and
 * `SeriesPicker` helpers, which share one `SeriesSource` view of the dataset.
 */
export class SeriesStore<D extends Dataset = Dataset> {
  readonly config: SeriesConfig;
  readonly style: SeriesStyle;
  private readonly dataset: D;
  /** Capabilities resolved once at construction; no duck typing runs per frame or per sample. */
  private readonly caps: DatasetCaps;
  private readonly isDownsampled: boolean;
  private readonly isServerMinMax: boolean;
  /** LOD pyramid state; only allocates the pyramid for downsampled custom datasets that cannot answer `rangeMinMaxY` themselves. */
  private readonly lod: SeriesLod;
  private readonly source: SeriesSource;
  private readonly sampler: SeriesSampler;
  private readonly scatter: ScatterSampler;
  private readonly picker: SeriesPicker;
  private readonly onChange?: (change: SeriesChange) => void;
  private styleHandler?: (series: SeriesStore, options: SeriesStyleOptions) => void;

  private _visible: boolean = true;
  private _dataVersion: number = 0;

  /** @internal Charts create series; use `chart.addSeries(...)` or a typed `chart.add*` helper. */
  constructor(dataset: D, config: SeriesConfig, style: SeriesStyle, onChange?: (change: SeriesChange) => void) {
    this.dataset = dataset;
    this.config = config;
    this.style = style;
    this.onChange = onChange;
    const caps = resolveCaps(dataset);
    this.caps = caps;
    const mode = config.mode;
    this.isDownsampled = (mode === "line" || mode === "area" || mode === "bar" || mode === "scatter") && config.downsample !== "none";
    this.isServerMinMax = config.downsample === "server" && caps.minMaxSegments !== null;
    this.lod = new SeriesLod(dataset, this.isDownsampled, caps.rangeMinMax !== null);
    this.source = new SeriesSource(dataset, caps, this.lod);
    this.sampler = new SeriesSampler(dataset, caps, this.lod, this.isDownsampled);
    this.scatter = new ScatterSampler(dataset, caps, this.lod);
    this.picker = new SeriesPicker(dataset, caps, this.lod);
  }

  /** @internal Whether dense views of this series are reduced to min/max buckets. */
  get downsampled(): boolean {
    return this.isDownsampled;
  }

  /** @internal Whether the dataset supplies its own pre-sampled min/max buckets. */
  get hasServerMinMax(): boolean {
    return this.isServerMinMax;
  }

  /** @internal Counter that changes whenever the series reports a data change; lets overlays cache derived geometry. */
  get dataVersion(): number {
    return this._dataVersion;
  }

  /** Number of samples in the backing dataset. */
  get length(): number {
    return this.dataset.length;
  }

  /** Whether the series is drawn and included in picks, legends, and fits. */
  get visible(): boolean {
    return this._visible;
  }

  /** X range covered by the backing dataset, or `null` when empty. */
  get xRange(): TimeRange | null {
    return this.dataset.range;
  }

  /**
   * Merge style options into the series' style and redraw on the next frame. Omitted (or
   * `undefined`) fields keep their current value; CSS colors resolve against the chart root.
   * Setting `color` pins it, so later theme changes no longer recolor this series. Updates
   * survive forced-colors mode being turned off.
   */
  setStyle(options: SeriesStyleOptions): void {
    if (!this.styleHandler) throw new TypeError("series.setStyle(...) is only available on series attached through a chart.");
    this.styleHandler(this as SeriesStore, options);
  }

  /** @internal Route `setStyle` through the owning chart, which resolves colors and forced-colors state. */
  bindStyleHandler(handler: (series: SeriesStore, options: SeriesStyleOptions) => void): void {
    this.styleHandler = handler;
  }

  /** @internal Replace the resolved style, e.g. while the OS forces high-contrast colors. */
  applyResolvedStyle(style: SeriesStyle): void {
    (this as { style: SeriesStyle }).style = style;
  }

  /** Show or hide the series. Legends and other plugins update automatically. */
  setVisible(visible: boolean): void {
    if (this._visible === visible) return;
    this._visible = visible;
    this.onChange?.("visibility");
  }

  /**
   * Append data and schedule a render. Accepts `{ x, y }` (scalars or arrays),
   * `{ y }` for implicit-X series, `{ x, open, high, low, close }` for OHLC
   * series, or an array of row objects.
   */
  append(data: SeriesAppendData): void {
    if (Array.isArray(data)) {
      this.appendRows(data as readonly SeriesAppendRow[]);
      return;
    }
    const object = data as SeriesObjectAppendData;
    if (isOhlcAppendData(object)) {
      this.appendOhlcArrays(
        toArrayLike(object.x),
        toArrayLike(object.open),
        toArrayLike(object.high),
        toArrayLike(object.low),
        toArrayLike(object.close),
      );
      return;
    }
    if (object.x === undefined) this.appendYArray(toArrayLike(object.y));
    else this.appendXY(toArrayLike(object.x), toArrayLike(object.y));
  }

  private appendRows(rows: readonly SeriesAppendRow[]): void {
    if (rows.length === 0) return;

    const first = rows[0]!;
    if (isOhlcAppendData(first)) {
      const x = new Float64Array(rows.length);
      const open = new Float64Array(rows.length);
      const high = new Float64Array(rows.length);
      const low = new Float64Array(rows.length);
      const close = new Float64Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        if (!isOhlcAppendData(row)) {
          throw new TypeError("SeriesStore OHLC row appends cannot mix OHLC and XY rows.");
        }
        x[i] = row.x;
        open[i] = row.open;
        high[i] = row.high;
        low[i] = row.low;
        close[i] = row.close;
      }
      this.appendOhlcArrays(x, open, high, low, close);
      return;
    }

    const explicitX = first.x !== undefined;
    const x = explicitX ? new Float64Array(rows.length) : null;
    const y = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (isOhlcAppendData(row)) {
        throw new TypeError("SeriesStore XY row appends cannot mix XY and OHLC rows.");
      }
      if ((row.x !== undefined) !== explicitX) {
        throw new TypeError("SeriesStore XY row appends cannot mix explicit and implicit x values.");
      }
      if (explicitX) x![i] = row.x!;
      y[i] = row.y;
    }

    if (x) this.appendXY(x, y);
    else this.appendYArray(y);
  }

  private appendXY(x: ArrayLike<number>, y: ArrayLike<number>): void {
    if (!hasAppendXY(this.dataset)) {
      throw unsupported("series.append({ x, y })", "an appendable XY dataset such as RingBuffer. Create the series with chart.addLine({ capacity })");
    }
    this.dataset.append(x, y);
    this.markDataMutated(false);
  }

  private appendYArray(y: ArrayLike<number>): void {
    if (!hasAppendY(this.dataset)) {
      throw unsupported("series.append({ y })", "an implicit-X dataset such as UniformRingBuffer. Use series.append({ x, y }) or create the series with chart.addLine({ capacity, xStep })");
    }
    this.dataset.appendY(y);
    this.markDataMutated(false);
  }

  private appendOhlcArrays(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
  ): void {
    if (!hasOhlcAppend(this.dataset)) {
      throw unsupported("series.append({ x, open, high, low, close })", "an appendable OHLC dataset such as OhlcRingBuffer");
    }
    this.dataset.append(x, open, high, low, close);
    this.markDataMutated(false);
  }

  /** Update the latest XY/OHLC sample and schedule a render. */
  updateLast(data: SeriesUpdateData): boolean {
    return this.updateAt(this.dataset.length - 1, data);
  }

  /** Update an existing XY/OHLC sample by logical index and schedule a render. */
  updateAt(index: number, data: SeriesUpdateData): boolean {
    if (index < 0 || index >= this.dataset.length) return false;
    const updated = isOhlcUpdateData(data) ? this.updateOhlcAt(index, data) : this.updateXYAt(index, data);
    if (updated) this.markDataMutated(true);
    return updated;
  }

  private updateXYAt(index: number, data: SeriesXYUpdateData): boolean {
    if (data.x !== undefined) {
      if (!hasUpdate(this.dataset)) {
        throw unsupported("series.updateAt(index, { x, y })", "a mutable XY dataset such as RingBuffer");
      }
      return this.dataset.update(index, data.x, data.y);
    }
    if (hasUpdateY(this.dataset)) return this.dataset.updateY(index, data.y);
    if (hasUpdate(this.dataset)) return this.dataset.update(index, this.dataset.getX(index), data.y);
    throw unsupported("series.updateAt(index, { y })", "a mutable dataset such as RingBuffer or UniformRingBuffer");
  }

  private updateOhlcAt(index: number, data: SeriesOhlcUpdateData): boolean {
    if (!hasOhlcAppend(this.dataset) || typeof this.dataset.updateAt !== "function") {
      throw unsupported("series.updateAt(index, { open, high, low, close })", "a mutable OHLC dataset such as OhlcRingBuffer");
    }
    return this.dataset.updateAt(index, data.open, data.high, data.low, data.close);
  }

  /** Replace all data in datasets that support wholesale replacement, such as `StaticDataset` or `ServerSampledDataset`. */

  /** Replace all data in datasets that support wholesale replacement, such as `StaticDataset` or `ServerSampledDataset`. */
  replace(data: SeriesReplaceData<D>): void {
    const dataset = this.dataset as Dataset & { replace?: (data: unknown) => void };
    if (typeof dataset.replace !== "function") {
      throw unsupported("series.replace(...)", "a dataset with replace(...) support, such as StaticDataset or ServerSampledDataset");
    }
    dataset.replace(data);
    this.lod.resetRawScan();
    this.markDataMutated(true);
  }

  /** Tell the chart the backing dataset was mutated directly, so derived LOD data is rebuilt and the chart re-renders. */
  markDirty(): void {
    this.dataset.invalidate?.();
    this.markDataMutated(true);
  }

  private markDataMutated(forceFullPyramidRebuild: boolean): void {
    this._dataVersion++;
    this.lod.markMutated(forceFullPyramidRebuild);
    this.onChange?.("data");
  }

  /** Remove all samples from a clearable dataset such as `RingBuffer`. */
  clear(): void {
    if (!("clear" in this.dataset) || typeof this.dataset.clear !== "function") {
      throw unsupported("series.clear()", "a clearable dataset such as RingBuffer, UniformRingBuffer, or OhlcRingBuffer");
    }

    (this.dataset.clear as () => void).call(this.dataset);
    this.lod.reset(this.dataset);
    this._dataVersion++;
    this.onChange?.("data");
  }

  /** @internal Rebuild or extend LOD state after data changes. Called by the chart before drawing. */
  rebuildPyramid(): void {
    this.lod.rebuild(this.dataset);
  }

  /** @internal Count samples whose X values overlap a viewport. */
  visibleSampleCount(viewport: Viewport): number {
    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    return Math.max(0, end - start);
  }

  /** @internal Return the represented X interval for a logical index when the dataset exposes interval metadata. */
  xRangeAt(index: number): XRange | null {
    return this.caps.xRange ? this.caps.xRange.getXRange(index) : null;
  }

  /** Return the XY sample at a logical index, or `null` for gaps and out-of-range indexes. */
  sampleAt(index: number): SeriesSample | null {
    return this.source.sampleAt(index);
  }

  /** Return the OHLC sample at a logical index, or `null` when out of range or not an OHLC series. */
  ohlcAt(index: number): SeriesOhlcSample | null {
    const ohlc = this.caps.ohlc;
    if (index < 0 || index >= this.dataset.length || !ohlc) return null;
    const close = ohlc.getClose(index);
    return {
      index,
      x: ohlc.getX(index),
      y: close,
      open: ohlc.getOpen(index),
      high: ohlc.getHigh(index),
      low: ohlc.getLow(index),
      close,
    };
  }

  /** Compute data bounds over all samples or an X range; bars and areas include their baseline. */
  dataBounds(options: SeriesDataBoundsOptions = {}): Viewport | null {
    if (this.dataset.length <= 0) return null;

    const start = Number.isFinite(options.xMin) ? this.dataset.lowerBoundX(options.xMin!) : 0;
    const end = Number.isFinite(options.xMax) ? this.dataset.upperBoundX(options.xMax!) : this.dataset.length;
    if (start >= end) return null;

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    const ohlc = this.caps.ohlc;
    const rangeMinMax = ohlc ? null : this.caps.rangeMinMax;

    if (rangeMinMax && !this.caps.xRange && (!this.caps.gaps || rangeMinMax.rangeMinMaxExcludesGaps === true)) {
      let first = start;
      let last = end - 1;
      while (first < end && this.isGap(first)) first++;
      while (last >= first && this.isGap(last)) last--;
      const range = first <= last ? rangeMinMax.rangeMinMaxY(first, last + 1) : null;
      if (range) {
        xMin = this.dataset.getX(first);
        xMax = this.dataset.getX(last);
        yMin = range.minY;
        yMax = range.maxY;
      }
    }

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      for (let i = start; i < end; i++) {
        const x = this.dataset.getX(i);
        const y = this.dataset.getY(i);
        if (this.isGap(i, y)) continue;
        const range = rangeMinMax?.rangeMinMaxY(i, i + 1);
        const low = ohlc ? ohlc.getLow(i) : range?.minY ?? y;
        const high = ohlc ? ohlc.getHigh(i) : range?.maxY ?? low;
        if (!Number.isFinite(x) || !Number.isFinite(low) || !Number.isFinite(high)) continue;
        const xRange = this.xRangeAt(i);
        const sampleXMin = xRange && Number.isFinite(xRange.xStart) ? xRange.xStart : x;
        const sampleXMax = xRange && Number.isFinite(xRange.xEnd) ? xRange.xEnd : x;
        xMin = Math.min(xMin, sampleXMin, sampleXMax);
        xMax = Math.max(xMax, sampleXMin, sampleXMax);
        yMin = Math.min(yMin, low, high);
        yMax = Math.max(yMax, low, high);
      }
    }

    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
    if ((this.config.mode === "area" || this.config.mode === "bar") && Number.isFinite(this.style.baseline)) {
      yMin = Math.min(yMin, this.style.baseline);
      yMax = Math.max(yMax, this.style.baseline);
    }
    return { xMin, xMax, yMin, yMax };
  }

  /**
   * @internal Write `[minY, maxY]` for each of `bucketCount` equal-width X buckets spanning
   * `[xMin, xMax]` into `target` (`NaN` pair when a bucket holds no non-gap sample). Bucket edges
   * are found by binary search and extremes come from the shared min/max tree, so the cost is
   * O(buckets * log n) for the built-in datasets. Bars and areas include their baseline.
   */
  copyXBucketBounds(xMin: number, xMax: number, bucketCount: number, target: Float64Array): void {
    const count = Math.min(Math.max(0, Math.floor(bucketCount)), target.length >> 1);
    target.fill(NaN, 0, count * 2);
    if (count === 0 || this.dataset.length <= 0 || !(xMax > xMin)) return;

    const includeBaseline = (this.config.mode === "area" || this.config.mode === "bar") && Number.isFinite(this.style.baseline);
    const rangeMinMax = this.caps.ohlc ? null : this.caps.rangeMinMax;
    const fast = rangeMinMax !== null && !this.caps.xRange && (!this.caps.gaps || rangeMinMax.rangeMinMaxExcludesGaps === true);
    const span = xMax - xMin;
    let start = this.dataset.lowerBoundX(xMin);
    for (let b = 0; b < count; b++) {
      const isLast = b === count - 1;
      const bucketMin = xMin + (span * b) / count;
      const bucketMax = xMin + (span * (b + 1)) / count;
      const end = isLast ? this.dataset.upperBoundX(xMax) : this.dataset.lowerBoundX(bucketMax);
      let minY = NaN;
      let maxY = NaN;
      if (end > start) {
        if (fast) {
          const range = rangeMinMax.rangeMinMaxY(start, end);
          if (range) {
            minY = range.minY;
            maxY = range.maxY;
          }
        } else {
          const bounds = this.dataBounds({ xMin: bucketMin, xMax: isLast ? xMax : bucketMax });
          if (bounds) {
            minY = bounds.yMin;
            maxY = bounds.yMax;
          }
        }
      }
      if (Number.isFinite(minY) && Number.isFinite(maxY)) {
        if (includeBaseline && fast) {
          minY = Math.min(minY, this.style.baseline);
          maxY = Math.max(maxY, this.style.baseline);
        }
        target[b * 2] = minY;
        target[b * 2 + 1] = maxY;
      }
      start = Math.max(start, end);
    }
  }

  /** @internal Copy stable, viewport-anchored XY samples into a render buffer. */
  copyRawVisible(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.sampler.copyRawVisible(viewport, target, maxPoints, xOrigin, yOrigin);
  }

  /** @internal Copy 2D-culled, screen-space sampled scatter points into a render buffer. */
  copyScatterVisible(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    pixelWidth: number,
    pixelHeight: number,
    pointSize: number,
    xOrigin: number = 0,
    yOrigin: number = 0,
  ): number {
    return this.scatter.copyScatterVisible(viewport, target, maxPoints, pixelWidth, pixelHeight, pointSize, xOrigin, yOrigin);
  }

  /** @internal Copy exact Y-culled scatter points for a logical index range. */
  copyScatterRange(
    start: number,
    end: number,
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number = 0,
    pixelHeight: number = 0,
    pointSize: number = 0,
    yOrigin: number = 0,
  ): number {
    return this.scatter.copyScatterRange(start, end, viewport, target, maxPoints, xOrigin, pixelHeight, pointSize, yOrigin);
  }

  /** @internal Copy visible XY samples with the line clipped to the viewport's X edges. */
  copyRawVisibleClipped(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.sampler.copyRawVisibleClipped(viewport, target, maxPoints, xOrigin, yOrigin);
  }

  /**
   * @internal Copy one chunk of the X-clipped line starting at logical index `start`.
   * Returns the vertex count and the index to resume from (`done` once the visible range is exhausted).
   * Each chunk holds whole segments, so consecutive chunks join without a seam gap.
   */
  copyRawClippedChunk(
    viewport: Viewport,
    start: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number = 0,
    yOrigin: number = 0,
  ): { count: number; next: number; done: boolean } {
    return this.sampler.copyRawClippedChunk(viewport, start, target, maxPoints, xOrigin, yOrigin);
  }

  /** @internal Copy a logical XY range into a render buffer; gaps are written as NaN. */
  copyRawRange(start: number, end: number, target: Float32Array, maxPoints: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.sampler.copyRawRange(start, end, target, maxPoints, xOrigin, yOrigin);
  }

  /** @internal Copy stable, viewport-anchored area strip vertices; returns the vertex count. */
  copyAreaVisible(viewport: Viewport, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.sampler.copyAreaVisible(viewport, target, maxPoints, baseline, xOrigin, yOrigin);
  }

  /** @internal Copy an area strip for a logical index range; returns the vertex count. */
  copyAreaRange(start: number, end: number, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.sampler.copyAreaRange(start, end, target, maxPoints, baseline, xOrigin, yOrigin);
  }

  /** @internal Copy visible `[x, minY, maxY]` bucket triples into a render buffer. */
  copyMinMaxInstanced(viewport: Viewport, target: Float32Array, maxSegments: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.sampler.copyMinMaxInstanced(viewport, target, maxSegments, xOrigin, yOrigin);
  }

  /** @internal Copy `[x, open, high, low, close]` tuples for a logical index range; gap candles are written as all-NaN tuples. */
  copyOhlcTuplesRange(start: number, end: number, target: Float32Array, maxCandles: number, xOrigin: number = 0, yOrigin: number = 0): number {
    return this.sampler.copyOhlcTuplesRange(start, end, target, maxCandles, xOrigin, yOrigin);
  }

  /** @internal Find the nearest non-gap sample by X value, optionally constrained to a viewport. */
  nearestSampleByX(x: number, viewport?: Viewport): SeriesSample | null {
    return this.picker.nearestSampleByX(x, viewport);
  }

  /** @internal Find the nearest non-gap sample in screen-space distance. */
  nearestSampleByPoint(
    x: number,
    y: number,
    viewport: Viewport,
    plotWidth: number,
    plotHeight: number,
    maxDistancePx: number = Infinity,
    xTransform: (value: number) => number = identity,
    yTransform: (value: number) => number = identity,
  ): SeriesSample | null {
    return this.picker.nearestSampleByPoint(x, y, viewport, plotWidth, plotHeight, maxDistancePx, xTransform, yTransform);
  }

  /** @internal Return the logical index range overlapping a viewport's X span (all samples when omitted). */
  visibleIndexRange(viewport: Viewport | undefined, outerPadding: number = 0): { start: number; end: number } {
    return this.source.visibleIndexRange(viewport, outerPadding);
  }

  private isGap(index: number, y?: number): boolean {
    return this.source.isGap(index, y);
  }
}
