# Accessibility

This page states what BlazePlot does for keyboard and assistive-technology users, and what it does not. Charts are drawn on a WebGL canvas, so a screen reader cannot read pixels. BlazePlot exposes the chart through three layers:

1. **The chart itself** (always on): a named, focusable `figure` with a generated text summary, visible focus rings, and forced-colors (high-contrast) support.
2. **`blazeplot/plugins/a11y`** (opt in): a visually hidden data table of the visible data, a keyboard inspection cursor that drives the tooltip and crosshair, and an optional live summary for streaming charts.
3. **Keyboard support in the built-in plugins**: arrow-key pan and zoom (`interactionsPlugin`), legend buttons, the navigator slider, keyboard range selection, and focusable annotations.

Everything below is checked against the source in `src/ui/` and `src/plugins/` and verified by unit tests in `tests/ui/`, keyboard-only browser tests (`bun run test:interaction`), automated axe-core checks of every built-in plugin (`bun run test:a11y`, which fails on serious or critical violations), and an automated forced-colors check in headless Chrome (`bun run test:forced-colors`, part of `bun run test:interaction`). BlazePlot has not been tested manually with screen readers. Nothing here is a claim of conformance with WCAG or any other standard: BlazePlot has not been audited against one.

## What the chart provides

These apply to every chart unless you pass `accessibility: false`.

