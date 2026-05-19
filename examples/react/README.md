# BlazePlot React examples

The React wrapper is exported from `blazeplot/react`. It owns chart mount/dispose and gives access to the underlying `Chart` through `onChart`, `chartRef`, or a forwarded ref.

## Static line with tooltip and legend

```tsx
import { useMemo } from "react";
import { Chart, StaticDataset } from "blazeplot";
import { BlazeChart } from "blazeplot/react";
import { legendPlugin } from "blazeplot/plugins/legend";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

export function StaticLineExample() {
  const data = useMemo(() => {
    const x = Array.from({ length: 2_000 }, (_, i) => i);
    const y = x.map((value) => Math.sin(value * 0.02));
    return { x, y };
  }, []);

  return (
    <BlazeChart
      style={{ width: "100%", height: 360 }}
      options={{ plugins: [legendPlugin(), tooltipPlugin()] }}
      onChart={(chart: Chart) => {
        chart.addLine({ dataset: new StaticDataset(data.x, data.y), name: "sine" });
        chart.setViewport({ xMin: data.x[0], xMax: data.x.at(-1), yMin: -1.5, yMax: 1.5 });
        chart.start();
      }}
    />
  );
}
```

## Streaming line

```tsx
import { useMemo } from "react";
import type { ChartPlugin } from "blazeplot";
import { BlazeChart } from "blazeplot/react";
import { interactionsPlugin } from "blazeplot/plugins/interactions";

function streamingDataPlugin(): ChartPlugin {
  return {
    install(chart) {
      const series = chart.addLine({ capacity: 50_000, name: "live" });
      let x = 0;
      const timer = window.setInterval(() => {
        const xs = new Float64Array(256);
        const ys = new Float32Array(256);
        for (let i = 0; i < xs.length; i++) {
          xs[i] = x;
          ys[i] = Math.sin(x * 0.02) + Math.random() * 0.05;
          x++;
        }
        series.append(xs, ys);
        chart.setViewport({ xMin: Math.max(0, x - 5_000), xMax: x, yMin: -1.5, yMax: 1.5 });
      }, 50);

      chart.start();
      return () => window.clearInterval(timer);
    },
  };
}

export function StreamingExample() {
  const options = useMemo(() => ({ plugins: [interactionsPlugin(), streamingDataPlugin()] }), []);
  return <BlazeChart style={{ width: "100%", height: 360 }} options={options} />;
}
```

## Custom plugin in React

```tsx
import type { Chart, ChartPlugin } from "blazeplot";
import { BlazeChart } from "blazeplot/react";

function renderCounterPlugin(): ChartPlugin {
  return {
    install(chart: Chart) {
      const badge = document.createElement("div");
      badge.style.cssText = "position:absolute;right:8px;top:8px;padding:4px 6px;background:#0008;color:white";
      chart.rootElement.append(badge);

      const unsubscribe = chart.subscribe("render", () => {
        badge.textContent = `${chart.getFrameStats().drawCalls} draw calls`;
      });

      return () => {
        unsubscribe();
        badge.remove();
      };
    },
  };
}

export function CustomPluginExample() {
  return <BlazeChart style={{ width: "100%", height: 360 }} options={{ plugins: [renderCounterPlugin()] }} />;
}
```
