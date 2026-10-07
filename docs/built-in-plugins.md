# Built-in plugins

Built-in plugins are optional. Import them from subpaths to keep unused plugin code out of your bundle. Every built-in plugin except `blazeplot/plugins/flamegraph` is stable; flamegraph is experimental (see [API stability](./stability.md)). Keyboard and screen-reader behavior of each plugin is listed in [Accessibility](./accessibility.md#built-in-plugins).

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";
import { legendPlugin } from "blazeplot/plugins/legend";

const chart = new Chart(element, {
  plugins: [interactionsPlugin(), tooltipPlugin(), legendPlugin()],
});
```

**One instance per chart.** The annotations, crosshair, selection, navigator, a11y, and flame graph plugins keep their state in the factory closure, so installing the same instance on a second chart throws (`... plugin instance is already installed on a chart. Create one plugin instance per chart.`). Call the factory once per chart, or use `createLinkedCharts({ panelPlugins })`, which is a factory that runs once per panel. The legend, tooltip, and interactions plugins keep their state inside `install`, so one instance can be shared. Disposing the chart (or the plugin) frees an instance for reuse.

**Plugin styles.** Plugins that need CSS (forced-colors rules for the legend, tooltip, selection, navigator, and the shared pick markers) inject one `<style data-blazeplot-plugin-style>` per plugin into the chart's document (or its shadow root). Every chart using the plugin shares it, and it is removed when the last one is disposed. Chart-only bundles ship none of it.

## Interactions

`interactionsPlugin` adds wheel zoom, shift-drag plot pan, axis drag pan, plot box zoom, double-click reset, touch pan, and pinch zoom. Touch pan and pinch zoom are enabled by default unless you set them to `false`. With the focused chart root it also pans, zooms, and fits by keyboard (arrows, `+`/`-`, PageUp/PageDown, Home or `0`); tune with `keyboard: { panFraction, zoomFactor }` or pass `keyboard: false`. A chart without this plugin does not navigate by keyboard.

If your app owns all camera changes, leave the plugin out and call the chart camera/viewport APIs yourself.

For live charts using `chart.followX(...)`, double-click/tap reset resumes latest-X follow by default, like a "back to live" action. Set `resumeFollowOnReset: false` if your reset button should keep the chart paused on a historical viewport.

Gestures made through this plugin (drag, wheel, touch, keyboard) report `viewportchange` with `source: "user"`, which tells them apart from `follow`, `fit`, `api`, and `linked` changes (`ChartViewportChangeSource`).

Without `interactionsPlugin` a chart sets no `touch-action`, so one-finger swipes scroll the page. The plugin sets `touch-action: none` on the plot (and axis gutters) while touch pan or pinch zoom is on, which makes a touch drag pan the chart instead of the page. Touch input uses Pointer Events only.

### Cooperative gestures on scrolling pages

On a scrolling page, a chart that always handles the wheel or one-finger drag traps scrolling. Two options hand those gestures back to the page:

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";

const chart = new Chart(element, {
  plugins: [
    interactionsPlugin({
      wheelZoom: "modifier", // the wheel scrolls the page unless Ctrl or Cmd is held
      touchPan: "two-finger", // the default: one finger scrolls the page, two fingers pan and pinch the chart
    }),
  ],
});
```

- `wheelZoom: "modifier"`: a wheel event without Ctrl or Cmd is not `preventDefault`ed and does not change the viewport. Ctrl+wheel and trackpad pinch (which browsers send as Ctrl+wheel) still zoom. Axis gutters follow the same rule.
- `touchPan: "two-finger"` (the default): the plot keeps `touch-action: pan-x pan-y`, so one finger scrolls the page; two fingers pan and zoom the chart (pinch zoom needs `pinchZoom` left on). Axis gutters still pan with one finger. Double-tap reset keeps working.
- `gestureHint` (default `true`) shows a short overlay when the user scrolls without the modifier or drags with one finger: "Use Ctrl + scroll to zoom" ("Use ⌘ + scroll to zoom" on Apple devices) or "Use two fingers to move the chart". It is `aria-hidden`, takes its colors and font from the theme's tooltip tokens, and can be customized with `gestureHint: { wheelText, touchText, durationMs, backgroundColor, textColor, font, className }` or turned off with `gestureHint: false`.

The defaults are `wheelZoom: true` and `touchPan: "two-finger"`. A full-viewport chart that should pan with one finger opts in with `touchPan: true` (the plot then gets `touch-action: none` and blocks page scrolling over it); `touchPan: false` disables touch panning.

### Drags shared with selection

Box zoom (`boxZoom`, on by default) and `selectionPlugin` both start from a plain left-button drag. When both are installed, the drag runs exactly one action: `selectionPlugin` claims the pointer first through `ctx.dom.claimPointer`, so a plain drag selects and does not also zoom. Shift-drag still pans. To keep both gestures, move one of them to a modifier key:

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { selectionPlugin } from "blazeplot/plugins/selection";

const chart = new Chart(element, {
  plugins: [
    interactionsPlugin({ boxZoomModifier: "alt" }), // Alt-drag zooms into a rectangle
    selectionPlugin(), // plain drag selects
  ],
});
```

`boxZoomModifier` and `selectionPlugin({ modifier })` accept `"none"`, `"shift"`, `"alt"`, or `"ctrl"` (Ctrl or Cmd). `"none"` means no modifier key at all; the others require exactly that key. Setting `boxZoomModifier: "shift"` replaces shift-drag pan. Shift+Arrow keyboard selection is a separate input path and does not conflict with pointer drags. See [Plugin authoring](./plugin-authoring.md#claiming-pointer-gestures) for the rule third-party plugins follow.


## Tooltip, crosshair, and legend

- `tooltipPlugin` shows nearest picked samples and can sync tooltips across a group.
- `crosshairPlugin` draws cursor guides, supports ruler measurements, and can sync across a group.
- `legendPlugin` displays series names/colors and can toggle visibility.

Use the `group` or `syncGroup` options when several charts should share hover state. The tooltip and crosshair also follow the keyboard inspection cursor of `a11yPlugin` (any hover state with `source: "inspection"`).

Default labels follow the X axis: a `scale: "time"` axis prints a full timestamp (`2024-01-01 00:00:05`, with `.123` milliseconds when the value has them, in the axis `timezone`, or your string `tickFormat`; a function `tickFormat` is used as-is) and a `scale: "categorical"` axis prints the category name. Linear and log X values, and all Y values, print as compact numbers (6 significant digits). A custom `formatter`, `formatX`, or `formatY` replaces the default.

On touch screens the tooltip and crosshair appear on a long press (`longPressMs`, default 450 ms; `false` turns it off), follow the finger while it is held, and hide when it lifts, is cancelled, or a second finger arrives (that starts a pinch or pan instead). Both ask for `touch-action: pan-y` on the plot, so a vertical swipe still scrolls the page. Their `render` (and the crosshair's `renderHighlight`) callbacks receive the plugin context, not the `Chart`, as the last argument.

```ts
import { Chart } from "blazeplot";
import { crosshairPlugin } from "blazeplot/plugins/crosshair";
import { legendPlugin } from "blazeplot/plugins/legend";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const chart = new Chart(element, {
  plugins: [
    tooltipPlugin({ syncGroup: "dashboard", mode: "nearest-x" }),
    crosshairPlugin({ syncGroup: "dashboard", mode: "ruler", rulerModifier: "shift" }),
    legendPlugin({ position: "top-right", toggleOnClick: true }),
  ],
});
```

`legendPlugin({ position })` takes a corner (`"top-left"`, `"top-right"` (the default), `"bottom-left"`, `"bottom-right"`), which overlays the plot, or an edge (`"top"`, `"bottom"`, `"left"`, `"right"`), which sits outside it: the legend reserves its measured size through `ctx.layout.reserve` and the plot shrinks to fit. Pass `messages` (`ariaLabel`, `hide`, `show`, `seriesName`) to localize its strings; see [Accessibility](./accessibility.md#localization). For other external controls, create your own plugin and use layout reservations; see [Plugin authoring](./plugin-authoring.md).

## Annotations

`annotationsPlugin` draws SVG overlays for x/y lines, x/y ranges, boxes, points, and labels.

```ts
import { Chart } from "blazeplot";
import { annotationsPlugin } from "blazeplot/plugins/annotations";

const earningsTime = Date.UTC(2026, 0, 28, 21, 30);

const annotations = annotationsPlugin({
  annotations: [
    { id: "earnings", type: "x-line", x: earningsTime, label: "earnings" },
  ],
});

const chart = new Chart(element, { plugins: [annotations] });
annotations.add({ type: "point", x: earningsTime + 3_600_000, y: 182.4, label: "peak" });
```

The plugin handle supports `add`, `remove`, `clear`, `setAnnotations`, `getAnnotations`, `pick`, and `subscribe("hover" | "click", ...)`. Annotations are projected through the chart's axis scales, so they stay aligned on `log`, `symlog`, and custom scales and on reversed axes.

Each visible annotation is keyboard focusable (`role="button"`, named by `ariaLabel`, its label, or a generated description). Enter or Space activates it like a click. Set `removable: true` on the plugin or on an annotation to let Delete or Backspace remove it (`onRemove` is called), or `focusable: false` to keep annotations out of the Tab order.

## Selection

`selectionPlugin` adds brush/range selection UI and emits chart selection events, for zoom-to-selection, comparing ranges, or selecting data windows for export.

```ts
import { Chart } from "blazeplot";
import { exportChartData } from "blazeplot/export";
import { selectionPlugin } from "blazeplot/plugins/selection";

const selection = selectionPlugin({
  mode: "x-range",
  onChange: (event) => {
    if (event.type !== "commit") return;
    const selected = exportChartData(chart, { range: event.selection });
    console.log(selected.series);
  },
});

const chart = new Chart(element, { plugins: [selection] });

// Later, for toolbar actions:
const currentSelection = selection.getSelection();
selection.clear();
```

Use `mode: "x-range"` for time-window selection, `"y-range"` for horizontal bands, or `"xy"` for box selection.

A selection starts from a plain left-button drag (no Shift, Alt, or Ctrl/Cmd held) or a touch drag; it sets `touch-action: none` on the plot so a touch drag selects instead of scrolling. Pick another trigger with `modifier: "shift" | "alt" | "ctrl"` when a plain drag belongs to another plugin. With `interactionsPlugin` installed at its defaults, the plain drag selects and box zoom stays idle (use `interactionsPlugin({ boxZoomModifier: "alt" })` to keep box zoom on Alt-drag); see [Drags shared with selection](#drags-shared-with-selection).

Keyboard users select from the focused chart: Shift + Arrow keys extend a range from the keyboard inspection cursor (with `a11yPlugin`) or from the plot center, Enter commits it (same `select` event and `commit` change), and Escape cancels it. Progress is announced through a polite live region. Tune the step with `keyboard: { step: 0.1 }` (fraction of the plot per press) or turn it off with `keyboard: false`; while it is on, Shift + Arrow no longer does the chart's faster pan.

## Accessibility

`a11yPlugin` adds a visually hidden data table of the visible data, a keyboard inspection cursor (Enter on the focused chart, then arrow keys) that drives the tooltip and crosshair and announces each value, and an optional throttled live summary for streaming charts. See [Accessibility](./accessibility.md) for the full key map and options.

```ts
import { Chart } from "blazeplot";
import { a11yPlugin } from "blazeplot/plugins/a11y";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const chart = new Chart(element, {
  accessibility: { label: "Request rate per service" },
  plugins: [a11yPlugin({ table: { maxRows: 50 }, live: { intervalMs: 30_000 } }), tooltipPlugin()],
});
chart.start();
// chart.dispose() also stops the plugin's timers.
```

## Navigator

`navigatorPlugin` adds an overview control for dense history where the main chart shows a small moving window. It reserves top or bottom space by default so it does not overlap the plot (`reserveSpace: false` overlays it instead).

```ts
import { Chart } from "blazeplot";
import { navigatorPlugin } from "blazeplot/plugins/navigator";

// The series the navigator summarizes; normally the one you already added to the chart.
const priceSeries = new Chart(element).addLine({
  x: [0, 1, 2, 3], y: [10, 12, 11, 13],
  name: "price",
});

const navigator = navigatorPlugin({
  placement: "bottom",
  reserveSpace: true,
  series: priceSeries,
  onRangeChange: ({ xMin, xMax }) => console.log(xMin, xMax),
});

const chart = new Chart(element, { plugins: [navigator] });

// Call after replacing the dataset or changing which series the navigator follows.
navigator.refresh();
```

The overview takes its X and Y domain from each series' `dataBounds()`, so gaps, OHLC highs and lows, and bar or area baselines are included, and a series that starts or ends with a gap still appears. Series with up to `maxSamplesPerSeries` samples (default 512) draw as an exact polyline. Denser series draw a filled min/max envelope with one bucket per CSS pixel of navigator width, so isolated spikes stay visible. The overview is rebuilt only when the data or the navigator width changes, not on every viewport change.

## Flame graphs and status spans

`flameGraphPlugin` adds an overlay for FlameGraph-style stack traces and lane/status charts. Its rectangle layer draws through the chart's own rendering engine (WebGL2, Canvas 2D, or the shared WebGL2 context), so it follows `ChartOptions.renderer` and joins a shared context instead of opening another. Labels use a 2D canvas.

> **Experimental.** `blazeplot/plugins/flamegraph` and its exports (`flameGraphPlugin`, `parseFoldedStacks`, `buildStatusChartModel`, and their types) are tagged `@experimental` and may change in a minor release. See [API stability](./stability.md#experimental).

```ts
import { Chart } from "blazeplot";
import { flameGraphPlugin } from "blazeplot/plugins/flamegraph";

const flame = flameGraphPlugin({
  foldedStacks: [
    { stack: ["root", "parse", "tokenize"], value: 28 },
    { stack: ["root", "render", "paint"], value: 16 },
  ],
  search: "render",
  hoverHighlight: true,
  hoverHighlightColor: [1, 0.95, 0.35, 1],
  onFrameClick: ({ frame }) => console.log(frame.name, frame.value),
});

const chart = new Chart(element, {
  axes: false,
  grid: false,
  plugins: [flame],
});
```

`foldedStacks` also accepts Brendan Gregg folded-stack text (`parseFoldedStacks(text)` returns the parsed samples if you need them). Pass `build: { flameChart: true }` for chronological unmerged stacks, or `statusSpans` (or `buildStatusChartModel(spans)` for the `model` option) for explicit `{ start, end, depth }` intervals. To replace the data later, call `flame.setFoldedStacks(stacks, buildOptions)`, `flame.setStatusSpans(spans)`, or `flame.setModel(model)`; `flame.pick(clientX, clientY)` returns the frame under a point. `chart.screenshot()` includes both overlay canvases.

## Linked charts

For dashboards with shared X ranges, use `blazeplot/linked`. Its `panelPlugins` option is a factory called once per panel (so each panel gets fresh plugin instances), usually to add synced crosshair and tooltip plugins, and its `renderer` option passes a renderer such as `sharedRenderer()` to every panel. See [Examples](./examples.md#linked-charts).

All plugin entry points are listed in the [API reference](./api-reference.md#package-entry-points).
