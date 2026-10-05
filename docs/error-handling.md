# Error handling

This page lists what BlazePlot throws, what it logs, and what it does silently with bad input. It is for app developers who feed charts from untrusted or imperfect sources. Every behavior here was checked against the source and unit tests; if the code and this page disagree, the code wins and the page is a bug.

The short version: **constructors, static data, and explicit configuration throw early; streaming data never throws.** Static datasets reject non-finite or decreasing X with a `RangeError` when they are built, streaming buffers skip such samples and report them, non-finite Y values are gaps, and a broken viewport skips the frame instead of stopping the render loop.

## Error types

| Error | Thrown by | When |
|---|---|---|
| `WebGL2UnavailableError` (extends `Error`, `name === "WebGL2UnavailableError"`) | `new Chart(...)`, `createLinkedCharts(...)` | The canvas cannot create a WebGL2 context and the engine was requested strictly (`renderer: "webgl2"`, `"shared"`, or their factories). The default `"auto"` falls back to Canvas 2D instead; it throws this error only when Canvas 2D cannot start either. |
| `Canvas2DUnavailableError` (from `blazeplot`, extends `Error`) | `new Chart(..., { renderer: "canvas2d" })` | The canvas cannot create a 2D context. |
| `RangeError` | Datasets, `Camera2D`, axes, histogram and data helpers | A number is out of range: non-positive capacity, `xStep <= 0`, index out of range, `xMax <= xMin`, non-finite viewport edge, capacity exceeded with `overflow: "error"`, `binSize <= 0`, invalid histogram bins, mismatched array lengths in dataset input, and a non-finite or decreasing X in static data (`StaticDataset`, `StaticOhlcDataset`, `ServerSampledDataset`, `fromObjects`, `series.replace`). |
| `TypeError` | `Chart` constructor, `Chart.addSeries`/`add*`, `SeriesStore` mutators, `histogram` | The call does not fit the dataset or option shape: appending `{ y }` to a dataset without implicit X, mixing OHLC and XY rows, OHLC series without an `OhlcDataset`, an unknown series mode, `series.setStyle` on a series that is not attached to a chart, a `renderer` option that is neither one of `"auto"`, `"webgl2"`, `"canvas2d"`, `"shared"` nor a factory (the message lists the valid names), conflicting histogram options. |
| `Error` | `blazeplot/export`, `chart.screenshot()`, built-in stateful plugins, flame graph plugin, `sharedRenderer()`, WebGL internals | Browser feature missing (`ClipboardItem`, Clipboard API, 2D canvas), a plugin instance installed on a second chart, a shared render context without a DOM, or a shader/program failed to compile or link. |

`WebGL2UnavailableError` and `Canvas2DUnavailableError` are the only named classes. Match other failures with `instanceof RangeError` / `instanceof TypeError`, not by message text; messages are for humans and can be reworded in any release.

## Creating a chart

By default (`renderer: "auto"`) `new Chart(target, options)` uses WebGL2 and falls back to Canvas 2D without logging anything; `chart.rendererInfo.fallbackFrom` is `"webgl2"` when it did. A strictly requested engine throws instead: `WebGL2UnavailableError` for `"webgl2"` and `"shared"` when no WebGL2 context is available, `Canvas2DUnavailableError` for `"canvas2d"` when no 2D context is available. Before it throws it removes the DOM it created and hands back any canvas you supplied, so a failed construction leaves your container as it was. `createLinkedCharts(...)` behaves the same way.

If a plugin's `install()` throws, the chart disposes everything already set up and rethrows that error from the constructor. That includes installing one stateful built-in plugin instance (annotations, crosshair, selection, navigator, a11y, flame graph) on a second chart: create one instance per chart.

