# Automated browser benchmarks

Run the headless benchmark harness with:

```sh
bun run bench --scenario mixed-1m-live --out bench-result.json
```

Append a persistent markdown benchmark log with:

```sh
bun run bench:report --scenario mixed-1m-live --measure-ms 5000
```

By default this appends to `docs/internal/benchmark-results.md`. Use `--out-md path/to/file.md` to write elsewhere, and pass comma-separated scenarios such as `--scenario mixed-1m-live,line-5m-static`.

The harness starts Vite, opens `/bench/` in headless Chrome/Chromium, waits for the chart scene to load and warm up, starts the Chrome CPU profiler, runs the scenario, then prints a JSON report. The report includes chart/RAF FPS summaries, frame timing, draw/upload stats, Chrome performance metrics, and a top-N bottom-up CPU profile table.

Useful options:

```sh
bun run bench -- --help
bun run bench --scenario line-5m-static --measure-ms 10000 --top 80
bun run bench --scenario mixed-10m-live --setup-timeout-ms 240000 --out bench-10m.json
```

If Chrome/Chromium/Brave is not on `PATH`, pass `--chrome /path/to/browser` or set `BLAZEPLOT_BENCH_CHROME`. For Brave installed at `/usr/bin/brave`:

```sh
bun run bench --scenario mixed-1m-live --chrome /usr/bin/brave --out bench-result.json
```

By default the harness uses software WebGL (SwiftShader) so results are comparable with CI. Set `BLAZEPLOT_REAL_GPU=1` to run on the real GPU (the SwiftShader flags are dropped and the headless frame-rate limit is lifted) and `BLAZEPLOT_CHROME_FLAGS="--flag"` to append browser flags; see [Local development](./local-development.md#browser-backed-checks). Real-GPU numbers are for your own comparisons only.

Built-in scenarios live in `tests/browser/bench/main.ts`:

- `mixed-1m-live` (default): line + scatter + bars with live appends.
- `mixed-1m-hover` and `mixed-1m-pan`: the same scene without live appends, with synthetic pointer hover (`mixed-1m-hover`) or automated panning (`mixed-1m-pan`).
- `line-5m-static`: static downsampled line scene.
- `mixed-10m-live`: heavier version of the preview-style mixed live scene.
- `line-1b-procedural`: billion-point line stress test backed by a procedural dataset, kept out of the interactive preview.
- `flamechart-360k-pan`: flame chart scene (75,000 stacks) panning through the flame graph plugin.
- `many-series-100x20k-pan`: 100 line series of 20k samples each, panned; per-series LOD, upload, and draw overhead dominates.
- `scatter-1m-sampled-pan`: 1M-point sampled scatter series, panned.
- `ci-smoke`: 100k-sample mixed scene with live appends, used by `bun run bench:ci` and the release benchmark tables; it only checks that the scene renders.
- `perf-gate`: deterministic 1M-sample line + scatter + bars scene panning over a 500k-sample window; used only by `bun run bench:gate` (see [Release and benchmark notes](../release-and-benchmarks.md#performance-regression-gate)). Every run also reports `calibrationMs` (a fixed in-page CPU workload) and `ingestMs` (initial fill time) for normalisation.

For many small charts on one page (one WebGL context per chart, a shared context, Canvas 2D), use `bun run bench:multi [--charts 50] [--renderers webgl2,shared,canvas2d] [--measure-ms 4000]`; for the public library comparison use `bun run bench:compare` (see [Release and benchmark notes](../release-and-benchmarks.md)).

The benchmark page exposes `window.__blazeplotBench` for automation. It does not start measurement until the harness calls `start()`, so the emitted CPU profile covers only the measured interval rather than initial data loading.
