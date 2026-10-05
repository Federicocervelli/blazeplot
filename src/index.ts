// Chart
export { Chart } from "./ui/Chart.js";
export type {
  AxisConfig,
  ChartAccessibilityMessages,
  ChartAccessibilityOptions,
  ChartAutoFitYOptions,
  ChartEventMap,
  ChartEventName,
  ChartFitToDataOptions,
  ChartFitToDataPadding,
  ChartFollowXOptions,
  ChartFollowXState,
  ChartFrameStats,
  ChartHoverState,
  ChartInspectionTarget,
  ChartOptions,
  ChartPickGroup,
  ChartPickItem,
  ChartPickMode,
  ChartPickOptions,
  ChartPointerEvent,
  ChartPointerEventType,
  ChartRenderLoop,
  ChartScreenshotOptions,
  ChartSelectEvent,
  ChartSeriesClickEvent,
  ChartSeriesState,
  ChartTitleConfig,
  ChartFollowXChangeEvent,
  ChartSetViewportOptions,
  ChartViewportChangeEvent,
  ChartViewportChangeSource,
  ChartViewportGestureOptions,
  DatasetSeriesConfig,
  HistogramSeriesConfig,
  StaticSeriesConfig,
  RingSeriesConfig,
  SeriesIdentityConfig,
  UniformRingSeriesConfig,
  TextOverlayConfig,
  TypedSeriesConfig,
} from "./ui/Chart.js";
export type { AxisPosition } from "./ui/ChartOptions.js";
export type { ChartSeriesSummary, ChartSummary, ChartSummaryMessages, ChartSummaryRange } from "./ui/ChartSummary.js";

// Plugin contract
export type { ChartPluginEventMap, ChartPluginEventName } from "./ui/ChartEvents.js";
export type {
  ChartLayoutReservation,
  ChartMountSlot,
  ChartPlotSize,
  ChartPlugin,
  ChartPluginContext,
  ChartPluginCoords,
  ChartPluginDom,
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
} from "./ui/PluginTypes.js";
export { DEFAULT_CHART_THEME, LIGHT_CHART_THEME } from "./ui/theme.js";
export type { ChartTheme, ResolvedChartTheme } from "./ui/theme.js";

// Series handle and data contracts
export type { SeriesStore } from "./core/SeriesStore.js";
export type { SeriesDataBoundsOptions, SeriesOhlcSample } from "./core/SeriesStore.js";
export type {
  SeriesAppendData,
  SeriesAppendFor,
  SeriesAppendRow,
  SeriesObjectAppendData,
  SeriesOhlcAppendData,
  SeriesOhlcAppendRow,
  SeriesOhlcUpdateData,
  SeriesReplaceData,
  SeriesScalarOrArray,
  SeriesUpdateData,
  SeriesUpdateFor,
  SeriesXYExplicitAppendData,
  SeriesYAppendData,
  SeriesYUpdateData,
  SeriesXYAppendData,
  SeriesXYAppendRow,
  SeriesXYUpdateData,
} from "./core/SeriesInput.js";
export type {
  AcceleratedDataset,
  AppendableDataset,
  BufferOverflowStrategy,
  Dataset,
  DownsampleStrategy,
  InvalidOhlcSample,
  InvalidSample,
  InvalidSampleReason,
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
export { HistogramDataset } from "./core/Histogram.js";
export type { HistogramBin, HistogramNormalization, HistogramOptions, HistogramResult } from "./core/histogramBins.js";

// Viewport and axes
export type { Camera2D } from "./interaction/Camera2D.js";
export type { PanIntent, ZoomAxis, ZoomIntent } from "./interaction/types.js";
export type { ViewportPolicy } from "./interaction/ViewportPolicy.js";
export type { AxisScaleOptions, AxisRenderTarget, AxisScale, AxisTickFormat, AxisTickFormatter, BuiltInAxisScale, CustomAxisScale } from "./interaction/AxisController.js";
export type { AxisTimeZone } from "./interaction/timeAxis.js";

// Rendering engines: the `renderer` option takes a name or one of these factories
export type { ChartRenderSurface, ChartRendererCapabilities, ChartRendererFactory, ChartRendererFactoryContext, ChartRendererHandle, ChartRendererInfo, RendererChoice, RendererLossState, RendererName } from "./render/ChartRenderer.js";
export { autoRenderer, canvas2dRenderer, createChartRenderContext, sharedRenderer, webgl2Renderer } from "./render/engines.js";
export type { ChartRenderContext } from "./render/engines.js";
export { Canvas2DUnavailableError } from "./render/canvas2d/Canvas2DRenderer.js";

// Engine support detection
export { isWebGL2Available, WebGL2UnavailableError } from "./render/webgl2/availability.js";
