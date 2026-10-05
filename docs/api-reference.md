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
| root entry | `dist/index.js` | 21 KiB |
| linked entry | `dist/linked.js` | 2 KiB |
| data entry | `dist/data.js` | 2 KiB |
| export entry | `dist/export.js` | 4 KiB |
| interactions plugin | `dist/plugins/interactions.js` | 15 KiB |
| annotations plugin | `dist/plugins/annotations.js` | 15 KiB |
| navigator plugin | `dist/plugins/navigator.js` | 10 KiB |
| selection plugin | `dist/plugins/selection.js` | 8 KiB |
| legend plugin | `dist/plugins/legend.js` | 5 KiB |
| tooltip plugin | `dist/plugins/tooltip.js` | 4 KiB |
| crosshair plugin | `dist/plugins/crosshair.js` | 9 KiB |
| flamegraph plugin | `dist/plugins/flamegraph.js` | 17 KiB |
| a11y plugin | `dist/plugins/a11y.js` | 11 KiB |
| shared Chart chunk (Chart + every engine) | `dist/Chart-*.js` | 170 KiB |
| shared theme chunk | `dist/theme-*.js` | 7 KiB |
| lazy screenshot chunk | `dist/screenshot-*.js` | 6 KiB |
| shared OverlayUtils chunk | `dist/OverlayUtils-*.js` | 2 KiB |
| shared PickOverlay chunk | `dist/PickOverlay-*.js` | 5 KiB |
| chart-only import graph (index + Chart + engines + theme) | `dist/index.js` | 197 KiB |

### All public exports

Generated from `dist/index.d.ts` after the package build.

