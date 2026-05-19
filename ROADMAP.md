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
- `bun run build` emits core `dist/index.js` / `dist/index.d.ts` plus separate `react`, `linked`, `export`, and built-in plugin subpath chunks/declarations.
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

- [x] `new Chart(targetElement)`
- [x] `new Chart(targetElement, { viewportPolicy })`
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
- [x] `chart.fitToData(options)` for fitting X and/or left/right Y viewports to visible or supplied series, with optional padding and include-zero behavior.
- [x] Dataset-backed series ergonomics: `capacity` is optional when `dataset` is supplied, so static data quick starts can use `new StaticDataset(x, y)` without ring-buffer parameters.

Package status:
- [x] Current npm package version: `0.3.2`
- [x] `exports`, `main`, `module`, and `types` point at `dist/`
- [x] Optional plugin subpath exports point at separate `dist/plugins/*` chunks
- [x] Vite library build from `src/index.ts`
- [x] Declaration emit via `vite-plugin-dts`
- [x] Merge-to-`main` release workflow with npm publish, provenance, `vX.Y.Z` tags, and GitHub Releases

---

## Release engineering and CI

**Status: protected-branch release flow complete**

- [x] `main` is the protected release branch; release PRs merge there only after the `validate` status check passes.
- [x] `development` is the integration branch for feature/fix work before release PRs.
- [x] `bun run ci` runs typecheck, tests, package build, package export smoke test, package contents dry-run, bundle-size check, headless browser benchmark smoke test, automated visual tests, and automated browser interaction tests.
- [x] GitHub CI runs the same `validate` check for PRs to `main`/`development` and pushes to `development`.
- [x] Release workflow publishes only unpublished `package.json` versions and skips publish work when the version tag already exists.
- [x] Release changelogs include benchmark tables via `bun run release:benchmarks`; the release workflow appends them with `--if-missing` before GitHub Release creation.
- [x] GitHub Pages deploys combined branch previews: stable `main` at `/blazeplot/` and in-progress `development` at `/blazeplot/development/`.
- [x] Release and benchmark operations are documented in `docs/release-and-benchmarks.md`.

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
   - [x] Add typed subscriptions for `click`, `dblclick`, `pointerdown`, `pointerup`, `pointermove`, `viewportchange`, `select`, and `seriesclick`.
   - [x] Include data coordinates, plot/client coordinates, target series, nearest sample, and active modifier keys where relevant.
   - [x] Keep plugin-facing events stable and avoid DOM implementation leaks.

6. **Annotation overlay plugin**
   - [x] Add first-party `blazeplot/plugins/annotations` entrypoint with a plugin-owned SVG overlay.
   - [x] Support X/Y lines, X/Y ranges, boxes, points, labels, visibility, IDs, per-annotation styles, and left/right Y-axis targeting.
   - [x] Provide runtime `add`, `remove`, `clear`, `setAnnotations`, and `getAnnotations` APIs.
   - [x] Add annotation hit testing and hover/click event payloads that identify the annotation and data-space anchor/bounds.
   - [ ] Add optional drag/edit handles for movable lines, ranges, boxes, points, and labels.
   - [x] Include plugin SVG overlays, including annotations, in `chart.screenshot()` composition.

7. **Autoscale / fit-to-data viewport policies**
   - [x] Add `chart.fitToData()` with per-axis options for fitting all visible series or a supplied series subset.
   - [x] Add auto-Y-on-visible-X policies with configurable padding and include-zero behavior.
   - [x] Add streaming follow policies that can pause on manual navigation and resume explicitly.
   - [ ] Expose typed policy hooks so applications can combine autoscale, fixed ranges, and synchronized chart constraints.

8. **Missing-data and discontinuity semantics**
   - [x] Define and document behavior for `NaN`, infinities, duplicate X values, unsorted X values, and empty datasets.
   - [ ] Render explicit line/area gaps across invalid or missing samples instead of connecting across discontinuities.
   - [ ] Preserve gap semantics through LOD extraction, picking, tooltip grouping, screenshot export, and static/streaming datasets.
   - [ ] Add validation/error modes so callers can choose between permissive skip, warning, or throw behavior for bad data.

9. **Navigator / overview mini-map plugin**
   - [x] Add a small overview plot with draggable visible-window handles.
   - [x] Support live streaming follow mode and manual historical browsing.
   - [x] Reuse existing LOD paths for large overview datasets.
   - [x] Allow height, placement, styles, and linked series configuration.

10. **React wrapper package**
   - [x] Add first-party `blazeplot/react` subpath.
   - [x] Provide `BlazeChart` component with ref access to the underlying `Chart`.
   - [x] Handle mount/dispose, prop updates, plugin lifecycle, and resize automatically.
   - [x] Include examples for streaming data, tooltips, legends, and custom plugins.
   - [x] Add a React Pages preview for stable and development branches.

11. **More scales: built-in and configurable**
   - [x] Add built-in `linear`, `time`, `log`, and `symlog` scale implementations.
   - [x] Add optional built-in categorical/ordinal axis support for bar-like views.
   - [x] Provide a configurable/custom scale interface with `toScreen`, `fromScreen`, `ticks`, and `formatTick` hooks where feasible.
   - [x] Support reversed axes, log base configuration, symlog constant configuration, and domain validation.
   - [x] Ensure LOD/query paths remain data-space based and scale transforms are applied only at interaction/render mapping boundaries.

12. **Linked multi-chart layout**
   - [x] Add a layout helper for stacked/side-by-side charts with shared X and independent Y axes.
   - [x] Support synchronized X camera ranges across linked charts.
   - [x] Support synchronized cursor/crosshair, selections, and tooltips across linked charts.
   - [x] Allow configurable spacing/gutters between linked plot areas.
   - [x] Support per-panel titles, axes, legends, and series groups.

