import type { Dataset, AppendableDataset, YAppendableDataset, UpdatableDataset, YUpdatableDataset, OhlcDataset, XRange, XRangeDataset, RangeMinMaxDataset, RangeSampleCopyDataset, VisibleSampleCopyDataset, VisiblePointCopyDataset, MinMaxSegmentCopyDataset, Viewport, TimeRange, SeriesConfig, SeriesStyle, SeriesStyleOptions, SeriesSample } from "./types.js";
import { MinMaxPyramid } from "./MinMaxPyramid.js";
import type { MinMaxY } from "./MinMaxTree.js";

function hasRangeMinMaxY(dataset: Dataset): dataset is RangeMinMaxDataset {
  return "rangeMinMaxY" in dataset;
}

function hasXRange(dataset: Dataset): dataset is XRangeDataset {
  return "getXRange" in dataset;
}

function isOhlcDataset(dataset: Dataset): dataset is OhlcDataset {
  return "getOpen" in dataset && "getHigh" in dataset && "getLow" in dataset && "getClose" in dataset;
}

interface AppendableOhlcDataset extends OhlcDataset {
  append(
    x: ArrayLike<number>,
    open: ArrayLike<number>,
    high: ArrayLike<number>,
    low: ArrayLike<number>,
    close: ArrayLike<number>,
  ): void;
  updateAt?(index: number, open: number, high: number, low: number, close: number): boolean;
}

function hasAppendXY(dataset: Dataset): dataset is AppendableDataset {
  return "push" in dataset && "append" in dataset;
}

function hasAppendY(dataset: Dataset): dataset is YAppendableDataset {
  return "appendY" in dataset;
}

function hasOhlcAppend(dataset: Dataset): dataset is AppendableOhlcDataset {
  return isOhlcDataset(dataset) && "append" in dataset;
}

function hasUpdate(dataset: Dataset): dataset is UpdatableDataset {
  return typeof (dataset as Partial<UpdatableDataset>).update === "function";
}

function hasUpdateY(dataset: Dataset): dataset is YUpdatableDataset {
  return typeof (dataset as Partial<YUpdatableDataset>).updateY === "function";
}

function hasCopySamplesRange(dataset: Dataset): dataset is RangeSampleCopyDataset {
  return "copySamplesRange" in dataset;
}

function hasCopyMinMaxSegments(dataset: Dataset): dataset is MinMaxSegmentCopyDataset {
  return "copyMinMaxSegments" in dataset;
}

function hasCopyVisibleSamples(dataset: Dataset): dataset is VisibleSampleCopyDataset {
  return "copyVisibleSamples" in dataset;
}

function hasCopyVisiblePoints(dataset: Dataset): dataset is VisiblePointCopyDataset {
  return "copyVisiblePoints" in dataset;
}

function hasExplicitGaps(dataset: Dataset): dataset is Dataset & { isGap(index: number): boolean } {
  return typeof dataset.isGap === "function";
}

/** Error for a series call the backing dataset does not support: `"<call> requires <requirement>."`. */
function unsupported(call: string, requirement: string): TypeError {
  return new TypeError(`${call} requires ${requirement}.`);
}

function toArrayLike(value: SeriesScalarOrArray): ArrayLike<number> {
  return typeof value === "number" ? [value] : value;
}

function isOhlcAppendData(data: SeriesObjectAppendData | SeriesAppendRow): data is SeriesOhlcAppendData | SeriesOhlcAppendRow {
  return typeof data === "object" && data !== null && "open" in data && "high" in data && "low" in data && "close" in data;
}

function isOhlcUpdateData(data: SeriesUpdateData): data is SeriesOhlcUpdateData {
  return "open" in data && "high" in data && "low" in data && "close" in data;
}

const NEAREST_POINT_LEAF_SIZE = 64;
const SCATTER_INTERVAL_LEAF_SIZE = 64;
const SCATTER_BUCKET_RANGE_PRUNE_SIZE = 1024;
const identity = (value: number): number => value;

/** Single numeric sample value or a batch of values. */
export type SeriesScalarOrArray = number | ArrayLike<number>;

/** Object form for appending one XY sample or a batch of X/Y arrays. Omit `x` for implicit-X series. */
export interface SeriesXYAppendData {
  readonly x?: SeriesScalarOrArray;
  readonly y: SeriesScalarOrArray;
}

/** Object form for appending one OHLC sample or a batch of OHLC arrays. */
export interface SeriesOhlcAppendData {
  readonly x: SeriesScalarOrArray;
  readonly open: SeriesScalarOrArray;
  readonly high: SeriesScalarOrArray;
  readonly low: SeriesScalarOrArray;
  readonly close: SeriesScalarOrArray;
}

/** Convenient object-row form for appending one XY sample inside a row batch. */
export interface SeriesXYAppendRow {
  readonly x?: number;
  readonly y: number;
}

