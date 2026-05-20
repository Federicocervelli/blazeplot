## API reference

This page is generated from the built package. Use it as an index of import paths and public symbols; the guide pages explain when to use each feature.

### Common API map

| Task | Start here |
|---|---|
| Create and render a chart | `Chart`, `ChartOptions`, `chart.addLine(...)`, `chart.fitToData()`, `chart.start()` |
| Static X/Y arrays | `StaticDataset` |
| Live irregular data | `RingBuffer` |
| Live fixed-rate data | `UniformRingBuffer` |
| OHLC/candlesticks | `StaticOhlcDataset`, `OhlcRingBuffer`, `chart.addOhlc(...)`, `chart.addCandlestick(...)` |
| Custom high-performance data | `Dataset`, `AcceleratedDataset`, range/copy dataset interfaces |
| Pan/zoom and user interaction | `blazeplot/plugins/interactions`, `Camera2D`, viewport APIs |
| Tooltips, legends, annotations, selection | `blazeplot/plugins/*` subpaths |
| React | `blazeplot/react` and `BlazeChart` |
| Linked dashboards | `blazeplot/linked` or `blazeplot/linked-core` |
| Image/data export | `chart.screenshot()`, `blazeplot/export`, `blazeplot/data` |

Guides: [Overview](./overview.md), [Examples](./examples.md), [Data semantics](./data-semantics.md), [Performance recipes](./performance-recipes.md), [Built-in plugins](./built-in-plugins.md), and [Plugin authoring](./plugin-authoring.md).

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

### Bundle size summary

Generated from `dist/` after the package build.

| Chunk | File | Size |
|---|---|---:|
| root entry | `dist/index.js` | 0.7 KiB |
| core subpath entry | `dist/core.js` | 0.7 KiB |
| interaction subpath entry | `dist/interaction.js` | 0.1 KiB |
| render subpath entry | `dist/render.js` | 0.3 KiB |
| react entry | `dist/react.js` | 0.7 KiB |
| linked entry | `dist/linked.js` | 0.4 KiB |
| linked core entry | `dist/linked-core.js` | 0.1 KiB |
| data entry | `dist/data.js` | 4.9 KiB |
| export entry | `dist/export.js` | 1.3 KiB |
| interactions plugin | `dist/plugins/interactions.js` | 15.3 KiB |
| annotations plugin | `dist/plugins/annotations.js` | 9.3 KiB |
| navigator plugin | `dist/plugins/navigator.js` | 8.6 KiB |
| selection plugin | `dist/plugins/selection.js` | 5.3 KiB |
| legend plugin | `dist/plugins/legend.js` | 2.8 KiB |
| tooltip plugin entry | `dist/plugins/tooltip.js` | 0.1 KiB |
| crosshair plugin entry | `dist/plugins/crosshair.js` | 0.1 KiB |
| shared Chart chunk | `dist/Chart-D1ISQl_J.js` | 57.0 KiB |
| shared RingBuffer chunk | `dist/RingBuffer-Bd5JaRf4.js` | 29.6 KiB |
| shared OhlcDataset chunk | `dist/OhlcDataset-1cMrc6BC.js` | 17.3 KiB |
| shared AxisController chunk | `dist/AxisController-CUL9i0MS.js` | 13.6 KiB |
| shared WebGL2Backend chunk | `dist/WebGL2Backend-wxbXnm0h.js` | 20.9 KiB |
| shared LinkedChartsCore chunk | `dist/LinkedChartsCore-DDrAyfEg.js` | 2.1 KiB |
| lazy screenshot chunk | `dist/screenshot-BVw2v67J.js` | 3.0 KiB |
| shared OverlayUtils chunk | `dist/OverlayUtils-Gk-tb2Ak.js` | 3.1 KiB |
| shared Tooltip chunk | `dist/Tooltip-DDEQ32oy.js` | 4.8 KiB |
| shared Crosshair chunk | `dist/Crosshair-CYiuaxpk.js` | 8.8 KiB |

### All public exports

Generated from `dist/index.d.ts` after the package build.