| Behavior | Detail |
|---|---|
| Role | `role="figure"` by default, so the summary, data table, legend, and other controls inside stay reachable. Override with `accessibility.role`. |
| Accessible name | `aria-label` is `accessibility.label`, otherwise the chart `title` and `subtitle` joined with an em dash, otherwise `accessibility.messages.defaultLabel`, otherwise `"BlazePlot chart"`. |
| Description | `aria-describedby` points at a visually hidden element holding a generated summary: chart type, series count, the X range, and for each series its name, point count, value range, and latest value. It is refreshed at most once a second while data changes (and immediately when the chart gains focus), never per frame. `accessibility.description` replaces it with a fixed string, rewords it with a function of the `ChartSummary`, or removes it with `""`. `chart.getSummary()` returns the same data on demand. |
| Focusable root | The chart root gets `tabindex="0"` (so its summary can be read and plugins can take keyboard input) unless it already has a non-negative tab index. A chart with `description: ""` and no plugins has nothing to read or operate, so it is not made a tab stop. |
| Focus ring | A 2px `:focus-visible` outline on the chart root and on every focusable control inside it (legend buttons, navigator, annotations), colored by the `focusRingColor` theme token. Pointer clicks do not show it. |
| Hidden decoration | The chart canvas (WebGL or Canvas 2D) and the axis tick containers get `aria-hidden="true"`; the plot layer gets `role="presentation"`. |
| Forced colors | When the OS forces a high-contrast palette (`forced-colors: active`, e.g. Windows Contrast themes), the canvas switches to CSS system colors (`Canvas`, `CanvasText`, `Highlight`, `LinkText`, ...), every series is drawn in the system palette, and it switches back when the mode ends. Opt out with `accessibility.forcedColors: false`, which stops the canvas from following the OS palette. The built-in plugins style their own overlays for forced colors (see [Contrast and high contrast](#contrast-and-high-contrast)). |
| Keyboard navigation | Not part of the chart itself: arrow-key pan and zoom come from `interactionsPlugin` (on by default there). Without it, a focused chart does not change its viewport. See the key map. |

```ts
import { Chart } from "blazeplot";

const element = document.getElementById("latency-chart")!;
const chart = new Chart(element, {
  title: "Latency",
  accessibility: {
    label: "p95 latency by region, last hour",
    // Optional: reword the generated summary.
    description: (summary) => `${summary.series.length} regions. ${summary.text}`,
  },
});

chart.start();
// Call chart.dispose() when the element is removed.
```

Always set a meaningful label. A default of `"BlazePlot chart"` tells a screen-reader user nothing about the data.

## The accessibility plugin

`a11yPlugin` from `blazeplot/plugins/a11y` adds what the core keeps out to stay small:

- **Data table.** A visually hidden `<table>` per visible series with a caption (`"CPU: 100 points, evenly sampled from 4,812 visible points"`), column headers, and the X value as each row's header. Rows come from the visible range, evenly sampled down to `table.maxRows` (default 100, first and last point always kept). The table follows the viewport and data, rebuilt at most every `table.updateMs` (default 500 ms) and only when something changed. OHLC and candlestick series list open, high, low, and close.
- **Inspection cursor.** With the chart root focused, Enter starts a keyboard cursor on the sample nearest the plot center. Each move is announced through a polite live region (`"CPU: x 12:00:05, y 45.2. Point 13 of 100."`), and the tooltip and crosshair plugins render at the inspected sample. Moving past the edge of the plot scrolls the viewport. Moving the mouse over the plot, Escape, or moving focus away ends it.
- **Live summary** (opt in). `live: { intervalMs }` announces the latest value of each visible series through a polite live region at most every `intervalMs` (default 10 s, minimum 1 s), only when the text changed, and not while inspecting.

Values are formatted like the axis labels (time, categorical, and custom tick formats included). Override with `formatX`, `formatY`, and `formatAnnouncement`.

```ts
import { Chart } from "blazeplot";
import { a11yPlugin } from "blazeplot/plugins/a11y";
import { crosshairPlugin } from "blazeplot/plugins/crosshair";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const element = document.getElementById("cpu-chart")!;
const accessibility = a11yPlugin({
  table: { maxRows: 50, xLabel: "Time" },
  live: { intervalMs: 15_000 },
  formatY: (value) => `${value.toFixed(1)}%`,
});
const chart = new Chart(element, {
  title: "CPU",
  axes: { x: { scale: "time" } },
  plugins: [accessibility, tooltipPlugin(), crosshairPlugin({ snap: "nearest-x" })],
});
chart.addLine({ capacity: 10_000, name: "CPU" });
chart.start();

// accessibility.refresh() rebuilds the table immediately; accessibility.isInspecting() reports the cursor.
// Later: chart.dispose() also disposes the plugin and its timers.
```

The inspection cursor uses `ctx.state.inspect(...)` from the stable plugin contract, so a third-party plugin can drive the tooltip and crosshair the same way; see [Plugin authoring](./plugin-authoring.md#keyboard-inspection).

## Key map

All chart keys work while the **chart root itself** has focus (Tab to it). Keys typed in a control inside the chart (a legend button, an annotation, the navigator, an `input`) are handled by that control. Keys with Alt, Ctrl, or Meta held are ignored, and a key is only prevented from its default browser action when it was handled.

### Navigation mode (default)

These keys need `interactionsPlugin()`; without it the chart ignores them.

| Key | Action | From |
|---|---|---|
| Arrow keys | Pan by 10% of the viewport. | Interactions |
| Shift + Arrow keys | Pan by 25%. With `selectionPlugin` installed, Shift + Left/Right (x-range and xy modes) and Shift + Up/Down (y-range and xy modes) extend a selection instead. | Interactions / selection |
| `+` or `=` / `-` or `_` | Zoom in / out on both axes around the plot center. | Interactions |
| PageUp / PageDown | Zoom the Y axis in / out. | Interactions |
| Home or `0` | Fit the viewport to the data (5% padding). | Interactions |
| Enter | Commit a pending keyboard selection; otherwise start the inspection cursor. | Selection / a11y plugin |
| Escape | Cancel a pending keyboard selection, else clear the committed selection. | Selection |

### Inspection mode (`a11yPlugin`)

| Key | Action |
|---|---|
| Left / Right | Previous / next sample of the active series, in screen direction (reversed X axes are handled). Scrolls the viewport when the sample is off-screen. |
| Up / Down | Previous / next visible series, at the sample nearest the current X. |
| PageUp / PageDown | Jump back / forward by 10% of the visible samples. |
| Home / End | First / last visible sample; pressed again there, the first / last sample of the series. |
| Shift + Arrow keys, Enter | Keyboard selection starting at the inspected sample (with `selectionPlugin`). |
| `+`, `-`, `0` | Chart zoom and fit; the cursor stays on its sample. |
| Escape | Leave inspection mode. |

### Plugin controls

| Control | Keys |
|---|---|
| Legend item (`legendPlugin`) | Tab between items; Enter or Space toggles the series. |
| Navigator (`navigatorPlugin`) | Left/Right pan by 10% of the visible span (Shift: 25%); Home/End jump to the start/end of the domain. |
| Annotation (`annotationsPlugin`) | Tab between visible annotations; Enter or Space activates it (calls `onClick` and `click` subscribers); Delete or Backspace removes it when it is `removable`. |

Tune the keyboard step sizes or turn the keys off on the interactions plugin:

```ts
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";

const element = document.getElementById("chart")!;
const chart = new Chart(element, {
  plugins: [interactionsPlugin({ keyboard: { panFraction: 0.2, zoomFactor: 1.5 } })],
});
// interactionsPlugin({ keyboard: false }) turns the chart keys off but keeps pointer interaction.
// accessibility: false disables the chart's role, label, summary, focus styles, and forced-colors theme,
// and the root is no longer made focusable, so these keys then need a tabindex you set yourself.
chart.dispose();
```

Keyboard pan and zoom pass through `ViewportPolicy.beforePan` and `beforeZoom`, so viewport limits apply to keyboard users too.

## Built-in plugins

| Plugin | Keyboard and assistive-technology behavior |
|---|---|
| `a11yPlugin` | Hidden data table, inspection cursor, live summary; see above. |
| `legendPlugin` | Container is `role="group"` labelled "Chart series legend". With the default `toggleOnClick`, each series is a `<button>` with `aria-pressed` and the series name as `aria-label`. Hidden series keep 4.5:1 text and are marked with a strike-through and a dimmed swatch, not only color. Focus is preserved when series or theme update. |
| `navigatorPlugin` | `role="slider"`, `tabindex="0"`, labelled "Chart navigator visible X range", with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` (center of the visible range), and `aria-valuetext`. The overlay SVG is `aria-hidden`. |
| `tooltipPlugin` | `role="tooltip"`, toggled between `aria-hidden="true"` and `"false"`. Follows the pointer, a long press on touch (it hides when the finger lifts), or the keyboard inspection cursor. Its content is not a live region; the a11y plugin announces inspected values. |
| `crosshairPlugin` | Follows the pointer or the keyboard inspection cursor (`onMove` fires for both). Decorative for assistive technology. |
| `selectionPlugin` | Pointer drag, or Shift + Arrow keys from the chart root (`keyboard: { step }`, default 5% of the plot per press; `keyboard: false` turns it off). The range being extended, the committed range, cancelling, and clearing are announced through a polite live region. Emits the same `select` event and `onChange` events (`sourceEvent` is the `KeyboardEvent`). |
| `annotationsPlugin` | The SVG stays `aria-hidden`; each visible annotation gets a focus target with `role="button"`, `aria-roledescription="annotation"`, and an accessible name from `ariaLabel`, the label text, or a generated description ("Vertical line at x 50"). Opt out with `focusable: false` (per plugin or per annotation). Removal by keyboard needs `removable: true` and calls `onRemove`. |
| `interactionsPlugin` | Pointer, wheel, and touch, plus keyboard pan, zoom, and fit from the focused chart root (`keyboard: { panFraction, zoomFactor }`, `keyboard: false` turns it off). Inspection keys from `a11yPlugin` take priority while inspecting. |
| `flameGraphPlugin` | Its tooltip uses the same `role="tooltip"` / `aria-hidden` toggling. Frames are not keyboard focusable. |

## Localization

Every user-facing string can be replaced, so a non-English app can ship a fully localized chart. Each piece takes an object of strings and small formatter functions; only the keys you pass change.

- Core: `accessibility: { locale, messages: { defaultLabel, summary } }` (the generated summary, see `ChartSummaryMessages`).
- `a11yPlugin({ locale, messages })`: keyboard instructions, table captions and headers, inspection announcements, and the live summary (`A11yMessages`).
- `legendPlugin({ messages })`: the group label and the hide/show titles (`LegendMessages`).
- `selectionPlugin({ messages })`: selection announcements (`SelectionMessages`).
- `navigatorPlugin({ messages, label, formatValueText })`: the slider label and the visible-range value text (`NavigatorMessages`); `label` and `formatValueText` are shorthands that override the messages. The value text formats the range with the X axis formatter, so a time axis reads as dates.
- `annotationsPlugin({ messages })`: the `aria-roledescription` and the generated names of annotations without `ariaLabel` or label text (`AnnotationsMessages`).
- `interactionsPlugin({ messages })`: the cooperative-gesture hints (`InteractionsMessages`); `gestureHint: { wheelText, touchText }` still wins when set.

Counts use `Intl.NumberFormat` semantics for `locale` (default `"en-US"`). Axis tick text is formatted by your `tickFormat`; time ticks use English month and weekday names unless you format them yourself. Text you supply (series names, titles, annotation labels and `ariaLabel`) is shown as given. The default crosshair readout (`x ... y ...` when no series is picked) and the tooltip rows are built from your formatters and series names; use `crosshairPlugin({ render, formatter })` and `tooltipPlugin({ formatter })` to control their wording. Every other string BlazePlot generates is listed above, so with those messages set no English remains in the chart.

```ts
import { Chart } from "blazeplot";
import { a11yPlugin } from "blazeplot/plugins/a11y";
import { legendPlugin } from "blazeplot/plugins/legend";

const chart = new Chart(element, {
  accessibility: {
    locale: "de-DE",
    messages: {
      defaultLabel: "Diagramm",
      summary: { intro: (_mode, count) => `Diagramm mit ${count} Reihen.` },
    },
  },
  plugins: [
    a11yPlugin({ locale: "de-DE", messages: { instructions: "Tastatur: Eingabe startet die Punktprüfung.", stoppedInspecting: "Prüfung beendet." } }),
    legendPlugin({ messages: { ariaLabel: "Legende", hide: (name) => `${name} ausblenden`, show: (name) => `${name} einblenden` } }),
  ],
});

// Call chart.dispose() when the chart is removed.
```

## Contrast and high contrast

The built-in dark theme (`DEFAULT_CHART_THEME`) and light theme (`LIGHT_CHART_THEME`) are checked by a unit test that computes WCAG contrast ratios from the theme tokens: text tokens (axis labels, titles, tooltip and legend text, including muted legend text) reach at least 4.5:1 against what they sit on, and series colors, the selection border, crosshair, point-marker outline, and focus ring reach at least 3:1 against the background. Translucent tokens are composited first. Grid lines are decorative and not checked. If you pass your own `theme`, checking its contrast is up to you.

In forced-colors mode the chart follows the OS palette as described above. The forced-colors rules for the legend, tooltip, crosshair, selection, and navigator ship with those plugins (one `<style data-blazeplot-plugin-style>` per plugin in the chart's document or shadow root), so they apply whenever the plugin is installed, even with `accessibility: false`, and chart-only bundles carry none of them. Series then differ by system color and by legend label only; if the series must stay distinguishable in high contrast, keep the count small or label them in the chart (for example with annotations).

## What BlazePlot does not provide

- **No sonification or non-color series encoding.** Series are told apart by color and legend labels. Choose palette colors that stay distinct for color-vision differences and set `style.color` explicitly for critical series.
- **No reduced-motion switch.** BlazePlot runs no CSS transitions. Live charts update as data arrives; pause the feed or call `chart.setFollowXPaused(true)` if motion is a problem for your users.
- **Live data under the inspection cursor.** The cursor holds a logical sample index. On a wrapping ring buffer at capacity, new data shifts which sample that index points at; the announcement updates on the next key press.
- **Linked charts** use the same defaults per panel. Set a label for each panel with `panels: [{ options: { accessibility: { label: "..." } } }]`, and add `a11yPlugin()` through `panelPlugins` where needed.

## Testing with a screen reader

Automated checks cannot tell whether announcements make sense, so test your own charts with a screen reader before relying on them. Contributors can run the same steps against the website previews and the `a11y` interaction fixture (`bun run fixtures:dev`, then `/interaction/?case=a11y`). Note the browser and screen reader versions when you report a problem.

Common combinations: NVDA with Firefox or Chrome on Windows; VoiceOver with Safari on macOS.

1. Tab to the chart. The name, role ("figure"), and generated summary are announced.
2. Browse the chart content with the virtual cursor (NVDA browse mode, VoiceOver VO+arrows): the summary, the instructions, and each data table are reachable; table navigation (NVDA Ctrl+Alt+arrows, VoiceOver VO+arrows in a table) announces the X row header with each value.
3. Press Enter on the chart: inspection starts and the first value is announced. NVDA must be in focus mode for the arrow keys to reach the chart; note whether it switches automatically.
4. Left/Right, Up/Down, PageUp/PageDown, Home/End: each announces the new value once, without repeating stale text; the tooltip and crosshair follow on screen.
5. Escape: "Stopped inspecting points" is announced and arrow keys pan again.
6. Shift+Right a few times, then Enter: the range is announced while it grows and when it is committed; Escape cancels.
7. Tab through annotations, legend items, and the navigator: each has a sensible name and role; Enter on an annotation activates it; Delete removes a removable one and focus lands on the next control.
8. A streaming chart with `live` enabled announces the latest values no more often than configured and stays quiet while inspecting.
9. Windows Contrast theme (forced colors): series, axes, focus rings, tooltip, legend, and selection stay visible, and switching the theme off restores the normal colors without a reload. BlazePlot's own charts are covered by an automated test that emulates `forced-colors: active` in headless Chrome (`bun run test:forced-colors`); a real Contrast theme is still worth a look with your own theme and plugins.

## Checklist for an accessible dashboard

1. Give every chart a specific `accessibility.label`.
2. Add `a11yPlugin()` where users need the values, or put your own table or key numbers next to the chart.
3. Keep the legend's button mode (the default) or use your own real buttons to toggle series.
4. Do not rely on hover alone: the inspection cursor and the data table cover keyboard and screen-reader users when the a11y plugin is installed.
5. Test with the keyboard only, using the key map above.
6. Check contrast if you change theme colors.

## Stability

The roles, ARIA attributes, key map, the `accessibility` options, and `blazeplot/plugins/a11y` with its documented options are part of the stable surface described in [API stability](./stability.md). Wording of generated summaries and announcements is not; it may improve in minor releases (pass `description` or `formatAnnouncement` to control it). Additional accessibility features can be added in minor releases.
