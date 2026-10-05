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

Theme values are merged with the default theme, so you can override only the tokens you need. Colors accept CSS color strings, including `var(--accent)` references; `backgroundColor`, `gridColor`, and `seriesColors` (the renderer-facing colors) also accept RGBA arrays in 0-1 range. CSS values are resolved against the chart root when the theme is applied, so call `chart.setTheme(...)` again after your CSS variables or color scheme change. `chart.theme` returns the resolved theme, and a `themechange` event fires after each update.

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

`DEFAULT_CHART_THEME` (dark) and `LIGHT_CHART_THEME` are the built-in themes; a unit test checks both for WCAG contrast (4.5:1 for text, 3:1 for graphics). Use the light one with `theme: LIGHT_CHART_THEME`, follow the system preference with `theme: "auto"` (see below), or spread it and override a few tokens. In the operating system's forced-colors (high-contrast) mode the chart switches to system colors on its own; see [Accessibility](./accessibility.md#contrast-and-high-contrast).

### Following the system color scheme

The default theme is dark. Pass `theme: "auto"` to follow the page's `prefers-color-scheme` instead: the chart uses the dark theme, or `LIGHT_CHART_THEME` when the user prefers a light scheme, and switches live (with the usual `themechange` event and plugin `onThemeChange` hooks) when the preference changes. The preference is read from the chart's own window, so charts in iframes and popup windows follow their own document. `chart.setTheme("auto")` turns it on later; passing any explicit theme to `setTheme` stops following the preference. To combine `"auto"` with your own tokens, call `chart.setTheme(...)` from a `prefers-color-scheme` listener of your own and pass the theme you want.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(document.body, { theme: "auto" });
chart.dispose();
```

Per-series colors take the same CSS strings or RGBA tuples: `chart.addLine(config, { color: "#f97316", lineWidth: 2 })`. The second argument of every `add*` helper is a `SeriesStyleOptions` object:

| Option | Applies to | Meaning |
|---|---|---|
| `color` | all | Stroke or marker color. Defaults to the next theme series color. |
| `lineWidth` | line, area outline, OHLC, candlestick wick | Width in CSS pixels. Defaults to 1. |
| `pointSize` | scatter | Round marker diameter in CSS pixels. Defaults to 4. |
| `barWidth` | bar, candlestick body | Width in data X units. Defaults to 0.8 (the bin width for a `HistogramDataset`). |
| `baseline` | bar, area | Y value bars and the area fill grow from. Defaults to 0. |
| `fillColor` | area | Fill color. Defaults to `color` at 25% opacity. |
| `tickWidth` | OHLC | Open/close tick width in data X units. Defaults to `barWidth`. |
| `upColor`, `downColor` | OHLC, candlestick | Rising and falling colors. `upColor` defaults to `color`, `downColor` to `fillColor` when set, otherwise `color` at 45% opacity. |
| `wickColor` | candlestick | Wick color. Defaults to `color`. |

Translucent colors blend with what is already drawn.

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
- The plot canvas is sized to the plot area, not the full outer chart: outside axes, titles, and plugin layout reservations take their space from the chart root first.
- `ResizeObserver` is used when available so charts follow container size changes; without it, call `chart.resize()` after the host changes size.
- The chart belongs to the document and window of its host element, so it works in iframes and popup windows without extra setup: observers, animation frames, `matchMedia`, computed colors, and elements the chart or its plugins create use the host's own window and document instead of the globals. Plugins read them from `ctx.dom.document` and `ctx.dom.view`.
- The chart injects one `<style class="blazeplot-style">` inside its root. The legend, tooltip, crosshair, selection, and navigator plugins each add a small deduplicated `<style data-blazeplot-plugin-style>` with forced-colors rules to the host document (removed when the last chart using it is disposed), and `interactionsPlugin` adds an axis-hover `<style>` inside the chart root. A strict `style-src` Content Security Policy has to allow these elements.
- Call `chart.dispose()` when removing the host element.

## Axes and gutters

- Outside axes are the default and reserve real CSS-pixel gutters for tick labels: 52px on the left/right Y sides and 28px on the bottom X side. Gutters expand (by 24px for Y, 20px for X) when an outside axis has a title.
- Set `size` on an axis to change its gutter: `axes: { y: { size: 80 } }` is a fixed size in CSS pixels, not counting the title allowance. `size: "auto"` measures the widest (Y, Y2) or tallest (X) tick label and adds padding. It grows at once and shrinks only after the smaller size has held for about a second, so live charts with changing label lengths do not jitter.
- A chart title and subtitle get their own row above the plot (26px for a title, 20px more for a subtitle), so they never cover the plot area.
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

Use `scale: "log"` only for positive domains (`logBase` defaults to 10 and must be greater than 1). Use `scale: "symlog"` when values can cross zero. For categorical axes, pass numeric category indexes as data and provide labels with `categories`. Set `reversed: true` to flip an axis.

`scale: "time"` expects X values in epoch milliseconds and picks calendar-aware ticks from sub-millisecond steps up to years. Labels carry date context where the tick crosses a day or year boundary, and zoomed-in views show fractional seconds. `timezone` is `"local"` (default) or `"utc"`. A string `tickFormat` is a time pattern with the tokens `%Y %y %m %d %b %B %a %A %H %M %S %L` and `%%`; for any other scale use a function, `tickFormat: (value, axis) => string`. Change the axis configuration of a live chart with `chart.setAxes(...)`, and toggle grid lines with `chart.setGridVisible(...)`.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element, {
  axes: { x: { scale: "time", timezone: "utc", tickFormat: "%H:%M:%S.%L" } },
});
chart.setAxes({ x: { scale: "time" }, y: { tickFormat: (value) => `${value.toFixed(1)} ms` } });

chart.dispose();
```

