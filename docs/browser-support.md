# Browser support

BlazePlot targets modern browsers with WebGL2. The plot renderer does not have a Canvas2D or SVG fallback.

## Requirements

- WebGL2 for rendering.
- Pointer Events for the built-in interaction plugins.
- `ResizeObserver` for automatic layout updates when available. Without it, call `chart.resize()` after container size changes.
- Async Clipboard API and `ClipboardItem` for clipboard export helpers. Browsers may also require HTTPS and a user gesture.

Use `Chart.isWebGL2Available()` or `isWebGL2Available()` before creating a chart if your app needs to show fallback UI.

```ts
import { Chart, isWebGL2Available } from "blazeplot";

if (isWebGL2Available()) {
  new Chart(element);
} else {
  element.textContent = "This chart needs WebGL2.";
}
```

## Tested browsers

- Chromium is the primary automated test target.
- Firefox and Safari are expected targets when WebGL2 and Pointer Events are enabled, but browser-specific regressions may need manual verification.
- Charts are browser-only. In SSR apps, create charts after client mount or dynamically import chart components on the client.
- Mobile browsers should use touch-friendly interaction options and compact axis/layout settings. See [Theming and layout](./theming-and-layout.md#mobile-layouts).

## Dependencies

The core renderer uses native WebGL2 directly and has no runtime rendering dependency. React is optional and is only needed when importing `blazeplot/react`.
