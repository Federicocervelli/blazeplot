# Example recipes

This project ships live previews under `preview/` and React examples under `examples/react/`.

## Financial OHLC / candlestick

Use `StaticOhlcDataset` for historical data or `OhlcRingBuffer` for live feeds, then add either:

```ts
chart.addOhlc({ dataset });
chart.addCandlestick({ dataset });
```

## Multi-panel dashboards

Use `blazeplot/linked` to create stacked or side-by-side charts with synchronized X ranges and independent Y axes.

## Annotations

Use `blazeplot/plugins/annotations` for x/y lines, ranges, boxes, points, labels, and hit events.

## Export workflows

Use `chart.screenshot()` for a `Blob`, or `blazeplot/export` helpers for download/clipboard flows.

## React integration

Use `blazeplot/react` and pass plugins/options through the `BlazeChart` component. Keep series creation in effects and dispose chart/plugin resources on unmount.
