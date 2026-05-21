# Data semantics

BlazePlot expects finite, sorted X values. Y values are normally finite; non-finite Y values are treated as gaps by built-in datasets. The library does not sort or fully validate built-in datasets on every update; that would be too expensive for large live streams.

## Pick the right dataset

| Source shape | Dataset | Notes |
|---|---|---|
| Fixed X/Y arrays | `StaticDataset` | Best for already-loaded history or immutable snapshots. |
| Object rows | `StaticDataset.fromObjects(...)` or `createChart(...)` | Copies row fields or accessor results into sorted X/Y arrays. |
| Irregular live samples | `RingBuffer` | Stores explicit X/Y pairs and keeps a bounded history. |
| Fixed-rate live samples | `UniformRingBuffer` | Stores Y values only and derives X from `xStart + index * xStep`. |
| Historical OHLC/candles | `StaticOhlcDataset` | Bounds and fitting use high/low values. |
| Live OHLC/candles | `OhlcRingBuffer` | Rolling OHLC history with explicit time values. |
| Server-reduced buckets | `ServerSampledDataset` | Use `downsample: "server"` for min/max buckets. |
| Custom remote/procedural data | `Dataset` or `AcceleratedDataset` | Implement sorted logical access and only the fast paths your data can answer cheaply. |

## Empty datasets

Empty datasets:

- report `range: null`,
- render nothing,
- return no pick results,
- are ignored by `chart.fitToData()` and auto-fit policies.

## X ordering

- Built-in datasets expect logical X values sorted ascending.
- Duplicate X values are allowed. Range searches include all samples on the viewport bounds.
- Unsorted X values can break binary search, LOD extraction, picking, and exported visible data.
- Ring buffers preserve logical order after wrapping, but appended X values still need to move forward in that logical order.

If you need unsorted source data, sort it before passing it to a built-in dataset or implement a custom dataset that exposes sorted logical access.

## Invalid values

- X values should be finite numbers.
- Non-finite Y values (`NaN`, `Infinity`, `-Infinity`) act as missing/gap samples for built-in extraction, picking, and data bounds.
- Built-in datasets store numeric values as provided. They do not reorder data or scan everything for invalid values by default.

## Gaps

Built-in picking and bounds skip gap samples. Line and area series also treat gap samples as strip breaks: the gap sample is not rendered or picked, and finite samples on either side are not connected.

You can mark a gap in either of these ways:

- store a non-finite Y value such as `NaN` at the sorted X position where the break should happen;
- implement `isGap(index): boolean` on a custom `Dataset`.

If a custom dataset also implements accelerated methods such as `rangeMinMaxY`, `copySamplesRange`, `copyVisibleSamples`, `copyVisiblePoints`, or `copyMinMaxSegments`, those methods are renderer-ready fast paths. They should skip or encode gaps consistently themselves.

For finite-to-finite session breaks, insert an explicit gap marker sample.

## Ring buffers

`RingBuffer` stores explicit X/Y samples and supports three overflow modes: `"wrap"`, `"drop-new"`, and `"error"`. The default is `"wrap"`, which keeps the newest samples and preserves logical order after the physical buffer wraps.

`UniformRingBuffer` is for fixed-rate data. It stores Y values and derives X as `xStart + index * xStep`; `xStep` must be positive. Prefer it for telemetry or signal data where every sample is evenly spaced. For chart-owned series, `chart.addLine({ capacity, xStart, xStep })` creates this dataset for you.

## Server-sampled datasets

`ServerSampledDataset` is for data that was already reduced before it reached the browser.

- Point data represents concrete X/Y samples. Use it with `downsample: "none"`.
- Min/max bucket data represents `{ xStart, xEnd, minY, maxY }` envelopes. Use it with `downsample: "server"` so BlazePlot renders those envelopes directly.
- Bucket ranges should be sorted by X and should describe the visible interval they cover. Viewport extraction includes buckets whose X range overlaps the viewport.
- Generic APIs expose a bucket midpoint for `getX()` and a midpoint between `minY`/`maxY` for `getY()`; rendering and bounds use the full bucket range.

See [Performance recipes](./performance-recipes.md) for when to choose server-side sampling.

## Series bounds and fitting

`chart.fitToData()` and Y auto-fit use the series data bounds. Empty series and missing values are ignored. OHLC/candlestick bounds use high/low values rather than close.

## OHLC datasets

OHLC and candlestick datasets expose close through generic `getY()`. Bounds and fitting use high/low. Use `StaticOhlcDataset` for fixed history and `OhlcRingBuffer` for live OHLC data.

## Export and picking

`chart.pick()` returns raw sample coordinates, not downsampled screen buckets. Data export helpers use the current visible X range by default; pass `{ includeYRange: true }` when you also want to filter by the current Y range. See [Examples](./examples.md#export-image-and-data).
