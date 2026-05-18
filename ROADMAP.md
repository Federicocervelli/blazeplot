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
- [x] **LOD as a strategy, not a requirement** — `SeriesConfig.downsample` accepts `"minmax" | "none"` (optional, defaults to `"minmax"`). Line/bar use min/max when enabled, scatter uses exact 2D-culled chunks for `"none"` and a 2D viewport-aware point sampler with min/max interval pruning for LOD, and area renders raw sampled strips.
- [x] **Incremental pyramid update** — current: O(log N) per append instead of full rebuild. Only recomputes the affected tail at each level. `SeriesStore` avoids repeated full rebuilds after fixed-capacity ring shifts and uses the generic `RangeMinMaxDataset.rangeMinMaxY()` capability for dense extraction; `RingBuffer` implements it with a physical segment tree for wrapped streaming queries.

---

## Phase 3 — regl renderer (full)

**Status: line, min/max, scatter, bar, and area rendering done; advanced modes and batching pending**

Scatter rendering now separates exact 2D visibility from decimation: `downsample: "none"` draws exact 2D-culled chunks, while LOD scatter first tries exact visible extraction and only falls back to screen-space cells when the visible point budget is exceeded. Area rendering samples raw strips for dense traces.

- [x] `ReglBackend` — createBuffer, updateBuffer (subdata), createProgram, draw command cache
- [x] Raw line strip for few visible points
- [x] `MinMaxSegmentRenderer` — vertical min/max segments for dense viewports
- [x] Camera transform as uniforms (scale/offset getters on Camera2D)
- [x] `Renderer.drawMinMaxSegments`
- [x] Persistent buffer pool — `WebGL2Resources` manages pre-allocated `Float32Array` + `regl.Buffer` pairs. Pre-allocates common sizes (1K–128K floats) at init. `ReglBackend.createBuffer` pulls from pool — no `regl.buffer()` calls at runtime. `dispose` returns to pool; `destroy` cleans up all entries.
- [x] Instanced draw for segment mode (with line-list fallback when regl/browser instancing is unavailable)
- [x] Scatter / point rendering (instanced quads with point-sprite fallback)
- [x] Bar rendering (instanced quads with expanded-triangle fallback, data-space width, configurable baseline)
- [x] Bar sampling for dense views (min/max range buckets using the same visible bucketing strategy as dense line rendering; sampled bars span the full bucket, include the baseline, and avoid visual gaps)
- [x] Area fill (triangle-strip fill to baseline + line overlay)
- [x] OHLC glyph rendering (`StaticOhlcDataset` + `chart.addOhlc`)
- [x] Candlestick body rendering (`chart.addCandlestick`, up/down bodies + wicks)
- [ ] Draw call batching per shader mode

---

## Phase 4 — Interaction

**Status: implemented (camera + optional interactions plugin)**

- [x] `Camera2D` — viewport model with pan, zoom, setViewport
- [x] Interaction plugin — plain-drag box zoom, Shift+drag plot pan, axis drag pan, wheel/axis zoom, double-click reset, configurable `"x" | "y" | "xy"` axis, including dynamic axis callbacks for runtime policies
- [x] `ViewportPolicy` — transforms plugin pan/zoom intents and can update camera before render
- [x] Camera uniforms propagated to shaders per frame
- [x] `AxisController` — smart tick generation and label formatting
- [x] Grid line rendering
- [x] Axis tick labels (DOM overlay)
- [x] LOD re-query on pan/zoom (viewport change → current camera viewport is used for visible extraction each frame; dirty pyramids rebuild before draw when append-only, and use `RangeMinMaxDataset` aggregation after fixed-capacity ring shifts)
- [x] Box-select / region zoom (via optional `interactionsPlugin`)
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
- [x] Mixed chart types (line + scatter + bar + area + OHLC supported)
- [x] Candlestick body mixed chart support
- [x] Shared X axis optional, independent Y per series (`SeriesConfig.yAxis`, left/right cameras share X)
- [x] Secondary axis (`axes.y2`, right-side gutter/overlay, `chart.setYViewport`)

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
- [x] Grid, including runtime `chart.setGridVisible()` / `chart.getGridVisible()`
- [x] Axis labels / tick rendering (DOM layout, `axes: false` to disable, runtime `chart.setAxes()`)
- [x] `chart.screenshot()` / export image (full chart composite: WebGL plot + built-in DOM text overlays)
- [x] Theme system (`theme` option, `chart.setTheme()`, resolved `chart.theme`, themed plot background/grid/axes/default palette plus built-in legend/tooltip defaults)
- [x] Plugin API (`ChartPlugin`, `plugins` option, disposable installs)
- [x] Optional plugin subpath exports (`blazeplot/plugins/interactions`, `blazeplot/plugins/legend`, `blazeplot/plugins/tooltip`) so chart-only imports do not need to import built-in UI plugins
- [x] Legend plugin (`legendPlugin`) built on public series state APIs
- [x] Tooltip / hit testing (`tooltipPlugin`, `chart.pick`, `chart.subscribe("hover")`; actual raw sample X/Y, per-frame live hover refresh, highlighted sample markers)
- [x] `chart.addLine(config)`, `chart.addArea(config)`, `chart.addScatter(config)`, `chart.addBar(config)`, `chart.addOhlc(config)`, `chart.addCandlestick(config)` helpers.

