# Plugin authoring

BlazePlot plugins are optional objects installed with `new Chart(target, { plugins: [...] })`.

```ts
import type { ChartPlugin, ChartPluginContext } from "blazeplot";

export function examplePlugin(): ChartPlugin {
  return {
    install(chart: ChartPluginContext) {
      const unsubscribe = chart.subscribe("render", () => {
        // Read chart state and update plugin-owned UI.
      });
      return () => unsubscribe();
    },
  };
}
```

## Lifecycle

- `install(chart)` runs once after the chart root, canvas, cameras, axes, and core event plumbing exist.
- Return either a cleanup function or an object with `dispose()`.
- Keep DOM/event resources plugin-owned and remove them during cleanup.
- Do not import built-in plugins from `Chart`; expose optional UI through subpath entries.

## Useful chart APIs

`ChartPluginContext` is a narrow public extension surface implemented by `Chart`; use it to type plugins that do not need the concrete `Chart` class.

- `chart.rootElement`, `chart.plotElement`, `chart.canvas` for DOM attachment.
- `chart.setLayoutReservation(id, reservation)` to reserve outer space for plugin UI.
- `chart.subscribe(...)` for render, hover, pointer, viewport, selection, series, and theme changes.
- `chart.pick(clientX, clientY)` for nearest raw sample data.
- `chart.clientToData(clientX, clientY, yAxis)` and `chart.dataToPlot(x, y, yAxis)` for coordinate conversion.
- `chart.theme` plus `themechange` for theme-aware plugin UI.

## Subpath packaging

Built-in optional plugins live under `src/plugins/*` and are Vite library entries. Follow the same pattern for first-party plugins so chart-only imports stay lean.
