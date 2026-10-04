import type { Camera2D } from "./Camera2D.js";
import type { Viewport } from "../core/types.js";

/** Axis dimension targeted by axis helpers. */
export type AxisRenderTarget = "x" | "y";
/** Built-in axis scale names. */
export type BuiltInAxisScale = "linear" | "time" | "log" | "symlog" | "categorical";

/** Custom scale hooks for tick generation, formatting, and coordinate mapping. */
export interface CustomAxisScale {
  readonly type: "custom";
  ticks?(min: number, max: number, maxTicks: number): readonly number[];
  formatTick?(value: number, axis: AxisRenderTarget): string;
  toScreen?(value: number): number;
  fromScreen?(value: number): number;
}

/** Built-in scale name or custom scale implementation. */
export type AxisScale = BuiltInAxisScale | CustomAxisScale;
/** Time zone used for built-in time tick formatting. */
export type AxisTimeZone = "local" | "utc";
/** Function form for formatting axis tick values. */
export type AxisTickFormatter = (value: number, axis: AxisRenderTarget) => string;
/** Built-in format string or custom tick formatter. */
export type AxisTickFormat = string | AxisTickFormatter;

/** Scale and formatting options for one axis. */
export interface AxisControllerAxisOptions {
  readonly scale?: AxisScale;
  readonly tickFormat?: AxisTickFormat;
  readonly timezone?: AxisTimeZone;
  readonly logBase?: number;
  readonly symlogConstant?: number;
  readonly categories?: readonly string[];
  readonly reversed?: boolean;
}

/** Options for the X and Y axes controlled by an `AxisController`. */
export interface AxisControllerOptions {
  readonly x?: AxisControllerAxisOptions;
  readonly y?: AxisControllerAxisOptions;
}

type TimeUnit = "millisecond" | "second" | "minute" | "hour" | "day" | "month" | "year";

type TimeInterval = readonly [unit: TimeUnit, count: number, approxMs: number];

/** Maps a scale-space `[min, max]` domain to a new one. */
type DomainTransform = (min: number, max: number) => [number, number];

/** Widen `[min, max]` by `padding` × its span; a zero-width span first opens to a magnitude-based width. */
function padSpan(min: number, max: number, padding: number): [number, number] {
  let low = min;
  let high = max;
  if (high - low <= 0) {
    const halfSpan = Math.max(1, Math.abs(low)) * 0.5;
    low -= halfSpan;
    high += halfSpan;
  }
  const amount = (high - low) * padding;
  return [low - amount, high + amount];
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const TIME_INTERVALS: readonly TimeInterval[] = [
  ["millisecond", 1, 1],
  ["millisecond", 5, 5],
  ["millisecond", 10, 10],
  ["millisecond", 50, 50],
  ["millisecond", 100, 100],
  ["millisecond", 250, 250],
  ["millisecond", 500, 500],
  ["second", 1, SECOND],
  ["second", 5, 5 * SECOND],
  ["second", 15, 15 * SECOND],
  ["second", 30, 30 * SECOND],
  ["minute", 1, MINUTE],
  ["minute", 5, 5 * MINUTE],
  ["minute", 15, 15 * MINUTE],
  ["minute", 30, 30 * MINUTE],
  ["hour", 1, HOUR],
  ["hour", 3, 3 * HOUR],
  ["hour", 6, 6 * HOUR],
  ["hour", 12, 12 * HOUR],
  ["day", 1, DAY],
  ["day", 2, 2 * DAY],
  ["day", 7, 7 * DAY],
  ["month", 1, MONTH],
  ["month", 3, 3 * MONTH],
  ["month", 6, 6 * MONTH],
  ["year", 1, YEAR],
  ["year", 2, 2 * YEAR],
  ["year", 5, 5 * YEAR],
  ["year", 10, 10 * YEAR],
];

const MONTH_SHORT = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const MONTH_LONG = "January February March April May June July August September October November December".split(" ");
const WEEKDAY_SHORT = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
const WEEKDAY_LONG = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" ");

/**
 * Smallest span, relative to the domain's magnitude, that still leaves room for
 * distinct tick values. Doubles carry ~16 significant digits, so this keeps ~3.
 */
