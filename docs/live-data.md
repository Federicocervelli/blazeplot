# Live data

Use the series object returned by `chart.addLine(...)`, `chart.addOhlc(...)`, and related helpers for live writes. Series APIs update LOD state and wake the default on-demand render loop; direct dataset mutation is advanced and needs `series.markDirty()` afterward.

## Irregular samples

For timestamps or uneven X spacing, create a bounded ring buffer by passing `capacity` and append `{ x, y }` objects or typed-array batches.

```ts
import { Chart } from "blazeplot";

const chart = new Chart(element, {
  autoFitY: { padding: { y: 0.1 } },
});
const series = chart.addLine({ capacity: 120_000, name: "sensor" });

chart.followLatestX({ window: 60_000, pauseOnInteraction: true, resumeAfterMs: 3000 });
chart.start();

socket.onmessage = (event) => {
  const sample = JSON.parse(event.data) as { timestamp: number; value: number };
  series.append({ x: sample.timestamp, y: sample.value });
};
```

For higher throughput, append batches:

```ts
series.append({ x: timestampArray, y: valueArray });
```

Keep X values sorted in append order. Picking, binary search, and LOD assume sorted logical X values.

## Fixed-rate samples

For signals with constant sample spacing, use the `{ capacity, xStart, xStep }` shorthand. BlazePlot creates an implicit-X `UniformRingBuffer`, so you only append Y values.

```ts
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

Use `updateLast(...)` when a feed revises the latest point instead of adding a new one.

```ts
series.updateLast({ y: latestValue });
series.updateLast({ x: latestTimestamp, y: latestValue });
```

Use `updateAt(index, ...)` for corrections to existing samples:

```ts
series.updateAt(42, { y: correctedValue });
```

## OHLC and candlesticks

Live candle feeds often append a new candle, then update it until the interval closes.

```ts
import { OhlcRingBuffer } from "blazeplot";

const candles = chart.addCandlestick({ dataset: new OhlcRingBuffer(10_000), name: "candles" });

candles.append({ x, open, high, low, close });
candles.updateLast({ open, high, low, close });
```

For historical corrections, use a logical index:

```ts
candles.updateAt(index, { open, high, low, close });
```

## Following the latest X value

`followX` or `chart.followLatestX(...)` keeps a rolling X window pinned to the newest visible series sample. It is applied during rendering, so it cooperates with the on-demand render loop and built-in interaction plugins.

```ts
chart.followLatestX({
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
- `chart.resumeLatestXFollow()` jumps back to live immediately.
- `chart.stopFollowingLatestX()` disables live-follow.

Y-axis interactions do not pause X follow. X pan/zoom operations through the chart/plugin APIs do pause when `pauseOnInteraction` is enabled.

## Direct dataset mutation

If you intentionally mutate a dataset directly, call `series.markDirty()` afterward:

```ts
dataset.appendY(batch);
series.markDirty();
```

Prefer series APIs unless you are implementing a custom ingestion layer.
