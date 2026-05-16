# BlazePlot

[![npm version](https://img.shields.io/npm/v/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![npm downloads](https://img.shields.io/npm/dt/blazeplot.svg)](https://www.npmjs.com/package/blazeplot)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/Federicocervelli/blazeplot/release.yml?branch=master)](https://github.com/Federicocervelli/blazeplot/actions)

Real-time LOD time series rendering engine for the browser.

BlazePlot is GPU-native plotting engineered for high-frequency streaming data where standard charting libraries (Chart.js, ECharts, uPlot) fall over. Instead of drawing every sample, it keeps a resident ring buffer of millions of points, builds a min/max LOD pyramid, and renders only what each pixel needs — so frame cost is `O(pixels)`, not `O(samples)`.

Built on WebGL2 + [regl](https://github.com/regl-project/regl). No Canvas2D, no SVG, no DOM layout.

## Target

- **10M+** resident points per series
- **60 Hz** smooth append + render
- **Zero allocations** in the frame loop
- **Multi-series** with independent buffers and LOD

## Installation

```bash
bun install blazeplot
```

## Quick start

```html
<canvas id="chart" style="width:100%;height:400px"></canvas>
```

```js
import { Chart } from "blazeplot";

const canvas = document.getElementById("chart");
const chart = new Chart(canvas);

const series = chart.addSeries(
  { mode: "line", capacity: 1_000_000, downsample: "minmax" },
  { color: [0.3, 0.6, 1.0, 1.0] },
);

chart.setViewport({ xMin: 0, xMax: 1000, yMin: -2, yMax: 2 });
chart.start();

// Append data periodically
function push() {
  const n = 256;
  const xs = new Float64Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = t++;
    ys[i] = Math.sin(t * 0.01) * 0.5 + Math.random() * 0.01;
  }
  series.append(xs, ys);
  requestAnimationFrame(push);
}
let t = 0;
push();
```

## Features

| | |
|---|---|
| **LOD downsampling** | Min/max pyramid automatically selects the right detail level for the visible range — sparse viewports show raw points, dense viewports show vertical min/max segments. |
| **Streaming append** | Fixed-capacity ring buffer wraps silently. No re-allocation. No memory growth. |
| **Pan & zoom** | Pointer/touch pan and wheel zoom via `Camera2D`. Customizable viewport policies (e.g. live-follow X while Y is free). |
| **Grid lines** | Data-anchored grid rendered as WebGL line lists. |
| **Multi-series** | Independent buffers, styles, and visibility per series. |
| **No DOM** | No axis DOM elements, no SVG overlay. The canvas owns everything. |
| **ResizeObserver** | Automatic DPR-aware canvas sizing. |

## API

### `Chart`

| Signature | Description |
|---|---|
| `new Chart(canvas, options?)` | Create a chart from an HTML canvas element. |
| `chart.addSeries(config, style?)` | Add a data series. Returns `SeriesStore`. |
| `chart.removeSeries(series)` | Remove a previously added series. |
| `chart.setViewport({ xMin, xMax, yMin, yMax })` | Set the visible data range. |
| `chart.resize(dpr?)` | Resize the canvas to match its CSS size × DPR. |
| `chart.start()` | Start the render loop (rAF). |
| `chart.stop()` | Stop the render loop. |
| `chart.getFrameStats(target?)` | Copy per-frame benchmark counters into a reusable object. |
| `chart.dispose()` | Dispose GPU resources, observers, and input handlers. |

### `ChartOptions`

| Property | Default | Description |
|---|---|---|
| `viewportPolicy?` | — | Custom pan/zoom/viewport behavior hooks. |
| `grid?` | `true` | Show grid lines. |
| `gridStyle?` | `{ color: [0.22,0.30,0.44,0.45] }` | Grid line color and width. |

### `ChartFrameStats`

| Field | Description |
|---|---|
| `fps` | Instantaneous render-loop FPS. |
| `frameMs` | Milliseconds spent in `render()`. |
| `pointsRendered` | Number of vertices drawn this frame. |
| `drawCalls` | Number of GPU draw calls this frame. |
| `uploadBytes` | Bytes uploaded to GPU this frame. |
| `renderMode` | `"none"` / `"raw"` / `"minmax"` / `"mixed"`. |

### `SeriesStore`

| Signature | Description |
|---|---|
| `series.append(xs, ys)` | Append typed arrays of X (Float64) and Y (Float32) values. |
| `series.clear()` | Clear all data and reset LOD state. |
| `series.setVisible(v)` | Toggle visibility. |
| `series.visible` | Current visibility state. |
| `series.length` | Number of samples buffered. |

### `SeriesConfig`

| Property | Description |
|---|---|
| `mode` | `"line"` / `"envelope"` / `"scatter"` (envelope and scatter roadmap-only). |
| `capacity` | Ring buffer capacity (samples). |
| `downsample` | `"minmax"` (the only LOD strategy). |

### `SeriesStyle`

| Property | Default | Description |
|---|---|---|
| `color` | `[0.3, 0.6, 1.0, 1.0]` | RGBA float color. |
| `lineWidth` | `1` | Line width in pixels. |

### `ViewportPolicy`

```ts
interface ViewportPolicy {
  beforePan?(camera: Camera2D, intent: PanIntent): PanIntent | null;
  beforeZoom?(camera: Camera2D, intent: ZoomIntent): ZoomIntent | null;
  beforeRender?(camera: Camera2D): void;
}
```

Built-in data types: `Viewport`, `PanIntent`, `ZoomIntent`, `ZoomAxis`.

### Lower-level primitives

`Camera2D`, `RingBuffer`, `MinMaxPyramid`, `AxisController` are exported for advanced use cases (custom pipelines, worker threads, offscreen rendering).

## How it works

```
Data stream ──► RingBuffer (resident, wraps at capacity)
                   │
                   ▼
              MinMaxPyramid (full rebuild today, incremental roadmap)
                   │
                   ▼
              SeriesStore.query() ──► LODView (buckets for visible range)
                                    │
                                    ▼
                              Renderer (regl / WebGL2)
```

The render loop decides per-frame:
- **Few visible samples** → raw line strip from ring buffer
- **Many visible samples** → min/max vertical segments from the pyramid

## Architecture

```
src/
  core/          # Data engine — no UI, no GPU
  render/        # GPU abstraction + regl backend
  interaction/   # Camera, input, axis ticks
  ui/            # Orchestrator (Chart)
```

## Development

```bash
bun install
bun run dev          # Vite dev server → preview/
bun run build        # Package build (JS + declarations)
bun run build:js     # JS-only build
bun test             # Core data-structure tests
bun run typecheck    # TypeScript strict check
```

## Package build

```bash
bun run build
```

Output:

```
dist/index.js        ES module
dist/index.d.ts      TypeScript declarations
dist/index.js.map    Source map
dist/*.d.ts.map      Declaration maps
```


