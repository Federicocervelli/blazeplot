# Migrating from 0.x to 1.0

This guide is for applications and plugins written against BlazePlot 0.x. It lists every breaking change between 0.5.5 and 1.0, with before and after code, and a checklist at the end.

The list was produced by comparing the published declarations of 0.5.5 with the 1.0 declarations (the `api/public-api.md` snapshot), plus the 1.0 changes that alter runtime behavior. If you are on 0.4 or older, apply the [0.5 migration table](./versioning-and-migration.md#migrating-to-05) first (most upgrades there are mechanical renames), then come back here. Release candidates are published to the npm `rc` dist-tag until 1.0 ships.

Most applications need no code changes beyond the checklist: the 1.0 surface is the 0.5.5 surface minus GPU internals and two flame graph helpers, with chart data export moved to `blazeplot/export`, one typing fix, one data-ingestion rule (X must be finite and non-decreasing; see change 3), a reshaped (now stable) plugin contract that only custom plugin authors touch, accessibility semantics on the chart root (`role="figure"`, a generated description, focus rings, and new keyboard paths; see change 9), and a final naming pass that renames a few methods, types, and options and removes the raw camera, GL, and element getters from `Chart` (change 10).

## What did not change

- The `Chart` constructor, `addLine`/`addArea`/`addScatter`/`addBar`/`addOhlc`/`addCandlestick`, dataset classes, and every built-in plugin option keep their signatures, except that the custom `render`/`renderHighlight` callbacks of the legend, tooltip, and crosshair plugins now receive the plugin context instead of the `Chart` (see change 8), and the renames in change 10. Datasets gained optional validation options (change 3).
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

### 2. `emitSelect` is removed, and `ChartSelectEvent` is no longer generic

`chart.emitSelect(selection: unknown)` is gone from both `Chart` and the plugin context. `select` is now a typed plugin event: plugins emit it with `ctx.events.emit("select", { selection })` (see change 8), and apps keep receiving it through `chart.subscribe("select", ...)`. `ChartSelectEvent<T = unknown>` became a plain `ChartSelectEvent` whose `selection` is `SelectionState | null` (`null` means the selection was cleared). Every `select` subscriber therefore sees a typed payload without a cast.

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

After (1.0): read `SelectionState`, and emit it from a plugin. If you used `emitSelect` to carry your own payload, declare your own typed plugin event instead (see [Plugin events](./plugin-authoring.md#plugin-events)).

```ts
import { Chart, type ChartPlugin } from "blazeplot";
import type { SelectionState } from "blazeplot/plugins/selection";

// A custom selection UI emits through its plugin context.
function customSelectionPlugin(onReady: (emit: (selection: SelectionState | null) => void) => void): ChartPlugin {
  return {
    install(ctx) {
      onReady((selection) => ctx.events.emit("select", { selection }));
    },
  };
}

let emitSelection: (selection: SelectionState | null) => void = () => {};
const selectionChart = new Chart(element, { plugins: [customSelectionPlugin((emit) => { emitSelection = emit; })] });
const unsubscribe = selectionChart.subscribe("select", ({ selection }) => {
  if (selection === null) return; // cleared
  console.log(selection.bounds.xMin, selection.bounds.xMax);
});

emitSelection(null);
unsubscribe();
selectionChart.dispose();
```

Code that only subscribed to `select` and let `event.selection` be inferred needs no change except handling `null`. Code that wrote `ChartSelectEvent<Something>` fails with "Type 'ChartSelectEvent' is not generic"; drop the type argument. To mirror selections across charts, use `createLinkedCharts(..., { syncSelections: true })`.

### 3. Datasets enforce one X rule: finite and non-decreasing

Every built-in dataset now follows the same rule: **X is finite and non-decreasing; a non-finite Y is a gap.** In 0.5, unsorted X only logged a warning (or nothing) and left searches, LOD, picking, and exports silently wrong. 1.0 enforces the rule at the boundary instead:

- **Static data throws.** `new StaticDataset(x, y)`, `StaticDataset.replace(...)` / `series.replace(...)`, `new StaticOhlcDataset(...)`, and `ServerSampledDataset` check X in one O(n) pass and throw a `RangeError` naming the first bad index and reason, for example `StaticDataset: X at index 2 is 1, below 2 at index 1 (decreasing-x). ...`. `StaticDataset.fromObjects(...)` throws `RangeError` (was `TypeError`) for a non-finite X and now also for decreasing X unless `sort: true` is passed.
- **Streaming data skips.** `RingBuffer` and `OhlcRingBuffer` skip any sample whose X is `NaN`, `Infinity`, `-Infinity`, or below the last accepted X, instead of storing it. Skipped samples do not count toward capacity or the `overflow` strategy, and the rest of an `append` batch is still stored. They never throw for bad X: one bad packet should not crash a dashboard. One `console.warn` is logged per buffer, `rejectedSamples` counts the skips, and the new `onInvalidSample` option (also on `SeriesConfig`) reports each one. `RingBuffer.update(...)` returns `false` for an X outside its neighbors.
- `UniformRingBuffer` derives X, so it never rejects samples. A non-finite seed X is ignored (Y is kept) with one warning, and a non-finite `xStart` option now throws `RangeError`.
- An OHLC candle with any non-finite open, high, low, or close is stored and treated as a gap.

It matters if you passed unsorted arrays to `StaticDataset`, relied on `length` growing for every pushed sample, caught `TypeError` from `fromObjects`, or encoded a gap with an `x` of `NaN`. Gaps belong in Y.

Before (0.5): unsorted static data was accepted and drew wrong; a `NaN` or backwards X in a ring buffer was stored and broke later queries.

<!-- snippet: skip intentionally old 0.5 behavior; shows data that 1.0 rejects -->
```ts
const dataset = new StaticDataset([3, 1, 2], [30, 10, 20]); // accepted, searches unreliable
buffer.push(Number.NaN, 1); // stored, later queries unreliable
buffer.push(5, 1);
buffer.push(4, 1); // stored out of order with a warning
```

After (1.0): sort static data with `StaticDataset.sorted(...)` (stable, drops non-finite X) or `fromObjects(..., { sort: true })`; skip the O(n) check for huge data you already trust with `assumeSorted: true`; observe streaming rejections with `onInvalidSample` or `rejectedSamples`.

```ts
import { RingBuffer, StaticDataset } from "blazeplot";

const unsorted = StaticDataset.sorted([3, 1, 2], [30, 10, 20]);
const trusted = new StaticDataset(new Float64Array([0, 1, 2]), new Float32Array([5, 6, 7]), { assumeSorted: true });

const buffer = new RingBuffer(10_000, {
  onInvalidSample: ({ reason, x, index }) => console.debug(`dropped sample ${index}: ${reason} (x = ${x})`),
});
buffer.push(Date.now(), 1);
buffer.push(Number.NaN, 2); // skipped, reported, not stored
console.log(unsorted.length, trusted.length, buffer.rejectedSamples);
```

### 4. Fast-path interfaces and escape hatches are experimental

Nothing was removed here, but the tier changed. These are now tagged `@experimental` in the declarations and may change in a minor release (the changelog will say so):

- The custom fast-path dataset interfaces: `AcceleratedDataset`, `RangeMinMaxDataset`, `RangeSampleCopyDataset`, `VisibleSampleCopyDataset`, `VisiblePointCopyDataset`, `MinMaxSegmentCopyDataset`, `XRangeDataset`, `SampleCopyLayout`.
- Camera access (`Camera2D`, reached through `ctx.unstable.getCamera()` and the `ViewportPolicy` hooks; `chart.getCamera()` is removed, see change 10), the plugin context's `ctx.unstable` escape hatches, and every export of `blazeplot/plugins/flamegraph`.

The plugin contract itself is stable in 1.0, in its new shape (change 8).

Action: if you implement a fast-path dataset interface or use `ctx.unstable`, pin a compatible 1.x range, read the changelog on minor upgrades, and prefer the stable `Dataset` contract and context groups where possible. See [API stability](./stability.md#experimental).

### 5. Newly exported helper types

These types appeared in public signatures but were not exported in 0.5.5. They are now exported, so you can name them; this is additive.

| Type | Entry |
|---|---|
| `MinMaxY`, `StaticDatasetData` | `blazeplot` |
| `ExportableChart` | `blazeplot/export` |

### 6. Chart data export moved from `blazeplot/data` to `blazeplot/export`

`exportChartData`, `chartDataToCSV` (also renamed to `chartDataToCsv`, change 10), and their types (`ExportableChart`, `ChartDataExport`, `ChartDataExportOptions`, `ChartDataCsvOptions`, `ChartDataSeries`, `ChartDataSample`, `ChartDataSource`) moved to `blazeplot/export`, next to the screenshot download and clipboard helpers. `blazeplot/data` now holds only pure, chart-agnostic transforms: `binSamples`, `rollingMean`, and their types (`XYSample`, `SampleReducer`, `ResampleX`, `ResampleOptions`, `BinnedSample`, `RollingMeanSample`). There is no re-export: importing the moved names from `blazeplot/data` fails with "Module has no exported member". Behavior is unchanged.

Before (0.5):

<!-- snippet: skip intentionally old 0.5 import path; blazeplot/data no longer exports chart data export -->
```ts
import { binSamples, chartDataToCSV, exportChartData, type ChartDataExport } from "blazeplot/data";
```

After (1.0):

```ts
import { Chart } from "blazeplot";
import { binSamples } from "blazeplot/data";
import { chartDataToCsv, downloadBlob, exportChartData, type ChartDataExport } from "blazeplot/export";

const chart = new Chart(element);
const visible: ChartDataExport = exportChartData(chart, { range: "visible" });
downloadBlob(new Blob([chartDataToCsv(visible)], { type: "text/csv" }), "visible.csv");
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

### 8. The plugin context is grouped, and the plugin contract is stable

`install(ctx)` no longer receives the `Chart` (or a flat object mirroring it). It receives a `ChartPluginContext` with stable groups: `ctx.coords`, `ctx.viewport`, `ctx.state`, `ctx.layout`, `ctx.dom`, `ctx.events`, `ctx.theme`, and `ctx.requestRender()`. Raw DOM handles are replaced by named mount slots and surfaces, the raw WebGL context and camera moved under `ctx.unstable` (still experimental), and `ChartPluginHandle` gained optional lifecycle hooks. Plugins install in registration order and are now disposed in **reverse** registration order. `Chart` no longer implements the plugin context: `chart.emitSelect` and `chart.setLayoutReservation` are removed (use a plugin). `chart.rootElement` stays for app layout; the other raw element getters, `getWebGLContext()`, and `getCamera()` left the public `Chart` (change 10).

| 0.5 plugin context | 1.0 |
|---|---|
| `canvas` (listening) | `ctx.dom.listen("plot", type, listener)` |
| `canvas.getBoundingClientRect()`, `canvas.clientWidth/Height` | `ctx.layout.plotRect()` |
| `rootElement.appendChild(el)` | `ctx.dom.mount("root", el)` |
| `rootElement.ownerDocument.body.appendChild(el)` | `ctx.dom.mount("body", el)` |
| `rootElement.getBoundingClientRect()` | `ctx.layout.rootRect()` |
| `event.composedPath().includes(rootElement)` | `event.composedPath().some((t) => ctx.dom.contains(t))` |
| `plotElement.appendChild(el)` | `ctx.dom.mount("plot", el)` |
| `xAxisElement`, `yAxisElement`, `y2AxisElement` (listen, style) | `ctx.dom.listen("axis-x", ...)` (also `"axis-y"`, `"axis-y2"`), `ctx.dom.decorate(...)`, `ctx.dom.mount(...)` |
| `theme` | `ctx.theme` (plus the `onThemeChange` hook) |
| `getWebGLContext()` | `ctx.unstable.getWebGLContext()` (experimental) |
| `getCamera(yAxis)` | `ctx.viewport.isReversed(axis, yAxis)` for direction, or `ctx.unstable.getCamera(yAxis)` (experimental) |
| `dataToPlot(...)`, `clientToData(...)` | `ctx.coords.dataToPlot(...)`, `ctx.coords.clientToData(...)` (new: `clientToPlot`, `plotToClient`) |
| `getViewport(yAxis)`, `setViewport(v, yAxis)` | `ctx.viewport.get(yAxis)`, `ctx.viewport.set(v, yAxis)` |
| `pan(...)`, `zoom(...)`, `fitToData(...)` | `ctx.viewport.pan(...)`, `ctx.viewport.zoom(...)`, `ctx.viewport.fitToData(...)` |
| `followLatestX(o)`, `stopFollowingLatestX()`, `setXFollowPaused(p)`, `getXFollowState()` | `ctx.viewport.followX(o)`, `ctx.viewport.stopFollowX()`, `ctx.viewport.setFollowXPaused(p)`, `ctx.viewport.getFollowXState()` |
| `getSeriesState()`, `getHoverState()`, `pick(...)`, `getFrameStats(t)` | `ctx.state.getSeries()`, `ctx.state.getHover()`, `ctx.state.pick(...)`, `ctx.state.getFrameStats(t)` |
| `setLayoutReservation(id, r)` / `setLayoutReservation(id, null)` | `const release = ctx.layout.reserve(r)` / `release()` |
| `requestRender()` | `ctx.requestRender()` |
| `subscribe(event, cb)` | `ctx.events.subscribe(event, cb)` |
| `emitSelect(selection)` | `ctx.events.emit("select", { selection })` |
| `subscribe("themechange", ...)` inside a plugin | Return `{ onThemeChange }` (the event still works) |
| A `ResizeObserver` on `plotElement` | Return `{ onResize }` |
| `canvas` `webglcontextlost`/`webglcontextrestored` listeners | Return `{ onContextLost, onContextRestored }` |

The `render` option of `legendPlugin` and `tooltipPlugin`, and the `render` and `renderHighlight` options of `crosshairPlugin`, now pass the `ChartPluginContext` as their third argument instead of the `Chart`. `ChartPluginHandle.dispose` is optional.

Before (0.5):

<!-- snippet: skip intentionally old 0.5 plugin context; these members no longer exist -->
```ts
const footerPlugin: ChartPlugin = {
  install(chart) {
    const footer = document.createElement("div");
    chart.rootElement.appendChild(footer);
    chart.setLayoutReservation("footer", { bottom: 28 });
    const off = chart.subscribe("render", () => {
      footer.textContent = `x from ${chart.getViewport().xMin}`;
    });
    return () => {
      off();
      chart.setLayoutReservation("footer", null);
      footer.remove();
    };
  },
};
```

After (1.0): everything handed out by the context is released when the plugin is disposed, so the cleanup is optional.

```ts
import type { ChartPlugin } from "blazeplot";

const footerPlugin: ChartPlugin = {
  install(ctx) {
    const footer = ctx.dom.create("div");
    ctx.dom.mount("root", footer);
    ctx.layout.reserve({ bottom: 28 });
    ctx.events.subscribe("render", () => {
      footer.textContent = `x from ${ctx.viewport.get().xMin}`;
    });
  },
};
export { footerPlugin };
```

See [Plugin authoring](./plugin-authoring.md) for the full contract, mount slots, lifecycle hooks, and typed plugin events.

### 9. Chart semantics and keyboard changes

1.0 makes charts readable by assistive technology and adds keyboard paths through the built-in plugins (see [Accessibility](./accessibility.md)). Behavior that changed:

| 0.5 | 1.0 |
|---|---|
| Chart root `role="img"` | `role="figure"`, so the content inside (summary, data table, legend, navigator) is exposed. Pass `accessibility: { role: "img" }` to keep the old role. |
| `accessibility.description` set `aria-description` | The root has `aria-describedby` pointing at a visually hidden element. By default it holds a generated data summary; a string `description` replaces it, a function rewords the `ChartSummary`, and `""` removes it. `aria-description` is no longer set. |
| No focus styles of its own | A `<style class="blazeplot-style">` element inside the chart root adds 2px `:focus-visible` rings (theme token `focusRingColor`) and forced-colors rules. Tests that count `<style>` elements in the root should skip `.blazeplot-style`. |
| Canvas ignored OS high-contrast mode | In `forced-colors: active`, the canvas and series use system colors, and switch back when the mode ends. Opt out with `accessibility.forcedColors: false`. |
| `ResolvedChartTheme` | Has a new required `focusRingColor` token. Objects you build as a full `ResolvedChartTheme` (rather than a partial `ChartTheme`) need it. |
| Arrow, `+`/`-`, PageUp/PageDown, and Home/`0` keys panned, zoomed, and fitted every focused chart (`accessibility.keyboard`, `ChartKeyboardOptions`) | Only charts with `interactionsPlugin()` navigate by keyboard, so a chart without it keeps its viewport. Tune with `interactionsPlugin({ keyboard: { panFraction, zoomFactor } })` or turn off with `keyboard: false`. `accessibility.keyboard` and `ChartKeyboardOptions` are removed. |
| Shift + Arrow keys always panned 2.5x | With `selectionPlugin` installed (and `keyboard` not `false`), Shift + Arrow extends a keyboard selection instead, and Enter commits it. |
| Escape always cleared the selection | The selection's Escape handler ignores events that another handler already `preventDefault()`ed (for example leaving keyboard inspection). |
| Annotations were not focusable | Each visible annotation is a Tab stop with `role="button"`. Pass `focusable: false` to `annotationsPlugin` to keep the old Tab order. |
| Hidden legend rows used `opacity: 0.45` | Hidden rows keep full opacity with muted text, a strike-through label, and a dimmed swatch, so the text keeps 4.5:1 contrast. |
| `ChartHoverState` | Has an optional `source` (`"pointer"` or `"inspection"`). Plugins that re-pick hover states should leave `"inspection"` states alone. |

New: `blazeplot/plugins/a11y`, `chart.getSummary()`, `LIGHT_CHART_THEME`, `ctx.state.inspect()` / `getInspection()`, and `ctx.coords.format()`.

### 10. Final naming pass

1.0 renames the names that broke a pattern used everywhere else, and removes `Chart` members that only plugins needed. There are no deprecated aliases: the old names fail to compile ("Property 'followLatestX' does not exist", "Module has no exported member 'chartDataToCSV'").

Conventions, which the rest of the API already followed:

- Latest-X follow is one verb family named after the `followX` option: `followX`, `stopFollowX`, `setFollowXPaused`, `getFollowXState`, with the same names on `Chart` and `ctx.viewport`.
- Plugin context groups drop the noun the group already names (`ctx.viewport.get()` for `chart.getViewport()`, `ctx.state.getHover()` for `chart.getHoverState()`); everything else keeps the `Chart` name.
- Event payloads end in `Event`; option types are named after their option; acronyms are written as words (`Csv`, `Ohlc`).
- Color options end in `Color`, matching the theme tokens they default to (`selectionFillColor` → `fillColor`).

| 0.5 / rc | 1.0 |
|---|---|
| `chart.followLatestX(o)` | `chart.followX(o)` |
| `chart.stopFollowingLatestX()` | `chart.stopFollowX()` |
| `chart.setXFollowPaused(p)` | `chart.setFollowXPaused(p)` |
| `chart.getXFollowState()` | `chart.getFollowXState()` |
| `ctx.viewport.follow(o)`, `stopFollow()`, `setFollowPaused(p)`, `getFollowState()` (1.0 release candidates) | `ctx.viewport.followX(o)`, `stopFollowX()`, `setFollowXPaused(p)`, `getFollowXState()` |
| `ChartXFollowState` | `ChartFollowXState` |
| `ChartPointerEventState` (payload of `click`, `dblclick`, `pointer*`) | `ChartPointerEvent` |
| `LODStrategy` (type of `SeriesConfig.downsample`) | `DownsampleStrategy` |
| `chartDataToCSV(data)` | `chartDataToCsv(data)` |
| `createLinkedCharts(el, { sharedX })` | `createLinkedCharts(el, { syncX })` (pairs with `syncSelections`) |
| `selectionPlugin({ fill, stroke })` | `selectionPlugin({ fillColor, strokeColor })` |
| `navigatorPlugin({ background, stroke, fill, windowFill, windowStroke })` | `navigatorPlugin({ backgroundColor, strokeColor, fillColor, windowFillColor, windowStrokeColor })` |
| `crosshairPlugin({ labelBackground })` | `crosshairPlugin({ labelBackgroundColor })` |
| `chart.getCamera(yAxis)` | `chart.getViewport` / `setViewport` / `pan` / `zoom`; in a plugin, `ctx.viewport.isReversed(...)` or `ctx.unstable.getCamera(yAxis)` (experimental) |
| `chart.getWebGLContext()` | In a plugin, `ctx.unstable.getWebGLContext()` (experimental) |
| `chart.canvas` | `chart.screenshot()` for pixels; in a plugin, `ctx.dom.listen("plot", ...)`, `ctx.layout.plotRect()`, or `ctx.unstable.canvas` |
| `chart.plotElement` | A plugin that calls `ctx.dom.mount("plot", element)` |
| `chart.xAxisElement`, `yAxisElement`, `y2AxisElement` | A plugin using the `"axis-x"`, `"axis-y"`, `"axis-y2"` surfaces of `ctx.dom` |

`chart.rootElement` and `chart.theme` stay. `Camera2D` stays exported (experimental) because `ctx.unstable.getCamera()` and the `ViewportPolicy` hooks use it.

Before (0.5):

<!-- snippet: skip intentionally old names; removed without aliases in 1.0 -->
```ts
chart.followLatestX({ window: 10_000 });
chart.plotElement.appendChild(overlay);
const camera = chart.getCamera();
```

After (1.0): mount app overlays with a small plugin.

```ts
import { Chart, type ChartPlugin } from "blazeplot";

const overlay = document.createElement("div");
const overlayPlugin: ChartPlugin = {
  install: (ctx) => ctx.dom.mount("plot", overlay),
};
const chart = new Chart(element, { plugins: [overlayPlugin] });
chart.followX({ window: 10_000 });
console.log(chart.getFollowXState(), chart.getViewport().xMin);
chart.dispose();
```

### 11. Data and series API corrections

- **Mismatched array lengths throw.** In 0.5, `StaticDataset`, `StaticOhlcDataset`, `ServerSampledDataset`, `RingBuffer.append`, `UniformRingBuffer.append`, and `OhlcRingBuffer.append` silently used the shortest array. 1.0 throws a `RangeError` such as `RingBuffer.append: x has 100 values but y has 99.` and leaves existing data unchanged. If you relied on the truncation, slice the arrays yourself before passing them.
- **`"envelope"` is removed from `SeriesMode`.** It never rendered anything but a line. Use `"line"`, or `downsample: "server"` with `ServerSampledDataset` for a pre-reduced min/max band. `chart.addSeries` now throws a `TypeError` for any unknown `mode`.
- **Default series colors no longer repeat after `removeSeries`.** A new series takes the first palette color that no attached palette-colored series uses (it used `series.length % palette.length`). Palette-colored series now follow `chart.setTheme(...)`; series with an explicit `color` do not. New: `series.setStyle(options)` merges style options after creation.
- **The navigator overview uses `series.dataBounds()` and a min/max envelope for dense series.** Spikes between samples now show up in the overview and its Y domain, and series that start or end with a gap are no longer dropped. `maxSamplesPerSeries` now sets the size up to which a series draws as an exact polyline.
- **`chart.addHistogram(...)` is removed; histograms are bar series over a `HistogramDataset`.** The binning code is no longer imported by `Chart`, so apps that never draw a histogram no longer bundle it. Use `HistogramDataset.from(values, options)` for raw values, or `new HistogramDataset(histogram(values, options))` for bins you computed. `addBar` uses the bin width as the default `barWidth`, and throws a `TypeError` for variable-width bins until you pass `style.barWidth`. The `HistogramSeriesConfig` and `PrecomputedHistogramSeriesConfig` types are removed.

Before (0.5):

<!-- snippet: skip intentionally old 0.5 API; chart.addHistogram no longer exists -->
```ts
chart.addHistogram({ values, binSize: 10, name: "latency" }, { baseline: 0 });
```

After (1.0):

```ts
import { Chart, HistogramDataset } from "blazeplot";

const values = [12, 18, 19, 20, 21, 28, 33, 35];
const chart = new Chart(document.body);
chart.addBar({ name: "latency", dataset: HistogramDataset.from(values, { binSize: 10 }) }, { baseline: 0 });
chart.dispose();
```

- **`downsample: "none"` line and bar series draw every visible sample.** Past 16,384 visible samples (4,096 bars on the non-instanced path) they used to stop drawing partway across the plot. No code change is needed.

### 12. Gesture handling

- **`touch-action` is no longer forced.** A chart without `interactionsPlugin` (or another plugin that asks for it) no longer sets `touch-action: none`, so one-finger swipes scroll the page. `interactionsPlugin` and `selectionPlugin` set it themselves, and the tooltip and crosshair long press use `pan-y`. If you relied on the old default for your own touch handling, request it with `ctx.dom.decorate("plot", { style: { touchAction: "none" } })`. `touchAction` decorations now combine by intersection.
- **Touch input uses Pointer Events only.** The built-in plugins no longer register `touchstart`, `touchmove`, `touchend`, or `touchcancel` listeners. If a custom plugin listens for those on the plot, listen for `pointerdown`, `pointermove`, `pointerup`, and `pointercancel` and check `event.pointerType === "touch"`.
- **Pointer gestures are arbitrated.** Plugins claim a drag with `ctx.dom.claimPointer(event)`. With `interactionsPlugin` and `selectionPlugin` both at their defaults, a plain drag now selects and no longer also box-zooms; use `interactionsPlugin({ boxZoomModifier: "alt" })` to keep box zoom. `selectionPlugin` now ignores presses with Shift, Alt, or Ctrl/Cmd held unless you set `modifier`.
- **New cooperative options.** `interactionsPlugin({ wheelZoom: "modifier", touchPan: "two-finger" })` leaves plain wheel and one-finger input to the page. See [Built-in plugins](./built-in-plugins.md#cooperative-gestures-on-scrolling-pages).

### 13. Rendering fixes that change how charts look

| 0.5 | 1.0 |
|---|---|
| Translucent colors replaced the pixel underneath. An area fill erased the grid lines, and the later of two overlapping translucent series hid the earlier one. | Colors with alpha blend over what is already drawn. Charts that used translucent fills, grid colors, or series colors may look different where shapes overlap. |
| `pointSize` was a diameter in device pixels, so scatter markers were half as large on a 2x display. Markers were squares. | `pointSize` is a diameter in CSS pixels, like `lineWidth`, and markers are round. Scale `pointSize` down if you compensated for the old behavior. |
| Dense area series (more than 8,192 visible samples) kept one sample per stride bucket, so spikes could disappear. | Dense area series render from min/max buckets, so peaks and dips survive at every zoom level. |
| Lines drawn at a large Y offset (for example `1e6 + 0.01`) were quantized to float32 and rendered as a staircase. | Y is shifted by the viewport origin before upload, so they render smoothly. No API change. |

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
4. Search for `ChartSelectEvent<`, `emitSelect(`, and `subscribe("select"`. Drop the type argument, handle `selection === null`, and move any `emitSelect` call into a plugin as `ctx.events.emit("select", { selection })`.
5. Check every `new StaticDataset(...)`, `new StaticOhlcDataset(...)`, `series.replace(...)`, `ServerSampledDataset`, and `fromObjects(...)` call for unsorted or non-finite X: they now throw `RangeError`. Wrap unsorted input with `StaticDataset.sorted(...)` / `StaticOhlcDataset.sorted(...)` or pass `sort: true` to `fromObjects`; pass `assumeSorted: true` only for trusted, already-sorted data. Change `catch` blocks that matched `TypeError` from `fromObjects` to `RangeError`.
6. Audit streaming feeds into `RingBuffer` and `OhlcRingBuffer` for non-finite or backwards X (clock glitches, parse failures, out-of-order packets). Those samples are now skipped; watch `rejectedSamples` or pass `onInvalidSample` to log them. Represent gaps as non-finite Y.
7. Search for imports of `exportChartData`, `chartDataToCSV`, `ExportableChart`, and `ChartData*` types from `blazeplot/data` and import them from `blazeplot/export` instead. Keep `binSamples` and `rollingMean` on `blazeplot/data`.
8. Search for `buildFlameGraphModel` and `pickFrame`. Pass `foldedStacks` and `build` to `flameGraphPlugin()` (or call `setFoldedStacks`), and use `plugin.pick(clientX, clientY)` for hit testing.
9. If you write custom plugins, port them to the grouped plugin context with the table in change 8 (search for `install(`, `setLayoutReservation`, `rootElement`, `plotElement`, `getCamera`, and `render:` callbacks of the legend, tooltip, and crosshair plugins). The new contract is stable. If you implement custom fast-path datasets or use `ctx.unstable`, note they are experimental: pin a 1.x range and read each minor changelog.
10. Apply the renames in change 10: search for `followLatestX`, `stopFollowingLatestX`, `setXFollowPaused`, `getXFollowState`, `ChartXFollowState`, `ChartPointerEventState`, `LODStrategy`, `chartDataToCSV`, `sharedX`, `labelBackground`, the `fill`/`stroke`/`background`/`window*` options of `selectionPlugin` and `navigatorPlugin`, and `chart.getCamera`, `chart.getWebGLContext`, `chart.canvas`, `chart.plotElement`, and the `*AxisElement` getters.
11. Check change 9 if you style or test the chart root: search for `role="img"`, `aria-description`, `querySelector("style")` on the chart root, and full `ResolvedChartTheme` objects (add `focusRingColor`). Give each chart an `accessibility.label`, and consider `a11yPlugin()` for charts whose values users need.
12. If you use `interactionsPlugin` with `selectionPlugin`, or write custom touch or drag plugins, read change 12: check `touch-action`, touch listeners, and which plugin owns a plain drag.
13. Search for `addHistogram`, `HistogramSeriesConfig`, and `PrecomputedHistogramSeriesConfig`. Replace each call with `chart.addBar({ dataset: HistogramDataset.from(values, options) })` (see change 11).
14. Run `tsc --noEmit`, then exercise pan, zoom, tooltips, selection, screenshots, and exports in a real browser, as in the [upgrade checklist](./versioning-and-migration.md#upgrade-checklist-for-users).
15. Skim the [API reference](./api-reference.md) and [API stability](./stability.md) for anything your app imports.
