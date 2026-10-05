## API reference

This page is generated from the built package. Use it as an index of import paths and public symbols; the guide pages explain when to use each feature.

### Common API map

| Task | Start here |
|---|---|
| Create and render a chart | `new Chart(...)`, `chart.addLine(...)`, `chart.fitToData()`, and `chart.start()` |
| Static X/Y arrays or object rows | `StaticDataset`, `StaticDataset.fromObjects(...)` |
| Live irregular data | `chart.addLine({ capacity })`, `RingBuffer`, [Live data](./live-data.md) |
| Live fixed-rate data | `chart.addLine({ capacity, xStep })`, `UniformRingBuffer`, [Live data](./live-data.md) |
| OHLC/candlesticks | `StaticOhlcDataset`, `OhlcRingBuffer`, `chart.addOhlc(...)`, `chart.addCandlestick(...)` |
| Custom high-performance data | `Dataset`, `AcceleratedDataset`, range/copy dataset interfaces |
| Pan/zoom and user interaction | `blazeplot/plugins/interactions`, `chart.setViewport(...)`, `ViewportPolicy` |
| Tooltips, legends, annotations, selection, flame graphs | `blazeplot/plugins/*` subpaths |
| React | Create and dispose `Chart` in an effect |
| Linked dashboards | `blazeplot/linked` with `panelPlugins` |
| Image/data export | `chart.screenshot()`, `blazeplot/export` |

Guides: [Overview](./overview.md), [Docs map](./README.md), [Examples](./examples.md), [Frameworks](./framework-integration.md), [Live data](./live-data.md), [Data semantics](./data-semantics.md), [Performance](./performance-recipes.md), [Benchmarks](./benchmarks.md), [Plugins](./built-in-plugins.md), [Theme & layout](./theming-and-layout.md), [Author plugins](./plugin-authoring.md), [Troubleshooting](./troubleshooting.md), [Browser](./browser-support.md), [Migrating to 1.0](./migrating-to-1.0.md), [Migration](./versioning-and-migration.md), [Stability](./stability.md), [Errors](./error-handling.md), [Accessibility](./accessibility.md), [Roadmap](./roadmap.md).

### Package entry points

| Import | Contents |
|---|---|
| `blazeplot` | Chart, datasets, data contracts, theming, and the WebGL2 backend. |
| `blazeplot/linked` | Multi-panel layouts with shared X and per-panel plugins. |
| `blazeplot/data` | Pure, chart-agnostic data transforms (binning, rolling mean). |
| `blazeplot/export` | Chart data export (CSV/JSON-ready rows) and screenshot download/clipboard helpers. |
| `blazeplot/renderers/canvas2d` | Canvas 2D renderer and WebGL2-with-Canvas-2D-fallback renderer factories. |
| `blazeplot/plugins/legend` | Built-in legend plugin. |
| `blazeplot/plugins/tooltip` | Built-in tooltip plugin. |
| `blazeplot/plugins/interactions` | Built-in pan, zoom, axis interaction, and reset plugin. |
| `blazeplot/plugins/annotations` | Built-in annotation overlay plugin. |
| `blazeplot/plugins/selection` | Built-in brush/range selection plugin. |
| `blazeplot/plugins/crosshair` | Built-in crosshair and ruler plugin. |
| `blazeplot/plugins/navigator` | Built-in overview/navigator plugin. |
| `blazeplot/plugins/flamegraph` | Built-in flame graph and status-span plugin. |
| `blazeplot/plugins/a11y` | Built-in accessibility plugin: hidden data table, keyboard inspection cursor, live summary. |

The bundle table lists emitted files after Vite code-splitting. Entry rows can be tiny stubs that load shared chunks; the README performance section reports the aggregate core runtime size.

### Bundle size summary

Generated from `dist/` after the package build.

