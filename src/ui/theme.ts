/** RGBA color tuple with 0-1 channel values. */
export type RgbaColor = readonly [number, number, number, number];
/** CSS color string accepted by theme options. */
export type CssColor = string;
/** Color value accepted by chart theme options. */
export type ThemeColor = RgbaColor | CssColor;

/** Partial chart theme supplied by callers. */
export interface ChartTheme {
  readonly backgroundColor?: ThemeColor;
  readonly gridColor?: ThemeColor;
  readonly axisColor?: string;
  readonly axisFont?: string;
  readonly seriesColors?: readonly ThemeColor[];
  readonly tooltipBackgroundColor?: string;
  readonly tooltipTextColor?: string;
  readonly tooltipFont?: string;
  readonly legendBackgroundColor?: string;
  readonly legendBorderColor?: string;
  readonly legendTextColor?: string;
  readonly legendMutedTextColor?: string;
  readonly legendFont?: string;
  readonly titleColor?: string;
  readonly titleFont?: string;
  readonly subtitleColor?: string;
  readonly subtitleFont?: string;
  readonly axisTitleColor?: string;
  readonly axisTitleFont?: string;
}

/** Fully resolved chart theme with concrete RGBA values. */
export interface ResolvedChartTheme {
  readonly backgroundColor: RgbaColor;
  readonly backgroundCssColor: string;
  readonly gridColor: RgbaColor;
  readonly axisColor: string;
  readonly axisFont: string;
  readonly seriesColors: readonly RgbaColor[];
  readonly tooltipBackgroundColor: string;
  readonly tooltipTextColor: string;
  readonly tooltipFont: string;
  readonly legendBackgroundColor: string;
  readonly legendBorderColor: string;
  readonly legendTextColor: string;
  readonly legendMutedTextColor: string;
  readonly legendFont: string;
  readonly titleColor: string;
  readonly titleFont: string;
  readonly subtitleColor: string;
  readonly subtitleFont: string;
  readonly axisTitleColor: string;
  readonly axisTitleFont: string;
}

const DEFAULT_SERIES_COLORS: readonly RgbaColor[] = [
  [0.3, 0.6, 1.0, 1.0],
  [0.95, 0.35, 0.35, 1.0],
  [0.2, 0.8, 0.4, 0.9],
  [0.95, 0.72, 0.25, 1.0],
  [0.72, 0.45, 0.95, 1.0],
  [0.25, 0.85, 0.95, 1.0],
];

/** Default dark chart theme. */
export const DEFAULT_CHART_THEME: ResolvedChartTheme = {
  backgroundColor: [0.02, 0.02, 0.02, 1],
  backgroundCssColor: "rgba(5, 5, 5, 1)",
  gridColor: [0.22, 0.22, 0.22, 0.45],
  axisColor: "#d4d4d4",
  axisFont: "11px ui-monospace, monospace, sans-serif",
  seriesColors: DEFAULT_SERIES_COLORS,
  tooltipBackgroundColor: "rgba(10, 10, 10, 0.88)",
  tooltipTextColor: "#e5e5e5",
  tooltipFont: "11px/1.35 ui-monospace, monospace",
  legendBackgroundColor: "rgba(10, 10, 10, 0.88)",
  legendBorderColor: "transparent",
  legendTextColor: "#e5e5e5",
  legendMutedTextColor: "#888",
  legendFont: "11px/1.35 ui-monospace, monospace",
  titleColor: "#f8fafc",
  titleFont: "600 14px system-ui, sans-serif",
  subtitleColor: "#cbd5e1",
  subtitleFont: "12px system-ui, sans-serif",
  axisTitleColor: "#d4d4d4",
  axisTitleFont: "12px system-ui, sans-serif",
};

/** Merge a partial theme with defaults and resolve CSS colors. */
export function resolveChartTheme(theme: ChartTheme | undefined, context?: Element): ResolvedChartTheme {
  if (!theme) return DEFAULT_CHART_THEME;

  const backgroundColor = resolveThemeColor(theme.backgroundColor, DEFAULT_CHART_THEME.backgroundColor, context);
  const seriesColors = theme.seriesColors?.length
    ? theme.seriesColors.map((color, index) => resolveThemeColor(
      color,
      DEFAULT_CHART_THEME.seriesColors[index % DEFAULT_CHART_THEME.seriesColors.length]!,
      context,
    ))
    : DEFAULT_CHART_THEME.seriesColors;

  return {
    backgroundColor,
    backgroundCssColor: themeColorToCss(theme.backgroundColor, DEFAULT_CHART_THEME.backgroundCssColor),
    gridColor: resolveThemeColor(theme.gridColor, DEFAULT_CHART_THEME.gridColor, context),
    axisColor: theme.axisColor ?? DEFAULT_CHART_THEME.axisColor,
    axisFont: theme.axisFont ?? DEFAULT_CHART_THEME.axisFont,
    seriesColors,
    tooltipBackgroundColor: theme.tooltipBackgroundColor ?? DEFAULT_CHART_THEME.tooltipBackgroundColor,
    tooltipTextColor: theme.tooltipTextColor ?? DEFAULT_CHART_THEME.tooltipTextColor,
    tooltipFont: theme.tooltipFont ?? DEFAULT_CHART_THEME.tooltipFont,
    legendBackgroundColor: theme.legendBackgroundColor ?? DEFAULT_CHART_THEME.legendBackgroundColor,
    legendBorderColor: theme.legendBorderColor ?? DEFAULT_CHART_THEME.legendBorderColor,
    legendTextColor: theme.legendTextColor ?? DEFAULT_CHART_THEME.legendTextColor,
    legendMutedTextColor: theme.legendMutedTextColor ?? DEFAULT_CHART_THEME.legendMutedTextColor,
    legendFont: theme.legendFont ?? DEFAULT_CHART_THEME.legendFont,
    titleColor: theme.titleColor ?? DEFAULT_CHART_THEME.titleColor,
    titleFont: theme.titleFont ?? DEFAULT_CHART_THEME.titleFont,
    subtitleColor: theme.subtitleColor ?? DEFAULT_CHART_THEME.subtitleColor,
    subtitleFont: theme.subtitleFont ?? DEFAULT_CHART_THEME.subtitleFont,
    axisTitleColor: theme.axisTitleColor ?? DEFAULT_CHART_THEME.axisTitleColor,
    axisTitleFont: theme.axisTitleFont ?? DEFAULT_CHART_THEME.axisTitleFont,
  };
}