const MIN_RELATIVE_SPAN = 1e-13;

/** Computes axis tick values and labels for a camera. */
export class AxisController {
  private options: AxisControllerOptions;
  private lastXTimeInterval: TimeInterval | null = null;
  private lastYTimeInterval: TimeInterval | null = null;

  /** Create an axis controller for a camera and optional scale settings. */
  constructor(private readonly camera: Camera2D, options: AxisControllerOptions = {}) {
    this.options = options;
  }

  /** Replace axis scale and formatting options. */
  setOptions(options: AxisControllerOptions): void {
    this.options = options;
    this.lastXTimeInterval = null;
    this.lastYTimeInterval = null;
  }

  /** Generate X-axis tick values for the current viewport. */
  getXTickValues(canvasWidth: number, maxTicks: number = 10, target: number[] = []): number[] {
    const axisOptions = this.options.x;
    if (axisOptions?.scale === "time") {
      const result = this.getTimeTickValues(this.camera.xMin, this.camera.xMax, canvasWidth, maxTicks, 80, target, axisOptions);
      this.lastXTimeInterval = this.lastTimeInterval;
      return result;
    }
    this.lastXTimeInterval = null;
    return this.getScaledTickValues(this.camera.xMin, this.camera.xMax, canvasWidth, maxTicks, 80, target, axisOptions, "x");
  }

  /** Generate Y-axis tick values for the current viewport. */
  getYTickValues(canvasHeight: number, maxTicks: number = 10, target: number[] = []): number[] {
    const axisOptions = this.options.y;
    if (axisOptions?.scale === "time") {
      const result = this.getTimeTickValues(this.camera.yMin, this.camera.yMax, canvasHeight, maxTicks, 48, target, axisOptions);
      this.lastYTimeInterval = this.lastTimeInterval;
      return result;
    }
    this.lastYTimeInterval = null;
    return this.getScaledTickValues(this.camera.yMin, this.camera.yMax, canvasHeight, maxTicks, 48, target, axisOptions, "y");
  }

  /** Throw when the current domain is unusable for the configured scale. */
  validateDomain(axis: AxisRenderTarget): void {
    const error = this.currentDomainError(axis);
    if (error) throw new RangeError(error);
  }

  /** Why the current domain is unusable for the configured scale, or `null` when it is usable. */
  currentDomainError(axis: AxisRenderTarget): string | null {
    const [min, max] = this.cameraDomain(axis);
    return this.domainError(axis, min, max);
  }

  /** Return whether `[min, max]` is a usable domain for an axis's configured scale. */
  isValidDomain(axis: AxisRenderTarget, min: number, max: number): boolean {
    return this.domainError(axis, min, max) === null;
  }

  /**
   * Why `[min, max]` is unusable as an axis domain, or `null` when it is usable: finite and
   * ascending, valid for the scale, and wide enough for float64 math to resolve ticks.
   */
  private domainError(axis: AxisRenderTarget, min: number, max: number): string | null {
    const error = AxisController.axisDomainError(axis, min, max, axis === "x" ? this.options.x : this.options.y);
    if (error) return error;
    const span = max - min;
    if (span <= Math.max(Math.abs(min), Math.abs(max)) * MIN_RELATIVE_SPAN || !Number.isFinite(1 / span)) {
      return `Axis ${axis} span [${min}, ${max}] is too narrow to resolve at this magnitude.`;
    }
    const scaledMin = this.scaleValue(min, axis);
    const scaledMax = this.scaleValue(max, axis);
    if (!Number.isFinite(scaledMin) || !Number.isFinite(scaledMax) || scaledMax <= scaledMin) {
      return `Axis ${axis} scale must map its domain to finite ascending values.`;
    }
    return null;
  }

  /** Return whether an axis needs a non-linear coordinate transform. */
  isNonlinear(axis: AxisRenderTarget): boolean {
    const scale = (axis === "x" ? this.options.x : this.options.y)?.scale;
    return scale === "log" || scale === "symlog" || (typeof scale === "object" && typeof scale.toScreen === "function");
  }

