/**
 * Time axis math: the tick interval ladder, flooring and advancing dates in local or UTC time, and
 * tick label formatting (patterns and the automatic two-level labels). Pure functions, no camera.
 */
/** Time zone used for built-in time tick formatting. */
export type AxisTimeZone = "local" | "utc";

export type TimeUnit = "millisecond" | "second" | "minute" | "hour" | "day" | "month" | "year";

export type TimeInterval = readonly [unit: TimeUnit, count: number, approxMs: number];

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const TIME_INTERVALS: readonly TimeInterval[] = [
  // Sub-millisecond steps (fractional ms): 100 ns up to 500 us.
  ["millisecond", 0.0001, 0.0001],
  ["millisecond", 0.0002, 0.0002],
  ["millisecond", 0.0005, 0.0005],
  ["millisecond", 0.001, 0.001],
  ["millisecond", 0.002, 0.002],
  ["millisecond", 0.005, 0.005],
  ["millisecond", 0.01, 0.01],
  ["millisecond", 0.02, 0.02],
  ["millisecond", 0.05, 0.05],
  ["millisecond", 0.1, 0.1],
  ["millisecond", 0.2, 0.2],
  ["millisecond", 0.5, 0.5],
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

/** Computes axis tick values and labels for a camera. */

export function chooseTimeInterval(rawStepMs: number): TimeInterval {
  for (const interval of TIME_INTERVALS) {
    if (interval[2] >= rawStepMs) return interval;
  }
  const years = Math.max(10, Math.ceil(rawStepMs / YEAR));
  const magnitude = 10 ** Math.floor(Math.log10(years));
  const normalized = years / magnitude;
  const count = normalized <= 1 ? magnitude : normalized <= 2 ? 2 * magnitude : normalized <= 5 ? 5 * magnitude : 10 * magnitude;
  return ["year", count, count * YEAR];
}

export function floorTime(value: number, interval: TimeInterval, timezone: AxisTimeZone): number {
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
      return makeTime(timezone, year, month, day, hour, minute, Math.floor(second / count) * count, 0);
    case "minute":
      return makeTime(timezone, year, month, day, hour, Math.floor(minute / count) * count, 0, 0);
    case "hour":
      return makeTime(timezone, year, month, day, Math.floor(hour / count) * count, 0, 0, 0);
    case "day":
      return makeTime(timezone, year, month, Math.floor((day - 1) / count) * count + 1, 0, 0, 0, 0);
    case "month":
      return makeTime(timezone, year, Math.floor(month / count) * count, 1, 0, 0, 0, 0);
    case "year":
      return makeTime(timezone, Math.floor(year / count) * count, 0, 1, 0, 0, 0, 0);
  }
}

export function advanceTime(value: number, interval: TimeInterval, timezone: AxisTimeZone): number {
  const date = new Date(value);
  const utc = timezone === "utc";
  const [unit, count] = interval;
  switch (unit) {
    case "millisecond":
      return value + count;
    case "second":
      return utc
        ? date.setUTCSeconds(date.getUTCSeconds() + count)
        : date.setSeconds(date.getSeconds() + count);
    case "minute":
      return utc
        ? date.setUTCMinutes(date.getUTCMinutes() + count)
        : date.setMinutes(date.getMinutes() + count);
    case "hour":
      return utc ? date.setUTCHours(date.getUTCHours() + count) : date.setHours(date.getHours() + count);
    case "day":
      return utc ? date.setUTCDate(date.getUTCDate() + count) : date.setDate(date.getDate() + count);
    case "month":
      return utc ? date.setUTCMonth(date.getUTCMonth() + count) : date.setMonth(date.getMonth() + count);
    case "year":
      return utc
        ? date.setUTCFullYear(date.getUTCFullYear() + count)
        : date.setFullYear(date.getFullYear() + count);
  }
}

export function makeTime(timezone: AxisTimeZone, year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number): number {
  return timezone === "utc"
    ? Date.UTC(year, month, day, hour, minute, second, millisecond)
    : new Date(year, month, day, hour, minute, second, millisecond).getTime();
}

export function formatTimeValue(value: number, tickFormat: string | undefined, timezone: AxisTimeZone, interval: TimeInterval | null, firstTick: number | null = null): string {
  const date = new Date(value);
  if (tickFormat) return formatTimePattern(date, tickFormat, timezone);

  const approxMs = interval?.[2] ?? 0;
  const utc = timezone === "utc";
  const isFirst = firstTick !== null && value === firstTick;
  const month = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const dayStart = hour === 0 && (utc ? date.getUTCMinutes() : date.getMinutes()) === 0 && (utc ? date.getUTCSeconds() : date.getSeconds()) === 0 && (utc ? date.getUTCMilliseconds() : date.getMilliseconds()) === 0;
  const yearStart = month === 0 && day === 1 && dayStart;
  // Two-level labels: the first tick and ticks crossing a larger boundary carry the larger unit.
  if (approxMs > 0 && approxMs < 1) {
    // Sub-millisecond: seconds with a fractional part, digits sized to the tick step.
    const decimals = Math.max(1, -Math.floor(Math.log10(approxMs) + 1e-9));
    const msInSecond = ((value % SECOND) + SECOND) % SECOND;
    const [whole = "0", part = ""] = msInSecond.toFixed(decimals).split(".");
    const carry = whole.length > 3; // rounded up to the next second
    const fraction = carry ? `000${part.replace(/\d/g, "0")}` : `${whole.padStart(3, "0")}${part}`;
    const wholeSecond = new Date(Math.floor(value / SECOND) * SECOND + (carry ? SECOND : 0));
    const prefix = isFirst || (dayStart && Number.isInteger(value)) ? "%b %d %H:%M:%S" : "%H:%M:%S";
    return `${formatTimePattern(wholeSecond, prefix, timezone)}.${fraction}`;
  }
  if (approxMs > 0 && approxMs < SECOND) {
    return formatTimePattern(date, isFirst || dayStart ? "%b %d %H:%M:%S.%L" : "%H:%M:%S.%L", timezone);
  }
  if (approxMs > 0 && approxMs < DAY) {
    if (yearStart) return formatTimePattern(date, "%Y-%m-%d", timezone);
    return formatTimePattern(date, isFirst || dayStart ? "%b %d %H:%M:%S" : "%H:%M:%S", timezone);
  }
  if (approxMs > 0 && approxMs < YEAR) {
    return formatTimePattern(date, isFirst || yearStart ? "%b %d %Y" : "%b %d", timezone);
  }
  return formatTimePattern(date, "%Y", timezone);
}

export function formatTimePattern(date: Date, pattern: string, timezone: AxisTimeZone): string {
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
