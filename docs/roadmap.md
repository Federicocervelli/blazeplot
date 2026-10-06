# BlazePlot Roadmap

BlazePlot is a fast, GPU-accelerated plotting engine, with an automatic Canvas 2D fallback, for dense browser time-series charts.

## Current status (1.0 released)

BlazePlot 1.0 is released and follows the [stability contract](./stability.md): breaking changes wait for the next major version. What shipped in 1.0:

- **Charts and data:** core chart API, typed datasets, ring buffers, OHLC datasets, server-sampled datasets, histograms, min/max LOD, gaps, picking, and data export. Every dataset follows one input rule (finite, non-decreasing X); static data is validated at construction and streaming buffers skip and count invalid samples.
- **Rendering:** a native WebGL2 backend (one stream upload per frame) covers line, area, scatter, bar, OHLC, candlestick, dense min/max paths, screenshots, and context loss/restore, with DOM/SVG overlays for axes and plugins. Three engines ship in the core package: WebGL2, Canvas 2D, and a shared WebGL context that lets many charts share one context. The default `renderer: "auto"` uses WebGL2 and falls back to Canvas 2D without WebGL2. Charts work in iframes and popup windows.
- **Plugins:** pan, zoom, box zoom, keyboard and touch gestures (with cooperative modes for scrolling pages), crosshair, tooltip, legend, annotations, selection, navigator, flamegraph, and accessibility, all built on a stable, documented plugin contract that third-party plugins can use too.
- **Accessibility:** chart semantics with a generated summary, a hidden data table, a keyboard inspection cursor, keyboard selection and annotations, focus rings, and forced-colors support.
- **Packaging:** tree-shakable entry points (`blazeplot`, `blazeplot/linked`, `blazeplot/data`, `blazeplot/export`, `blazeplot/plugins/*`), ESM only, with bundle-size budgets and a public API snapshot.
- **Quality gates in CI:** typecheck, lint, unit and property tests with coverage floors, the TypeScript 5.0 floor, export and package checks, typechecked docs snippets, a performance regression gate, pixel-baseline visual tests, browser interaction and keyboard tests, axe-core and forced-colors checks, a leak/stability suite, and a Firefox/WebKit smoke job.

## Next (1.x)

These are additive and can ship in 1.x minor releases. They are listed in rough priority order, not as commitments.

1. **Annotations and editing**
   - [ ] Drag/edit handles for annotation lines, ranges, boxes, points, and labels.
   - [ ] Keyboard and touch editing (focus, activate, and delete already work).

2. **Mobile and responsive UX**
   - [ ] Better hover-free workflows for selection, navigator, legend, tooltip, and annotations on touch screens.
   - [ ] Responsive presets for axes, tick density, gutters, legends, and compact dashboard panels.
   - [ ] Mobile WebGL2 coverage in the browser test suite, including real-device checks of one-finger page scrolling with the default `touchPan: "two-finger"` (verified through touch emulation only so far).

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

- An SVG renderer for core plot drawing (a Canvas 2D engine ships in the core package).
- Large chart-type expansion that bloats the time-series core.
- Bundling timezone databases or heavyweight data-processing libraries.
- Breaking synchronous chart construction for optional feature splitting.
- Third-party renderers: the `ChartRenderer` drawing interface is internal, and only the built-in renderers implement it.
- Adding or removing plugins on a live chart; plugins are fixed at construction so layout, ordering, and cleanup stay predictable.