  /** Map a data value into the configured scale's coordinate space. */
  scaleValue(value: number, axis: AxisRenderTarget): number {
    const options = axis === "x" ? this.options.x : this.options.y;
    const scale = options?.scale;
    if (scale === "log") return Math.log(value) / Math.log(options?.logBase ?? 10);
    if (scale === "symlog") {
      const constant = options?.symlogConstant ?? 1;
      return Math.sign(value) * Math.log1p(Math.abs(value) / constant);
    }
    if (scale && typeof scale === "object") return scale.toScreen?.(value) ?? value;
    return value;
  }

  /** Map a scale-space coordinate back to its data value. */
  unscaleValue(value: number, axis: AxisRenderTarget): number {
    const options = axis === "x" ? this.options.x : this.options.y;
    const scale = options?.scale;
    if (scale === "log") return (options?.logBase ?? 10) ** value;
    if (scale === "symlog") {
      const constant = options?.symlogConstant ?? 1;
      return Math.sign(value) * constant * Math.expm1(Math.abs(value));
    }
    if (scale && typeof scale === "object") {
      if (scale.toScreen && !scale.fromScreen) {
        throw new TypeError(`Axis ${axis} custom scale requires fromScreen() for pointer interaction.`);
      }
      return scale.fromScreen?.(value) ?? value;
    }
    return value;
  }

  /** Convert one data value to clip space using the configured scale and direction. */
  valueToClip(value: number, axis: AxisRenderTarget): number {
    const [min, max] = this.cameraDomain(axis);
    const scaledMin = this.scaleValue(min, axis);
    const scaledMax = this.scaleValue(max, axis);
    let normalized = (this.scaleValue(value, axis) - scaledMin) / (scaledMax - scaledMin);
    if (axis === "x" ? this.camera.xReversed : this.camera.yReversed) normalized = 1 - normalized;
    return normalized * 2 - 1;
  }

  /** Convert one clip-space coordinate back to a data value. */
  clipToValue(clip: number, axis: AxisRenderTarget): number {
    const [min, max] = this.cameraDomain(axis);
    let normalized = (clip + 1) * 0.5;
    if (axis === "x" ? this.camera.xReversed : this.camera.yReversed) normalized = 1 - normalized;
    const scaledMin = this.scaleValue(min, axis);
    const scaledMax = this.scaleValue(max, axis);
    return this.unscaleValue(scaledMin + normalized * (scaledMax - scaledMin), axis);
  }

  /**
   * The viewport a scale-space pan would produce, or `null` when it would be unusable.
   * `dx`/`dy` are fractions of the current span; an axis with zero delta keeps its exact domain.
   */
  panViewport(intent: { readonly dx: number; readonly dy: number }): Viewport | null {
    const shift = (delta: number) => (min: number, max: number): [number, number] => [min + delta * (max - min), max + delta * (max - min)];
    return this.transformViewport(intent.dx === 0 ? null : shift(intent.dx), intent.dy === 0 ? null : shift(intent.dy));
  }

  /** The viewport a scale-space zoom around normalized anchors would produce, or `null` at the zoom limits. */
  zoomViewport(intent: { readonly factor: number; readonly cx: number; readonly cy: number; readonly axis: "x" | "y" | "xy" }): Viewport | null {
    if (!Number.isFinite(intent.factor) || intent.factor <= 0) throw new RangeError("Axis zoom factor must be > 0.");
    const zoom = (anchor: number) => (min: number, max: number): [number, number] => {
      const center = min + (max - min) * anchor;
      const span = (max - min) / intent.factor;
      return [center - span * anchor, center + span * (1 - anchor)];
    };
    return this.transformViewport(intent.axis === "y" ? null : zoom(intent.cx), intent.axis === "x" ? null : zoom(intent.cy));
  }