| Chunk | File | Size |
|---|---|---:|
| root entry | `dist/index.js` | 12 KiB |
| linked entry | `dist/linked.js` | 2 KiB |
| data entry | `dist/data.js` | 2 KiB |
| export entry | `dist/export.js` | 4 KiB |
| interactions plugin | `dist/plugins/interactions.js` | 11 KiB |
| annotations plugin | `dist/plugins/annotations.js` | 13 KiB |
| navigator plugin | `dist/plugins/navigator.js` | 9 KiB |
| selection plugin | `dist/plugins/selection.js` | 8 KiB |
| legend plugin | `dist/plugins/legend.js` | 3 KiB |
| tooltip plugin | `dist/plugins/tooltip.js` | 5 KiB |
| crosshair plugin | `dist/plugins/crosshair.js` | 9 KiB |
| flamegraph plugin | `dist/plugins/flamegraph.js` | 21 KiB |
| canvas2d renderer entry | `dist/renderers/canvas2d.js` | 5 KiB |
| a11y plugin | `dist/plugins/a11y.js` | 10 KiB |
| shared Chart chunk | `dist/Chart-*.js` | 134 KiB |
| shared WebGL2 renderer chunk | `dist/webgl2Renderer-*.js` | 11 KiB |
| shared theme chunk | `dist/theme-*.js` | 7 KiB |
| lazy screenshot chunk | `dist/screenshot-*.js` | 3 KiB |
| shared OverlayUtils chunk | `dist/OverlayUtils-*.js` | 4 KiB |

### All public exports

Generated from `dist/index.d.ts` after the package build.

