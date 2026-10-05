/**
 * Public viewport option and state types: `setViewport`/`pan`/`zoom` gesture options, data fitting, and
 * latest-X follow. A leaf module shared by `Chart`, the plugin contract, and the chart helpers.
 */
import type { SeriesYAxis } from "../core/types.js";
import type { SeriesStore } from "../core/SeriesStore.js";
/**
 * What changed the viewport: a user gesture (`"user"`, passed by the interaction, navigator, and
 * keyboard plugins), latest-X following (`"follow"`), `fitToData`/`autoFitY` (`"fit"`), a linked
 * chart mirroring another panel (`"linked"`), or app code (`"api"`, the default).
 */
export type ChartViewportChangeSource = "user" | "follow" | "fit" | "api" | "linked";

/** Options for `chart.pan` and `chart.zoom`. */
export interface ChartViewportGestureOptions {
  /** Reported as `viewportchange.source`. Defaults to `"api"`. */
  readonly source?: ChartViewportChangeSource;
}

/** Options for `chart.setViewport`. */
export interface ChartSetViewportOptions extends ChartViewportGestureOptions {
  /** Pause latest-X following when X changes. Defaults to true. Linked charts pass false for mirrored updates. */
  readonly pauseFollow?: boolean;
}

/** Fractional padding applied when fitting domains to data. */
export interface ChartFitToDataPadding {
  readonly x?: number;
  readonly y?: number;
}

/** Options for fitting the viewport to series data bounds. */
export interface ChartFitToDataOptions {
  readonly series?: readonly SeriesStore[];
  /** Include hidden series. Defaults to false. */
  readonly includeHidden?: boolean;
  /** Fit X. Defaults to true. */
  readonly x?: boolean;
  /** Fit Y. Defaults to true. */
  readonly y?: boolean;
  readonly yAxis?: SeriesYAxis | "both";
  readonly padding?: number | ChartFitToDataPadding;
  readonly includeZero?: boolean;
  /** Only consider samples at or after this X. */
  readonly xMin?: number;
  /** Only consider samples at or before this X. */
  readonly xMax?: number;
  /** Reported as `viewportchange.source`. Defaults to `"fit"`. */
  readonly source?: ChartViewportChangeSource;
}

/** Options for automatically refitting Y as the X viewport changes. */
export type ChartAutoFitYOptions = Pick<ChartFitToDataOptions, "series" | "includeHidden" | "yAxis" | "padding" | "includeZero">;

/** Options for keeping the X viewport anchored to the latest data. */
export interface ChartFollowXOptions {
  /** Visible X span. Defaults to the current span. */
  readonly window?: number;
  /** Pause following while the user pans or zooms. Defaults to true. */
  readonly pauseOnInteraction?: boolean;
  /** Resume automatically this many milliseconds after a pan/zoom interaction. */
  readonly resumeAfterMs?: number;
  /**
   * Optional live X clock for smooth scrolling streams. The follow window uses
   * the larger of the latest data X and `currentX()`, so time axes advance
   * continuously between batched updates.
   */
  readonly currentX?: () => number;
  readonly includeHidden?: boolean;
  readonly series?: readonly SeriesStore[];
}

/** Latest-X follow state: disabled, actively following, or paused by interaction. */
export type ChartFollowXState = "off" | "following" | "paused";