  /**
   * Pad a data domain by `padding` × its span in scale space, so log and symlog axes pad
   * proportionally instead of past zero. Returns `null` when no usable domain results,
   * e.g. non-positive data or `includeZero` on a log axis.
   */
  paddedDomain(axis: AxisRenderTarget, min: number, max: number, padding: number, includeZero: boolean): [number, number] | null {
    const from = includeZero ? Math.min(0, min) : min;
    const to = includeZero ? Math.max(0, max) : max;
    // Custom scales without fromScreen() cannot map back, so they pad linearly.
    const scale = (axis === "x" ? this.options.x : this.options.y)?.scale;
    const mapsBack = typeof scale !== "object" || !scale.toScreen || typeof scale.fromScreen === "function";
    const [low, high] = padSpan(mapsBack ? this.scaleValue(from, axis) : from, mapsBack ? this.scaleValue(to, axis) : to, padding);
    const domainMin = mapsBack ? this.unscaleValue(low, axis) : low;
    const domainMax = mapsBack ? this.unscaleValue(high, axis) : high;
    return this.isValidDomain(axis, domainMin, domainMax) ? [domainMin, domainMax] : null;
  }

  /** Apply per-axis scale-space transforms (`null` keeps that axis); `null` when either result is unusable. */
  private transformViewport(x: DomainTransform | null, y: DomainTransform | null): Viewport | null {
    const xDomain = x ? this.transformDomain("x", x) : this.cameraDomain("x");
    const yDomain = y ? this.transformDomain("y", y) : this.cameraDomain("y");
    if (!xDomain || !yDomain) return null;
    return { xMin: xDomain[0], xMax: xDomain[1], yMin: yDomain[0], yMax: yDomain[1] };
  }

  private transformDomain(axis: AxisRenderTarget, transform: DomainTransform): [number, number] | null {
    const [currentMin, currentMax] = this.cameraDomain(axis);
    const [scaledMin, scaledMax] = transform(this.scaleValue(currentMin, axis), this.scaleValue(currentMax, axis));
    const min = this.unscaleValue(scaledMin, axis);
    const max = this.unscaleValue(scaledMax, axis);
    return this.isValidDomain(axis, min, max) ? [min, max] : null;
  }

  private cameraDomain(axis: AxisRenderTarget): [number, number] {
    return axis === "x" ? [this.camera.xMin, this.camera.xMax] : [this.camera.yMin, this.camera.yMax];
  }

  private static validateAxisDomain(axis: AxisRenderTarget, min: number, max: number, options: AxisControllerAxisOptions | undefined): void {
    const error = AxisController.axisDomainError(axis, min, max, options);
    if (error) throw new RangeError(error);
  }

  private static axisDomainError(axis: AxisRenderTarget, min: number, max: number, options: AxisControllerAxisOptions | undefined): string | null {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return `Axis ${axis} requires a finite domain with max > min.`;
    const scale = options?.scale;
    if (scale === "log") {
      const base = options?.logBase ?? 10;
      if (!Number.isFinite(base) || base <= 1) return `Axis ${axis} logBase must be > 1.`;
      if (min <= 0 || max <= 0) return `Axis ${axis} log scale requires a positive domain.`;
    }
    if (scale === "symlog") {
      const constant = options?.symlogConstant ?? 1;
      if (!Number.isFinite(constant) || constant <= 0) return `Axis ${axis} symlogConstant must be > 0.`;
    }
    return null;
  }

  /** Format a tick value for the requested axis. */
  formatValue(value: number, axis: AxisRenderTarget = "y"): string {
    const axisOptions = axis === "x" ? this.options.x : this.options.y;
    const tickFormat = axisOptions?.tickFormat;
    if (typeof tickFormat === "function") return tickFormat(value, axis);

    if (axisOptions?.scale && typeof axisOptions.scale === "object") {
      return axisOptions.scale.formatTick?.(value, axis) ?? this.formatLinearValue(value);
    }

    if (axisOptions?.scale === "categorical") {
      const index = Math.round(value);
      return axisOptions.categories?.[index] ?? String(index);
    }

    if (axisOptions?.scale === "time") {
      const interval = axis === "x" ? this.lastXTimeInterval : this.lastYTimeInterval;
      return this.formatTimeValue(value, tickFormat, axisOptions.timezone ?? "local", interval);
    }

    return this.formatLinearValue(value);
  }

  private lastTimeInterval: TimeInterval | null = null;

