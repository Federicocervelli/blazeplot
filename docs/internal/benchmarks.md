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

## Library comparison methodology

`bun run bench:compare` is the public BlazePlot, uPlot and Chart.js comparison. This section is the contract for what it measures and why the numbers are fair. Collect publishable numbers with `BLAZEPLOT_REAL_GPU=1 BLAZEPLOT_BENCH_CHROME=/path/to/chrome bun run bench:compare` on the official machine (see [Local development](./local-development.md#browser-backed-checks)); the generated report is [docs/benchmarks.md](../benchmarks.md).

### How a sample is taken

- **One page load is one sample.** The driver (`scripts/benchmark-compare.ts`) opens each scenario and library pair in a fresh browser context (new renderer process, empty heap, cold JIT) at `/compare/?scenario=...&library=...`, drives it through the Chrome DevTools Protocol, and closes the context. Every pair is repeated `runs` times (default 7, at least 5 for a publishable result; set in `scripts/benchmark-config.json`) and the report shows the median over runs, the nearest-rank p95 over runs and the half-range spread. Runs are interleaved across libraries with a rotating order, so no library always runs first on a warm GPU process. A throwaway page warms the GPU process before the first measurement.
- **The page is a production bundle.** `vite.compare.config.ts` builds `tests/browser/compare` into `build/compare-site`, served by a small static server with cross-origin isolation headers (finer timer resolution). All libraries are minified by the same build, so nothing times Vite's dev module graph. `--dev` uses the Vite dev server for debugging only.
- **Pinned environment.** Chrome runs headed with `--disable-frame-rate-limit` (animation frames are not capped to the display), `--force-device-scale-factor=1`, `--enable-precise-memory-info` and `--js-flags=--expose-gc`; each page also fixes its layout viewport through device-metrics emulation. A result is non-publishable when the browser is headless, WebGL is software, DPR is not 1, `gc()` is missing, fewer than 5 runs were taken, a scenario or library is missing or failed, hover feedback was not active, or the libraries' plot areas differ by more than 4 CSS px.
- **Warmup.** Before measuring, the page builds and destroys small charts of the scenario's series type (JIT, shader and context warmup), then builds and destroys one full-size chart (`--setup-warmup-runs`) and, for pan and stream scenarios, runs the same operation for the warmup duration. Only then does it force garbage collection and measure. The `cold-first-chart` scenario deliberately skips all of this: it measures the first chart a page ever builds.

### What is held equal

| Aspect | Rule |
|---|---|
| Data | Same synthetic signal (`sampleY` in `tests/browser/compare/data.ts`) at the same size, each library given its natural format: BlazePlot `StaticDataset` over `Float64Array`/`Float32Array` (or a `UniformRingBuffer` for streams), uPlot typed arrays (plain arrays when it must `push`), Chart.js `{x, y}` points with `parsing: false`. Only the data of the library under test is built in a page, so heap numbers are not shared. |
| Size and DPR | Same CSS-pixel size, DPR 1, and the same axis gutters (52 px left and right, 28 px bottom) forced on all libraries with uPlot and Chart.js auto padding removed, so every library plots into the same rectangle. The plot size each library reports is stored in the JSON `details` and compared on every run. |
| Look | 1 CSS px lines, same color per series, no grid, same axes (numeric, no title), same 3 px point diameter, same 0.8 bar width, same 25 percent area fill, light theme. Antialiasing is whatever each library does by default (BlazePlot's WebGL context uses no MSAA; the canvas libraries use browser antialiasing). |
| Updates | The same viewport function drives pan scenarios and the same time-based append schedule drives streaming. BlazePlot applies `append` plus `setViewport`, uPlot `setData` plus `setScale` in one batch, Chart.js mutates the dataset and scale options and calls `update("none")`. |
| Features | Static scenarios run with cursor, legend and tooltip off in every library. The hover scenario turns on each library's pointer feedback: BlazePlot crosshair plus tooltip plugins, uPlot cursor plus live legend, Chart.js nearest-point tooltip (Chart.js has no crosshair). |

### What each metric means

- **Ready** (`readyMs`) is library construction through the end of the first frame in which the chart's content has been drawn, including layout, axes and first paint. A library that draws synchronously in its constructor (uPlot, Chart.js) is timed through the next frame boundary; BlazePlot draws in its first animation frame and is timed through the frame that drew it. The frame boundary is an animation frame followed by a task, which runs after that frame's style, layout and paint work. `constructMs` is the synchronous constructor call alone.
- **Frame cost** (`workP50Ms`, `workP95Ms`) is, per update, the synchronous update/redraw call plus the time the library spends inside its own `requestAnimationFrame` callbacks (the harness wraps `requestAnimationFrame` before any library loads). That charges a library that redraws immediately (uPlot, Chart.js) and one that defers to its next frame (BlazePlot) identically. BlazePlot's own `frameMs` is kept in the details as `internalFrameP50Ms` and is not used for comparison. GPU execution time is not in this number.
- **FPS and frame interval** (`rafFps`, `rafP95Ms`) are the browser's real animation-frame cadence with the frame-rate limit disabled, so they also reflect raster and GPU back-pressure. This is the end-to-end number; frame cost is its main-thread part.
- **Hover latency** dispatches `pointerover`, `pointerenter`, `mouseover` and `mouseenter` once, then one `pointermove` followed by a `mousemove` per sample on the element under the point (`document.elementFromPoint`), and measures from just before the dispatch until the end of the next produced frame. `hoverP50Ms` is over 300 moves after 60 discarded ones.
- **Resize latency** changes the container size alternately between two sizes (BlazePlot and Chart.js track their container themselves; uPlot, which has no built-in tracking, uses the documented `ResizeObserver` plus `setSize` wrapper) and measures until the library has drawn at the new size and that frame has been produced.
- **Many charts** (`many-charts-50`) mounts 50 small charts, measures through the frame in which all of them have drawn, then destroys them. BlazePlot WebGL uses `sharedRenderer()` here because one WebGL context per chart would exceed the browser's live-context cap; this is BlazePlot's documented configuration for many charts.
- **Mount and destroy cycle** repeats construct, first frame and destroy 40 times; `leakMiB` is the settled JS heap growth over the cycles.
- **Heap** (`heapMiB`, `heapGrowthMiB`, `leakMiB`) is `performance.memory.usedJSHeapSize` after three forced garbage collections, relative to a baseline taken before the data was built. It is JavaScript heap only: GPU buffers, canvas backing stores and other native memory are not included, so it under-reports WebGL and canvas costs for every library.
- **Streaming throughput** raises the append rate in steps (50k to 102.4M samples per second, 1.2 s each, appended on a time schedule to a 100k-sample sliding window (BlazePlot wraps its ring buffer; uPlot and Chart.js drop the oldest samples with `splice`)) and reports the highest rate whose p95 frame interval stays within 16.7 ms.

### Verdicts

For each metric the report compares BlazePlot (WebGL) against uPlot and Chart.js. A result is a **win** or **loss** only when the medians differ by more than 5 percent (and by more than 0.05 ms or 0.25 MiB for time and memory metrics) and the min-max ranges of the runs do not overlap; otherwise it is **within noise** and the report says which side has the better median. The advantage ratio is competitor over BlazePlot for lower-is-better metrics and BlazePlot over competitor for higher-is-better ones, so values below 1.00x are losses. "Where BlazePlot does not win" lists every loss and every tie across all metrics, not only the primary one.

### Known limits

- The suite measures one machine and one browser; GPU results do not transfer to other hardware.
- Heap numbers are JS heap only (see above).
- Pan and stream loops update once per animation frame at an uncapped frame rate; a 60 Hz display would hide FPS differences that frame cost still shows.
- Synthetic pointer events exercise each library's handlers but not the browser's input pipeline.
- A library is skipped on a scenario only when it cannot do it (`skip` in `scripts/benchmark-config.json`, with the reason shown in the report); the current suite skips none.

### Commands

```sh
bun run bench:compare                      # full headed suite, 7 runs, overwrites benchmarks/latest.*
bun run bench:compare -- --scenario hover-1m --runs 3 --out-dir build/compare-debug
bun run bench:compare:smoke                # harness self-test: headless software GL, tiny data, 1 run
bun run bench:compare -- --aggregate-only benchmarks/latest-runs.jsonl
```

`benchmarks/latest-runs.jsonl` keeps every raw run. `benchmarks/baseline-before-perf-pass.json` is the frozen "before" result; when it exists, every report gets a "Change since the baseline" section comparing BlazePlot's medians against it.

### Fairness fixes over the earlier single-page harness

The first version of the comparison ran every library and scenario one after another inside a single page, once, from the Vite dev server. This version fixes what that made unfair or unrepresentative, in either direction:

- **Single run, shared page.** Results were one sample each and later libraries inherited earlier libraries' heap, GC state and GPU state. Now each sample is a fresh browser context and the report uses medians over runs with a rotating library order.
- **Mismatched work measure.** BlazePlot's "work" was its internal `frameMs`, which excludes the `append`/`setViewport` call made before the frame, while uPlot and Chart.js were charged for their whole synchronous redraw. Now every library is charged the update call plus its own animation-frame callbacks.
- **Unequal ready definition.** uPlot and Chart.js were "ready" after one animation frame while BlazePlot polled until its first draw, and nothing waited for the frame to be produced. Now all libraries are timed through the same frame boundary after their content has been drawn.
- **Different plotting rectangles.** uPlot and Chart.js auto-sized their axes and padding, so they drew into a smaller (or different) rectangle than BlazePlot. Now the gutters are fixed to BlazePlot's and the runs fail the publishable check if the plot sizes differ.
- **Heap numbers.** Chrome quantizes `usedJSHeapSize` unless precise memory info is on, and the baseline included every library's pre-built data. Now precise memory info is on, GC is forced three times before reading, and only the data of the library under test exists in the page.
- **Dev-server bundles.** All libraries were served unminified through Vite's dev module graph. Now a production build of the page is served.
- **Warmup.** Pan and stream scenarios only idled during warmup. Now the same operation is run (and discarded) before measuring, and the prewarm chart uses the scenario's series type.
- **Coverage.** The suite had five line scenarios. It now covers the series types, interaction latency, lifecycle and memory scenarios listed above.
