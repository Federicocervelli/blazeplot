# Theming and layout

Pass a theme when you create a chart, or update it later with `chart.setTheme(theme)`.

```ts
chart.setTheme({
  backgroundColor: "#0b1020",
  gridColor: "rgba(255,255,255,0.12)",
  axisColor: "#d8dee9",
  seriesColors: ["#7dd3fc", "#fda4af", "#86efac"],
});
```

Theme values are merged with the default theme, so you can override only the tokens you need. Colors accept CSS color strings; renderer-facing colors also accept RGBA arrays in 0-1 range.

## Quick decisions

| Goal | Use |
|---|---|
| Brand colors or dark mode | `theme` at construction time, then `chart.setTheme(...)` for runtime changes. |
| Compact dashboards | Inside axes, fewer visible axes, smaller title/axis fonts, and plugin layout reservations. |
| External controls or legends | A plugin that mounts into the `"root"` slot and calls `ctx.layout.reserve(...)`; avoid hard-coded margins. |
| Screenshot-safe overlays | Built-in DOM/SVG overlays or plugin-owned elements inside the chart root. |
| Mobile layouts | Inside axes, fewer ticks, touch interactions, and controls outside the plot. |

## Theme tokens

| Token group | Options |
|---|---|
| Plot | `backgroundColor`, `gridColor`, `axisColor`, `axisFont`, `seriesColors` |
| Tooltip | `tooltipBackgroundColor`, `tooltipTextColor`, `tooltipFont` |
| Legend | `legendBackgroundColor`, `legendBorderColor`, `legendTextColor`, `legendMutedTextColor`, `legendFont` |
| Titles | `titleColor`, `titleFont`, `subtitleColor`, `subtitleFont`, `axisTitleColor`, `axisTitleFont` |
| Overlays | `selectionFillColor`, `selectionStrokeColor` (box zoom and selection), `crosshairColor`, `markerStrokeColor` (hover markers) |
| Focus | `focusRingColor` (keyboard focus ring on the chart root, legend items, navigator, and annotations) |

`DEFAULT_CHART_THEME` (dark) and `LIGHT_CHART_THEME` are the built-in themes; a unit test checks both for WCAG contrast (4.5:1 for text, 3:1 for graphics). Use the light one with `theme: LIGHT_CHART_THEME`, or spread it and override a few tokens. In the operating system's forced-colors (high-contrast) mode the chart switches to system colors on its own; see [Accessibility](./accessibility.md#contrast-and-high-contrast).

Per-series colors take the same CSS strings or RGBA tuples: `chart.addLine(config, { color: "#f97316", lineWidth: 2 })`.

Series without an explicit `color` take the first theme palette color no other attached series uses, so removing a series and adding another never repeats a color that is still on screen. Those palette-colored series follow `chart.setTheme(...)`; series with an explicit `color` keep it.

Restyle a series after creation with `series.setStyle(...)`. It merges the fields you pass, resolves CSS colors, updates the legend and the next frame, and survives forced-colors mode. Setting `color` pins it, so later theme changes leave that series alone.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(document.body);
const series = chart.addLine({ capacity: 1_000, name: "cpu" });
series.setStyle({ color: "#f97316", lineWidth: 2 });
chart.dispose();
```

## Sizing

- The chart root fills its host element. Give the host an explicit width and height.
- The WebGL canvas is sized to the plot area, not the full outer chart, when outside axes reserve gutters.
- `ResizeObserver` is used when available so charts follow container size changes.
- Call `chart.dispose()` when removing the host element.

## Axes and gutters

- Outside axes are the default and reserve real CSS-pixel gutters for tick labels: 52px on the left/right Y sides and 28px on the bottom X side. Gutters expand when an outside axis has a title.
- Inside axes draw labels over the plot and are useful for compact layouts.
- Use `axes: { x: { position: "inside" }, y: { position: "inside" } }` when space is tight.
- Titles and axis titles are built-in DOM text overlays and are included in `chart.screenshot()` output.

Axis options live under `ChartOptions.axes`. Use them for time ticks, log/symlog scales, category labels, custom tick formatting, reversed axes, and left/right Y-axis placement.

```ts
import { Chart, StaticDataset } from "blazeplot";

const latencyDataset = new StaticDataset([0, 1000, 2000], [120, 180, 150]);
const requestDataset = new StaticDataset([0, 1000, 2000], [40, 55, 48]);

const chart = new Chart(element, {
  axes: {
    x: { scale: "time", timezone: "utc", title: "Time" },
    y: { scale: "symlog", symlogConstant: 1, title: "Latency" },
    y2: { visible: true, position: "outside", title: "Requests" },
  },
});

chart.addLine({ dataset: latencyDataset, name: "p95 latency" });
chart.addBar({ dataset: requestDataset, name: "requests", yAxis: "right" });
```

Use `scale: "log"` only for positive domains. Use `scale: "symlog"` when values can cross zero. For categorical axes, pass numeric category indexes as data and provide labels with `categories`.

## Plugin layout

Plugins that need space outside the plot should mount their UI into the `"root"` slot and call `ctx.layout.reserve(reservation)`, which returns a release function. This avoids overlapping axes and keeps screenshots consistent. Plot overlays, such as crosshairs or custom markers, should mount into the `"plot"` slot with `ctx.dom.mount("plot", element)`. See [Plugin authoring](./plugin-authoring.md#mount-slots-and-surfaces).

The built-in legend is positioned inside the chart root and does not reserve space. The navigator can reserve top or bottom space. For external legends or controls, create a plugin with a layout reservation.

For plugin lifecycle details, see [Plugin authoring](./plugin-authoring.md).

## Mobile layouts

For small screens, prefer:

- inside axes or fewer visible axes,
- fewer ticks through axis scale/tick options,
- touch-first interaction options such as `interactionsPlugin({ touchPan: true, pinchZoom: true })`,
- legends outside the plot when space allows.

## Accessibility and contrast

Provide accessible text at chart construction time. BlazePlot marks the canvas as hidden from assistive technology and puts the label on the chart root.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element, {
  title: "Latency",
  subtitle: "p95 by region",
  accessibility: {
    label: "Latency chart showing p95 latency by region",
    description: "Use the table below the chart for exact values.",
  },
});
```

- Keep axis text readable against the background.
- Use grid colors as decoration, not as the only way to understand the chart.
- Pick series colors that remain distinct for dense data and common color-vision differences.
- Put exact values in nearby tables or exports when the chart is part of a critical workflow.
