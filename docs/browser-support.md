# Browser and dependency support

BlazePlot targets modern browsers with WebGL2.

## Runtime requirements

- WebGL2 support is required; there is no Canvas2D/SVG fallback renderer for the plot.
- `ResizeObserver` is used when available for automatic layout updates.
- Pointer events are used for mouse/stylus/touch interaction plugins.
- Clipboard export helpers require the async Clipboard API and `ClipboardItem`.

Use `Chart.isWebGL2Available()` or `isWebGL2Available()` before creating a chart when the host app needs to show custom fallback UI.

## Tested paths

CI validates:

- TypeScript type checking,
- unit tests for data/interaction logic,
- Vite library build and declaration emit,
- public package subpath import smoke tests,
- package contents dry-run,
- bundle-size checks,
- headless browser benchmark smoke tests,
- browser visual tests,
- browser interaction tests.

## Browser notes

- Chromium-based browsers are the primary automated browser target for benchmarks and interaction/visual smoke tests.
- Firefox and Safari should work where WebGL2 and Pointer Events are available, but release-blocking automation currently focuses on Chromium.
- Mobile browsers should use the touch interaction options and compact axis/layout settings documented in [theming-and-layout.md](./theming-and-layout.md).

## Dependencies

- BlazePlot's default renderer uses the browser's native WebGL2 API directly and has no runtime rendering dependency.
- Optional peer dependency: `react` for `blazeplot/react` only.
