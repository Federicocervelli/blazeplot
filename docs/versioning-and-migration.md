# Versioning and migration

BlazePlot follows npm semver.

## Semver policy

| Release type | Allowed changes | Examples |
|---|---|---|
| Patch | Bug fixes, docs, compatible performance improvements, test/release fixes | Fix picking around gaps, reduce allocations, clarify examples, update benchmark docs. |
| Minor | Additive public APIs or behavior that should not break existing apps | New chart options, new plugins, new subpath exports, extra helper functions. |
| Major | Intentional breaking changes | Removed exports, renamed options without aliases, changed dataset contracts, incompatible plugin lifecycle changes. |

## Stability expectations

- `blazeplot` and the documented subpath exports are intended to stay stable within a major version. [API stability](./stability.md) classifies each export as stable, experimental, or internal.
- Built-in plugin options may grow, but existing option names should be preserved when practical.
- Low-level renderer/backend types are internal and the most likely to change before a future backend is added.
- Deprecated names follow the [deprecation process](#deprecation-process) below.
- Generated docs and package export smoke tests should reflect the shipped package.
- Errors, console warnings, and invalid-input behavior are documented in [Error handling](./error-handling.md); changing a documented behavior there is a breaking change.

## TypeScript support

BlazePlot ships its own `.d.ts` files, so you need no `@types` package.

- **Minimum supported TypeScript: 5.0.** The published declarations were compiled and checked with `skipLibCheck: false` against a consumer importing every entry point and subpath, under `moduleResolution: "bundler"` and `"node16"`, with TypeScript 5.0.4, 5.4.5, 5.9.3, 6.0.2, and 7.0.2 (checked on 0.5.5). Older compilers are not tested; 4.9 also accepted the declarations under `node16` resolution during that check, but it is outside the support policy.
- Use `moduleResolution` `bundler`, `node16`, or `nodenext`, which read package `exports`. The legacy `node`/`node10` setting also resolves every subpath, through `typesVersions` in `package.json`, and is checked in CI.
- The declarations reference DOM types (`HTMLElement`, `WebGL2RenderingContext`), so your `lib` must include `"DOM"`.
- The minimum TypeScript version is raised only in a minor release (never in a patch) and announced in the changelog. The new minimum will already be well past its release date.

CI enforces the minimum: the `typescript-floor` job installs the packed package into a consumer project and typechecks every entry point with TypeScript 5.0.4 and the latest 5.x under all three resolution modes (`bundler`, `node16`, legacy `node10`) (`bun run test:typescript-floor`).

## Module format and runtime

- **ESM only.** `package.json` declares `"type": "module"`; every export has `import` and `default` conditions pointing at the ES module build. `import` and `await import("blazeplot")` work everywhere, and `require("blazeplot")` works on Node.js 22.12+ (which can `require()` ES modules) and in Jest/Vitest resolvers that fall back to `default`. There is no CommonJS or UMD build and none is planned.
- **Output target:** modern browsers with WebGL2 (see [Browser support](./browser-support.md)). The library is built with the Vite `esnext` target, so the published JavaScript is not transpiled for older engines. To support one, transpile `node_modules/blazeplot` with your bundler.
- **Bundlers** such as Vite, esbuild, Rollup, and webpack 5 resolve the `exports` map. Import only the documented entry points; deep paths into `dist/` are not exported.
- **Node.js** can import the package for tooling and type checks, but charts run only in a browser DOM with WebGL2.

## Migrating to 1.0

See [Migrating from 0.x to 1.0](./migrating-to-1.0.md) for the breaking changes since 0.5.5 (removed GPU backend exports, typed `select` events, the grouped and now stable plugin context, one X rule for every dataset, the export and follow-API renames, `addHistogram` removal, keyboard handling moved into `interactionsPlugin`, mismatched array lengths throwing, new gesture and rendering defaults), the experimental tier, ESM/TypeScript requirements, and a checklist.

## Migrating to 0.5

0.5 removed duplicate and dead APIs. Most upgrades are mechanical renames.

| Before (0.4) | After (0.5) |
|---|---|
| `import … from "blazeplot/core"`, `"blazeplot/interaction"`, `"blazeplot/render"` | `import … from "blazeplot"` (the root entry is tree-shakable) |
| `import { createLinkedCharts } from "blazeplot/linked-core"` | `import { createLinkedCharts } from "blazeplot/linked"` |
| `createLinkedCharts(el, { syncCrosshair: true, syncTooltips: true, … })` | `createLinkedCharts(el, { panelPlugins: (syncGroup) => [crosshairPlugin({ syncGroup }), tooltipPlugin({ syncGroup })], … })` |
| `linkedChartsPlugin()` | Removed (it did nothing) |
| `crosshairPlugin({ group })` | `crosshairPlugin({ syncGroup })` (same name as `tooltipPlugin`) |
| `crosshair.subscribe("move" \| "measure…", cb)`, `onMeasure` | `onMove`, `onMeasureStart`, `onMeasureChange`, `onMeasureEnd` options |
| `selectionPlugin({ onStart, onUpdate, onCommit, onClear })` | `selectionPlugin({ onChange: (event) => { if (event.type === "commit") … } })` |
| `SelectionState.samples`, `samplePhase`, `maxSamplesPerSeries`, `onSeriesSelectionChange` | `exportChartData(chart, { range: selection })` from `blazeplot/export` (`blazeplot/data` before 1.0) |
| `interactionsPlugin({ viewportPolicy })` | `new Chart(el, { viewportPolicy })`; `beforePan`/`beforeZoom` now apply to every pan/zoom, including keyboard and API calls |
| `interactionsPlugin({ selectionFill, selectionStroke })` | `theme.selectionFillColor`, `theme.selectionStrokeColor` |
| `chart.setYViewport(axis, v)` | `chart.setViewport(v, axis)` |
| `chart.setSeriesVisible(series, visible)` | `series.setVisible(visible)` (legends update automatically) |
| `chart.resumeLatestXFollow()`, `chart.resumeXFollow()` | `chart.setFollowXPaused(false)` |
| `chart.isFollowingLatestX()`, `chart.isLatestXFollowPaused()` | `chart.getFollowXState()` → `"off" \| "following" \| "paused"` |
| `chart.start({ renderLoop })` | `new Chart(el, { renderLoop })` |
| `chart.subscribe("render", (chart) => …)` | `chart.subscribe("render", () => …)` |
| `Chart.isWebGL2Available()` | `isWebGL2Available()` |
| `ChartOptions.gridStyle` | `theme.gridColor` |
| `{ enabled: false }` in `followX`, `autoFitY`, `accessibility`, `keyboard` | Pass `false` |
| `visibleOnly: false` in `fitToData`, `autoFitY`, `followX` | `includeHidden: true` |
| `TextOverlayConfig.visible`, `AxisTitleConfig` | Omit the title; use `TextOverlayConfig` |
| `chart.screenshot({ preset, transparent })`, `CHART_SCREENSHOT_PRESETS` | `chart.screenshot({ background: "#fff" })`; `background: null` for transparent |
| `copyBlobToClipboard(blob)` | `copyChartScreenshotToClipboard(chart)` |
| `ChartFrameStats.batchedDrawCalls` | Removed (it was always 0) |
| `series.append(x, y)`, `series.appendY(y)`, `series.appendOhlc(…)`, `series.updateLastOhlc(…)` | `series.append({ x, y })`, `series.append({ y })`, `series.append({ x, open, high, low, close })`, `series.updateLast({ open, high, low, close })` |
| `exportVisibleChartData`, `exportSelectedChartData`, `exportAllChartData` | `exportChartData(chart, { range: "visible" \| selection \| "all" })` |
| `visibleOnly: false` in data export options | `includeHidden: true` |
| `chartDataToJSON(data)`, `chartDataToBlob(data, type)` | `JSON.stringify(data)`, `new Blob([chartDataToCsv(data)])` |
| `resampleSamples` | `binSamples` |
| `histogramDataset(values, options)` | `chart.addBar({ dataset: HistogramDataset.from(values, options) })` or `new HistogramDataset(histogramBins(values, options))` |
| `HistogramOptions.thresholds: number` | `binCount` (`thresholds` now takes explicit edges only) |
| `ServerSampledDataset.replacePoints/replaceBuckets`, `sampleKind` | `series.replace({ kind: "points" \| "minmax", … })`, `dataset.kind` |
| `RingBuffer.get(i)` | `getX(i)`/`getY(i)`, or `series.sampleAt(i)` |
| `OhlcRingBuffer.updateLast(…)` | `series.updateLast({ open, high, low, close })` or `dataset.updateAt(i, …)` |
| `UniformRingBufferOptions.blockSize` | Removed (internal tuning) |
| `ReglBackend` | Removed. GPU backends are internal in 1.0 (not exported from `blazeplot`); use `isWebGL2Available()`, `WebGL2UnavailableError`, and the `renderer` option |
| `MinMaxPyramid`, `DataCursor`, `Renderer`, `ShaderPrograms`, `WebGL2Resources`, `AxisController` value exports | Internal; no replacement needed |
| `MinMaxSegmentCopyDataset.copyMinMaxSegments(viewport, target, max, layout, xOrigin)` | `copyMinMaxSegments(viewport, target, max, xOrigin)`, always writing `[x, minY, maxY]` triples |
| `SeriesDataBounds`, `SelectionBounds` | `Viewport` |
| `RingBufferOverflow` | `BufferOverflowStrategy` |

Behavior changes to check:

- Series colors accept any CSS color (`"#3b82f6"`, `"var(--accent)"`) as well as RGBA tuples.
- `lineWidth` now renders: lines, area outlines, OHLC ticks, and wicks are drawn `lineWidth` CSS pixels wide (previously always one device pixel).
- Dense (min/max) lines keep at least `lineWidth` of height, so flat stretches no longer disappear.
- Tooltip and crosshair formatter output is rendered as text, not HTML.
- `ServerSampledDataset` min/max buckets report their `[xStart, xEnd]` interval to picks, tooltips, and `fitToData`.
- Selection bounds respect log, symlog, and reversed axes.

## Upgrade checklist for users

1. Read the changelog for every version between your current version and target version.
2. Check the [API reference](./api-reference.md) for renamed, moved, or newly added exports.
3. Run your chart interaction flows, not just unit tests: pan, zoom, tooltips, selection, screenshots, and exports depend on browser behavior.
4. If you use custom datasets, re-check the assumptions in [Data semantics](./data-semantics.md).
5. If you use React, verify that the effect creating `Chart` disposes it on cleanup.
6. If you use subpath imports, run your bundler against the production build to catch export-map mistakes.
7. If you use plugins, create one instance per chart, and re-check wheel and touch behavior on scrolling pages (see the cooperative-gesture options in [Troubleshooting](./troubleshooting.md#page-scrolling-and-chart-gestures)).
8. If you filter `viewportchange` events, use the `source` field to tell user gestures from follow, fit, linked, and API updates.

## Migration-risk checklist

Use this table when reviewing a PR that changes public behavior.

| Area | What to verify |
|---|---|
| Package exports | `package.json#exports`, generated declarations, README/API reference, `bun run test:exports`, and the `api/public-api.md` snapshot (`bun run test:api`). |
| Dataset contracts | Sorted X expectations, gap behavior, bounds, picking, export helpers, and accelerated methods. |
| Chart lifecycle | `start()`, `stop()`, `dispose()`, ResizeObserver cleanup, plugin disposers, context restore. |
| Interaction behavior | Wheel/pointer/touch gestures, axis dragging, box zoom, double-click reset, keyboard focus. |
| Visual output | Pixel-visible browser tests for affected chart types and overlays. `bun run test:visual` renders every case with WebGL2, the shared context, Canvas 2D, and the WebGL-disabled fallback, so a rendering change has to look right on all of them. |
| Bundle size | `bun run test:bundle-size` and aggregate runtime-size notes when chunking changes. |
| Docs | Examples include complete imports, lifecycle cleanup, and regenerated README/API docs when public symbols change. |

## Deprecation process

This process retires a public API. Coverage depends on the tier in [API stability](./stability.md): stable APIs always follow it, experimental APIs may skip it with a changelog note, and internal APIs are not covered.

> The warning helper is implemented (internal, not exported). No API is currently deprecated. The minimum removal window is in step 7.

When replacing a public API:

1. **Add the replacement first**, with tests and docs, in a minor release.
2. **Mark the old API `@deprecated`** in its TSDoc comment, naming the replacement and the release that deprecated it:

   ```ts
   /** @deprecated Since 1.3.0. Use `chart.setViewport(viewport, axis)` instead. Removed in 2.0.0. */
   ```

   Editors show the tag as a strikethrough.
3. **Keep the old API working** with its previous behavior. Prefer an alias that forwards to the new API.
4. **Warn once in development.** When the deprecated API is used, log one `console.warn` per API per page load, in the form `BlazePlot: chart.foo() is deprecated since 1.3.0; use chart.bar() instead. It will be removed in 2.0.0.` Rules:
   - Warn from constructors, option parsing, and one-off calls only. Never warn inside per-frame, per-sample, or per-append code; for those APIs rely on `@deprecated` and the changelog.
   - Production builds skip the warning: the helper checks `process.env.NODE_ENV === "production"`, which consumer bundlers replace statically so the call becomes dead code.
   - Route every warning through the internal helper `warnDeprecated(id, message)` in `src/core/deprecation.ts`. It is not exported from the package. It warns once per `id` for the page lifetime and prefixes the message with `BlazePlot: `. Use a stable id such as `chart.foo`.
5. **Document the move**: add the old-to-new row to the migration table on this page and a "Deprecated" entry in `changelogs/vX.Y.Z.md`.
6. **Test both names** while the alias exists, including that the warning fires once (see `tests/core/deprecation.test.ts`; call `resetDeprecationWarnings()` in `beforeEach` and spy on `console.warn`).
7. **Remove only in a major release**, and only after the API has been deprecated for at least one minor release and at least 6 months, whichever is longer. An undocumented or experimental API, or an API whose retention creates a security or correctness risk, can be removed sooner with a changelog note.

Maintainer usage, together with the `@deprecated` tag:

<!-- snippet: skip maintainer-only class member fragment that imports an internal module, not public API -->
```ts
import { warnDeprecated } from "../core/deprecation.js";

/** @deprecated Since 1.3.0. Use `chart.bar()` instead. Removed in 2.0.0. */
foo(): void {
  warnDeprecated("chart.foo", "chart.foo() is deprecated since 1.3.0; use chart.bar() instead. It will be removed in 2.0.0.");
  this.bar();
}
```

## For maintainers changing public APIs

1. Prefer additive options and subpath exports.
2. Keep old names as aliases when practical.
3. Document behavior changes in `changelogs/vX.Y.Z.md`.
4. Regenerate generated docs with `bun run docs:readme`, and update the public API snapshot with `bun run build && bun run test:api -- --update`. The snapshot diff in the PR is the reviewable record of the API change.
5. Add unit, visual, interaction, or package export coverage for migration-sensitive behavior.
6. Run the relevant checks from [Local development](./internal/local-development.md) before opening the PR.

Release commands and benchmark notes live in [Release and benchmark notes](./release-and-benchmarks.md). Release PR steps live in [Internal release checklist](./internal/release-checklist.md).
