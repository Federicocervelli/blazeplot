// Chart
export { Chart } from "./ui/Chart.js";
export type {
  AxisConfig,
  ChartAccessibilityOptions,
  ChartAutoFitYOptions,
  ChartEventMap,
  ChartEventName,
  ChartFitToDataOptions,
  ChartFitToDataPadding,
  ChartFollowXOptions,
  ChartFrameStats,
  ChartHoverState,
  ChartKeyboardOptions,
  ChartOptions,
  ChartPickGroup,
  ChartPickItem,
  ChartPickMode,
  ChartPickOptions,
  ChartPointerEventState,
  ChartPointerEventType,
  ChartRenderLoop,
  ChartScreenshotOptions,
  ChartSelectEvent,
  ChartSeriesClickEvent,
  ChartSeriesState,
  ChartTitleConfig,
  ChartViewportChangeEvent,
  ChartXFollowState,
  HistogramSeriesConfig,
  PrecomputedHistogramSeriesConfig,
  SeriesIdentityConfig,
  TextOverlayConfig,
  TypedSeriesConfig,
} from "./ui/Chart.js";
export type { AxisPosition } from "./ui/ChartLayout.js";

// Plugin contract
export type {
  ChartLayoutReservation,
  ChartMountSlot,
  ChartPlotSize,
  ChartPlugin,
  ChartPluginContext,
  ChartPluginCoords,
  ChartPluginDom,
  ChartPluginEventMap,
  ChartPluginEventName,
  ChartPluginEvents,
  ChartPluginHandle,
  ChartPluginLayout,
  ChartPluginState,
  ChartPluginUnstable,
  ChartPluginViewport,
  ChartRect,
  ChartSurface,
  ChartSurfaceDecoration,
  ChartSurfaceStyle,
} from "./ui/PluginHost.js";
export { DEFAULT_CHART_THEME } from "./ui/theme.js";
export type { ChartTheme, ResolvedChartTheme } from "./ui/theme.js";

// Series handle and data contracts
export type { SeriesStore } from "./core/SeriesStore.js";
export type {
  SeriesAppendData,
  SeriesAppendRow,
  SeriesDataBoundsOptions,
  SeriesObjectAppendData,
  SeriesOhlcAppendData,
  SeriesOhlcAppendRow,
  SeriesOhlcSample,
  SeriesOhlcUpdateData,
  SeriesReplaceData,
  SeriesScalarOrArray,
  SeriesUpdateData,
  SeriesXYAppendData,
  SeriesXYAppendRow,
  SeriesXYUpdateData,
} from "./core/SeriesStore.js";
export type {
  AcceleratedDataset,
  AppendableDataset,
  BufferOverflowStrategy,
  Dataset,
  InvalidOhlcSample,
  InvalidSample,
  InvalidSampleReason,
  LODStrategy,
  MinMaxSegmentCopyDataset,
  OhlcDataset,
  RangeMinMaxDataset,
  RangeSampleCopyDataset,
  RgbaColor,
  SampleCopyLayout,
  SeriesConfig,
  SeriesMode,
  SeriesSample,
  SeriesStyle,
  SeriesStyleOptions,
  SeriesYAxis,
  ThemeColor,
  TimeRange,
  UpdatableDataset,
  ValuePrecision,
  Viewport,
  VisiblePointCopyDataset,
  VisibleSampleCopyDataset,
  XRange,
  XRangeDataset,
  YAppendableDataset,
  YUpdatableDataset,
} from "./core/types.js";

// Datasets
export type { MinMaxY } from "./core/MinMaxTree.js";
export { RingBuffer } from "./core/RingBuffer.js";
export type { RingBufferOptions } from "./core/RingBuffer.js";
export { UniformRingBuffer } from "./core/UniformRingBuffer.js";
export type { UniformRingBufferOptions } from "./core/UniformRingBuffer.js";
export { StaticDataset } from "./core/StaticDataset.js";
export type { StaticDatasetData, StaticDatasetField, StaticDatasetFromObjectsOptions, StaticDatasetOptions, StaticDatasetSortedOptions } from "./core/StaticDataset.js";
export { OhlcRingBuffer, StaticOhlcDataset } from "./core/OhlcDataset.js";
export type { OhlcRingBufferOptions, StaticOhlcDatasetOptions, StaticOhlcDatasetSortedOptions } from "./core/OhlcDataset.js";
export { ServerSampledDataset } from "./core/ServerSampledDataset.js";
export type { ServerSampledBuckets, ServerSampledData, ServerSampledPoints } from "./core/ServerSampledDataset.js";
export { HistogramDataset, histogram } from "./core/Histogram.js";
export type { HistogramBin, HistogramNormalization, HistogramOptions, HistogramResult } from "./core/Histogram.js";

// Viewport and axes
export type { Camera2D } from "./interaction/Camera2D.js";
export type { PanIntent, ViewportPolicy, ZoomAxis, ZoomIntent } from "./interaction/types.js";
export type { AxisControllerAxisOptions, AxisRenderTarget, AxisScale, AxisTickFormat, AxisTickFormatter, AxisTimeZone, BuiltInAxisScale, CustomAxisScale } from "./interaction/AxisController.js";

// WebGL2 support detection
export { isWebGL2Available, WebGL2UnavailableError } from "./render/WebGL2Backend.js";
