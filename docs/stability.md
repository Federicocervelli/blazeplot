# API stability

This page says which parts of BlazePlot you can build on without expecting breaking changes, which parts are still settling, and which parts are exported only so types line up. It is written for app developers deciding what to depend on and for plugin authors deciding how much churn to expect.

Stability tiers are defined here and apply per export. The [API reference](./api-reference.md) is the generated list of every exported symbol; this page classifies them. Version rules are in [Versioning and migration](./versioning-and-migration.md).

## Tiers

| Tier | Meaning | Breaking changes |
|---|---|---|
| **Stable** | Documented behavior you can depend on. | Only in a major release, after the [deprecation process](./versioning-and-migration.md#deprecation-process). |
| **Experimental** | Public and supported, but the shape may still change while real plugins and custom datasets exercise it. | May change in a minor release. Changes are called out under "Changes" or "Breaking" in the changelog. |
| **Internal** | Exported only so declarations and advanced integrations type-check. Not a contract. | May change in any release, including patches. |

Anything not exported from a documented entry point is private, even if you can reach it through a bundler or deep import. The `exports` map in `package.json` blocks deep imports such as `blazeplot/dist/...`. Members marked `@internal` in source are stripped from the published `.d.ts` files (`stripInternal`), so they do not appear in your editor.

Before 1.0, minor releases (`0.x`) can still contain breaking changes, even for stable items; the [migration guide](./versioning-and-migration.md#migrating-to-05) lists the last round. The same holds for the `1.0.0-rc.N` release candidates, which have still changed names and defaults between candidates (see the changelogs). The tiers below describe the contract that starts at 1.0.

## Package format

- **ESM only.** `package.json` has `"type": "module"` and every export has `import` and `default` conditions that point at the ES module build, so `import()`, Node.js 22.12+ `require()` of ES modules, Jest, and Vitest resolve it. There is no UMD or CommonJS build.
- **Types** ship as `.d.ts` files next to each entry (`types` condition). See [TypeScript support](./versioning-and-migration.md#typescript-support) for the supported compiler versions.
- **Tree shaking:** `"sideEffects": false`. Optional features (plugins, linked charts, data helpers, export helpers) live in subpath entries so chart-only apps do not pay for them. The rendering engines (WebGL2, Canvas 2D, and the shared context) are part of the core graph, not subpaths.
- **Browser only.** Charts need the DOM and a canvas: WebGL2 when available, Canvas 2D otherwise (the default `"auto"` renderer). See [Browser support](./browser-support.md).

## Stability by entry point

| Entry point | Tier | Notes |
|---|---|---|
| `blazeplot` | Stable, with the exceptions listed in the tables below | Chart, datasets, data contracts, theming, rendering-engine selection (names, factories, `rendererInfo`), `isWebGL2Available`, `WebGL2UnavailableError`, `Canvas2DUnavailableError`. |
| `blazeplot/linked` | Stable | `createLinkedCharts` and its option/handle types. |
| `blazeplot/data` | Stable | `binSamples`, `histogramBins`, `rollingMean`, and their types (pure, chart-agnostic transforms). |
| `blazeplot/export` | Stable | `exportChartData`, `chartDataToCsv`, `downloadBlob`, `downloadChartScreenshot`, `copyChartScreenshotToClipboard`, and their types. |
| `blazeplot/plugins/legend` | Stable | Options may grow; existing option names are kept. |
| `blazeplot/plugins/tooltip` | Stable | Same. |
| `blazeplot/plugins/interactions` | Stable | Same. |
| `blazeplot/plugins/annotations` | Stable | Same. |
| `blazeplot/plugins/selection` | Stable | Same. |
| `blazeplot/plugins/crosshair` | Stable | Same. |
| `blazeplot/plugins/navigator` | Stable | Same. |
| `blazeplot/plugins/a11y` | Stable | Same. The wording of announcements and table captions is not part of the contract; use `formatAnnouncement` and the format options to pin it. |
| `blazeplot/plugins/flamegraph` | Experimental | Newest and narrowest plugin; its model helpers (`parseFoldedStacks`, `buildStatusChartModel`) may still change. |

"Stable" for a built-in plugin means the plugin function, its documented options, and its documented handle methods. Pixel-level appearance (spacing, default fonts, default colors) can change in a minor release; use `theme` and the plugin options to pin what matters to you.

## Stable surface inside `blazeplot`

| Area | Exports | Tier |
|---|---|---|
| Chart | `Chart` (constructor, `add*` helpers, `addSeries`, viewport/pan/zoom/fit methods, latest-X follow methods (`followX`, `stopFollowX`, `setFollowXPaused`, `getFollowXState`), `pick`, `subscribe` for the events in `ChartEventMap` (including `viewportchange` with its `source` and `followxchange`), `screenshot`, `start`, `stop`, `dispose`, `resize`, `setTheme`, `setAxes`, `setGridVisible`, and the `rootElement`, `theme`, and `renderer` getters) and the option/result types it uses (`ChartOptions`, `AxisConfig`, `ChartPickItem`, `ChartHoverState`, and friends). `ChartOptions.renderer` (see Rendering engines below) | Stable |
| Series handles | `SeriesStore` public methods (`append`, `updateAt`, `updateLast`, `replace`, `clear`, `setVisible`, `setStyle`, `sampleAt`, `markDirty`, and so on) | Stable |
| Datasets | `RingBuffer`, `UniformRingBuffer`, `StaticDataset`, `OhlcRingBuffer`, `StaticOhlcDataset`, `ServerSampledDataset`, `HistogramDataset`, `histogram` | Stable |
| Dataset contract | `Dataset`, `AppendableDataset`, `YAppendableDataset`, `UpdatableDataset`, `YUpdatableDataset`, `OhlcDataset`, `SeriesConfig`, `SeriesStyle`, `Viewport`, `TimeRange`, `XRange`, `BufferOverflowStrategy`, `ValuePrecision`, `DownsampleStrategy`, `SeriesMode` | Stable. See [Data semantics](./data-semantics.md). |
| Theming | `DEFAULT_CHART_THEME`, `LIGHT_CHART_THEME`, `ChartTheme`, `ResolvedChartTheme`, `ThemeColor`, `RgbaColor` | Stable. New theme tokens may be added; existing token names are kept. |
| Accessibility | `ChartAccessibilityOptions`, `chart.getSummary()` with `ChartSummary`, `ChartSeriesSummary`, `ChartSummaryRange`, the root role/ARIA attributes and the key map in [Accessibility](./accessibility.md) | Stable. The wording of the generated summary text may improve in a minor release; pass `accessibility.description` to control it. |
| Viewport policy | `ViewportPolicy`, `PanIntent`, `ZoomIntent`, `ZoomAxis` | Stable |
| Axes | `AxisScale`, `AxisTickFormat`, `AxisTickFormatter`, `AxisTimeZone`, `BuiltInAxisScale`, `AxisConfig`, `AxisScaleOptions`, `AxisRenderTarget` | Stable |
| Rendering engines | `ChartOptions.renderer` values `"auto"` (the default), `"webgl2"`, `"canvas2d"`, `"shared"`; the factories `autoRenderer`, `webgl2Renderer`, `canvas2dRenderer`, `sharedRenderer`, and `createChartRenderContext` with `ChartRenderContext`; `chart.renderer` (`RendererName`) and `chart.rendererInfo` (`ChartRendererInfo` with `name`, `requested`, `fallbackFrom`, and `ChartRendererCapabilities`: `gpu`, `contextLoss`, `shared`, `maxDrawingBufferPixels`); `ctx.renderer` in plugins; `RendererChoice`, `ChartRendererFactory`, `ChartRendererFactoryContext`, `ChartRendererHandle`; `isWebGL2Available`, `WebGL2UnavailableError`, `Canvas2DUnavailableError`; the `renderer` option of `createLinkedCharts` | Stable, and Canvas 2D is a first-class engine, not an experiment. What is covered is the feature set: every series type, gap, axis scale, plugin, and screenshot works on every engine, with the error behavior in [Error handling](./error-handling.md). **Pixel-level output between engines, and between releases, is not covered by semver**: antialiasing, rasterization ties, and join shapes differ by engine and may change in a minor release (see [Browser support](./browser-support.md#rendering-engines) for the documented differences). |
| Plugin contract | `ChartPlugin`, `ChartPluginHandle` (with its `dispose`, `onResize`, `onThemeChange`, `onContextLost`, `onContextRestored` hooks), `ChartPluginContext` and its groups (`ChartPluginCoords` including `format`, `ChartPluginViewport`, `ChartPluginState` including `inspect`/`getInspection` with `ChartInspectionTarget`, `ChartPluginLayout`, `ChartPluginDom` including `document`, `view`, and `claimPointer`, `ChartPluginEvents`), `ChartPluginEventMap`, `ChartPluginEventName`, `ChartMountSlot`, `ChartSurface`, `ChartSurfaceDecoration`, `ChartSurfaceStyle`, `ChartRect`, `ChartPlotSize`, `ChartLayoutReservation`, and the install/hook/dispose order | Stable, except `ctx.unstable` (below). New groups, members, slots, surfaces, hooks, and plugin events may be added in a minor release; existing ones keep their names and behavior. The built-in plugins are written against this surface only. See [Plugin authoring](./plugin-authoring.md). |

## Experimental

These are the low-level extension points. They are public and documented, but they expose renderer-shaped details that may still move.

| Item | Why experimental |
|---|---|
| Plugin escape hatches: `ChartPluginContext.unstable` (`ChartPluginUnstable`: `canvas`, `element(slot)`, `getWebGLContext()`, `createRenderSurface(canvas)`, `getCamera()`) | Raw canvas, DOM, GPU, and camera access bypass the guarantees of the stable context groups (viewport policy, cleanup tracking, layout ownership). `getWebGLContext()` is `null` on engines that do not own a context (Canvas 2D, shared). `createRenderSurface` returns a `ChartRenderSurface` (`beginFrame`, `fillRects`, `endFrame`, `isLost`, `setLossListener`, `dispose`) on the chart's engine; its drawing primitives will grow, and `RendererLossState` is part of it. The built-in plugins do not use the escape hatches, except that the flame graph draws its rectangles on a render surface. |
| Custom fast-path dataset interfaces: `AcceleratedDataset`, `RangeMinMaxDataset`, `RangeSampleCopyDataset`, `VisibleSampleCopyDataset`, `VisiblePointCopyDataset`, `MinMaxSegmentCopyDataset`, `XRangeDataset`, `SampleCopyLayout` | Their method signatures are renderer-ready fast paths and have changed before (see the 0.5 `copyMinMaxSegments` change). Implementing only the stable `Dataset` contract avoids this risk. Optional members such as `isGap` and `ordinalOffset` follow the `Dataset` tier. |
| Camera access: `ctx.unstable.getCamera()` and the `Camera2D` type (also passed to `ViewportPolicy` hooks), `CustomAxisScale` (the custom-scale hook shape) | Direct camera mutation bypasses `ViewportPolicy` and the chart's follow/auto-fit state. Prefer `chart.setViewport`, `pan`, and `zoom`. |
| `blazeplot/plugins/flamegraph` | See the entry point table. |

The same items carry an `@experimental` JSDoc tag in the published declarations, so editors show the tier on hover. `ChartPluginContext.unstable` and `ChartPluginUnstable` are tagged, and every export of `blazeplot/plugins/flamegraph` is tagged.

Experimental does not mean unsupported: bugs are fixed the same way. It means a minor release may require a code change, and the changelog will say so.

## Internal

These are not an API for application code. The engine and GPU backend types (`ChartRenderer`, `GpuBackend`, `WebGL2Backend`, the `Gpu*` types, `BufferSpec`, `AttributeSpec`, `DrawSpec`, `UniformValue`) are not exported from the `blazeplot` root. The engine selection surface above is public.

| Item | Notes |
|---|---|
| The `ChartRenderer` drawing interface and the engine classes behind the factories | `ChartRenderer` is marked `@internal` and stripped from published declarations. The factories return the opaque `ChartRendererHandle` (`kind`); custom engines are not supported. |
| `/** @internal */` members | Stripped from published declarations. If you reach them through casts, expect breakage in patch releases. |
| Generated DOM structure and `blazeplot-*` class names | Styling hooks you pass through `className` options are stable; the markup the chart generates around them is not. The documented ARIA contract in [Accessibility](./accessibility.md) is stable. |
| Bundle chunk names such as `dist/Chart-*.js` | Hashed output files. Import only the documented entry points. |

## Reading the tiers in practice

- If you only use `Chart`, the built-in datasets, built-in plugins, `blazeplot/data`, and `blazeplot/export`, you are on the stable surface.
- If you write a plugin against the stable context groups, a `^1` range is enough. If it uses `ctx.unstable`, test against the next minor in CI.
- If you implement a custom `Dataset`, stay on the required `Dataset` methods unless you have measured a need for the fast paths.
- If you need the raw GL context, pin an exact version. Custom engines are not supported.
- If you depend on exact pixels (screenshot diffing, for example), pin the engine (`renderer: "webgl2"` or `"canvas2d"`) and the library version, and expect to regenerate baselines when either changes.

## Promotion

An experimental item is promoted to stable in a minor release once it has been unchanged for two minor releases and is covered by unit or browser tests. The promotion is noted in the changelog and this page is updated in the same pull request. An internal item is never promoted silently; it needs a docs change that moves it to a stable or experimental row first.
