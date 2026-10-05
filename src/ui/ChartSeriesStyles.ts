import type { SeriesStore } from "../core/SeriesStore.js";
import type { RgbaColor, SeriesStyle, SeriesStyleOptions } from "../core/types.js";
import type { ChartAccessibility } from "./ChartAccessibility.js";
import { resolveSeriesStyle } from "./ChartConfig.js";

interface SeriesStyleState {
  options: SeriesStyleOptions;
  /** Theme palette slot the series follows; `null` once a color is pinned. */
  paletteIndex: number | null;
}

/** What the style manager needs from the chart. */
export interface ChartSeriesStylesHost {
  readonly series: () => readonly SeriesStore[];
  /** The caller palette, not the forced-colors one: forced styles are applied on top and undone later. */
  readonly palette: () => readonly RgbaColor[];
  readonly root: () => Element;
  readonly a11y: () => ChartAccessibility;
  readonly emitSeriesChange: () => void;
}

/**
 * Owns the caller's style options per series and resolves them against the theme palette: palette
 * slot assignment, `series.setStyle` merging, re-resolution on theme change, and forced-colors
 * bookkeeping (resolved styles are parked in `ChartAccessibility.originalStyles` while forced).
 */
export class ChartSeriesStyles {
  /** Caller style options per series, plus the theme palette slot it follows (`null` once a color is pinned). */
  private readonly state = new WeakMap<SeriesStore, SeriesStyleState>();

  constructor(private readonly host: ChartSeriesStylesHost) {}

  /** Remember the options a series was created with and the palette slot it took. */
  track(series: SeriesStore, style: SeriesStyleOptions, slot: number): void {
    this.state.set(series, { options: { ...style }, paletteIndex: style.color ? null : slot });
  }

  /** First theme palette slot no attached palette-colored series uses (the next slot in order when all are taken). */
  nextPaletteIndex(): number {
    const size = this.host.palette().length;
    const series = this.host.series();
    const used = new Set<number>();
    for (const item of series) {
      const slot = this.state.get(item)?.paletteIndex;
      if (slot !== null && slot !== undefined) used.add(slot);
    }
    for (let slot = 0; slot < size; slot++) if (!used.has(slot)) return slot;
    return series.length % size;
  }

  resolve(style: SeriesStyleOptions, paletteIndex: number): SeriesStyle {
    const palette = this.host.palette();
    return resolveSeriesStyle(style, palette[paletteIndex % palette.length]!, this.host.root());
  }

  /** Merge `options` into a series' style: pin an explicit color, resolve, and respect forced colors. */
  set(series: SeriesStore, options: SeriesStyleOptions): void {
    const state = this.state.get(series);
    if (!state) return;
    const merged: Record<string, unknown> = { ...state.options };
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) merged[key] = value;
    }
    state.options = merged as SeriesStyleOptions;
    if (options.color) state.paletteIndex = null;
    const resolved = this.resolve(state.options, state.paletteIndex ?? this.nextPaletteIndex());
    const a11y = this.host.a11y();
    if (a11y.forcedColorsActive || a11y.originalStyles.has(series)) {
      a11y.originalStyles.set(series, resolved);
      a11y.applyForcedSeriesStyles();
    } else {
      series.applyResolvedStyle(resolved);
    }
    this.host.emitSeriesChange();
  }

  /** Re-resolve every series style from its stored options, so palette-colored series follow the theme. */
  refresh(): void {
    const a11y = this.host.a11y();
    for (const series of this.host.series()) {
      const state = this.state.get(series);
      if (!state) continue;
      const resolved = this.resolve(state.options, state.paletteIndex ?? this.nextPaletteIndex());
      if (a11y.forcedColorsActive) a11y.originalStyles.set(series, resolved);
      else series.applyResolvedStyle(resolved);
    }
    if (!a11y.forcedColorsActive) a11y.originalStyles.clear();
  }
}
