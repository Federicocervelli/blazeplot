import type { Camera2D } from "./Camera2D.js";
import type { Viewport } from "../core/types.js";
import { advanceTime, chooseTimeInterval, floorTime, formatTimePattern, formatTimeValue } from "./timeAxis.js";
import type { AxisTimeZone, TimeInterval } from "./timeAxis.js";


/**
 * Axis dimension targeted by axis helpers.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export type AxisRenderTarget = "x" | "y";
/** Built-in axis scale names. */
export type BuiltInAxisScale = "linear" | "time" | "log" | "symlog" | "categorical";

/**
 * Custom scale hooks for tick generation, formatting, and coordinate mapping.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface CustomAxisScale {
  readonly type: "custom";
  ticks?(min: number, max: number, maxTicks: number): readonly number[];
  formatTick?(value: number, axis: AxisRenderTarget): string;
  toScreen?(value: number): number;
  fromScreen?(value: number): number;
}

/** Built-in scale name or custom scale implementation. */
export type AxisScale = BuiltInAxisScale | CustomAxisScale;
/** Function form for formatting axis tick values. */
export type AxisTickFormatter = (value: number, axis: AxisRenderTarget) => string;
/** Built-in format string or custom tick formatter. */
export type AxisTickFormat = string | AxisTickFormatter;

/**
 * Scale and formatting options for one axis.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface AxisScaleOptions {
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
  readonly x?: AxisScaleOptions;
  readonly y?: AxisScaleOptions;
}

/** Whether two cached time intervals format identically (large year steps are fresh tuples). */
function sameInterval(a: TimeInterval | null, b: TimeInterval | null): boolean {
  return a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
}

export class AxisController {
  private options: AxisControllerOptions;
  private lastXTimeInterval: TimeInterval | null = null;
  private lastYTimeInterval: TimeInterval | null = null;
  private lastXStep: number | null = null;
  private lastYStep: number | null = null;
  private lastXFirstTick: number | null = null;
  private lastYFirstTick: number | null = null;
  private lastLinearStep: number | null = null;
  private generation = 0;

  /** Create an axis controller for a camera and optional scale settings. */
  constructor(private readonly camera: Camera2D, options: AxisControllerOptions = {}) {
    this.options = options;
  }

  /** Replace axis scale and formatting options. */
  setOptions(options: AxisControllerOptions): void {
    this.options = options;
    this.lastXTimeInterval = null;
    this.lastYTimeInterval = null;
    this.lastXStep = null;
    this.lastYStep = null;
    this.lastXFirstTick = null;
    this.lastYFirstTick = null;
    this.generation++;
  }

  /**
   * Bumped whenever `formatValue` could return a different string for the same value: options
   * replaced, or the cached tick step, time interval, or first tick changed. Overlays memoize on it.
   * @internal
   */
  get formatGeneration(): number {
    return this.generation;
  }

  /** Generate X-axis tick values for the current viewport. */
  getXTickValues(canvasWidth: number, maxTicks: number = 10, target: number[] = []): number[] {
    const axisOptions = this.options.x;
    if (axisOptions?.scale === "time") {
      const result = this.getTimeTickValues(this.camera.xMin, this.camera.xMax, canvasWidth, maxTicks, 80, target, axisOptions);
      const first = result[0] ?? null;
      if (!sameInterval(this.lastXTimeInterval, this.lastTimeInterval) || this.lastXFirstTick !== first) this.generation++;
      this.lastXTimeInterval = this.lastTimeInterval;
      this.lastXFirstTick = first;
      return result;
    }
    this.lastXTimeInterval = null;
    this.lastLinearStep = null;
    const ticks = this.getScaledTickValues(this.camera.xMin, this.camera.xMax, canvasWidth, maxTicks, 80, target, axisOptions, "x");
    if (this.lastXStep !== this.lastLinearStep) this.generation++;
    this.lastXStep = this.lastLinearStep;
    return ticks;
  }