/** Resolve a theme color to an RGBA tuple. */
export function resolveThemeColor(color: ThemeColor | undefined, fallback: RgbaColor, context?: Element): RgbaColor {
  if (!color) return fallback;
  if (typeof color !== "string") return color;

  const resolved = resolveCssColor(color, context);
  const normalized = normalizeCanvasColor(resolved ?? color, context);
  return parseCssColor(resolved ?? color) ?? parseCssColor(normalized ?? "") ?? fallback;
}

/** Convert a theme color to a CSS color string. */
export function themeColorToCss(color: ThemeColor | undefined, fallback: string): string {
  if (!color) return fallback;
  return typeof color === "string" ? color : rgbaCss(color);
}

/** Convert a 0-1 RGBA tuple to an `rgba(...)` CSS string. */
export function rgbaCss(color: RgbaColor): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}

/** Resolve a CSS color to a computed RGB(A) string. */
export function resolveCssColor(color: string, context?: Element): string | null {
  const doc = context?.ownerDocument ?? globalThis.document;
  if (!doc?.documentElement || typeof getComputedStyle === "undefined") return null;

  const parent = context instanceof HTMLElement ? context : doc.documentElement;
  const el = doc.createElement("span");
  el.style.position = "absolute";
  el.style.visibility = "hidden";
  el.style.pointerEvents = "none";
  el.style.color = color;
  parent.appendChild(el);

  const resolved = getComputedStyle(el).color;
  el.remove();
  return resolved || null;
}

function parseCssColor(color: string): RgbaColor | null {
  const trimmed = color.trim();
  return parseRgbColor(trimmed) ?? parseSrgbColor(trimmed) ?? parseHexColor(trimmed);
}

function normalizeCanvasColor(color: string, context?: Element): string | null {
  const doc = context?.ownerDocument ?? globalThis.document;
  if (!doc?.createElement) return null;

  const canvas = doc.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const sentinel = "#010203";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = color;
  const normalized = String(ctx.fillStyle);
  return normalized === sentinel ? null : normalized;
}

function parseRgbColor(color: string): RgbaColor | null {
  const match = color.match(/^rgba?\((.*)\)$/i);
  if (!match) return null;

  const body = match[1]!.trim();
  const slashParts = body.split("/").map((part) => part.trim());
  const rgbPart = slashParts[0]!;
  const alphaPart = slashParts[1];
  const rgb = rgbPart.includes(",")
    ? rgbPart.split(",").map((part) => part.trim()).filter(Boolean)
    : rgbPart.split(/\s+/).filter(Boolean);

  if (rgb.length < 3) return null;
  const r = parseChannel(rgb[0]!, 255);
  const g = parseChannel(rgb[1]!, 255);
  const b = parseChannel(rgb[2]!, 255);
  const a = parseAlpha(alphaPart ?? (rgb.length > 3 ? rgb[3]! : undefined));
  if (r === null || g === null || b === null || a === null) return null;
  return [r, g, b, a];
}

function parseSrgbColor(color: string): RgbaColor | null {
  const match = color.match(/^color\(\s*srgb\s+(.+)\)$/i);
  if (!match) return null;

  const parts = match[1]!.split("/").map((part) => part.trim());
  const channels = parts[0]!.split(/\s+/).filter(Boolean);
  if (channels.length < 3) return null;

  const r = parseChannel(channels[0]!);
  const g = parseChannel(channels[1]!);
  const b = parseChannel(channels[2]!);
  const a = parseAlpha(parts[1]);
  if (r === null || g === null || b === null || a === null) return null;
  return [r, g, b, a];
}

function parseHexColor(color: string): RgbaColor | null {
  const value = color.startsWith("#") ? color.slice(1) : "";
  if (![3, 4, 6, 8].includes(value.length) || !/^[\da-f]+$/i.test(value)) return null;

  const expanded = value.length <= 4
    ? [...value].map((char) => char + char).join("")
    : value;
  const parsed = Number.parseInt(expanded, 16);
  if (!Number.isFinite(parsed)) return null;

  const r = ((parsed >> (expanded.length === 8 ? 24 : 16)) & 255) / 255;
  const g = ((parsed >> (expanded.length === 8 ? 16 : 8)) & 255) / 255;
  const b = ((parsed >> (expanded.length === 8 ? 8 : 0)) & 255) / 255;
  const a = expanded.length === 8 ? (parsed & 255) / 255 : 1;
  return [r, g, b, a];
}

function parseChannel(value: string, divisor: number = 1): number | null {
  const number = Number.parseFloat(value);
  return clamp01(value.endsWith("%") ? number / 100 : number / divisor);
}

function parseAlpha(value: string | undefined): number | null {
  return value ? parseChannel(value) : 1;
}

function clamp01(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}
