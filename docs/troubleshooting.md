# Troubleshooting

Use this page when a chart renders blank, feels slow, or behaves differently from the examples.

## Start with the symptom

| Symptom | Check first | Detailed section |
|---|---|---|
| Empty area or no plot | Host size, WebGL2, viewport, render loop, sorted finite data | [Blank chart](#blank-chart) |
| Live view keeps resetting | Repeated `fitToData()` calls instead of `followX` | [Live chart keeps jumping away from the latest data](#live-chart-keeps-jumping-away-from-the-latest-data) |
| Live data only updates after pan/zoom | Direct dataset mutation without `series.markDirty()` | [Live data does not repaint until interaction](#live-data-does-not-repaint-until-interaction) |
| Chart slows down over time | Per-point appends, chart recreation, hidden render loops, DOM overlays | [Performance drops over time](#performance-drops-over-time) |
| Some charts on a page go blank, or the console reports lost WebGL contexts | More than about 16 charts, each with its own WebGL context | [Charts go blank when a page has many of them](#charts-go-blank-when-a-page-has-many-of-them) |
| `RangeError` when creating a dataset, or live samples are missing | Unsorted or non-finite X, mismatched array lengths, or a streaming buffer skipping samples | [Datasets throw or skip samples](#datasets-throw-or-skip-samples) |
| `plugin instance is already installed on a chart` | One plugin instance passed to two charts | [A plugin instance is already installed](#a-plugin-instance-is-already-installed) |
| Log axis fails or stops drawing | Zero or negative viewport values | [Log axis throws a domain error](#log-axis-throws-a-domain-error) |
| React chart remounts | Unstable `options` identity or missing effect cleanup | [React chart recreates unexpectedly](#react-chart-recreates-unexpectedly) |
| Page will not scroll over the chart, or a touch drag scrolls instead of panning | Which plugin sets `touch-action`, `wheelZoom`/`touchPan` options | [Page scrolling and chart gestures](#page-scrolling-and-chart-gestures) |
| Screenshot omits controls | Controls live outside the chart root | [Screenshots miss external UI](#screenshots-miss-external-ui) |

## Blank chart

Check these first:

1. **The host element has size.** BlazePlot fills its container; a `0px`-tall parent produces a `0px` plot.
2. **The browser supports WebGL2.** Charts use WebGL2 by default. Pass `renderer: autoRenderer()` from `blazeplot/renderers/canvas2d` to fall back to the built-in Canvas 2D renderer, or use `isWebGL2Available()` to show your own fallback UI.
3. **The chart has a viewport.** Call `chart.fitToData()` after adding initial series, or set a viewport explicitly with `chart.setViewport(...)`.
4. **Render scheduling is active.** Call `chart.start()` after setup. The default mode renders when chart-owned state changes and then idles; append through series APIs or call `series.markDirty()` after direct dataset mutation. Use the `renderLoop: "continuous"` chart option only for custom animations.
5. **The data is finite and sorted.** Built-in datasets expect ascending X values. Non-finite Y values create gaps.
6. **The host is hidden or in another document.** A host with `display: none` has no size, so the plot is empty until it is shown; the chart's `ResizeObserver` then resizes it (call `chart.resize()` yourself where `ResizeObserver` is unavailable). In an iframe, create the chart from a host element that belongs to the iframe's document.
7. **The log scale has no valid domain.** See [Log axis throws a domain error](#log-axis-throws-a-domain-error).

```ts
import { Chart, StaticDataset, isWebGL2Available } from "blazeplot";

const x = [0, 1, 2];
const y = [3, 6, 4];

function showUnsupportedBrowserMessage() {
  element.textContent = "This chart needs WebGL2, which this browser does not provide.";
}

if (!isWebGL2Available()) {
  showUnsupportedBrowserMessage();
} else {
  const chart = new Chart(element);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "series" });
  chart.fitToData({ padding: 0.05 });
  chart.start();
}
```

## Charts go blank when a page has many of them

Browsers allow about 16 live WebGL contexts per page and evict the oldest, so a dashboard with dozens of charts loses some of them. Draw them through one shared context with `renderer: sharedRenderer()` from `blazeplot/renderers/shared`, or use the Canvas 2D renderer for small charts. See [Performance recipes](./performance-recipes.md#many-charts-on-one-page). Also make sure every removed chart is disposed; see [React chart is duplicated or leaks](#react-chart-is-duplicated-or-leaks).

## Datasets throw or skip samples

All built-in datasets require finite, non-decreasing X, and parallel arrays of equal length.

- `new StaticDataset(x, y)`, `StaticOhlcDataset`, and `ServerSampledDataset` throw a `RangeError` naming the first bad index (for example `StaticDataset: X at index 2 is 1, below 2 at index 1 (decreasing-x)`). Sort the input with `StaticDataset.sorted(x, y)`, or pass `{ assumeSorted: true }` for data you already trust.
- A length mismatch throws a `RangeError` such as `RingBuffer.append: x has 100 values but y has 99.` and leaves the data unchanged.
- `RingBuffer` and `OhlcRingBuffer` (including chart-owned `chart.addLine({ capacity })` series) skip samples with a non-finite or backwards X instead of throwing, and log one console warning. Check `buffer.rejectedSamples` or pass `onInvalidSample` to see them. A stream whose timestamps go backwards after a clock reset looks like it "stopped"; call `series.clear()` first.
- `chart.addBar({ dataset })` with a variable-width `HistogramDataset` throws a `TypeError` until you pass `style.barWidth`.

See [Data semantics](./data-semantics.md#the-x-rule) for the full rules.

## A plugin instance is already installed

The stateful built-in plugins (a11y, annotations, crosshair, flame graph, navigator, selection) keep per-chart state, so one instance can serve only one chart at a time and a second install throws `<name> plugin instance is already installed on a chart. Create one plugin instance per chart.` Call the plugin function (`crosshairPlugin()`) once for each chart, inside the code that creates the chart. For linked layouts, use `panelPlugins`, which runs once per panel. Disposing a chart frees its plugin instances.

## Live chart keeps jumping away from the latest data

For live telemetry, prefer `followX` over repeatedly calling `fitToData()` on every sample. `fitToData()` is best for initial setup and explicit reset actions; `followX` keeps a fixed-width window pinned to the newest sample.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element, {
  followX: { window: 60_000, pauseOnInteraction: true, resumeAfterMs: 3000 },
  autoFitY: { padding: { y: 0.1 } },
});
```

You can also enable it after construction with `chart.followX(...)`. For timestamped streams that arrive in batches, add `currentX: () => Date.now()` so the viewport scrolls smoothly between batch arrivals. If the user pans or zooms and `pauseOnInteraction` is enabled, call `chart.setFollowXPaused(false)` when they click your "live" button, or set `resumeAfterMs` to resume automatically. Any pan or zoom pauses follow, including Y-only gestures such as dragging the Y axis; read `chart.getFollowXState()` or subscribe to `followxchange` to show a "jump to live" button. See [Live data](./live-data.md#following-the-latest-x-value).

## Live data does not repaint until interaction

The default render loop is on demand. It wakes automatically for chart-owned changes, including appends through the returned series object:

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element);
const series = chart.addLine({ capacity: 120_000, xStart: Date.now(), xStep: 1000, name: "signal" });
chart.start();

// Good: marks data/LOD dirty and requests a render.
series.append({ y: new Float32Array([1, 2, 3]) });
series.updateLast({ y: 4 });
```

If you mutate a dataset directly, BlazePlot cannot observe that write. Call `series.markDirty()` afterward:

```ts
dataset.appendY(new Float32Array([1, 2, 3]));
series.markDirty();
```

For OHLC streams, use `series.append({ x, open, high, low, close })` / `series.updateLast({ open, high, low, close })` rather than calling `OhlcRingBuffer` methods directly.

## Performance drops over time

- Append batches instead of single points when possible.
- Use `UniformRingBuffer` for fixed-rate signals so X values are derived instead of copied.
- Keep chart instances alive; update datasets instead of recreating charts.
- Call `chart.stop()` when a chart is hidden, and `chart.dispose()` when it is removed.
- Avoid large DOM overlays in hot paths. Legends, tooltips, annotation labels, and custom plugins still do DOM work.

See [Performance recipes](./performance-recipes.md) for deeper guidance.

## Log axis throws a domain error

A log axis requires a positive viewport. `fitToData()` leaves a log axis unchanged when its data includes zero or negative values. If the viewport still ends up invalid for the scale (for example through `chart.setViewport(...)`), the chart skips drawing, logs `BlazePlot skipped rendering: ...` once, and resumes as soon as the domain is valid. If your data can contain zero or negative values, use `scale: "symlog"` or keep the axis linear.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element, {
  axes: {
    y: { scale: "symlog", symlogConstant: 1 },
  },
});
```

## React chart is duplicated or leaks

Create `Chart` once inside an effect and dispose it from that effect's cleanup. Do not construct charts during render.

```tsx
import { useEffect, useRef } from "react";
import { Chart } from "blazeplot";

export function TelemetryPanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = new Chart(hostRef.current);
    return () => chart.dispose();
  }, []);

  return <div ref={hostRef} style={{ height: 320 }} />;
}
```

## Page scrolling and chart gestures

A chart sets no `touch-action`, so on its own it never blocks scrolling. Gestures take scrolling over only when a plugin asks for them:

- **`interactionsPlugin`** sets `touch-action: none` on the plot (and axis gutters) while `touchPan` or `pinchZoom` is on, and handles the wheel over the plot. If that traps scrolling on a long page, make it cooperative: `interactionsPlugin({ wheelZoom: "modifier", touchPan: "two-finger" })`. The wheel then scrolls the page unless Ctrl or Cmd is held (a trackpad pinch still zooms), and one finger scrolls while two fingers pan and zoom (the plot gets `touch-action: pan-x pan-y`; the axis gutters still take one-finger drags). A hint tells the user about the shortcut; reword it or turn it off with `gestureHint`. Or turn the gestures off with `wheelZoom: false`, `touchPan: false`, and `pinchZoom: false`.
- **`selectionPlugin`** sets `touch-action: none` so a touch drag selects.
- **`navigatorPlugin`** sets `touch-action: none` on its own overview strip only, not on the plot.
- **`tooltipPlugin` and `crosshairPlugin`** set `touch-action: pan-y` for their long-press gesture, so vertical swipes still scroll.
- **Your own plugin** opts into exclusive touch input explicitly: `ctx.dom.decorate("plot", { style: { touchAction: "none" } })`. Decorations combine by intersection, so the most restrictive plugin wins.

To keep the chart from reacting to touch at all, leave `interactionsPlugin` out or set `touchPan: false, pinchZoom: false`.

## Screenshots miss external UI

`chart.screenshot()` captures the WebGL plot plus BlazePlot-owned DOM overlays and layout reservations. It does not capture controls you render elsewhere in the page. Put plugin UI inside the chart root, or compose your app-level screenshot separately.