| Export | Kind | Source | JSDoc summary |
|---|---|---|---|
| `AcceleratedDataset` | interface | `./core/types` | Convenience contract for maximum-performance custom datasets. Implement this when a dataset can provide fast exact sample copies, stable viewport sampling, range min/max queries, and renderer-ready min/max buckets. |
| `AppendableDataset` | interface | `./core/types` | — |
| `AttributeSpec` | interface | `./render/types` | — |
| `AxisConfig` | interface | `./ui/Chart` | — |
| `AxisController` | class | `./interaction/AxisController` | — |
| `AxisControllerAxisOptions` | interface | `./interaction/AxisController` | — |
| `AxisControllerOptions` | interface | `./interaction/AxisController` | — |
| `AxisPosition` | type | `./ui/ChartLayout` | — |
| `AxisRenderTarget` | type | `./interaction/AxisController` | — |
| `AxisScale` | type | `./interaction/AxisController` | — |
| `AxisTickFormat` | type | `./interaction/AxisController` | — |
| `AxisTickFormatter` | type | `./interaction/AxisController` | — |
| `AxisTimeZone` | type | `./interaction/AxisController` | — |
| `AxisTitleConfig` | interface | `./ui/Chart` | — |
| `BufferOverflowStrategy` | type | `./core/types` | — |
| `BufferSpec` | interface | `./render/types` | — |
| `BuiltInAxisScale` | type | `./interaction/AxisController` | — |
| `Camera2D` | class | `./interaction/Camera2D` | — |
| `Chart` | class | `./ui/Chart` | — |
| `ChartAccessibilityOptions` | interface | `./ui/Chart` | — |
| `ChartAutoFitYOptions` | interface | `./ui/Chart` | — |
| `ChartBackendFactory` | type | `./ui/Chart` | — |
| `ChartBackendFactoryContext` | interface | `./ui/Chart` | — |
| `ChartFitToDataOptions` | interface | `./ui/Chart` | — |
| `ChartFitToDataPadding` | interface | `./ui/Chart` | — |
| `ChartFollowXOptions` | interface | `./ui/Chart` | — |
| `ChartFrameStats` | interface | `./ui/Chart` | — |
| `ChartHoverState` | interface | `./ui/Chart` | — |
| `ChartKeyboardOptions` | interface | `./ui/Chart` | — |
| `ChartLayoutReservation` | interface | `./ui/Chart` | — |
| `ChartOptions` | interface | `./ui/Chart` | — |
| `ChartPickGroup` | type | `./ui/Chart` | — |
| `ChartPickItem` | interface | `./ui/Chart` | — |
| `ChartPickMode` | type | `./ui/Chart` | — |
| `ChartPickOptions` | interface | `./ui/Chart` | — |
| `ChartPlugin` | interface | `./ui/Chart` | — |
| `ChartPluginContext` | interface | `./ui/Chart` | — |
| `ChartPluginHandle` | interface | `./ui/Chart` | — |
| `ChartPointerEventState` | interface | `./ui/Chart` | — |
| `ChartPointerEventType` | type | `./ui/Chart` | — |
| `ChartScreenshotOptions` | interface | `./ui/Chart` | — |
| `ChartScreenshotPreset` | type | `./ui/Chart` | — |
| `ChartSelectEvent` | interface | `./ui/Chart` | — |
| `ChartSeriesClickEvent` | interface | `./ui/Chart` | — |
| `ChartSeriesState` | interface | `./ui/Chart` | — |
| `ChartTheme` | interface | `./ui/theme` | — |
| `ChartTitleConfig` | interface | `./ui/Chart` | — |
| `ChartViewportChangeEvent` | interface | `./ui/Chart` | — |
| `CssColor` | type | `./ui/theme` | — |
| `CustomAxisScale` | interface | `./interaction/AxisController` | — |
| `Dataset` | interface | `./core/types` | — |
| `DEFAULT_CHART_THEME` | const | `./ui/theme` | — |
| `DrawSpec` | interface | `./render/types` | — |
| `GpuBackend` | interface | `./render/types` | — |
| `GpuBuffer` | interface | `./render/types` | — |
| `GpuCapabilities` | interface | `./render/types` | — |
| `GpuProgram` | interface | `./render/types` | — |
| `GpuResource` | type | `./render/types` | — |
| `isWebGL2Available` | function | `./render/WebGL2Backend` | — |
| `LODBucket` | interface | `./core/types` | — |
| `LODStrategy` | type | `./core/types` | — |
| `LODView` | interface | `./core/types` | — |
| `MinMaxPyramid` | class | `./core/MinMaxPyramid` | — |
| `MinMaxSegmentCopyDataset` | interface | `./core/types` | Optional high-performance min/max extraction capability for dense rendering. Implementations can use pyramids, segment trees, database aggregates, or analytic/procedural envelopes to emit renderer-ready min/max buckets. |
| `MinMaxSegmentLayout` | type | `./core/types` | — |
| `OhlcDataset` | interface | `./core/types` | — |
| `OhlcRingBuffer` | class | `./core/OhlcDataset` | — |
| `OhlcRingBufferOptions` | interface | `./core/OhlcDataset` | — |
| `PanIntent` | interface | `./interaction/types` | — |
| `RangeMinMaxDataset` | interface | `./core/types` | — |
| `RangeSampleCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for datasets that can copy raw samples without going through repeated getX/getY calls. Implement this for very large datasets, implicit-X datasets, or remote/memory-mapped sources. |
| `ReglBackend` | const | `./render/WebGL2Backend` | Deprecated alias for WebGL2Backend. This preserves the pre-native-backend public API. |
| `ResolvedChartTheme` | interface | `./ui/theme` | — |
| `RgbaColor` | type | `./ui/theme` | — |
| `RingBuffer` | class | `./core/RingBuffer` | — |
| `RingBufferOptions` | interface | `./core/RingBuffer` | — |
| `RingBufferOverflow` | type | `./core/RingBuffer` | — |
| `SampleCopyLayout` | type | `./core/types` | — |
| `SeriesConfig` | interface | `./core/types` | — |
| `SeriesDataBounds` | interface | `./core/SeriesStore` | — |
| `SeriesDataBoundsOptions` | interface | `./core/SeriesStore` | — |
| `SeriesMode` | type | `./core/types` | — |
| `SeriesOhlcSample` | interface | `./core/SeriesStore` | — |
| `SeriesSample` | interface | `./core/types` | — |
| `SeriesStore` | class | `./core/SeriesStore` | — |
| `SeriesStyle` | interface | `./core/types` | — |
| `SeriesYAxis` | type | `./core/types` | — |
| `ServerSampledBuckets` | interface | `./core/ServerSampledDataset` | — |
| `ServerSampledData` | type | `./core/ServerSampledDataset` | — |
| `ServerSampledDataset` | class | `./core/ServerSampledDataset` | Mutable dataset for viewport samples that were already reduced by a server. Use point data with `downsample: "none"`, or min/max buckets with `downsample: "server"` so BlazePlot renders the supplied buckets directly instead of applying another client-side sampler. |
| `ServerSampledDatasetKind` | type | `./core/ServerSampledDataset` | — |
| `ServerSampledPoints` | interface | `./core/ServerSampledDataset` | — |
| `StaticDataset` | class | `./core/StaticDataset` | — |
| `StaticOhlcDataset` | class | `./core/OhlcDataset` | — |
| `TextOverlayConfig` | interface | `./ui/Chart` | — |
| `ThemeColor` | type | `./ui/theme` | — |
| `TimeRange` | interface | `./core/types` | — |
| `TypedSeriesConfig` | type | `./ui/Chart` | — |
| `UniformRingBuffer` | class | `./core/UniformRingBuffer` | High-throughput ring buffer for uniformly spaced X values. Store only Y samples and derive X as `xStart + index * xStep`. This is the fastest built-in dataset for live telemetry, signals, and other fixed-rate streams because appends copy a single typed array and min/max extraction uses a block segment tree over the physical ring. |
| `UniformRingBufferOptions` | interface | `./core/UniformRingBuffer` | — |
| `Viewport` | interface | `./core/types` | — |
| `ViewportPolicy` | interface | `./interaction/types` | — |
| `VisiblePointCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for point/scatter datasets. Implementations should cull against the full 2D viewport and may sample in screen space so dense point clouds respond to both X and Y zoom. |
| `VisibleSampleCopyDataset` | interface | `./core/types` | Optional high-performance stable visible sampling capability. Unlike copySamplesRange, this method may stride/downsample, but should choose samples anchored to data coordinates so streamed appends do not make existing sampled points jitter. |
| `WebGL2Backend` | class | `./render/WebGL2Backend` | — |
| `WebGL2UnavailableError` | class | `./render/WebGL2Backend` | — |
| `YAppendableDataset` | interface | `./core/types` | — |
| `ZoomAxis` | type | `./interaction/types` | — |
| `ZoomIntent` | interface | `./interaction/types` | — |