| Export | Kind | Source | JSDoc summary |
|---|---|---|---|
| `AcceleratedDataset` | interface | `./core/types` | Convenience contract for maximum-performance custom datasets. Implement this when a dataset can provide fast exact sample copies, stable viewport sampling, range min/max queries, and renderer-ready min/max buckets. |
| `AppendableDataset` | interface | `./core/types` | Dataset that accepts appended X/Y samples; implementations may store X values explicitly or use them to seed implicit X spacing. |
| `AxisConfig` | interface | `./ui/Chart` | Axis visibility, placement, scale, tick formatting, and title options. |
| `AxisControllerAxisOptions` | interface | `./interaction/AxisController` | Scale and formatting options for one axis. |
| `AxisPosition` | type | `./ui/ChartLayout` | Placement for chart axis labels and ticks. |
| `AxisRenderTarget` | type | `./interaction/AxisController` | Axis dimension targeted by axis helpers. |
| `AxisScale` | type | `./interaction/AxisController` | Built-in scale name or custom scale implementation. |
| `AxisTickFormat` | type | `./interaction/AxisController` | Built-in format string or custom tick formatter. |
| `AxisTickFormatter` | type | `./interaction/AxisController` | Function form for formatting axis tick values. |
| `AxisTimeZone` | type | `./interaction/AxisController` | Time zone used for built-in time tick formatting. |
| `BufferOverflowStrategy` | type | `./core/types` | Behavior when a fixed-capacity streaming buffer is full. |
| `BuiltInAxisScale` | type | `./interaction/AxisController` | Built-in axis scale names. |
| `Camera2D` | class | `./interaction/Camera2D` | Camera that maps data domains to clip, screen, and plot coordinates. |
| `Chart` | class | `./ui/Chart` | Imperative WebGL chart instance for rendering, interaction, and plugins. |
| `ChartAccessibilityOptions` | interface | `./ui/Chart` | ARIA, keyboard-navigation, and high-contrast options for the chart root. |
| `ChartAutoFitYOptions` | type | `./ui/Chart` | Options for automatically refitting Y as the X viewport changes. |
| `ChartEventMap` | interface | `./ui/Chart` | Payload delivered to `chart.subscribe(event, callback)` for each chart event. Includes the plugin events declared on `ChartPluginEventMap` (such as `select`). |
| `ChartEventName` | type | `./ui/Chart` | Name of an event accepted by `Chart.subscribe`. |
| `ChartFitToDataOptions` | interface | `./ui/Chart` | Options for fitting the viewport to series data bounds. |
| `ChartFitToDataPadding` | interface | `./ui/Chart` | Fractional padding applied when fitting domains to data. |
| `ChartFollowXOptions` | interface | `./ui/Chart` | Options for keeping the X viewport anchored to the latest data. |
| `ChartFollowXState` | type | `./ui/Chart` | Latest-X follow state: disabled, actively following, or paused by interaction. |
| `ChartFrameStats` | interface | `./ui/Chart` | Render metrics from the last frame. |
| `ChartHoverState` | interface | `./ui/Chart` | Current hover hit-test result, including pointer position and picked items. |
| `ChartInspectionTarget` | interface | `./ui/Chart` | A sample to show as the hover state, set with `ctx.state.inspect(...)`. |
| `ChartKeyboardOptions` | interface | `./ui/Chart` | Keyboard pan and zoom behavior for accessible charts. |
| `ChartLayoutReservation` | interface | `./ui/PluginHost` | Extra CSS-pixel space reserved around the plot by a plugin, e.g. for a navigator or toolbar. Reservations from every plugin add up. |
| `ChartMountSlot` | type | `./ui/PluginHost` | Where a plugin can attach its own DOM with `ctx.dom.mount(slot, element)`. - `"plot"`: the plot area, above the WebGL canvas. Coordinates match `ctx.coords` plot coordinates (CSS pixels from the plot's top-left). Overlays here should keep `pointer-events: none` unless they handle their own input. - `"root"`: the whole chart box, including axis gutters and space reserved with `ctx.layout.reserve(...)`. Use it for legends, toolbars, and navigators. - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters (bottom, left, right). - `"body"`: the owning document's `<body>`, for `position: fixed` UI such as tooltips that must escape the chart's `overflow: hidden`. |
| `ChartOptions` | interface | `./ui/Chart` | Constructor options for `Chart`. Boolean-or-object options accept `false` to disable and an object to configure. |
| `ChartPickGroup` | type | `./ui/Chart` | Whether picks include all series sharing the same X value. |
| `ChartPickItem` | interface | `./ui/Chart` | A picked data point with series metadata and screen coordinates. |
| `ChartPickMode` | type | `./ui/Chart` | Strategy used to find data points near a pointer location. |
| `ChartPickOptions` | interface | `./ui/Chart` | Options for hover and pointer hit-testing. |
| `ChartPlotSize` | interface | `./ui/PluginHost` | Plot-area size in CSS pixels, passed to `ChartPluginHandle.onResize`. |
| `ChartPlugin` | interface | `./ui/PluginHost` | Plugin installer for extending chart behavior. |
| `ChartPluginContext` | interface | `./ui/PluginHost` | The API a plugin receives in `install(ctx)`. Each plugin gets its own context; listeners, subscriptions, mounted elements, decorations, and layout reservations created through it are released automatically after the plugin is disposed. |
| `ChartPluginCoords` | interface | `./ui/PluginHost` | Coordinate conversions between data, plot, and client (viewport) space. |
| `ChartPluginDom` | interface | `./ui/PluginHost` | DOM attachment and input on chart-owned elements. Everything is released when the plugin is disposed. |
| `ChartPluginEventMap` | interface | `./ui/PluginHost` | Events plugins may emit with `ctx.events.emit(...)`. Chart users receive them through `chart.subscribe(...)`, because `ChartEventMap` extends this map. Third-party plugins add their own events with declaration merging. Prefix names with your plugin name to avoid collisions: ```ts declare module "blazeplot" { interface ChartPluginEventMap { "my-plugin:change": { readonly value: number }; } } ``` |
| `ChartPluginEventName` | type | `./ui/PluginHost` | Name of an event a plugin may emit. |
| `ChartPluginEvents` | interface | `./ui/PluginHost` | Chart event subscription and typed plugin events. |
| `ChartPluginHandle` | interface | `./ui/PluginHost` | Object a plugin's `install` may return. Every member is optional. Hooks run in plugin registration order; `dispose` runs in reverse registration order. |
| `ChartPluginLayout` | interface | `./ui/PluginHost` | Layout geometry and space reservations. |
| `ChartPluginState` | interface | `./ui/PluginHost` | Read-only chart state. |
| `ChartPluginUnstable` | interface | `./ui/PluginHost` | Escape hatches outside the stable plugin contract. |
| `ChartPluginViewport` | interface | `./ui/PluginHost` | Viewport reads, changes, and latest-X follow control. Changes go through the chart's `ViewportPolicy`. |
| `ChartPointerEvent` | interface | `./ui/Chart` | Pointer event payload expressed in both screen and data coordinates. |
| `ChartPointerEventType` | type | `./ui/Chart` | Pointer events that can be subscribed to through `Chart.subscribe`. |
| `ChartRect` | interface | `./ui/PluginHost` | A rectangle in CSS pixels. |
| `ChartRendererFactory` | type | `./render/ChartRenderer` | Creates the renderer for a chart. It may throw when its backend is unavailable. Use `canvas2dRenderer()` / `autoRenderer()` from `blazeplot/renderers/canvas2d`. |
| `ChartRendererFactoryContext` | interface | `./render/ChartRenderer` | Context passed to a renderer factory when a chart (re)creates its renderer. |
| `ChartRendererHandle` | interface | `./render/ChartRenderer` | Opaque renderer instance returned by a renderer factory. Only the built-in renderers implement it. |
| `ChartRendererKind` | type | `./render/ChartRenderer` | Rendering backend a chart is drawn with. |
| `ChartRenderLoop` | type | `./ui/Chart` | Render loop scheduling mode. |
| `ChartScreenshotOptions` | interface | `./ui/Chart` | Options for exporting the chart as an image blob. |
| `ChartSelectEvent` | interface | `./ui/Chart` | Selection event payload emitted by selection plugins or custom code. `null` means the selection was cleared. |
| `ChartSeriesClickEvent` | interface | `./ui/Chart` | Click payload for the nearest chart series item. |
| `ChartSeriesState` | interface | `./ui/Chart` | Runtime state for one chart series. |
| `ChartSeriesSummary` | interface | `./ui/ChartSummary` | Per-series facts in a `ChartSummary`. |
| `ChartSummary` | interface | `./ui/ChartSummary` | Data summary the chart exposes to assistive technology through `aria-describedby`. Pass `accessibility.description` as a function to turn it into your own text. |
| `ChartSummaryRange` | interface | `./ui/ChartSummary` | Inclusive numeric range used by `ChartSummary`. |
| `ChartSurface` | type | `./ui/PluginHost` | Chart-owned element a plugin can listen on or decorate with `ctx.dom.listen` and `ctx.dom.decorate`. - `"plot"`: the interactive plot surface (it receives pointer, wheel, and touch input). - `"root"`: the chart root; it is focusable and receives keyboard input when accessibility is enabled. - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters. They ignore pointer input until a plugin decorates them with `pointerEvents: "auto"`. |
| `ChartSurfaceDecoration` | interface | `./ui/PluginHost` | Styles, classes, and attributes applied to a chart surface by `ctx.dom.decorate`. |
| `ChartSurfaceStyle` | interface | `./ui/PluginHost` | Inline style properties a plugin may set on a chart surface. |
| `ChartTheme` | interface | `./ui/theme` | Partial chart theme supplied by callers. |
| `ChartTitleConfig` | interface | `./ui/Chart` | Chart title or subtitle text and alignment. |
| `ChartViewportChangeEvent` | interface | `./ui/Chart` | Emitted after the visible domain changes. |
| `CustomAxisScale` | interface | `./interaction/AxisController` | Custom scale hooks for tick generation, formatting, and coordinate mapping. |
| `Dataset` | interface | `./core/types` | Sorted XY data source consumed by chart series. |
| `DEFAULT_CHART_THEME` | const | `./ui/theme` | Default dark chart theme. |
| `DownsampleStrategy` | type | `./core/types` | Downsampling strategy used when a series is denser than the plot. |
| `histogram` | function | `./core/Histogram` | Convert one-dimensional finite values into histogram bins. |
| `HistogramBin` | interface | `./core/Histogram` | One histogram bucket, suitable for rendering as a bar centered at `x`. |
| `HistogramDataset` | class | `./core/Histogram` | Static histogram dataset that preserves each bucket's X interval for picks and tooltips. |
| `HistogramNormalization` | type | `./core/Histogram` | Histogram value normalization modes. |
| `HistogramOptions` | interface | `./core/Histogram` | Options for converting one-dimensional values into histogram bins. |
| `HistogramResult` | interface | `./core/Histogram` | Result of a histogram transform. |
| `HistogramSeriesConfig` | interface | `./ui/Chart` | `Chart.addHistogram(...)` config that bins raw one-dimensional values. |
| `InvalidOhlcSample` | interface | `./core/types` | An OHLC candle an `OhlcRingBuffer` skipped, passed to its `onInvalidSample` callback. |
| `InvalidSample` | interface | `./core/types` | A sample a streaming buffer skipped, passed to its `onInvalidSample` callback. |
| `InvalidSampleReason` | type | `./core/types` | Why a sample broke the dataset X rule (X finite and non-decreasing): `"non-finite-x"` for `NaN`/`Infinity`/`-Infinity`, `"decreasing-x"` for an X below the previous accepted X (or, for `update`, outside its neighbors). |
| `isWebGL2Available` | function | `./render/WebGL2Backend` | Return whether the current environment can create a WebGL2 context. |
| `LIGHT_CHART_THEME` | const | `./ui/theme` | Light chart theme. Pass it as `theme`, or spread it and override a few tokens. Text tokens meet a 4.5:1 and series, selection, crosshair, and focus colors a 3:1 contrast ratio against its background. |
| `MinMaxSegmentCopyDataset` | interface | `./core/types` | Optional high-performance min/max extraction capability for dense rendering. Implementations can use pyramids, segment trees, database aggregates, or analytic/procedural envelopes. Write up to `maxSegments` `[x - xOrigin, minY, maxY]` triples into `target` and return how many were written. |
| `MinMaxY` | interface | `./core/MinMaxTree` | Inclusive Y extent of a sample range. |
| `OhlcDataset` | interface | `./core/types` | Dataset that provides open, high, low, and close values per sample. |
| `OhlcRingBuffer` | class | `./core/OhlcDataset` | Fixed-capacity streaming buffer for OHLC/candlestick data. X must be finite and non-decreasing. A candle that breaks that rule is skipped (never thrown), counted in `rejectedSamples`, reported to `onInvalidSample`, and logged with one console warning per buffer when no callback is set. A candle with a non-finite price is stored and treated as a gap. |
| `OhlcRingBufferOptions` | interface | `./core/OhlcDataset` | Options for `OhlcRingBuffer`. |
| `PanIntent` | interface | `./interaction/types` | Pan request expressed in data units or screen pixels. |
| `PrecomputedHistogramSeriesConfig` | interface | `./ui/Chart` | `Chart.addHistogram(...)` config for bins computed with `histogram(...)`. |
| `RangeMinMaxDataset` | interface | `./core/types` | Dataset that can answer min/max Y queries for index ranges. |
| `RangeSampleCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for datasets that can copy raw samples without going through repeated getX/getY calls. Implement this for very large datasets, implicit-X datasets, or remote/memory-mapped sources. |
| `ResolvedChartTheme` | interface | `./ui/theme` | Fully resolved chart theme with concrete RGBA values. |
| `RgbaColor` | type | `./core/types` | RGBA color tuple with 0-1 channel values. |
| `RingBuffer` | class | `./core/RingBuffer` | Fixed-capacity sorted XY buffer for explicit X values. X must be finite and non-decreasing. A sample that breaks that rule is skipped (never thrown), counted in `rejectedSamples`, reported to `onInvalidSample`, and logged with one console warning per buffer when no callback is set. Non-finite Y is stored and drawn as a gap. |
| `RingBufferOptions` | interface | `./core/RingBuffer` | Options for `RingBuffer`. |
| `SampleCopyLayout` | type | `./core/types` | Vertex layout requested when copying raw samples into a render buffer: `"points"` writes `[x, y]` pairs, `"area"` writes `[x, baseline, x, y]` strip pairs. |
| `SeriesAppendData` | type | `./core/SeriesStore` | Any payload accepted by `SeriesStore.append`. |
| `SeriesAppendRow` | type | `./core/SeriesStore` | Any supported object row for batched appends. |
| `SeriesConfig` | interface | `./core/types` | Configuration for adding a series to a chart. |
| `SeriesDataBoundsOptions` | interface | `./core/SeriesStore` | X-range filter for `SeriesStore.dataBounds`. |
| `SeriesIdentityConfig` | type | `./ui/Chart` | Identity and axis options shared by series that build their own dataset. |
| `SeriesMode` | type | `./core/types` | Built-in renderer mode for a series. |
| `SeriesObjectAppendData` | type | `./core/SeriesStore` | Any object payload for appending one or more samples. |
| `SeriesOhlcAppendData` | interface | `./core/SeriesStore` | Object form for appending one OHLC sample or a batch of OHLC arrays. |
| `SeriesOhlcAppendRow` | interface | `./core/SeriesStore` | Convenient object-row form for appending one OHLC sample inside a row batch. |
| `SeriesOhlcSample` | interface | `./core/SeriesStore` | OHLC sample returned by series queries. |
| `SeriesOhlcUpdateData` | interface | `./core/SeriesStore` | Object form for updating one OHLC sample. |
| `SeriesReplaceData` | type | `./core/SeriesStore` | Payload accepted by `series.replace(...)`: whatever the backing dataset's `replace` method takes. |
| `SeriesSample` | interface | `./core/types` | One data sample returned by picking and dataset queries. |
| `SeriesScalarOrArray` | type | `./core/SeriesStore` | Single numeric sample value or a batch of values. |
| `SeriesStore` | class | `./core/SeriesStore` | Handle for one chart series: append or update its data, toggle visibility, and query samples. Create series with `chart.addLine(...)` and the other `chart.add*` helpers rather than constructing this class directly. |
| `SeriesStyle` | interface | `./core/types` | Fully resolved series style used by the renderer. |
| `SeriesStyleOptions` | interface | `./core/types` | Series styling accepted by `chart.addLine(config, style)` and the other `add*` helpers. |
| `SeriesUpdateData` | type | `./core/SeriesStore` | Any supported update payload for the last or indexed sample. |
| `SeriesXYAppendData` | interface | `./core/SeriesStore` | Object form for appending one XY sample or a batch of X/Y arrays. Omit `x` for implicit-X series. |
| `SeriesXYAppendRow` | interface | `./core/SeriesStore` | Convenient object-row form for appending one XY sample inside a row batch. |
| `SeriesXYUpdateData` | interface | `./core/SeriesStore` | Object form for updating one XY sample. |
| `SeriesYAxis` | type | `./core/types` | Y axis used to scale and render a series. |
| `ServerSampledBuckets` | interface | `./core/ServerSampledDataset` | Server-provided min/max buckets, each covering `[xStart, xEnd]`. |
| `ServerSampledData` | type | `./core/ServerSampledDataset` | Data accepted by `ServerSampledDataset` and `series.replace(...)`. |
| `ServerSampledDataset` | class | `./core/ServerSampledDataset` | Mutable dataset for viewport samples that were already reduced by a server. Use point data with `downsample: "none"`, or min/max buckets with `downsample: "server"` so BlazePlot renders the supplied buckets directly instead of applying another client-side sampler. Swap in fresh data after each fetch with `series.replace(data)`. Point X, bucket `xStart`, and bucket `xEnd` must each be finite and non-decreasing, and every bucket needs `xEnd >= xStart` (buckets may overlap). The constructor and `replace` throw a `RangeError` naming the first bad index and keep the current data. |
| `ServerSampledPoints` | interface | `./core/ServerSampledDataset` | Server-provided point samples. |
| `StaticDataset` | class | `./core/StaticDataset` | Sorted XY dataset backed by typed arrays, which are read in place rather than copied. X must be finite and non-decreasing: the constructor and `replace` check it in one pass and throw a `RangeError` naming the first bad index. Use `StaticDataset.sorted(x, y)` for unsorted input, or `{ assumeSorted: true }` to skip the check. Non-finite Y is a gap. Change the data with `series.replace({ y })`, or overwrite the arrays and call `series.markDirty()` (in-place edits are not re-checked). |
| `StaticDatasetData` | interface | `./core/StaticDataset` | Data accepted by `StaticDataset.replace` and `series.replace(...)`. |
| `StaticDatasetField` | type | `./core/StaticDataset` | Object-row field selector used by `StaticDataset.fromObjects`. |
| `StaticDatasetFromObjectsOptions` | interface | `./core/StaticDataset` | Options for building a static dataset from object rows. |
| `StaticDatasetOptions` | interface | `./core/StaticDataset` | Options for the `StaticDataset` constructor. |
| `StaticDatasetSortedOptions` | interface | `./core/StaticDataset` | Options for `StaticDataset.sorted`. |
| `StaticOhlcDataset` | class | `./core/OhlcDataset` | Immutable OHLC dataset backed by parallel arrays. X must be finite and non-decreasing; the constructor checks it and throws a `RangeError` naming the first bad index. A candle with any non-finite price is a gap. |
| `StaticOhlcDatasetOptions` | interface | `./core/OhlcDataset` | Options for `StaticOhlcDataset`. |
| `StaticOhlcDatasetSortedOptions` | interface | `./core/OhlcDataset` | Options for `StaticOhlcDataset.sorted`. |
| `TextOverlayConfig` | interface | `./ui/Chart` | Text and styling for an axis title. |
| `ThemeColor` | type | `./core/types` | Any CSS color string (`"#3b82f6"`, `"rgb(59 130 246)"`, `"var(--accent)"`) or an RGBA tuple. |
| `TimeRange` | interface | `./core/types` | Inclusive data X range. |
| `TypedSeriesConfig` | type | `./ui/Chart` | Series configuration used by typed helpers such as `addLine`. |
| `UniformRingBuffer` | class | `./core/UniformRingBuffer` | High-throughput ring buffer for uniformly spaced X values. Store only Y samples and derive X as `xStart + index * xStep`. This is the fastest built-in dataset for live telemetry, signals, and other fixed-rate streams because appends copy a single typed array and min/max extraction uses a block segment tree over the physical ring. Derived X is always finite and ascending, so no sample is ever rejected. X passed to `push`/`append` only seeds the stream; a non-finite seed is ignored with one console warning per buffer and the Y sample is still stored. Non-finite Y is a gap. |
| `UniformRingBufferOptions` | interface | `./core/UniformRingBuffer` | Options for implicit-X streaming buffers. |
| `UpdatableDataset` | interface | `./core/types` | Dataset that supports updating existing X/Y samples. |
| `ValuePrecision` | type | `./core/types` | Storage for Y and OHLC price values. `"float32"` (the default) halves memory and keeps about 7 significant digits; `"float64"` stores values exactly, for large prices, counters, or timestamps where float32 rounding would show in tooltips and picks. |
| `Viewport` | interface | `./core/types` | Visible data-domain bounds for one chart camera. |
| `ViewportPolicy` | interface | `./interaction/types` | Optional hooks that can constrain or react to viewport changes. |
| `VisiblePointCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for point/scatter datasets. Implementations should cull against the full 2D viewport and may sample in screen space so dense point clouds respond to both X and Y zoom. |
| `VisibleSampleCopyDataset` | interface | `./core/types` | Optional high-performance stable visible sampling capability. Unlike copySamplesRange, this method may stride/downsample, but should choose samples anchored to data coordinates so streamed appends do not make existing sampled points jitter. |
| `WebGL2UnavailableError` | class | `./render/WebGL2Backend` | Error thrown when a WebGL2 backend cannot be created. |
| `XRange` | interface | `./core/types` | Data-domain X interval represented by one dataset sample. |
| `XRangeDataset` | interface | `./core/types` | Dataset whose sample X values represent intervals rather than points. |
| `YAppendableDataset` | interface | `./core/types` | Dataset that accepts appended Y samples with implicit X values. |
| `YUpdatableDataset` | interface | `./core/types` | Dataset that supports updating existing Y values. |
| `ZoomAxis` | type | `./interaction/types` | Axis affected by a zoom operation. |
| `ZoomIntent` | interface | `./interaction/types` | Zoom request with a scale factor and optional anchor point. |