  /** Generate Y-axis tick values for the current viewport. */
  getYTickValues(canvasHeight: number, maxTicks: number = 10, target: number[] = []): number[] {
    const axisOptions = this.options.y;
    if (axisOptions?.scale === "time") {
      const result = this.getTimeTickValues(this.camera.yMin, this.camera.yMax, canvasHeight, maxTicks, 48, target, axisOptions);
      const first = result[0] ?? null;
      if (!sameInterval(this.lastYTimeInterval, this.lastTimeInterval) || this.lastYFirstTick !== first) this.generation++;
      this.lastYTimeInterval = this.lastTimeInterval;
      this.lastYFirstTick = first;
      return result;
    }
    this.lastYTimeInterval = null;
    this.lastLinearStep = null;
    const ticks = this.getScaledTickValues(this.camera.yMin, this.camera.yMax, canvasHeight, maxTicks, 48, target, axisOptions, "y");
    if (this.lastYStep !== this.lastLinearStep) this.generation++;
    this.lastYStep = this.lastLinearStep;
    return ticks;
  }

  /** Throw when the current domain is invalid for the configured scale. */
  validateDomain(axis: AxisRenderTarget): void {
    const options = axis === "x" ? this.options.x : this.options.y;
    const min = axis === "x" ? this.camera.xMin : this.camera.yMin;
    const max = axis === "x" ? this.camera.xMax : this.camera.yMax;
    AxisController.validateAxisDomain(axis, min, max, options);
    const scaledMin = this.scaleValue(min, axis);
    const scaledMax = this.scaleValue(max, axis);
    if (!Number.isFinite(scaledMin) || !Number.isFinite(scaledMax) || scaledMax <= scaledMin) {
      throw new RangeError(`Axis ${axis} scale must map its domain to finite ascending values.`);
    }
  }

  /** Return whether an axis needs a non-linear coordinate transform. */
  isNonlinear(axis: AxisRenderTarget): boolean {
    const scale = (axis === "x" ? this.options.x : this.options.y)?.scale;
    return scale === "log" || scale === "symlog" || (typeof scale === "object" && typeof scale.toScreen === "function");
  }

  /** Whether `scaleValue` and `unscaleValue` return their input on this axis (anything but log, symlog, or a custom scale), so hot loops may skip them. @internal */
  isIdentityScale(axis: AxisRenderTarget): boolean {
    const scale = (axis === "x" ? this.options.x : this.options.y)?.scale;
    return scale === undefined || (typeof scale === "string" && scale !== "log" && scale !== "symlog");
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
    const min = axis === "x" ? this.camera.xMin : this.camera.yMin;
    const max = axis === "x" ? this.camera.xMax : this.camera.yMax;
    const scaledMin = this.scaleValue(min, axis);
    const scaledMax = this.scaleValue(max, axis);
    let normalized = (this.scaleValue(value, axis) - scaledMin) / (scaledMax - scaledMin);
    if (axis === "x" ? this.camera.xReversed : this.camera.yReversed) normalized = 1 - normalized;
    return normalized * 2 - 1;
  }

  /** Convert one clip-space coordinate back to a data value. */
  clipToValue(clip: number, axis: AxisRenderTarget): number {
    const min = axis === "x" ? this.camera.xMin : this.camera.yMin;
    const max = axis === "x" ? this.camera.xMax : this.camera.yMax;
    let normalized = (clip + 1) * 0.5;
    if (axis === "x" ? this.camera.xReversed : this.camera.yReversed) normalized = 1 - normalized;
    const scaledMin = this.scaleValue(min, axis);
    const scaledMax = this.scaleValue(max, axis);
    return this.unscaleValue(scaledMin + normalized * (scaledMax - scaledMin), axis);
  }

