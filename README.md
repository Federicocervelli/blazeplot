<p align="center">
  <img src="assets/blazeplot.png" alt="BlazePlot" width="720" />
</p>

[![Sponsor](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/Federicocervelli)
[![npm version](https://img.shields.io/npm/v/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![npm downloads](https://img.shields.io/npm/dt/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![previews](https://img.shields.io/badge/previews-blue?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI%2BPHBhdGggZmlsbD0iI2ZmN2ExOCIgZD0iTTMzIDNjNCAxMyAyMCAxOSAyMCAzNiAwIDEzLTEwIDIyLTIyIDIyUzkgNTIgOSAzOWMwLTEwIDYtMTggMTQtMjUtMSA4IDIgMTIgNiAxNSAyLTEwIDQtMTggNC0yNnoiLz48cGF0aCBmaWxsPSIjZmZkMTY2IiBkPSJNMzQgMjdjNSA3IDExIDEwIDExIDIwIDAgOC02IDE0LTE0IDE0cy0xNC02LTE0LTE0YzAtNiAzLTExIDgtMTUgMCA1IDIgOCA1IDEwIDEtNiAzLTExIDQtMTV6Ii8%2BPC9zdmc%2B)](https://blazeplot.cervelli.dev/previews)

<p align="center"><b>A fast WebGL2 plotting engine for the browser.</b></p>

BlazePlot is for datasets that outgrow general-purpose charting libraries: millions of points, live streams, and dense zoomable views. Rendering is GPU-native on raw WebGL2 with no rendering runtime dependency, and the DOM is used only for axis labels and optional plugin UI.

[Live previews](https://blazeplot.cervelli.dev/previews) | [Documentation](docs/README.md) | [Examples](docs/examples.md) | [Benchmarks](docs/benchmarks.md)

<!-- README_PERFORMANCE_START -->
## Performance

The core runtime (`import { Chart } from "blazeplot"`, without optional plugins) is about **159 KiB raw**. Plugins and helpers ship as separate subpath entries.

Headline numbers from the manual headed comparison against uPlot and Chart.js:

| Initial ready time (ms, lower is better) | BlazePlot 1.0.0-rc.1 | uPlot 1.6.32 | Chart.js 4.5.1 |
|---|---:|---:|---:|
| line-100k-static | 13.9 | 7.8 | **7.2** |
| line-1m-static | 17.4 | **10.9** | 14.1 |
| line-1m-pan | 15.3 | **4.9** | 6.5 |
| line-1m-stream | 14.6 | **5.6** | 7.0 |
| line-10m-accelerated-pan | **7.7** | 37.0 | 48.6 |

| Pan/stream frame work p95 (lower is better) and RAF FPS | BlazePlot 1.0.0-rc.1 | uPlot 1.6.32 | Chart.js 4.5.1 |
|---|---:|---:|---:|
| line-1m-pan | **1.00** ms, 144 FPS | 1.90 ms, 144 FPS | 2.30 ms, 144 FPS |
| line-1m-stream | **0.90** ms, 144 FPS | 1.50 ms, 144 FPS | 2.20 ms, 144 FPS |
| line-10m-accelerated-pan | **0.40** ms, 144 FPS | 30.60 ms, 33 FPS | 33.40 ms, 30 FPS |

Measured 2026-10-04 on AMD Ryzen 7 7800X3D 8-Core Processor            (16 logical CPUs), AMD Radeon RX 9070 (0x00007550) Direct3D11 vs_5_0 ps_5_0, Chrome/138.0.7204.303, 1280x720 CSS px canvas. Each row discards 1 setup warmup run(s) after library prewarm. Ready time is chart construction plus the first browser frame; frame work is BlazePlot's internal frame time (or the synchronous update/redraw call for other libraries). Bold marks the best value in a row.

Full results, environment, and ratios: [docs/benchmarks.md](docs/benchmarks.md). Reproduce with `bun run bench:compare`.
<!-- README_PERFORMANCE_END -->

## Installation

```bash
bun add blazeplot
# or: npm install blazeplot
```

Requires a browser with WebGL2 (see [Browser support](docs/browser-support.md)).

## Quick start

A chart needs a sized host element and the `Chart` constructor. Add the optional plugins you want from `blazeplot/plugins/*`.

```ts
import { Chart, StaticDataset } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const el = document.getElementById("chart"); // give it an explicit height, e.g. 400px
if (!el) throw new Error("Missing #chart host");

const x = Array.from({ length: 1000 }, (_, i) => i);
const y = x.map((value) => Math.sin(value * 0.02));

const chart = new Chart(el, { plugins: [interactionsPlugin(), tooltipPlugin()] });
chart.addLine({ dataset: new StaticDataset(x, y), name: "sine" });
chart.fitToData();
chart.start();

// Later, when the page, component, or panel is removed:
chart.dispose();
```

For streaming data, pass `capacity` to `addLine` and append samples; see [Live data](docs/live-data.md). More recipes are in [Examples](docs/examples.md).

## Features

- **WebGL2 rendering.** GPU-accelerated plots with no Canvas2D fallback; axis labels and grid use lightweight DOM layers and DPR-aware sizing.
- **Series types.** Line, area, scatter, bar, histogram, OHLC, and candlestick, each with independent data, style, and visibility.
- **Live and large data.** Streaming ring buffers (including fixed-rate `UniformRingBuffer`), static typed arrays, and a custom dataset contract for remote or procedural sources.
- **Level-of-detail downsampling.** Min/max extraction keeps dense views accurate and cheap at any zoom; `ServerSampledDataset` renders server-reduced buckets directly.
- **Plugins.** Legend, tooltip, interactions (pan, zoom, reset), annotations, selection, crosshair, navigator, and flame graph, built on the same public APIs available to custom plugins.
- **Linked charts.** `blazeplot/linked` synchronizes multi-panel layouts.
- **Export.** `chart.screenshot()`, CSV/JSON data export, and pure transform helpers (see [Export image and data](docs/examples.md#export-image-and-data)).
- **Diagnostics.** `chart.getFrameStats()` reports fps, frame time, vertex count, and draw calls.
<!-- README_DOCS_START -->
## Documentation

Guides: [Overview](docs/overview.md), [Docs map](docs/README.md), [Examples](docs/examples.md), [Frameworks](docs/framework-integration.md), [Live data](docs/live-data.md), [Data semantics](docs/data-semantics.md), [Performance](docs/performance-recipes.md), [Benchmarks](docs/benchmarks.md), [Plugins](docs/built-in-plugins.md), [Theme & layout](docs/theming-and-layout.md), [Author plugins](docs/plugin-authoring.md), [Troubleshooting](docs/troubleshooting.md), [Browser](docs/browser-support.md), [Migrating to 1.0](docs/migrating-to-1.0.md), [Migration](docs/versioning-and-migration.md), [Stability](docs/stability.md), [Errors](docs/error-handling.md), [Accessibility](docs/accessibility.md), [Roadmap](docs/roadmap.md).

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

Every public export (with kind and summary) and the per-chunk bundle sizes are listed in the [API reference](docs/api-reference.md).
<!-- README_DOCS_END -->

## Development

```bash
bun install
bun run dev        # docs and previews site
bun test           # unit tests
bun run typecheck  # strict TypeScript check
bun run build      # package build (JS + declarations)
bun run ci         # full local CI: checks plus browser tests
```

Open feature and fix PRs against `main`; releases are separate version-bump PRs. See [Release and benchmarks](docs/release-and-benchmarks.md) and [Documentation contributions](docs/documentation-contributions.md) for the full workflow.

## License

MIT. See [LICENSE](LICENSE).