13. **Mobile and touch support**
   - [x] Add touch-first interaction presets for pan, pinch zoom, and double-tap reset.
   - [x] Add long-press tooltip/crosshair behavior.
   - [ ] Ensure selection, navigator, and legend interactions are usable without hover.
   - [ ] Improve mobile layout defaults for outside axes, controls, legends, and dense tick labels.
   - [x] Add mobile preview/testing scenarios for automated touch gestures.

14. **Accessibility and keyboard support**
   - [x] Add ARIA labels/roles for chart roots and plot/canvas/axis presentation semantics.
   - [x] Add keyboard pan, zoom, and fit-to-data reset with configurable pan/zoom amounts.
   - [x] Add ARIA labels/roles for legends, tooltips, navigators, and plugin controls.
   - [ ] Add keyboard selection and navigator-handle movement with configurable shortcuts.
   - [ ] Add focus management and visible focus styles for plugin-owned controls and overlays.
   - [ ] Add high-contrast theme guidance and reduced-motion behavior where animations/interactions are introduced.
   - [ ] Add automated accessibility checks for representative previews.

15. **Export and sharing improvements**
   - [x] Support `chart.screenshot()` image MIME type, quality, background, and DPR options.
   - [x] Add explicit output width/height options independent of the live layout size.
   - [x] Add transparent-background export support.
   - [x] Add optional download and clipboard helper utilities outside the core chart path via `blazeplot/export`.
   - [x] Add transparent, dark, and light export presets.
   - [x] Add export coverage for plugin-owned SVG overlays.

16. **Tree-shakable plugin-owned UI and theme extension**
   - [ ] Audit public exports and build output so chart-only imports do not pull optional plugin code or plugin DOM UI.
   - [ ] Move plugin-specific DOM/UI helpers fully behind their plugin subpath entries.
   - [ ] Keep `Chart` responsible for only the core plugin contract, layout reservations, and generic extension hooks.
   - [ ] Decouple plugin theme values from the core `ChartTheme` shape where practical; let plugins define/resolve their own optional theme extensions.
   - [ ] Provide typed extension points for plugin-owned theme tokens without forcing every consumer to import every built-in plugin's theme surface.

17. **Documentation and examples**
   - [x] Add a plugin authoring guide covering lifecycle, public chart APIs, layout reservations, events, theme extensions, and subpath packaging.
   - [x] Add theming and responsive-layout guides with mobile, dark mode, and high-density data examples.
   - [x] Add performance recipes for streaming ingestion, static datasets, LOD strategy choices, worker-fed data, and memory budgeting.
   - [x] Add API stability/versioning notes and migration guidance for breaking changes.
   - [x] Add real-world example recipes for financial OHLC/candlestick charts, multi-panel dashboards, annotations, export workflows, and React integration.

---

## Testing and quality roadmap

Current automated coverage is strongest for core data structures and interaction math, with CI browser benchmark, visual, and interaction harnesses covering the WebGL/DOM/plugin paths at a broader smoke/regression level.

- [x] Core unit tests for ring buffers, static datasets, OHLC datasets, min/max pyramids, series extraction, and picking helpers.
- [x] Interaction unit tests for `Camera2D` and `AxisController` behavior.
- [x] CI `validate` check runs typecheck, unit tests, package build, package export smoke test, package contents dry-run, bundle-size check, headless `ci-smoke` browser benchmark, chart visual tests, and browser interaction tests.
- [x] Release changelogs include benchmark result tables for each published version.
- [x] Browser visual test harness renders focused chart/plugin cases for line, area, scatter, bar, OHLC, candlestick, axes/titles/grid, legend, tooltip, crosshair, annotations, selection, and navigator.
- [x] WebGL smoke tests assert render modes, draw calls, rendered points, and `chart.screenshot()` output in a controlled browser.
- [x] Browser interaction test harness simulates real input events for hover, crosshair, wheel zoom, shift-drag pan, box zoom, reset, and selection.
- [ ] Expand DOM/plugin interaction tests to cover legend toggles, navigator handle dragging, axis-specific drag/zoom, annotation hit behavior, and mobile no-hover workflows.
- [ ] Screenshot/export regression tests with image comparison baselines for plot + DOM/plugin overlay composition.
- [ ] Benchmark trend storage/comparison so CI can flag large regressions without being flaky on shared runners.
- [x] Package export smoke tests for every public subpath (`blazeplot`, `react`, `linked`, `export`, and each built-in plugin) against built output.
- [x] Bundle-size regression checks for core, shared, and optional plugin chunks.
- [ ] WebGL context-loss/context-restore browser tests once context recovery support is implemented.

## Runtime resilience and packaging roadmap

- [ ] Handle WebGL context loss/restoration by rebuilding regl resources, GPU buffers, and cached draw commands without leaking chart state.
- [x] Expose a clear WebGL2-unavailable error path/API so host applications can render their own fallback UI.
- [ ] Add dispose/resource leak stress tests for repeated chart/plugin mount, unmount, series churn, resize, and screenshot cycles.
- [x] Validate npm package contents and generated declaration files in CI before release PRs.
- [x] Track dependency and browser-support assumptions, especially WebGL2/regl behavior across Chrome, Firefox, Safari, and mobile browsers.

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

- SVG / Canvas2D fallback renderer for core plot drawing
- Spline interpolation
- Antialias perfection
- Recalculating axes in render loop
- Keeping long-term per-series draw calls once batching is available

---

## Future / difficult

- Multiple independent Y axes beyond the current left/right axis pair
- Error bars and confidence bands
- Stacked area/bar charts
- Histogram/binning helpers
- Heatmap, spectrogram, FFT, and waterfall views
- WebGPU backend
