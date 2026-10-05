# Shared render context design note

Status: shipped as an opt-in renderer in 1.0 (`renderer: "shared"`, public API `sharedRenderer()` and `createChartRenderContext()` from `blazeplot`). `createLinkedCharts` keeps per-chart contexts by default and takes a `renderer` option to opt in; see [Open questions](#open-questions).

## Problem

Every `Chart` normally owns a WebGL2 context, and the flame graph plugin owns a second one. Browsers cap live contexts per page (about 16 in Chromium, fewer on some mobile browsers) and evict the **oldest** when the cap is exceeded. A dashboard with 20+ charts, a sparkline table, or list virtualization that mounts and unmounts charts therefore ends up with blank charts that depend on context restore.

`bun run bench:multi` (50 live charts, per-chart context) reproduces it: Chromium reported 34 of 50 chart contexts lost, and those charts stayed blank until restored.

## Options considered

| Option | How it works | Pros | Cons |
|---|---|---|---|
| (a) Hidden shared canvas + `drawImage` blit | One hidden WebGL2 canvas renders each chart's plot area in turn; the result is copied into the chart's visible 2D canvas. | Works for any set of charts anywhere in the page, charts keep their own canvas, layout, resize, DPR, and screenshot paths. One context for any chart count. | One blit per chart per frame; the hidden canvas is resized when consecutive charts differ in size. |
| (b) One canvas with scissor rectangles | `LinkedCharts` draws every panel into one canvas with `gl.scissor`. | No blit. | Only works when charts share one canvas (a single layout), so it cannot serve independent charts or virtualized lists; needs a layout redesign and a different DOM/overlay model. |
| (c) Per-chart `OffscreenCanvas` in a worker | Move rendering off the main thread. | Parallel. | Large architecture change, still one context per chart. |

Option (a) was implemented. It is the only one that fixes the general case, and it kept `Chart`, the plugins, screenshots, and the linked layouts unchanged: the chart talks to a `ChartRenderer` interface (introduced for the Canvas 2D renderer), and the shared renderer is just another implementation of it.

## Design

- `SharedWebGLContext` (`src/render/webgl2/SharedWebGL.ts`) owns one detached `<canvas>` with a normal `WebGL2Renderer` + `WebGL2Backend`. It is reference counted: the first attached chart creates it, the last chart to dispose releases the WebGL context (`WEBGL_lose_context`) and drops the drawing buffer, so unmounting everything leaves zero live contexts.
- `SharedWebGLRenderer` is the per-chart `ChartRenderer`. `beginFrame` sizes the shared canvas to the chart's plot canvas (device pixels) and starts a frame; draw calls forward to the shared `Renderer`, which records them into its per-frame stream; `endFrame` submits the stream and does `clearRect` + `drawImage(sharedCanvas)` into the chart canvas's 2D context. Frames are strictly sequential (one chart's `render()` runs from `beginFrame` to `endFrame` synchronously), so one shared stream and program set serves every chart. Programs, vertex arrays, and the stream buffer exist once.
- API: `sharedRenderer()` (one document-wide context) or `sharedRenderer(createChartRenderContext())` to group charts. `new Chart(el, { renderer: sharedRenderer() })`; `createLinkedCharts(el, { renderer: sharedRenderer(), panels })`.
- `chart.renderer` is `"shared"`; `getWebGLContext()` is `null` so no chart or plugin can keep or release the shared context.

### Blit cost per frame

Each chart frame does one `drawImage` of a canvas the size of that chart's plot area (width x height x 4 bytes). On GPU-accelerated Chromium that is a GPU-to-GPU copy, so it scales with the number of pixels drawn, not with the number of charts' data. When consecutive charts have the same size the shared canvas is not resized (assigning `canvas.width` reallocates the drawing buffer), so a grid of equal charts pays only the copy. A mix of sizes pays one reallocation per size change; keep small multiples uniform.

On the software-GL headless Chrome used in CI and on the author's machine, `drawImage` from a WebGL canvas forces a readback and is slow (the 50-chart scenario drops to a few fps), so CI numbers cannot validate the 60 fps target. Run `bun run bench:multi` on a laptop with a real GPU for that.

### Context loss

The shared canvas listens for `webglcontextlost` / `webglcontextrestored`. On loss it calls `preventDefault()` and re-dispatches the event on every attached chart canvas, where `Chart` already handles it (stop drawing, notify plugins). On restore it builds a fresh `Renderer` for the restored context, drops the old one without deleting stale objects, and re-dispatches `webglcontextrestored`, which makes every chart rebuild its renderer (a new attachment) and re-render. The stability suite (`shared-context-loss`) loses and restores the shared context five times (25 with `--long`) with three charts attached and checks every chart paints again, then disposes the charts while the context is lost.

### DPR

The chart canvas is already sized in device pixels by `Chart` (`clientWidth * devicePixelRatio`). The shared canvas is sized to match exactly, and the blit is 1:1, so there is no scaling and no DPR-specific path. A DPR change resizes the chart canvas, which resizes the shared canvas on the next frame.

## Tests

- Unit: `tests/ui/Chart.sharedRenderer.test.ts` (one context for 20 charts, blit per chart, resize only on size change, release on last dispose, independent contexts, loss and restore, linked charts).
- Visual: `bun run test:visual` renders every case through `sharedRenderer()` and compares against the WebGL baselines with the same tolerance (0 differing pixels locally: the pixels are the same GL output).
- Stability (`bun run test:stability`): `shared-context` mounts and unmounts batches of 25 charts sharing one context (200 charts in the CI profile, 1000 in `--long`) and fails on heap, DOM, listener, or live-context growth, or if more than one WebGL context is ever live; `shared-context-loss` covers loss and restore.
- Benchmark: `bun run bench:multi [--charts 50] [--renderers webgl2,shared,canvas2d]`.

## Open questions

- Measured on a real GPU (RX 9070, Windows/ANGLE): about 0.3 ms of main-thread time per chart per redraw, so 50 always-redrawing charts hold roughly 75 fps and 100 charts about 36 fps, with no contexts lost at any count. Mid-range laptops are still unmeasured. See the table in [Performance recipes](../performance-recipes.md#many-charts-on-one-page).
- `LinkedCharts` keeps the per-chart context by default. Real-GPU data shows shared is slower than per-chart contexts below the context cap (about 3x the per-frame cost at 10 charts, still under 3 ms), so it stays opt-in; revisit if panel counts above 16 become typical. `createLinkedCharts({ renderer: sharedRenderer() })` already opts in.
- The flame graph plugin still creates its own WebGL context (and falls back to Canvas 2D without WebGL2). A flame graph on a shared-context page costs one extra context; routing its rectangle layer through the shared renderer is future work.
- Blit alternatives: `ImageBitmap` transfer or `transferToImageBitmap` can avoid a copy on some browsers but make DOM sizing and screenshots harder; revisit if the blit shows up in profiles.
