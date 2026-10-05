/**
 * Public chart construction options: `ChartOptions`, axis/title configuration, accessibility options,
 * and screenshot options. Depends on the plugin contract, never the other way around.
 */
import type { BufferOverflowStrategy, Dataset, DownsampleStrategy, InvalidSample, SeriesYAxis, ValuePrecision } from "../core/types.js";
import type { HistogramOptions } from "../core/histogramBins.js";
import type { ChartSummary, ChartSummaryMessages } from "./ChartSummary.js";
import type { ChartRendererFactory, RendererChoice } from "../render/ChartRenderer.js";
import type { AxisScaleOptions } from "../interaction/AxisController.js";
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
  /** Horizontal shift from the default position, in CSS pixels (positive moves right). */
  readonly offsetXPx?: number;
  /** Vertical shift from the default position, in CSS pixels (positive moves down). */
  readonly offsetYPx?: number;
}

/** Chart title or subtitle text and alignment. */
export interface ChartTitleConfig extends TextOverlayConfig {
  readonly align?: "left" | "center" | "right";
}

/** Axis visibility, placement, scale, tick formatting, and title options. */
export interface AxisConfig extends AxisScaleOptions {
  /**
   * Whether the axis draws tick labels and its title. `{ visible: false }` hides them but keeps the
   * axis' scale, `tickFormat`, and range behavior (and still reserves no gutter). Passing `axes: { x: false }`
   * is the same as `{ x: { visible: false } }` with every other option at its default; use the object form
   * when the hidden axis still needs a scale such as `"time"` or `"log"`. Defaults to true.
   */
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

/** Options every series accepts, however its data is supplied. */
export interface SeriesIdentityConfig {
  /** Stable id, reported by `getSeriesState()`. Defaults to none. */
  readonly id?: string;
  /** Display name for legends, tooltips, and the accessible summary. */
  readonly name?: string;
  /** Which Y axis the series belongs to. Defaults to `"left"`. */
  readonly yAxis?: SeriesYAxis;
  /** Downsampling strategy for dense data. Defaults to min/max buckets for line, area, bar, and scatter series. */
  readonly downsample?: DownsampleStrategy;
}

/**
 * A series that draws a dataset you built: a `StaticDataset`, a ring buffer you keep a handle to,
 * a `HistogramDataset`, or a custom `Dataset`. The options that only apply to a buffer BlazePlot
 * creates (`capacity`, `xStep`, `xStart`, `overflow`, `valuePrecision`, `onInvalidSample`) are
 * rejected here, at compile time and at run time, instead of being silently ignored.
 */
export interface DatasetSeriesConfig<D extends Dataset = Dataset> extends SeriesIdentityConfig {
  /** The data to draw. */
  readonly dataset: D;
  readonly capacity?: never;
  readonly xStart?: never;
  readonly xStep?: never;
  readonly overflow?: never;
  readonly valuePrecision?: never;
  readonly onInvalidSample?: never;
}

/**
 * A streaming series backed by a `RingBuffer` that BlazePlot creates. Append `{ x, y }` samples
 * with finite, non-decreasing X. For evenly spaced samples use {@link UniformRingSeriesConfig}.
 */
export interface RingSeriesConfig extends SeriesIdentityConfig {
  /** Maximum number of retained samples. A positive integer. */
  readonly capacity: number;
  /** What happens when the buffer is full. Defaults to `"wrap"`: the oldest sample is dropped. */
  readonly overflow?: BufferOverflowStrategy;
  /** Y storage precision. Defaults to `"float32"`. */
  readonly valuePrecision?: ValuePrecision;
  /** Called for each sample skipped because its X is non-finite or goes backwards. See `RingBufferOptions.onInvalidSample`. */
  readonly onInvalidSample?: (sample: InvalidSample) => void;
  readonly dataset?: never;
  readonly xStart?: never;
  readonly xStep?: never;
}

/**
 * A streaming series backed by a `UniformRingBuffer` that BlazePlot creates: samples are evenly
 * spaced, so append `{ y }` only. X of sample `n` is `xStart + n * xStep`, in X data units. Give
 * `xStep`, `xStart`, or both.
 */
export type UniformRingSeriesConfig = SeriesIdentityConfig & {
  /** Maximum number of retained samples. A positive integer. */
  readonly capacity: number;
  /** Y storage precision. Defaults to `"float32"`. */
  readonly valuePrecision?: ValuePrecision;
  /** A uniform buffer always wraps, so `"wrap"` is the only accepted value. */
  readonly overflow?: "wrap";
  readonly onInvalidSample?: never;
  readonly dataset?: never;
} & (
  | {
    /** X distance between consecutive samples, in X data units: a positive number. Defaults to 1 when only `xStart` is given. */
    readonly xStep: number;
    /** X of the first sample, in X data units. Defaults to 0. */
    readonly xStart?: number;
  }
  | {
    readonly xStep?: number;
    readonly xStart: number;
  }
);

/**
 * Shorthand for the common case: X/Y arrays you already have. The chart wraps them in a
 * `StaticDataset` (the series handle is a `SeriesStore<StaticDataset>`, so `series.replace({ x, y })`
 * updates it). X must be finite and sorted ascending, or a `RangeError` names the first bad index;
 * for unsorted rows build the dataset yourself with `StaticDataset.sorted` or `StaticDataset.fromObjects`.
 * Non-finite Y is a gap. Both arrays are read once and must have the same length.
 */
export interface StaticSeriesConfig extends SeriesIdentityConfig {
  /** X values, in X data units (epoch milliseconds for a time axis), sorted ascending. */
  readonly x: ArrayLike<number>;
  /** Y values, one per X. */
  readonly y: ArrayLike<number>;
  readonly dataset?: never;
  readonly capacity?: never;
  readonly values?: never;
}

/**
 * Shorthand for a histogram: raw `values` are binned and drawn as bars, like
 * `dataset: HistogramDataset.from(values, options)`. Pick the bin layout with one of `binSize`
 * (bucket width in value units), `binCount`, or `thresholds`. Only `addBar` (and `addSeries` with
 * `mode: "bar"`) accept it.
 */
export interface HistogramSeriesConfig extends SeriesIdentityConfig, HistogramOptions {
  /** The one-dimensional values to count. Non-finite values are skipped and reported in `HistogramResult.invalid`. */
  readonly values: ArrayLike<number>;
  readonly dataset?: never;
  readonly capacity?: never;
  readonly x?: never;
}

/**
 * Series configuration used by the typed helpers such as `addLine`: an existing `dataset`
 * ({@link DatasetSeriesConfig}), `x`/`y` arrays ({@link StaticSeriesConfig}), or a `capacity` for a
 * chart-owned streaming buffer ({@link RingSeriesConfig}, or {@link UniformRingSeriesConfig} when
 * `xStep` or `xStart` is given). `addBar` also accepts raw `values` ({@link HistogramSeriesConfig}).
 */
export type TypedSeriesConfig<D extends Dataset = Dataset> = DatasetSeriesConfig<D> | StaticSeriesConfig | HistogramSeriesConfig | RingSeriesConfig | UniformRingSeriesConfig;

/** Options for exporting the chart as an image blob. */
export interface ChartScreenshotOptions {
  /** Image MIME type. Defaults to `"image/png"`. */
  readonly type?: string;
  /** Encoder quality from 0 to 1 for lossy types such as `"image/jpeg"`. */
  readonly quality?: number;
  /** CSS background color, or `null` for transparent. Defaults to the theme background. */
  readonly background?: string | null;
  /** Device pixels per CSS pixel of the output image. Defaults to `devicePixelRatio`. */
  readonly pixelRatio?: number;
  /** Output width in device pixels. Defaults to the chart's CSS width times `pixelRatio`. */
  readonly width?: number;
  /** Output height in device pixels. Defaults to the chart's CSS height times `pixelRatio`. */
  readonly height?: number;
}
