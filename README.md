<p align="center">
  <img src="assets/blazeplot.png" alt="BlazePlot" width="720" />
</p>

[![Sponsor](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-EA4AAA?logo=githubsponsors)](https://github.com/sponsors/Federicocervelli)
[![npm version](https://img.shields.io/npm/v/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![npm downloads](https://img.shields.io/npm/dt/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![previews](https://img.shields.io/badge/previews-blue?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI%2BPHBhdGggZmlsbD0iI2ZmN2ExOCIgZD0iTTMzIDNjNCAxMyAyMCAxOSAyMCAzNiAwIDEzLTEwIDIyLTIyIDIyUzkgNTIgOSAzOWMwLTEwIDYtMTggMTQtMjUtMSA4IDIgMTIgNiAxNSAyLTEwIDQtMTggNC0yNnoiLz48cGF0aCBmaWxsPSIjZmZkMTY2IiBkPSJNMzQgMjdjNSA3IDExIDEwIDExIDIwIDAgOC02IDE0LTE0IDE0cy0xNC02LTE0LTE0YzAtNiAzLTExIDgtMTUgMCA1IDIgOCA1IDEwIDEtNiAzLTExIDQtMTV6Ii8%2BPC9zdmc%2B)](https://blazeplot.cervelli.dev/previews)

<p align="center"><b>Fast time-series charts for the browser: GPU-accelerated, with an automatic Canvas 2D fallback.</b></p>

BlazePlot is for datasets that outgrow general-purpose charting libraries: millions of points, live streams, and dense zoomable views. It draws on the GPU through raw WebGL2 with no rendering runtime dependency and falls back to Canvas 2D on its own when WebGL2 is unavailable (`renderer: "auto"` is the default). The DOM is used only for axis labels and optional plugin UI.

[Live previews](https://blazeplot.cervelli.dev/previews) | [Documentation](docs/README.md) | [Examples](docs/examples.md) | [Benchmarks](docs/benchmarks.md)


## Installation

```bash
bun add blazeplot
# or: npm install blazeplot
```

Works in Chrome and Edge 93+, Firefox 92+, and Safari 15.4+. WebGL2 is used when available and Canvas 2D otherwise, with nothing to configure (see [Browser support](docs/browser-support.md)). Using React, Vue, Svelte, or an SSR framework? See [Framework integration](docs/framework-integration.md).

## Quick start

A chart needs a sized host element and the `Chart` constructor. Add the optional plugins you want from `blazeplot/plugins/*`.

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const el = document.getElementById("chart"); // give it an explicit height, e.g. 400px
if (!el) throw new Error("Missing #chart host");

const x = Array.from({ length: 1000 }, (_, i) => i);
const y = x.map((value) => Math.sin(value * 0.02));

const chart = new Chart(el, { theme: "auto", plugins: [interactionsPlugin(), tooltipPlugin()] }); // theme: "auto" follows prefers-color-scheme
chart.addLine({ x, y, name: "sine" });
chart.fitToData();
chart.start();

// Later, when the page, component, or panel is removed:
chart.dispose();
```

For streaming data, pass `capacity` to `addLine` and append samples; see [Live data](docs/live-data.md). More recipes are in [Examples](docs/examples.md).

<!-- README_PERFORMANCE_START -->
## Performance

The core runtime (`import { Chart } from "blazeplot"`, without optional plugins) is about **200 KiB raw**. Plugins and helpers ship as separate subpath entries.

Across 19 scenarios and 154 metric comparisons against uPlot and Chart.js, BlazePlot (WebGL) clearly wins 117, is within noise on 13, and loses 24.

Measured 2026-10-05 on AMD Ryzen 7 7800X3D 8-Core Processor, AMD Radeon RX 9070 (0x00007550) Direct3D11 vs_5_0 ps_5_0, Chrome/153.0.8010.12, 7 fresh-page runs per cell. The per-scenario tables, spreads, and every scenario where BlazePlot does not clearly win are in [docs/benchmarks.md](docs/benchmarks.md). Reproduce with `bun run bench:compare`.
<!-- README_PERFORMANCE_END -->

## Features

- **WebGL2 rendering with a Canvas 2D fallback.** GPU-accelerated plots by default, falling back to Canvas 2D when WebGL2 is unavailable (`renderer: "auto"`, the default). Axis labels and grid use lightweight DOM layers and DPR-aware sizing.
- **Many charts on one page.** `renderer: "shared"` draws every chart through one WebGL context, so dashboards are not limited by the browser's per-page context cap.
- **Series types.** Line, area, scatter, bar, histogram (`addBar` with `HistogramDataset`), OHLC, and candlestick, each with independent data, style (`series.setStyle`), and visibility.
- **Live and large data.** Streaming ring buffers (including fixed-rate `UniformRingBuffer`), static typed arrays, and a custom dataset contract for remote or procedural sources.
- **Level-of-detail downsampling.** Min/max extraction keeps dense views accurate and cheap at any zoom; `ServerSampledDataset` renders server-reduced buckets directly.
- **Plugins.** Legend, tooltip, interactions (pan, zoom, reset, keyboard, touch), annotations, selection, crosshair, navigator, accessibility, and flame graph, built on the same public APIs available to custom plugins. Touch pan is cooperative by default (one finger scrolls the page, two fingers pan and pinch), and `wheelZoom: "modifier"` keeps the wheel for page scrolling.
- **Accessibility.** Charts are named figures with a generated data summary, focus rings, and forced-colors support; `interactionsPlugin` adds keyboard pan/zoom, and `blazeplot/plugins/a11y` adds a hidden data table and a keyboard inspection cursor. Built-in text can be localized (see [Accessibility](docs/accessibility.md)).
- **Linked charts.** `blazeplot/linked` synchronizes multi-panel layouts.
- **Export.** `chart.screenshot()`, CSV/JSON data export, and pure transform helpers (see [Export image and data](docs/examples.md#export-image-and-data)).
- **Diagnostics.** `chart.getFrameStats()` reports fps, frame time, rendered points, draw calls, upload bytes, and render mode.
<!-- README_DOCS_START -->
## Documentation

Guides: [Overview](docs/overview.md), [Docs map](docs/README.md), [Examples](docs/examples.md), [Frameworks](docs/framework-integration.md), [Live data](docs/live-data.md), [Data semantics](docs/data-semantics.md), [Performance](docs/performance-recipes.md), [Benchmarks](docs/benchmarks.md), [Plugins](docs/built-in-plugins.md), [Theme & layout](docs/theming-and-layout.md), [Author plugins](docs/plugin-authoring.md), [Troubleshooting](docs/troubleshooting.md), [Browser](docs/browser-support.md), [Migrating to 1.0](docs/migrating-to-1.0.md), [Migration](docs/versioning-and-migration.md), [Stability](docs/stability.md), [Errors](docs/error-handling.md), [Accessibility](docs/accessibility.md), [Roadmap](docs/roadmap.md).

### Package entry points

| Import | Contents |
|---|---|
| `blazeplot` | Chart, datasets, data contracts, theming, and renderer selection. |
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

Every public export (with kind and summary) and the per-chunk bundle sizes are listed in the [API reference](docs/api-reference.md).
<!-- README_DOCS_END -->

## Development

```bash
bun install
bun run dev        # docs and previews site
bun test           # unit tests
bun run typecheck  # strict TypeScript check
bun run lint       # oxlint
bun run build      # package build (JS + declarations)
bun run ci         # full local CI: checks plus browser tests
```

Open feature and fix PRs against `main` (against `v1` while the 1.0 release candidates are in progress); releases are separate version-bump PRs. See [Release and benchmarks](docs/release-and-benchmarks.md) and [Documentation contributions](docs/documentation-contributions.md) for the full workflow.

## License

MIT. See [LICENSE](LICENSE).