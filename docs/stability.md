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

Before 1.0, minor releases (`0.x`) can still contain breaking changes, even for stable items; the [migration guide](./versioning-and-migration.md#migrating-to-05) lists the last round. The tiers below describe the contract that starts at 1.0.

## Package format

- **ESM only.** `package.json` has `"type": "module"` and every export has only an `import` condition. `require("blazeplot")` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`; use `import` or a dynamic `import()` from CommonJS. There is no UMD or CommonJS build.
- **Types** ship as `.d.ts` files next to each entry (`types` condition). See [TypeScript support](./versioning-and-migration.md#typescript-support) for the supported compiler versions.
- **Tree shaking:** `"sideEffects": false`. Optional features live in subpath entries so chart-only apps do not pay for them.
- **Browser only.** Charts need WebGL2 and the DOM. See [Browser support](./browser-support.md).

## Stability by entry point

| Entry point | Tier | Notes |
|---|---|---|
| `blazeplot` | Stable, with the exceptions listed in the tables below | Chart, datasets, data contracts, theming, `isWebGL2Available`, `WebGL2UnavailableError`. |
| `blazeplot/linked` | Stable | `createLinkedCharts` and its option/handle types. |
| `blazeplot/data` | Stable | `exportChartData`, `chartDataToCSV`, `binSamples`, `rollingMean`, and their types. |
| `blazeplot/export` | Stable | `downloadBlob`, `downloadChartScreenshot`, `copyChartScreenshotToClipboard`. |
| `blazeplot/plugins/legend` | Stable | Options may grow; existing option names are kept. |
| `blazeplot/plugins/tooltip` | Stable | Same. |
| `blazeplot/plugins/interactions` | Stable | Same. |
| `blazeplot/plugins/annotations` | Stable | Same. |
| `blazeplot/plugins/selection` | Stable | Same. |
| `blazeplot/plugins/crosshair` | Stable | Same. |
| `blazeplot/plugins/navigator` | Stable | Same. |
| `blazeplot/plugins/flamegraph` | Experimental | Newest and narrowest plugin; its model helpers (`buildFlameGraphModel`, `parseFoldedStacks`, `pickFrame`, `buildStatusChartModel`) may still change. |

"Stable" for a built-in plugin means the plugin function, its documented options, and its documented handle methods. Pixel-level appearance (spacing, default fonts, default colors) can change in a minor release; use `theme` and the plugin options to pin what matters to you.

## Stable surface inside `blazeplot`

| Area | Exports | Tier |
|---|---|---|
| Chart | `Chart` (constructor, `add*` helpers, `addSeries`, viewport/pan/zoom/fit methods, `pick`, `subscribe` for the events in `ChartEventMap`, `screenshot`, `start`, `stop`, `dispose`, `resize`, `setTheme`) and the option/result types it uses (`ChartOptions`, `AxisConfig`, `ChartPickItem`, `ChartHoverState`, and friends) | Stable |
| Series handles | `SeriesStore` public methods (`append`, `updateAt`, `updateLast`, `replace`, `clear`, `setVisible`, `sampleAt`, `markDirty`, and so on) | Stable |
| Datasets | `RingBuffer`, `UniformRingBuffer`, `StaticDataset`, `OhlcRingBuffer`, `StaticOhlcDataset`, `ServerSampledDataset`, `HistogramDataset`, `histogram` | Stable |
| Dataset contract | `Dataset`, `AppendableDataset`, `YAppendableDataset`, `UpdatableDataset`, `YUpdatableDataset`, `OhlcDataset`, `SeriesConfig`, `SeriesStyle`, `Viewport`, `TimeRange`, `XRange`, `BufferOverflowStrategy`, `ValuePrecision`, `LODStrategy`, `SeriesMode` | Stable. See [Data semantics](./data-semantics.md). |
| Theming | `DEFAULT_CHART_THEME`, `ChartTheme`, `ResolvedChartTheme`, `ThemeColor`, `RgbaColor` | Stable. New theme tokens may be added; existing token names are kept. |
| Viewport policy | `ViewportPolicy`, `PanIntent`, `ZoomIntent`, `ZoomAxis` | Stable |
| Axes | `AxisScale`, `AxisTickFormat`, `AxisTickFormatter`, `AxisTimeZone`, `BuiltInAxisScale`, `AxisConfig` | Stable |
| WebGL2 availability | `isWebGL2Available`, `WebGL2UnavailableError` | Stable. See [Error handling](./error-handling.md). |

## Experimental

These are the extension points. They are public, documented, and used by the built-in plugins, but they have had fewer outside users.

| Item | Why experimental |
|---|---|
| Plugin authoring contract: `ChartPlugin`, `ChartPluginContext`, `ChartPluginHandle`, `ChartLayoutReservation`, `chart.setLayoutReservation`, `emitSelect` | The context exposes the same chart methods the built-in plugins need today. It may gain, rename, or narrow members as third-party plugins reveal gaps. Built-in plugin options are stable; the interface they are built on is not yet. |
| Custom fast-path dataset interfaces: `AcceleratedDataset`, `RangeMinMaxDataset`, `RangeSampleCopyDataset`, `VisibleSampleCopyDataset`, `VisiblePointCopyDataset`, `MinMaxSegmentCopyDataset`, `XRangeDataset`, `SampleCopyLayout` | Their method signatures are renderer-ready fast paths and have changed before (see the 0.5 `copyMinMaxSegments` change). Implementing only the stable `Dataset` contract avoids this risk. Optional members such as `isGap` and `ordinalOffset` follow the `Dataset` tier. |
| Camera access: `chart.getCamera()` and the `Camera2D` type, `CustomAxisScale`, `AxisRenderTarget`, `AxisControllerAxisOptions` | Direct camera mutation bypasses `ViewportPolicy` and the chart's follow/auto-fit state. Prefer `chart.setViewport`, `pan`, and `zoom`. |
| `blazeplot/plugins/flamegraph` | See the entry point table. |

The same items carry an `@experimental` JSDoc tag in the published declarations, so editors show the tier on hover. `getCamera()` is tagged on both `Chart` and `ChartPluginContext`, and every export of `blazeplot/plugins/flamegraph` is tagged.

Experimental does not mean unsupported: bugs are fixed the same way. It means a minor release may require a code change, and the changelog will say so.

## Internal

These symbols are exported from `blazeplot` so declarations are complete and so a custom backend can be typed. They are not an API for application code.

**Planned for 1.0:** the GPU backend types (`GpuBackend`, `WebGL2Backend`, the `Gpu*` types, `BufferSpec`, `AttributeSpec`, `DrawSpec`, `UniformValue`) will no longer be exported from the `blazeplot` root (tracked in issue #102). `WebGL2UnavailableError` and `isWebGL2Available` stay public.

| Item | Notes |
|---|---|
| `GpuBackend`, `GpuBuffer`, `GpuProgram`, `GpuResource`, `GpuCapabilities`, `BufferSpec`, `DrawSpec`, `AttributeSpec`, `UniformValue` | The renderer's GPU abstraction. It exists to isolate WebGL2 calls and may change whenever the renderer changes. |
| `WebGL2Backend` | The default backend. Construct it only through `Chart`; its constructor throws `WebGL2UnavailableError` when WebGL2 is missing. |
| `ChartOptions.backendFactory`, `ChartBackendFactory`, `ChartBackendFactoryContext` | Advanced hook for supplying a custom backend. A custom backend must implement the current `GpuBackend`, and shaders are written for the built-in renderer, so treat this as experimental-at-best. Not covered by semver promises. |
| `chart.getWebGLContext()` and `ChartPluginContext.getWebGLContext()` | Escape hatch to the raw `WebGL2RenderingContext`. The chart may recreate it after context loss. State you change on it can interfere with rendering. |
| `/** @internal */` members | Stripped from published declarations. If you reach them through casts, expect breakage in patch releases. |
| Generated DOM structure and `blazeplot-*` class names | Styling hooks you pass through `className` options are stable; the markup the chart generates around them is not. The documented ARIA contract in [Accessibility](./accessibility.md) is stable. |
| Bundle chunk names such as `dist/Chart-*.js` | Hashed output files. Import only the documented entry points. |

## Reading the tiers in practice

- If you only use `Chart`, the built-in datasets, built-in plugins, `blazeplot/data`, and `blazeplot/export`, you are on the stable surface.
- If you write a plugin, expect to re-test it on each minor release until the plugin contract is promoted to stable. Pin a version range such as `~0.x.y` or, after 1.0, test against the next minor in CI.
- If you implement a custom `Dataset`, stay on the required `Dataset` methods unless you have measured a need for the fast paths.
- If you need the raw GL context or a custom backend, pin an exact version.

## Promotion

Proposed rule, for the maintainer to confirm: an experimental item becomes stable in a minor release once it has been unchanged for at least two minor releases and covered by unit or browser tests. The promotion is noted in the changelog and this page is updated in the same pull request. An internal item is never promoted silently; it needs a docs change that moves it to a stable or experimental row first.
