# Browser support

BlazePlot targets modern browsers with WebGL2 and ships an opt-in Canvas 2D renderer for environments where WebGL2 is unavailable or unreliable.

## Requirements

| Feature | Used for | Notes |
|---|---|---|
| WebGL2 | Plot rendering | Required by the default renderer. BlazePlot throws `WebGL2UnavailableError` when a chart cannot create a WebGL2 context, unless you pass the [Canvas 2D renderer](#canvas-2d-renderer). |
| Canvas 2D | Fallback plot rendering | Used by `blazeplot/renderers/canvas2d`. Available in every browser that can draw a `<canvas>`. |
| Pointer Events | Built-in interactions | Used for pan, zoom, box selection, touch gestures, and plugin hit testing. |
| `ResizeObserver` | Automatic layout updates | Optional. Without it, call `chart.resize()` after container size changes. |
| Async Clipboard API + `ClipboardItem` | Clipboard export helpers | Optional. Browsers usually require HTTPS and a user gesture. Download helpers still work without clipboard support. |

Use the [Canvas 2D renderer](#canvas-2d-renderer) to keep drawing without WebGL2, or `isWebGL2Available()` before creating a chart if your app needs to show its own fallback UI.

```ts
import { Chart, isWebGL2Available } from "blazeplot";

if (isWebGL2Available()) {
  const chart = new Chart(element);
  chart.start();
} else {
  element.textContent = "This chart needs WebGL2.";
}
```

## Canvas 2D renderer

`blazeplot/renderers/canvas2d` is a separate entry point, so WebGL-only apps do not pay for it. It exports two renderer factories:

- `autoRenderer()` uses WebGL2 and falls back to Canvas 2D when WebGL2 is unavailable or its context cannot be created (browsers with hardware acceleration off, GPU blocklists, privacy-hardened browsers, headless screenshot pipelines, pages that used up the WebGL context cap).
- `canvas2dRenderer()` always uses Canvas 2D.

```ts
import { Chart, StaticDataset } from "blazeplot";
import { autoRenderer } from "blazeplot/renderers/canvas2d";

const chart = new Chart(element, { renderer: autoRenderer() });
chart.addLine({ dataset: new StaticDataset(new Float64Array([0, 1, 2]), new Float32Array([0, 1, 0])) });
chart.fitToData();
chart.start();

console.log(chart.renderer); // "webgl2" or "canvas2d"
// Later: chart.dispose();
```

`chart.renderer` is `"webgl2"`, `"canvas2d"`, or `"shared"` (see [shared context](./performance-recipes.md#many-charts-on-one-page)). `canvas2dRenderer()` throws `Canvas2DUnavailableError` when the canvas cannot create a 2D context, which is rare; `autoRenderer()` only falls back when WebGL2 fails.

Every series type (line, area, bar, scatter, OHLC, candlestick, histogram), gaps, log/symlog and reversed axes, dual Y axes, wide lines, `chart.screenshot()`, every built-in plugin, and the flame graph plugin work on both renderers. `ctx.unstable.getWebGLContext()` returns `null` on Canvas 2D (and on the shared WebGL renderer).

WebGL context loss and restore (see [Error handling](./error-handling.md)) only applies to WebGL charts; Canvas 2D charts have nothing to lose.

The renderers draw the same data with the same level-of-detail pipeline, so Canvas 2D stays interactive at typical chart sizes, but it is CPU-bound and slower than WebGL2 for very large visible point counts and many simultaneous charts. Expected visual differences:

- Lines are antialiased (WebGL lines are not), so strokes look slightly softer.
- Rectangles (bars, histogram bins, dense min/max columns, candle bodies) snap to whole device pixels and are at least one pixel wide and tall, so adjacent columns never show seams.
- Scatter markers are round and the same size in both renderers; Canvas 2D antialiases their edges.
- Lines narrower than one device pixel are drawn one device pixel wide.

The visual test suite (`bun run test:visual`) renders every case with WebGL2, with the shared WebGL context, with Canvas 2D, and with WebGL disabled in Chrome through `autoRenderer()`; the Canvas 2D render has to stay within a documented pixel tolerance of the WebGL baselines (see [Local development](./internal/local-development.md)).

The default `renderer: "webgl2"` is unchanged, and a chart created without the option still throws `WebGL2UnavailableError` when WebGL2 is unavailable.

## Unsupported-browser fallback

If you would rather show your own UI than a Canvas 2D chart, keep the fallback outside the chart constructor so users without WebGL2 still get a useful page.

```ts
import { Chart, StaticDataset, isWebGL2Available } from "blazeplot";

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

  const chart = new Chart(element);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "telemetry" });
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
import { Chart, StaticDataset, isWebGL2Available } from "blazeplot";

export function ClientOnlyChart({ x, y }: { x: number[]; y: number[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || !isWebGL2Available()) return;

    const chart = new Chart(ref.current);
    chart.addLine({ dataset: new StaticDataset(x, y), name: "series" });
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
