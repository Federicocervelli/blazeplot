# Browser support

BlazePlot targets modern browsers with WebGL2 and draws with Canvas 2D where WebGL2 is unavailable or unreliable. Both engines ship in the core package and are fully supported; the default `renderer: "auto"` picks between them.

## Requirements

| Feature | Used for | Notes |
|---|---|---|
| WebGL2 | Plot rendering | Preferred by the default renderer. With `renderer: "webgl2"` or `"shared"` BlazePlot throws `WebGL2UnavailableError` when a chart cannot create a WebGL2 context; the default `"auto"` falls back to Canvas 2D instead. See [Rendering engines](#rendering-engines). |
| Canvas 2D | Plot rendering without WebGL2 | Used by `renderer: "canvas2d"` and by `"auto"` when WebGL2 fails. Available in every browser that can draw a `<canvas>`. |
| Pointer Events | Built-in interactions | Used for pan, zoom, box selection, touch gestures, and plugin hit testing. |
| `ResizeObserver` | Automatic layout updates | Optional. Without it, call `chart.resize()` after container size changes. |
| Async Clipboard API + `ClipboardItem` | Clipboard export helpers | Optional. Browsers usually require HTTPS and a user gesture. Download helpers still work without clipboard support. |

A chart keeps drawing without WebGL2 by default. If your app would rather show its own fallback UI, check `isWebGL2Available()` before creating a chart and ask for the strict `"webgl2"` engine.

```ts
import { Chart, isWebGL2Available } from "blazeplot";

if (isWebGL2Available()) {
  const chart = new Chart(element, { renderer: "webgl2" });
  chart.start();
} else {
  element.textContent = "This chart needs WebGL2.";
}
```

## Rendering engines

A chart draws through one of three engines, chosen with `ChartOptions.renderer`. All three ship in the core `blazeplot` package (nothing extra to import), and all three are stable: every series type (line, area, bar, scatter, OHLC, candlestick, histogram), gaps, log/symlog and reversed axes, dual Y axes, wide lines, `chart.screenshot()`, every built-in plugin, and the flame graph plugin work on each.

| `renderer` | Factory | Draws with | If it cannot start |
|---|---|---|---|
| `"auto"` (default) | `autoRenderer()` | WebGL2, otherwise Canvas 2D | Falls back quietly (browsers with hardware acceleration off, GPU blocklists, privacy-hardened browsers, headless screenshot pipelines, pages that used up the WebGL context cap). Throws `WebGL2UnavailableError` only when neither engine can start. |
| `"webgl2"` | `webgl2Renderer()` | WebGL2, one context per chart | Throws `WebGL2UnavailableError`. |
| `"canvas2d"` | `canvas2dRenderer()` | Canvas 2D (CPU-projected) | Throws `Canvas2DUnavailableError` (rare: the canvas cannot create a 2D context). |
| `"shared"` | `sharedRenderer(context?)` | One WebGL2 context shared by every chart on the document, or by the charts of one `createChartRenderContext()` | Throws `WebGL2UnavailableError`. See [Many charts on one page](./performance-recipes.md#many-charts-on-one-page). |

A name is shorthand for its factory, and an unknown value throws a `TypeError` that lists the valid names. `createLinkedCharts` takes the same `renderer` option for every panel. Read the outcome from the chart:

```ts
import { Chart, StaticDataset } from "blazeplot";

const chart = new Chart(element); // renderer: "auto"
chart.addLine({ dataset: new StaticDataset(new Float64Array([0, 1, 2]), new Float32Array([0, 1, 0])) });
chart.fitToData();
chart.start();

console.log(chart.renderer); // "webgl2", "canvas2d", or "shared"
console.log(chart.rendererInfo);
// On a machine without WebGL2:
// { name: "canvas2d", requested: "auto", fallbackFrom: "webgl2", capabilities: { gpu: false, ... } }
// Later: chart.dispose();
```

`chart.rendererInfo` (also `ctx.renderer` inside a plugin) has `name` (the engine in use), `requested` (what the option asked for: a name or `"auto"`; a factory reports the name it stands for), `fallbackFrom` (set when `"auto"` had to skip WebGL2), and `capabilities`:

| Capability | `webgl2` | `canvas2d` | `shared` |
|---|---|---|---|
| `gpu` (draws on the GPU) | yes | no | yes |
| `contextLoss` (reports loss and restore) | yes | yes | yes |
| `shared` (the context belongs to several charts) | no | no | yes |
| `maxDrawingBufferPixels` | the context's maximum viewport area | 16,384 x 16,384 (a typical desktop limit; browsers do not expose theirs) | the shared context's maximum viewport area |

### Context loss

Every engine reports context loss and restore the same way. The chart stops drawing while its context is lost, plugins' `onContextLost` and `onContextRestored` hooks run, and the engine rebuilds what it needs before drawing resumes (see [Error handling](./error-handling.md)). WebGL engines handle `webglcontextlost` and `webglcontextrestored`, the shared engine reports its one context to every attached chart, and Canvas 2D handles the canvas `contextlost` and `contextrestored` events in browsers that fire them.

### What the engines share, and what they do not

The engines run the same data pipeline: the same level-of-detail extraction, the same cameras and axes, and the same series painter. They differ in how primitives reach pixels, so the semantic contract is shared and the pixels are not identical. The contract is tested per engine (one behavior suite runs against WebGL2, Canvas 2D, and the shared engine) and by comparing renders of the same chart across engines in the visual suite.

| Behavior | WebGL2 and shared | Canvas 2D |
|---|---|---|
| Gaps (non-finite Y) | Break lines and area fills | Same |
| Line width | CSS pixels times the device pixel ratio; at most one device pixel wide is drawn as a one-pixel line | Same, with a one-pixel minimum |
| Point size | Round marker, `pointSize` CSS pixels across | Same |
| Bars and candle bodies | Rasterized rectangles from the baseline | Same extent, edges snapped to whole device pixels |
| Throughput on very large visible point counts and many simultaneous charts | Highest | CPU-bound and slower |

Pixel-level output between engines, and between releases, is not covered by semver; the feature set is. Expected visual differences on Canvas 2D:

- Lines are antialiased (WebGL lines are not), so strokes look slightly softer, and the joins of very long, tightly curved lines are a little thinner.
- Rectangles (bars, histogram bins, dense min/max columns, candle bodies) snap to whole device pixels and are at least one pixel wide and tall, so adjacent columns never show seams. A rectangle edge that falls exactly on a half pixel may land one pixel away from where the GPU puts it.
- Scatter markers are round and the same size in every engine; Canvas 2D antialiases their edges.
- Lines narrower than one device pixel are drawn one device pixel wide.
- Thin lines (up to 1.5 device pixels) with several samples per device pixel column are drawn through the first, lowest, highest, and last sample of each column, so spikes and dips survive but sub-pixel wiggles inside one column do not; this is what keeps dense live data fast on Canvas 2D. Wider lines keep every sample.

The visual suite (`bun run test:visual`) renders every case with each engine and with WebGL disabled in Chrome through the default renderer, and compares the Canvas 2D and shared renders with the WebGL2 render of the same case within documented tolerances (see [Local development](./internal/local-development.md#cross-engine-parity)). Firefox and WebKit run the smoke tests on both WebGL2 and Canvas 2D.

## Unsupported-browser fallback

If you would rather show your own UI than a Canvas 2D chart, keep the fallback outside the chart constructor and ask for the strict engine, so users without WebGL2 get a useful page instead of a slower chart.

```ts
import { Chart, isWebGL2Available } from "blazeplot";

// Your own fallback: a static image from your backend, a table, or a message.
function renderStaticFallback(x: number[], y: number[]): Node {
  const note = document.createElement("p");
  note.textContent = `WebGL2 is unavailable, so the ${Math.min(x.length, y.length)}-sample chart is not shown.`;
  return note;
}

function renderTelemetryChart(element: HTMLElement, x: number[], y: number[]) {
  if (!isWebGL2Available()) {
    element.replaceChildren(renderStaticFallback(x, y));
    return null;
  }

  const chart = new Chart(element, { renderer: "webgl2" });
  chart.addLine({ x, y, name: "telemetry" });
  chart.fitToData({ padding: 0.05 });
  chart.start();
  return chart;
}
```

Good fallback options:

- a small static PNG/SVG generated by your backend;
- a table or summary statistics for the selected range;
- a message explaining that WebGL2 is required, with a link to download the data.

## Server-side rendering

Charts are browser-only. In SSR apps, create charts after client mount or dynamically import chart components on the client (see [Framework integration](./framework-integration.md)). `isWebGL2Available()` returns `false` when `document` is unavailable, so do not treat a server-side `false` result as a browser capability check.

```tsx
import { useEffect, useRef } from "react";
import { Chart, isWebGL2Available } from "blazeplot";

export function ClientOnlyChart({ x, y }: { x: number[]; y: number[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || !isWebGL2Available()) return;

    const chart = new Chart(ref.current);
    chart.addLine({ x, y, name: "series" });
    chart.fitToData();
    chart.start();

    return () => chart.dispose();
  }, [x, y]);

  return <div ref={ref} style={{ width: "100%", height: 360 }} />;
}
```

## Tested browsers

Automated coverage runs on every pull request in GitHub Actions (Ubuntu runners, software rendering, no physical GPU):

| Engine | Browser | Coverage | Where |
|---|---|---|---|
| Chromium | Headless Chrome (current stable on the runner) | Full suite: benchmark smoke and performance gate, every visual case (WebGL2, shared context, Canvas 2D, and WebGL disabled), all interaction cases, axe accessibility and forced-colors checks, the leak and stability suite, website UX. | `browser` CI job (`bun run test:browser`) |
| Gecko | Playwright Firefox | Smoke: WebGL2 context, non-blank chart pixels, `chart.screenshot()` readback, WebGL context loss/restore, hover, crosshair, wheel zoom, shift-drag pan, box zoom, double-click reset. | `cross-browser` CI job (`bun run test:cross-browser`) |
| WebKit | Playwright WebKit (the engine behind Safari) | Same smoke as Firefox. | `cross-browser` CI job (`bun run test:cross-browser`) |

The cross-browser job is a smoke test, not the full visual and interaction suite. Pixel-level screenshot baselines, the benchmark scenarios, touch gestures, and the remaining interaction cases (selection, linked charts, live follow) still run only in Chromium. A browser that cannot create a WebGL2 context fails the job instead of being skipped; the only way to skip it is an explicit, documented allowlist (`--allow-no-webgl2` or `BLAZEPLOT_CROSS_BROWSER_ALLOW_NO_WEBGL2`), which is empty today.

Playwright WebKit is a build of the WebKit engine, not Safari itself, and the CI runners are Linux, so Safari on macOS and iOS (which use Metal through ANGLE) and Firefox on real GPUs are not exercised. Treat them as expected targets when WebGL2 and Pointer Events are enabled, and verify them manually.

### Verified browsers per release

For each release candidate and the final 1.0 release, the release checklist records:

1. The Chromium, Firefox, and WebKit versions the `cross-browser` and `browser` jobs ran against (printed in the job logs).
2. A manual pass of the interactive previews at <https://blazeplot.cervelli.dev/previews> in the latest stable Safari (macOS and iOS), Firefox, and Chrome on real hardware, since CI runs only software WebGL2.

Mobile WebGL2 verification is manual and not yet automated.

Mobile browsers should use touch-friendly interaction options and compact axis/layout settings. Touch input uses Pointer Events only (there are no separate touch-event handlers). Charts on scrolling pages can use `interactionsPlugin({ touchPan: "two-finger", wheelZoom: "modifier" })` so they do not trap page scrolling; one-finger page scrolling in that mode is verified through touch emulation, not yet on a physical phone. See [Theming and layout](./theming-and-layout.md#mobile-layouts) and [Troubleshooting](./troubleshooting.md#page-scrolling-and-chart-gestures).

## Iframes, popups, and multiple documents

A chart uses the document and window that own its host element, so it works inside an iframe, a popup window, or a Document Picture-in-Picture window: create it with a host element from that document. Resize observation, animation frames, theme color resolution, `matchMedia` (forced colors), overlays, and plugin DOM use the host's window rather than the global one. `sharedRenderer()` creates its hidden canvas in the document that owns each chart's canvas (one default context per document), and `downloadChartScreenshot` attaches its link to the chart's document. Two standalone helpers default to the global `document`: `isWebGL2Available(doc?)` probes with a throwaway canvas from it, and `downloadBlob(blob, filename, doc?)` attaches its download link to it. Pass the iframe or popup document (for example `host.ownerDocument`) to act on that window; `createChartRenderContext(doc?)` takes one too.

## Clipboard and downloads

- `downloadChartScreenshot` and `downloadBlob` use object URLs and a temporary anchor element.
- `copyChartScreenshotToClipboard` requires `navigator.clipboard.write`, `ClipboardItem`, HTTPS, and usually a user gesture.
- If clipboard export fails, show a download button that calls `downloadChartScreenshot`.

## Packaging and TypeScript

BlazePlot is ESM-only and ships its own type declarations (minimum TypeScript 5.0, with `moduleResolution` set to `bundler`, `node16`, or `nodenext`). See [TypeScript support](./versioning-and-migration.md#typescript-support) and [Module format and runtime](./versioning-and-migration.md#module-format-and-runtime). Errors thrown when WebGL2 is missing are listed in [Error handling](./error-handling.md#creating-a-chart); keyboard and screen-reader behavior is in [Accessibility](./accessibility.md).

## Dependencies

The renderer uses native WebGL2 directly and has no runtime rendering dependency.
