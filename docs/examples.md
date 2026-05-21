# Examples

These are small patterns you can copy into an app. For complete runnable cases, open the [interactive previews](#previews) in the docs site. If you are new to BlazePlot, start with the [Overview](./overview.md) first.

## Choose a starting point

| If you have | Use |
|---|---|
| Fixed X/Y arrays | `StaticDataset` with `chart.addLine(...)`, `chart.addScatter(...)`, `chart.addBar(...)`, or `chart.addArea(...)` |
| Irregular live samples | `RingBuffer` with `overflow: "wrap"` for a rolling window |
| Fixed-rate telemetry | `UniformRingBuffer` and `appendY(...)` so repeated X values are derived, not stored |
| Historical OHLC data | `StaticOhlcDataset` with `chart.addOhlc(...)` or `chart.addCandlestick(...)` |
| Server-reduced min/max buckets | `ServerSampledDataset` with `downsample: "server"` |
| React ownership of the DOM | `BlazeChart` from `blazeplot/react` |
| Multiple charts sharing an X range | `createLinkedCharts` from `blazeplot/linked` |

All built-in datasets expect sorted X values. If source data arrives out of order, sort it before constructing the dataset or write a custom dataset that exposes sorted logical access.

## Basic line chart

```ts
import { Chart, StaticDataset } from "blazeplot";

const chart = new Chart(element);
chart.addLine({
  dataset: new StaticDataset([0, 1, 2], [3, 6, 4]),
  name: "values",
});
chart.fitToData();
chart.start();
```

Dispose charts when the owning page, component, or panel is removed:

```ts
chart.dispose();
```

## Live line chart

Use a ring buffer when old samples can fall out of the visible history window.

```ts
import { Chart, RingBuffer } from "blazeplot";

const dataset = new RingBuffer(60_000, { overflow: "wrap" });
const chart = new Chart(element);
chart.addLine({ dataset, name: "live" });
chart.start();

setInterval(() => {
  dataset.push(Date.now(), Math.random());
  chart.fitToData({ x: true, y: true });
}, 100);
```

Keep appended X values sorted. See [Data semantics](./data-semantics.md) and [Performance recipes](./performance-recipes.md) for the details.

If samples arrive at a fixed interval, prefer `UniformRingBuffer`:

```ts
import { Chart, UniformRingBuffer } from "blazeplot";

const dataset = new UniformRingBuffer(60_000, {
  xStart: performance.now(),
  xStep: 16.6667,
});

const chart = new Chart(element);
chart.addLine({ dataset, name: "signal" });
chart.start();

setInterval(() => {
  dataset.appendY(new Float32Array([Math.random(), Math.random(), Math.random()]));
}, 50);
```

`chart.start()` owns the animation loop, so dataset changes are picked up on the next frame. Stop the loop with `chart.stop()` if the chart is temporarily hidden, and call `chart.dispose()` when it is removed.

## Financial OHLC and candlesticks

Use `StaticOhlcDataset` for historical data or `OhlcRingBuffer` for live feeds.

```ts
chart.addOhlc({ dataset, name: "OHLC" });
chart.addCandlestick({ dataset, name: "candles" });
```

OHLC bounds use high/low values, while generic `getY()` returns close. See [Data semantics](./data-semantics.md#ohlc-datasets).

## Linked charts

Use `blazeplot/linked` for dashboards that share an X range but keep independent Y axes.

```ts
import { createLinkedCharts } from "blazeplot/linked";

const linked = createLinkedCharts(dashboardElement, {
  rows: 2,
  sharedX: true,
  syncCrosshair: true,
  panels: [{}, {}],
});

linked.charts[0]?.addLine({ dataset: priceDataset, name: "price" });
linked.charts[1]?.addBar({ dataset: volumeDataset, name: "volume" });
linked.setXRange(xMin, xMax);

// Later, when the dashboard is removed:
linked.dispose();
```

Use `blazeplot/linked-core` if you want the linked chart layout without importing tooltip or crosshair sync helpers.

## Built-in plugins

Plugins are imported from subpaths so unused plugins do not have to be bundled.

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { legendPlugin } from "blazeplot/plugins/legend";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const chart = new Chart(element, {
  plugins: [
    interactionsPlugin(),
    legendPlugin(),
    tooltipPlugin(),
  ],
});
```

Available plugin subpaths are listed in the [API reference](./api-reference.md#package-entry-points). To write your own plugin, see [Plugin authoring](./plugin-authoring.md).

## Annotations

Use `blazeplot/plugins/annotations` for x/y lines, ranges, boxes, points, labels, and hit events.

```ts
import { Chart } from "blazeplot";
import { annotationsPlugin } from "blazeplot/plugins/annotations";

const chart = new Chart(element, {
  plugins: [
    annotationsPlugin({
      annotations: [{ type: "x-line", x: Date.now(), label: "event" }],
      onClick: (event) => console.log("annotation", event.annotation),
    }),
  ],
});
```

## Export image and data

Use `chart.screenshot()` for an image of the plot plus built-in DOM text overlays. Use `blazeplot/data` and `blazeplot/export` for downloadable visible data.

```ts
import { chartDataToCSV, exportVisibleChartData } from "blazeplot/data";
import { downloadBlob } from "blazeplot/export";

const image = await chart.screenshot();
const visible = exportVisibleChartData(chart, { includeYRange: true });
const csv = chartDataToCSV(visible);

downloadBlob(image, "chart.png");
downloadBlob(new Blob([csv], { type: "text/csv" }), "visible-data.csv");
```

`includeYRange: true` filters exported samples to both the current X range and Y range. Without it, export uses the visible X range.

## React

Use `blazeplot/react` when you want React to own the container while BlazePlot owns the chart instance.

```tsx
import { useMemo, useRef } from "react";
import { Chart, StaticDataset } from "blazeplot";
import { BlazeChart } from "blazeplot/react";
import { interactionsPlugin } from "blazeplot/plugins/interactions";

export function PriceChart() {
  const x = [0, 1, 2];
  const y = [10, 12, 11];
  const chartRef = useRef<Chart | null>(null);
  const options = useMemo(() => ({ plugins: [interactionsPlugin()] }), []);

  return (
    <BlazeChart
      chartRef={chartRef}
      options={options}
      style={{ width: "100%", height: 320 }}
      onChart={(chart) => {
        chart.addLine({ dataset: new StaticDataset(x, y), name: "price" });
        chart.fitToData();
        chart.start();
      }}
    />
  );
}
```

Keep `options` stable with `useMemo`; changing its identity recreates the chart. `BlazeChart` disposes the chart on unmount. Clean up your own timers, workers, and subscriptions in React effects.
