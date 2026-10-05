# Built-in plugins

Built-in plugins are optional. Import them from subpaths so unused plugin code can stay out of your bundle. Every built-in plugin except `blazeplot/plugins/flamegraph` is stable; flamegraph is experimental (see [API stability](./stability.md)). Keyboard and screen-reader behavior of each plugin is listed in [Accessibility](./accessibility.md#built-in-plugins).

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";
import { legendPlugin } from "blazeplot/plugins/legend";

const chart = new Chart(element, {
  plugins: [interactionsPlugin(), tooltipPlugin(), legendPlugin()],
});
```

## Interactions

`interactionsPlugin` adds wheel zoom, shift-drag plot pan, axis drag pan, plot box zoom, double-click reset, touch pan, and pinch zoom. Touch pan and pinch zoom are enabled by default unless you set them to `false`.

Use it when users should control the viewport directly. If your app owns all camera changes, leave it out and call chart camera/viewport APIs yourself.

For live charts using `chart.followX(...)`, double-click/tap reset resumes latest-X follow by default so a reset action behaves like a "back to live" action. Set `resumeFollowOnReset: false` if your reset button should keep the chart paused on a historical viewport.

## Tooltip, crosshair, and legend

- `tooltipPlugin` shows nearest picked samples and can sync tooltips across a group.
- `crosshairPlugin` draws cursor guides, supports ruler measurements, and can sync across a group.
- `legendPlugin` displays series names/colors and can toggle visibility.

Use the `group` or `syncGroup` options when several charts should share hover state. The tooltip and crosshair also follow the keyboard inspection cursor of `a11yPlugin` (any hover state with `source: "inspection"`).

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

Legends are positioned inside the chart root. They do not reserve outside layout space. If you need external controls, create your own plugin and use layout reservations; see [Plugin authoring](./plugin-authoring.md).

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

The plugin handle supports `add`, `remove`, `clear`, `setAnnotations`, `getAnnotations`, `pick`, and `subscribe("hover" | "click", ...)`.

Each visible annotation is keyboard focusable (`role="button"`, named by `ariaLabel`, its label, or a generated description). Enter or Space activates it like a click. Set `removable: true` on the plugin or on an annotation to let Delete or Backspace remove it (`onRemove` is called), or `focusable: false` to keep annotations out of the Tab order.

## Selection

`selectionPlugin` adds brush/range selection UI and emits chart selection events. Use it for zoom-to-selection, comparing ranges, or selecting data windows for export.

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

`navigatorPlugin` adds an overview control. It can reserve top or bottom space so it does not overlap the plot. This is useful for dense history where the main chart shows a small moving window.

```ts
import { Chart, StaticDataset } from "blazeplot";
import { navigatorPlugin } from "blazeplot/plugins/navigator";

// The series the navigator summarizes; normally the one you already added to the chart.
const priceSeries = new Chart(element).addLine({
  dataset: new StaticDataset([0, 1, 2, 3], [10, 12, 11, 13]),
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

`flameGraphPlugin` adds an optional WebGL2 overlay for FlameGraph-style stack traces and lane/status charts. It lives in its own subpath so the core XY renderer stays small.

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

`foldedStacks` also accepts Brendan Gregg folded-stack text (`parseFoldedStacks(text)` returns the parsed samples if you need them). Pass `build: { flameChart: true }` for chronological unmerged stacks, or `statusSpans` (or `buildStatusChartModel(spans)` for the `model` option) for explicit `{ start, end, depth }` intervals. To replace the data later, call `flame.setFoldedStacks(stacks, buildOptions)`, `flame.setStatusSpans(spans)`, or `flame.setModel(model)`; `flame.pick(clientX, clientY)` returns the frame under a point. The plugin renders rectangles in WebGL2 and labels on a 2D canvas overlay; `chart.screenshot()` includes both overlay canvases.

## Linked charts

For dashboards with shared X ranges, use `blazeplot/linked`. Its `panelPlugins` option adds synced crosshair and tooltip plugins to every panel. See [Examples](./examples.md#linked-charts).

All plugin entry points are listed in the [API reference](./api-reference.md#package-entry-points).
