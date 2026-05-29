# Examples

These are small patterns you can copy into an app. The public docs instantiate the same kind of chart next to the snippets so you can see the result before copying the code. For larger runnable cases, open the [interactive previews](https://blazeplot.cervelli.dev/previews). If you are new to BlazePlot, start with the [Overview](./overview.md) first.

## Choose a starting point

Use this table before reaching for a generic chart example. The dataset choice determines memory use, update cost, picking, export behavior, and whether client-side LOD can help.

| If you have | Use |
|---|---|
| Fixed X/Y arrays or object rows | `createChart(...)` for the shortest setup, or `StaticDataset` with `chart.addLine(...)`, `chart.addScatter(...)`, `chart.addBar(...)`, or `chart.addArea(...)` when you need manual control |
| One-dimensional values that need a frequency distribution | `histogram(...)`, `chart.addHistogram(...)`, or `createChart({ series: [{ type: "histogram", values }] })` |
| Irregular live samples | `RingBuffer` with `overflow: "wrap"` for a rolling window |
| Fixed-rate telemetry | `UniformRingBuffer` with `series.append({ y })` so repeated X values are derived, not stored |
| Historical OHLC data | `StaticOhlcDataset` with `chart.addOhlc(...)` or `chart.addCandlestick(...)` |
| Server-reduced min/max buckets | `ServerSampledDataset` with `downsample: "server"` |
| React ownership of the DOM | `BlazeChart` from `blazeplot/react` |
| Multiple charts sharing an X range | `createLinkedCharts` from `blazeplot/linked` |

All built-in datasets expect sorted X values. If source data arrives out of order, sort it before constructing the dataset or write a custom dataset that exposes sorted logical access.

## On this page

- [Basic line chart](#basic-line-chart) — static X/Y data and first render loop.
- [Histogram](#histogram) — raw one-dimensional values rendered with bar buckets.
- [Live line chart](#live-line-chart) — rolling windows, fixed-rate samples, and cleanup.
- [Server-sampled min/max buckets](#server-sampled-minmax-buckets) — backend-reduced dense history.
- [Financial OHLC and candlesticks](#financial-ohlc-and-candlesticks) — market-style series.
- [Linked charts](#linked-charts) — dashboards with shared X ranges.
- [Built-in plugins](#built-in-plugins) — interactions, tooltip, legend, annotations, selection, crosshair, and navigator.
- [Export image and data](#export-image-and-data) — screenshots, CSV, and JSON helpers.
- [React](#react) — using `BlazeChart` with stable options.

## Example structure

Most examples follow the same lifecycle:

1. create a sized host element;
2. use `createChart(...)` for static data, or create a dataset that matches the data source;
3. add one or more series;
4. initialize the viewport with `fitToData()`, `autoFit`, or live-window options;
5. call `chart.start()` once if you are using the lower-level constructor;
6. clean up timers, subscriptions, workers, plugin handles, and the chart when the owner unmounts.

## Basic line chart

```ts
import { createChart } from "blazeplot";

const chart = createChart(element, {
  series: [{ type: "line", x: [0, 1, 2], y: [3, 6, 4], name: "values" }],
});
```

:::chart basic-line Basic line chart

Dispose charts when the owning page, component, or panel is removed:

```ts
chart.dispose();
```

Object rows are accepted without writing a dataset class:

```ts
import { createChart } from "blazeplot";

const rows = [
  { time: 1700000000000, requests: 120 },
  { time: 1700000001000, requests: 132 },
  { time: 1700000002000, requests: 118 },
];

const chart = createChart(element, {
  series: [{ type: "line", data: rows, x: "time", y: "requests", sort: true }],
});
```

:::chart object-rows Object rows with timestamp X values

Use the lower-level API when you want explicit lifecycle control:

```ts
import { Chart, StaticDataset } from "blazeplot";

const chart = new Chart(element);
chart.addLine({ dataset: new StaticDataset([0, 1, 2], [3, 6, 4]), name: "values" });
chart.fitToData();
chart.start();
```

## Histogram

Use histograms when you have one-dimensional measurements and want a frequency distribution. BlazePlot computes bucket centers/counts and renders them through the existing bar renderer.

```ts
import { createChart } from "blazeplot";

const values = new Float64Array([12, 18, 19, 20, 21, 28, 33, 35, 36, 42]);

const chart = createChart(element, {
  series: [{ type: "histogram", values, binSize: 10, name: "latency" }],
  axes: { x: { title: "Latency ms" }, y: { title: "Count" } },
});
```

:::chart histogram Latency histogram

For manual charts, precompute or inspect bins with the pure helper:

```ts
import { Chart, histogram } from "blazeplot";

const bins = histogram(values, { binCount: 20, normalize: "density" });

const chart = new Chart(element);
chart.addHistogram({ histogram: bins, name: "latency density" });
chart.fitToData({ includeZero: true });
chart.start();
```

Normalization modes are `"count"`, `"probability"`, `"percent"`, and `"density"`. Bins are configurable with `binSize`, `binCount`, explicit `thresholds`, `min`, `max`, and `align`; fixed-size bins align to `0` by default, and the built-in tooltip presents interval-backed samples as bucket ranges rather than only midpoint coordinates. Use `histogram(...)` for one-dimensional value frequencies; use `binSamples(...)` when you already have X/Y samples and need to reduce Y values into fixed X intervals.

## Live line chart

Use a ring buffer when old samples can fall out of the visible history window.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element, {
  followX: { window: 60_000, pauseOnInteraction: true, resumeAfterMs: 3000 },
  autoFitY: { padding: { y: 0.1 } },
});
const series = chart.addLine({ capacity: 60_000, name: "live" });
chart.start();

const timer = setInterval(() => {
  series.append({ x: Date.now(), y: Math.random() });
}, 100);

const cleanup = () => {
  clearInterval(timer);
  chart.dispose();
};
```

:::chart live-line Rolling live line chart

Keep appended X values sorted. `followX` keeps a rolling X window pinned to the newest sample, while `autoFitY` refits Y to the visible X range. For timestamped streams, `chart.followLatestX({ currentX: () => Date.now(), ... })` scrolls smoothly between batched updates. You can also enable or change follow behavior at runtime with `chart.followLatestX(...)`, stop it with `chart.stopFollowingLatestX()`, and call `chart.resumeLatestXFollow()` from a "live" button if the user pans away and wants to jump back. Double-click/tap reset in the interactions plugin resumes follow by default. See [Live data](./live-data.md), [Data semantics](./data-semantics.md), [Performance recipes](./performance-recipes.md), and [Troubleshooting](./troubleshooting.md#live-chart-keeps-jumping-away-from-the-latest-data) for the details.

If samples arrive at a fixed interval, use the `{ capacity, xStep }` shorthand so BlazePlot creates an implicit-X buffer:

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element);
const series = chart.addLine({ capacity: 60_000, xStart: performance.now(), xStep: 16.6667, name: "signal" });
chart.start();

const timer = setInterval(() => {
  series.append({ y: new Float32Array([Math.random(), Math.random(), Math.random()]) });
}, 50);

const cleanup = () => {
  clearInterval(timer);
  chart.dispose();
};
```

:::chart fixed-rate Fixed-rate implicit-X stream

`chart.start()` activates render scheduling. Static charts render when chart-owned state changes, while appends through the returned series (`series.append({ x, y })`, `series.append({ y })`, `series.append({ x, open, high, low, close })`) request another frame automatically. You can also append convenient object rows like `series.append([{ x: 1, y: 4 }, { x: 2, y: 5 }])` or `series.append([{ y: 4 }, { y: 5 }])`; use typed-array batches for high-throughput streams. To refine existing samples, use `series.updateLast({ y })`, `series.updateLast({ x, y })`, or `series.updateAt(index, { y })`. If you mutate a dataset directly, call `series.markDirty()` afterward so LOD state and on-demand rendering wake up. Use `chart.start({ renderLoop: "continuous" })` only for custom animations that redraw even without chart-owned state changes. Stop scheduling with `chart.stop()` if the chart is temporarily hidden, and clear your own timers, workers, or subscriptions when the chart is removed.

## Server-sampled min/max buckets

Use `ServerSampledDataset` when your backend already reduced dense history into min/max buckets. Pass `downsample: "server"` so BlazePlot renders the supplied envelope directly instead of applying another client-side sampler.

```ts
import { Chart, ServerSampledDataset } from "blazeplot";

const dataset = new ServerSampledDataset({
  kind: "minmax",
  xStart: bucketStarts,
  xEnd: bucketEnds,
  minY: bucketMins,
  maxY: bucketMaxes,
});

const chart = new Chart(element);
const series = chart.addLine({ dataset, name: "server buckets", downsample: "server" });
chart.fitToData();
chart.start();
```

:::chart server-sampled Server-sampled min/max buckets

Bucket ranges should be sorted and non-overlapping for predictable picking, bounds, and visible-data export. Use `series.replace(...)` when a new viewport response arrives so on-demand rendering and LOD state update.

## Financial OHLC and candlesticks

Use `StaticOhlcDataset` for historical bars or `OhlcRingBuffer` for live feeds. A market chart usually wants candles, volume, time axes, crosshair labels, and annotation overlays, not just raw OHLC sticks.

```ts
import { Chart, StaticDataset, StaticOhlcDataset } from "blazeplot";
import { createLinkedCharts } from "blazeplot/linked";
import { annotationsPlugin } from "blazeplot/plugins/annotations";
import { crosshairPlugin } from "blazeplot/plugins/crosshair";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { legendPlugin } from "blazeplot/plugins/legend";

const dayMs = 24 * 60 * 60 * 1000;
const time = [1704067200000, 1704153600000, 1704240000000, 1704326400000];
const open = [100, 104, 102, 108];
const high = [106, 107, 110, 112];
const low = [98, 101, 101, 105];
const close = [104, 102, 108, 111];
const volume = [42, 58, 76, 63];

const candles = new StaticOhlcDataset(time, open, high, low, close);
const volumes = new StaticDataset(time, volume);
const last = close.at(-1) ?? 0;

const linked = createLinkedCharts(element, {
  rows: 2,
  sharedX: true,
  spacing: 0,
  panels: [
    {
      options: {
        axes: { x: { position: "outside", scale: "time" }, y: { position: "outside" } },
        grid: true,
        plugins: [
          interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true }),
          crosshairPlugin({ axis: "xy", snap: "nearest-x", label: true }),
          legendPlugin({ position: "top-left" }),
          annotationsPlugin({ annotations: [{ type: "y-line", y: last, label: `last ${last}` }] }),
        ],
      },
    },
    {
      options: {
        axes: { x: { position: "outside", scale: "time" }, y: { position: "outside" } },
        grid: true,
        plugins: [interactionsPlugin(), crosshairPlugin({ axis: "xy", snap: "nearest-x", label: true })],
      },
    },
  ],
});

const priceChart = linked.charts[0] as Chart | undefined;
const volumeChart = linked.charts[1] as Chart | undefined;
priceChart?.addCandlestick({ dataset: candles, name: "candles" }, { barWidth: dayMs * 0.7 });
volumeChart?.addBar({ dataset: volumes, name: "volume" }, { baseline: 0, barWidth: dayMs * 0.7 });
priceChart?.fitToData({ padding: { x: 0.02, y: 0.12 } });
volumeChart?.fitToData({ includeZero: true, padding: { x: 0.02, y: 0.12 } });
for (const chart of linked.charts) chart.start();
```

:::chart financial Candlesticks, volume, crosshair, price line, and markers

OHLC bounds use high/low values, while generic `getY()` returns close. For live OHLC streams, append through the returned series with `series.append({ x, open, high, low, close })`, append row batches like `series.append([{ x, open, high, low, close }])`, update a candle with `series.updateAt(index, { open, high, low, close })`, or update the active candle with `series.updateLast({ open, high, low, close })`; direct `dataset.push(...)` / `dataset.updateLast(...)` calls need a follow-up `series.markDirty()`. See [Data semantics](./data-semantics.md#ohlc-datasets).

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

:::chart linked Linked charts with a shared X range

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

:::chart plugins Interactions, legend, and tooltip plugins

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

:::chart annotations Annotation plugin with an event marker

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
