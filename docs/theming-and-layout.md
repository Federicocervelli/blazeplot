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

## Theme tokens

| Token group | Options |
|---|---|
| Plot | `backgroundColor`, `gridColor`, `axisColor`, `axisFont`, `seriesColors` |
| Tooltip | `tooltipBackgroundColor`, `tooltipTextColor`, `tooltipFont` |
| Legend | `legendBackgroundColor`, `legendBorderColor`, `legendTextColor`, `legendMutedTextColor`, `legendFont` |
| Titles | `titleColor`, `titleFont`, `subtitleColor`, `subtitleFont`, `axisTitleColor`, `axisTitleFont` |

## Sizing

- The chart root fills its host element. Give the host an explicit width and height.
- The WebGL canvas is sized to the plot area, not the full outer chart, when outside axes reserve gutters.
- `ResizeObserver` is used when available so charts follow container size changes.
- Call `chart.dispose()` when removing the host element.

## Axes and gutters

- Outside axes reserve real CSS-pixel gutters for labels: 52px on the left/right Y sides and 28px on the bottom X side.
- Inside axes draw labels over the plot and are useful for compact layouts.
- Use `axes: { x: { position: "inside" }, y: { position: "inside" } }` when space is tight.
- Titles and axis titles are built-in DOM text overlays and are included in `chart.screenshot()` output.

Axis options live under `ChartOptions.axes`. Use them for time ticks, log/symlog scales, category labels, custom tick formatting, reversed axes, and left/right Y-axis placement.

```ts
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

Plugins that need space outside the plot should use `chart.setLayoutReservation(id, reservation)`. This avoids overlapping axes and keeps screenshots consistent. Plot overlays, such as crosshairs or custom markers, should attach to `chart.plotElement`.

The built-in legend is positioned inside the chart root and does not reserve space. The navigator can reserve top or bottom space. For external legends or controls, create a plugin with a layout reservation.

For plugin lifecycle details, see [Plugin authoring](./plugin-authoring.md).

## Mobile layouts

For small screens, prefer:

- inside axes or fewer visible axes,
- fewer ticks through axis scale/tick options,
- touch-first interaction options such as `interactionsPlugin({ touchPan: true, pinchZoom: true })`,
- legends outside the plot when space allows.

## Accessibility and contrast

- Provide `accessibility: { label: "..." }` so the chart has useful screen-reader context.
- Keep axis text readable against the background.
- Use grid colors as decoration, not as the only way to understand the chart.
- Pick series colors that remain distinct for dense data and common color-vision differences.
