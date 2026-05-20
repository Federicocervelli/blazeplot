# Built-in plugins

Built-in plugins are optional. Import them from subpaths so unused plugin code can stay out of your bundle.

```ts
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";
import { legendPlugin } from "blazeplot/plugins/legend";

const chart = new Chart(element, {
  plugins: [interactionsPlugin(), tooltipPlugin(), legendPlugin()],
});
```

## Interactions

`interactionsPlugin` adds wheel zoom, pointer pan, box zoom, double-click reset, touch pan, and pinch zoom. Touch pan and pinch zoom are enabled by default unless you set them to `false`.

Use it when users should control the viewport directly. If your app owns all camera changes, leave it out and call chart camera/viewport APIs yourself.

## Tooltip, crosshair, and legend

- `tooltipPlugin` shows nearest picked samples and can sync tooltips across a group.
- `crosshairPlugin` draws cursor guides and can sync across a group.
- `legendPlugin` displays series names/colors and can toggle visibility.

Legends are positioned inside the chart root. They do not reserve outside layout space. If you need external controls, create your own plugin and use layout reservations; see [Plugin authoring](./plugin-authoring.md).

## Annotations

`annotationsPlugin` draws SVG overlays for x/y lines, x/y ranges, boxes, points, and labels.

```ts
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

## Navigator

`navigatorPlugin` adds an overview control. It can reserve top or bottom space so it does not overlap the plot. This is useful for dense history where the main chart shows a small moving window.

## Linked charts

For dashboards with shared X ranges, use `blazeplot/linked`. It can add synced crosshair and tooltip plugins for you. See [Examples](./examples.md#linked-charts).

All plugin entry points are listed in the [API reference](./api-reference.md#package-entry-points).
