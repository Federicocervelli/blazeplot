# Accessibility

This page states what BlazePlot does for keyboard and assistive-technology users, and what it does not. Charts are drawn on a WebGL canvas, so a screen reader cannot read data values from the plot. BlazePlot gives the chart a name, a keyboard-navigable viewport, and accessible controls for the built-in legend and navigator; **you are responsible for providing the data itself in an accessible form** when the chart carries information users need.

Everything below was checked against the source in `src/ui/`. Nothing here is a claim of conformance with WCAG or any other standard; BlazePlot has not been audited against one.

## What the chart provides

These apply to every chart unless you pass `accessibility: false`.

| Behavior | Detail |
|---|---|
| Focusable root | The chart root gets `tabindex="0"` unless it already has a non-negative tab index. The browser's default focus outline is kept (BlazePlot only offsets it by `-2px` so it stays inside the chart). |
| Role | `role="img"` by default. Override with `accessibility.role`. |
| Accessible name | `aria-label` is `accessibility.label`, otherwise the chart `title` and `subtitle` joined with an em dash, otherwise `"BlazePlot chart"`. |
| Description | `aria-description` is set only when `accessibility.description` is given. |
| Hidden decoration | The WebGL canvas and the axis tick containers get `aria-hidden="true"`. The plot layer gets `role="presentation"`. Axis tick text is therefore not announced. |
| Keyboard navigation | Enabled by default; see below. |

Always set a meaningful label. A default of `"BlazePlot chart"` tells a screen-reader user nothing about the data.

```ts
import { Chart } from "blazeplot";

const element = document.getElementById("latency-chart")!;
const chart = new Chart(element, {
  title: "Latency",
  accessibility: {
    label: "Line chart of p95 latency by region over the last hour",
    description: "The same values are in the table below the chart.",
  },
});

chart.start();
// Call chart.dispose() when the element is removed.
```

### Keyboard navigation

Keys work when the chart root has focus. They are ignored when the event target is an `input`, `textarea`, or `select`, when Alt, Ctrl, or Meta is held, or when another handler already called `preventDefault()`. The key is only prevented from its default browser action when it was handled. Because the listener is on the chart root, key presses bubbling from focusable children inside it (for example legend buttons, other than Enter and Space) also reach it.

| Key | Action |
|---|---|
| Arrow keys | Pan by 10% of the viewport. Hold Shift for 2.5 times the step. |
| `+` or `=` | Zoom in on both axes around the plot center. |
| `-` or `_` | Zoom out on both axes. |
| `PageUp` / `PageDown` | Zoom the Y axis in / out. |
| `Home` or `0` | Fit the viewport to the data (5% padding). |

Tune the step sizes or turn the whole feature off:

```ts
import { Chart } from "blazeplot";

const element = document.getElementById("chart")!;
const chart = new Chart(element, {
  accessibility: { keyboard: { panFraction: 0.2, zoomFactor: 1.5 } },
});
// accessibility: { keyboard: false } disables keys but keeps the ARIA attributes.
// accessibility: false disables both.
chart.dispose();
```

Keyboard pan and zoom pass through `ViewportPolicy.beforePan` and `beforeZoom`, so any viewport limits you set apply to keyboard users too.

## Built-in plugins

| Plugin | Keyboard and assistive-technology behavior |
|---|---|
| `legendPlugin` | Container is `role="group"` labelled "Chart series legend". With the default `toggleOnClick`, each series is a real `<button>` with `aria-pressed` reflecting visibility and the series name as `aria-label`. The colour swatch is `aria-hidden`. Tab, Enter, and Space work. Focus is preserved when series or theme update. Visibility is also shown by opacity, not only colour. |
| `navigatorPlugin` | `role="slider"`, `tabindex="0"`, labelled "Chart navigator visible X range", with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` (center of the visible range), and `aria-valuetext` ("Visible X range a to b"). Left/Right pan by 10% of the visible span (Shift: 25%); Home/End jump to the start/end of the domain. The overlay SVG is `aria-hidden`. |
| `tooltipPlugin` | `role="tooltip"`, toggled between `aria-hidden="true"` (hidden) and `"false"` (shown). It follows the pointer, or a long press on touch. **It is not reachable from the keyboard** and is not announced as a live region. |
| `crosshairPlugin` | Pointer-driven; no keyboard or ARIA support. |
| `interactionsPlugin` | Pointer, wheel, and touch. The keyboard behavior above comes from `Chart` itself, not from this plugin. |
| `selectionPlugin` | Drawing a selection is pointer-only. Escape clears the selection of the chart you last pressed or focused in. |
| `annotationsPlugin` | Overlay is `aria-hidden`. Annotation text is not exposed to assistive technology. |
| `flameGraphPlugin` | Its tooltip uses the same `role="tooltip"` / `aria-hidden` toggling as the tooltip plugin. Frames are not keyboard focusable. |

## What BlazePlot does not provide

- **No data in the accessibility tree.** Series values, tick labels, and picked points are not exposed. Provide a table, summary text, or download link next to the chart. `exportChartData` and `chartDataToCSV` from `blazeplot/data` turn the current series, the visible range, or a selection into rows you can render as a table.
- **No keyboard path to point values.** Hover state (`chart.getHoverState()`, `chart.pick()`) is pointer-driven. If keyboard users need exact values, build your own control that calls `chart.pick(...)` or reads `exportChartData(chart, { range: "visible" })` and show the result in your page.
- **No non-colour series encoding.** Series are told apart by colour only (plus legend labels). Choose palette colors that stay distinct for color-vision differences and pass `style.color` explicitly for critical series. Contrast between series colours, grid, and background is whatever the theme says; BlazePlot does not check it.
- **No `forced-colors` or high-contrast adaptation.** Canvas pixels do not follow the operating-system forced-colors palette. Use `theme` tokens to supply a high-contrast theme when needed (see [Theming and layout](./theming-and-layout.md)).
- **No reduced-motion switch.** BlazePlot runs no CSS transitions or animated easing. Viewport changes are immediate. Live charts update as data arrives; pause the feed or call `chart.setXFollowPaused(true)` if motion is a problem for your users.
- **No live announcements.** Updates to streaming data are not announced.
- **Role caveat.** The default `role="img"` makes screen readers treat the chart as a single image, which also hides it as an interactive widget even though it responds to the keys above. If keyboard control matters to your users, document it in `accessibility.description`, or pick a role that fits your page.
- **Linked charts.** `createLinkedCharts` builds its panels with the same `Chart` defaults. Set a label for each panel with `panels: [{ options: { accessibility: { label: "..." } } }]`.

## Checklist for an accessible dashboard

1. Give every chart a specific `accessibility.label` (and a `description` when it helps).
2. Put the key numbers or a data table near the chart, generated from the same data.
3. Use the legend plugin's button mode (the default) or your own real buttons to toggle series.
4. Do not rely on hover for information that is not available elsewhere.
5. Test with the keyboard only: Tab to the chart, then use the keys above.
6. Check colours against your own contrast requirements.

## Stability

The ARIA attributes, roles, labels, and keyboard shortcuts in this page are part of the stable surface described in [API stability](./stability.md). Additional accessibility features can be added in minor releases.
