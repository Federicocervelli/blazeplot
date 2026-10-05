/**
 * Public chart construction options: `ChartOptions`, axis/title configuration, accessibility options,
 * and screenshot options. Depends on the plugin contract, never the other way around.
 */
import type { SeriesConfig } from "../core/types.js";
import type { ChartSummary, ChartSummaryMessages } from "./ChartSummary.js";
import type { ChartRendererFactory, RendererChoice } from "../render/ChartRenderer.js";
import type { AxisControllerAxisOptions } from "../interaction/AxisController.js";
import type { ViewportPolicy } from "../interaction/ViewportPolicy.js";
import type { ChartTheme } from "./theme.js";
import type { ChartPlugin } from "./PluginTypes.js";
import type { ChartPickOptions } from "./ChartEvents.js";
import type { ChartAutoFitYOptions, ChartFollowXOptions } from "./ChartViewportTypes.js";

/** Whether an axis draws its tick labels inside the plot or in a gutter outside it. */
export type AxisPosition = "inside" | "outside";

/** Text and styling for an axis title. */
export interface TextOverlayConfig {
  readonly text: string;
  readonly color?: string;
  readonly font?: string;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

/** Chart title or subtitle text and alignment. */
export interface ChartTitleConfig extends TextOverlayConfig {
  readonly align?: "left" | "center" | "right";
}

/** Axis visibility, placement, scale, tick formatting, and title options. */
export interface AxisConfig extends AxisControllerAxisOptions {
  /** Hide tick labels while keeping the scale. Pass `false` instead of a config to hide an axis with default scale. */
  readonly visible?: boolean;
  readonly position?: AxisPosition;
  readonly title?: string | TextOverlayConfig;
  /**
   * Gutter size in CSS pixels for an `"outside"` axis, not counting room for the axis title.
   * Pass `"auto"` to size it from the widest (Y, Y2) or tallest (X) measured tick label; it
   * grows at once and shrinks only after the smaller size holds for about a second.
   * Defaults to 52 for Y and Y2 and 28 for X.
   */
  readonly size?: number | "auto";
}

/** Overridable core accessibility strings. Unset keys keep their English defaults. */
export interface ChartAccessibilityMessages {
  /** Accessible name when the chart has no title. Defaults to `"BlazePlot chart"`. */
  readonly defaultLabel?: string;
  /** Wording of the generated summary (`aria-describedby`). */
  readonly summary?: Partial<ChartSummaryMessages>;
}

/** ARIA and high-contrast options for the chart root. Keyboard pan and zoom come from `interactionsPlugin`. */
export interface ChartAccessibilityOptions {
  /** BCP 47 locale for counts in generated text. Defaults to `"en-US"`. */
  readonly locale?: string;
  /** Override the generated core strings, for localization. */
  readonly messages?: ChartAccessibilityMessages;
  /** Accessible name. Defaults to the chart title and subtitle, then `"BlazePlot chart"`. */
  readonly label?: string;
  /**
   * Description referenced by the root's `aria-describedby`. Omit it for a generated data summary
   * (series names, X and Y ranges, latest values) refreshed at most once a second while data
   * changes. Pass a string for fixed text, a function to word the `ChartSummary` yourself, or
   * `""` for no description.
   */
  readonly description?: string | ((summary: ChartSummary) => string);
  /** ARIA role for the chart root. Defaults to `"figure"`. */
  readonly role?: string;
  /**
   * Follow the operating system's forced-colors (high-contrast) mode: the canvas switches to
   * system colors and DOM overlays get forced-colors styles, updating when the mode changes.
   * Defaults to true.
   */
  readonly forcedColors?: boolean;
}

/** Render loop scheduling mode. */
export type ChartRenderLoop = "auto" | "continuous";

/** Constructor options for `Chart`. Boolean-or-object options accept `false` to disable and an object to configure. */
export interface ChartOptions {
  /** Hooks that constrain pan/zoom and adjust the camera before each render. */
  readonly viewportPolicy?: ViewportPolicy;
  /** Draw grid lines at axis ticks. Defaults to true; color comes from `theme.gridColor`. */
  readonly grid?: boolean;
  /** Axis configuration. `y2` is hidden unless configured. */
  readonly axes?: boolean | { x?: boolean | AxisConfig; y?: boolean | AxisConfig; y2?: boolean | AxisConfig };
  readonly title?: string | ChartTitleConfig;
  readonly subtitle?: string | ChartTitleConfig;
  /** Default pick behavior for hover state and pointer events. */
  readonly hover?: ChartPickOptions;
  /** ARIA attributes and keyboard navigation. Enabled by default. */
  readonly accessibility?: boolean | ChartAccessibilityOptions;
  /** Refit Y to the visible X range on every render. */
  readonly autoFitY?: boolean | ChartAutoFitYOptions;
  /** Keep the X viewport on the latest data. */
  readonly followX?: boolean | ChartFollowXOptions;
  /**
   * `"auto"` (default) renders once after `start()` and then only when chart
   * state changes. `"continuous"` renders every animation frame, for datasets
   * mutated outside BlazePlot.
   */
  readonly renderLoop?: ChartRenderLoop;
  /** Installed in this order when the chart is constructed; disposed in reverse order by `dispose()`. */
  readonly plugins?: readonly ChartPlugin[];
  /**
   * Chart theme. Defaults to the dark theme. `"auto"` follows the page's `prefers-color-scheme`
   * (the dark theme, or `LIGHT_CHART_THEME` when the user prefers light) and switches live when the
   * preference changes.
   */
  readonly theme?: ChartTheme | "auto";
  /**
   * Rendering engine. Defaults to `"auto"`: WebGL2, falling back to Canvas 2D when WebGL2 is
   * unavailable. `"webgl2"` and `"canvas2d"` are strict and throw `WebGL2UnavailableError` /
   * `Canvas2DUnavailableError` when the engine cannot start; `"shared"` draws through one
   * WebGL2 context shared by every chart on the document. A name is shorthand for its factory
   * (`webgl2Renderer()`, `canvas2dRenderer()`, `sharedRenderer()`, `autoRenderer()`), which also
   * accepts a render context from `createChartRenderContext()`. Read the outcome from
   * `chart.renderer` and `chart.rendererInfo`.
   */
  readonly renderer?: RendererChoice | ChartRendererFactory;
}

/** Series configuration used by typed helpers such as `addLine`. */
export type TypedSeriesConfig = Omit<SeriesConfig, "mode">;

/** Identity and axis options shared by series that build their own dataset. */
export type SeriesIdentityConfig = Pick<SeriesConfig, "id" | "name" | "yAxis" | "downsample">;

/** Options for exporting the chart as an image blob. */
export interface ChartScreenshotOptions {
  /** Image MIME type. Defaults to `"image/png"`. */
  readonly type?: string;
  readonly quality?: number;
  /** CSS background color, or `null` for transparent. Defaults to the theme background. */
  readonly background?: string | null;
  /** Output pixel ratio. Defaults to `devicePixelRatio`. */
  readonly dpr?: number;
  readonly width?: number;
  readonly height?: number;
}
