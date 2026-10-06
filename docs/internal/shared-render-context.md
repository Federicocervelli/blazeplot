# Shared render context design note

Status: shipped as an opt-in renderer in 1.0 (`renderer: "shared"`, public API `sharedRenderer()` and `createChartRenderContext()` from `blazeplot`). `createLinkedCharts` keeps per-chart contexts by default and takes a `renderer` option to opt in; see [Open questions](#open-questions).

## Problem

Every `Chart` normally owns a WebGL2 context (and, before plugin layers moved onto the chart's engine, the flame graph plugin owned a second one). Browsers cap live contexts per page (about 16 in Chromium, fewer on some mobile browsers) and evict the **oldest** when the cap is exceeded. A dashboard with 20+ charts, a sparkline table, or list virtualization that mounts and unmounts charts therefore ends up with blank charts that depend on context restore.

`bun run bench:multi` (50 live charts, per-chart context) reproduces it: Chromium reported 34 of 50 chart contexts lost, and those charts stayed blank until restored.

## Options considered

| Option | How it works | Pros | Cons |
|---|---|---|---|
| (a) Hidden shared canvas + `drawImage` blit | One hidden WebGL2 canvas renders each chart's plot area in turn; the result is copied into the chart's visible 2D canvas. | Works for any set of charts anywhere in the page, charts keep their own canvas, layout, resize, DPR, and screenshot paths. One context for any chart count. | One blit per chart per frame; the hidden canvas is resized when consecutive charts differ in size. |
| (b) One canvas with scissor rectangles | `LinkedCharts` draws every panel into one canvas with `gl.scissor`. | No blit. | Only works when charts share one canvas (a single layout), so it cannot serve independent charts or virtualized lists; needs a layout redesign and a different DOM/overlay model. |
| (c) Per-chart `OffscreenCanvas` in a worker | Move rendering off the main thread. | Parallel. | Large architecture change, still one context per chart. |

Option (a) was implemented. It is the only one that fixes the general case, and it kept `Chart`, the plugins, screenshots, and the linked layouts unchanged: the chart talks to a `ChartRenderer` interface (introduced for the Canvas 2D renderer), and the shared renderer is just another implementation of it.

## Design

- `SharedWebGLContext` (`src/render/webgl2/SharedWebGL.ts`) owns one detached `<canvas>` with a normal `WebGL2Renderer` (which owns that canvas's context-loss listeners and its `WebGL2Backend`). It is reference counted: the first attached renderer creates it, when the last one detaches the context stays warm (context, programs, stream) and a `keepWarm` timer (`src/render/webgl2/warm.ts`, 2 s) disposes the `WebGL2Renderer`, which releases the WebGL context (`WEBGL_lose_context`), and the context drops the drawing buffer, unless another chart attaches first. A page that mounts and unmounts charts therefore reuses one context instead of paying a context creation, a program build, and a release per mount; a page that stops creating charts ends up with zero live contexts. `context.dispose()` releases an idle context immediately, and `releaseWarm()` (internal, used by tests and the stability probe) ends every idle period at once. Attached renderers are charts and plugin render surfaces (`ctx.unstable.createRenderSurface`), which is why `context.chartCount` counts both.
- `SharedWebGLRenderer` is the per-chart `ChartRenderer`. `beginFrame` sizes the shared canvas to the chart's plot canvas (device pixels) and starts a frame; draw calls forward to the shared `WebGL2Renderer`, which records them into its per-frame stream; `endFrame` submits the stream, does `clearRect` + `drawImage(sharedCanvas)` into the chart canvas's 2D context, and returns the frame's `FrameReport`. Frames are strictly sequential (one chart's `render()` runs from `beginFrame` to `endFrame` synchronously), so one shared stream and program set serves every chart. Programs, vertex arrays, and the stream buffer exist once.
- API: `renderer: "shared"` (one document-wide context), `sharedRenderer()`, or `sharedRenderer(createChartRenderContext())` to group charts. `new Chart(el, { renderer: "shared" })`; `createLinkedCharts(el, { renderer: "shared", panels })`. Engines are resolved synchronously in `src/render/engines.ts`, the only file that names them.
- `chart.renderer` is `"shared"` and `chart.rendererInfo.capabilities.shared` is `true`; `getWebGLContext()` is `null` so no chart or plugin can keep or release the shared context.
- Plugin layers: the engine's `createSurface(canvas)` returns another `SharedWebGLRenderer` that draws through the same shared context and blits into that canvas, so the flame graph's rectangle layer no longer opens a context of its own on a shared page.

### Blit cost per frame

Each chart frame does one `drawImage` of a canvas the size of that chart's plot area (width x height x 4 bytes). On GPU-accelerated Chromium that is a GPU-to-GPU copy, so it scales with the number of pixels drawn, not with the number of charts' data. When consecutive charts have the same size the shared canvas is not resized (assigning `canvas.width` reallocates the drawing buffer), so a grid of equal charts pays only the copy. A mix of sizes pays one reallocation per size change; keep small multiples uniform.

On the software-GL headless Chrome used in CI and on the author's machine, `drawImage` from a WebGL canvas forces a readback and is slow (the 50-chart scenario drops to a few fps), so CI numbers cannot validate the 60 fps target. Run `bun run bench:multi` on a laptop with a real GPU for that.

### Context loss

The shared canvas's `WebGL2Renderer` listens for `webglcontextlost` / `webglcontextrestored` (it calls `preventDefault()` on loss and rebuilds its backend on restore, dropping the old objects without deleting them) and reports both through its loss listener. The context fans that out to every attached renderer's own loss listener, directly (no synthetic DOM events on chart canvases): each chart stops drawing and notifies plugins on loss, and on restore notifies plugins and re-renders. The stability suite (`shared-context-loss`) loses and restores the shared context five times (25 with `--long`) with three charts attached and checks every chart paints again, then disposes the charts while the context is lost.

### DPR

The chart canvas is already sized in device pixels by `Chart` (`clientWidth * devicePixelRatio`). The shared canvas is sized to match exactly, and the blit is 1:1, so there is no scaling and no DPR-specific path. A DPR change resizes the chart canvas, which resizes the shared canvas on the next frame.

## Tests

- Unit: `tests/ui/Chart.sharedRenderer.test.ts` (one context for 20 charts, blit per chart, resize only on size change, release on last dispose, independent contexts, loss and restore, linked charts).
- Engine contract: `tests/render/engineContract.ts` runs against the shared engine over a recording backend, including loss and restore callbacks and surfaces.
- Visual: `bun run test:visual` renders every case through the shared engine and compares each crop with the WebGL2 render of the same case to 8-bit rounding (0 differing pixels on a real GPU: the pixels are the same GL output).
- Stability (`bun run test:stability`): `shared-context` mounts and unmounts batches of 25 charts sharing one context (200 charts in the CI profile, 1000 in `--long`) and fails on heap, DOM, listener, or live-context growth, or if more than one WebGL context is ever live; `shared-context-loss` covers loss and restore.
- Benchmark: `bun run bench:multi [--charts 50] [--renderers webgl2,shared,canvas2d]`.

## Open questions

- Measured on a real GPU (RX 9070, Windows/ANGLE): about 0.3 ms of main-thread time per chart per redraw, so 50 always-redrawing charts hold roughly 75 fps and 100 charts about 36 fps, with no contexts lost at any count. Mid-range laptops are still unmeasured. See the table in [Performance recipes](../performance-recipes.md#many-charts-on-one-page).
- `LinkedCharts` keeps the per-chart context by default. Real-GPU data shows shared is slower than per-chart contexts below the context cap (about 3x the per-frame cost at 10 charts, still under 3 ms), so it stays opt-in; revisit if panel counts above 16 become typical. `createLinkedCharts({ renderer: sharedRenderer() })` already opts in.
- Blit alternatives: `ImageBitmap` transfer or `transferToImageBitmap` can avoid a copy on some browsers but make DOM sizing and screenshots harder; revisit if the blit shows up in profiles.
