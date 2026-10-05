# Performance recipes

BlazePlot is fast when the data model and the visible range match how the renderer works. The most important rules are simple: keep X sorted, batch writes, avoid rebuilding charts, and let LOD handle dense views.

## Decision guide

| Situation | Prefer | Why |
|---|---|---|
| Appending irregular telemetry | `RingBuffer` with batched `series.append(...)` | Keeps a bounded rolling history without reallocating arrays and wakes on-demand rendering. |
| Appending fixed-rate telemetry | `chart.addLine({ capacity, xStep })` with `series.append({ y })` | Creates a `UniformRingBuffer`, avoids storing repeated X values, and wakes on-demand rendering. |
| Rendering dense historical ranges | Built-in LOD or `ServerSampledDataset` | Reduces visible work while preserving extrema. |
| Rendering a small exact viewport | `downsample: "none"` | Avoids sampler overhead when visible points are already bounded. |
| Backend already has min/max buckets | `ServerSampledDataset` + `downsample: "server"` | Prevents double-sampling on the client. |
| Chart is hidden but still mounted | `chart.stop()` | Avoids scheduled work; call `chart.start()` when visible again. |

## Streaming data

- Use `RingBuffer` for irregular live samples and `UniformRingBuffer` for fixed-rate samples. The easiest fixed-rate setup is `chart.addLine({ capacity, xStep })`, which creates the implicit-X buffer for you.
- For fixed-rate data, append only Y batches with `series.append({ y })` so you do not store or copy repeated X values.
- Set capacity to the largest history window you need to keep in memory.
- Append typed-array batches through the returned series when possible instead of one sample at a time, for example `series.append({ x: Float64Array, y: Float32Array })` or `series.append({ y: Float32Array })`. Object-row batches such as `series.append([{ x, y }, ...])` are convenient for moderate-rate feeds and examples.
- Keep X values sorted in logical order. Binary search, picking, and LOD depend on it.
- Prefer series APIs for live writes. Appends and in-place updates (`series.updateLast(...)`, `series.updateAt(...)`) mark LOD state dirty and request a frame in the default on-demand render loop. If you mutate a dataset directly, call `series.markDirty()` afterward.
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

