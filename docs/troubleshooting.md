# Troubleshooting

Use this page when a chart renders blank, feels slow, or behaves differently from the examples.

## Start with the symptom

| Symptom | Check first | Detailed section |
|---|---|---|
| Empty area or no plot | Host size, WebGL2, viewport, render loop, sorted finite data | [Blank chart](#blank-chart) |
| Live view keeps resetting | Repeated `fitToData()` calls instead of `followX` | [Live chart keeps jumping away from the latest data](#live-chart-keeps-jumping-away-from-the-latest-data) |
| Live data only updates after pan/zoom | Direct dataset mutation without `series.markDirty()` | [Live data does not repaint until interaction](#live-data-does-not-repaint-until-interaction) |
| Chart slows down over time | Per-point appends, chart recreation, hidden render loops, DOM overlays | [Performance drops over time](#performance-drops-over-time) |
| Log axis fails | Zero or negative viewport values | [Log axis throws a domain error](#log-axis-throws-a-domain-error) |
| React chart remounts | Unstable `options` identity or missing effect cleanup | [React chart recreates unexpectedly](#react-chart-recreates-unexpectedly) |
| Screenshot omits controls | Controls live outside the chart root | [Screenshots miss external UI](#screenshots-miss-external-ui) |

## Blank chart

Check these first:

1. **The host element has size.** BlazePlot fills its container; a `0px`-tall parent produces a `0px` plot.
2. **The browser supports WebGL2.** BlazePlot does not include a Canvas2D or SVG fallback. Use `isWebGL2Available()` if you need to show a fallback UI.
3. **The chart has a viewport.** Call `chart.fitToData()` after adding initial series, or set a viewport explicitly with `chart.setViewport(...)`.
4. **Render scheduling is active.** Call `chart.start()` after setup. The default mode renders when chart-owned state changes and then idles; append through series APIs or call `series.markDirty()` after direct dataset mutation. Use `chart.start({ renderLoop: "continuous" })` only for custom animations.
5. **The data is finite and sorted.** Built-in datasets expect ascending X values. Non-finite Y values create gaps.

```ts
import { Chart, StaticDataset, isWebGL2Available } from "blazeplot";

if (!isWebGL2Available()) {
  showUnsupportedBrowserMessage();
} else {
  const chart = new Chart(element);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "series" });
  chart.fitToData({ padding: 0.05 });
  chart.start();
}
```

## Live chart keeps jumping away from the latest data

For live telemetry, prefer `followX` over repeatedly calling `fitToData()` on every sample. `fitToData()` is best for initial setup and explicit reset actions; `followX` keeps a fixed-width window pinned to the newest sample.

```ts
const chart = new Chart(element, {
  followX: { window: 60_000, pauseOnInteraction: true, resumeAfterMs: 3000 },
  autoFitY: { padding: { y: 0.1 } },
});
```

You can also enable it after construction with `chart.followLatestX(...)`. For timestamped streams that arrive in batches, add `currentX: () => Date.now()` so the viewport scrolls smoothly between batch arrivals. If the user pans or zooms and `pauseOnInteraction` is enabled, call `chart.resumeLatestXFollow()` when they click your "live" button, or set `resumeAfterMs` to resume automatically.

## Live data does not repaint until interaction

The default render loop is on demand. It wakes automatically for chart-owned changes, including appends through the returned series object:

```ts
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

A log axis requires a positive viewport. If your data can contain zero or negative values, use `scale: "symlog"` or keep the axis linear.

```ts
const chart = new Chart(element, {
  axes: {
    y: { scale: "symlog", symlogConstant: 1 },
  },
});
```

## React chart recreates unexpectedly

`BlazeChart` recreates the chart when the `options` object identity changes. Keep options stable with `useMemo`, and clean up your own timers, workers, and subscriptions in effects.

```tsx
const options = useMemo(() => ({ plugins: [interactionsPlugin()] }), []);

return <BlazeChart options={options} onChart={setupChart} />;
```

## Screenshots miss external UI

`chart.screenshot()` captures the WebGL plot plus BlazePlot-owned DOM overlays and layout reservations. It does not capture controls you render elsewhere in the page. Put plugin UI inside the chart root, or compose your app-level screenshot separately.