  private getScaledTickValues(
    min: number,
    max: number,
    pixelSize: number,
    maxTicks: number,
    minPixelSpacing: number,
    target: number[],
    options: AxisControllerAxisOptions | undefined,
    axis: AxisRenderTarget,
  ): number[] {
    AxisController.validateAxisDomain(axis, min, max, options);
    const scale = options?.scale;
    if (scale && typeof scale === "object") {
      target.length = 0;
      const values = scale.ticks?.(min, max, maxTicks) ?? [];
      for (const value of values) target.push(value);
      return target;
    }
    if (scale === "log") return this.getLogTickValues(min, max, pixelSize, maxTicks, minPixelSpacing, target, options?.logBase);
    if (scale === "categorical") return this.getCategoricalTickValues(min, max, maxTicks, target, options?.categories);
    if (scale === "symlog") return this.getSymlogTickValues(min, max, pixelSize, maxTicks, minPixelSpacing, target, options?.symlogConstant);
    return this.getLinearTickValues(min, max, pixelSize, maxTicks, minPixelSpacing, target);
  }

  private getLogTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[], base: number = 10): number[] {
    target.length = 0;
    const safeBase = Number.isFinite(base) && base > 1 ? base : 10;
    if (pixelSize <= 0 || maxTicks <= 0 || min <= 0 || max <= min) return target;
    const targetTicks = Math.max(2, Math.min(maxTicks, Math.floor(pixelSize / minPixelSpacing)));
    const firstExp = Math.floor(Math.log(min) / Math.log(safeBase));
    const lastExp = Math.ceil(Math.log(max) / Math.log(safeBase));
    const expStep = Math.max(1, Math.ceil((lastExp - firstExp) / Math.max(1, targetTicks - 1)));
    for (let exp = firstExp; exp <= lastExp && target.length < maxTicks + 2; exp += expStep) {
      const value = safeBase ** exp;
      if (value >= min / safeBase && value <= max * safeBase) target.push(value);
    }
    return target;
  }

  private getSymlogTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[], constant: number = 1): number[] {
    const c = Number.isFinite(constant) && constant > 0 ? constant : 1;
    const transform = (value: number): number => Math.sign(value) * Math.log1p(Math.abs(value) / c);
    const inverse = (value: number): number => Math.sign(value) * c * Math.expm1(Math.abs(value));
    const scaled = this.getLinearTickValues(transform(min), transform(max), pixelSize, maxTicks, minPixelSpacing, target);
    for (let i = 0; i < scaled.length; i++) scaled[i] = this.normalizeTick(inverse(scaled[i]!), Math.abs(inverse(scaled[1] ?? scaled[0] ?? 1) - inverse(scaled[0] ?? 0)) || 1);
    return scaled;
  }

  private getCategoricalTickValues(min: number, max: number, maxTicks: number, target: number[], categories: readonly string[] | undefined): number[] {
    target.length = 0;
    const lower = Math.max(0, Math.ceil(min));
    const upper = Math.min(categories ? categories.length - 1 : Math.floor(max), Math.floor(max));
    if (upper < lower || maxTicks <= 0) return target;
    const step = Math.max(1, Math.ceil((upper - lower + 1) / maxTicks));
    for (let index = lower; index <= upper && target.length < maxTicks; index += step) target.push(index);
    return target;
  }

  private formatLinearValue(value: number): string {
    if (Math.abs(value) < 1e-12) return "0";
    const abs = Math.abs(value);
    if (abs >= 1e6 || abs < 1e-3) return value.toExponential(2);
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(2);
  }

  private getLinearTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[]): number[] {
    target.length = 0;
    if (pixelSize <= 0 || maxTicks <= 0) return target;

    const range = max - min;
    if (!Number.isFinite(range) || range <= 0) return target;

    const targetTicks = Math.max(2, Math.min(maxTicks, Math.floor(pixelSize / minPixelSpacing)));
    const maxGeneratedTicks = maxTicks + 2;
    let step = this.niceStep(range / (targetTicks - 1));
    let firstIndex = Math.floor(min / step);
    let lastIndex = Math.ceil(max / step);

    while (lastIndex - firstIndex + 1 > maxGeneratedTicks) {
      step = this.nextNiceStep(step);
      firstIndex = Math.floor(min / step);
      lastIndex = Math.ceil(max / step);
    }

    for (let index = firstIndex; index <= lastIndex; index++) {
      target.push(this.normalizeTick(index * step, step));
    }

    if (target.length > maxGeneratedTicks) target.length = maxGeneratedTicks;

    return target;
  }

  private getTimeTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[], options: AxisControllerAxisOptions): number[] {
    AxisController.validateAxisDomain("x", min, max, options);
    target.length = 0;
    this.lastTimeInterval = null;
    if (pixelSize <= 0 || maxTicks <= 0) return target;

    const range = max - min;
    if (!Number.isFinite(range) || range <= 0) return target;

    const targetTicks = Math.max(2, Math.min(maxTicks, Math.floor(pixelSize / minPixelSpacing)));
    const interval = this.chooseTimeInterval(range / (targetTicks - 1));
    const timezone = options.timezone ?? "local";
    this.lastTimeInterval = interval;

    let tick = this.floorTime(min, interval, timezone);
    let guard = 0;
    while (tick < min && guard < 4) {
      const next = this.advanceTime(tick, interval, timezone);
      if (next <= tick) break;
      tick = next;
      guard++;
    }

    const lowerBound = this.floorTime(min, interval, timezone);
    if (lowerBound < tick && target.length === 0) tick = lowerBound;

    for (let i = 0; i < maxTicks + 2 && tick <= max; i++) {
      target.push(tick);
      const next = this.advanceTime(tick, interval, timezone);
      if (next <= tick) break;
      tick = next;
    }

    if (target.length === 0) target.push(min, max);
    return target;
  }

  private chooseTimeInterval(rawStepMs: number): TimeInterval {
    for (const interval of TIME_INTERVALS) {
      if (interval[2] >= rawStepMs) return interval;
    }
    const years = Math.max(10, Math.ceil(rawStepMs / YEAR));
    const magnitude = 10 ** Math.floor(Math.log10(years));
    const normalized = years / magnitude;
    const count = normalized <= 1 ? magnitude : normalized <= 2 ? 2 * magnitude : normalized <= 5 ? 5 * magnitude : 10 * magnitude;
    return ["year", count, count * YEAR];
  }

  private floorTime(value: number, interval: TimeInterval, timezone: AxisTimeZone): number {
    if (!Number.isFinite(value)) return value;
    const [unit, count] = interval;
    if (unit === "millisecond") return Math.floor(value / count) * count;

    const date = new Date(value);
    const utc = timezone === "utc";
    const year = utc ? date.getUTCFullYear() : date.getFullYear();
    const month = utc ? date.getUTCMonth() : date.getMonth();
    const day = utc ? date.getUTCDate() : date.getDate();
    const hour = utc ? date.getUTCHours() : date.getHours();
    const minute = utc ? date.getUTCMinutes() : date.getMinutes();
    const second = utc ? date.getUTCSeconds() : date.getSeconds();

    switch (unit) {
      case "second":
        return this.makeTime(timezone, year, month, day, hour, minute, Math.floor(second / count) * count, 0);
      case "minute":
        return this.makeTime(timezone, year, month, day, hour, Math.floor(minute / count) * count, 0, 0);
      case "hour":
        return this.makeTime(timezone, year, month, day, Math.floor(hour / count) * count, 0, 0, 0);
      case "day":
        return this.makeTime(timezone, year, month, Math.floor((day - 1) / count) * count + 1, 0, 0, 0, 0);
      case "month":
        return this.makeTime(timezone, year, Math.floor(month / count) * count, 1, 0, 0, 0, 0);
      case "year":
        return this.makeTime(timezone, Math.floor(year / count) * count, 0, 1, 0, 0, 0, 0);
    }
  }

  private advanceTime(value: number, interval: TimeInterval, timezone: AxisTimeZone): number {
    const date = new Date(value);
    const utc = timezone === "utc";
    const [unit, count] = interval;
    switch (unit) {
      case "millisecond":
        return value + count;
      case "second":
        utc ? date.setUTCSeconds(date.getUTCSeconds() + count) : date.setSeconds(date.getSeconds() + count);
        return date.getTime();
      case "minute":
        utc ? date.setUTCMinutes(date.getUTCMinutes() + count) : date.setMinutes(date.getMinutes() + count);
        return date.getTime();
      case "hour":
        utc ? date.setUTCHours(date.getUTCHours() + count) : date.setHours(date.getHours() + count);
        return date.getTime();
      case "day":
        utc ? date.setUTCDate(date.getUTCDate() + count) : date.setDate(date.getDate() + count);
        return date.getTime();
      case "month":
        utc ? date.setUTCMonth(date.getUTCMonth() + count) : date.setMonth(date.getMonth() + count);
        return date.getTime();
      case "year":
        utc ? date.setUTCFullYear(date.getUTCFullYear() + count) : date.setFullYear(date.getFullYear() + count);
        return date.getTime();
    }
  }

  private makeTime(timezone: AxisTimeZone, year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number): number {
    return timezone === "utc"
      ? Date.UTC(year, month, day, hour, minute, second, millisecond)
      : new Date(year, month, day, hour, minute, second, millisecond).getTime();
  }

  private formatTimeValue(value: number, tickFormat: string | undefined, timezone: AxisTimeZone, interval: TimeInterval | null): string {
    const date = new Date(value);
    if (tickFormat) return this.formatTimePattern(date, tickFormat, timezone);

    const approxMs = interval?.[2] ?? 0;
    if (approxMs > 0 && approxMs < SECOND) return this.formatTimePattern(date, "%H:%M:%S.%L", timezone);
    if (approxMs > 0 && approxMs < DAY) return this.formatTimePattern(date, "%H:%M:%S", timezone);
    if (approxMs > 0 && approxMs < YEAR) return this.formatTimePattern(date, "%b %d", timezone);
    return this.formatTimePattern(date, "%Y", timezone);
  }

  private formatTimePattern(date: Date, pattern: string, timezone: AxisTimeZone): string {
    const utc = timezone === "utc";
    const year = utc ? date.getUTCFullYear() : date.getFullYear();
    const month = utc ? date.getUTCMonth() : date.getMonth();
    const day = utc ? date.getUTCDate() : date.getDate();
    const weekday = utc ? date.getUTCDay() : date.getDay();
    const hour = utc ? date.getUTCHours() : date.getHours();
    const minute = utc ? date.getUTCMinutes() : date.getMinutes();
    const second = utc ? date.getUTCSeconds() : date.getSeconds();
    const millisecond = utc ? date.getUTCMilliseconds() : date.getMilliseconds();

    return pattern.replace(/%[YymdbBaAHMSL%]/g, (token) => {
      switch (token) {
        case "%Y": return String(year).padStart(4, "0");
        case "%y": return String(year % 100).padStart(2, "0");
        case "%m": return String(month + 1).padStart(2, "0");
        case "%d": return String(day).padStart(2, "0");
        case "%b": return MONTH_SHORT[month] ?? "";
        case "%B": return MONTH_LONG[month] ?? "";
        case "%a": return WEEKDAY_SHORT[weekday] ?? "";
        case "%A": return WEEKDAY_LONG[weekday] ?? "";
        case "%H": return String(hour).padStart(2, "0");
        case "%M": return String(minute).padStart(2, "0");
        case "%S": return String(second).padStart(2, "0");
        case "%L": return String(millisecond).padStart(3, "0");
        case "%%": return "%";
        default: return token;
      }
    });
  }

  private niceStep(rawStep: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;

    if (normalized <= 1.5) return magnitude;
    if (normalized <= 3) return 2 * magnitude;
    if (normalized <= 7) return 5 * magnitude;
    return 10 * magnitude;
  }

  private nextNiceStep(step: number): number {
    if (!Number.isFinite(step) || step <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(step));
    const normalized = step / magnitude;
    if (normalized < 2) return 2 * magnitude;
    if (normalized < 5) return 5 * magnitude;
    return 10 * magnitude;
  }

  private normalizeTick(value: number, step: number): number {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2);
    const normalized = Number(value.toFixed(decimals));
    return Object.is(normalized, -0) ? 0 : normalized;
  }
}
