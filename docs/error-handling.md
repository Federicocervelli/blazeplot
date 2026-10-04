# Error handling

This page lists what BlazePlot throws, what it logs, and what it does silently with bad input. It is for app developers who feed charts from untrusted or imperfect sources. Every behavior here was checked against the source and unit tests; if the code and this page disagree, the code wins and the page is a bug.

The short version: **constructors and explicit configuration throw early; data values never throw.** Bad numbers in data are skipped as gaps or produce undefined drawing (never an exception), and a broken viewport skips the frame instead of stopping the render loop.

## Error types

| Error | Thrown by | When |
|---|---|---|
| `WebGL2UnavailableError` (extends `Error`, `name === "WebGL2UnavailableError"`) | `new Chart(...)`, `new WebGL2Backend(canvas)`, `createLinkedCharts(...)` | The canvas cannot create a WebGL2 context. |
| `RangeError` | Datasets, `Camera2D`, axes, histogram and data helpers | A number is out of range: non-positive capacity, `xStep <= 0`, index out of range, `xMax <= xMin`, non-finite viewport edge, capacity exceeded with `overflow: "error"`, `binSize <= 0`, invalid histogram bins. |
| `TypeError` | `Chart.addSeries`/`add*`, `SeriesStore` mutators, `StaticDataset.fromObjects`, `histogram` | The call does not fit the dataset or option shape: appending `{ y }` to a dataset without implicit X, mixing OHLC and XY rows, OHLC series without an `OhlcDataset`, a non-finite X in `fromObjects`, conflicting histogram options. |
| `Error` | `blazeplot/export`, `chart.screenshot()`, flame graph plugin, WebGL internals | Browser feature missing (`ClipboardItem`, Clipboard API, 2D canvas), or a shader/program failed to compile or link. |

Only `WebGL2UnavailableError` is a named class. Match other failures with `instanceof RangeError` / `instanceof TypeError`, not by message text; messages are for humans and can be reworded in any release.

## Creating a chart

`new Chart(target, options)` throws `WebGL2UnavailableError` when no WebGL2 context is available. Before it throws it removes the DOM it created and hands back any canvas you supplied, so a failed construction leaves your container as it was. `createLinkedCharts(...)` behaves the same way.

If a plugin's `install()` throws, the chart disposes everything already set up and rethrows that error from the constructor.

Check availability first when you want fallback UI instead of a `try`/`catch`:

