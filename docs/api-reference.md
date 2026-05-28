## API reference

This page is generated from the built package. Use it as an index of import paths and public symbols; the guide pages explain when to use each feature.

### Common API map

| Task | Start here |
|---|---|
| Create and render a chart | `createChart(...)` for common static charts; `Chart`, `chart.addLine(...)`, `chart.fitToData()`, and `chart.start()` for manual lifecycle control |
| Static X/Y arrays or object rows | `createChart(...)`, `StaticDataset`, `StaticDataset.fromObjects(...)` |
| Live irregular data | `chart.addLine({ capacity })`, `RingBuffer`, [Live data](./live-data.md) |
| Live fixed-rate data | `chart.addLine({ capacity, xStep })`, `UniformRingBuffer`, [Live data](./live-data.md) |
| OHLC/candlesticks | `StaticOhlcDataset`, `OhlcRingBuffer`, `chart.addOhlc(...)`, `chart.addCandlestick(...)` |
| Custom high-performance data | `Dataset`, `AcceleratedDataset`, range/copy dataset interfaces |
| Pan/zoom and user interaction | `blazeplot/plugins/interactions`, `Camera2D`, viewport APIs |
| Tooltips, legends, annotations, selection, flame graphs | `blazeplot/plugins/*` subpaths |
| React | `blazeplot/react` and `BlazeChart` |
| Linked dashboards | `blazeplot/linked` or `blazeplot/linked-core` |
| Image/data export | `chart.screenshot()`, `blazeplot/export`, `blazeplot/data` |

Guides: [Overview](./overview.md), [Docs map](./README.md), [Examples](./examples.md), [Live data](./live-data.md), [Data semantics](./data-semantics.md), [Performance](./performance-recipes.md), [Benchmarks](./benchmarks.md), [Plugins](./built-in-plugins.md), [Theme & layout](./theming-and-layout.md), [Author plugins](./plugin-authoring.md), [Troubleshooting](./troubleshooting.md), [Browser](./browser-support.md), [Migration](./versioning-and-migration.md), [Roadmap](./roadmap.md).

### Package entry points

| Import | Contents |
|---|---|
| `blazeplot` | Core chart, data, interaction, rendering types, and low-level primitives. |
| `blazeplot/core` | Data structures, datasets, LOD helpers, and series storage without chart UI. |
| `blazeplot/interaction` | Camera, axis, pan/zoom intent, and viewport policy helpers without chart UI. |
| `blazeplot/render` | Renderer and WebGL backend primitives without chart UI. |
| `blazeplot/react` | React wrapper component. |
| `blazeplot/linked` | Linked chart layout helpers with tooltip/crosshair sync factories. |
| `blazeplot/linked-core` | Lean linked chart layout helpers without tooltip/crosshair sync imports. |
| `blazeplot/data` | Pure chart data export and transform helpers. |
| `blazeplot/export` | Screenshot download and clipboard helpers. |
| `blazeplot/plugins/legend` | Built-in legend plugin. |
| `blazeplot/plugins/tooltip` | Built-in tooltip plugin. |
| `blazeplot/plugins/interactions` | Built-in pan, zoom, axis interaction, and reset plugin. |
| `blazeplot/plugins/annotations` | Built-in annotation overlay plugin. |
| `blazeplot/plugins/selection` | Built-in brush/range selection plugin. |
| `blazeplot/plugins/crosshair` | Built-in crosshair and ruler plugin. |
| `blazeplot/plugins/navigator` | Built-in overview/navigator plugin. |
| `blazeplot/plugins/flamegraph` | Built-in flame graph and status-span plugin. |

The bundle table lists emitted files after Vite code-splitting. Entry rows can be tiny stubs that load shared chunks; use the README performance section for the aggregate core runtime size.

### Bundle size summary

Generated from `dist/` after the package build.

