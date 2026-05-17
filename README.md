<p align="center">
  <img src="assets/blazeplot.png" alt="BlazePlot" width="720" />
</p>

[![npm version](https://img.shields.io/npm/v/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![npm downloads](https://img.shields.io/npm/dt/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Fast WebGL2 plotting engine for the browser 🔥

Built for people who have hit the performance ceiling of Chart.js, Plotly, and similar browser charting libraries. BlazePlot keeps the hot path GPU-native and the DOM minimal, so large streaming datasets stay interactive instead of turning into a slideshow.

Built on WebGL2 + [regl](https://github.com/regl-project/regl).

## Installation

```bash
bun install blazeplot
```

## Quick start

```html
<div id="chart" style="width:100%;height:400px"></div>

<script type="module">
  import { Chart } from "blazeplot";

  const chart = new Chart(document.getElementById("chart"));
  const wave = chart.addLine({ capacity: 10_000, downsample: "minmax" });

  wave.append(
    Float64Array.from({ length: 1000 }, (_, i) => i),
    Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.02)),
  );

  chart.setViewport({ xMin: 0, xMax: 1000, yMin: -1.5, yMax: 1.5 });
  chart.start();
</script>
```

## Features

| | |
|---|---|
| **WebGL2 rendering** | GPU-accelerated plot rendering from the ground up. No Canvas2D fallback. Axis labels use lightweight DOM layers. |
| **Flexible data model** | Streaming ring buffer or static arrays. Bring your own data shape. |
| **LOD downsampling** | Min/max pyramid for efficient line rendering at any zoom level — sparse views show raw points, dense views show vertical segments. |
| **Pan & zoom** | Pointer/touch pan and wheel zoom via `Camera2D`. Customizable viewport policies. |
| **Grid lines** | Data-anchored grid rendered as WebGL line lists. |
| **Axis labels** | Smart tick generation with DOM labels. Per-axis `inside`/`outside` positioning; outside axes reserve real layout gutters. |
| **Multi-series** | Independent buffers, styles, and visibility per series. Line, area, scatter, and bar modes are supported. |
| **Plugin-ready UI** | Optional built-in `legendPlugin()` and `tooltipPlugin()` use the same public state and hover APIs available to custom plugins. |
| **Benchmark overlay** | Built-in fps, frame time, vertex count, draw calls. |
| **ResizeObserver** | Automatic DPR-aware canvas sizing. |

## API

### `Chart`

| Signature | Description |
|---|---|
| `new Chart(container, options?)` | Create a chart inside an HTML container element. The chart owns the plot canvas and axis layout. |
| `chart.addSeries(config, style?)` | Add a data series. Returns `SeriesStore`. |
| `chart.addLine(config, style?)` / `addArea` / `addScatter` / `addBar` / `addOhlc` / `addCandlestick` | Typed helpers that set the series mode for you. |
| `chart.removeSeries(series)` | Remove a previously added series. |
| `chart.setViewport({ xMin, xMax, yMin, yMax })` | Set the visible data range. |
| `chart.getViewport()` | Return the current visible data range. |
| `chart.pan(intent)` / `chart.zoom(intent)` | Plugin-facing camera interaction helpers. |
| `chart.clientToData(clientX, clientY)` / `chart.dataToPlot(x, y)` | Convert between client/plot coordinates and data coordinates. |
| `chart.resize(dpr?)` | Resize the internal plot canvas to match its CSS size × DPR. |
| `chart.start()` | Start the render loop (rAF). |
| `chart.stop()` | Stop the render loop. |
| `chart.canvas` | Read-only access to the internal plot canvas. |
| `chart.xAxisElement` / `chart.yAxisElement` | Plugin-facing access to outside axis gutter elements. |
| `chart.theme` | Resolved theme values used by the chart and built-in plugins. |
| `chart.getFrameStats(target?)` | Copy per-frame benchmark counters into a reusable object. |
| `chart.getSeriesState()` | Return public series metadata/state for plugins or custom UI. |
| `chart.setSeriesVisible(series, visible)` | Toggle visibility and notify series-state subscribers. |
| `chart.pick(clientX, clientY, options?)` | Raw-data hit test. Supports `mode: "nearest-x" | "nearest-point"`, `group: "x" | "none"`, and `maxDistancePx`; returned items include actual sample X/Y and plot/client coordinates for highlights. |
| `chart.subscribe("hover", cb)` / `chart.subscribe("serieschange", cb)` | Subscribe to hover or series state changes. Returns an unsubscribe function. |
| `await chart.screenshot(options?)` | Export the full chart as an image `Blob`, including the WebGL plot and built-in DOM text overlays. |
| `chart.dispose()` | Dispose GPU resources, observers, input handlers, and owned DOM layout. |

### `ChartOptions`

| Property | Default | Description |
|---|---|---|
| `viewportPolicy?` | — | Optional `beforeRender` viewport hook. Pass the same policy to `interactionsPlugin({ viewportPolicy })` for pan/zoom hooks. |
| `hover?` | `{ mode: "nearest-x", group: "x" }` | Default hover picking behavior. `mode` can be `"nearest-x"` or `"nearest-point"`; `group: "x"` reports one item per visible series at the selected X, while `group: "none"` reports only the selected point. |
| `plugins?` | `[]` | Optional `ChartPlugin` instances, e.g. `legendPlugin()` and `tooltipPlugin()`. |
| `theme?` | built-in dark theme | Override chart, axis, palette, legend, and tooltip colors/fonts. |
| `grid?` | `true` | Show grid lines. |
| `gridStyle?` | `{ color: theme.gridColor }` | Grid line color and width; overrides the theme grid color. |
| `axes?` | `true` | Show axis tick labels. `true`/`false`, or per-axis `{ x?: boolean \| AxisConfig, y?: boolean \| AxisConfig }`. |

### `ChartTheme`

```css
:root {
  --plot-bg: #050816;
  --plot-grid: rgb(148 163 184 / 0.22);
  --plot-axis: #cbd5e1;
  --series-a: #38bdf8;
  --series-b: oklch(70% 0.19 22);
}
```

```ts
new Chart(container, {
  theme: {
    backgroundColor: "var(--plot-bg)",
    gridColor: "var(--plot-grid)",
    axisColor: "var(--plot-axis)",
    seriesColors: ["var(--series-a)", "var(--series-b)"],
    tooltipBackgroundColor: "rgb(4 8 16 / 0.85)",
    legendBackgroundColor: "rgb(4 8 16 / 0.85)",
  },
});
```

WebGL-facing colors (`backgroundColor`, `gridColor`, `seriesColors`) accept either normalized RGBA tuples (`[r,g,b,a]`) or CSS colors, including CSS variables inherited by the chart container. BlazePlot resolves CSS colors internally to WebGL-compatible RGBA floats while preserving CSS strings for DOM styling where appropriate. Per-series styles and plugin options still override theme defaults.

### `AxisConfig`

| Property | Default | Description |
|---|---|---|
| `visible?` | `true` | Show this axis. |
| `position?` | `"inside"` | `"inside"` draws labels over the plot; `"outside"` reserves a real DOM gutter and shrinks the plot canvas. |

```ts
// X labels outside (bottom gutter), Y labels inside
new Chart(canvas, {
  axes: { x: { position: "outside" }, y: true }
});
```

### `ChartFrameStats`

| Field | Description |
|---|---|
| `fps` | Instantaneous render-loop FPS. |
| `frameMs` | Milliseconds spent in `render()`. |
| `pointsRendered` | Number of vertices drawn this frame. |
| `drawCalls` | Number of GPU draw calls this frame. |
| `uploadBytes` | Bytes uploaded to GPU this frame. |
| `renderMode` | `"none"` / `"raw"` / `"minmax"` / `"points"` / `"bars"` / `"area"` / `"mixed"`. |

### Plugins

```js
import { Chart } from "blazeplot";
import { interactionsPlugin } from "blazeplot/plugins/interactions";
import { legendPlugin } from "blazeplot/plugins/legend";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const chart = new Chart(container, {
  hover: { mode: "nearest-x", group: "x" },
  plugins: [
    interactionsPlugin({ axis: "xy" }),
    legendPlugin(),
    tooltipPlugin({ mode: "nearest-point", group: "none", maxDistancePx: 24 }),
  ],
});
```

Built-in plugins are optional. `interactionsPlugin()` provides plain-drag box zoom, Shift+drag plot pan, wheel zoom, double-click reset, and `axis: "x" | "y" | "xy"`. When outside axes are visible, scrolling an axis zooms that axis and dragging an axis pans that axis; the plugin also applies a subtle axis hover color/filter configurable with `axisHover`, `axisHoverColor`, and `axisHoverFilter`. Legend/tooltip consume public APIs (`getSeriesState`, `setSeriesVisible`, `pick`, and `subscribe`) so custom UI can use the same contract. The default tooltip updates while the cursor is still on live charts and highlights the raw sample(s) it is reporting. For shared time-series tooltips, use `group: "x"`; for scatter/true point hover, use `group: "none"`.

### `SeriesStore`

| Signature | Description |
|---|---|
| `series.append(xs, ys)` | Append typed arrays of X and Y values (streaming). |
| `series.clear()` | Clear all data and reset. |
| `series.setVisible(v)` | Toggle visibility. |
| `series.visible` | Current visibility state. |
| `series.length` | Number of samples buffered. |

### `SeriesConfig`

| Property | Description |
|---|---|
| `mode` | `"line"` / `"area"` / `"scatter"` / `"bar"` / `"ohlc"` / `"candlestick"` / `"envelope"` (envelope roadmap-only). |
| `capacity` | Ring buffer capacity (samples). |
| `id?` / `name?` | Optional metadata exposed to plugins, legend, and tooltip rows. |
| `downsample` | `"minmax"` or `"none"`. Min/max LOD applies to line and bar rendering; area/scatter skip LOD. |

### `SeriesStyle`

| Property | Default | Description |
|---|---|---|
| `color` | `[0.3, 0.6, 1.0, 1.0]` | RGBA float color. |
| `lineWidth` | `1` | Line width in pixels. |
| `pointSize` | `4` | Scatter point size in CSS pixels. |
| `barWidth` | `0.8` | Bar width in data-space X units. |
| `baseline` | `0` | Area/bar baseline in data-space Y units. |
| `fillColor` | line color with 25% alpha | Area fill RGBA color. |
| `tickWidth` | `barWidth` or `0.8` | OHLC open/close tick width in data-space X units. |
| `upColor` / `downColor` | series color / translucent fill | Candlestick body colors. |
| `wickColor` | series color | Candlestick wick color. |

### `ViewportPolicy`

`beforeRender` is consumed by `Chart`; `beforePan` and `beforeZoom` are consumed by `interactionsPlugin({ viewportPolicy })`.

```ts
interface ViewportPolicy {
  beforePan?(camera: Camera2D, intent: PanIntent): PanIntent | null;
  beforeZoom?(camera: Camera2D, intent: ZoomIntent): ZoomIntent | null;
  beforeRender?(camera: Camera2D): void;
}
```

### Lower-level primitives

`Camera2D`, `RingBuffer`, `MinMaxPyramid`, `AxisController` are exported for advanced use cases.

## Architecture

```
src/
  core/          # Data model — series, datasets, LOD
  render/        # GPU abstraction + regl backend
  interaction/   # Camera, axis ticks, interaction intent types
  ui/            # Orchestrator (Chart)
```

## Development

```bash
bun install
bun run dev          # Vite dev server → preview/
bun run build        # Package build (JS + declarations)
bun test             # Tests
bun run typecheck    # TypeScript strict check
```
