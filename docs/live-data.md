# Live data

Use the series object returned by `chart.addLine(...)`, `chart.addOhlc(...)`, and related helpers for live writes. Series APIs update LOD state and wake the default on-demand render loop; direct dataset mutation is advanced and needs `series.markDirty()` afterward.

## Irregular samples

For timestamps or uneven X spacing, create a bounded ring buffer by passing `capacity` and append `{ x, y }` objects or typed-array batches.

```ts
import { Chart } from "blazeplot";

const socket = new WebSocket("wss://example.com/sensor");
const chart = new Chart(element, {
  autoFitY: { padding: { y: 0.1 } },
});
const series = chart.addLine({ capacity: 120_000, name: "sensor" });

chart.followX({ window: 60_000, pauseOnInteraction: true, resumeAfterMs: 3000 });
chart.start();

socket.onmessage = (event) => {
  const sample = JSON.parse(event.data) as { timestamp: number; value: number };
  series.append({ x: sample.timestamp, y: sample.value });
};
```

For higher throughput, append batches:

```ts
const timestampArray = new Float64Array([1_700_000_000_000, 1_700_000_000_050]);
const valueArray = new Float32Array([0.2, 0.4]);
series.append({ x: timestampArray, y: valueArray });
```

Keep X values sorted in append order. Picking, binary search, and LOD assume sorted logical X values. The chart-owned buffer skips (and counts) a sample whose X is non-finite or lower than the newest one instead of throwing; pass `onInvalidSample` in the series config to observe them. When the buffer is full the oldest samples are dropped; set `overflow: "drop-new"` or `"error"` in the series config for other behavior. See [Data semantics](./data-semantics.md#streaming-skip-count-report).

## Fixed-rate samples

For signals with constant sample spacing, use the `{ capacity, xStart, xStep }` shorthand. BlazePlot creates an implicit-X `UniformRingBuffer`, so you only append Y values. Passing either `xStart` or `xStep` selects it (`xStart` defaults to 0 and `xStep` to 1). A uniform buffer always wraps, so combining the shorthand with `overflow: "drop-new"` or `"error"` throws a `TypeError`.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element, {
  followX: { window: 10_000, pauseOnInteraction: true },
});
const series = chart.addLine({
  capacity: 60_000,
  xStart: performance.now(),
  xStep: 16.6667,
  name: "fixed-rate signal",
});
chart.start();

series.append({ y: new Float32Array([0.2, 0.4, 0.3]) });
```

Use typed arrays for frequent or large batches. Object-row batches are convenient for moderate-rate feeds:

```ts
series.append([{ y: 0.2 }, { y: 0.4 }, { y: 0.3 }]);
```

## Updating the active sample

Use `updateLast(...)` when a feed revises the latest point instead of adding a new one. `{ y }` works on `RingBuffer` and `UniformRingBuffer` series; `{ x, y }` needs an explicit-X buffer such as `RingBuffer` (it throws a `TypeError` on a fixed-rate series), and a revised X must stay between its neighbors or the update returns `false`. Both return whether the sample was updated.

```ts
const latestValue = 0.5;
const latestTimestamp = Date.now();

series.updateLast({ y: latestValue });
series.updateLast({ x: latestTimestamp, y: latestValue });
```

Use `updateAt(index, ...)` for corrections to existing samples:

```ts
const correctedValue = 0.45;

series.updateAt(42, { y: correctedValue });
```

## Replacing a whole signal

For spectra, waveforms, or any chart that redraws all of its points each frame, keep one series and swap its data instead of removing and re-adding the line. The series keeps its color, legend entry, and hover state.

```ts
import { Chart, StaticDataset } from "blazeplot";

const frequencies = new Float64Array([20, 100, 1_000, 10_000]);
const magnitudes = new Float32Array([-60, -30, -10, -50]);

const chart = new Chart(element);
const spectrum = chart.addLine({ dataset: new StaticDataset(frequencies, magnitudes), name: "spectrum" }, { lineWidth: 2 });
chart.setViewport({ xMin: frequencies[0]!, xMax: frequencies[frequencies.length - 1]!, yMin: -120, yMax: 0 });
chart.start();