- Line, area, and bar series use min/max LOD by default in dense views.
- Use `downsample: "none"` only when the number of visible samples is bounded and exact raw rendering matters. Line and bar series with `"none"` draw every visible sample, in chunks, so cost grows linearly with the visible count and nothing is truncated at the upload buffer size.
- Scatter series first extract exact visible points, then sample when the visible set is too large. With `downsample: "none"`, scatter draws every visible point up to about 65,000 and falls back to the sampler beyond that.
- Dense line views are drawn as min/max buckets that are at least `lineWidth` tall, so flat stretches stay visible.
- Area series draw an exact triangle strip while the visible samples fit in the buffer. Denser views render min/max buckets as full-width columns (fill from the baseline to each bucket's extreme, plus a min/max envelope outline), so spikes are kept. With `downsample: "none"` area series fall back to stable stride decimation, which can drop peaks.
- Server-sampled min/max data should use `downsample: "server"`.

## Reducing per-frame work

- Create charts once. Update datasets and keep the chart lifecycle active instead of recreating the chart.
- Call `chart.start()` once for an active chart lifecycle, or after a matching `chart.stop()`. Do not call it repeatedly from reactive render paths.
- Use `chart.stop()` when a chart is hidden or inactive, then `chart.start()` again when it should resume rendering.
- The default render loop is on demand: static charts render after chart-owned state changes and then idle. Appends through series APIs wake the chart automatically. Use `new Chart(element, { renderLoop: "continuous" })` only for custom animation loops; direct dataset mutation still needs `series.markDirty()` so LOD state is rebuilt.
- Inspect what a frame costs with `chart.getFrameStats()`: `frameMs`, `pointsRendered`, `drawCalls`, `uploadBytes`, and `renderMode` (`"raw"`, `"minmax"`, `"points"`, `"bars"`, `"area"`, or `"mixed"`).
- Prefer WebGL2 (the default `"auto"` uses it whenever it is available) for large visible point counts. The Canvas 2D engine (`renderer: "canvas2d"`, or the `"auto"` fallback) uses the same LOD pipeline but is CPU-bound: on the benchmark scene a frame costs about twice the WebGL2 frame, and the shared engine matches WebGL2. See [Browser support](./browser-support.md#rendering-engines) and `chart.rendererInfo` to see which engine a chart got.
- Remove unused series with `chart.removeSeries(series)`.
- Dispose charts on unmount with `chart.dispose()`.
- Keep optional features in subpath imports, for example `blazeplot/plugins/tooltip`, so chart-only bundles stay smaller.

## Mounting and unmounting charts

Creating a WebGL2 context is a synchronous round trip to the GPU process and compiling its shader programs costs again, so a page that mounts and unmounts charts (route changes, tabs, virtualised lists) would pay both every time. Disposing a chart on the WebGL2 engine (`"auto"` or `"webgl2"`) therefore keeps its plot canvas, context, and compiled programs warm: the next chart created in the same document takes them over and skips the context creation and the program build. Warm canvases are bounded (at most two per page) and short-lived: each is released two seconds after the chart that owned it was disposed unless another chart takes it first, so a page that stops creating charts ends up holding no WebGL contexts, as before. A warm context is the first one a browser evicts when a page hits its context cap. There is nothing to configure; charts on `"canvas2d"` or a shared context, and charts created from a canvas element you pass in, are not affected.

## Many charts on one page

Browsers cap live WebGL contexts per page (about 16 in Chromium) and evict the oldest, so a dashboard with dozens of charts can end up with blank charts. Render them through one shared context instead:

```ts
import { Chart } from "blazeplot";

const charts = Array.from(document.querySelectorAll<HTMLElement>(".sparkline"), (host) => {
  const chart = new Chart(host, { renderer: "shared" });
  chart.start();
  return chart;
});

// On unmount: dispose every chart; the shared WebGL context is released with the last one.
for (const chart of charts) chart.dispose();
```

Every chart that uses `renderer: "shared"` draws into one hidden WebGL2 canvas and copies the result into its own canvas, so the page holds a single context for any number of charts. Without an argument the context is shared by every chart on the page; to group charts (for example per dashboard), create one with `createChartRenderContext()` and pass `context.renderer()` (or `sharedRenderer(context)`) to each chart. `context.chartCount` reports how many charts are attached, and the hidden context is released when the last one is disposed. `chart.renderer` reads `"shared"` for these charts, and `ctx.unstable.getWebGLContext()` returns `null` because no chart owns the context. `"shared"` is strict and throws `WebGL2UnavailableError` without WebGL2; to fall back to Canvas 2D, pick the factory yourself (`isWebGL2Available() ? sharedRenderer() : canvas2dRenderer()`). Plugin layers that draw through a render surface (the flame graph) join the shared context instead of opening their own, and `context.chartCount` counts them too. Keep charts in a group the same size where you can: the shared canvas only reallocates when consecutive charts differ in size. `createLinkedCharts(el, { renderer: "shared", panels })` puts every linked panel on the shared context. The design and trade-offs are in [Shared render context](./internal/shared-render-context.md); measure your page with `bun run bench:multi`.

Measured with `bun run bench:multi` on a real GPU (AMD Radeon RX 9070, Chrome 153, Windows/ANGLE D3D11, 1700x1100 window, every chart redrawing every frame):

| Charts | Own context per chart | Shared context | Canvas 2D |
|---:|---|---|---|
| 10 | 0 lost, rAF p95 0.9 ms | 0 lost, 461 fps, rAF p95 2.9 ms | 0 lost, rAF p95 0.3 ms |
| 25 | 9 contexts lost | 0 lost, 150 fps, rAF p95 7.6 ms | 0 lost, rAF p95 0.6 ms |
| 50 | 34 contexts lost | 0 lost, 75 fps, rAF p95 15.3 ms | 0 lost, rAF p95 2.2 ms |
| 100 | 84 contexts lost | 0 lost, 36 fps, rAF p95 30.6 ms | 0 lost, 158 fps, rAF p95 8.0 ms |

The shared path costs about 0.3 ms of main-thread time per chart per redraw (the `drawImage` blit), so it holds 60 fps for roughly 50 charts that all redraw every frame, and further when most charts are idle. With the default per-chart context, pages lose contexts past about 16 charts and the evicted charts go blank, so the per-chart frame numbers above that count only measure submission and are not comparable. Below the cap, per-chart contexts are cheaper than the shared blit, which is why `createLinkedCharts` keeps them by default and `sharedRenderer()` stays opt-in. These numbers come from one machine; rerun `bench:multi` for yours.

## Browser budgets

GPU upload size, draw calls, and DOM overlays all matter. Large legends, many annotation labels, or very frequent layout changes can hurt performance even when the WebGL plot is fast.

Use the browser tests and benchmark commands in [Release and benchmark notes](./release-and-benchmarks.md#benchmark-and-bundle-size-commands) when checking a performance-sensitive change. Public comparison tables live in the generated [Benchmarks](./benchmarks.md) page.
