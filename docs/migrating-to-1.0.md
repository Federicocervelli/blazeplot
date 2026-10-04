# Migrating from 0.x to 1.0

This guide is for applications and plugins written against BlazePlot 0.x. It lists every breaking change between 0.5.5 and 1.0, with before and after code, and a checklist at the end.

The list was produced by comparing the published declarations of 0.5.5 with the 1.0 declarations (the `api/public-api.md` snapshot), plus the 1.0 changes that alter runtime behavior. If you are on 0.4 or older, apply the [0.5 migration table](./versioning-and-migration.md#migrating-to-05) first (most upgrades there are mechanical renames), then come back here. Release candidates are published to the npm `rc` dist-tag until 1.0 ships.

Most applications need no code changes beyond the checklist: the 1.0 surface is the 0.5.5 surface minus GPU internals and two flame graph helpers, with chart data export moved to `blazeplot/export`, one typing fix, and one data-ingestion rule.

## What did not change

- The `Chart` constructor, `addLine`/`addArea`/`addScatter`/`addBar`/`addOhlc`/`addCandlestick`/`addHistogram`, datasets, and every built-in plugin option are unchanged.
- Entry points and subpaths are the same: `blazeplot`, `blazeplot/linked`, `blazeplot/data`, `blazeplot/export`, and `blazeplot/plugins/*`. What lives in `blazeplot/data` and `blazeplot/export` changed (see change 6).
- The package was already ESM only and already required WebGL2; 1.0 now states both as policy.

## Breaking changes

### 1. GPU backend types are no longer exported

The root entry stopped exporting the renderer plumbing: `GpuBackend`, `WebGL2Backend`, `GpuBuffer`, `GpuProgram`, `GpuCapabilities`, `GpuResource`, `BufferSpec`, `AttributeSpec`, `DrawSpec`, and `UniformValue`. `ChartOptions.backendFactory` and its types, `ChartBackendFactory` and `ChartBackendFactoryContext`, are now `@internal` and stripped from the published declarations.

Before (0.5):

<!-- snippet: skip intentionally old 0.5 API; these exports no longer exist -->
```ts
import { Chart, WebGL2Backend, type ChartBackendFactory } from "blazeplot";

const backendFactory: ChartBackendFactory = ({ canvas }) => new WebGL2Backend(canvas);
const chart = new Chart(element, { backendFactory });
```

After (1.0): remove the option. The chart creates its own WebGL2 backend. Use `isWebGL2Available()` and `WebGL2UnavailableError`, which stay public, to handle unsupported browsers.

```ts
import { Chart, WebGL2UnavailableError, isWebGL2Available } from "blazeplot";

if (isWebGL2Available()) {
  try {
    const chart = new Chart(element);
    chart.start();
  } catch (error) {
    if (!(error instanceof WebGL2UnavailableError)) throw error;
    // Show a fallback.
  }
}
```

Custom backends are not supported, and `backendFactory` is not covered by semver. If you only used it for test fakes, keep doing so against the internal option at your own risk; otherwise render in a real browser (see [Troubleshooting](./troubleshooting.md)).

### 2. `emitSelect` is typed, and `ChartSelectEvent` is no longer generic

`emitSelect(selection: unknown)` became `emitSelect(selection: SelectionState | null)`, on both `Chart` and `ChartPluginContext`. `ChartSelectEvent<T = unknown>` became a plain `ChartSelectEvent` whose `selection` is `SelectionState | null` (`null` means the selection was cleared). Every `select` subscriber therefore sees a typed payload without a cast.

Before (0.5):

<!-- snippet: skip intentionally old 0.5 API; ChartSelectEvent is no longer generic -->
```ts
import type { ChartSelectEvent } from "blazeplot";

type MySelection = { from: number; to: number };

chart.subscribe("select", (event: ChartSelectEvent<MySelection>) => {
  console.log(event.selection.from);
});
chart.emitSelect({ from: 1, to: 2 });
```

After (1.0): emit and read `SelectionState`. If you used `emitSelect` to carry your own payload, keep that payload in your own state or event emitter instead.

```ts
import type { SelectionState } from "blazeplot/plugins/selection";

const unsubscribe = chart.subscribe("select", ({ selection }) => {
  if (selection === null) return; // cleared
  console.log(selection.bounds.xMin, selection.bounds.xMax);
});

declare const current: SelectionState | null;
chart.emitSelect(current);
unsubscribe();
```

Code that only subscribed to `select` and let `event.selection` be inferred needs no change except handling `null`. Code that wrote `ChartSelectEvent<Something>` fails with "Type 'ChartSelectEvent' is not generic"; drop the type argument.

### 3. Non-finite X samples are skipped with a warning

`RingBuffer` now skips any sample whose X is `NaN`, `Infinity`, or `-Infinity`, instead of storing it. One `console.warn` is logged per buffer. Skipped samples do not count toward capacity or the `overflow` strategy. This applies to `push` and to `append` (the finite samples in the same call are still stored). A non-finite X given to `UniformRingBuffer` is ignored as a seed: the Y sample is kept and X continues from the current cursor. See [Data semantics](./data-semantics.md) and [Error handling](./error-handling.md).

A stored non-finite X corrupted binary search, level-of-detail extraction, picking, and exports, so this turns silent breakage into a skipped sample. It matters if you relied on `length` growing for every pushed sample, or if you encoded a gap with an `x` of `NaN`. Gaps belong in Y.

Before (0.5): a `NaN` X was stored and broke later queries.

<!-- snippet: skip intentionally old 0.5 behavior; shows data that the 1.0 buffer rejects -->
```ts
buffer.push(Number.NaN, 1); // stored, later queries unreliable
```

After (1.0): sanitize upstream, and mark gaps with a non-finite Y at a valid X.

```ts
import { RingBuffer } from "blazeplot";

const buffer = new RingBuffer(10_000);

function onSample(timeMs: number, value: number | null): void {
  if (!Number.isFinite(timeMs)) return; // would be skipped with a warning
  buffer.push(timeMs, value ?? Number.NaN); // NaN Y = gap
}
```

`OhlcRingBuffer` and `StaticDataset` still store non-finite X as given. Keep X finite and sorted for them.

### 4. Plugin and fast-path interfaces are experimental

Nothing was removed here, but the tier changed. These are now tagged `@experimental` in the declarations and may change in a minor release (the changelog will say so):

- The plugin contract: `ChartPlugin`, `ChartPluginContext`, `ChartPluginHandle`, `ChartLayoutReservation`, and the `setLayoutReservation`, `emitSelect`, `getWebGLContext`, `canvas`, and `*Element` members.
- The custom fast-path dataset interfaces: `AcceleratedDataset`, `RangeMinMaxDataset`, `RangeSampleCopyDataset`, `VisibleSampleCopyDataset`, `VisiblePointCopyDataset`, `MinMaxSegmentCopyDataset`, `XRangeDataset`, `SampleCopyLayout`.
- Camera access (`getCamera()`, `Camera2D`) and every export of `blazeplot/plugins/flamegraph`.

Action: if you ship a custom plugin or implement a fast-path dataset interface, pin a compatible 1.x range, read the changelog on minor upgrades, and prefer the stable `Dataset` contract where possible. Built-in plugin options and the core API are stable. See [API stability](./stability.md#experimental).

### 5. Newly exported helper types

These types appeared in public signatures but were not exported in 0.5.5. They are now exported, so you can name them; this is additive.

| Type | Entry |
|---|---|
| `MinMaxY`, `StaticDatasetData` | `blazeplot` |
| `ExportableChart` | `blazeplot/export` |

### 6. Chart data export moved from `blazeplot/data` to `blazeplot/export`

`exportChartData`, `chartDataToCSV`, and their types (`ExportableChart`, `ChartDataExport`, `ChartDataExportOptions`, `ChartDataCsvOptions`, `ChartDataSeries`, `ChartDataSample`, `ChartDataSource`) moved to `blazeplot/export`, next to the screenshot download and clipboard helpers. `blazeplot/data` now holds only pure, chart-agnostic transforms: `binSamples`, `rollingMean`, and their types (`XYSample`, `SampleReducer`, `ResampleX`, `ResampleOptions`, `BinnedSample`, `RollingMeanSample`). There is no re-export: importing the moved names from `blazeplot/data` fails with "Module has no exported member". Behavior is unchanged.

Before (0.5):

<!-- snippet: skip intentionally old 0.5 import path; blazeplot/data no longer exports chart data export -->
```ts
import { binSamples, chartDataToCSV, exportChartData, type ChartDataExport } from "blazeplot/data";
```

After (1.0):

```ts
import { Chart } from "blazeplot";
import { binSamples } from "blazeplot/data";
import { chartDataToCSV, downloadBlob, exportChartData, type ChartDataExport } from "blazeplot/export";

const chart = new Chart(element);
const visible: ChartDataExport = exportChartData(chart, { range: "visible" });
downloadBlob(new Blob([chartDataToCSV(visible)], { type: "text/csv" }), "visible.csv");
const binned = binSamples(visible.series[0]?.samples ?? [], 1_000);
console.log(binned.length);
chart.dispose();
```

### 7. `buildFlameGraphModel` and `pickFrame` are no longer exported

`blazeplot/plugins/flamegraph` no longer exports `buildFlameGraphModel` or `pickFrame`; both are now internal. The plugin already builds and picks for you. `FlameGraphModel`, `FlameGraphRenderableFrame`, and `FlameGraphLevelIndex` stay exported because `setModel`, `FlameGraphPick`, and `tooltipFormatter` use them, and `parseFoldedStacks` and `buildStatusChartModel` stay public.

Before (0.5):

<!-- snippet: skip intentionally old 0.5 API; buildFlameGraphModel and pickFrame are no longer exported -->
```ts
import { buildFlameGraphModel, flameGraphPlugin, pickFrame } from "blazeplot/plugins/flamegraph";

const model = buildFlameGraphModel(stacks, { flameChart: true });
const flame = flameGraphPlugin({ model });
const frame = pickFrame(model, dataX, dataY);
```

After (1.0): pass the stacks and build options to the plugin, replace them with `setFoldedStacks`, and pick with `plugin.pick(clientX, clientY)`.

```ts
import { Chart } from "blazeplot";
import { flameGraphPlugin } from "blazeplot/plugins/flamegraph";

const stacks = [
  { stack: ["root", "parse"], value: 28 },
  { stack: ["root", "render"], value: 16 },
];
const flame = flameGraphPlugin({ foldedStacks: stacks, build: { flameChart: true } });
const chart = new Chart(element, { axes: false, grid: false, plugins: [flame] });

flame.setFoldedStacks(stacks, { flameChart: true });
element.addEventListener("click", (event) => {
  console.log(flame.pick(event.clientX, event.clientY)?.frame.name);
});
chart.dispose();
```

## Platform requirements

### ESM only

The package declares `"type": "module"` and exposes only an `import` condition. `require("blazeplot")` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. There is no CommonJS or UMD build, and none is planned.

Before:

<!-- snippet: skip intentionally unsupported CommonJS usage; shown as the thing to migrate away from -->
```ts
const { Chart } = require("blazeplot");
```

After:

```ts
import { Chart } from "blazeplot";

async function load() {
  const { Chart: LazyChart } = await import("blazeplot");
  return LazyChart;
}

export { Chart, load };
```

In a CommonJS project, use dynamic `import()` or move the chart code into an ES module.

### TypeScript 5.0 or newer

The declarations are checked against TypeScript 5.0 and newer. Your `moduleResolution` must understand package `exports` (`bundler`, `node16`, or `nodenext`); the legacy `node`/`node10` setting cannot resolve subpaths such as `blazeplot/plugins/tooltip`. Include `"DOM"` in `lib`. Details: [TypeScript support](./versioning-and-migration.md#typescript-support).

```json
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"]
  }
}
```

## Renames and removals since 0.1 that still matter

These landed before 1.0 and are covered in the [0.5 migration table](./versioning-and-migration.md#migrating-to-05) and the changelogs. The ones that most often break an upgrade from an older 0.x:

| Since | Before | After |
|---|---|---|
| 0.4.0 | `createChart(...)`, `CreateChart*` types | `new Chart(...)`, then `addLine`/`addSeries`, `fitToData()`, `start()` |
| 0.4.0 | `blazeplot/react`, `BlazeChart` | Create `Chart` in an effect and dispose it on cleanup |
| 0.5.0 | `blazeplot/core`, `blazeplot/interaction`, `blazeplot/render` | `blazeplot` |
| 0.5.0 | `blazeplot/linked-core` | `blazeplot/linked` |
| 0.5.0 | `series.append(x, y)`, `appendY`, `appendOhlc`, `updateLastOhlc` | `series.append({ x, y })`, `append({ y })`, `append({ x, open, high, low, close })`, `updateLast({ ... })` |
| 0.5.0 | `chart.setYViewport(axis, v)` | `chart.setViewport(v, axis)` |
| 0.5.0 | `exportVisibleChartData`, `exportSelectedChartData`, `exportAllChartData` | `exportChartData(chart, { range })` |
| 0.5.0 | `selectionPlugin({ onStart, onUpdate, onCommit, onClear })` | `selectionPlugin({ onChange })` |
| 0.5.0 | `ReglBackend` | `WebGL2Backend` (now internal; see change 1) |

The 0.5 renames in this table are the only deprecation path: they were removed in 0.5 without aliases, and 1.0 does not carry any deprecated names. No API is deprecated at 1.0; the [deprecation process](./versioning-and-migration.md#deprecation-process) applies from here on.

A minimal "after" for the most common one, the append signature:

```ts
series.append({ x: Date.now(), y: 1 });
series.append({ y: 2 }); // fixed-rate series with xStep
```

## Migration checklist

1. Upgrade to 0.5.5 first if you are on an older 0.x, and apply the [0.5 table](./versioning-and-migration.md#migrating-to-05).
2. Confirm your tooling: ES module loading (no `require`), TypeScript 5.0 or newer, `moduleResolution` of `bundler`/`node16`/`nodenext`, `lib` including `DOM`.
3. Search for `WebGL2Backend`, `GpuBackend`, `backendFactory`, `DrawSpec`, `BufferSpec`, `AttributeSpec`, `UniformValue`, `GpuBuffer`, `GpuProgram`, `GpuCapabilities`, `GpuResource`, `ChartBackendFactory`. Remove them; use `isWebGL2Available()` and `WebGL2UnavailableError` for support checks.
4. Search for `ChartSelectEvent<`, `emitSelect(`, and `subscribe("select"`. Drop the type argument, emit `SelectionState | null`, and handle `selection === null`.
5. Audit data feeds into `RingBuffer` and `UniformRingBuffer` for non-finite X (clock glitches, parse failures). Sanitize upstream and expect one console warning per buffer if any slip through. Represent gaps as non-finite Y.
6. Search for imports of `exportChartData`, `chartDataToCSV`, `ExportableChart`, and `ChartData*` types from `blazeplot/data` and import them from `blazeplot/export` instead. Keep `binSamples` and `rollingMean` on `blazeplot/data`.
7. Search for `buildFlameGraphModel` and `pickFrame`. Pass `foldedStacks` and `build` to `flameGraphPlugin()` (or call `setFoldedStacks`), and use `plugin.pick(clientX, clientY)` for hit testing.
8. If you write custom plugins or custom fast-path datasets, note they are experimental: pin a 1.x range and read each minor changelog.
9. Run `tsc --noEmit`, then exercise pan, zoom, tooltips, selection, screenshots, and exports in a real browser, as in the [upgrade checklist](./versioning-and-migration.md#upgrade-checklist-for-users).
10. Skim the [API reference](./api-reference.md) and [API stability](./stability.md) for anything your app imports.
