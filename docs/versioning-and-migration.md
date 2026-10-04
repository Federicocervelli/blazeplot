# Versioning and migration

BlazePlot follows npm semver. Use this page to decide whether a change is patch/minor/major and to plan upgrades between versions.

## Semver policy

| Release type | Allowed changes | Examples |
|---|---|---|
| Patch | Bug fixes, docs, compatible performance improvements, test/release fixes | Fix picking around gaps, reduce allocations, clarify examples, update benchmark docs. |
| Minor | Additive public APIs or behavior that should not break existing apps | New chart options, new plugins, new subpath exports, extra helper functions. |
| Major | Intentional breaking changes | Removed exports, renamed options without aliases, changed dataset contracts, incompatible plugin lifecycle changes. |

## Stability expectations

- `blazeplot` and the documented subpath exports are intended to stay stable within a major version. [API stability](./stability.md) classifies each export as stable, experimental, or internal.
- Built-in plugin options may grow over time, but existing option names should be preserved when practical.
- Low-level renderer/backend types are internal and the most likely to change before a future backend is added.
- Deprecated names follow the [deprecation process](#deprecation-process) below.
- Generated docs and package export smoke tests should reflect the shipped package, not only source files.
- Errors, console warnings, and invalid-input behavior are documented in [Error handling](./error-handling.md); changing a documented behavior there is a breaking change.

## TypeScript support

BlazePlot ships its own `.d.ts` files; no `@types` package is needed.

- **Minimum supported TypeScript: 5.0.** The published declarations were compiled and checked with `skipLibCheck: false` against a consumer importing every entry point and subpath, under `moduleResolution: "bundler"` and `"node16"`, with TypeScript 5.0.4, 5.4.5, 5.9.3, 6.0.2, and 7.0.2 (checked on 0.5.5). Older compilers are not tested; 4.9 also accepted the declarations under `node16` resolution during that check, but it is outside the support policy.
- `moduleResolution` must understand package `exports` and subpath imports: `bundler`, `node16`, or `nodenext`. The legacy `node`/`node10` setting cannot resolve subpaths such as `blazeplot/plugins/tooltip`.
- The declarations reference DOM types (`HTMLElement`, `WebGL2RenderingContext`), so your `lib` must include `"DOM"`.
- Proposed policy, pending maintainer confirmation: raising the minimum TypeScript version is a minor-release change announced in the changelog, and the new minimum will already be well past its release date.

The minimum is enforced in CI: the `typescript-floor` job installs the packed package into a consumer project and typechecks every entry point with TypeScript 5.0.4 and the latest 5.x under both resolution modes (`bun run test:typescript-floor`).

## Module format and runtime

- **ESM only.** `package.json` declares `"type": "module"` and exposes only an `import` condition. `require("blazeplot")` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`; load it with `import` or `await import("blazeplot")`. CommonJS and UMD builds are not planned.
- **Output target** is modern browsers with WebGL2 (see [Browser support](./browser-support.md)). The library is built with the Vite `esnext` target, so the published JavaScript is not transpiled for older engines; if you need to support one, transpile `node_modules/blazeplot` with your bundler.
- **Bundlers** such as Vite, esbuild, Rollup, and webpack 5 resolve the `exports` map. Import only the documented entry points; deep paths into `dist/` are not exported.
- **Node.js** can import the package for tooling and type checks, but charts only run in a browser DOM with WebGL2.

## Migrating to 1.0

See [Migrating from 0.x to 1.0](./migrating-to-1.0.md) for the breaking changes since 0.5.5 (removed GPU backend exports, typed `emitSelect`, non-finite X handling), the experimental tier, ESM/TypeScript requirements, and a checklist.

## Migrating to 0.5

0.5 removes duplicate and dead APIs so each task has one way to do it. Most upgrades are mechanical renames.

| Before (0.4) | After (0.5) |
|---|---|
| `import … from "blazeplot/core"`, `"blazeplot/interaction"`, `"blazeplot/render"` | `import … from "blazeplot"` (the root entry is tree-shakable) |
| `import { createLinkedCharts } from "blazeplot/linked-core"` | `import { createLinkedCharts } from "blazeplot/linked"` |
| `createLinkedCharts(el, { syncCrosshair: true, syncTooltips: true, … })` | `createLinkedCharts(el, { panelPlugins: (syncGroup) => [crosshairPlugin({ syncGroup }), tooltipPlugin({ syncGroup })], … })` |
| `linkedChartsPlugin()` | Removed (it did nothing) |
| `crosshairPlugin({ group })` | `crosshairPlugin({ syncGroup })` (same name as `tooltipPlugin`) |
| `crosshair.subscribe("move" \| "measure…", cb)`, `onMeasure` | `onMove`, `onMeasureStart`, `onMeasureChange`, `onMeasureEnd` options |
| `selectionPlugin({ onStart, onUpdate, onCommit, onClear })` | `selectionPlugin({ onChange: (event) => { if (event.type === "commit") … } })` |
| `SelectionState.samples`, `samplePhase`, `maxSamplesPerSeries`, `onSeriesSelectionChange` | `exportChartData(chart, { range: selection })` from `blazeplot/data` |
| `interactionsPlugin({ viewportPolicy })` | `new Chart(el, { viewportPolicy })`; `beforePan`/`beforeZoom` now apply to every pan/zoom, including keyboard and API calls |
| `interactionsPlugin({ selectionFill, selectionStroke })` | `theme.selectionFillColor`, `theme.selectionStrokeColor` |
| `chart.setYViewport(axis, v)` | `chart.setViewport(v, axis)` |
| `chart.setSeriesVisible(series, visible)` | `series.setVisible(visible)` (legends update automatically) |
| `chart.resumeLatestXFollow()`, `chart.resumeXFollow()` | `chart.setXFollowPaused(false)` |
| `chart.isFollowingLatestX()`, `chart.isLatestXFollowPaused()` | `chart.getXFollowState()` → `"off" \| "following" \| "paused"` |
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
| `chartDataToJSON(data)`, `chartDataToBlob(data, type)` | `JSON.stringify(data)`, `new Blob([chartDataToCSV(data)])` |
| `resampleSamples` | `binSamples` |
| `histogramDataset(values, options)` | `chart.addHistogram({ values, ...options })` or `new HistogramDataset(histogram(values, options))` |
| `HistogramOptions.thresholds: number` | `binCount` (`thresholds` now takes explicit edges only) |
| `ServerSampledDataset.replacePoints/replaceBuckets`, `sampleKind` | `series.replace({ kind: "points" \| "minmax", … })`, `dataset.kind` |
| `RingBuffer.get(i)` | `getX(i)`/`getY(i)`, or `series.sampleAt(i)` |
| `OhlcRingBuffer.updateLast(…)` | `series.updateLast({ open, high, low, close })` or `dataset.updateAt(i, …)` |
| `UniformRingBufferOptions.blockSize` | Removed (internal tuning) |
| `ReglBackend` | `WebGL2Backend` |
| `MinMaxPyramid`, `DataCursor`, `Renderer`, `ShaderPrograms`, `WebGL2Resources`, `AxisController` value exports | Internal; no replacement needed |
| `MinMaxSegmentCopyDataset.copyMinMaxSegments(viewport, target, max, layout, xOrigin)` | `copyMinMaxSegments(viewport, target, max, xOrigin)`, always writing `[x, minY, maxY]` triples |
| `SeriesDataBounds`, `SelectionBounds` | `Viewport` |
| `RingBufferOverflow` | `BufferOverflowStrategy` |

Behavior changes worth checking:

- Series colors accept any CSS color (`"#3b82f6"`, `"var(--accent)"`) as well as RGBA tuples.
- `lineWidth` now renders: lines, area outlines, OHLC ticks, and wicks are drawn `lineWidth` CSS pixels wide (previously always one device pixel).
- Dense (min/max) lines keep at least `lineWidth` of height, so flat stretches no longer disappear.
- Tooltip and crosshair formatter output is rendered as text, not HTML.
- `ServerSampledDataset` min/max buckets report their `[xStart, xEnd]` interval to picks, tooltips, and `fitToData`.
- Selection bounds respect log, symlog, and reversed axes.

## Upgrade checklist for users

1. Read the changelog for every version between your current version and target version.
2. Check the [API reference](./api-reference.md) for renamed, moved, or newly added exports.
3. Run your chart interaction flows, not just unit tests. Pan, zoom, tooltips, selection, screenshots, and exports can depend on browser behavior.
4. If you use custom datasets, re-check the assumptions in [Data semantics](./data-semantics.md).
5. If you use React, verify that the effect creating `Chart` disposes it on cleanup.
6. If you use subpath imports, run your bundler against the production build so export-map mistakes are caught early.

## Migration-risk checklist

Use this when reviewing a PR that changes public behavior.

| Area | What to verify |
|---|---|
| Package exports | `package.json#exports`, generated declarations, README/API reference, `bun run test:exports`, and the `api/public-api.md` snapshot (`bun run test:api`). |
| Dataset contracts | Sorted X expectations, gap behavior, bounds, picking, export helpers, and accelerated methods. |
| Chart lifecycle | `start()`, `stop()`, `dispose()`, ResizeObserver cleanup, plugin disposers, context restore. |
| Interaction behavior | Wheel/pointer/touch gestures, axis dragging, box zoom, double-click reset, keyboard focus. |
| Visual output | Pixel-visible browser tests for affected chart types and overlays. |
| Bundle size | `bun run test:bundle-size` and aggregate runtime-size notes when chunking changes. |
| Docs | Examples include complete imports, lifecycle cleanup, and regenerated README/API docs when public symbols change. |

## Deprecation process

This is the process for retiring a public API. Which APIs it covers depends on their tier in [API stability](./stability.md): stable APIs always follow it, experimental APIs may skip it with a changelog note, and internal APIs are not covered.

> The warning helper is implemented (internal, not exported). No API is currently deprecated. The minimum removal window in step 7 is still a proposal pending maintainer confirmation.

When replacing a public API:

1. **Add the replacement first**, with tests and docs, in a minor release.
2. **Mark the old API `@deprecated`** in its TSDoc comment, naming the replacement and the release that deprecated it:

   ```ts
   /** @deprecated Since 1.3.0. Use `chart.setViewport(viewport, axis)` instead. Removed in 2.0.0. */
   ```

   The tag shows as a strikethrough in editors and in the generated declarations.
3. **Keep the old API working** with its previous behavior. Prefer an alias that forwards to the new API.
4. **Warn once in development.** When the deprecated API is used, log one `console.warn` per API per page load, in the form `BlazePlot: chart.foo() is deprecated since 1.3.0; use chart.bar() instead. It will be removed in 2.0.0.` Rules:
   - Warn from constructors, option parsing, and one-off calls only. Never warn inside per-frame, per-sample, or per-append code; for those APIs rely on `@deprecated` and the changelog.
   - Production builds skip the warning: the helper checks `process.env.NODE_ENV === "production"`, which consumer bundlers replace statically so the call becomes dead code.
   - Route every warning through the internal helper `warnDeprecated(id, message)` in `src/core/deprecation.ts`. It is not exported from the package. It warns once per `id` for the page lifetime and prefixes the message with `BlazePlot: `. Use a stable id such as `chart.foo`.
5. **Document the move**: add the old-to-new row to the migration table on this page and a "Deprecated" entry in `changelogs/vX.Y.Z.md`.
6. **Test both names** while the alias exists, including that the warning fires once (see `tests/core/deprecation.test.ts`; call `resetDeprecationWarnings()` in `beforeEach` and spy on `console.warn`).
7. **Remove only in a major release**, and only after the API has been deprecated for at least one full minor release (proposed minimum: 6 months or two minors, whichever is longer). An undocumented or experimental API, or an API whose retention creates a security or correctness risk, can be removed sooner with a changelog note.

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

Chart rendering and ingestion code should avoid per-frame deprecation work.

## For maintainers changing public APIs

1. Prefer additive options and subpath exports.
2. Keep old names as aliases when practical.
3. Document behavior changes in `changelogs/vX.Y.Z.md`.
4. Regenerate generated docs with `bun run docs:readme`, and update the public API snapshot with `bun run build && bun run test:api -- --update`. The snapshot diff in the PR is the reviewable record of the API change.
5. Add unit, visual, interaction, or package export coverage for migration-sensitive behavior.
6. Run the relevant checks from [Local development](./internal/local-development.md) before opening the PR.

Release commands and benchmark notes live in [Release and benchmark notes](./release-and-benchmarks.md). Release PR steps live in [Internal release checklist](./internal/release-checklist.md).
