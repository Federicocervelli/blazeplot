import type { Camera2D } from "./Camera2D.js";

export type AxisRenderTarget = "x" | "y";
export type BuiltInAxisScale = "linear" | "time" | "log" | "symlog" | "categorical";

export interface CustomAxisScale {
  readonly type: "custom";
  ticks?(min: number, max: number, maxTicks: number): readonly number[];
  formatTick?(value: number, axis: AxisRenderTarget): string;
  toScreen?(value: number): number;
  fromScreen?(value: number): number;
}

export type AxisScale = BuiltInAxisScale | CustomAxisScale;
export type AxisTimeZone = "local" | "utc";
export type AxisTickFormatter = (value: number, axis: AxisRenderTarget) => string;
export type AxisTickFormat = string | AxisTickFormatter;

export interface AxisControllerAxisOptions {
  readonly scale?: AxisScale;
  readonly tickFormat?: AxisTickFormat;
  readonly timezone?: AxisTimeZone;
  readonly logBase?: number;
  readonly symlogConstant?: number;
  readonly categories?: readonly string[];
}

export interface AxisControllerOptions {
  readonly x?: AxisControllerAxisOptions;
  readonly y?: AxisControllerAxisOptions;
}

type TimeUnit = "millisecond" | "second" | "minute" | "hour" | "day" | "month" | "year";

interface TimeInterval {
  readonly unit: TimeUnit;
  readonly count: number;
  readonly approxMs: number;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const TIME_INTERVALS: readonly TimeInterval[] = [
  { unit: "millisecond", count: 1, approxMs: 1 },
  { unit: "millisecond", count: 5, approxMs: 5 },
  { unit: "millisecond", count: 10, approxMs: 10 },
  { unit: "millisecond", count: 50, approxMs: 50 },
  { unit: "millisecond", count: 100, approxMs: 100 },
  { unit: "millisecond", count: 250, approxMs: 250 },
  { unit: "millisecond", count: 500, approxMs: 500 },
  { unit: "second", count: 1, approxMs: SECOND },
  { unit: "second", count: 5, approxMs: 5 * SECOND },
  { unit: "second", count: 15, approxMs: 15 * SECOND },
  { unit: "second", count: 30, approxMs: 30 * SECOND },
  { unit: "minute", count: 1, approxMs: MINUTE },
  { unit: "minute", count: 5, approxMs: 5 * MINUTE },
  { unit: "minute", count: 15, approxMs: 15 * MINUTE },
  { unit: "minute", count: 30, approxMs: 30 * MINUTE },
  { unit: "hour", count: 1, approxMs: HOUR },
  { unit: "hour", count: 3, approxMs: 3 * HOUR },
  { unit: "hour", count: 6, approxMs: 6 * HOUR },
  { unit: "hour", count: 12, approxMs: 12 * HOUR },
  { unit: "day", count: 1, approxMs: DAY },
  { unit: "day", count: 2, approxMs: 2 * DAY },
  { unit: "day", count: 7, approxMs: 7 * DAY },
  { unit: "month", count: 1, approxMs: MONTH },
  { unit: "month", count: 3, approxMs: 3 * MONTH },
  { unit: "month", count: 6, approxMs: 6 * MONTH },
  { unit: "year", count: 1, approxMs: YEAR },
  { unit: "year", count: 2, approxMs: 2 * YEAR },
  { unit: "year", count: 5, approxMs: 5 * YEAR },
  { unit: "year", count: 10, approxMs: 10 * YEAR },
];

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export class AxisController {
  private options: AxisControllerOptions;
  private lastXTimeInterval: TimeInterval | null = null;
  private lastYTimeInterval: TimeInterval | null = null;

  constructor(private readonly camera: Camera2D, options: AxisControllerOptions = {}) {
    this.options = options;
  }

  setOptions(options: AxisControllerOptions): void {
    this.options = options;
    this.lastXTimeInterval = null;
    this.lastYTimeInterval = null;
  }

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
    void axis;
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
    const step = this.niceStep(range / (targetTicks - 1));
    const firstIndex = Math.floor(min / step);
    const lastIndex = Math.ceil(max / step);

    for (let index = firstIndex; index <= lastIndex && target.length < maxTicks + 2; index++) {
      target.push(this.normalizeTick(index * step, step));
    }

    return target;
  }

