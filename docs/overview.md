# BlazePlot overview

BlazePlot is a WebGL2 charting library for large, interactive time-series plots in the browser. It is a good fit when SVG, Canvas2D, or general-purpose chart libraries start to struggle with live data, dense history, or many redraws per second.

The core chart keeps rendering on the GPU and keeps DOM work limited to labels, overlays, and plugin UI. There is no Canvas2D or SVG renderer fallback, so check [Browser support](./browser-support.md) before using it in an app that must run everywhere.

## Install

```bash
bun add blazeplot
# or: npm install blazeplot
```

## Quick start

Create a sized container, create a chart, add data, fit the camera, and start the render loop.

```html
<div id="chart" style="width:100%;height:400px"></div>

<script type="module">
  import { Chart, StaticDataset } from "blazeplot";

  const x = Array.from({ length: 1000 }, (_, i) => i);
  const y = x.map((value) => Math.sin(value * 0.02));

  const element = document.getElementById("chart");
  if (!element) throw new Error("Missing chart element");

  const chart = new Chart(element);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "sine" });
  chart.fitToData();
  chart.start();
</script>
```

Call `chart.dispose()` when the chart is removed from the page.

## What is included

| Area | What to use |
|---|---|
| Static data | `StaticDataset` for fixed X/Y arrays. See [Data semantics](./data-semantics.md). |
| Live data | `RingBuffer`, `UniformRingBuffer`, or OHLC ring buffers. See [Performance recipes](./performance-recipes.md). |
| Chart types | Line, area, scatter, bar, OHLC, and candlestick series. |
| Interaction | Optional `interactionsPlugin` for wheel zoom, pan, box zoom, touch pan, and pinch zoom. |
| Plugins | Legend, tooltip, crosshair, annotations, selection, and navigator plugins. See [Examples](./examples.md). |
| Layout and themes | Theme tokens, inside/outside axes, titles, and plugin layout reservations. See [Theming and layout](./theming-and-layout.md). |
| React | `blazeplot/react` for the `BlazeChart` React component. |
| Exports | Screenshot, clipboard, and CSV/JSON data helpers. |

## Main tradeoffs

- WebGL2 is required.
- X values must be sorted for built-in datasets and fast range queries.
- Plugins are opt-in so the base chart stays small.
- Dense line and bar views use level-of-detail extraction by default; use `downsample: "none"` only when the visible point count is bounded.

For import paths and public symbols, see the [API reference](./api-reference.md).