function onFrame(next: Float32Array) {
  spectrum.replace({ y: next }); // keeps the current X array; pass { x, y } to change both
}
```

`replace` adopts the arrays you pass without copying them, so give it a fresh array per frame or stop writing to the old one. If you prefer to reuse one buffer, overwrite it and call `series.markDirty()` instead. Both rebuild the dense min/max index lazily (about 1 ms per frame at one million points) and request a redraw. `ServerSampledDataset` supports the same `series.replace(...)` call for pre-reduced data.

## OHLC and candlesticks

Live candle feeds often append a new candle, then update it until the interval closes.

```ts
import { OhlcRingBuffer } from "blazeplot";

const candles = chart.addCandlestick({ dataset: new OhlcRingBuffer(10_000), name: "candles" });

const [x, open, high, low, close] = [Date.now(), 100, 104, 99, 102];
candles.append({ x, open, high, low, close });
candles.updateLast({ open, high, low, close });

// For historical corrections, use a logical index.
candles.updateAt(0, { open, high, low, close });
```

## Following the latest X value

`followX` or `chart.followX(...)` keeps a rolling X window pinned to the newest visible series sample. It is applied during rendering, so it cooperates with the on-demand render loop and built-in interaction plugins.

```ts
chart.followX({
  window: 30_000,
  pauseOnInteraction: true,
  resumeAfterMs: 5000,
  currentX: () => Date.now(), // optional: smooth clock-driven scroll between batched updates
});
```

- `window` controls the visible X span.
- `pauseOnInteraction` lets pan/zoom and box zoom stop live-follow while the user inspects history.
- `resumeAfterMs` optionally resumes after interaction inactivity.
- `currentX` is useful for timestamped real-time streams; it lets the viewport move continuously with the clock instead of stepping only when batches arrive.
- `chart.setFollowXPaused(false)` jumps back to live immediately; `chart.getFollowXState()` returns `"off"`, `"following"`, or `"paused"` for your UI.
- `chart.stopFollowX()` disables live-follow.
- With the built-in interactions plugin, double-click/tap reset resumes follow by default. Pass `interactionsPlugin({ resumeFollowOnReset: false })` to keep reset on a historical viewport.

With `pauseOnInteraction` enabled (the default), every `chart.pan(...)` and `chart.zoom(...)` call that moves X pauses follow, and so does any `chart.setViewport(...)` call that changes X (unless you pass `{ pauseFollow: false }`). Viewport changes that come from following itself, `fitToData`, or `autoFitY` do not pause it. Y-only gestures (dragging a Y axis, wheel zoom over a Y axis, or `chart.zoom({ axis: "y", ... })` and `chart.pan({ dx: 0, ... })`) leave follow running and emit no `followxchange`, so users can rescale Y without leaving live mode. In linked charts the same holds for every panel.

### Telling user changes from automatic ones

Every `viewportchange` event carries a `source`: `"user"` (gestures from the interactions, navigator, and a11y plugins), `"follow"` (latest-X following), `"fit"` (`fitToData` and `autoFitY`), `"linked"` (a linked panel mirroring another), or `"api"` (your own `setViewport`, `pan`, or `zoom` call). Filter on it to persist "the user zoomed to ..." or to show a "jump to live" button without reacting to the stream of follow updates. `chart.subscribe("followxchange", ({ state }) => ...)` fires when following starts, stops, pauses, or resumes.

```ts
chart.subscribe("viewportchange", ({ viewport, source }) => {
  if (source === "user") localStorage.setItem("range", `${viewport.xMin},${viewport.xMax}`);
});
```

Plugins pass the source through the viewport API, for example `ctx.viewport.pan(intent, yAxis, { source: "user" })`. `chart.setViewport(viewport, yAxis, { pauseFollow: false })` changes X without pausing latest-X following.

### Linked charts and live follow

With `createLinkedCharts`, panels that all use `followX` stay in sync and keep following while data streams: mirrored updates do not pause the receiving panel. Pausing and resuming follow is shared, so a user pan on one panel pauses every following panel, and `setFollowXPaused(false)` on any panel resumes them all.

## Direct dataset mutation

If you intentionally mutate a dataset directly, call `series.markDirty()` afterward:

```ts
const batch = new Float32Array([0.2, 0.4, 0.3]);

dataset.appendY(batch);
series.markDirty();
```

Prefer series APIs unless you are implementing a custom ingestion layer.