| Chunk | File | Size |
|---|---|---:|
| root entry | `dist/index.js` | 2 KiB |
| core subpath entry | `dist/core.js` | 1 KiB |
| interaction subpath entry | `dist/interaction.js` | 0 KiB |
| render subpath entry | `dist/render.js` | 0 KiB |
| react entry | `dist/react.js` | 1 KiB |
| linked entry | `dist/linked.js` | 0 KiB |
| linked core entry | `dist/linked-*.js` | 0 KiB |
| data entry | `dist/data.js` | 5 KiB |
| export entry | `dist/export.js` | 1 KiB |
| interactions plugin | `dist/plugins/interactions.js` | 15 KiB |
| annotations plugin | `dist/plugins/annotations.js` | 9 KiB |
| navigator plugin | `dist/plugins/navigator.js` | 9 KiB |
| selection plugin | `dist/plugins/selection.js` | 5 KiB |
| legend plugin | `dist/plugins/legend.js` | 3 KiB |
| tooltip plugin entry | `dist/plugins/tooltip.js` | 0 KiB |
| crosshair plugin entry | `dist/plugins/crosshair.js` | 0 KiB |
| flamegraph plugin | `dist/plugins/flamegraph.js` | 21 KiB |
| shared Chart chunk | `dist/Chart-*.js` | 57 KiB |
| shared streaming data chunk | `dist/UniformRingBuffer-*.js` | 44 KiB |
| shared OhlcDataset chunk | `dist/OhlcDataset-*.js` | 9 KiB |
| shared AxisController chunk | `dist/AxisController-*.js` | 14 KiB |
| shared WebGL2Backend chunk | `dist/WebGL2Backend-*.js` | 22 KiB |
| shared LinkedChartsCore chunk | `dist/LinkedChartsCore-*.js` | 2 KiB |
| lazy screenshot chunk | `dist/screenshot-*.js` | 4 KiB |
| shared OverlayUtils chunk | `dist/OverlayUtils-*.js` | 3 KiB |
| shared Tooltip chunk | `dist/Tooltip-*.js` | 6 KiB |
| shared Crosshair chunk | `dist/Crosshair-*.js` | 10 KiB |

### All public exports

Generated from `dist/index.d.ts` after the package build.