```ts
import { Chart, WebGL2UnavailableError, isWebGL2Available } from "blazeplot";

export function mountChart(element: HTMLElement): Chart | null {
  if (!isWebGL2Available()) {
    element.textContent = "This chart needs WebGL2.";
    return null;
  }
  try {
    const chart = new Chart(element);
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
| `chart.addOhlc(...)` / `addCandlestick(...)` | `TypeError` without an `OhlcDataset`. |
| `chart.addHistogram(...)` | `TypeError` when variable-width bins have no `style.barWidth`; histogram option errors below. |
| `series.append({ x, y })` | `TypeError` when the dataset is not appendable XY (for example `StaticDataset`). `RangeError("... capacity exceeded.")` for `overflow: "error"` buffers that are full. |
| `series.append({ y })` | `TypeError` unless the dataset has implicit X (`UniformRingBuffer`). |
| `series.append([...rows])` | `TypeError` when rows mix XY and OHLC, or mix explicit and implicit X. |
| `series.updateAt`, `updateLast`, `replace`, `clear` | `TypeError` when the dataset does not support that operation. |

`RingBuffer.update`, `updateY`, and the equivalent methods on other buffers return `false` for an out-of-range index instead of throwing. `getX` and `getY` on the built-in datasets throw `RangeError` for a bad index.

Dataset constructors validate their arguments: `RingBuffer`, `OhlcRingBuffer`, and `UniformRingBuffer` require a positive integer capacity, and `UniformRingBuffer` requires a positive finite `xStep`. All throw `RangeError`.

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

Built-in datasets never validate values on every append, because that would be too expensive for live streams. They store what you give them, and the chart then handles bad values as follows. See [Data semantics](./data-semantics.md) for the data contract.

| Input | Behavior |
|---|---|
| `NaN`, `Infinity`, or `-Infinity` as Y | Treated as a gap. Not drawn, not picked, ignored by bounds and `fitToData`. Line and area series break the strip at the gap. Stored as given, so `RingBuffer.getY(i)` returns the original value. |
| Non-finite Y in OHLC high/low | Bounds skip the sample; the dataset does not throw. |
| `NaN`, `Infinity`, or `-Infinity` as X in `RingBuffer` | The sample is skipped (`push`, `append`) or the replacement is refused (`update` returns `false`), with one `console.warn` per buffer. Skipped samples do not count toward `length`, capacity, or `overflow` handling, so `overflow: "error"` does not throw for them. |
| Non-finite X supplied to seed a `UniformRingBuffer` (`push`, `append`) | The X is ignored and one `console.warn` is logged per buffer; the Y sample is still stored and X continues from the current cursor. |
| `NaN` or `Infinity` as X in `OhlcRingBuffer`, `StaticDataset` | Not rejected. The value is stored, and because every X search assumes ascending finite values, results for the whole series become unreliable (hidden samples, wrong picks, wrong bounds). Clean X before appending. |
| `NaN` as X in `StaticDataset.fromObjects(...)` | Throws `TypeError` naming the row. The one place X is validated. |
| Unsorted X | Not sorted or rejected. `RingBuffer` and `OhlcRingBuffer` call `console.warn` once per buffer instance when an append or update makes X go backwards. `StaticDataset`, `ServerSampledDataset`, and custom datasets give no warning. The effect is silent: samples can be hidden, drawn in the wrong place, or missed by picking and export. `StaticDataset.fromObjects(rows, { sort: true })` sorts for you. |
| Duplicate X | Allowed. |
| Mismatched array lengths | `StaticDataset` and `RingBuffer.append(x, y)` use the shorter array and ignore the extra values. No error. |
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
| `chartDataToCSV(data)` | Never throws. Text cells that start with `=`, `+`, `-`, `@`, tab, or carriage return get a leading `'` unless `escapeFormulas: false`. |

## Rendering errors and context loss

- **Render-loop errors.** `chart.start()` schedules frames with `requestAnimationFrame`. A domain error (see above) is caught, logged once, and the frame is skipped. Any other exception inside a frame propagates out of the animation-frame callback, so it shows up in `window.onerror` and the console like any uncaught error. With `renderLoop: "continuous"` the loop keeps running after a thrown frame.
- **WebGL context loss.** The chart calls `preventDefault()` on `webglcontextlost`, stops drawing, and recreates GPU resources on `webglcontextrestored`. Data and viewport are untouched. If recreation fails, the chart logs `BlazePlot failed to restore WebGL resources after context restoration.` with `console.error` and stays blank; recreate the chart.
- **After `dispose()`.** Disposal releases DOM, listeners, plugins, and GPU resources. Calling `start()`, `resize()`, or series methods on a disposed chart is unsupported and has no defined behavior. Plugin cleanup functions that throw are swallowed so the rest of disposal still runs.
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
| `RingBuffer received X ...` / `OhlcRingBuffer received X ...` | `warn` (once per buffer) | X went backwards. Sort data before appending. |
| `BlazePlot skipped rendering:` | `error` (once until fixed) | Viewport invalid for an axis scale. |
| `BlazePlot failed to restore WebGL resources after context restoration.` | `error` | GPU resources could not be rebuilt after context loss. |

BlazePlot has no other runtime logging. There is no debug flag and no deprecation logging yet; the [deprecation process](./versioning-and-migration.md#deprecation-process) describes the planned development-only warnings.
