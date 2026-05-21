# Performance recipes

BlazePlot is fast when the data model and the visible range match how the renderer works. The most important rules are simple: keep X sorted, batch writes, avoid rebuilding charts, and let LOD handle dense views.

## Decision guide

| Situation | Prefer | Why |
|---|---|---|
| Appending irregular telemetry | `RingBuffer` with batched `append(...)` | Keeps a bounded rolling history without reallocating arrays. |
| Appending fixed-rate telemetry | `UniformRingBuffer.appendY(...)` | Avoids storing repeated X values. |
| Rendering dense historical ranges | Built-in LOD or `ServerSampledDataset` | Reduces visible work while preserving extrema. |
| Rendering a small exact viewport | `downsample: "none"` | Avoids sampler overhead when visible points are already bounded. |
| Backend already has min/max buckets | `ServerSampledDataset` + `downsample: "server"` | Prevents double-sampling on the client. |
| Chart is hidden but still mounted | `chart.stop()` | Avoids unnecessary frames; call `chart.start()` when visible again. |

## Streaming data

- Use `RingBuffer` for irregular live samples and `UniformRingBuffer` for fixed-rate samples.
- For fixed-rate data, append only Y batches with `appendY(...)` so you do not store or copy repeated X values.
- Set capacity to the largest history window you need to keep in memory.
- Append typed-array batches when possible instead of one sample at a time, for example `Float64Array` X plus `Float32Array` Y for `append(...)` or `Float32Array` Y for `appendY(...)`.
- Keep X values sorted in logical order. Binary search, picking, and LOD depend on it.
- Choose an overflow mode intentionally:
  - `"wrap"` for rolling live windows,
  - `"drop-new"` when backpressure is safer than overwriting history,
  - `"error"` when ingestion bugs should fail loudly.

For exact ordering and gap behavior, see [Data semantics](./data-semantics.md).

## Static or remote data

- Use `new StaticDataset(x, y)` for fixed arrays.
- Use typed arrays for large datasets to reduce memory and copy cost.
- For remote, procedural, or memory-mapped data, implement the accelerated methods your data can answer cheaply: `rangeMinMaxY`, `copySamplesRange`, `copyVisibleSamples`, `copyVisiblePoints`, or `copyMinMaxSegments`. These contracts are listed in the [API reference](./api-reference.md#all-public-exports).
- If your server already returns reduced min/max buckets, use `ServerSampledDataset` with `downsample: "server"` so the client renders the supplied buckets directly.

## Choosing downsampling

- Line and bar series use min/max LOD by default in dense views.
- Use `downsample: "none"` only when the number of visible samples is bounded and exact raw rendering matters.
- Scatter series first extract exact visible points, then sample when the visible set is too large.
- Area series render sampled strips and do not use min/max LOD. If preserving extremes matters more than filled-shape continuity, use a line/bar series or server-sampled min/max buckets.
- Server-sampled min/max data should use `downsample: "server"`.

## Reducing per-frame work

- Create charts once. Update datasets and keep the chart's `start()` loop running instead of recreating the chart.
- Call `chart.start()` once for an active chart lifecycle, or after a matching `chart.stop()`. Do not call it repeatedly from reactive render paths.
- Use `chart.stop()` when a chart is hidden or inactive, then `chart.start()` again when it should resume rendering.
- Remove unused series with `chart.removeSeries(series)`.
- Dispose charts on unmount with `chart.dispose()`.
- Keep optional features in subpath imports, for example `blazeplot/plugins/tooltip`, so chart-only bundles stay smaller.

## Browser budgets

GPU upload size, draw calls, and DOM overlays all matter. Large legends, many annotation labels, or very frequent layout changes can hurt performance even when the WebGL plot is fast.

Use the browser tests and benchmark commands in [Release and benchmark notes](./release-and-benchmarks.md#benchmark-and-bundle-size-commands) when checking a performance-sensitive change.
