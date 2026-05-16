# BlazePlot — Roadmap

**BlazePlot is a real-time LOD time series rendering engine, not a plotting library.**

Target: 10M points resident, 60 Hz append/update, pan/zoom fluid, render O(pixel) not O(samples), zero allocations in frame loop, multi-series, line/envelope/scatter.

---

## Architecture

```
src/
  core/          # Data engine — no UI, no GPU
  render/        # GPU abstraction + regl V1 backend
  interaction/   # Camera, input, axis ticks
  ui/            # Orchestrator (Chart)
tests/           # bun test — RingBuffer, MinMaxPyramid, Camera2D
preview/         # Dev preview harness, detached from package build
```

The core split: **data engine** and **renderer** are separate. A `SeriesStore` owns a `RingBuffer` + `MinMaxPyramid`. The renderer reads LOD views, never raw data.

```
interface GpuBackend { … }     # abstract GPU
class ReglBackend { … }        # V1 implementation
class FutureWebGPUBackend { …} # V3
```

**Camera2D** is the canonical viewport model (data-space xMin/xMax/yMin/yMax). Scale/offset for shader uniforms are derived getters. `ViewportPlanner` was removed — its pan/zoom live on `Camera2D` directly.

Package output is detached from the preview app:
- `bun run dev` serves `preview/`.
- `bun run build` emits `dist/index.js` and `dist/index.d.ts` from `src/index.ts`.
- `preview/` is excluded from npm package contents.

---

## Phase 1 — Vertical slice: line on screen

**Status: in progress**

Get one end-to-end path working: append → visible raw extraction → GPU upload → draw.

- [x] WebGL2 context + regl init
- [x] Canvas resize + DPR handling
- [x] Streaming append with debug overlay
- [x] `ReglBackend` — createBuffer, updateBuffer, createProgram, cached draw commands
- [x] Raw line strip draw via regl
- [x] Wire `Chart.render()`: clear → copy visible raw range → upload → draw
- [x] **Benchmark overlay**: fps, ms/frame, points rendered, draw calls, upload bytes

This is the shortest path to seeing data on screen. Benchmarking the full pipeline comes after.

---

## Phase 2 — Core data engine

**Status: basic scaffold implemented, correctness tests passing**

- [x] `RingBuffer` — append-only, Float64Array x / Float32Array y, logical index access, ring-wrap aware search
- [x] `MinMaxPyramid` — min/max per level (bucket size 2), correct higher-level aggregation, ring-wrap aware builds, `query()` returns `LODView`
- [x] `SeriesStore` — buffer + pyramid + style, dirty tracking
- [x] `Camera2D` — viewport model with pan, zoom, setViewport, clip/screen transforms
- [x] `DataCursor` — binary search by timestamp
- [x] Tests for `RingBuffer`, `MinMaxPyramid`, and `Camera2D` (bun test runner)
- [ ] **Incremental pyramid update** — current: full rebuild on every `build()`. Target: O(log N) per append, updating only closed buckets in the chain. This is the core competitive advantage — must be designed before release.

---

## Phase 2.5 — Worker pipeline

**Status: not started**

```
producer thread / worker ──► SharedArrayBuffer ──► downsampling worker ──► main thread
```

- [ ] Ingest worker — receives data, writes to ring buffer via SharedArrayBuffer
- [ ] Downsample worker — incremental pyramid update off main thread
- [ ] Main thread — reads coherent snapshot, uploads visible range to GPU
- [ ] `OffscreenCanvas` optional path

Data structures have correctness coverage, but the incremental pyramid API must be finalized before moving them off main thread.

---

## Phase 3 — regl renderer (full)

**Status: not started**

- [x] `ReglBackend` — createBuffer, updateBuffer (subdata), createProgram, draw command cache
- [ ] Persistent buffer pool (no Float32Array allocs per frame)
- [x] Raw line strip for few visible points
- [x] `MinMaxSegmentRenderer` — vertical min/max segments for dense viewports
- [ ] Instanced draw for segment mode
- [x] Camera transform as uniforms (scale/offset getters on Camera2D)
- [ ] Two shader modes: `line.vert/frag` and `segment.vert/frag`
- [x] `Renderer.drawMinMaxSegments`
- [ ] Draw call batching per shader mode

---

## Phase 4 — Interaction