The default already keeps drawing without WebGL2 (see [Browser support](./browser-support.md#rendering-engines)). To show your own fallback UI instead, request the strict engine and check availability first or catch the error:

```ts
import { Chart, WebGL2UnavailableError, isWebGL2Available } from "blazeplot";

export function mountChart(element: HTMLElement): Chart | null {
  if (!isWebGL2Available()) {
    element.textContent = "This chart needs WebGL2.";
    return null;
  }
  try {
    const chart = new Chart(element, { renderer: "webgl2" });
    chart.start();
    return chart;
  } catch (error) {
    if (error instanceof WebGL2UnavailableError) {
      element.textContent = "This chart needs WebGL2.";
      return null;
    }
    throw error;
  }
}
```

`isWebGL2Available()` creates a throwaway canvas and returns `false` when `document` does not exist (server-side). A `true` result does not guarantee the real chart canvas will get a context, for example when the browser is out of GPU contexts, so keep the `try`/`catch` if the fallback matters. See [Browser support](./browser-support.md).

## Adding and changing series

| Call | Throws |
|---|---|
| `chart.addLine({ capacity })` and other chart-owned series | `TypeError` when `capacity` is not a positive integer and no `dataset` is given. `TypeError` when `xStep`/`xStart` is combined with an overflow strategy other than `"wrap"`. |
| `chart.addSeries({ mode })` | `TypeError` when `mode` is not one of `line`, `area`, `scatter`, `bar`, `ohlc`, `candlestick` (JavaScript callers, or a removed mode such as `"envelope"`). |
| `chart.addOhlc(...)` / `addCandlestick(...)` | `TypeError` without an `OhlcDataset`. |
| `chart.addBar({ dataset: HistogramDataset.from(...) })` | `TypeError` when variable-width bins have no `style.barWidth`; histogram option errors below. |
| `series.append({ x, y })` | `TypeError` when the dataset is not appendable XY (for example `StaticDataset`). `RangeError("... capacity exceeded.")` for `overflow: "error"` buffers that are full. |
| `series.append({ y })` | `TypeError` unless the dataset has implicit X (`UniformRingBuffer`). |
| `series.append([...rows])` | `TypeError` when rows mix XY and OHLC, or mix explicit and implicit X. |
| `series.updateAt`, `updateLast`, `replace`, `clear` | `TypeError` when the dataset does not support that operation. |

`RingBuffer.update`, `updateY`, and the equivalent methods on other buffers return `false` for an out-of-range index instead of throwing. `getX` and `getY` on the built-in datasets throw `RangeError` for a bad index.

Dataset constructors validate their arguments: `RingBuffer`, `OhlcRingBuffer`, and `UniformRingBuffer` require a positive integer capacity, and `UniformRingBuffer` requires a positive finite `xStep` and a finite `xStart`. All throw `RangeError`. `RingBuffer.update` also returns `false` when the new X is non-finite or outside its neighbors' X values (counted in `rejectedSamples`).

## Static data

`StaticDataset`, `StaticOhlcDataset`, `ServerSampledDataset`, and `StaticDataset.fromObjects` check X in one O(n) pass when the data arrives and throw a `RangeError` naming the first bad position and the reason:

| Call | Throws when |
|---|---|
| `new StaticDataset(x, y)`, `new StaticOhlcDataset(x, open, high, low, close)` | The parallel arrays differ in length (`RangeError` such as `StaticDataset: x has 3 values but y has 2.`), or an X is non-finite or below the previous X. The X check is skipped with `{ assumeSorted: true }`; the length check never is. |
| `StaticDataset.replace(...)` / `series.replace({ x?, y })` | Same checks for the new arrays, including a length mismatch between `x` (or the retained X) and `y`. The current data is kept. The X check is skipped when the dataset was built with `assumeSorted`. |
| `StaticDataset.fromObjects(rows, options)` | A row's X is non-finite, or X decreases and `sort: true` was not passed. The message names the row. |
| `new ServerSampledDataset(data)`, `replace(data)` | A point X, bucket `xStart`, or bucket `xEnd` is non-finite or decreasing, or a bucket has `xEnd < xStart` (`inverted-bucket`). The current data is kept. |

Messages follow one format, for example:

```text
StaticDataset: X at index 2 is 1, below 2 at index 1 (decreasing-x). X values must be finite and non-decreasing. Use StaticDataset.sorted(x, y) to sort and drop non-finite X, or pass { assumeSorted: true } to skip this check for data you trust.
StaticDataset: X at index 1 is NaN (non-finite-x). X values must be finite and non-decreasing. ...
```

Fix unsorted input with `StaticDataset.sorted(x, y)` or `StaticOhlcDataset.sorted(...)`, which copy the data, sort it stably by X, and drop samples with a non-finite X:

```ts
import { Chart, StaticDataset } from "blazeplot";

declare const element: HTMLElement;
const x = [3, 1, Number.NaN, 2];
const y = [30, 10, 0, 20];

const chart = new Chart(element);
try {
  chart.addLine({ dataset: new StaticDataset(x, y) });
} catch (error) {
  if (!(error instanceof RangeError)) throw error;
  chart.addLine({ dataset: StaticDataset.sorted(x, y) }); // X 1, 2, 3
}
chart.dispose();
```

## Listeners and plugins

Errors thrown by chart event listeners (`chart.subscribe`, `ctx.events.subscribe`) and plugin lifecycle hooks are caught, logged with `console.error`, and never break the chart. A throwing listener does not stop later listeners for the same event (which run in subscription order), and it does not abort `render()`, `pan`, `zoom`, or `setViewport`. Errors from a plugin's `dispose` and cleanups are logged too, while the remaining resources are still released. Only `install()` errors propagate (from the constructor).

## Viewport and axes

| Situation | Behavior |
|---|---|
| `chart.setViewport({ xMin, xMax })` with a non-finite edge, or `xMax <= xMin` (same for Y) | Throws `RangeError`. The viewport is not changed. |
| `chart.zoom({ factor })` with `factor <= 0` or non-finite | Throws `RangeError`. |
| Wheel/drag zoom or pan reaches floating-point precision, or the next step would leave a log axis' valid domain | The step is rejected and the viewport stays where it was. Nothing is thrown. |
| Viewport that is valid for the camera but not for the axis scale, for example a zero or negative edge on a `log` axis, set through `setViewport` | The chart skips drawing, logs `BlazePlot skipped rendering: ...` with `console.error` once, and resumes automatically when the domain becomes valid. See [Troubleshooting](./troubleshooting.md#log-axis-throws-a-domain-error). |
| `fitToData()` with no data, or when the data has no valid domain for the axis scale | Returns `false` and leaves the viewport unchanged. |
| Axis options: `logBase <= 1`, `symlogConstant <= 0`, or a custom scale that does not map its domain to finite ascending values | `RangeError` (a custom scale without `fromScreen` throws `TypeError` on pointer interaction). |

## Invalid data values

Every built-in dataset follows one rule: X is finite and non-decreasing, and a non-finite Y is a gap. Static data that breaks the X rule throws (see [Static data](#static-data)); streaming buffers skip the sample instead, so one bad packet cannot crash a live dashboard. The check costs one comparison per appended sample. See [Data semantics](./data-semantics.md#the-x-rule) for the data contract.

| Input | Behavior |
|---|---|
| `NaN`, `Infinity`, or `-Infinity` as Y | Treated as a gap. Not drawn, not picked, ignored by bounds and `fitToData`. Line and area series break the strip at the gap. Stored as given, so `RingBuffer.getY(i)` returns the original value. |
| Non-finite open, high, low, or close in an OHLC candle | The candle is stored and treated as a gap: not drawn, not picked, skipped by bounds. |
| `NaN`, `Infinity`, or `-Infinity` as X in `RingBuffer` or `OhlcRingBuffer` | The sample is skipped (`push`, `append`) or the replacement is refused (`RingBuffer.update` returns `false`). Counted in `rejectedSamples`, reported to `onInvalidSample` with reason `"non-finite-x"`, and logged with one `console.warn` per buffer when no callback is set. Skipped samples do not count toward `length`, capacity, or `overflow` handling, so `overflow: "error"` does not throw for them. |
| X below the last accepted X in `RingBuffer` or `OhlcRingBuffer` | Skipped the same way, with reason `"decreasing-x"`. The rest of an `append` batch is still stored. After `clear()`, any finite X is accepted. |
| Non-finite X supplied to seed a `UniformRingBuffer` (`push`, `append`) | The X is ignored and one `console.warn` is logged per buffer; the Y sample is still stored and X continues from the current cursor. `UniformRingBuffer` derives X, so it never rejects samples. |
| Non-finite or decreasing X in `StaticDataset`, `StaticOhlcDataset`, `ServerSampledDataset`, `fromObjects`, or `series.replace` | Throws `RangeError` naming the first bad index. See [Static data](#static-data). |
| Duplicate X | Allowed. |
| Data mutated in place followed by `series.markDirty()` | Not re-checked. Keep in-place edits sorted and finite. |
| Custom `Dataset` with unsorted X | Not checked. Samples can be hidden, drawn in the wrong place, or missed by picking and export. |
| Mismatched array lengths | Every dataset constructor, `replace`, and `append(x, y, ...)` (`RingBuffer`, `UniformRingBuffer`, `OhlcRingBuffer`, `StaticDataset`, `StaticOhlcDataset`, `ServerSampledDataset`) throws `RangeError`, for example `RingBuffer.append: x has 100 values but y has 99.`, and leaves existing data unchanged. A mismatch is almost always a bug in the data pipeline, so the tail is not silently dropped. |
| Values beyond float32 precision | Stored as `float32` by default and rounded; pass `valuePrecision: "float64"` for exact storage. X is always `float64`. |
| `UniformRingBuffer` with explicit X | X is ignored; the buffer derives X from `xStart + index * xStep`. |
| Buffer full with `overflow: "wrap"` (default) | Oldest samples are dropped. |
| Buffer full with `overflow: "drop-new"` | New samples are dropped silently. |
| Buffer full with `overflow: "error"` | `RangeError("... capacity exceeded.")`. |
| Empty dataset | Reports `range: null`, renders nothing, returns no pick, is skipped by `fitToData` and auto-fit, and exports no samples. Not an error. |

Helper functions are stricter than datasets because they are pure and run once:

| Helper | Behavior |
|---|---|
| `binSamples(samples, binSize)` | `RangeError` when `binSize` is not a positive finite number. Samples with non-finite `x` or `y` are skipped. |
| `rollingMean(samples, windowSize)` | `RangeError` when `windowSize` is not a positive integer. Non-finite samples are skipped. |
| `histogram(values, options)` | Skips `NaN`, infinities, and non-number values (counted in `invalid`). `TypeError` for mutually exclusive `binSize`/`binCount`/`thresholds`, non-finite thresholds, or an unsupported `normalize`. `RangeError` for fewer than two thresholds, non-increasing thresholds, non-positive `binSize`, non-integer `binCount`, or `max < min`. An empty or all-invalid input returns zero bins instead of throwing. |
| `exportChartData(chart, options)` | Never throws for bad data. A `null` selection exports nothing; a non-finite `maxRowsPerSeries` is treated as no cap (positive) or zero rows (negative). |
| `chartDataToCsv(data)` | Never throws. Text cells that start with `=`, `+`, `-`, `@`, tab, or carriage return get a leading `'` unless `escapeFormulas: false`. |

## Rendering errors and context loss

- **Render-loop errors.** `chart.start()` schedules frames with `requestAnimationFrame`. A domain error (see above) is caught, logged once, and the frame is skipped. Any other exception inside a frame propagates out of the animation-frame callback, so it shows up in `window.onerror` and the console like any uncaught error. With `renderLoop: "continuous"` the loop keeps running after a thrown frame.
- **Context loss.** Every engine owns its loss handling and reports it to the chart, which stops drawing, runs plugins' `onContextLost` hook, and runs `onContextRestored` once the engine is ready again. Data and viewport are untouched. A WebGL engine calls `preventDefault()` on `webglcontextlost` and rebuilds its GPU resources on `webglcontextrestored`; if rebuilding fails it logs `BlazePlot failed to restore WebGL resources after context restoration.` with `console.error` and the chart stays blank, so recreate it. With the shared engine the one shared context handles loss once for every attached chart and a failed rebuild logs the same message. Canvas 2D handles the canvas `contextlost` and `contextrestored` events in browsers that fire them and has nothing to rebuild.
- **After `dispose()`.** Disposal releases DOM, listeners, plugins, and GPU resources. Calling `start()`, `resize()`, or series methods on a disposed chart is unsupported and has no defined behavior. Plugin `dispose` and cleanup functions that throw are logged and do not stop the rest of disposal.
- **Resize.** `ResizeObserver` is optional. Without it, call `chart.resize()` yourself. `resize()` returns whether the canvas size changed.

## Screenshots, downloads, clipboard

| Call | Failure |
|---|---|
| `chart.screenshot()` | Rejects with `Error` if a 2D canvas context cannot be created. |
| `copyChartScreenshotToClipboard` | Rejects with `Error` when `ClipboardItem` or the Clipboard API is missing. The browser can also reject for permissions or lack of a user gesture. |
| `downloadBlob`, `downloadChartScreenshot` | Need `document`; they do not guard against server-side use. |

Catch and show a fallback:

```ts
import type { Chart } from "blazeplot";
import { copyChartScreenshotToClipboard, downloadChartScreenshot } from "blazeplot/export";

export async function copyOrDownload(chart: Chart): Promise<void> {
  try {
    await copyChartScreenshotToClipboard(chart);
  } catch {
    await downloadChartScreenshot(chart, { filename: "chart.png" });
  }
}
```

## Console output summary

| Message starts with | Level | Meaning |
|---|---|---|
| `RingBuffer skipped a sample ...` / `OhlcRingBuffer skipped a sample ...` | `warn` (once per buffer, not logged when `onInvalidSample` is set) | A sample had a non-finite X or an X below the last accepted one and was skipped. Read `rejectedSamples` or pass `onInvalidSample` to track later ones. |
| `UniformRingBuffer received non-finite X ...` | `warn` (once per buffer) | A non-finite seed X was ignored; the Y sample was kept. |
| `BlazePlot skipped rendering:` | `error` (once until fixed) | Viewport invalid for an axis scale. |
| `BlazePlot <event> listener failed:` | `error` | A chart event listener threw. The remaining listeners still ran. |
| `BlazePlot plugin <hook> hook failed:` / `plugin dispose failed:` / `plugin cleanup failed:` | `error` | A plugin hook, dispose, or tracked cleanup threw. Other plugins and resources were still released. |
| `BlazePlot failed to restore WebGL resources after context restoration.` | `error` | GPU resources could not be rebuilt after context loss (per-chart or shared context). |

BlazePlot has no other runtime logging. There is no debug flag. Deprecated APIs, once any exist, log a single development-only `BlazePlot: ... is deprecated` warning per API per page load; production builds are silent. See the [deprecation process](./versioning-and-migration.md#deprecation-process).
