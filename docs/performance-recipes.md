# Performance recipes

Keep X sorted, batch writes, create each chart once, and let LOD handle dense views.

## Decision guide

| Situation | Prefer | Why |
|---|---|---|
| Appending irregular telemetry | `RingBuffer` with batched `series.append(...)` | Bounded rolling history with no array reallocation. |
| Appending fixed-rate telemetry | `chart.addLine({ capacity, xStep })` with `series.append({ y })` | Creates a `UniformRingBuffer`, which stores no repeated X values. |
| Rendering dense historical ranges | Built-in LOD or `ServerSampledDataset` | Reduces visible work while preserving extrema. |
| Rendering a small exact viewport | `downsample: "none"` | Skips sampler overhead when visible points are already bounded. |
| Backend already has min/max buckets | `ServerSampledDataset` + `downsample: "server"` | Avoids sampling twice on the client. |
| Chart is hidden but still mounted | `chart.stop()` | Stops scheduled work; call `chart.start()` when visible again. |

## Streaming data

- Use `RingBuffer` for irregular live samples and `UniformRingBuffer` for fixed-rate samples. `chart.addLine({ capacity, xStep })` creates the implicit-X buffer for you.
- For fixed-rate data, append only Y batches with `series.append({ y })`, so repeated X values are never stored or copied.
- Set capacity to the largest history window you need to keep in memory.
- Append typed-array batches through the returned series instead of one sample at a time, for example `series.append({ x: Float64Array, y: Float32Array })` or `series.append({ y: Float32Array })`. Object-row batches such as `series.append([{ x, y }, ...])` suit moderate-rate feeds and examples.
- Keep X values sorted in logical order. Binary search, picking, and LOD depend on it.
- Write live data through series APIs. Appends and in-place updates (`series.updateLast(...)`, `series.updateAt(...)`) mark LOD state dirty and request a frame in the default on-demand render loop. After mutating a dataset directly, call `series.markDirty()`.
- Pick an overflow mode:
  - `"wrap"` for rolling live windows,
  - `"drop-new"` when backpressure is safer than overwriting history,
  - `"error"` when ingestion bugs should fail loudly.

For exact ordering and gap behavior, see [Data semantics](./data-semantics.md).

## Static or remote data