Package status:
- [x] Current npm package version: `0.1.12`
- [x] `exports`, `main`, `module`, and `types` point at `dist/`
- [x] Optional plugin subpath exports point at separate `dist/plugins/*` chunks
- [x] Vite library build from `src/index.ts`
- [x] Declaration emit via `vite-plugin-dts`
- [x] CI release workflow with npm publish and provenance

---

## Competitive feature roadmap

Prioritized additions based on gaps versus mature plotting libraries while preserving BlazePlot's fast WebGL2 streaming focus.

1. **Time axis + tick formatters**
   - [x] Add `scale: "time"` support for X/Y axes where appropriate.
   - [x] Automatic time tick unit selection: ms, seconds, minutes, hours, days, months, years.
   - [x] Built-in timestamp/date formatters with local/UTC options.
   - [x] User-provided tick formatter callback per axis.

2. **Brush / range selection plugin**
   - [x] Add drag-to-select X range, Y range, and XY rectangle selection modes.
   - [x] Expose selected data-space bounds and matching raw samples.
   - [x] Add configurable selected/unselected styling hooks.
   - [x] Emit selection lifecycle events: start, update, commit, clear.

3. **Crosshair / ruler plugin**
   - [x] Add vertical/horizontal crosshair lines independent of tooltip rendering.
   - [x] Support shared crosshair across synced charts.
   - [x] Add measurement/ruler mode for delta X, delta Y, slope, and sample count.
   - [x] Allow styling, snapping mode, and axis readout configuration.

4. **Chart titles and axis titles**
   - [x] Add chart title/subtitle DOM overlays inside `ChartLayout`.
   - [x] Add X/Y/Y2 axis title support for inside/outside axis layouts.
   - [x] Include titles in `chart.screenshot()` composition.
   - [x] Theme title fonts, colors, spacing, and alignment.

5. **Richer event API**
   - [ ] Add typed subscriptions for `click`, `dblclick`, `pointerdown`, `pointerup`, `pointermove`, `viewportchange`, `select`, and `seriesclick`.
   - [ ] Include data coordinates, plot/client coordinates, target series, nearest sample, and active modifier keys where relevant.
   - [ ] Keep plugin-facing events stable and avoid DOM implementation leaks.

8. **Navigator / overview mini-map plugin**
   - [ ] Add a small overview plot with draggable visible-window handles.
   - [ ] Support live streaming follow mode and manual historical browsing.
   - [ ] Reuse existing LOD paths for large overview datasets.
   - [ ] Allow height, placement, styles, and linked series configuration.

9. **React wrapper package**
   - [ ] Add first-party `@blazeplot/react` package or subpath.
   - [ ] Provide `BlazeChart` component with ref access to the underlying `Chart`.
   - [ ] Handle mount/dispose, prop updates, plugin lifecycle, and resize automatically.
   - [ ] Include examples for streaming data, tooltips, legends, and custom plugins.

10. **More scales: built-in and configurable**
   - [ ] Add built-in `linear`, `time`, `log`, and `symlog` scale implementations.
   - [ ] Add optional built-in categorical/ordinal axis support for bar-like views.
   - [ ] Provide a configurable/custom scale interface with `toScreen`, `fromScreen`, `ticks`, and `formatTick` hooks where feasible.
   - [ ] Support reversed axes, log base configuration, symlog constant configuration, and domain validation.
   - [ ] Ensure LOD/query paths remain data-space based and scale transforms are applied only at interaction/render mapping boundaries.

11. **Linked multi-chart layout**
   - [ ] Add a layout helper for stacked/side-by-side charts with shared X and independent Y axes.
   - [ ] Support synchronized camera ranges, cursor/crosshair, selections, and tooltips.
   - [ ] Allow configurable spacing/gutters between linked plot areas.
   - [ ] Support per-panel titles, axes, legends, and series groups.

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

**Status: complete**

`RingBuffer` overflow behavior is explicit. The default remains `"wrap"` for streaming charts, and callers can opt into `"drop-new"` or `"error"` via `new RingBuffer(capacity, { overflow })` or `SeriesConfig.overflow` when Chart creates the backing buffer.

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