  private getTimeTickValues(min: number, max: number, pixelSize: number, maxTicks: number, minPixelSpacing: number, target: number[], options: AxisControllerAxisOptions): number[] {
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
      if (interval.approxMs >= rawStepMs) return interval;
    }
    const years = Math.max(10, Math.ceil(rawStepMs / YEAR));
    const magnitude = 10 ** Math.floor(Math.log10(years));
    const normalized = years / magnitude;
    const count = normalized <= 1 ? magnitude : normalized <= 2 ? 2 * magnitude : normalized <= 5 ? 5 * magnitude : 10 * magnitude;
    return { unit: "year", count, approxMs: count * YEAR };
  }

  private floorTime(value: number, interval: TimeInterval, timezone: AxisTimeZone): number {
    if (!Number.isFinite(value)) return value;
    if (interval.unit === "millisecond") return Math.floor(value / interval.count) * interval.count;

    const date = new Date(value);
    const utc = timezone === "utc";
    const year = utc ? date.getUTCFullYear() : date.getFullYear();
    const month = utc ? date.getUTCMonth() : date.getMonth();
    const day = utc ? date.getUTCDate() : date.getDate();
    const hour = utc ? date.getUTCHours() : date.getHours();
    const minute = utc ? date.getUTCMinutes() : date.getMinutes();
    const second = utc ? date.getUTCSeconds() : date.getSeconds();

    switch (interval.unit) {
      case "second":
        return this.makeTime(timezone, year, month, day, hour, minute, Math.floor(second / interval.count) * interval.count, 0);
      case "minute":
        return this.makeTime(timezone, year, month, day, hour, Math.floor(minute / interval.count) * interval.count, 0, 0);
      case "hour":
        return this.makeTime(timezone, year, month, day, Math.floor(hour / interval.count) * interval.count, 0, 0, 0);
      case "day":
        return this.makeTime(timezone, year, month, Math.floor((day - 1) / interval.count) * interval.count + 1, 0, 0, 0, 0);
      case "month":
        return this.makeTime(timezone, year, Math.floor(month / interval.count) * interval.count, 1, 0, 0, 0, 0);
      case "year":
        return this.makeTime(timezone, Math.floor(year / interval.count) * interval.count, 0, 1, 0, 0, 0, 0);
    }
  }

  private advanceTime(value: number, interval: TimeInterval, timezone: AxisTimeZone): number {
    const date = new Date(value);
    const utc = timezone === "utc";
    switch (interval.unit) {
      case "millisecond":
        return value + interval.count;
      case "second":
        utc ? date.setUTCSeconds(date.getUTCSeconds() + interval.count) : date.setSeconds(date.getSeconds() + interval.count);
        return date.getTime();
      case "minute":
        utc ? date.setUTCMinutes(date.getUTCMinutes() + interval.count) : date.setMinutes(date.getMinutes() + interval.count);
        return date.getTime();
      case "hour":
        utc ? date.setUTCHours(date.getUTCHours() + interval.count) : date.setHours(date.getHours() + interval.count);
        return date.getTime();
      case "day":
        utc ? date.setUTCDate(date.getUTCDate() + interval.count) : date.setDate(date.getDate() + interval.count);
        return date.getTime();
      case "month":
        utc ? date.setUTCMonth(date.getUTCMonth() + interval.count) : date.setMonth(date.getMonth() + interval.count);
        return date.getTime();
      case "year":
        utc ? date.setUTCFullYear(date.getUTCFullYear() + interval.count) : date.setFullYear(date.getFullYear() + interval.count);
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

    const approxMs = interval?.approxMs ?? 0;
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

  private normalizeTick(value: number, step: number): number {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2);
    const normalized = Number(value.toFixed(decimals));
    return Object.is(normalized, -0) ? 0 : normalized;
  }
}