  /** Pan in scale space so logarithmic and custom axes move consistently; returns `false`, unchanged, when the result is unusable. */
  pan(intent: { readonly dx: number; readonly dy: number }): boolean {
    const xMin = this.scaleValue(this.camera.xMin, "x");
    const xMax = this.scaleValue(this.camera.xMax, "x");
    const yMin = this.scaleValue(this.camera.yMin, "y");
    const yMax = this.scaleValue(this.camera.yMax, "y");
    const dx = intent.dx * (xMax - xMin);
    const dy = intent.dy * (yMax - yMin);
    return this.trySetViewport(intent.dx !== 0, intent.dy !== 0, {
      xMin: this.unscaleValue(xMin + dx, "x"),
      xMax: this.unscaleValue(xMax + dx, "x"),
      yMin: this.unscaleValue(yMin + dy, "y"),
      yMax: this.unscaleValue(yMax + dy, "y"),
    });
  }

  /** Zoom in scale space around normalized data-domain anchors; returns `false`, unchanged, at the zoom limits. */
  zoom(intent: { readonly factor: number; readonly cx: number; readonly cy: number; readonly axis: "x" | "y" | "xy" }): boolean {
    if (!Number.isFinite(intent.factor) || intent.factor <= 0) throw new RangeError("Axis zoom factor must be > 0.");
    const xMin = this.scaleValue(this.camera.xMin, "x");
    const xMax = this.scaleValue(this.camera.xMax, "x");
    const yMin = this.scaleValue(this.camera.yMin, "y");
    const yMax = this.scaleValue(this.camera.yMax, "y");
    const xCenter = xMin + (xMax - xMin) * intent.cx;
    const yCenter = yMin + (yMax - yMin) * intent.cy;
    const xSpan = intent.axis === "y" ? xMax - xMin : (xMax - xMin) / intent.factor;
    const ySpan = intent.axis === "x" ? yMax - yMin : (yMax - yMin) / intent.factor;
    return this.trySetViewport(intent.axis !== "y", intent.axis !== "x", {
      xMin: this.unscaleValue(xCenter - xSpan * intent.cx, "x"),
      xMax: this.unscaleValue(xCenter + xSpan * (1 - intent.cx), "x"),
      yMin: this.unscaleValue(yCenter - ySpan * intent.cy, "y"),
      yMax: this.unscaleValue(yCenter + ySpan * (1 - intent.cy), "y"),
    });
  }

  /** Whether `[min, max]` is finite, ascending, and valid for the axis scale. */
  isValidDomain(axis: AxisRenderTarget, min: number, max: number): boolean {
    try {
      AxisController.validateAxisDomain(axis, min, max, axis === "x" ? this.options.x : this.options.y);
    } catch {
      return false;
    }
    const scaledMin = this.scaleValue(min, axis);
    const scaledMax = this.scaleValue(max, axis);
    return Number.isFinite(scaledMin) && Number.isFinite(scaledMax) && scaledMax > scaledMin;
  }

  /**
   * Apply a pan/zoom result only when both axes stay valid and each moved axis stays wider
   * than ~1e-13 of its magnitude, below which float64 collapses the range.
   */
  private trySetViewport(movesX: boolean, movesY: boolean, viewport: Viewport): boolean {
    const usable = (axis: AxisRenderTarget, moves: boolean, min: number, max: number): boolean =>
      (!moves || max - min > Math.max(Math.abs(min), Math.abs(max)) * 1e-13) && this.isValidDomain(axis, min, max);
    if (!usable("x", movesX, viewport.xMin, viewport.xMax) || !usable("y", movesY, viewport.yMin, viewport.yMax)) return false;
    this.camera.setViewport(viewport);
    return true;
  }

