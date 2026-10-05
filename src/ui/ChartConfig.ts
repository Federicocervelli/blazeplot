import type { RgbaColor, SeriesStyle, SeriesStyleOptions } from "../core/types.js";
import type { AxisController, AxisControllerAxisOptions } from "../interaction/AxisController.js";
import type { NormalizedAxisConfig } from "./ChartLayout.js";
import { resolveThemeColor } from "./theme.js";
import type { AxisConfig, ChartFitToDataPadding, ChartOptions, TextOverlayConfig } from "./ChartTypes.js";

/** Copy of `color` with its alpha multiplied by `factor`. */
export function withAlpha(color: RgbaColor, factor: number): RgbaColor {
  return [color[0], color[1], color[2], color[3] * factor];
}

export type ResolvedAxisConfig = NormalizedAxisConfig & AxisControllerAxisOptions & { readonly title?: string | TextOverlayConfig };

export type ResolvedAxesConfig = { x: ResolvedAxisConfig; y: ResolvedAxisConfig; y2: ResolvedAxisConfig };


export function normalizeAxisConfig(config: boolean | AxisConfig | undefined, defaultVisible: boolean): ResolvedAxisConfig {
  if (config === undefined) return { visible: defaultVisible, position: "outside" };
  if (typeof config === "boolean") return { visible: config, position: "outside" };
  return { ...config, visible: config.visible !== false, position: config.position ?? "outside" };
}

export function normalizeAxesConfig(axes: ChartOptions["axes"]): ResolvedAxesConfig {
  if (typeof axes === "boolean") {
    return { x: normalizeAxisConfig(axes, axes), y: normalizeAxisConfig(axes, axes), y2: normalizeAxisConfig(false, false) };
  }
  return {
    x: normalizeAxisConfig(axes?.x, true),
    y: normalizeAxisConfig(axes?.y, true),
    y2: normalizeAxisConfig(axes?.y2, false),
  };
}

export function normalizeFitPadding(padding: number | ChartFitToDataPadding | undefined): Required<ChartFitToDataPadding> {
  const clean = (value: number | undefined): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  return typeof padding === "number" ? { x: clean(padding), y: clean(padding) } : { x: clean(padding?.x), y: clean(padding?.y) };
}

export function domainsAlmostEqual(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  const scale = Math.max(1, Math.abs(aMax - aMin), Math.abs(bMax - bMin));
  const epsilon = scale * 1e-9;
  return Math.abs(aMin - bMin) <= epsilon && Math.abs(aMax - bMax) <= epsilon;
}

/** Pad a fit domain in the axis's scale space, so log axes stay positive; `null` when no usable domain results. */
export function paddedAxisDomain(controller: AxisController, axis: "x" | "y", min: number, max: number, padding: number, includeZero: boolean): { min: number; max: number } | null {
  let domain = paddedDomain(min, max, padding, includeZero);
  if (controller.isNonlinear(axis)) {
    try {
      const from = includeZero ? Math.min(0, min) : min;
      const to = includeZero ? Math.max(0, max) : max;
      const scaled = paddedDomain(controller.scaleValue(from, axis), controller.scaleValue(to, axis), padding, false);
      domain = { min: controller.unscaleValue(scaled.min, axis), max: controller.unscaleValue(scaled.max, axis) };
    } catch {
      // Custom scales without fromScreen() cannot map back; keep the linear padding.
    }
  }
  return controller.isValidDomain(axis, domain.min, domain.max) ? domain : null;
}

export function paddedDomain(min: number, max: number, padding: number, includeZero: boolean): { min: number; max: number } {
  let nextMin = includeZero ? Math.min(0, min) : min;
  let nextMax = includeZero ? Math.max(0, max) : max;
  let span = nextMax - nextMin;
  if (span <= 0) {
    const halfSpan = Math.max(1, Math.abs(nextMin)) * 0.5;
    nextMin -= halfSpan;
    nextMax += halfSpan;
    span = nextMax - nextMin;
  }
  const amount = span * padding;
  return { min: nextMin - amount, max: nextMax + amount };
}


/** Fill every `SeriesStyle` field from caller options, a theme palette fallback color, and defaults. */
export function resolveSeriesStyle(style: SeriesStyleOptions, fallbackColor: RgbaColor, root: Element): SeriesStyle {
  const color = resolveThemeColor(style.color, fallbackColor, root);
  const fillColor = resolveThemeColor(style.fillColor, withAlpha(color, 0.25), root);
  const barWidth = style.barWidth ?? 0.8;
  return {
    color,
    lineWidth: style.lineWidth ?? 1,
    pointSize: style.pointSize ?? 4,
    barWidth,
    baseline: style.baseline ?? 0,
    fillColor,
    tickWidth: style.tickWidth ?? barWidth,
    upColor: resolveThemeColor(style.upColor, color, root),
    downColor: resolveThemeColor(style.downColor, style.fillColor === undefined ? withAlpha(color, 0.45) : fillColor, root),
    wickColor: resolveThemeColor(style.wickColor, color, root),
  };
}
