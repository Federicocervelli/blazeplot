# Built-in plugins

Built-in plugins are optional. Import them from subpaths so unused plugin code can stay out of your bundle.

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

## Tooltip, crosshair, and legend

- `tooltipPlugin` shows nearest picked samples and can sync tooltips across a group.
- `crosshairPlugin` draws cursor guides and can sync across a group.
- `legendPlugin` displays series names/colors and can toggle visibility.

Legends are positioned inside the chart root. They do not reserve outside layout space. If you need external controls, create your own plugin and use layout reservations; see [Plugin authoring](./plugin-authoring.md).

## Annotations

`annotationsPlugin` draws SVG overlays for x/y lines, x/y ranges, boxes, points, and labels.

```ts
import { Chart } from "blazeplot";
import { annotationsPlugin } from "blazeplot/plugins/annotations";

const annotations = annotationsPlugin({
  annotations: [
    { id: "earnings", type: "x-line", x: earningsTime, label: "earnings" },
  ],
});

const chart = new Chart(element, { plugins: [annotations] });
annotations.add({ type: "point", x, y, label: "peak" });
```

The plugin handle supports `add`, `remove`, `clear`, `setAnnotations`, `getAnnotations`, `pick`, and `subscribe("hover" | "click", ...)`.

## Selection

`selectionPlugin` adds brush/range selection UI and emits chart selection events. Use it for zoom-to-selection, comparing ranges, or selecting data windows for export.

```ts
import { Chart } from "blazeplot";
import { exportSelectedChartData } from "blazeplot/data";
import { selectionPlugin } from "blazeplot/plugins/selection";

const selection = selectionPlugin({
  mode: "x-range",
  onCommit: (event) => {
    if (!event.selection) return;
    const selected = exportSelectedChartData(chart, event.selection);
    console.log(selected.series);
  },
});

const chart = new Chart(element, { plugins: [selection] });

// Later, for toolbar actions:
const currentSelection = selection.getSelection();
selection.clear();
```

Use `mode: "x-range"` for time-window selection, `"y-range"` for horizontal bands, or `"xy"` for box selection.

## Navigator

`navigatorPlugin` adds an overview control. It can reserve top or bottom space so it does not overlap the plot. This is useful for dense history where the main chart shows a small moving window.

```ts
import { Chart } from "blazeplot";
import { navigatorPlugin } from "blazeplot/plugins/navigator";

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

## Linked charts

For dashboards with shared X ranges, use `blazeplot/linked`. It can add synced crosshair and tooltip plugins for you. See [Examples](./examples.md#linked-charts).

All plugin entry points are listed in the [API reference](./api-reference.md#package-entry-points).