| Export | Kind | Source | JSDoc summary |
|---|---|---|---|
| `AcceleratedDataset` | interface | `./core/types` | Convenience contract for maximum-performance custom datasets. Implement this when a dataset can provide fast exact sample copies, stable viewport sampling, range min/max queries, and renderer-ready min/max buckets. |
| `AppendableDataset` | interface | `./core/types` | Dataset that accepts appended explicit X/Y samples. |
| `AttributeSpec` | interface | `./render/types` | Vertex attribute binding for a draw call. |
| `AxisConfig` | interface | `./ui/Chart` | Axis visibility, placement, scale, tick formatting, and title options. |
| `AxisController` | class | `./interaction/AxisController` | Computes axis tick values and labels for a camera. |
| `AxisControllerAxisOptions` | interface | `./interaction/AxisController` | Scale and formatting options for one axis. |
| `AxisControllerOptions` | interface | `./interaction/AxisController` | Options for the X and Y axes controlled by an `AxisController`. |
| `AxisPosition` | type | `./ui/ChartLayout` | Placement for chart axis labels and ticks. |
| `AxisRenderTarget` | type | `./interaction/AxisController` | Axis dimension targeted by axis helpers. |
| `AxisScale` | type | `./interaction/AxisController` | Built-in scale name or custom scale implementation. |
| `AxisTickFormat` | type | `./interaction/AxisController` | Built-in format string or custom tick formatter. |
| `AxisTickFormatter` | type | `./interaction/AxisController` | Function form for formatting axis tick values. |
| `AxisTimeZone` | type | `./interaction/AxisController` | Time zone used for built-in time tick formatting. |
| `AxisTitleConfig` | interface | `./ui/Chart` | Axis title text and styling. |
| `BufferOverflowStrategy` | type | `./core/types` | Behavior when a fixed-capacity streaming buffer is full. |
| `BufferSpec` | interface | `./render/types` | Parameters for allocating a GPU buffer. |
| `BuiltInAxisScale` | type | `./interaction/AxisController` | Built-in axis scale names. |
| `Camera2D` | class | `./interaction/Camera2D` | Camera that maps data domains to clip, screen, and plot coordinates. |
| `Chart` | class | `./ui/Chart` | Imperative WebGL chart instance for rendering, interaction, and plugins. |
| `ChartAccessibilityOptions` | interface | `./ui/Chart` | ARIA and keyboard-navigation options for the chart root. |
| `ChartAutoFitYOptions` | interface | `./ui/Chart` | Options for automatically refitting Y as the X viewport changes. |
| `ChartBackendFactory` | type | `./ui/Chart` | Creates the GPU backend used by a chart. |
| `ChartBackendFactoryContext` | interface | `./ui/Chart` | Context passed to a custom GPU backend factory. |
| `ChartFitToDataOptions` | interface | `./ui/Chart` | Options for fitting the viewport to series data bounds. |
| `ChartFitToDataPadding` | interface | `./ui/Chart` | Fractional padding applied when fitting domains to data. |
| `ChartFollowXOptions` | interface | `./ui/Chart` | Options for keeping the X viewport anchored to the latest data. |
| `ChartFrameStats` | interface | `./ui/Chart` | Mutable render metrics from the last frame. |
| `ChartHoverState` | interface | `./ui/Chart` | Current hover hit-test result, including pointer position and picked items. |
| `ChartKeyboardOptions` | interface | `./ui/Chart` | Keyboard pan and zoom behavior for accessible charts. |
| `ChartLayoutReservation` | interface | `./ui/Chart` | Extra CSS-pixel space reserved around the plot by plugins or overlays. |
| `ChartOptions` | interface | `./ui/Chart` | Constructor options for `Chart`. |
| `ChartPickGroup` | type | `./ui/Chart` | Whether picks include all series sharing the same X value. |
| `ChartPickItem` | interface | `./ui/Chart` | A picked data point with series metadata and screen coordinates. |
| `ChartPickMode` | type | `./ui/Chart` | Strategy used to find data points near a pointer location. |
| `ChartPickOptions` | interface | `./ui/Chart` | Options for hover and pointer hit-testing. |
| `ChartPlugin` | interface | `./ui/Chart` | Plugin installer for extending chart behavior. |
| `ChartPluginContext` | interface | `./ui/Chart` | Limited chart API exposed to plugins. |
| `ChartPluginHandle` | interface | `./ui/Chart` | Disposable handle returned by a plugin. |
| `ChartPointerEventState` | interface | `./ui/Chart` | Pointer event payload expressed in both screen and data coordinates. |
| `ChartPointerEventType` | type | `./ui/Chart` | Pointer events that can be subscribed to through `Chart.subscribe`. |
| `ChartScreenshotOptions` | interface | `./ui/Chart` | Options for exporting the chart as an image blob. |
| `ChartScreenshotPreset` | type | `./ui/Chart` | Built-in screenshot background presets. |
| `ChartSelectEvent` | interface | `./ui/Chart` | Selection event payload emitted by selection plugins or custom code. |
| `ChartSeriesClickEvent` | interface | `./ui/Chart` | Click payload for the nearest chart series item. |
| `ChartSeriesState` | interface | `./ui/Chart` | Runtime state for one chart series. |
| `ChartTheme` | interface | `./ui/theme` | Partial chart theme supplied by callers. |
| `ChartTitleConfig` | interface | `./ui/Chart` | Chart title or subtitle text and alignment. |
| `ChartViewportChangeEvent` | interface | `./ui/Chart` | Emitted after the visible domain changes. |
| `createChart` | function | `./createChart` | Create a chart from a compact declarative config. This helper is intentionally thin: it returns the underlying `Chart` instance, so advanced code can still use the full imperative API after setup. |
| `CreateChartArraySeries` | interface | `./createChart` | Declarative series backed by parallel X and Y arrays. |
| `CreateChartDatasetSeries` | interface | `./createChart` | Declarative series backed by an existing BlazePlot dataset. |
| `CreateChartHistogramSeries` | type | `./createChart` | Declarative histogram series backed by raw one-dimensional values. |
| `CreateChartObjectSeries` | interface | `./createChart` | Declarative series backed by object rows and field selectors. |
| `CreateChartOptions` | interface | `./createChart` | High-level chart configuration for common first-render cases. Use `createChart(...)` when you have static arrays, object rows, or a simple streaming buffer and want BlazePlot to create the chart, add series, fit the initial viewport, and start rendering in one call. |
| `CreateChartSeries` | type | `./createChart` | Any series shape accepted by `createChart`. |
| `CreateChartSeriesType` | type | `./createChart` | Series modes supported by the declarative `createChart` helper. |
| `CreateChartStreamingSeries` | interface | `./createChart` | Declarative empty streaming series with an internally-created ring buffer. |
| `CssColor` | type | `./ui/theme` | CSS color string accepted by theme options. |
| `CustomAxisScale` | interface | `./interaction/AxisController` | Custom scale hooks for tick generation, formatting, and coordinate mapping. |
| `Dataset` | interface | `./core/types` | Sorted XY data source consumed by chart series. |
| `DEFAULT_CHART_THEME` | const | `./ui/theme` | Default dark chart theme. |
| `DrawSpec` | interface | `./render/types` | Complete draw call description for a GPU backend. |
| `GpuBackend` | interface | `./render/types` | Minimal GPU abstraction used by the renderer. |
| `GpuBuffer` | interface | `./render/types` | Opaque handle for a GPU buffer. |
| `GpuCapabilities` | interface | `./render/types` | Feature flags reported by a GPU backend. |
| `GpuProgram` | interface | `./render/types` | Opaque handle for a linked GPU program. |
| `GpuResource` | type | `./render/types` | GPU resource accepted by backend disposal. |
| `histogram` | function | `./core/Histogram` | Convert one-dimensional finite values into histogram bins. |
| `HistogramBin` | interface | `./core/Histogram` | One histogram bucket, suitable for rendering as a bar centered at `x`. |
| `HistogramBinThresholds` | type | `./core/Histogram` | Explicit bin edges, or a requested number of equal-width bins. |
| `histogramDataset` | function | `./core/Histogram` | Build a StaticDataset from histogram bucket centers and normalized counts. |
| `HistogramDataset` | class | `./core/Histogram` | Static histogram dataset that preserves each bucket's X interval for picks and tooltips. |
| `HistogramNormalization` | type | `./core/Histogram` | Histogram value normalization modes. |
| `HistogramOptions` | interface | `./core/Histogram` | Options for converting one-dimensional values into histogram bins. |
| `HistogramResult` | interface | `./core/Histogram` | Result of a histogram transform. |
| `HistogramSeriesConfig` | interface | `./ui/Chart` | Series configuration for `Chart.addHistogram(...)` from raw one-dimensional values. |
| `isWebGL2Available` | function | `./render/WebGL2Backend` | Return whether the current environment can create a WebGL2 context. |
| `LODBucket` | interface | `./core/types` | Min/max aggregate for a contiguous X range. |
| `LODStrategy` | type | `./core/types` | Downsampling strategy used when a series is denser than the plot. |
| `LODView` | interface | `./core/types` | Renderer-ready level-of-detail bucket buffer. |
| `MinMaxPyramid` | class | `./core/MinMaxPyramid` | Incremental min/max pyramid used for dense line and bar downsampling. |
| `MinMaxSegmentCopyDataset` | interface | `./core/types` | Optional high-performance min/max extraction capability for dense rendering. Implementations can use pyramids, segment trees, database aggregates, or analytic/procedural envelopes to emit renderer-ready min/max buckets. |
| `MinMaxSegmentLayout` | type | `./core/types` | Vertex layout requested when copying min/max segments into a render buffer. |
| `OhlcDataset` | interface | `./core/types` | Dataset that provides open, high, low, and close values per sample. |
| `OhlcRingBuffer` | class | `./core/OhlcDataset` | Fixed-capacity streaming buffer for OHLC/candlestick data. |
| `OhlcRingBufferOptions` | interface | `./core/OhlcDataset` | Options for `OhlcRingBuffer`. |
| `PanIntent` | interface | `./interaction/types` | Pan request expressed in data units or screen pixels. |
| `PrecomputedHistogramSeriesConfig` | interface | `./ui/Chart` | Series configuration for `Chart.addHistogram(...)` from precomputed bins. |
| `RangeMinMaxDataset` | interface | `./core/types` | Dataset that can answer min/max Y queries for index ranges. |
| `RangeSampleCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for datasets that can copy raw samples without going through repeated getX/getY calls. Implement this for very large datasets, implicit-X datasets, or remote/memory-mapped sources. |
| `ReglBackend` | const | `./render/WebGL2Backend` | Deprecated alias for WebGL2Backend. This preserves the pre-native-backend public API. Deprecated: Effective next patch release. Use WebGL2Backend. |
| `ResolvedChartTheme` | interface | `./ui/theme` | Fully resolved chart theme with concrete RGBA values. |
| `RgbaColor` | type | `./ui/theme` | RGBA color tuple with 0-1 channel values. |
| `RingBuffer` | class | `./core/RingBuffer` | Fixed-capacity sorted XY buffer for explicit X values. |
| `RingBufferOptions` | interface | `./core/RingBuffer` | Options for `RingBuffer`. |
| `RingBufferOverflow` | type | `./core/RingBuffer` | Fixed-capacity buffer behavior when new samples exceed capacity. |
| `SampleCopyLayout` | type | `./core/types` | Vertex layout requested when copying raw samples into a render buffer. |
| `SeriesAppendData` | type | `./core/SeriesStore` | Any payload accepted by `SeriesStore.append`. |
| `SeriesAppendRow` | type | `./core/SeriesStore` | Any supported object row for batched appends. |
| `SeriesConfig` | interface | `./core/types` | Configuration for adding a series to a chart. |
| `SeriesDataBounds` | interface | `./core/SeriesStore` | Data bounds for a series over an optional X range. |
| `SeriesDataBoundsOptions` | interface | `./core/SeriesStore` | X-range filter for `SeriesStore.dataBounds`. |
| `SeriesMode` | type | `./core/types` | Built-in renderer mode for a series. |
| `SeriesObjectAppendData` | type | `./core/SeriesStore` | Any object payload for appending one or more samples. |
| `SeriesOhlcAppendData` | interface | `./core/SeriesStore` | Object form for appending one OHLC sample or a batch of OHLC arrays. |
| `SeriesOhlcAppendRow` | interface | `./core/SeriesStore` | Convenient object-row form for appending one OHLC sample inside a row batch. |
| `SeriesOhlcSample` | interface | `./core/SeriesStore` | OHLC sample returned by series queries. |
| `SeriesOhlcUpdateData` | interface | `./core/SeriesStore` | Object form for updating one OHLC sample. |
| `SeriesSample` | interface | `./core/types` | One data sample returned by picking and dataset queries. |
| `SeriesScalarOrArray` | type | `./core/SeriesStore` | Single numeric sample value or a batch of values. |
| `SeriesStore` | class | `./core/SeriesStore` | Runtime wrapper around a dataset, renderer mode, style, and LOD cache. |
| `SeriesStyle` | interface | `./core/types` | Visual styling shared by built-in series renderers. |
| `SeriesUpdateData` | type | `./core/SeriesStore` | Any supported update payload for the last or indexed sample. |
| `SeriesXYAppendData` | interface | `./core/SeriesStore` | Object form for appending one XY sample or a batch of X/Y arrays. |
| `SeriesXYAppendRow` | interface | `./core/SeriesStore` | Convenient object-row form for appending one XY sample inside a row batch. |
| `SeriesXYUpdateData` | interface | `./core/SeriesStore` | Object form for updating one XY sample. |
| `SeriesYAxis` | type | `./core/types` | Y axis used to scale and render a series. |
| `ServerSampledBuckets` | interface | `./core/ServerSampledDataset` | Server-provided min/max buckets. |
| `ServerSampledData` | type | `./core/ServerSampledDataset` | Data accepted by `ServerSampledDataset.replace`. |
| `ServerSampledDataset` | class | `./core/ServerSampledDataset` | Mutable dataset for viewport samples that were already reduced by a server. Use point data with `downsample: "none"`, or min/max buckets with `downsample: "server"` so BlazePlot renders the supplied buckets directly instead of applying another client-side sampler. |
| `ServerSampledDatasetKind` | type | `./core/ServerSampledDataset` | Current server-sampled payload shape. |
| `ServerSampledPoints` | interface | `./core/ServerSampledDataset` | Server-provided point samples. |
| `StaticDataset` | class | `./core/StaticDataset` | Immutable sorted XY dataset backed by typed arrays. |
| `StaticDatasetField` | type | `./core/StaticDataset` | Object-row field selector used by `StaticDataset.fromObjects`. |
| `StaticDatasetFromObjectsOptions` | interface | `./core/StaticDataset` | Options for building a static dataset from object rows. |
| `StaticOhlcDataset` | class | `./core/OhlcDataset` | Immutable OHLC dataset backed by parallel arrays. |
| `TextOverlayConfig` | interface | `./ui/Chart` | Shared text styling for chart titles and axis titles. |
| `ThemeColor` | type | `./ui/theme` | Color value accepted by chart theme options. |
| `TimeRange` | interface | `./core/types` | Inclusive data X range. |
| `TypedSeriesConfig` | type | `./ui/Chart` | Series configuration used by typed helpers such as `addLine`. |
| `UniformRingBuffer` | class | `./core/UniformRingBuffer` | High-throughput ring buffer for uniformly spaced X values. Store only Y samples and derive X as `xStart + index * xStep`. This is the fastest built-in dataset for live telemetry, signals, and other fixed-rate streams because appends copy a single typed array and min/max extraction uses a block segment tree over the physical ring. |
| `UniformRingBufferOptions` | interface | `./core/UniformRingBuffer` | Options for implicit-X streaming buffers. |
| `UpdatableDataset` | interface | `./core/types` | Dataset that supports updating existing X/Y samples. |
| `Viewport` | interface | `./core/types` | Visible data-domain bounds for one chart camera. |
| `ViewportPolicy` | interface | `./interaction/types` | Optional hooks that can constrain or react to viewport changes. |
| `VisiblePointCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for point/scatter datasets. Implementations should cull against the full 2D viewport and may sample in screen space so dense point clouds respond to both X and Y zoom. |
| `VisibleSampleCopyDataset` | interface | `./core/types` | Optional high-performance stable visible sampling capability. Unlike copySamplesRange, this method may stride/downsample, but should choose samples anchored to data coordinates so streamed appends do not make existing sampled points jitter. |
| `WebGL2Backend` | class | `./render/WebGL2Backend` | Native WebGL2 implementation of BlazePlot's GPU backend. |
| `WebGL2UnavailableError` | class | `./render/WebGL2Backend` | Error thrown when a WebGL2 backend cannot be created. |
| `XRange` | interface | `./core/types` | Data-domain X interval represented by one dataset sample. |
| `XRangeDataset` | interface | `./core/types` | Dataset whose sample X values represent intervals rather than points. |
| `YAppendableDataset` | interface | `./core/types` | Dataset that accepts appended Y samples with implicit X values. |
| `YUpdatableDataset` | interface | `./core/types` | Dataset that supports updating existing Y values. |
| `ZoomAxis` | type | `./interaction/types` | Axis affected by a zoom operation. |
| `ZoomIntent` | interface | `./interaction/types` | Zoom request with a scale factor and optional anchor point. |
