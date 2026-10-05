# Plugin authoring

A BlazePlot plugin is a small object installed with `new Chart(target, { plugins: [...] })`. Use plugins for UI or behavior that should stay outside the core renderer: legends, tooltips, custom overlays, interaction modes, or app-specific controls.

The plugin contract is **stable** from 1.0: `ChartPlugin`, `ChartPluginContext` and its groups, `ChartPluginHandle`, `ChartPluginEventMap`, the mount slots and surfaces, and `ChartLayoutReservation`. Only `ctx.unstable` is experimental; see [API stability](./stability.md). The nine built-in plugins use nothing but this contract (a unit test enforces it), so anything they do, your plugin can do too.

```ts
import type { ChartPlugin } from "blazeplot";

export function examplePlugin(): ChartPlugin {
  return {
    install(ctx) {
      const unsubscribe = ctx.events.subscribe("render", () => {
        // Read chart state and update plugin-owned UI.
        console.log(ctx.viewport.get().xMin);
      });

      return () => unsubscribe();
    },
  };
}
```

## The plugin context

`install(ctx)` receives a `ChartPluginContext`. Each plugin gets its own context object, grouped by concern:

| Group | Members | Use it for |
|---|---|---|
| `ctx.theme` | The current `ResolvedChartTheme` (read-only). | Colors and fonts for plugin UI. Re-read it in `onThemeChange`. |
| `ctx.coords` | `dataToPlot(x, y, yAxis?)`, `clientToData(clientX, clientY, yAxis?)`, `clientToPlot(clientX, clientY)`, `plotToClient(plotX, plotY)`, `format(value, axis, yAxis?)` | Converting between data, plot-local CSS pixels, and pointer (client) coordinates, and formatting values like the axis labels. Data conversions honor log and custom axis scales. |
| `ctx.viewport` | `get(yAxis?)`, `set(viewport, yAxis?)`, `pan(intent, yAxis?)`, `zoom(intent, yAxis?)`, `fitToData(options?)`, `isReversed(axis, yAxis?)`, `followX(options?)`, `stopFollowX()`, `setFollowXPaused(paused)`, `getFollowXState()` | Reading and changing the visible domain. Changes go through the chart's `ViewportPolicy` and pause latest-X following like a user gesture. |
| `ctx.state` | `getSeries()`, `getHover()`, `pick(clientX, clientY, options?)`, `getFrameStats(target?)`, `inspect(target)`, `getInspection()` | Series metadata, the current hover hit, hit-testing, render metrics, and keyboard inspection (see below). |
| `ctx.layout` | `plotRect()`, `rootRect()`, `reserve(reservation)` | Plot and chart geometry in client coordinates, and space around the plot for plugin UI. `reserve` returns a release function. |
| `ctx.dom` | `document`, `view`, `create(tag)`, `createSvg(tag)`, `mount(slot, element)`, `listen(surface, type, listener, options?)`, `decorate(surface, decoration)`, `contains(target)` | Creating plugin elements in the chart's own document (an iframe, popup, or Document Picture-in-Picture window may differ from the global one), attaching them, listening to input on chart-owned elements, and styling them. `mount`, `listen`, and `decorate` return undo functions. Create elements with `ctx.dom.create` instead of the global `document`, and read `devicePixelRatio`, `matchMedia`, and animation frames from `ctx.dom.view`. |
| `ctx.events` | `subscribe(event, callback)`, `emit(event, payload)` | Chart events (`render`, `hover`, `viewportchange`, `serieschange`, pointer events, ...) and typed plugin events. |
| `ctx.requestRender()` | | Schedule a frame after changing something the chart draws. Chart-owned changes already request one. |
| `ctx.unstable` | `canvas`, `element(slot)`, `getWebGLContext()`, `getCamera(yAxis?)` | Experimental escape hatches. Prefer the groups above. |

Group members drop the noun the group already names and otherwise match the `Chart` method: `ctx.viewport.get()` is `chart.getViewport()`, `ctx.state.getHover()` is `chart.getHoverState()`, and `ctx.viewport.followX()` is `chart.followX()`. The raw camera, WebGL context, canvas, and plot/axis elements are only available here, under `ctx.unstable`; `Chart` does not expose them.

Everything a plugin creates *through the context* (listeners, subscriptions, mounted elements, decorations, and layout reservations) is released automatically after the plugin is disposed. Resources you create yourself, such as timers, observers, global listeners, and GPU objects, are yours to release.

## Mount slots and surfaces

Plugins never receive raw chart elements. They attach DOM to named **mount slots** and listen on named **surfaces**:

| Slot | `ctx.dom.mount(slot, el)` appends to | Typical content |
|---|---|---|
| `"plot"` | The plot area, above the WebGL canvas. Positions match `ctx.coords` plot coordinates. | Crosshairs, markers, brushes, annotation SVG. Keep `pointer-events: none` unless the element handles its own input. |
| `"root"` | The whole chart box, including axis gutters and reserved space. | Legends, toolbars, navigators, `<style>` elements. |
| `"axis-x"`, `"axis-y"`, `"axis-y2"` | The outside axis gutters (bottom, left, right). | Axis adornments. |
| `"body"` | The owning document's `<body>`. | `position: fixed` UI that must escape the chart's `overflow: hidden`, such as tooltips. |

