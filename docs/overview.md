# BlazePlot overview

BlazePlot is a GPU-accelerated charting library, with an automatic Canvas 2D fallback, for large, interactive time-series plots in the browser. It is a good fit when SVG, Canvas2D, or general-purpose chart libraries start to struggle with live data, dense history, or many redraws per second.

The core chart renders on the GPU through WebGL2 and keeps DOM work limited to labels, overlays, and plugin UI. The default `renderer: "auto"` uses WebGL2 and falls back to Canvas 2D where WebGL2 is unavailable (`renderer: "canvas2d"` asks for Canvas 2D directly, at lower throughput on very large visible point counts), while a shared WebGL context (`renderer: "shared"`) lets a page mount many charts without hitting the browser's WebGL context cap; see [Browser support](./browser-support.md) and [Performance recipes](./performance-recipes.md#many-charts-on-one-page).

## Install

```bash
bun add blazeplot
# or: npm install blazeplot
```

## Quick start

Create a sized container, construct `Chart`, add a dataset-backed series, fit the camera, and start rendering. Without plugins the chart has no pointer or keyboard interaction; pass `plugins: [interactionsPlugin(), tooltipPlugin()]` (from `blazeplot/plugins/interactions` and `blazeplot/plugins/tooltip`) for pan, zoom, and hover (see [Examples](./examples.md#built-in-plugins)).

```html
<div id="chart" style="width:100%;height:400px"></div>

<script type="module">
  import { Chart } from "blazeplot";

  const x = Array.from({ length: 1000 }, (_, i) => i);
  const y = x.map((value) => Math.sin(value * 0.02));

  const element = document.getElementById("chart");
  if (!element) throw new Error("Missing chart element");

  const chart = new Chart(element);
  chart.addLine({ x, y, name: "sine" });
  chart.fitToData();
  chart.start();
</script>
```

Call `chart.dispose()` when the chart is removed from the page.

If the chart appears blank, check that the host element has a non-zero height, WebGL2 is available, and the viewport has been initialized. See [Troubleshooting](./troubleshooting.md) for the full checklist.

## Documentation map

| Goal | Read |
|---|---|
| Copy a working pattern | [Examples](./examples.md) |
| Understand sorted data, gaps, bounds, and export behavior | [Data semantics](./data-semantics.md) |
| Stream data and keep a rolling window in view | [Live data](./live-data.md) |
| Choose datasets, downsampling, and live update patterns | [Performance recipes](./performance-recipes.md) |
| Use React, Vue, Svelte, or SSR frameworks | [Framework integration](./framework-integration.md) |
| Compare headed-browser benchmark results | [Benchmarks](./benchmarks.md) |
| Add tooltips, legends, selection, annotations, crosshair, or navigator | [Built-in plugins](./built-in-plugins.md) |
| Build custom chart UI or behavior | [Plugin authoring](./plugin-authoring.md) |
| Style axes, gutters, themes, and responsive layouts | [Theming and layout](./theming-and-layout.md) |
| Debug blank charts, live viewport issues, React lifecycle, or screenshots | [Troubleshooting](./troubleshooting.md) |
| Check browser/SSR/clipboard support | [Browser support](./browser-support.md) |
| Make a chart accessible | [Accessibility](./accessibility.md) |
| See what is stable, experimental, or internal | [API stability](./stability.md) |
| Review import paths and public symbols | [API reference](./api-reference.md) |

For a maintainer-oriented page list, see [Documentation map](./README.md).

## What is included

| Area | What to use |
|---|---|
| Static data | `StaticDataset` for fixed X/Y arrays. See [Data semantics](./data-semantics.md). |
| Live data | Series appends with `chart.addLine({ capacity })`, `chart.addLine({ capacity, xStep })`, or OHLC ring buffers. See [Live data](./live-data.md) and [Performance recipes](./performance-recipes.md). |
| Chart types | Line, area, scatter, bar, OHLC, and candlestick series; histograms are bars over a `HistogramDataset`. |
| Interaction | Optional `interactionsPlugin` for wheel zoom, shift-drag/axis pan, box zoom, touch pan, pinch zoom, and keyboard pan/zoom. It can stay out of the way of page scrolling with `wheelZoom: "modifier"` and `touchPan: "two-finger"`. |
| Live viewport helpers | `followX` for rolling windows and `autoFitY` for visible-range Y fitting. |
| Plugins | Interactions, legend, tooltip, crosshair, annotations, selection, navigator, accessibility, and flame graph plugins. See [Built-in plugins](./built-in-plugins.md). |
| Layout and themes | Theme tokens, inside/outside axes with optional auto-sized gutters, titles, and plugin layout reservations. See [Theming and layout](./theming-and-layout.md). |
| Renderers | `"auto"` by default (WebGL2, with a Canvas 2D fallback), plus a shared WebGL context for many charts. See [Browser support](./browser-support.md). |
| Frameworks | Create and dispose the same `Chart` API in an effect, `onMounted`, or an action. See [Framework integration](./framework-integration.md). |
| Exports | Screenshot, clipboard, and CSV/JSON data helpers. |

## Main tradeoffs

- The default renderer is `"auto"`: WebGL2 where available, Canvas 2D otherwise. Canvas 2D is slower for very large visible point counts; pass `renderer: "webgl2"` to require the GPU engine and fail loudly without it.
- X values must be finite and non-decreasing: static datasets throw on unsorted input, and streaming buffers skip out-of-order samples.
- Datasets passed as parallel arrays must have equal lengths; a mismatch throws a `RangeError`.
- Plugins are opt-in so the base chart stays small. Create a new plugin instance for each chart: the stateful built-ins (a11y, annotations, crosshair, flame graph, navigator, selection) throw if one instance is installed on a second chart.
- Dense line and bar views use level-of-detail extraction by default; use `downsample: "none"` only when the visible point count is bounded.
- `fitToData()` is an explicit fit/reset operation. For live charts, use `followX` and `autoFitY` instead of fitting on every sample.

Maintainers should follow the [documentation contribution guide](./documentation-contributions.md) before adding or restructuring docs.
