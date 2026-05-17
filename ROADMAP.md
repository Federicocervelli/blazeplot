# BlazePlot — Roadmap

**BlazePlot is a fast WebGL2 plotting engine for the browser.**

GPU-native plot rendering with lightweight DOM layout for axes. Built on WebGL2 + [regl](https://github.com/regl-project/regl).

---

## Architecture

```
src/
  core/          # Data model — series, datasets, LOD
  render/        # GPU abstraction + regl V1 backend
  interaction/   # Camera, input, axis ticks
  ui/            # Orchestrator (Chart) + optional DOM plugin implementations
  plugins/       # Optional plugin subpath entrypoints
tests/            # bun test — core, interaction
preview/          # Dev preview harness, detached from package build
```

```
interface GpuBackend { … }     # abstract GPU
class ReglBackend { … }        # V1 implementation (WebGL2)
class FutureWebGPUBackend { …} # V3
```

`Camera2D` is the canonical viewport model (data-space xMin/xMax/yMin/yMax). Scale/offset for shader uniforms are derived getters.

Package output is detached from the preview app:
- `bun run dev` serves `preview/`.
- `bun run build` emits `dist/index.js` and `dist/index.d.ts` from `src/index.ts`.
- `preview/` is excluded from npm package contents.

---

## Phase 1 — Vertical slice: line on screen

**Status: complete**

Get one end-to-end path working: data → visible extraction → GPU upload → draw.

- [x] WebGL2 context + regl init
- [x] Canvas resize + DPR handling
- [x] `ReglBackend` — createBuffer, updateBuffer, createProgram, cached draw commands
- [x] Raw line strip draw via regl
- [x] Wire `Chart.render()`: clear → copy visible range → upload → draw
- [x] Streaming append with debug overlay
- [x] **Benchmark overlay**: fps, ms/frame, points rendered, draw calls, upload bytes

---

## Phase 2 — Core data engine

**Status: dataset abstraction + incremental LOD complete**

Current implementation uses a `RingBuffer` + `MinMaxPyramid` for contiguous streaming data, backed by the `Dataset` interface. `StaticDataset` shares the same render path.

- [x] `RingBuffer` — append-only, Float64Array x / Float32Array y, logical index access, ring-wrap aware search
- [x] `MinMaxPyramid` — min/max per level (bucket size 2), correct higher-level aggregation, ring-wrap aware builds, `query()` returns `LODView`
- [x] `SeriesStore` — dataset + pyramid + style, dirty tracking
- [x] `Camera2D` — viewport model with pan, zoom, setViewport, clip/screen transforms
- [x] `DataCursor` — binary search by X value
- [x] Tests for `RingBuffer`, `MinMaxPyramid`, and `Camera2D`
- [x] **General dataset abstraction** — `Dataset`/`AppendableDataset` interfaces. `RingBuffer` satisfies `AppendableDataset`. `StaticDataset` wraps any typed arrays. `MinMaxPyramid`/`DataCursor`/`SeriesStore` all accept `Dataset`. Same render path for streaming and static data.
- [x] **LOD as a strategy, not a requirement** — `SeriesConfig.downsample` accepts `"minmax" | "none"` (optional, defaults to `"minmax"`). Area/scatter/bar modes skip the pyramid entirely — `SeriesStore` creates no `MinMaxPyramid`, `copyMinMaxVisible` returns `0`, and render paths use raw visible samples when `hasLOD` is `false`.
- [x] **Incremental pyramid update** — current: O(log N) per append instead of full rebuild. Only recomputes the affected tail at each level. Falls back to full rebuild on wrap/clear. Detected via `range.start` change or length decrease.

---

## Phase 3 — regl renderer (full)

**Status: line, min/max, scatter, bar, and area rendering done; advanced modes and batching pending**

- [x] `ReglBackend` — createBuffer, updateBuffer (subdata), createProgram, draw command cache
- [x] Raw line strip for few visible points
- [x] `MinMaxSegmentRenderer` — vertical min/max segments for dense viewports
- [x] Camera transform as uniforms (scale/offset getters on Camera2D)
- [x] `Renderer.drawMinMaxSegments`
- [x] Persistent buffer pool — `WebGL2Resources` manages pre-allocated `Float32Array` + `regl.Buffer` pairs. Pre-allocates common sizes (1K–128K floats) at init. `ReglBackend.createBuffer` pulls from pool — no `regl.buffer()` calls at runtime. `dispose` returns to pool; `destroy` cleans up all entries.
- [x] Instanced draw for segment mode (with line-list fallback when regl/browser instancing is unavailable)
- [x] Scatter / point rendering (instanced quads)
- [x] Bar rendering (instanced quads, data-space width, configurable baseline)
- [x] Bar sampling for dense views (min/max range buckets using the same visible bucketing strategy as dense line rendering)
- [x] Area fill (triangle-strip fill to baseline + line overlay)
- [ ] OHLC / candlestick
- [ ] Draw call batching per shader mode

---

## Phase 4 — Interaction

**Status: implemented (camera + input)**

- [x] `Camera2D` — viewport model with pan, zoom, setViewport
- [x] `InputController` — pointer pan, wheel zoom, touch via Pointer Events
- [x] `ViewportPolicy` — transforms pan/zoom intents and can update camera before render
- [x] Camera uniforms propagated to shaders per frame
- [x] `AxisController` — smart tick generation and label formatting
- [x] Grid line rendering
- [x] Axis tick labels (DOM overlay)
- [x] LOD re-query on pan/zoom (viewport change → current camera viewport is used for line visible extraction each frame; dirty pyramids rebuild before draw)
- [ ] Box-select / region zoom
- [x] Tooltip / hit testing API (`chart.pick`, hover subscription, raw-data nearest-X/nearest-point modes)
- [x] Legend plugin (built-in DOM plugin backed by public series metadata/state APIs)

Camera modifies `Camera2D`, renderer reads it. No direct data access from interaction layer.

---

## Phase 5 — Multi-series and composition

**Status: basic multi-series support**

- [x] `Chart.addSeries()` supports multiple stores
- [x] Each `SeriesStore` has independent buffer + style
- [x] Color/style per-series
- [x] Series visibility toggle
- [ ] Batched draw calls (same shader → one draw per series group)
- [ ] Mixed chart types (line + scatter + bar + area supported; OHLC pending)
- [ ] Shared X axis optional, independent Y per series
- [ ] Secondary axis

---

## Phase 6 — Public API

**Status: basic shape exists**

- [x] `new Chart(canvas)`
- [x] `new Chart(canvas, { viewportPolicy })`
- [x] `chart.addSeries(config, style)`
- [x] `chart.setViewport({ xMin, xMax, yMin, yMax })`
- [x] `chart.start()` / `chart.stop()`
- [x] `chart.resize()` — handle container resize with DPR
- [x] `series.append(x, y)` — accepts typed arrays
- [x] `series.clear()`
- [x] `chart.removeSeries(series)`
- [x] ResizeObserver integration
- [x] Grid
- [x] Axis labels / tick rendering (DOM layout, `axes: false` to disable)
- [x] `chart.screenshot()` / export image (full chart composite: WebGL plot + built-in DOM text overlays)
- [ ] Theme system
- [x] Plugin API (`ChartPlugin`, `plugins` option, disposable installs)
- [x] Optional plugin subpath exports (`blazeplot/plugins/legend`, `blazeplot/plugins/tooltip`) so chart-only imports do not need to import built-in UI plugins
- [x] Legend plugin (`legendPlugin`) built on public series state APIs
- [x] Tooltip / hit testing (`tooltipPlugin`, `chart.pick`, `chart.subscribe("hover")`; actual raw sample X/Y, per-frame live hover refresh, highlighted sample markers)
- [x] `chart.addLine(config)`, `chart.addArea(config)`, `chart.addScatter(config)`, `chart.addBar(config)` helpers.

Package status:
- [x] Current npm package version: `0.1.7`
- [x] `exports`, `main`, `module`, and `types` point at `dist/`
- [x] Optional plugin subpath exports point at separate `dist/plugins/*` chunks
- [x] Vite library build from `src/index.ts`
- [x] Declaration emit via `vite-plugin-dts`
- [x] CI release workflow with npm publish and provenance

---

## Backend strategy

```
V1:  WebGL2 + regl             ← CURRENT
V2:  Backend abstraction          ← In place (GpuBackend interface)
V3:  WebGPU backend               ← Future
```

regl rules for V1:
- Persistent buffers (no re-create per frame)
- Precompiled regl commands
- `subdata` on small ranges
- Batched draw calls
- Simple shaders, camera in uniforms
- WebGL2 required (no fallback)

---

## Overflow semantics

**Status: undecided**

`RingBuffer` wraps silently at capacity. For streaming this is usually correct, but it should be explicit. Deferred until we have a concrete use case.

---

## What we're NOT doing (V1)

- SVG / Canvas2D fallback
- Spline interpolation
- Antialias perfection
- Recalculating axes in render loop
- Per-series draw call without batching

---

## Future / difficult

- Multi-chart sync
- Multiple Y axes
- FFT / waterfall
- WebGPU backend
