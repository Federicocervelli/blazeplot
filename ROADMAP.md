# BlazePlot — Roadmap

**BlazePlot is a fast WebGL2 plotting engine for the browser.**

GPU-native, zero-DOM rendering. Built on WebGL2 + [regl](https://github.com/regl-project/regl).

---

## Architecture

```
src/
  core/          # Data model — series, datasets, LOD
  render/        # GPU abstraction + regl V1 backend
  interaction/   # Camera, input, axis ticks
  ui/            # Orchestrator (Chart)
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

**Status: streaming-oriented primitives built, tests passing**

Current implementation uses a `RingBuffer` + `MinMaxPyramid` for contiguous streaming data.
This is one data model, not the only one.

- [x] `RingBuffer` — append-only, Float64Array x / Float32Array y, logical index access, ring-wrap aware search
- [x] `MinMaxPyramid` — min/max per level (bucket size 2), correct higher-level aggregation, ring-wrap aware builds, `query()` returns `LODView`
- [x] `SeriesStore` — buffer + pyramid + style, dirty tracking
- [x] `Camera2D` — viewport model with pan, zoom, setViewport, clip/screen transforms
- [x] `DataCursor` — binary search by X value
- [x] Tests for `RingBuffer`, `MinMaxPyramid`, and `Camera2D`
- [ ] **General dataset abstraction** — separate data storage from plot type. A `Dataset` holds any typed array and an `Accessor` reads x/y pairs. Streaming (`RingBuffer`), static (`Float64Array`), and generated data all share the same render path.
- [ ] **LOD as a strategy, not a requirement** — lines can use the min/max pyramid when beneficial, but scatter/bar/heatmap skip it entirely.
- [ ] **Incremental pyramid update** — current: full rebuild on every `build()`. Target: O(log N) per append.

---

## Phase 3 — regl renderer (full)

**Status: basic line rendering done**

- [x] `ReglBackend` — createBuffer, updateBuffer (subdata), createProgram, draw command cache
- [x] Raw line strip for few visible points
- [x] `MinMaxSegmentRenderer` — vertical min/max segments for dense viewports
- [x] Camera transform as uniforms (scale/offset getters on Camera2D)
- [x] `Renderer.drawMinMaxSegments`
- [ ] Persistent buffer pool (no Float32Array allocs per frame)
- [ ] Instanced draw for segment mode
- [ ] Scatter / point rendering (instanced quads)
- [ ] Bar rendering
- [ ] Area fill (line + polygon below)
- [ ] Heatmap (texture-based)
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
- [ ] Axis tick labels (DOM overlay or GPU text)
- [ ] LOD re-query on pan/zoom (viewport change → new LODView for lines)
- [ ] Box-select / region zoom
- [ ] Tooltip / hit testing
- [ ] Legend

Camera modifies `Camera2D`, renderer reads it. No direct data access from interaction layer.

---

## Phase 5 — Multi-series and composition

**Status: basic multi-series support**

- [x] `Chart.addSeries()` supports multiple stores
- [x] Each `SeriesStore` has independent buffer + style
- [x] Color/style per-series
- [x] Series visibility toggle
- [ ] Batched draw calls (same shader → one draw per series group)
- [ ] Mixed chart types (line + scatter + bar in one chart)
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
- [ ] Axis labels / tick rendering
- [ ] `chart.screenshot()` / export image
- [ ] Theme system
- [ ] Legend
- [ ] Tooltip / hit testing
- [ ] `chart.addScatter(config)`, `chart.addBar(config)`, etc.

Package status:
- [x] `exports`, `main`, `module`, and `types` point at `dist/`
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