## Plugin layout

Plugins that need space outside the plot should mount their UI into the `"root"` slot and call `ctx.layout.reserve(reservation)`, which returns a release function. This avoids overlapping axes and keeps screenshots consistent. Plot overlays, such as crosshairs or custom markers, should mount into the `"plot"` slot with `ctx.dom.mount("plot", element)`. See [Plugin authoring](./plugin-authoring.md#mount-slots-and-surfaces).

The built-in legend defaults to a corner inside the plot and does not reserve space. Pass `legendPlugin({ position: "bottom" })` (or `"top"`, `"left"`, `"right"`) to place it outside the plot: it reserves its measured size through `ctx.layout.reserve` and the plot shrinks to fit. The navigator can reserve top or bottom space. For external legends or controls, create a plugin with a layout reservation.

For plugin lifecycle details, see [Plugin authoring](./plugin-authoring.md).

## Mobile layouts

For small screens, prefer:

- inside axes or fewer visible axes,
- fewer ticks through axis scale/tick options,
- touch-first interaction options. `interactionsPlugin()` already lets one finger scroll the page while two fingers pan and pinch-zoom the chart (`touchPan: "two-finger"`, `pinchZoom: true` are the defaults), with a short hint (`gestureHint`) explaining it; a full-viewport chart can opt into one-finger pan with `touchPan: true`, and `wheelZoom: "modifier"` also keeps the mouse wheel for page scrolling,
- legends outside the plot when space allows (`legendPlugin({ position: "bottom" })`),
- `axes: { y: { size: "auto" } }` so gutters fit the actual tick labels instead of a fixed width.

## Localizing built-in text

Strings that BlazePlot generates are overridable, and unset keys keep their English defaults:

- `accessibility: { locale, messages }` on the chart sets the default accessible name and the wording of the generated summary; `locale` (a BCP 47 tag, default `"en-US"`) formats the counts in it.
- `legendPlugin({ messages })` overrides the legend's group label, hide/show tooltips, and fallback series names.
- `a11yPlugin({ locale, messages })` covers the hidden data table, announcements, and inspection text.
- `interactionsPlugin({ gestureHint: { wheelText, touchText, durationMs } })` rewords the cooperative-gesture hint.

Axis tick text comes from your `tickFormat`; time ticks use English month and weekday names unless you format them yourself. See [Accessibility](./accessibility.md) for the full message lists.

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