**Status: implemented (camera + input)**

- [x] `Camera2D` — viewport model with pan, zoom, setViewport
- [x] `InputController` — pointer pan, wheel zoom, touch via Pointer Events
- [x] `ViewportPolicy` — transforms pan/zoom intents and can update camera before render
- [x] Preview synced-X policy — X stays live-followed while wheel zoom/pan affect Y only
- [x] Camera uniforms propagated to shaders per frame
- [ ] LOD re-query on pan/zoom (viewport change → new LODView)
- [x] `AxisController` — smart tick generation and label formatting
- [ ] Axis tick rendering (smart tick count, label formatting)
- [x] Grid line rendering

Camera modifies `Camera2D`, renderer reads it. No direct data access from interaction layer.

---

## Phase 5 — Multi-series

**Status: data model ready**

- [x] `Chart.addSeries()` supports multiple stores
- [x] Each `SeriesStore` has independent buffer + pyramid + style
- [ ] Batched draw calls (same shader → one draw per series group)
- [ ] Shared X axis optional, independent Y per series
- [x] Color/style per-series
- [x] Series visibility toggle

Limit: solid lines only, no markers, no antialias, no spline, no fill.

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
- [ ] Axis labels / tick rendering
- [x] Grid
- [ ] Legend
- [ ] Tooltip / hit testing
- [ ] Export image
- [ ] Theme system
- [x] ResizeObserver integration

Package status:
- [x] `exports`, `main`, `module`, and `types` point at `dist/`
- [x] Vite library build from `src/index.ts`
- [x] Declaration emit from `src/` only via Vite d.ts plugin
- [x] `bun pm pack --dry-run` includes package files only

---

## Downsampler — LOD engine

**Status: basic pyramid built, not incremental**

Current: `MinMaxPyramid.build()` does a full bottom-up rebuild. Target:

```
raw level:    x: Float64Array, y: Float32Array
level 1:      minY/maxY per bucket of 2
level 2:      minY/maxY per bucket of 4
level 3:      minY/maxY per bucket of 8
…
```

**Incremental append**: each append updates only the chain of closed buckets. Query is O(buckets in viewport).

Planned incremental design:
- Raw samples are addressed by monotonically increasing logical sample index, not physical ring position.
- Level `n` bucket width is `bucketSize ** (n + 1)` raw samples.
- Appending a sample updates only level 0 while its bucket is open.
- When a bucket closes, its min/max pair is propagated upward as one input sample for the next level.
- Higher levels never read raw Y values; they combine child min/max pairs.
- Ring wrap invalidates buckets whose covered logical index range was overwritten.
- Query receives a visible logical index range from x-search and maps that range to bucket indices using the selected level width.

**Query**: `samples_per_pixel = visible_samples / plotWidthPx`, pick `level = max(0, ceil(log2(samples_per_pixel)) - 1)`, return min/max pairs.

**Render decision**:
- few points → raw line strip
- many points → vertical min/max segments
- very many → envelope mesh

---

## Backend strategy

```
V1:  WebGL2 + regl             ← CURRENT
V2:  Backend abstraction          ← In place (GpuBackend interface)
V3:  WebGPU backend               ← Future
```

regl is the V1 backend, not the architecture. The `GpuBackend` interface decouples core from GPU.

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

`RingBuffer` wraps silently at capacity. For streaming this is usually correct, but it should be explicit. Options:
- Ring-buffer with wrap notification
- Fixed capacity with error on overflow
- Auto-growing buffer (breaks streaming contract)

Deferred until we have a concrete use case.

---

## What we're NOT doing (V1)

- SVG / Canvas2D fallback
- Spline interpolation
- Complex fill (gradient, area below)
- Markers / point symbols
- Antialias perfection
- Recalculating axes in render loop
- Per-series draw call without batching

---

## Competitive advantage

Not WebGL. The core differentiator:

> Incremental min/max pyramid + zero-allocation render loop + Camera2D viewport model

Never render 10M points. Render `plotWidthPx * 2` (2k–8k vertices).

---

## Future / difficult

- Multi-chart sync
- Multiple Y axes
- Spectrogram / heatmap
- Large scatter ( > 1M points )
- OHLC / candlestick
- FFT / waterfall
- Out-of-core data ( > RAM)
- WebGPU backend