| Surface | `ctx.dom.listen` / `ctx.dom.decorate` target | Notes |
|---|---|---|
| `"plot"` | The interactive plot surface. | Receives pointer, wheel, touch, click, and double-click input. |
| `"root"` | The chart root. | Focusable; receives keyboard input when `accessibility` is enabled. |
| `"axis-x"`, `"axis-y"`, `"axis-y2"` | The axis gutters. | Ignore pointer input until decorated with `{ style: { pointerEvents: "auto" } }`. |

`listen` passes the DOM event through unchanged, so `event.currentTarget` is the surface element: call `setPointerCapture` on it for drags. `decorate(surface, { style, classes, attributes })` applies a limited set of inline styles (`cursor`, `touchAction`, `pointerEvents`, `filter`, `outline`, `outlineOffset`), CSS classes, and attributes, and returns a function that restores the previous values. When several decorations touch the same property, undo them in reverse order. `contains(target)` tells you whether an event target is inside the chart, for example to scope global keyboard shortcuts.

## Lifecycle

- `install(ctx)` runs once while the chart is constructed, after the chart root, plot, canvas, axes, and event plumbing exist. Plugins install **in the order they appear in `plugins`**.
- `install` returns nothing, a cleanup function, or a `ChartPluginHandle`. Every handle member is optional:

| Hook | Called when |
|---|---|
| `dispose()` | `chart.dispose()` runs, or a later plugin throws during install. Runs once. |
| `onResize(size)` | The plot area changes size (including device-pixel-ratio changes). `size` is `{ width, height }` in CSS pixels. |
| `onThemeChange(theme)` | `chart.setTheme(...)` replaces the theme. Runs before the public `themechange` event. |
| `onContextLost()` | The chart's WebGL context is lost. The chart stops drawing until it is restored. |
| `onContextRestored()` | The context is restored and the chart's GPU resources are rebuilt. |

- Hooks run in **registration order**. Disposal runs in **reverse registration order**, so a plugin can rely on plugins installed before it still being alive during its own cleanup.
- A hook that throws is reported with `console.error` and does not stop other plugins. A cleanup that throws never prevents chart-owned resources from being released.
- If `install` throws, the context releases what it handed out, the plugins already installed are disposed in reverse order, and the chart constructor rethrows.

The app that owns the chart controls `chart.start()` and `chart.stop()`. Plugin code should update plugin-owned DOM or state from chart events and hooks.

## Plugin events

Plugins can emit typed events that chart users receive through `chart.subscribe(...)`. The built-in `select` event (emitted by `selectionPlugin` and linked layouts) is declared on `ChartPluginEventMap`. Add your own events with declaration merging, prefixed with your plugin name:

```ts
import type { ChartPlugin } from "blazeplot";

declare module "blazeplot" {
  interface ChartPluginEventMap {
    "bookmarks:add": { readonly x: number };
  }
}

export function bookmarksPlugin(): ChartPlugin {
  return {
    install(ctx) {
      ctx.dom.listen("plot", "dblclick", (event) => {
        const data = ctx.coords.clientToData(event.clientX, event.clientY);
        if (data) ctx.events.emit("bookmarks:add", { x: data[0] });
      });
    },
  };
}
```

`ChartEventMap` extends `ChartPluginEventMap`, so `chart.subscribe("bookmarks:add", ({ x }) => ...)` is fully typed in the app.

## Example: a last-value badge

A complete third-party plugin. It draws a badge at the latest sample of one series, keeps it on theme, follows resizes, and emits a typed event when the value changes.

```ts
import { Chart, type ChartPlugin } from "blazeplot";

declare module "blazeplot" {
  interface ChartPluginEventMap {
    "last-value:change": { readonly seriesId: string; readonly x: number; readonly y: number };
  }
}

export interface LastValuePluginOptions {
  /** `id` of the series to track. */
  readonly seriesId: string;
  readonly format?: (y: number) => string;
}

export function lastValuePlugin(options: LastValuePluginOptions): ChartPlugin {
  return {
    install(ctx) {
      const badge = ctx.dom.create("div");
      badge.className = "last-value-badge";
      Object.assign(badge.style, { position: "absolute", right: "4px", padding: "2px 6px", pointerEvents: "none", transform: "translateY(-50%)" });
      ctx.dom.mount("plot", badge);

      const applyTheme = (): void => {
        badge.style.background = ctx.theme.tooltipBackgroundColor;
        badge.style.color = ctx.theme.tooltipTextColor;
        badge.style.font = ctx.theme.tooltipFont;
      };

      let lastX = Number.NaN;
      let lastY = Number.NaN;
      const update = (): void => {
        const state = ctx.state.getSeries().find((item) => item.id === options.seriesId);
        const sample = state && state.visible ? state.series.sampleAt(state.series.length - 1) : null;
        if (!state || !sample) {
          badge.style.display = "none";
          return;
        }
        const [, plotY] = ctx.coords.dataToPlot(sample.x, sample.y, state.yAxis);
        badge.style.display = plotY >= 0 && plotY <= ctx.layout.plotRect().height ? "block" : "none";
        badge.style.top = `${plotY}px`;
        badge.textContent = (options.format ?? String)(sample.y);
        if (sample.x !== lastX || sample.y !== lastY) {
          lastX = sample.x;
          lastY = sample.y;
          ctx.events.emit("last-value:change", { seriesId: options.seriesId, x: sample.x, y: sample.y });
        }
      };

      applyTheme();
      ctx.events.subscribe("render", update);
      // The badge, listener, and subscription are released automatically on dispose.
      return { onThemeChange: applyTheme, onResize: update };
    },
  };
}

// Using it:
const chart = new Chart(element, { plugins: [lastValuePlugin({ seriesId: "cpu", format: (y) => `${y.toFixed(1)}%` })] });
const cpu = chart.addLine({ id: "cpu", capacity: 1_000 });
const unsubscribe = chart.subscribe("last-value:change", ({ y }) => console.log("latest CPU", y));
chart.start();
cpu.append({ x: Date.now(), y: 42 });

// Later, when the view unmounts:
unsubscribe();
chart.dispose();
```

