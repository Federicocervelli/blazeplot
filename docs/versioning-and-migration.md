# Versioning and migration

BlazePlot follows npm semver. Use this page to decide whether a change is patch/minor/major and to plan upgrades between versions.

## Semver policy

| Release type | Allowed changes | Examples |
|---|---|---|
| Patch | Bug fixes, docs, compatible performance improvements, test/release fixes | Fix picking around gaps, reduce allocations, clarify examples, update benchmark docs. |
| Minor | Additive public APIs or behavior that should not break existing apps | New chart options, new plugins, new subpath exports, extra helper functions. |
| Major | Intentional breaking changes | Removed exports, renamed options without aliases, changed dataset contracts, incompatible plugin lifecycle changes. |

## Stability expectations

- `blazeplot` and the documented subpath exports are intended to stay stable within a major version.
- Built-in plugin options may grow over time, but existing option names should be preserved when practical.
- Low-level renderer/backend types are the most likely to change before a future backend is added.
- Deprecated names may stay as aliases for at least one minor version when that does not create maintenance risk.
- Generated docs and package export smoke tests should reflect the shipped package, not only source files.

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
| Package exports | `package.json#exports`, generated declarations, README/API reference, and `bun run test:exports`. |
| Dataset contracts | Sorted X expectations, gap behavior, bounds, picking, export helpers, and accelerated methods. |
| Chart lifecycle | `start()`, `stop()`, `dispose()`, ResizeObserver cleanup, plugin disposers, context restore. |
| Interaction behavior | Wheel/pointer/touch gestures, axis dragging, box zoom, double-click reset, keyboard focus. |
| Visual output | Pixel-visible browser tests for affected chart types and overlays. |
| Bundle size | `bun run test:bundle-size` and aggregate runtime-size notes when chunking changes. |
| Docs | Examples include complete imports, lifecycle cleanup, and regenerated README/API docs when public symbols change. |

## Deprecation guidance

When replacing a public API:

1. Add the new API first.
2. Keep the old name as an alias when practical.
3. Document the replacement in the changelog and affected guide page.
4. Add test coverage for both old and new names while the alias exists.
5. Remove the old name only in a major release, or when the old name was never documented and keeping it creates real risk.

Prefer warnings in docs and release notes over runtime console warnings in hot paths. Chart rendering and ingestion code should avoid per-frame deprecation work.

## For maintainers changing public APIs

1. Prefer additive options and subpath exports.
2. Keep old names as aliases when practical.
3. Document behavior changes in `changelogs/vX.Y.Z.md`.
4. Regenerate generated docs with `bun run docs:readme`.
5. Add unit, visual, interaction, or package export coverage for migration-sensitive behavior.
6. Run the relevant checks from [Local development](./internal/local-development.md) before opening the PR.

Release commands and benchmark notes live in [Release and benchmark notes](./release-and-benchmarks.md). Release PR steps live in [Internal release checklist](./internal/release-checklist.md).
