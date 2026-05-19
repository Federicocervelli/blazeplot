# Performance recipes

BlazePlot is optimized for large browser plots through WebGL2 rendering and data-space LOD.

## Streaming data

- Use ring-buffer series for live feeds and set capacity to the largest visible/history window you need.
- Prefer typed-array batch appends over one point at a time.
- Keep X values sorted for binary-search and LOD extraction paths.
- Use `overflow: "wrap"` for live charts, `"drop-new"` for backpressure, or `"error"` for strict ingestion.

## Static data

- Use `new StaticDataset(x, y)` for typed arrays.
- Supply custom datasets that implement accelerated copy/min-max capabilities for remote, procedural, or memory-mapped data.

## LOD choices

- Default line/bar LOD uses min/max buckets for dense views.
- Use `downsample: "none"` when exact raw rendering is required and the visible point count is bounded.
- Scatter defaults to viewport-aware point sampling after exact visible extraction exceeds the point budget.
- Area series render sampled strips and intentionally skip min/max LOD.

## Memory budgeting

- Reuse series and append batches instead of recreating charts.
- Call `chart.removeSeries(series)` for discarded series and `chart.dispose()` for unmounted charts.
- Run `bun run bench:ci` and browser visual tests before releases that change rendering or extraction paths.
