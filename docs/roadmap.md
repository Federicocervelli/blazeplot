# BlazePlot Roadmap

BlazePlot is a fast WebGL2 plotting engine for dense browser time-series charts.

## Current status

- Core chart API, typed datasets, ring buffers, OHLC datasets, server-sampled datasets, min/max LOD, gaps, picking, and data export helpers are implemented.
- WebGL2 rendering covers line, area, scatter, bar, OHLC, candlestick, dense min/max paths, screenshots, context restore, and built-in DOM/SVG overlays.
- Interaction/plugin layer covers pan, zoom, box zoom, touch gestures, crosshair, tooltip, legend, annotations, selection, navigator, linked charts, React wrapper, and theming.
- Package output is split into tree-shakable public subpaths: `blazeplot`, `core`, `interaction`, `render`, `react`, `linked`, `linked-core`, `data`, `export`, and `plugins/*`.
- CI validates typecheck, unit tests, build, package exports, package contents, bundle-size budgets, benchmark smoke, visual tests, and browser interaction tests.

## Near-term priorities

1. **Native WebGL2 backend / regl removal**
   - [x] Add a native `WebGL2Backend` implementing the existing `GpuBackend` interface.
   - [x] Keep `ReglBackend` available as a deprecated compatibility alias during migration.
   - [ ] Validate lines, min/max, scatter, bars, area, OHLC, candlesticks, context restore, and screenshots with pixel-visible browser tests.
   - [x] Switch the default backend after native parity work.
   - [x] Remove the `regl` dependency to reduce real consumer bundle size.

2. **Renderer correctness and regression coverage**
   - [ ] Strengthen visual tests so they fail when draw calls happen but pixels are not visibly rendered.
   - [ ] Add preview smoke coverage for main, features, server-sampled, mobile, linked, and React previews.
   - [ ] Add screenshot image-comparison baselines for plot + DOM/SVG plugin overlays.
   - [ ] Add broader browser coverage for Chrome/Chromium, Firefox, Safari/WebKit, and mobile WebGL2.

3. **Bundle-size and packaging discipline**
   - [x] Keep optional plugins behind subpath entries.
   - [x] Add bundle-size budgets and source-map analyzer tooling.
   - [x] Exclude source maps from the published npm package.
   - [ ] Track total loaded graph sizes for common import scenarios, not just individual chunks.
   - [ ] Continue splitting optional chart features only when behavior remains synchronous and compatible.

4. **Production polish**
   - [ ] Add dispose/resource leak stress tests for repeated chart/plugin mount, unmount, resize, screenshot, and series churn.
   - [ ] Add memory/resource benchmarks for long-running streaming dashboards.
   - [ ] Improve WebGL context-loss/context-restore coverage.
   - [ ] Document fallback UI patterns for browsers without WebGL2.

5. **Mobile and responsive UX**
   - [x] Touch pan, pinch zoom, double-tap reset, and long-press crosshair/tooltip.
   - [ ] Improve hover-free selection, navigator, legend, tooltip, and annotation workflows.
   - [ ] Add responsive presets for axes, tick density, gutters, legends, and compact dashboard panels.

6. **Annotations and editing**
   - [x] First-party annotation overlay plugin with lines, ranges, boxes, points, labels, hit testing, screenshots, and runtime APIs.
   - [ ] Add drag/edit handles for movable annotation lines, ranges, boxes, points, and labels.
   - [ ] Add keyboard and mobile editing affordances.

7. **Data pipeline helpers**
   - [x] `blazeplot/data` export and transform helpers.
   - [x] Add first-class histogram helpers for one-dimensional value distributions.
   - [ ] Add optional ingestion helpers for CSV, JSON, typed arrays, and worker-fed batches.
   - [ ] Document worker/server-side transform guidance for high-rate streams.
   - [ ] Investigate transfer-friendly and `SharedArrayBuffer` dataset update patterns.

8. **Plugin API stability**
   - [ ] Separate stable plugin-facing contracts from internal `ui/` implementation details.
   - [ ] Add plugin compatibility tests for lifecycle, layout reservations, events, theme extension, screenshot inclusion, and disposal.
   - [ ] Publish plugin migration/deprecation guidance.

9. **Future visualization modes**
   - [ ] Error bars and confidence bands.
   - [ ] Stacked area/bar overlays and variable-width histogram bar rendering.
   - [ ] Heatmap, spectrogram, FFT, and waterfall views if they fit the GPU-first dense-data niche.
   - [ ] Multiple independent Y axes beyond left/right.
   - [ ] WebGPU backend after the native WebGL2 backend and lifecycle tests are mature.

## Non-goals for now

- Canvas2D/SVG fallback renderer for core plot drawing.
- Large chart-type expansion that bloats the time-series core.
- Bundling timezone databases or heavyweight data-processing libraries.
- Breaking existing synchronous chart construction for optional feature splitting.
