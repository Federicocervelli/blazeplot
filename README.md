<p align="center">
  <img src="assets/blazeplot.png" alt="BlazePlot" width="720" />
</p>

<noscript><a href="https://liberapay.com/cervelli/donate"><img src="https://img.shields.io/liberapay/patrons/cervelli.svg?logo=liberapay"></a></noscript>
[![npm version](https://img.shields.io/npm/v/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![npm downloads](https://img.shields.io/npm/dt/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![previews](https://img.shields.io/badge/previews-blue?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI%2BPHBhdGggZmlsbD0iI2ZmN2ExOCIgZD0iTTMzIDNjNCAxMyAyMCAxOSAyMCAzNiAwIDEzLTEwIDIyLTIyIDIyUzkgNTIgOSAzOWMwLTEwIDYtMTggMTQtMjUtMSA4IDIgMTIgNiAxNSAyLTEwIDQtMTggNC0yNnoiLz48cGF0aCBmaWxsPSIjZmZkMTY2IiBkPSJNMzQgMjdjNSA3IDExIDEwIDExIDIwIDAgOC02IDE0LTE0IDE0cy0xNC02LTE0LTE0YzAtNiAzLTExIDgtMTUgMCA1IDIgOCA1IDEwIDEtNiAzLTExIDQtMTV6Ii8%2BPC9zdmc%2B)](https://blazeplot.cervelli.dev/previews)

Fast WebGL2 plotting engine for the browser.

Built for people who have hit the performance ceiling of Chart.js, Plotly, and similar browser charting libraries. BlazePlot keeps the hot path GPU-native and the DOM minimal, so large streaming datasets stay interactive instead of turning into a slideshow.

Built on native WebGL2 with no rendering runtime dependency.

## Performance

The core chart runtime is intentionally compact: the production build for `blazeplot` (without optional plugins) is about **139 KiB raw / 34 KiB gzip**. Optional plugins and helpers ship as separate subpath entries.

A minimal 1,000-point line chart renders its first frame in about **0.3 ms median / 0.5 ms p95** of render work (640×360 canvas, HeadlessChrome 148, SwiftShader). Chart construction and WebGL setup takes about **19 ms median**.

Size and first-draw comparison (vendor-published figures, best value bolded):

| Library | Version | Size | First draw |
|---|---:|---:|---:|
| **BlazePlot** | 0.3.5 | **139 KiB raw / 34 KiB gzip** | **0.3 ms render** (19 ms setup) |
| Chart.js | 4.5.1 | 1,562 KB tarball (5.9 MB unpacked) | — |
| Plotly.js | 3.5.0 | 4.6 MB min (1.4 MB gzip) | — |
| LightningChart JS | 5.2.1 | 1.2–1.5 MB JS (25.5 MB unpacked) | — |
| SciChart.js | 5.x | 1.9 MB JS + ~1 MB WASM | ~250 ms init |

References: BlazePlot — [this release build](https://github.com/Federicocervelli/blazeplot) and local benchmark. Chart.js — [v4.5.1](https://github.com/chartjs/Chart.js/releases/tag/v4.5.1). Plotly.js — [v3.5.0](https://github.com/plotly/plotly.js/tree/v3.5.0). LightningChart JS — [v5.2.1](https://www.npmjs.com/package/@arction/lcjs). SciChart.js — [v5](https://www.npmjs.com/package/scichart).

## Installation

```bash
bun add blazeplot
# or: npm install blazeplot
```

## Quick start

A chart only needs a host element. For regular arrays, wrap your data in a `StaticDataset`; `capacity` is only needed when you want a streaming ring buffer.

```html
<div id="chart" style="width:100%;height:400px"></div>

<script type="module">
  import { Chart, StaticDataset } from "blazeplot";

  const el = document.getElementById("chart");
  if (!el) throw new Error("Missing #chart element");

  const x = Array.from({ length: 1000 }, (_, i) => i);
  const y = x.map((value) => Math.sin(value * 0.02));

  const chart = new Chart(el);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "sine" });
  chart.setViewport({ xMin: x[0], xMax: x[x.length - 1], yMin: -1.5, yMax: 1.5 });
  chart.start();
</script>
```

## Features

| | |
|---|---|
| **WebGL2 rendering** | GPU-accelerated plot rendering from the ground up. No Canvas2D fallback. Axis labels use lightweight DOM layers. |
| **Flexible data model** | Streaming ring buffer or static arrays. Bring your own data shape. |
| **LOD downsampling** | Min/max pyramid for efficient line rendering at any zoom level — sparse views show raw points, dense views show vertical segments. Server-pre-sampled min/max buckets can also be rendered directly with `ServerSampledDataset`. |
| **Pan & zoom** | Pointer/touch pan and wheel zoom via `Camera2D`. Customizable viewport policies. |
| **Grid lines** | Data-anchored grid rendered as WebGL line lists. |
| **Axis labels** | Smart tick generation with DOM labels. Per-axis `inside`/`outside` positioning; outside axes reserve real layout gutters. |
| **Multi-series** | Independent buffers, styles, and visibility per series. Line, area, scatter, bar, OHLC, and candlestick modes are supported. |
| **Plugin-ready UI** | Optional built-in legend, tooltip, interactions, annotations, selection, crosshair, and navigator plugins use the same public APIs available to custom plugins. |
| **React and linked charts** | First-party `blazeplot/react` and `blazeplot/linked` subpaths support React usage and synchronized multi-panel layouts. |
| **Export helpers** | `chart.screenshot()` composites WebGL output with built-in DOM/SVG overlays. `blazeplot/data` provides lightweight CSV/JSON data export and pure transform helpers; `blazeplot/export` provides download/clipboard helpers. |
| **Frame stats** | `chart.getFrameStats()` reports fps, frame time, vertex count, and draw calls for custom diagnostics. |
| **ResizeObserver** | Automatic DPR-aware canvas sizing. |

## Data export and transforms

Use the tree-shakable `blazeplot/data` subpath when you only need data helpers. It collects raw rows from the current visible x range, a committed selection plugin state, or the full chart, then serializes them as CSV or JSON.

```ts
import { Chart } from "blazeplot";
import { chartDataToCSV, chartDataToJSON, exportSelectedChartData, exportVisibleChartData, rollingMean } from "blazeplot/data";
import { downloadBlob } from "blazeplot/export";
import { selectionPlugin } from "blazeplot/plugins/selection";

const selection = selectionPlugin();
const chart = new Chart(element, { plugins: [selection] });

const visible = exportVisibleChartData(chart);
const csv = chartDataToCSV(visible);

const selectedRange = selection.getSelection();
const selectedJson = selectedRange
  ? chartDataToJSON(exportSelectedChartData(chart, selectedRange))
  : "[]";

const smoothed = rollingMean(visible.series[0]?.samples ?? [], 5);
downloadBlob(new Blob([csv], { type: "text/csv" }), "visible-data.csv");
```

`exportVisibleChartData` exports samples in each series' current x viewport by default; pass `{ includeYRange: true }` to require y-viewport overlap. Selection exports follow the selection plugin mode (`x-range`, `y-range`, or `xy`) and include OHLC/candlestick `open`, `high`, `low`, and `close` columns when available.

<!-- README_DOCS_START -->
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

Guides: [Docs map](docs/README.md), [Overview](docs/overview.md), [Examples](docs/examples.md), [Data semantics](docs/data-semantics.md), [Performance recipes](docs/performance-recipes.md), [Built-in plugins](docs/built-in-plugins.md), [Plugin authoring](docs/plugin-authoring.md), [Theming and layout](docs/theming-and-layout.md), [Troubleshooting](docs/troubleshooting.md), [Browser support](docs/browser-support.md), [Migration](docs/versioning-and-migration.md), [Roadmap](docs/roadmap.md).

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

The bundle table lists emitted files after Vite code-splitting. Entry rows can be tiny stubs that load shared chunks; use the README performance section for the aggregate core runtime size.

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
<!-- README_DOCS_END -->

## Development

```bash
bun install
bun run dev             # Vite dev server → preview/
bun run ci              # Typecheck + tests + package build + benchmark smoke test
bun run build           # Package build (JS + declarations)
bun test                # Tests
bun run typecheck       # TypeScript strict check
bun run bench:ci        # Headless browser benchmark smoke test
bun run version:patch   # Prepare package.json + changelog for a patch release PR
bun run release:benchmarks  # Append benchmark results to the current release changelog
```

Branch flow: `development` is the integration branch for regular work; open feature/fix PRs into `development`. Open release PRs from `development` into `main` with version and changelog already updated. Release PRs publish npm and create the GitHub Release on merge.

See [docs/release-and-benchmarks.md](https://github.com/Federicocervelli/blazeplot/blob/main/docs/release-and-benchmarks.md) for full workflow details.
