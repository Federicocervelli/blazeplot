# Data semantics

BlazePlot expects finite, non-decreasing X values and treats non-finite Y values as gaps. Static datasets check X once when they are built and throw on bad input; streaming buffers skip bad samples and report them. See [The X rule](#the-x-rule).

## Pick the right dataset

| Source shape | Dataset | Notes |
|---|---|---|
| Fixed X/Y arrays | `StaticDataset` | Already-loaded history or snapshots. Swap data with `series.replace({ y })`. |
| Unsorted X/Y arrays | `StaticDataset.sorted(x, y)` | Copies, sorts stably by X, and drops non-finite X. |
| Object rows | `StaticDataset.fromObjects(...)` | Copies row fields or accessor results into sorted X/Y arrays. |
| Irregular live samples | `RingBuffer` | Stores explicit X/Y pairs and keeps a bounded history. |
| Fixed-rate live samples | `UniformRingBuffer` | Stores Y values only and derives X from `xStart + index * xStep`. |
| Historical OHLC/candles | `StaticOhlcDataset` | Bounds and fitting use high/low values. |
| Live OHLC/candles | `OhlcRingBuffer` | Rolling OHLC history with explicit time values. |
| Server-reduced buckets | `ServerSampledDataset` | Use `downsample: "server"` for min/max buckets. |
| One-dimensional values | `histogramBins(...)` / `HistogramDataset.from(...)` with `chart.addBar(...)` | Converts raw values to bucket centers/counts and renders with the bar path. |
| Custom remote/procedural data | `Dataset` or `AcceleratedDataset` | Implement sorted logical access and only the fast paths your data can answer cheaply. |

## Empty datasets

Empty datasets:

- report `range: null`,
- render nothing,
- return no pick results,
- are ignored by `chart.fitToData()` and auto-fit policies.

## The X rule

Every built-in dataset follows one rule:

- X is finite and non-decreasing. Duplicate X values are allowed; `NaN`, `Infinity`, `-Infinity`, and an X below the previous one are not.
- A non-finite Y is a gap, not an error (see [Gaps](#gaps)).

Range searches, LOD extraction, culling, picking, and exports binary-search X, so a dataset that broke the rule would silently hide samples or draw them in the wrong place. Each dataset enforces the rule where data enters:

| Dataset | Bad X | Cost |
|---|---|---|
| `StaticDataset`, `StaticOhlcDataset` | Constructor throws `RangeError` naming the first bad index and reason. | One O(n) pass at construction; skip it with `{ assumeSorted: true }`. |
| `StaticDataset.replace(...)` / `series.replace(...)` | Throws `RangeError`; the current data is kept. A Y-only replace re-checks only X values that come into use. | O(n) per new X array (skipped with `assumeSorted`). |
| `StaticDataset.fromObjects(...)` | Throws `RangeError` naming the row for non-finite X, and for decreasing X unless `sort: true`. | Part of the copy. |
| `ServerSampledDataset` | Constructor and `replace` throw `RangeError` for non-finite or decreasing point X, `xStart`, or `xEnd`, or a bucket with `xEnd < xStart` (`inverted-bucket`). Buckets may overlap. | Part of the copy. |
| `RingBuffer`, `OhlcRingBuffer` | The sample is skipped, never thrown. It is counted in `rejectedSamples`, passed to `onInvalidSample`, and logged with one `console.warn` per buffer when no callback is set. | One comparison pair per sample; no allocation unless a batch contains a bad sample. |
| `UniformRingBuffer` | Cannot happen: X is derived from `xStart + index * xStep`. A non-finite seed X is ignored (the Y sample is kept) with one warning; a non-finite `xStart` option throws `RangeError`. | None. |

Static errors read like `StaticDataset: X at index 2 is 1, below 2 at index 1 (decreasing-x). X values must be finite and non-decreasing. ...` or `StaticDataset: X at index 1 is NaN (non-finite-x). ...`. Match them with `instanceof RangeError`, not by message text.

To fix unsorted static input, copy it through `StaticDataset.sorted(x, y)` or `StaticOhlcDataset.sorted(x, open, high, low, close)`. They sort stably by X (equal X values keep their input order), carry Y or the OHLC columns along, and drop samples whose X is non-finite. For object rows, use `StaticDataset.fromObjects(rows, { x, y, sort: true })`. Pass `{ assumeSorted: true }` only for large data you already trust; if it is in fact unsorted, results are unreliable.

Custom `Dataset` implementations must expose the same sorted logical order; BlazePlot does not check them. The optional capabilities of a dataset (`isGap`, `rangeMinMaxY`, the fast-path copy methods, `getXRange`, and so on) are detected once when the series is created, so methods added to a dataset afterwards are not picked up.

### Streaming: skip, count, report

Streaming buffers skip bad samples instead of throwing. A sample is invalid when its X is non-finite or lower than the newest accepted X. Skipped samples are not stored and do not count toward capacity or the `overflow` strategy, so `overflow: "error"` never throws because of them. In an `append` batch, the valid samples are still stored; the result is the same as calling `push` for each sample in order (except that `overflow: "error"` throws before storing anything). After `clear()`, any finite X is accepted again. `RingBuffer.update(index, x, y)` returns `false` and counts a rejection when `x` is non-finite or outside its neighbors' X values.

```ts
import { RingBuffer, type InvalidSample } from "blazeplot";

const rejected: InvalidSample[] = [];
const buffer = new RingBuffer(10_000, { onInvalidSample: (sample) => rejected.push(sample) });

buffer.append([1, 2, Number.NaN, 1.5, 3], [10, 20, 30, 40, 50]);
console.log(buffer.length); // 3: X 1, 2, 3
console.log(buffer.rejectedSamples); // 2
console.log(rejected.map(({ reason, index }) => `${index}: ${reason}`)); // ["2: non-finite-x", "3: decreasing-x"]
```

The callback receives an `InvalidSample`:

| Field | Meaning |
|---|---|
| `reason` | `"non-finite-x"` or `"decreasing-x"`. |
| `operation` | `"push"`, `"append"`, or `"update"`. |
| `index` | Position in the arrays passed to `append`, the logical index for `update`, `0` for `push`. |
| `x`, `y` | The rejected values (`y` is the close for OHLC). `OhlcRingBuffer` passes an `InvalidOhlcSample` that also has `open`, `high`, `low`, `close`. |
| `neighborX` | For `"decreasing-x"`, the accepted X the sample violated (for `update` past its right neighbor, that neighbor's X). `NaN` for `"non-finite-x"`. |

Setting `onInvalidSample` turns off the console warning for that buffer. `rejectedSamples` counts since creation and is not reset by `clear()`. For chart-owned series, pass the callback in the series config: `chart.addLine({ capacity, onInvalidSample })`.

## Invalid values

- X values follow [the X rule](#the-x-rule): static datasets throw, streaming buffers skip.
- Parallel input arrays must have the same length. A mismatch throws a `RangeError` naming both lengths (for example `RingBuffer.append: x has 100 values but y has 99.`) from constructors, `replace`, and `append`, and the existing data is left unchanged.
- Non-finite Y values (`NaN`, `Infinity`, `-Infinity`) act as missing/gap samples for built-in extraction, picking, and data bounds. They are stored as given.
- An OHLC candle with any non-finite open, high, low, or close is a gap: it is stored, but not drawn, picked, or counted in bounds.
- Built-in datasets do not re-check data you mutate in place (for example writing into a `StaticDataset` array and calling `series.markDirty()`); keep such edits sorted yourself.

## Gaps

Built-in picking and bounds skip gap samples. Line and area series also treat gap samples as strip breaks: the gap sample is not rendered or picked, and finite samples on either side are not connected.

You can mark a gap in either of these ways:

- store a non-finite Y value such as `NaN` at the sorted X position where the break should happen;
- implement `isGap(index): boolean` on a custom `Dataset`.

If a custom dataset also implements accelerated methods such as `rangeMinMaxY`, `copySamplesRange`, `copyVisibleSamples`, `copyVisiblePoints`, or `copyMinMaxSegments`, those methods are renderer fast paths and must skip or encode gaps themselves.

For finite-to-finite session breaks, insert an explicit gap marker sample.

## Ring buffers

`RingBuffer` stores explicit X/Y samples and supports three overflow modes (`new RingBuffer(capacity, { overflow })`, or `overflow` in the config of a chart-owned `chart.addLine({ capacity })`): `"wrap"`, `"drop-new"`, and `"error"`. The default is `"wrap"`, which keeps the newest samples and preserves logical order after the physical buffer wraps.

X values must be finite and non-decreasing; see [Streaming: skip, count, report](#streaming-skip-count-report) for what happens to samples that are not.

`UniformRingBuffer` is for fixed-rate data. It stores Y values and derives X as `xStart + index * xStep`; `xStep` must be positive. It always wraps at capacity (it has no overflow option). Use it for telemetry or signal data with evenly spaced samples. For chart-owned series, `chart.addLine({ capacity, xStart, xStep })` creates this dataset for you. Passed X values only seed the stream: `series.append({ x, y })` uses the first X when the buffer is empty (or when one batch is at least as long as the buffer), and otherwise ignores X and keeps deriving it from `xStep`; use `RingBuffer` when spacing varies. Because X is derived, `series.updateAt(index, { x, y })` throws a `TypeError` on it; update Y with `{ y }`.

### Value precision

Built-in buffers store Y (and OHLC prices) as `float32` by default: half the memory, about 7 significant digits. Values such as `123456789.12` or prices above 100,000 with cents get rounded, and the rounded value is what tooltips and `chart.pick()` report. Pass `valuePrecision: "float64"` to `RingBuffer`, `UniformRingBuffer`, `OhlcRingBuffer`, `StaticDataset.fromObjects`, or a chart-owned series (`chart.addLine({ capacity, valuePrecision: "float64" })`) to store values exactly (`StaticDataset.sorted` takes the same option). `new StaticDataset(x, y)` reads your arrays in place, so a `Float64Array` stays exact. `ServerSampledDataset` always stores Y as `float32`. X values are always stored as `float64`.

Rendering has its own precision. The GPU works in `float32`, so the chart subtracts a per-frame origin from X and from Y (the left edge and bottom of each linear axis's viewport) in `float64` before uploading vertices. A line such as `1e6 + sin(t) * 0.01` therefore draws smoothly when zoomed to fit. Logarithmic and other nonlinear Y axes are transformed on the CPU and are not shifted. Custom datasets that implement the experimental fast-path copy interfaces are shifted after their `float32` copy, so very large Y offsets can still quantize there.

## Histograms and X/Y binning

`histogramBins(values, options)` bins one-dimensional finite values by value range. It skips `NaN`, infinities, and non-number values, tracks underflow/overflow outside the chosen bin edges, and can normalize bucket heights as counts, probability, percent, or density. Fixed-size bins align to origin `0` by default; pass `align` to use another origin. `HistogramDataset.from(values, options)` (or `new HistogramDataset(histogramBins(values, options))`) turns those buckets into a dataset you pass to `chart.addBar({ dataset })`; bars default to the bin width. Each rendered sample is centered at the bucket midpoint for the bar renderer, while the dataset exposes generic X-interval metadata that tooltip and picking code can present as a range.

`binSamples(samples, binSize, options)` is different: it expects existing `{ x, y }` samples and groups them by X interval with a Y reducer such as mean, sum, min, or max.

Variable-width explicit histogram thresholds are supported by the pure `histogramBins(...)` helper. The chart helper uses one `barWidth` for the whole series: `chart.addBar({ dataset })` defaults it to the bin width of uniform bins, and throws a `TypeError` for variable-width bins unless you pass an explicit `style.barWidth`. Use uniform-width bins when you want accurate bar widths.

## Server-sampled datasets

`ServerSampledDataset` holds data that was already reduced before it reached the browser.

- Point data represents concrete X/Y samples. Use it with `downsample: "none"`.
- Min/max bucket data represents `{ xStart, xEnd, minY, maxY }` envelopes. Use it with `downsample: "server"` so BlazePlot renders those envelopes directly.
- Bucket `xStart` and `xEnd` must each be finite and non-decreasing, with `xEnd >= xStart` per bucket; buckets may overlap. Anything else throws `RangeError`. Viewport extraction includes buckets whose X range overlaps the viewport.
- Generic APIs expose a bucket midpoint for `getX()` and a midpoint between `minY`/`maxY` for `getY()`; rendering and bounds use the full bucket range.

See [Performance recipes](./performance-recipes.md) for when to choose server-side sampling.

## Series bounds and fitting

`chart.fitToData()` and Y auto-fit use the series data bounds. Empty series and missing values are ignored. OHLC/candlestick bounds use high/low values rather than close.

## OHLC datasets

OHLC and candlestick datasets expose close through generic `getY()`. Bounds and fitting use high/low. A candle with any non-finite price is a gap. Use `StaticOhlcDataset` for fixed history and `OhlcRingBuffer` for live OHLC data.

## Export and picking

`chart.pick()` returns raw sample coordinates, not downsampled screen buckets. `exportChartData(chart, options)` collects every sample of every shown series by default (`range: "all"`; hidden series need `includeHidden: true`). Pass `range: "visible"` for the current X range, add `includeYRange: true` to also filter by each series' current Y range, or pass a selection plugin state as `range` to export the selected samples. Export reads the dataset samples, so it is not limited by what LOD draws. See [Examples](./examples.md#export-image-and-data).
