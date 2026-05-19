# Data semantics

BlazePlot data paths assume numeric, finite, X-sorted samples unless a dataset explicitly documents otherwise.

## Empty datasets

Empty datasets report `range: null`, render nothing, return no picks, and are ignored by `chart.fitToData()` / auto-fit policies.

## X ordering

- Built-in binary search, LOD, and viewport extraction assume logical X values are sorted ascending.
- Duplicate X values are allowed; range searches include all samples matching the viewport bounds.
- Unsorted X values are unsupported for built-in datasets and can produce incorrect search, LOD, and picking results.

## Invalid values

- Finite X/Y values are expected for rendering and picking.
- `NaN` and infinities should be filtered by producers or by custom dataset implementations before data reaches render paths.
- Current built-in datasets store numeric values as provided; strict validation modes and explicit line/area gap rendering are tracked as future work.

## Missing data and gaps

Line and area discontinuity rendering is not yet a first-class feature. Until gap-aware extraction lands, callers should split discontinuous data into separate series or filter invalid spans before appending.

## OHLC datasets

OHLC/candlestick datasets expose close as generic `getY()`. Fit/bounds helpers use high/low for the Y domain.