- Use `new StaticDataset(x, y)` for fixed arrays.
- Use typed arrays for large datasets to reduce memory and copy cost.
- For remote, procedural, or memory-mapped data, implement the accelerated methods your data can answer cheaply: `rangeMinMaxY`, `copySamplesRange`, `copyVisibleSamples`, `copyVisiblePoints`, or `copyMinMaxSegments`. These contracts are listed in the [API reference](./api-reference.md#all-public-exports).
- If your server already returns reduced min/max buckets, use `ServerSampledDataset` with `downsample: "server"` to render them directly.

## Choosing downsampling

- Line, area, and bar series use min/max LOD by default in dense views.
- Use `downsample: "none"` only when the number of visible samples is bounded and exact raw rendering matters. Line and bar series with `"none"` draw every visible sample, in chunks, so cost grows linearly with the visible count and nothing is truncated at the upload buffer size.
- Scatter series first extract exact visible points, then sample when the visible set is too large. With `downsample: "none"`, scatter draws every visible point up to about 65,000 and falls back to the sampler beyond that.
- Dense line views are drawn as min/max buckets that are at least `lineWidth` tall, so flat stretches stay visible.
- Area series draw an exact triangle strip while the visible samples fit in the buffer. Denser views render min/max buckets as full-width columns (fill from the baseline to each bucket's extreme, plus a min/max envelope outline), so spikes are kept. With `downsample: "none"` area series fall back to stable stride decimation, which can drop peaks.
- Server-sampled min/max data takes `downsample: "server"`.

## Reducing per-frame work

- Create charts once and update their datasets instead of recreating them.
- Call `chart.start()` once, or after a matching `chart.stop()`. Do not call it repeatedly from reactive render paths.
- Call `chart.stop()` when a chart is hidden or inactive, and `chart.start()` when it should resume rendering.
- The default render loop is on demand: static charts render after chart-owned state changes and then idle. Appends through series APIs wake the chart. Use `new Chart(element, { renderLoop: "continuous" })` only for custom animation loops; direct dataset mutation still needs `series.markDirty()` so LOD state is rebuilt.
- Inspect what a frame costs with `chart.getFrameStats()`: `frameMs`, `pointsRendered`, `drawCalls`, `uploadBytes`, and `renderMode` (`"raw"`, `"minmax"`, `"points"`, `"bars"`, `"area"`, or `"mixed"`).
- Use WebGL2 for large visible point counts; the default `"auto"` picks it whenever it is available. The Canvas 2D engine (`renderer: "canvas2d"`, or the `"auto"` fallback) uses the same LOD pipeline but is CPU-bound: on the benchmark scene a frame costs about twice the WebGL2 frame, and the shared engine matches WebGL2. See [Browser support](./browser-support.md#rendering-engines); `chart.rendererInfo` shows which engine a chart got.
- Remove unused series with `chart.removeSeries(series)`.
- Dispose charts on unmount with `chart.dispose()`.
- Import optional features from subpaths, for example `blazeplot/plugins/tooltip`, to keep chart-only bundles small.

## Mounting and unmounting charts

Creating a WebGL2 context is a synchronous round trip to the GPU process, and compiling its shader programs costs again. A page that mounts and unmounts charts (route changes, tabs, virtualised lists) would pay both every time. So disposing a chart on the WebGL2 engine (`"auto"` or `"webgl2"`) keeps its plot canvas, context, and compiled programs warm: the next chart created in the same document takes them over and skips context creation and the program build. Warm canvases are bounded (at most two per page) and short-lived: each is released two seconds after its chart was disposed unless another chart takes it first, so a page that stops creating charts ends up holding no WebGL contexts. A warm context is the first one a browser evicts when a page hits its context cap. Nothing needs configuring; charts on `"canvas2d"` or a shared context, and charts created from a canvas element you pass in, are not affected.

## Many charts on one page

Browsers cap live WebGL contexts per page (about 16 in Chromium) and evict the oldest, so a dashboard with dozens of charts can end up with blank charts. Render them through one shared context:

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

Charts that use `renderer: "shared"` draw into one hidden WebGL2 canvas and copy the result into their own canvas, so the page holds a single context for any number of charts. By default every chart on the page shares it; to group charts (for example per dashboard), create a context with `createChartRenderContext()` and pass `context.renderer()` (or `sharedRenderer(context)`) to each chart. `context.chartCount` reports how many charts are attached, and the hidden context is released two seconds after the last one is disposed (charts mounted in that time reuse it and its compiled programs, which is what keeps a route change or a list re-render cheap); `context.dispose()` releases an idle context at once. `chart.renderer` reads `"shared"` for these charts, and `ctx.unstable.getWebGLContext()` returns `null` because no chart owns the context. `"shared"` is strict and throws `WebGL2UnavailableError` without WebGL2; to fall back to Canvas 2D, use `renderer: autoRenderer({ shared: true })` (or `autoRenderer({ shared: context })`), which shares one context where WebGL2 exists, falls back to Canvas 2D otherwise, and reports `rendererInfo.fallbackFrom: "shared"`. Plugin layers that draw through a render surface (the flame graph) join the shared context instead of opening their own, and `context.chartCount` counts them too. Keep charts in a group the same size where you can: the shared canvas only reallocates when consecutive charts differ in size. `createLinkedCharts(el, { renderer: "shared", panels })` puts every linked panel on the shared context. Design and trade-offs: [Shared render context](./internal/shared-render-context.md). Measure your page with `bun run bench:multi`.

Measured with `bun run bench:multi` on a real GPU (AMD Radeon RX 9070, Chrome 153, Windows/ANGLE D3D11, 1700x1100 window, every chart redrawing every frame):

| Charts | Own context per chart | Shared context | Canvas 2D |
|---:|---|---|---|
| 10 | 0 lost, rAF p95 0.9 ms | 0 lost, 461 fps, rAF p95 2.9 ms | 0 lost, rAF p95 0.3 ms |
| 25 | 9 contexts lost | 0 lost, 150 fps, rAF p95 7.6 ms | 0 lost, rAF p95 0.6 ms |
| 50 | 34 contexts lost | 0 lost, 75 fps, rAF p95 15.3 ms | 0 lost, rAF p95 2.2 ms |
| 100 | 84 contexts lost | 0 lost, 36 fps, rAF p95 30.6 ms | 0 lost, 158 fps, rAF p95 8.0 ms |

The shared path costs about 0.3 ms of main-thread time per chart per redraw (the `drawImage` blit), so it holds 60 fps for roughly 50 charts that all redraw every frame, and further when most charts are idle. With the default per-chart context, pages lose contexts past about 16 charts and the evicted charts go blank, so the per-chart frame numbers above that count only measure submission and are not comparable. Below the cap, per-chart contexts are cheaper than the shared blit, which is why `createLinkedCharts` keeps them by default and `sharedRenderer()` stays opt-in. These numbers come from one machine; rerun `bench:multi` for yours.

## Browser budgets

GPU upload size, draw calls, and DOM overlays all count. Large legends, many annotation labels, or frequent layout changes can hurt performance even when the WebGL plot is fast.

To check a performance-sensitive change, use the browser tests and benchmark commands in [Release and benchmark notes](./release-and-benchmarks.md#benchmark-and-bundle-size-commands). Public comparison tables are on the generated [Benchmarks](./benchmarks.md) page.