  private static validateAxisDomain(axis: AxisRenderTarget, min: number, max: number, options: AxisScaleOptions | undefined): void {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      throw new RangeError(`Axis ${axis} requires a finite domain with max > min.`);
    }
    const scale = options?.scale;
    if (scale === "log") {
      const base = options?.logBase ?? 10;
      if (!Number.isFinite(base) || base <= 1) throw new RangeError(`Axis ${axis} logBase must be > 1.`);
      if (min <= 0 || max <= 0) throw new RangeError(`Axis ${axis} log scale requires a positive domain.`);
    }
    if (scale === "symlog") {
      const constant = options?.symlogConstant ?? 1;
      if (!Number.isFinite(constant) || constant <= 0) throw new RangeError(`Axis ${axis} symlogConstant must be > 0.`);
    }
  }

  /** Format a tick value for the requested axis. */
  formatValue(value: number, axis: AxisRenderTarget = "y"): string {
    const axisOptions = axis === "x" ? this.options.x : this.options.y;
    const tickFormat = axisOptions?.tickFormat;
    if (typeof tickFormat === "function") return tickFormat(value, axis);

    if (axisOptions?.scale && typeof axisOptions.scale === "object") {
      return axisOptions.scale.formatTick?.(value, axis) ?? this.formatLinearValue(value, null);
    }

    if (axisOptions?.scale === "categorical") {
      const index = Math.round(value);
      return axisOptions.categories?.[index] ?? String(index);
    }

    if (axisOptions?.scale === "time") {
      const interval = axis === "x" ? this.lastXTimeInterval : this.lastYTimeInterval;
      const first = axis === "x" ? this.lastXFirstTick : this.lastYFirstTick;
      return formatTimeValue(value, tickFormat, axisOptions.timezone ?? "local", interval, first);
    }

    const step = axisOptions?.scale === "log" || axisOptions?.scale === "symlog" ? null : axis === "x" ? this.lastXStep : this.lastYStep;
    return this.formatLinearValue(value, step);
  }

  /**
   * Format a value for a readout (tooltip, crosshair label) instead of an axis tick. Time axes get a full
   * self-contained timestamp (the tick format string when one is set, else `%Y-%m-%d %H:%M:%S` plus `.%L`
   * when the value has milliseconds) and categorical axes get the category name; a function `tickFormat` is
   * used as-is. Returns `null` for numeric axes, where readouts print the number at their own precision.
   */
  formatReadout(value: number, axis: AxisRenderTarget = "y"): string | null {
    const axisOptions = axis === "x" ? this.options.x : this.options.y;
    if (axisOptions?.scale === "categorical") return this.formatValue(value, axis);
    if (axisOptions?.scale !== "time") return null;
    const tickFormat = axisOptions.tickFormat;
    if (typeof tickFormat === "function") return tickFormat(value, axis);
    const pattern = tickFormat ?? (value % 1000 === 0 ? "%Y-%m-%d %H:%M:%S" : "%Y-%m-%d %H:%M:%S.%L");
    return formatTimePattern(new Date(value), pattern, axisOptions.timezone ?? "local");
  }

  private lastTimeInterval: TimeInterval | null = null;

  private getScaledTickValues(
    min: number,
    max: number,
    pixelSize: number,
    maxTicks: number,
    minPixelSpacing: number,
    target: number[],
    options: AxisScaleOptions | undefined,
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
    if (target.filter((value) => value >= min && value <= max).length >= 2) return target;

    // Domain spanning fewer than two powers of the base: multiples per decade, inside the domain.
    const limit = Math.max(2, maxTicks);
    const lowExp = firstExp - 1;
    const highExp = lastExp + 1;
    for (const set of ["1 2 5", "1 1.5 2 3 4 5 6 7 8 9"]) {
      target.length = 0;
      for (let exp = lowExp; exp <= highExp; exp++) {
        for (const m of set.split(" ").map(Number)) {
          const value = Number((m * safeBase ** exp).toPrecision(12));
          if (m < safeBase && value >= min && value <= max) target.push(value);
        }
      }
      if (target.length >= 2) break;
    }
    if (target.length < 2) {
      // Very narrow domain: fall back to linear ticks, clipped to the domain.
      const linear = this.getLinearTickValues(min, max, pixelSize, limit, minPixelSpacing, []);
      target.length = 0;
      for (const value of linear) if (value >= min && value <= max) target.push(value);
      this.lastLinearStep = null;
    }
    if (target.length === 0) target.push(min, max);
    const stride = Math.ceil(target.length / limit);
    if (stride > 1) {
      let kept = 0;
      for (let i = 0; i < target.length; i += stride) target[kept++] = target[i]!;
      target.length = kept;
    }
    return target;
  }

  private getSymlogTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[], constant: number = 1): number[] {
    const c = Number.isFinite(constant) && constant > 0 ? constant : 1;
    const transform = (value: number): number => Math.sign(value) * Math.log1p(Math.abs(value) / c);
    const inverse = (value: number): number => Math.sign(value) * c * Math.expm1(Math.abs(value));
    const scaled = this.getLinearTickValues(transform(min), transform(max), pixelSize, maxTicks, minPixelSpacing, target);
    this.lastLinearStep = null;
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

  /**
   * Format a linear value. With a known tick `step`, precision follows the step so
   * adjacent ticks always read differently; without one it follows the magnitude.
   */
  private formatLinearValue(value: number, step: number | null): string {
    const abs = Math.abs(value);
    if (step !== null && step > 0 && Number.isFinite(step)) {
      if (abs < step * 1e-6) return "0";
      const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
      if (decimals <= 20 && abs < 1e21) return value.toFixed(decimals);
      return value.toExponential(Math.min(20, Math.max(2, Math.ceil(Math.log10(abs / step)))));
    }
    if (abs < 1e-12) return "0";
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
    if (!(step > 0 && step < Infinity)) return target;
    let firstIndex = Math.floor(min / step);
    let lastIndex = Math.ceil(max / step);

    for (let guard = 0; lastIndex - firstIndex + 1 > maxGeneratedTicks && guard < 2200; guard++) {
      step = this.nextNiceStep(step);
      firstIndex = Math.floor(min / step);
      lastIndex = Math.ceil(max / step);
    }

    if (!(lastIndex - firstIndex < maxGeneratedTicks)) return target;
    this.lastLinearStep = step;
    for (let index = firstIndex; index <= lastIndex; index++) target.push(this.normalizeTick(index * step, step));
    return target;
  }

  private getTimeTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[], options: AxisScaleOptions): number[] {
    AxisController.validateAxisDomain("x", min, max, options);
    target.length = 0;
    this.lastTimeInterval = null;
    if (pixelSize <= 0 || maxTicks <= 0) return target;

    const range = max - min;
    if (!Number.isFinite(range) || range <= 0) return target;

    const targetTicks = Math.max(2, Math.min(maxTicks, Math.floor(pixelSize / minPixelSpacing)));
    const interval = chooseTimeInterval(range / (targetTicks - 1));
    const timezone = options.timezone ?? "local";
    this.lastTimeInterval = interval;

    if (interval[1] < 1) {
      // Sub-millisecond: derive each tick from its integer index so error does not accumulate.
      const step = interval[1];
      const first = Math.ceil(min / step);
      const last = Math.floor(max / step);
      for (let index = first, i = 0; index <= last && i < maxTicks + 2; index++, i++) {
        target.push(Number((index * step).toFixed(6)));
      }
      if (target.length === 0) target.push(min, max);
      return target;
    }

    let tick = floorTime(min, interval, timezone);
    let guard = 0;
    while (tick < min && guard < 4) {
      const next = advanceTime(tick, interval, timezone);
      if (next <= tick) break;
      tick = next;
      guard++;
    }

    const lowerBound = floorTime(min, interval, timezone);
    if (lowerBound < tick && target.length === 0) tick = lowerBound;

    for (let i = 0; i < maxTicks + 2 && tick <= max; i++) {
      target.push(tick);
      const next = advanceTime(tick, interval, timezone);
      if (next <= tick) break;
      tick = next;
    }

    if (target.length === 0) target.push(min, max);
    return target;
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
    const normalized = Number(value.toFixed(Math.min(100, Math.max(0, 2 - Math.floor(Math.log10(step))))));
    return Object.is(normalized, -0) ? 0 : normalized;
  }
}