/** Convenient object-row form for appending one OHLC sample inside a row batch. */
export interface SeriesOhlcAppendRow {
  readonly x: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Object form for updating one XY sample. */
export interface SeriesXYUpdateData {
  readonly x?: number;
  readonly y: number;
}

/** Object form for updating one OHLC sample. */
export interface SeriesOhlcUpdateData {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Any supported update payload for the last or indexed sample. */
export type SeriesUpdateData = SeriesXYUpdateData | SeriesOhlcUpdateData;
/** Any supported object row for batched appends. */
export type SeriesAppendRow = SeriesXYAppendRow | SeriesOhlcAppendRow;
/** Any object payload for appending one or more samples. */
export type SeriesObjectAppendData = SeriesXYAppendData | SeriesOhlcAppendData;
/** Any payload accepted by `SeriesStore.append`. */
export type SeriesAppendData = SeriesObjectAppendData | readonly SeriesAppendRow[];

/** Payload accepted by `series.replace(...)`: whatever the backing dataset's `replace` method takes. */
export type SeriesReplaceData<D extends Dataset> = D extends { replace(data: infer T): void } ? T : never;

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

type PointSearchInterval = {
  readonly start: number;
  readonly end: number;
  readonly lowerBoundSq: number;
};

function interpolateY(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}

/**
 * Handle for one chart series: append or update its data, toggle visibility,
 * and query samples. Create series with `chart.addLine(...)` and the other
 * `chart.add*` helpers rather than constructing this class directly.
 */
export class SeriesStore<D extends Dataset = Dataset> {
  readonly config: SeriesConfig;
  readonly style: SeriesStyle;
  private readonly dataset: D;
  private readonly rangeMinMax: RangeMinMaxDataset | null;
  /** Only allocated for downsampled custom datasets that cannot answer `rangeMinMaxY` themselves. */
  private readonly pyramid: MinMaxPyramid | null;
  private readonly onChange?: (change: SeriesChange) => void;
  private styleHandler?: (series: SeriesStore, options: SeriesStyleOptions) => void;

  private _dirty: boolean = false;
  private _forceFullPyramidRebuild: boolean = false;
  private _useRawMinMaxScan: boolean = false;
  private _lastBuildLength: number = 0;
  private _lastBuildRangeStart: number = NaN;
  private _visible: boolean = true;
  private _dataVersion: number = 0;

  /** @internal Charts create series; use `chart.addSeries(...)` or a typed `chart.add*` helper. */
  constructor(dataset: D, config: SeriesConfig, style: SeriesStyle, onChange?: (change: SeriesChange) => void) {
    this.dataset = dataset;
    this.config = config;
    this.style = style;
    this.onChange = onChange;
    this.rangeMinMax = hasRangeMinMaxY(dataset) ? dataset : null;
    this.pyramid = this.downsampled && !this.rangeMinMax ? new MinMaxPyramid() : null;
    if (this.pyramid && dataset.length > 0) this.pyramid.build(dataset);
    this._lastBuildLength = dataset.length;
    this._lastBuildRangeStart = dataset.range?.start ?? NaN;
  }

  /** @internal Whether dense views of this series are reduced to min/max buckets. */
  get downsampled(): boolean {
    const mode = this.config.mode;
    return (mode === "line" || mode === "bar" || mode === "scatter") && this.config.downsample !== "none";
  }

