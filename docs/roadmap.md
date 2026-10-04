# BlazePlot Roadmap

BlazePlot is a fast WebGL2 plotting engine for dense browser time-series charts.

## Current status (1.0 release candidates)

- **Charts and data:** core chart API, typed datasets, ring buffers, OHLC datasets, server-sampled datasets, histograms, min/max LOD, gaps, picking, and data export. Every dataset follows one input rule (finite, non-decreasing X); static data is validated at construction and streaming buffers skip and count invalid samples.
- **Rendering:** a native WebGL2 backend covers line, area, scatter, bar, OHLC, candlestick, dense min/max paths, screenshots, and context loss/restore, with DOM/SVG overlays for axes and plugins.
- **Plugins:** pan, zoom, box zoom, touch gestures, crosshair, tooltip, legend, annotations, selection, navigator, flamegraph, and accessibility, all built on a stable, documented plugin contract that third-party plugins can use too.
- **Accessibility:** chart semantics with a generated summary, a hidden data table, a keyboard inspection cursor, keyboard selection and annotations, focus rings, and forced-colors support.
- **Packaging:** tree-shakable entry points (`blazeplot`, `blazeplot/linked`, `blazeplot/data`, `blazeplot/export`, `blazeplot/plugins/*`), ESM only, with bundle-size budgets and a public API snapshot.
- **Quality gates in CI:** typecheck, lint, unit and property tests with coverage floors, the TypeScript 5.0 floor, export and package checks, typechecked docs snippets, a performance regression gate, pixel-baseline visual tests, browser interaction and keyboard tests, axe-core and forced-colors checks, a leak/stability suite, and a Firefox/WebKit smoke job.

## After 1.0

These are additive and can ship in 1.x minor releases.

1. **Annotations and editing**
   - [ ] Drag/edit handles for annotation lines, ranges, boxes, points, and labels.
   - [ ] Keyboard and touch editing (focus, activate, and delete already work).

2. **Mobile and responsive UX**
   - [ ] Better hover-free workflows for selection, navigator, legend, tooltip, and annotations on touch screens.
   - [ ] Responsive presets for axes, tick density, gutters, legends, and compact dashboard panels.
   - [ ] Mobile WebGL2 coverage in the browser test suite.

3. **Data pipeline helpers**
   - [ ] Optional ingestion helpers for CSV, JSON, typed arrays, and worker-fed batches.
   - [ ] Worker and server-side transform guidance for high-rate streams.
   - [ ] Transfer-friendly and `SharedArrayBuffer` dataset update patterns.

4. **Bundle and performance**
   - [ ] Track total loaded graph sizes for common import scenarios, not just individual chunks.
   - [ ] Memory benchmarks for long-running streaming dashboards.

5. **Visualization modes**
   - [ ] Error bars and confidence bands.
   - [ ] Stacked area/bar overlays and variable-width histogram bars.
   - [ ] Heatmap, spectrogram, FFT, and waterfall views if they fit the GPU-first dense-data niche.
   - [ ] More than two independent Y axes.
   - [ ] A WebGPU backend.

6. **Experimental APIs**
   - [ ] Promote the custom fast-path dataset interfaces and the flamegraph plugin to stable once real users have exercised them (see [API stability](./stability.md)).

## Non-goals for now

- Canvas2D/SVG fallback renderer for core plot drawing.
- Large chart-type expansion that bloats the time-series core.
- Bundling timezone databases or heavyweight data-processing libraries.
- Breaking synchronous chart construction for optional feature splitting.
- Adding or removing plugins on a live chart; plugins are fixed at construction so layout, ordering, and cleanup stay predictable.
