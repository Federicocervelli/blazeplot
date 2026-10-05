# Examples

These are small patterns you can copy into an app. Standalone charts consistently use `new Chart(...)`; the linked helper only builds a synchronized multi-panel layout around chart instances. The public docs instantiate the same kind of chart next to the snippets so you can see the result before copying the code. For larger runnable cases, open the [interactive previews](https://blazeplot.cervelli.dev/previews). If you are new to BlazePlot, start with the [Overview](./overview.md) first.

## Choose a starting point

Use this table before reaching for a generic chart example. The dataset choice determines memory use, update cost, picking, export behavior, and whether client-side LOD can help.

| If you have | Use |
|---|---|
| Fixed X/Y arrays or object rows | `StaticDataset` with `chart.addLine(...)`, `chart.addScatter(...)`, `chart.addBar(...)`, or `chart.addArea(...)` |
| One-dimensional values that need a frequency distribution | `histogramBins(...)` or `HistogramDataset.from(...)` with `chart.addBar(...)` |
| Irregular live samples | `RingBuffer` with `overflow: "wrap"` for a rolling window |
| Fixed-rate telemetry | `UniformRingBuffer` with `series.append({ y })` so repeated X values are derived, not stored |
| Historical OHLC data | `StaticOhlcDataset` with `chart.addOhlc(...)` or `chart.addCandlestick(...)` |
| Server-reduced min/max buckets | `ServerSampledDataset` with `downsample: "server"` |
| React ownership of the DOM | Create and dispose `Chart` in an effect |
| Multiple charts sharing an X range | `createLinkedCharts` from `blazeplot/linked` |
| Browsers that may lack WebGL2 | The default `renderer: "auto"` falls back to Canvas 2D; use `"webgl2"` to require it |
| Dozens of charts on one page | `renderer: "shared"` |

All built-in datasets require finite, non-decreasing X values: static datasets throw a `RangeError` for unsorted input and streaming buffers skip out-of-order samples. If source data arrives out of order, build the dataset with `StaticDataset.sorted(x, y)` or write a custom dataset that exposes sorted logical access. See [Data semantics](./data-semantics.md#the-x-rule).

## Example structure

Most examples follow the same lifecycle:

1. create a sized host element;
2. create the chart with `new Chart(...)`;
3. create a dataset that matches the data source and add one or more series;
4. initialize the viewport with `fitToData()`, `setViewport()`, or live-window options;
5. call `chart.start()` once;
6. clean up timers, subscriptions, workers, plugin handles, and the chart when the owner unmounts.

## Basic line chart

```ts
import { Chart, StaticDataset } from "blazeplot";

const chart = new Chart(element);
chart.addLine({ dataset: new StaticDataset([0, 1, 2], [3, 6, 4]), name: "values" });
chart.fitToData();
chart.start();
```

:::chart basic-line Basic line chart

Dispose charts when the owning page, component, or panel is removed:

```ts
chart.dispose();
```

Object rows are accepted without writing a dataset class:

```ts
import { Chart, StaticDataset } from "blazeplot";

const rows = [
  { time: 1700000000000, requests: 120 },
  { time: 1700000001000, requests: 132 },
  { time: 1700000002000, requests: 118 },
];

const chart = new Chart(element);
chart.addLine({
  dataset: StaticDataset.fromObjects(rows, { x: "time", y: "requests", sort: true }),
  name: "requests",
});
chart.fitToData();
chart.start();
```

:::chart object-rows Object rows with timestamp X values

## Histogram

Use histograms when you have one-dimensional measurements and want a frequency distribution. BlazePlot computes bucket centers/counts and renders them through the existing bar renderer.

```ts
import { Chart, HistogramDataset } from "blazeplot";

const values = new Float64Array([12, 18, 19, 20, 21, 28, 33, 35, 36, 42]);
const chart = new Chart(element, {
  axes: { x: { title: "Latency ms" }, y: { title: "Count" } },
});
chart.addBar({ name: "latency", dataset: HistogramDataset.from(values, { binSize: 10 }) });
chart.fitToData({ includeZero: true });
chart.start();
```

:::chart histogram Latency histogram

Precompute or inspect bins with the pure helper:

```ts
import { Chart, HistogramDataset } from "blazeplot";
import { histogramBins } from "blazeplot/data";

const values = [12, 15, 15, 18, 22, 22, 22, 30, 41];
const bins = histogramBins(values, { binCount: 20, normalize: "density" });

const chart = new Chart(element);
chart.addBar({ name: "latency density", dataset: new HistogramDataset(bins) });
chart.fitToData({ includeZero: true });
chart.start();
```

Normalization modes are `"count"`, `"probability"`, `"percent"`, and `"density"`. Bins are configurable with one of `binSize`, `binCount` (capped at 512), or explicit `thresholds` (pick one), plus `min`, `max`, and `align`; fixed-size bins align to `0` by default, and the built-in tooltip presents interval-backed samples as bucket ranges rather than only midpoint coordinates. Use `histogramBins(...)` (from `blazeplot/data`) for one-dimensional value frequencies; use `binSamples(...)` when you already have X/Y samples and need to reduce Y values into fixed X intervals.

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

Keep appended X values sorted. `followX` keeps a rolling X window pinned to the newest sample, while `autoFitY` refits Y to the visible X range. For timestamped streams, `chart.followX({ currentX: () => Date.now(), ... })` scrolls smoothly between batched updates. You can also enable or change follow behavior at runtime with `chart.followX(...)`, stop it with `chart.stopFollowX()`, and call `chart.setFollowXPaused(false)` from a "live" button if the user pans away and wants to jump back. Double-click/tap reset in the interactions plugin resumes follow by default. See [Live data](./live-data.md), [Data semantics](./data-semantics.md), [Performance recipes](./performance-recipes.md), and [Troubleshooting](./troubleshooting.md#live-chart-keeps-jumping-away-from-the-latest-data) for the details.

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

`chart.start()` activates render scheduling. Static charts render when chart-owned state changes, while appends through the returned series (`series.append({ x, y })`, `series.append({ y })`, `series.append({ x, open, high, low, close })`) request another frame automatically. You can also append convenient object rows like `series.append([{ x: 1, y: 4 }, { x: 2, y: 5 }])` or `series.append([{ y: 4 }, { y: 5 }])`; use typed-array batches for high-throughput streams. To refine existing samples, use `series.updateLast({ y })`, `series.updateLast({ x, y })`, or `series.updateAt(index, { y })`. If you mutate a dataset directly, call `series.markDirty()` afterward so LOD state and on-demand rendering wake up. Pass `renderLoop: "continuous"` to the `Chart` constructor only for custom animations that redraw even without chart-owned state changes. Stop scheduling with `chart.stop()` if the chart is temporarily hidden, and clear your own timers, workers, or subscriptions when the chart is removed.

## Server-sampled min/max buckets

Use `ServerSampledDataset` when your backend already reduced dense history into min/max buckets. Pass `downsample: "server"` so BlazePlot renders the supplied envelope directly instead of applying another client-side sampler.

```ts
import { Chart, ServerSampledDataset } from "blazeplot";

// Bucket envelopes reduced by your backend; each bucket covers [xStart, xEnd].
const bucketStarts = new Float64Array([0, 10, 20]);
const bucketEnds = new Float64Array([10, 20, 30]);
const bucketMins = new Float32Array([1, 0.5, 2]);
const bucketMaxes = new Float32Array([4, 3.5, 5]);

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

Bucket `xStart` and `xEnd` values must each be finite and non-decreasing, with `xEnd >= xStart` per bucket, or the constructor and `replace` throw a `RangeError`; overlapping buckets are allowed. Use `series.replace(...)` when a new viewport response arrives so on-demand rendering and LOD state update; it takes the same `{ kind, ... }` data as the constructor.

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
  syncX: true,
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

OHLC bounds use high/low values, while generic `getY()` returns close. For live OHLC streams, append through the returned series with `series.append({ x, open, high, low, close })`, append row batches like `series.append([{ x, open, high, low, close }])`, update a candle with `series.updateAt(index, { open, high, low, close })`, or update the active candle with `series.updateLast({ open, high, low, close })`; direct `dataset.push(...)` / `dataset.updateAt(...)` calls need a follow-up `series.markDirty()`. See [Data semantics](./data-semantics.md#ohlc-datasets).

## Linked charts

Use `blazeplot/linked` for dashboards that share an X range but keep independent Y axes.

```ts
import { StaticDataset } from "blazeplot";
import { createLinkedCharts } from "blazeplot/linked";
import { crosshairPlugin } from "blazeplot/plugins/crosshair";

const dashboardElement = document.getElementById("dashboard")!;
const priceDataset = new StaticDataset([0, 1, 2], [10, 12, 11]);
const volumeDataset = new StaticDataset([0, 1, 2], [300, 450, 380]);
const xMin = 0;
const xMax = 2;

const linked = createLinkedCharts(dashboardElement, {
  rows: 2,
  panels: [{}, {}],
  panelPlugins: (syncGroup) => [crosshairPlugin({ syncGroup })],
});

linked.charts[0]?.addLine({ dataset: priceDataset, name: "price" });
linked.charts[1]?.addBar({ dataset: volumeDataset, name: "volume" });
linked.setXRange(xMin, xMax);

// Later, when the dashboard is removed:
linked.dispose();
```

:::chart linked Linked charts with a shared X range

`panelPlugins` runs once per panel and receives a sync group unique to the layout, so only the plugins you import are bundled. X is synced by default (`syncX: false` turns it off); `syncSelections: true` mirrors selection events to the other panels, and per-panel `options` take any `ChartOptions`. When panels use `followX`, a user pan on one panel pauses every panel and `chart.setFollowXPaused(false)` resumes them all.

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

Available plugin subpaths are listed in the [API reference](./api-reference.md#package-entry-points). To write your own plugin, see [Plugin authoring](./plugin-authoring.md). Create a new plugin instance for each chart; several built-in plugins throw if one instance is installed on a second chart.

### Charts on a scrolling page

By default `interactionsPlugin` lets one finger scroll the page and uses two fingers to pan and pinch (`touchPan: "two-finger"`), but the wheel zooms the plot and stops the page from scrolling there. On a long page, also make the wheel cooperative: it zooms only with Ctrl or Cmd held. A short hint explains the shortcut. Pass `touchPan: true` instead if one finger should pan the chart.

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";

const chart = new Chart(element, {
  plugins: [
    interactionsPlugin({
      wheelZoom: "modifier",
      touchPan: "two-finger",
      gestureHint: { wheelText: "Hold Ctrl and scroll to zoom", touchText: "Use two fingers to move the chart" },
    }),
  ],
});

// Later: chart.dispose();
```

## Restyle a series

`series.setStyle(...)` merges new style options into a series after it was created, and `chart.setTheme(...)` restyles the chart.

```ts
import { Chart, LIGHT_CHART_THEME } from "blazeplot";

const chart = new Chart(element);
const cpu = chart.addLine({ capacity: 10_000, name: "cpu" });

cpu.setStyle({ color: "#f97316", lineWidth: 2 });
chart.setTheme(LIGHT_CHART_THEME);
chart.dispose();
```

## Renderers

The default renderer, `"auto"`, uses WebGL2 and falls back to Canvas 2D when it is missing; `"webgl2"` and `"canvas2d"` ask for one engine strictly, and `"shared"` draws many charts through one WebGL context.

```ts
import { Chart } from "blazeplot";

const fallbackChart = new Chart(element, { renderer: "auto" });
console.log(fallbackChart.renderer); // "webgl2" or "canvas2d"

const dashboardChart = new Chart(container, { renderer: "shared" });

fallbackChart.dispose();
dashboardChart.dispose();
```

See [Browser support](./browser-support.md#rendering-engines) for the differences between renderers and [Performance recipes](./performance-recipes.md#many-charts-on-one-page) for when to share a context. `createLinkedCharts(element, { renderer: "shared", panels })` applies one renderer to every panel.

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

Use `chart.screenshot()` for an image of the plot plus the canvas, SVG, and DOM text overlays under the chart root (axis labels and titles, legend, crosshair, annotations). It renders a fresh frame first. Use `blazeplot/export` for downloadable visible data and image download helpers.

```ts
import { chartDataToCsv, downloadBlob, exportChartData } from "blazeplot/export";

const image = await chart.screenshot();
const visible = exportChartData(chart, { range: "visible", includeYRange: true });
const csv = chartDataToCsv(visible);

downloadBlob(image, "chart.png");
downloadBlob(new Blob([csv], { type: "text/csv" }), "visible-data.csv");
```

`range: "visible"` limits the export to the current X range, and `includeYRange: true` also filters it to the current Y range. Without `range`, every sample of the shown series is exported; pass a selection plugin state (`selection.getSelection()`) to export just the selected samples. The CSV helper prefixes text cells that start with `=`, `+`, `-`, or `@` with `'` so spreadsheets do not run them as formulas (`escapeFormulas: false` turns that off).

## React

Use the same `Chart` constructor in an effect when React owns the container.

```tsx
import { useEffect, useRef } from "react";
import { Chart, StaticDataset } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";

export function PriceChart() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = new Chart(hostRef.current, { plugins: [interactionsPlugin()] });
    chart.addLine({ dataset: new StaticDataset([0, 1, 2], [10, 12, 11]), name: "price" });
    chart.fitToData();
    chart.start();
    return () => chart.dispose();
  }, []);

  return <div ref={hostRef} style={{ width: "100%", height: 320 }} />;
}
```

Clean up timers, workers, subscriptions, and the chart from the effect cleanup.