  /** @internal Whether the dataset supplies its own pre-sampled min/max buckets. */
  get hasServerMinMax(): boolean {
    return this.config.downsample === "server" && hasCopyMinMaxSegments(this.dataset);
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
  replace(data: SeriesReplaceData<D>): void {
    const dataset = this.dataset as Dataset & { replace?: (data: unknown) => void };
    if (typeof dataset.replace !== "function") {
      throw unsupported("series.replace(...)", "a dataset with replace(...) support, such as StaticDataset or ServerSampledDataset");
    }
    dataset.replace(data);
    this._useRawMinMaxScan = false;
    this.markDataMutated(true);
  }

  /** Tell the chart the backing dataset was mutated directly, so derived LOD data is rebuilt and the chart re-renders. */
  markDirty(): void {
    this.dataset.invalidate?.();
    this.markDataMutated(true);
  }

  private markDataMutated(forceFullPyramidRebuild: boolean): void {
    this._dataVersion++;
    this._dirty = true;
    this._forceFullPyramidRebuild ||= forceFullPyramidRebuild;
    this.onChange?.("data");
  }

  /** Remove all samples from a clearable dataset such as `RingBuffer`. */
  clear(): void {
    if (!("clear" in this.dataset) || typeof this.dataset.clear !== "function") {
      throw unsupported("series.clear()", "a clearable dataset such as RingBuffer, UniformRingBuffer, or OhlcRingBuffer");
    }

    (this.dataset.clear as () => void).call(this.dataset);
    this._useRawMinMaxScan = false;
    this._forceFullPyramidRebuild = false;
    this.pyramid?.build(this.dataset);
    this._lastBuildLength = this.dataset.length;
    this._lastBuildRangeStart = this.dataset.range?.start ?? NaN;
    this._dataVersion++;
    this._dirty = false;
    this.onChange?.("data");
  }

  /** @internal Rebuild or extend LOD state after data changes. Called by the chart before drawing. */
  rebuildPyramid(): void {
    if (!this._dirty) return;
    if (this.pyramid) {
      const length = this.dataset.length;
      const rangeStart = this.dataset.range?.start ?? NaN;
      const shiftedAtCapacity = length === this._lastBuildLength && rangeStart !== this._lastBuildRangeStart;
      if (this._forceFullPyramidRebuild) {
        this.pyramid.build(this.dataset);
        this._useRawMinMaxScan = false;
      } else if (shiftedAtCapacity) {
        // A wrapping ring buffer shifted every logical index; scan raw ranges instead of rebuilding per frame.
        this._useRawMinMaxScan = true;
      } else {
        this.pyramid.incrementalBuild(this.dataset);
        this._useRawMinMaxScan = false;
      }
      this._lastBuildLength = length;
      this._lastBuildRangeStart = rangeStart;
    }
    this._forceFullPyramidRebuild = false;
    this._dirty = false;
  }

  /** @internal Count samples whose X values overlap a viewport. */
  visibleSampleCount(viewport: Viewport): number {
    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    return Math.max(0, end - start);
  }

  /** @internal Return the represented X interval for a logical index when the dataset exposes interval metadata. */
  xRangeAt(index: number): XRange | null {
    return hasXRange(this.dataset) ? this.dataset.getXRange(index) : null;
  }

  /** Return the XY sample at a logical index, or `null` for gaps and out-of-range indexes. */
  sampleAt(index: number): SeriesSample | null {
    if (index < 0 || index >= this.dataset.length) return null;
    const y = this.dataset.getY(index);
    if (this.isGap(index, y)) return null;
    return { index, x: this.dataset.getX(index), y };
  }

  /** Return the OHLC sample at a logical index, or `null` when out of range or not an OHLC series. */
  ohlcAt(index: number): SeriesOhlcSample | null {
    if (index < 0 || index >= this.dataset.length || !isOhlcDataset(this.dataset)) return null;
    const close = this.dataset.getClose(index);
    return {
      index,
      x: this.dataset.getX(index),
      y: close,
      open: this.dataset.getOpen(index),
      high: this.dataset.getHigh(index),
      low: this.dataset.getLow(index),
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
    const ohlc = isOhlcDataset(this.dataset) ? this.dataset : null;
    const rangeMinMax = ohlc ? null : this.rangeMinMax;

    if (rangeMinMax && !hasXRange(this.dataset) && (!hasExplicitGaps(this.dataset) || rangeMinMax.rangeMinMaxExcludesGaps === true)) {
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
    const rangeMinMax = isOhlcDataset(this.dataset) ? null : this.rangeMinMax;
    const fast = rangeMinMax !== null && !hasXRange(this.dataset) && (!hasExplicitGaps(this.dataset) || rangeMinMax.rangeMinMaxExcludesGaps === true);
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

  /** @internal Find the nearest non-gap sample by X value, optionally constrained to a viewport. */
  nearestSampleByX(x: number, viewport?: Viewport): SeriesSample | null {
    const range = this.visibleIndexRange(viewport);
    if (range.start >= range.end) return null;

    const lower = this.dataset.lowerBoundX(x);
    let left = Math.min(lower - 1, range.end - 1);
    let right = Math.max(lower, range.start);

    while (left >= range.start || right < range.end) {
      const leftDx = left >= range.start ? Math.abs(this.dataset.getX(left) - x) : Infinity;
      const rightDx = right < range.end ? Math.abs(this.dataset.getX(right) - x) : Infinity;
      if (leftDx <= rightDx) {
        const sample = this.sampleAt(left);
        if (sample) return sample;
        left--;
      } else {
        const sample = this.sampleAt(right);
        if (sample) return sample;
        right++;
      }
    }

    return null;
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
    const range = this.visibleIndexRange(viewport);
    const transformedX = xTransform(x);
    const transformedY = yTransform(y);
    const xRange = xTransform(viewport.xMax) - xTransform(viewport.xMin);
    const yRange = yTransform(viewport.yMax) - yTransform(viewport.yMin);
    if (range.start >= range.end || plotWidth <= 0 || plotHeight <= 0 || xRange <= 0 || yRange <= 0) return null;

    const xScale = plotWidth / xRange;
    const yScale = plotHeight / yRange;
    let bestIndex = -1;
    let bestDistanceSq = maxDistancePx < 0
      ? -1
      : Number.isFinite(maxDistancePx)
        ? maxDistancePx * maxDistancePx
        : Infinity;

    const visitSample = (index: number): void => {
      const sampleY = this.dataset.getY(index);
      if (this.isGap(index, sampleY)) return;
      const dx = (xTransform(this.dataset.getX(index)) - transformedX) * xScale;
      const dy = (yTransform(sampleY) - transformedY) * yScale;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistanceSq || (bestIndex < 0 && d2 <= bestDistanceSq)) {
        bestDistanceSq = d2;
        bestIndex = index;
      }
    };

    const lower = this.dataset.lowerBoundX(x);
    const nearest = Math.min(Math.max(lower, range.start), range.end - 1);
    visitSample(nearest);
    if (nearest > range.start) visitSample(nearest - 1);
    if (nearest + 1 < range.end) visitSample(nearest + 1);

    if (this.hasPointIntervalBounds() && range.end - range.start > NEAREST_POINT_LEAF_SIZE) {
      const rootBound = this.pointIntervalDistanceSq(range.start, range.end, transformedX, transformedY, xScale, yScale, xTransform, yTransform);
      const stack: PointSearchInterval[] = rootBound <= bestDistanceSq
        ? [{ start: range.start, end: range.end, lowerBoundSq: rootBound }]
        : [];

      while (stack.length > 0) {
        const interval = stack.pop()!;
        if (interval.lowerBoundSq > bestDistanceSq) continue;

        const length = interval.end - interval.start;
        if (length <= NEAREST_POINT_LEAF_SIZE) {
          for (let i = interval.start; i < interval.end; i++) visitSample(i);
          continue;
        }

        const mid = interval.start + (length >> 1);
        const leftBound = this.pointIntervalDistanceSq(interval.start, mid, transformedX, transformedY, xScale, yScale, xTransform, yTransform);
        const rightBound = this.pointIntervalDistanceSq(mid, interval.end, transformedX, transformedY, xScale, yScale, xTransform, yTransform);
        const left: PointSearchInterval = { start: interval.start, end: mid, lowerBoundSq: leftBound };
        const right: PointSearchInterval = { start: mid, end: interval.end, lowerBoundSq: rightBound };

        if (leftBound < rightBound) {
          if (rightBound <= bestDistanceSq) stack.push(right);
          if (leftBound <= bestDistanceSq) stack.push(left);
        } else {
          if (leftBound <= bestDistanceSq) stack.push(left);
          if (rightBound <= bestDistanceSq) stack.push(right);
        }
      }
    } else {
      let left = Math.min(lower - 1, range.end - 1);
      let right = Math.max(lower, range.start);
      while (left >= range.start || right < range.end) {
        const leftDxSq = left >= range.start ? this.pointXDistanceSq(left, transformedX, xScale, xTransform) : Infinity;
        const rightDxSq = right < range.end ? this.pointXDistanceSq(right, transformedX, xScale, xTransform) : Infinity;
        if (leftDxSq > bestDistanceSq && rightDxSq > bestDistanceSq) break;

        if (leftDxSq <= rightDxSq) {
          if (leftDxSq <= bestDistanceSq) visitSample(left);
          left--;
        } else {
          if (rightDxSq <= bestDistanceSq) visitSample(right);
          right++;
        }
      }
    }

    if (bestIndex < 0) return null;
    const sample = this.sampleAt(bestIndex);
    return sample ? { ...sample, distancePx: Math.sqrt(bestDistanceSq) } : null;
  }

  /** @internal Copy stable, viewport-anchored XY samples into a render buffer. */
  copyRawVisible(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "points", 0, xOrigin);
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
  ): number {
    return this.copyVisiblePoints(viewport, target, maxPoints, pixelWidth, pixelHeight, pointSize, xOrigin);
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
  ): number {
    if (maxPoints <= 0 || target.length < maxPoints * 2) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    if (to <= from) return 0;

    const yRange = viewport.yMax - viewport.yMin;
    const height = Math.max(0, Math.floor(pixelHeight));
    const safePointSize = Number.isFinite(pointSize) ? Math.max(0, pointSize) : 0;
    const yPad = yRange > 0 && height > 0 ? ((safePointSize * 0.5) / height) * yRange : 0;
    return this.copyVisiblePointRange(from, to, viewport.yMin - yPad, viewport.yMax + yPad, target, maxPoints, xOrigin);
  }

  /** @internal Copy visible XY samples with the line clipped to the viewport's X edges. */
  copyRawVisibleClipped(viewport: Viewport, target: Float32Array, maxPoints: number, xOrigin: number = 0): number {
    return this.copyRawClippedChunk(viewport, 0, target, maxPoints, xOrigin).count;
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
  ): { count: number; next: number; done: boolean } {
    if (maxPoints < 2 || target.length < maxPoints * 2) return { count: 0, next: start, done: true };

    const range = this.visibleIndexRange(viewport, 1);
    const from = Math.max(range.start, start);
    const end = range.end;
    if (end - from <= 0) return { count: 0, next: end, done: true };

    let count = 0;
    let lastX = NaN;
    let lastY = NaN;
    let lastWasGap = false;
    const addPoint = (x: number, y: number): void => {
      const outX = x - xOrigin;
      if (!lastWasGap && count > 0 && outX === lastX && y === lastY) return;
      const offset = count * 2;
      target[offset] = outX;
      target[offset + 1] = y;
      count++;
      lastX = outX;
      lastY = y;
      lastWasGap = false;
    };
    const addGap = (): void => {
      if (count === 0 || lastWasGap) return;
      const offset = count * 2;
      target[offset] = NaN;
      target[offset + 1] = NaN;
      count++;
      lastX = NaN;
      lastY = NaN;
      lastWasGap = true;
    };

    if (range.end - range.start === 1) {
      const x = this.dataset.getX(from);
      const y = this.dataset.getY(from);
      if (x < viewport.xMin || x > viewport.xMax || this.isGap(from, y)) return { count: 0, next: end, done: true };
      addPoint(x, y);
      return { count, next: end, done: true };
    }

    let i = from;
    for (; i + 1 < end; i++) {
      // A segment emits at most two points; stop before the buffer could overflow.
      if (count + 2 > maxPoints) return { count, next: i, done: false };
      const x0 = this.dataset.getX(i);
      const y0 = this.dataset.getY(i);
      const x1 = this.dataset.getX(i + 1);
      const y1 = this.dataset.getY(i + 1);
      if (x1 < viewport.xMin || x0 > viewport.xMax) continue;
      if (this.isGap(i, y0) || this.isGap(i + 1, y1)) {
        addGap();
        continue;
      }

      const clippedX0 = Math.max(x0, viewport.xMin);
      const clippedX1 = Math.min(x1, viewport.xMax);
      if (clippedX1 < clippedX0) continue;
      addPoint(clippedX0, interpolateY(x0, y0, x1, y1, clippedX0));
      addPoint(clippedX1, interpolateY(x0, y0, x1, y1, clippedX1));
    }

    return { count, next: i, done: true };
  }

  /** @internal Copy a logical XY range into a render buffer; gaps are written as NaN. */
  copyRawRange(start: number, end: number, target: Float32Array, maxPoints: number, xOrigin: number = 0): number {
    return this.copySampleRange(start, end, target, maxPoints, "points", 0, xOrigin);
  }

  /** @internal Copy stable, viewport-anchored area strip vertices; returns the vertex count. */
  copyAreaVisible(viewport: Viewport, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0): number {
    return this.copyVisibleSamples(viewport, target, maxPoints, "area", baseline, xOrigin) * 2;
  }

  /** @internal Copy an area strip for a logical index range; returns the vertex count. */
  copyAreaRange(start: number, end: number, target: Float32Array, maxPoints: number, baseline: number = 0, xOrigin: number = 0): number {
    return this.copySampleRange(start, end, target, maxPoints, "area", baseline, xOrigin) * 2;
  }

  /** @internal Copy visible `[x, minY, maxY]` bucket triples into a render buffer. */
  copyMinMaxInstanced(viewport: Viewport, target: Float32Array, maxSegments: number, xOrigin: number = 0): number {
    if (hasCopyMinMaxSegments(this.dataset)) {
      return this.dataset.copyMinMaxSegments(viewport, target, maxSegments, xOrigin);
    }
    if (!this.downsampled || maxSegments <= 0 || target.length < maxSegments * 3) return 0;

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    if (end <= start) return 0;

    const bucketWidth = this.stableSampleBucketWidthForViewport(viewport, maxSegments);
    const alignedStart = this.alignBucketStart(start, bucketWidth);
    let written = 0;
    for (let bucketStart = alignedStart; bucketStart < end && written < maxSegments; bucketStart += bucketWidth) {
      const bucketEnd = Math.min(this.dataset.length, bucketStart + bucketWidth);
      const segmentStart = Math.max(0, bucketStart);
      if (bucketEnd <= start || segmentStart >= end) continue;

      const range = this.minMaxForRange(segmentStart, bucketEnd);
      if (!range) continue;

      const representative = Math.max(segmentStart, Math.min(bucketEnd - 1, bucketStart + (bucketWidth >> 1)));
      const offset = written * 3;
      target[offset] = this.dataset.getX(representative) - xOrigin;
      target[offset + 1] = range.minY;
      target[offset + 2] = range.maxY;
      written++;
    }

    return written;
  }

  /** @internal Copy `[x, open, high, low, close]` tuples for a logical index range; gap candles are written as all-NaN tuples. */
  copyOhlcTuplesRange(start: number, end: number, target: Float32Array, maxCandles: number, xOrigin: number = 0): number {
    if (!isOhlcDataset(this.dataset) || maxCandles <= 0 || target.length < maxCandles * 5) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    const count = Math.min(maxCandles, Math.max(0, to - from));
    const explicitGaps = hasExplicitGaps(this.dataset);
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const offset = i * 5;
      if (explicitGaps && this.dataset.isGap(index)) {
        target.fill(NaN, offset, offset + 5);
        continue;
      }
      target[offset] = this.dataset.getX(index) - xOrigin;
      target[offset + 1] = this.dataset.getOpen(index);
      target[offset + 2] = this.dataset.getHigh(index);
      target[offset + 3] = this.dataset.getLow(index);
      target[offset + 4] = this.dataset.getClose(index);
    }

    return count;
  }

  /** @internal Return the logical index range overlapping a viewport's X span (all samples when omitted). */
  visibleIndexRange(viewport: Viewport | undefined, outerPadding: number = 0): { start: number; end: number } {
    if (!viewport) return { start: 0, end: this.dataset.length };
    const pad = Math.max(0, Math.floor(outerPadding));
    return {
      start: Math.max(0, this.dataset.lowerBoundX(viewport.xMin) - pad),
      end: Math.min(this.dataset.length, this.dataset.upperBoundX(viewport.xMax) + pad),
    };
  }

  private isGap(index: number, y?: number): boolean {
    const value = y ?? this.dataset.getY(index);
    return !Number.isFinite(value) || (hasExplicitGaps(this.dataset) && this.dataset.isGap(index));
  }

  private pointXDistanceSq(index: number, x: number, xScale: number, xTransform: (value: number) => number): number {
    const dx = (xTransform(this.dataset.getX(index)) - x) * xScale;
    return dx * dx;
  }

  private pointIntervalDistanceSq(
    start: number,
    end: number,
    x: number,
    y: number,
    xScale: number,
    yScale: number,
    xTransform: (value: number) => number,
    yTransform: (value: number) => number,
  ): number {
    if (end <= start) return Infinity;

    const x0 = xTransform(this.dataset.getX(start));
    const x1 = xTransform(this.dataset.getX(end - 1));
    const dx = x < x0 ? (x0 - x) * xScale : x > x1 ? (x - x1) * xScale : 0;

    const range = this.pointIntervalMinMaxY(start, end);
    if (!range) return Infinity;
    const minY = yTransform(range.minY);
    const maxY = yTransform(range.maxY);
    const dy = y < minY ? (minY - y) * yScale : y > maxY ? (y - maxY) * yScale : 0;
    return dx * dx + dy * dy;
  }

  /** Whether `pointIntervalMinMaxY` can answer without scanning raw samples. */
  private hasPointIntervalBounds(): boolean {
    return this.rangeMinMax !== null || (this.pyramid !== null && !this._dirty && !this._useRawMinMaxScan);
  }

  private pointIntervalMinMaxY(start: number, end: number): MinMaxY | null {
    if (this.rangeMinMax) return this.rangeMinMax.rangeMinMaxY(start, end);
    if (this.pyramid && !this._dirty && !this._useRawMinMaxScan) return this.pyramid.rangeMinMax(this.dataset, start, end);
    return null;
  }

  private copyVisiblePoints(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    pixelWidth: number,
    pixelHeight: number,
    pointSize: number,
    xOrigin: number,
  ): number {
    if (hasCopyVisiblePoints(this.dataset)) {
      return this.dataset.copyVisiblePoints(viewport, target, maxPoints, xOrigin, pixelWidth, pixelHeight, pointSize);
    }

    if (maxPoints <= 0 || target.length < maxPoints * 2) return 0;

    const xRange = viewport.xMax - viewport.xMin;
    const yRange = viewport.yMax - viewport.yMin;
    const width = Math.max(1, Math.floor(pixelWidth));
    const height = Math.max(1, Math.floor(pixelHeight));
    if (xRange <= 0 || yRange <= 0) return 0;

    const safePointSize = Number.isFinite(pointSize) ? Math.max(0, pointSize) : 0;
    const pointRadius = safePointSize * 0.5;
    const xPad = (pointRadius / width) * xRange;
    const yPad = (pointRadius / height) * yRange;
    const xMin = viewport.xMin - xPad;
    const xMax = viewport.xMax + xPad;
    const yMin = viewport.yMin - yPad;
    const yMax = viewport.yMax + yPad;

    const start = this.dataset.lowerBoundX(xMin);
    const end = this.dataset.upperBoundX(xMax);
    if (end <= start) return 0;

    if (end - start <= maxPoints) {
      return this.copyVisiblePointRange(start, end, yMin, yMax, target, maxPoints, xOrigin);
    }

    const hasIntervalBounds = this.hasPointIntervalBounds();
    const fullRange = hasIntervalBounds ? this.pointIntervalMinMaxY(start, end) : null;
    if (fullRange && (fullRange.maxY < yMin || fullRange.minY > yMax)) return 0;

    if (end - start <= maxPoints * 4) {
      const exact = this.copyVisiblePointsExact(start, end, yMin, yMax, target, maxPoints, xOrigin);
      if (!exact.overflow) return exact.count;
    }

    const fullRangeInside = fullRange !== null && fullRange.minY >= yMin && fullRange.maxY <= yMax;
    return this.copyVisiblePointBuckets(viewport, start, end, yMin, yMax, target, maxPoints, xOrigin, fullRangeInside, hasIntervalBounds);
  }

  private copyVisiblePointRange(
    start: number,
    end: number,
    yMin: number,
    yMax: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
  ): number {
    let count = 0;
    for (let i = start; i < end && count < maxPoints; i++) {
      const y = this.dataset.getY(i);
      if (this.isGap(i, y) || y < yMin || y > yMax) continue;

      const offset = count * 2;
      target[offset] = this.dataset.getX(i) - xOrigin;
      target[offset + 1] = y;
      count++;
    }
    return count;
  }

  private copyVisiblePointBuckets(
    viewport: Viewport,
    start: number,
    end: number,
    yMin: number,
    yMax: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
    fullRangeInside: boolean,
    hasIntervalBounds: boolean,
  ): number {
    const bucketWidth = this.stableSampleBucketWidthForViewport(viewport, maxPoints);
    const alignedStart = this.alignBucketStart(start, bucketWidth);
    let count = 0;

    const writeIndex = (index: number): boolean => {
      const y = this.dataset.getY(index);
      if (this.isGap(index, y)) return false;
      const offset = count * 2;
      target[offset] = this.dataset.getX(index) - xOrigin;
      target[offset + 1] = y;
      count++;
      return true;
    };
    const writeRepresentative = (representative: number, from: number, to: number): void => {
      if (writeIndex(representative)) return;
      for (let i = from; i < to; i++) {
        if (writeIndex(i)) return;
      }
    };

    for (let bucketStart = alignedStart; bucketStart < end && count < maxPoints; bucketStart += bucketWidth) {
      const bucketEnd = Math.min(end, bucketStart + bucketWidth);
      const visibleStart = Math.max(start, bucketStart);
      if (bucketEnd <= visibleStart) continue;

      const representative = Math.max(
        visibleStart,
        Math.min(bucketEnd - 1, bucketStart + (bucketWidth >> 1)),
      );

      if (fullRangeInside) {
        writeRepresentative(representative, visibleStart, bucketEnd);
        continue;
      }

      const range = hasIntervalBounds && bucketEnd - visibleStart >= SCATTER_BUCKET_RANGE_PRUNE_SIZE
        ? this.pointIntervalMinMaxY(visibleStart, bucketEnd)
        : null;
      if (range && (range.maxY < yMin || range.minY > yMax)) continue;
      if (range && range.minY >= yMin && range.maxY <= yMax) {
        writeRepresentative(representative, visibleStart, bucketEnd);
        continue;
      }

      for (let i = visibleStart; i < bucketEnd; i++) {
        const y = this.dataset.getY(i);
        if (this.isGap(i, y) || y < yMin || y > yMax) continue;
        writeIndex(i);
        break;
      }
    }

    return count;
  }

  private estimatedVisibleSamplesForViewport(viewport: Viewport): number {
    const xSpan = viewport.xMax - viewport.xMin;
    const range = this.dataset.range;
    if (!range || this.dataset.length <= 1 || !(xSpan > 0)) return Math.max(1, this.dataset.length);

    const dataSpan = range.end - range.start;
    if (!(dataSpan > 0)) return Math.max(1, this.dataset.length);

    return Math.max(1, (xSpan / dataSpan) * (this.dataset.length - 1) + 1);
  }

  /**
   * First bucket start at or before `start`, aligned to absolute sample ordinals when the
   * dataset reports them (`Dataset.ordinalOffset`). Aligning to logical indexes instead
   * would move every bucket edge each time a full ring buffer drops its oldest sample.
   */
  private alignBucketStart(start: number, width: number): number {
    const ordinalOffset = this.dataset.ordinalOffset ?? 0;
    // Only the remainder is needed, which stays exact even for very large ordinals.
    return start - ((((start + ordinalOffset) % width) + width) % width);
  }

  private stableSampleBucketWidthForViewport(viewport: Viewport, maxPoints: number): number {
    return Math.max(1, Math.ceil(this.estimatedVisibleSamplesForViewport(viewport) / Math.max(1, maxPoints)));
  }

  private copyVisiblePointsExact(
    start: number,
    end: number,
    yMin: number,
    yMax: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
  ): { count: number; overflow: boolean } {
    let count = 0;
    let overflow = false;
    const hasIntervalBounds = this.hasPointIntervalBounds();

    const writePoint = (index: number): boolean => {
      const y = this.dataset.getY(index);
      if (this.isGap(index, y) || y < yMin || y > yMax) return true;
      if (count >= maxPoints) {
        overflow = true;
        return false;
      }

      const offset = count * 2;
      target[offset] = this.dataset.getX(index) - xOrigin;
      target[offset + 1] = y;
      count++;
      return true;
    };

    const visitInterval = (from: number, to: number): boolean => {
      if (to <= from) return true;

      const range = hasIntervalBounds ? this.pointIntervalMinMaxY(from, to) : null;
      if (range && (range.maxY < yMin || range.minY > yMax)) return true;
      if (to - from <= SCATTER_INTERVAL_LEAF_SIZE || !hasIntervalBounds) {
        for (let i = from; i < to; i++) {
          if (!writePoint(i)) return false;
        }
        return true;
      }

      const mid = from + ((to - from) >> 1);
      return visitInterval(from, mid) && visitInterval(mid, to);
    };

    visitInterval(start, end);
    return { count, overflow };
  }

  private copyVisibleSamples(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    layout: "points" | "area",
    baseline: number,
    xOrigin: number,
  ): number {
    if (hasCopyVisibleSamples(this.dataset)) {
      return this.dataset.copyVisibleSamples(viewport, target, maxPoints, layout, baseline, xOrigin);
    }

    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const start = this.dataset.lowerBoundX(viewport.xMin);
    const end = this.dataset.upperBoundX(viewport.xMax);
    if (end <= start) return 0;

    const stride = this.stableSampleBucketWidthForViewport(viewport, maxPoints);
    const alignedStart = this.alignBucketStart(start, stride);
    let count = 0;
    let lastIndex = -1;
    let lastWasGap = false;
    const writeGap = (): boolean => {
      if (count === 0 || lastWasGap) return true;
      if (count >= maxPoints) return false;
      const offset = count * floatsPerSample;
      for (let j = 0; j < floatsPerSample; j++) target[offset + j] = NaN;
      count++;
      lastWasGap = true;
      return true;
    };
    const writeSample = (index: number): boolean => {
      const x = this.dataset.getX(index) - xOrigin;
      const y = this.dataset.getY(index);
      if (this.isGap(index, y)) return writeGap();
      if (count >= maxPoints) return false;
      const offset = count * floatsPerSample;
      if (layout === "points") {
        target[offset] = x;
        target[offset + 1] = y;
      } else {
        target[offset] = x;
        target[offset + 1] = baseline;
        target[offset + 2] = x;
        target[offset + 3] = y;
      }
      count++;
      lastWasGap = false;
      return true;
    };

    for (let bucketStart = alignedStart; bucketStart < end; bucketStart += stride) {
      const bucketEnd = Math.min(end, bucketStart + stride);
      const index = Math.max(start, bucketStart);
      if (bucketEnd <= index) continue;
      if (lastIndex >= 0 && index > lastIndex + 1 && this.hasGapInRange(lastIndex + 1, index) && !writeGap()) break;
      if (!writeSample(index)) break;
      lastIndex = index;
    }

    return count;
  }

  private hasGapInRange(start: number, end: number): boolean {
    const from = Math.max(0, start);
    const to = Math.min(this.dataset.length, end);
    for (let i = from; i < to; i++) {
      if (this.isGap(i)) return true;
    }
    return false;
  }

  private copySampleRange(
    start: number,
    end: number,
    target: Float32Array,
    maxPoints: number,
    layout: "points" | "area",
    baseline: number,
    xOrigin: number,
  ): number {
    if (hasCopySamplesRange(this.dataset)) {
      return this.dataset.copySamplesRange(start, end, target, maxPoints, layout, baseline, xOrigin);
    }

    const floatsPerSample = layout === "points" ? 2 : 4;
    if (maxPoints <= 0 || target.length < maxPoints * floatsPerSample) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    const count = Math.min(maxPoints, Math.max(0, to - from));
    for (let i = 0; i < count; i++) {
      const index = from + i;
      const x = this.dataset.getX(index) - xOrigin;
      const y = this.dataset.getY(index);
      const gap = this.isGap(index, y);
      if (layout === "points") {
        const offset = i * 2;
        target[offset] = gap ? NaN : x;
        target[offset + 1] = gap ? NaN : y;
      } else {
        const offset = i * 4;
        target[offset] = gap ? NaN : x;
        target[offset + 1] = gap ? NaN : baseline;
        target[offset + 2] = gap ? NaN : x;
        target[offset + 3] = gap ? NaN : y;
      }
    }

    return count;
  }

  private minMaxForRange(start: number, end: number): MinMaxY | null {
    if (this.rangeMinMax) return this.rangeMinMax.rangeMinMaxY(start, end);
    if (this.pyramid && !this._useRawMinMaxScan) return this.pyramid.rangeMinMax(this.dataset, start, end);

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const y = this.dataset.getY(i);
      if (this.isGap(i, y)) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return minY <= maxY ? { minY, maxY } : null;
  }
}