| Export | Kind | Source | JSDoc summary |
|---|---|---|---|
| `AcceleratedDataset` | interface | `./core/types` | Convenience contract for maximum-performance custom datasets. Implement this when a dataset can provide fast exact sample copies, stable viewport sampling, range min/max queries, and renderer-ready min/max buckets. |
| `AppendableDataset` | interface | `./core/types` | Dataset that accepts appended X/Y samples; implementations may store X values explicitly or use them to seed implicit X spacing. |
| `autoRenderer` | function | `./render/engines` | Renderer factory that uses WebGL2 and falls back to Canvas 2D when WebGL2 is unavailable or its context cannot be created. `chart.rendererInfo.fallbackFrom` says when the fallback happened. Same as `renderer: "auto"`, the default. |
| `AxisConfig` | type | `./ui/Chart` | — |
| `AxisControllerAxisOptions` | interface | `./interaction/AxisController` | Scale and formatting options for one axis. |
| `AxisPosition` | type | `./ui/ChartOptions` | Whether an axis draws its tick labels inside the plot or in a gutter outside it. |
| `AxisRenderTarget` | type | `./interaction/AxisController` | Axis dimension targeted by axis helpers. |
| `AxisScale` | type | `./interaction/AxisController` | Built-in scale name or custom scale implementation. |
| `AxisTickFormat` | type | `./interaction/AxisController` | Built-in format string or custom tick formatter. |
| `AxisTickFormatter` | type | `./interaction/AxisController` | Function form for formatting axis tick values. |
| `AxisTimeZone` | type | `./interaction/timeAxis` | Time axis math: the tick interval ladder, flooring and advancing dates in local or UTC time, and tick label formatting (patterns and the automatic two-level labels). Pure functions, no camera. Time zone used for built-in time tick formatting. |
| `BufferOverflowStrategy` | type | `./core/types` | Behavior when a fixed-capacity streaming buffer is full. |
| `BuiltInAxisScale` | type | `./interaction/AxisController` | Built-in axis scale names. |
| `Camera2D` | class | `./interaction/Camera2D` | Camera that maps data domains to clip, screen, and plot coordinates. |
| `canvas2dRenderer` | function | `./render/engines` | Renderer factory for Canvas 2D: no WebGL2 needed, lower throughput. Throws `Canvas2DUnavailableError` without a 2D context. Same as `renderer: "canvas2d"`. |
| `Canvas2DUnavailableError` | class | `./render/canvas2d/Canvas2DRenderer` | Error thrown when a Canvas 2D renderer cannot be created. |
| `Chart` | class | `./ui/Chart` | Imperative chart instance for rendering, interaction, and plugins. This file is intentionally the one large module (about 870 lines): it is the public facade, and most of its length is the documented public API (series, viewport, follow, fit, hover/pick, theme, lifecycle). The logic lives in focused collaborators (ChartPicker, ChartHover, ChartAccessibility, ChartSeriesStyles, ChartFit, FollowXController, ChartEmitter, PluginHost, SeriesPainter, ChartLayout) that this class wires. |
| `ChartAccessibilityMessages` | type | `./ui/Chart` | — |
| `ChartAccessibilityOptions` | type | `./ui/Chart` | — |
| `ChartAutoFitYOptions` | type | `./ui/Chart` | — |
| `ChartEventMap` | type | `./ui/Chart` | — |
| `ChartEventName` | type | `./ui/Chart` | — |
| `ChartFitToDataOptions` | type | `./ui/Chart` | — |
| `ChartFitToDataPadding` | type | `./ui/Chart` | — |
| `ChartFollowXChangeEvent` | type | `./ui/Chart` | — |
| `ChartFollowXOptions` | type | `./ui/Chart` | — |
| `ChartFollowXState` | type | `./ui/Chart` | — |
| `ChartFrameStats` | type | `./ui/Chart` | — |
| `ChartHoverState` | type | `./ui/Chart` | — |
| `ChartInspectionTarget` | type | `./ui/Chart` | — |
| `ChartLayoutReservation` | interface | `./ui/PluginTypes` | Extra CSS-pixel space reserved around the plot by a plugin, e.g. for a navigator or toolbar. Reservations from every plugin add up. |
| `ChartMountSlot` | type | `./ui/PluginTypes` | Where a plugin can attach its own DOM with `ctx.dom.mount(slot, element)`. - `"plot"`: the plot area, above the WebGL canvas. Coordinates match `ctx.coords` plot coordinates (CSS pixels from the plot's top-left). Overlays here should keep `pointer-events: none` unless they handle their own input. - `"root"`: the whole chart box, including axis gutters and space reserved with `ctx.layout.reserve(...)`. Use it for legends, toolbars, and navigators. - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters (bottom, left, right). - `"body"`: the owning document's `<body>`, for `position: fixed` UI such as tooltips that must escape the chart's `overflow: hidden`. |
| `ChartOptions` | type | `./ui/Chart` | — |
| `ChartPickGroup` | type | `./ui/Chart` | — |
| `ChartPickItem` | type | `./ui/Chart` | — |
| `ChartPickMode` | type | `./ui/Chart` | — |
| `ChartPickOptions` | type | `./ui/Chart` | — |
| `ChartPlotSize` | interface | `./ui/PluginTypes` | Plot-area size in CSS pixels, passed to `ChartPluginHandle.onResize`. |
| `ChartPlugin` | interface | `./ui/PluginTypes` | Plugin installer for extending chart behavior. |
| `ChartPluginContext` | interface | `./ui/PluginTypes` | The API a plugin receives in `install(ctx)`. Each plugin gets its own context; listeners, subscriptions, mounted elements, decorations, and layout reservations created through it are released automatically after the plugin is disposed. |
| `ChartPluginCoords` | interface | `./ui/PluginTypes` | Coordinate conversions between data, plot, and client (viewport) space. |
| `ChartPluginDom` | interface | `./ui/PluginTypes` | DOM attachment and input on chart-owned elements. Everything is released when the plugin is disposed. |
| `ChartPluginEventMap` | interface | `./ui/ChartEvents` | Events plugins may emit with `ctx.events.emit(...)`. Chart users receive them through `chart.subscribe(...)`, because `ChartEventMap` extends this map. Third-party plugins add their own events with declaration merging. Prefix names with your plugin name to avoid collisions: ```ts declare module "blazeplot" { interface ChartPluginEventMap { "my-plugin:change": { readonly value: number }; } } ``` |
| `ChartPluginEventName` | type | `./ui/ChartEvents` | Name of an event a plugin may emit. |
| `ChartPluginEvents` | interface | `./ui/PluginTypes` | Chart event subscription and typed plugin events. |
| `ChartPluginHandle` | interface | `./ui/PluginTypes` | Object a plugin's `install` may return. Every member is optional. Hooks run in plugin registration order; `dispose` runs in reverse registration order. |
| `ChartPluginLayout` | interface | `./ui/PluginTypes` | Layout geometry and space reservations. |
| `ChartPluginState` | interface | `./ui/PluginTypes` | Read-only chart state. |
| `ChartPluginUnstable` | interface | `./ui/PluginTypes` | Escape hatches outside the stable plugin contract. |
| `ChartPluginViewport` | interface | `./ui/PluginTypes` | Viewport reads, changes, and latest-X follow control. Changes go through the chart's `ViewportPolicy`. |
| `ChartPointerEvent` | type | `./ui/Chart` | — |
| `ChartPointerEventType` | type | `./ui/Chart` | — |
| `ChartRect` | interface | `./ui/PluginTypes` | A rectangle in CSS pixels. |
| `ChartRenderContext` | type | `./render/engines` | — |
| `ChartRendererCapabilities` | interface | `./render/ChartRenderer` | Static facts about the engine a chart draws with. |
| `ChartRendererFactory` | type | `./render/ChartRenderer` | Creates the renderer for a chart. It may throw when its backend is unavailable. The built-in factories are `webgl2Renderer()`, `canvas2dRenderer()`, `sharedRenderer()`, and `autoRenderer()`. |
| `ChartRendererFactoryContext` | interface | `./render/ChartRenderer` | Context passed to a renderer factory when a chart (re)creates its renderer. |
| `ChartRendererHandle` | interface | `./render/ChartRenderer` | Opaque renderer instance returned by a renderer factory. Only the built-in renderers implement it. |
| `ChartRendererInfo` | interface | `./render/ChartRenderer` | Which engine a chart ended up with, what was asked for, and what that engine can do. |
| `ChartRendererKind` | type | `./render/ChartRenderer` | Rendering backend a chart is drawn with. |
| `ChartRenderLoop` | type | `./ui/Chart` | — |
| `ChartRenderSurface` | interface | `./render/ChartRenderer` | A drawing surface a plugin owns, drawn with the chart's rendering engine: WebGL2, Canvas 2D, or the shared WebGL2 context. Get one from `ctx.unstable.createRenderSurface(canvas)`. A frame is `beginFrame`, any number of `fillRects`, then `endFrame`. Everything is in device pixels with the origin at the canvas's top-left corner, so size the canvas in device pixels first. |
| `ChartScreenshotOptions` | type | `./ui/Chart` | — |
| `ChartSelectEvent` | type | `./ui/Chart` | — |
| `ChartSeriesClickEvent` | type | `./ui/Chart` | — |
| `ChartSeriesState` | type | `./ui/Chart` | — |
| `ChartSeriesSummary` | interface | `./ui/ChartSummary` | Per-series facts in a `ChartSummary`. |
| `ChartSetViewportOptions` | type | `./ui/Chart` | — |
| `ChartSummary` | interface | `./ui/ChartSummary` | Data summary the chart exposes to assistive technology through `aria-describedby`. Pass `accessibility.description` as a function to turn it into your own text. |
| `ChartSummaryMessages` | interface | `./ui/ChartSummary` | Strings and formatters behind the generated chart summary. Override any key through `accessibility.messages.summary`; unset keys keep the English default. |
| `ChartSummaryRange` | interface | `./ui/ChartSummary` | Inclusive numeric range used by `ChartSummary`. |
| `ChartSurface` | type | `./ui/PluginTypes` | Chart-owned element a plugin can listen on or decorate with `ctx.dom.listen` and `ctx.dom.decorate`. - `"plot"`: the interactive plot surface (it receives pointer, wheel, and touch input). - `"root"`: the chart root; it is focusable and receives keyboard input when accessibility is enabled. - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters. They ignore pointer input until a plugin decorates them with `pointerEvents: "auto"`. |
| `ChartSurfaceDecoration` | interface | `./ui/PluginTypes` | Styles, classes, and attributes applied to a chart surface by `ctx.dom.decorate`. |
| `ChartSurfaceStyle` | interface | `./ui/PluginTypes` | Inline style properties a plugin may set on a chart surface. |
| `ChartTheme` | interface | `./ui/theme` | Partial chart theme supplied by callers. |
| `ChartTitleConfig` | type | `./ui/Chart` | — |
| `ChartViewportChangeEvent` | type | `./ui/Chart` | — |
| `ChartViewportChangeSource` | type | `./ui/Chart` | — |
| `ChartViewportGestureOptions` | type | `./ui/Chart` | — |
| `createChartRenderContext` | function | `./render/engines` | Create a render context: one hidden WebGL2 context shared by every chart that uses `context.renderer()`. Charts keep their own visible canvas, so the page holds a single WebGL context however many charts it mounts. |
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
| `InvalidOhlcSample` | interface | `./core/types` | An OHLC candle an `OhlcRingBuffer` skipped, passed to its `onInvalidSample` callback. |
| `InvalidSample` | interface | `./core/types` | A sample a streaming buffer skipped, passed to its `onInvalidSample` callback. |
| `InvalidSampleReason` | type | `./core/types` | Why a sample broke the dataset X rule (X finite and non-decreasing): `"non-finite-x"` for `NaN`/`Infinity`/`-Infinity`, `"decreasing-x"` for an X below the previous accepted X (or, for `update`, outside its neighbors). |
| `isWebGL2Available` | function | `./render/webgl2/availability` | Return whether the current environment can create a WebGL2 context. The probe canvas comes from `doc` (default: the global `document`); pass an iframe or popup document to probe that window. |
| `LIGHT_CHART_THEME` | const | `./ui/theme` | Light chart theme. Pass it as `theme`, or spread it and override a few tokens. Text tokens meet a 4.5:1 and series, selection, crosshair, and focus colors a 3:1 contrast ratio against its background. |
| `MinMaxSegmentCopyDataset` | interface | `./core/types` | Optional high-performance min/max extraction capability for dense rendering. Implementations can use pyramids, segment trees, database aggregates, or analytic/procedural envelopes. Write up to `maxSegments` `[x - xOrigin, minY, maxY]` triples into `target` and return how many were written. |
| `MinMaxY` | interface | `./core/MinMaxTree` | Inclusive Y extent of a sample range. |
| `OhlcDataset` | interface | `./core/types` | Dataset that provides open, high, low, and close values per sample. |
| `OhlcRingBuffer` | class | `./core/OhlcDataset` | Fixed-capacity streaming buffer for OHLC/candlestick data. X must be finite and non-decreasing. A candle that breaks that rule is skipped (never thrown), counted in `rejectedSamples`, reported to `onInvalidSample`, and logged with one console warning per buffer when no callback is set. A candle with a non-finite price is stored and treated as a gap. |
| `OhlcRingBufferOptions` | interface | `./core/OhlcDataset` | Options for `OhlcRingBuffer`. |
| `PanIntent` | interface | `./interaction/types` | Pan request expressed in data units or screen pixels. |
| `RangeMinMaxDataset` | interface | `./core/types` | Dataset that can answer min/max Y queries for index ranges. |
| `RangeSampleCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for datasets that can copy raw samples without going through repeated getX/getY calls. Implement this for very large datasets, implicit-X datasets, or remote/memory-mapped sources. |
| `RendererChoice` | type | `./render/ChartRenderer` | What `ChartOptions.renderer` can ask for: an engine by name, or `"auto"` (WebGL2, else Canvas 2D). |
| `RendererLossState` | type | `./render/ChartRenderer` | Context state transitions an engine reports to the chart that owns it. |
| `RendererName` | type | `./render/ChartRenderer` | A built-in rendering engine: WebGL2, Canvas 2D, or WebGL2 through a context shared with other charts. |
| `ResolvedChartTheme` | interface | `./ui/theme` | Fully resolved chart theme with concrete RGBA values. |
| `RgbaColor` | type | `./core/types` | RGBA color tuple with 0-1 channel values. |
| `RingBuffer` | class | `./core/RingBuffer` | Fixed-capacity sorted XY buffer for explicit X values. X must be finite and non-decreasing. A sample that breaks that rule is skipped (never thrown), counted in `rejectedSamples`, reported to `onInvalidSample`, and logged with one console warning per buffer when no callback is set. Non-finite Y is stored and drawn as a gap. |
| `RingBufferOptions` | interface | `./core/RingBuffer` | Options for `RingBuffer`. |
| `SampleCopyLayout` | type | `./core/types` | Vertex layout requested when copying raw samples into a render buffer: `"points"` writes `[x, y]` pairs, `"area"` writes `[x, baseline, x, y]` strip pairs. |
| `SeriesAppendData` | type | `./core/SeriesInput` | Any payload accepted by `SeriesStore.append`. |
| `SeriesAppendRow` | type | `./core/SeriesInput` | Any supported object row for batched appends. |
| `SeriesConfig` | interface | `./core/types` | Configuration for adding a series to a chart. |
| `SeriesDataBoundsOptions` | interface | `./core/SeriesStore` | X-range filter for `SeriesStore.dataBounds`. |
| `SeriesIdentityConfig` | type | `./ui/Chart` | — |
| `SeriesMode` | type | `./core/types` | Built-in renderer mode for a series. |
| `SeriesObjectAppendData` | type | `./core/SeriesInput` | Any object payload for appending one or more samples. |
| `SeriesOhlcAppendData` | interface | `./core/SeriesInput` | Object form for appending one OHLC sample or a batch of OHLC arrays. |
| `SeriesOhlcAppendRow` | interface | `./core/SeriesInput` | Convenient object-row form for appending one OHLC sample inside a row batch. |
| `SeriesOhlcSample` | interface | `./core/SeriesStore` | OHLC sample returned by series queries. |
| `SeriesOhlcUpdateData` | interface | `./core/SeriesInput` | Object form for updating one OHLC sample. |
| `SeriesReplaceData` | type | `./core/SeriesInput` | Payload accepted by `series.replace(...)`: whatever the backing dataset's `replace` method takes. |
| `SeriesSample` | interface | `./core/types` | One data sample returned by picking and dataset queries. |
| `SeriesScalarOrArray` | type | `./core/SeriesInput` | Single numeric sample value or a batch of values. |
| `SeriesStore` | class | `./core/SeriesStore` | Handle for one chart series: append or update its data, toggle visibility, and query samples. Create series with `chart.addLine(...)` and the other `chart.add*` helpers rather than constructing this class directly. The class owns the series' identity, style, visibility, and mutation API. Reading the data back for rendering and picking is delegated to the `SeriesSampler`, `ScatterSampler`, and `SeriesPicker` helpers, which share one `SeriesSource` view of the dataset. |
| `SeriesStyle` | interface | `./core/types` | Fully resolved series style used by the renderer. |
| `SeriesStyleOptions` | interface | `./core/types` | Series styling accepted by `chart.addLine(config, style)` and the other `add*` helpers. |
| `SeriesUpdateData` | type | `./core/SeriesInput` | Any supported update payload for the last or indexed sample. |
| `SeriesXYAppendData` | interface | `./core/SeriesInput` | Object form for appending one XY sample or a batch of X/Y arrays. Omit `x` for implicit-X series. |
| `SeriesXYAppendRow` | interface | `./core/SeriesInput` | Convenient object-row form for appending one XY sample inside a row batch. |
| `SeriesXYUpdateData` | interface | `./core/SeriesInput` | Object form for updating one XY sample. |
| `SeriesYAxis` | type | `./core/types` | Y axis used to scale and render a series. |
| `ServerSampledBuckets` | interface | `./core/ServerSampledDataset` | Server-provided min/max buckets, each covering `[xStart, xEnd]`. |
| `ServerSampledData` | type | `./core/ServerSampledDataset` | Data accepted by `ServerSampledDataset` and `series.replace(...)`. |
| `ServerSampledDataset` | class | `./core/ServerSampledDataset` | Mutable dataset for viewport samples that were already reduced by a server. Use point data with `downsample: "none"`, or min/max buckets with `downsample: "server"` so BlazePlot renders the supplied buckets directly instead of applying another client-side sampler. Swap in fresh data after each fetch with `series.replace(data)`. Point X, bucket `xStart`, and bucket `xEnd` must each be finite and non-decreasing, and every bucket needs `xEnd >= xStart` (buckets may overlap). The constructor and `replace` throw a `RangeError` naming the first bad index and keep the current data. |
| `ServerSampledPoints` | interface | `./core/ServerSampledDataset` | Server-provided point samples. |
| `sharedRenderer` | function | `./render/engines` | Renderer factory backed by a WebGL2 context shared between charts. Without an argument every chart on the document shares one context; pass a context from `createChartRenderContext()` to group charts. Throws `WebGL2UnavailableError` when WebGL2 is unavailable. Same as `renderer: "shared"`. |
| `StaticDataset` | class | `./core/StaticDataset` | Sorted XY dataset backed by typed arrays, which are read in place rather than copied. X must be finite and non-decreasing: the constructor and `replace` check it in one pass and throw a `RangeError` naming the first bad index. Use `StaticDataset.sorted(x, y)` for unsorted input, or `{ assumeSorted: true }` to skip the check. Non-finite Y is a gap. Change the data with `series.replace({ y })`, or overwrite the arrays and call `series.markDirty()` (in-place edits are not re-checked). |
| `StaticDatasetData` | interface | `./core/StaticDataset` | Data accepted by `StaticDataset.replace` and `series.replace(...)`. |
| `StaticDatasetField` | type | `./core/StaticDataset` | Object-row field selector used by `StaticDataset.fromObjects`. |
| `StaticDatasetFromObjectsOptions` | interface | `./core/StaticDataset` | Options for building a static dataset from object rows. |
| `StaticDatasetOptions` | interface | `./core/StaticDataset` | Options for the `StaticDataset` constructor. |
| `StaticDatasetSortedOptions` | interface | `./core/StaticDataset` | Options for `StaticDataset.sorted`. |
| `StaticOhlcDataset` | class | `./core/OhlcDataset` | Immutable OHLC dataset backed by parallel arrays. X must be finite and non-decreasing; the constructor checks it and throws a `RangeError` naming the first bad index. A candle with any non-finite price is a gap. |
| `StaticOhlcDatasetOptions` | interface | `./core/OhlcDataset` | Options for `StaticOhlcDataset`. |
| `StaticOhlcDatasetSortedOptions` | interface | `./core/OhlcDataset` | Options for `StaticOhlcDataset.sorted`. |
| `TextOverlayConfig` | type | `./ui/Chart` | — |
| `ThemeColor` | type | `./core/types` | Any CSS color string (`"#3b82f6"`, `"rgb(59 130 246)"`, `"var(--accent)"`) or an RGBA tuple. |
| `TimeRange` | interface | `./core/types` | Inclusive data X range. |
| `TypedSeriesConfig` | type | `./ui/Chart` | — |
| `UniformRingBuffer` | class | `./core/UniformRingBuffer` | High-throughput ring buffer for uniformly spaced X values. Store only Y samples and derive X as `xStart + index * xStep`. This is the fastest built-in dataset for live telemetry, signals, and other fixed-rate streams because appends copy a single typed array and min/max extraction uses a block segment tree over the physical ring. Derived X is always finite and ascending, so no sample is ever rejected. X passed to `push`/`append` only seeds the stream; a non-finite seed is ignored with one console warning per buffer and the Y sample is still stored. Non-finite Y is a gap. |
| `UniformRingBufferOptions` | interface | `./core/UniformRingBuffer` | Options for implicit-X streaming buffers. |
| `UpdatableDataset` | interface | `./core/types` | Dataset that supports updating existing X/Y samples. |
| `ValuePrecision` | type | `./core/types` | Storage for Y and OHLC price values. `"float32"` (the default) halves memory and keeps about 7 significant digits; `"float64"` stores values exactly, for large prices, counters, or timestamps where float32 rounding would show in tooltips and picks. |
| `Viewport` | interface | `./core/types` | Visible data-domain bounds for one chart camera. |
| `ViewportPolicy` | interface | `./interaction/ViewportPolicy` | Optional hooks that can constrain or react to viewport changes. |
| `VisiblePointCopyDataset` | interface | `./core/types` | Optional high-performance extraction capability for point/scatter datasets. Implementations should cull against the full 2D viewport and may sample in screen space so dense point clouds respond to both X and Y zoom. |
| `VisibleSampleCopyDataset` | interface | `./core/types` | Optional high-performance stable visible sampling capability. Unlike copySamplesRange, this method may stride/downsample, but should choose samples anchored to data coordinates so streamed appends do not make existing sampled points jitter. |
| `webgl2Renderer` | function | `./render/engines` | Renderer factory for WebGL2. Throws `WebGL2UnavailableError` when WebGL2 is unavailable. Same as `renderer: "webgl2"`. |
| `WebGL2UnavailableError` | class | `./render/webgl2/availability` | Error thrown when a WebGL2 backend cannot be created. |
| `XRange` | interface | `./core/types` | Data-domain X interval represented by one dataset sample. |
| `XRangeDataset` | interface | `./core/types` | Dataset whose sample X values represent intervals rather than points. |
| `YAppendableDataset` | interface | `./core/types` | Dataset that accepts appended Y samples with implicit X values. |
| `YUpdatableDataset` | interface | `./core/types` | Dataset that supports updating existing Y values. |
| `ZoomAxis` | type | `./interaction/types` | Axis affected by a zoom operation. |
| `ZoomIntent` | interface | `./interaction/types` | Zoom request with a scale factor and optional anchor point. |