## Keyboard inspection

`ctx.state.inspect({ series, index })` shows one sample as the chart's hover state, as if the pointer were on it. The tooltip, crosshair, and every `hover` subscriber follow it: the state has `source: "inspection"`, the inspected sample is `items[0]` (other visible series at the same X follow when hover grouping is `"x"`), and its client, plot, and data coordinates are the sample's. The chart re-projects it on every frame, so it stays on the sample through pans, zooms, and resizes; while the sample is hidden, a gap, or outside the plot, the hover state is `null` but the target is kept. `ctx.state.inspect(null)` ends it, and so does a pointer moving over the plot (check `ctx.state.getInspection()` in a `hover` subscriber to notice). A series that is not on the chart, or an index outside it, throws a `RangeError`.

Keyboard handlers on the `"root"` surface should act only when the root itself has focus (`event.target === event.currentTarget`), so keys typed into controls inside the chart stay with those controls. The chart's own arrow-key pan listens on the root in the bubble phase; listen with `{ capture: true }` and call `preventDefault()` to take a key before it, and skip events that are already `defaultPrevented`.

```ts
import type { ChartPlugin } from "blazeplot";

/** Press "L" on the focused chart to show the latest sample of the first series in the tooltip. */
export function latestSamplePlugin(): ChartPlugin {
  return {
    install(ctx) {
      ctx.dom.listen("root", "keydown", (event) => {
        if (event.target !== event.currentTarget || event.defaultPrevented || event.key.toLowerCase() !== "l") return;
        const state = ctx.state.getSeries().find((item) => item.visible && item.series.length > 0);
        if (!state) return;
        ctx.state.inspect({ series: state.series, index: state.series.length - 1 });
        event.preventDefault();
      }, { capture: true });
      ctx.dom.listen("root", "blur", () => ctx.state.inspect(null));
    },
  };
}
```

`ctx.coords.format(value, axis, yAxis?)` formats a value the way the axis labels it, which keeps announcements consistent with what sighted users read. `blazeplot/plugins/a11y` is built on exactly these calls; see [Accessibility](./accessibility.md).

## Layout guidance

Mount plot overlays in the `"plot"` slot so they move and clip with the plot. For UI outside the plot, mount it in `"root"` and reserve space with `ctx.layout.reserve(...)` instead of hard-coding margins over the canvas. Reservations from all plugins add up as padding around the chart's grid. This keeps axes, screenshots, and responsive layout predictable.

```ts
import type { ChartPlugin } from "blazeplot";

export function footerPlugin(): ChartPlugin {
  return {
    install(ctx) {
      const footer = ctx.dom.create("div");
      footer.textContent = "Updated live";
      Object.assign(footer.style, { position: "absolute", left: "0", right: "0", bottom: "4px", textAlign: "center" });
      const unmount = ctx.dom.mount("root", footer);
      const release = ctx.layout.reserve({ bottom: 28 });

      // Optional: the context would release both on dispose anyway.
      return () => {
        release();
        unmount();
      };
    },
  };
}
```

See [Theming and layout](./theming-and-layout.md).

## Escape hatches

`ctx.unstable` exposes the raw plot canvas, the raw element behind a slot or surface, the chart's `WebGL2RenderingContext`, and the `Camera2D` for each Y axis. They are `@experimental`: they may change in a minor release, and they bypass guarantees the stable groups give you (camera changes skip `ViewportPolicy`; GL state you change can interfere with rendering and is rebuilt after context loss). Use them for prototypes, and open an issue describing what the stable groups are missing.

## Importing built-in plugins

Built-in plugins live under subpaths such as `blazeplot/plugins/tooltip` and `blazeplot/plugins/interactions`. Import only the plugins you use. See [Examples](./examples.md#built-in-plugins) and the [API reference](./api-reference.md#package-entry-points).
