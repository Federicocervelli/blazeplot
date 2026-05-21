# Plugin authoring

A BlazePlot plugin is a small object installed with `new Chart(target, { plugins: [...] })`. Use plugins for UI or behavior that should stay outside the core renderer: legends, tooltips, custom overlays, interaction modes, or app-specific controls.

```ts
import type { ChartPlugin } from "blazeplot";

export function examplePlugin(): ChartPlugin {
  return {
    install(chart) {
      const unsubscribe = chart.subscribe("render", () => {
        // Read chart state and update plugin-owned UI.
      });

      return () => unsubscribe();
    },
  };
}
```

## Lifecycle

- `install(chart)` runs once after the chart root, plot layer, canvas, camera, axes, and event plumbing exist.
- Return a cleanup function or an object with `dispose()`.
- Own any DOM nodes, event listeners, timers, observers, or GPU resources you create.
- Remove those resources during cleanup. The chart will call plugin cleanup from `chart.dispose()`.

## Useful chart APIs

- `chart.rootElement`, `chart.plotElement`, and `chart.canvas` for DOM attachment.
- `chart.setLayoutReservation(id, reservation)` for plugin UI outside the plot area.
- `chart.subscribe(...)` for `render`, `hover`, `viewportchange`, `select`, `serieschange`, `seriesclick`, `themechange`, and pointer events (`click`, `dblclick`, `pointerdown`, `pointerup`, `pointermove`).
- `chart.pick(clientX, clientY)` for nearest raw sample data.
- `chart.clientToData(...)` and `chart.dataToPlot(...)` for coordinate conversion.
- `chart.theme` and the `themechange` event for theme-aware UI.
- `chart.subscribe("render", ...)` for plugin UI that needs to follow the chart's current viewport or frame stats.

The app that owns the chart controls `chart.start()` and `chart.stop()`. Plugin code should update plugin-owned DOM or state from subscribed chart events and clean up its own resources when disposed.

## Layout guidance

Attach plot overlays to `chart.plotElement` when they should move with the plot. For UI outside the plot, reserve space with `chart.setLayoutReservation(...)` instead of hard-coding margins over the canvas. This keeps axes, screenshots, and responsive layout predictable.

```ts
export function footerPlugin(): ChartPlugin {
  return {
    install(chart) {
      const id = "my-footer";
      const footer = document.createElement("div");
      footer.textContent = "Updated live";
      chart.rootElement.appendChild(footer);
      chart.setLayoutReservation(id, { bottom: 28 });

      return () => {
        chart.setLayoutReservation(id, null);
        footer.remove();
      };
    },
  };
}
```

See [Theming and layout](./theming-and-layout.md).

## Importing built-in plugins

Built-in plugins live under subpaths such as `blazeplot/plugins/tooltip` and `blazeplot/plugins/interactions`. Import only the plugins you use. See [Examples](./examples.md#built-in-plugins) and the [API reference](./api-reference.md#package-entry-points).
