# Data semantics

BlazePlot data paths assume numeric, finite, X-sorted samples unless a dataset explicitly documents otherwise.

## Empty datasets

Empty datasets report `range: null`, render nothing, return no picks, and are ignored by `chart.fitToData()` / auto-fit policies.

## X ordering

- Built-in binary search, LOD, and viewport extraction assume logical X values are sorted ascending.
- Duplicate X values are allowed; range searches include all samples matching the viewport bounds.
- Unsorted X values are unsupported for built-in datasets and can produce incorrect search, LOD, and picking results.

## Invalid values

- Finite X values are expected and must remain sorted in logical order.
- Non-finite Y values (`NaN`, `Infinity`, `-Infinity`) are treated as missing data for built-in line/area extraction and picking.
- Built-in datasets store numeric values as provided; they do not reorder data or perform full validation scans by default.

## Missing data and gaps

Line and area series treat gap samples as strip breaks: the gap sample itself is not rendered or picked, and finite samples on either side are not connected.

Gap markers can be expressed in two ways:

- Append/store a non-finite Y value such as `NaN` at the sorted X position where the discontinuity occurs.
- Custom datasets can implement optional `isGap(index): boolean` on the `Dataset` contract. Accelerated custom range/copy methods (`rangeMinMaxY`, `copySamplesRange`, `copyVisibleSamples`, `copyVisiblePoints`, or `copyMinMaxSegments`) should skip or encode their own gaps consistently because those methods are considered renderer-ready fast paths.

For finite-to-finite session breaks, insert an explicit gap marker sample for now. A dedicated session-boundary API may be added later.

## OHLC datasets

OHLC/candlestick datasets expose close as generic `getY()`. Fit/bounds helpers use high/low for the Y domain.
