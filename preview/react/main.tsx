import * as React from "react";
import { createRoot } from "react-dom/client";
import { StaticDataset } from "@/index.ts";
import type { Chart, ChartPlugin } from "@/index.ts";
import { BlazeChart } from "@/react.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";

function makeWave(count: number, phase = 0): { x: Float64Array; y: Float32Array } {
  const x = new Float64Array(count);
  const y = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = i;
    y[i] = Math.sin(i * 0.025 + phase) + 0.25 * Math.sin(i * 0.007 + phase * 0.5);
  }
  return { x, y };
}

function staticSeriesPlugin(): ChartPlugin {
  return {
    install(chart: Chart) {
      const primary = makeWave(8_000);
      const secondary = makeWave(8_000, Math.PI * 0.75);
      chart.addLine({ dataset: new StaticDataset(primary.x, primary.y), name: "sine" }, { lineWidth: 2 });
      chart.addArea(
        { dataset: new StaticDataset(secondary.x, secondary.y), name: "area" },
        { color: [0.35, 0.9, 0.65, 1], fillColor: [0.35, 0.9, 0.65, 0.18], lineWidth: 1 },
      );
      chart.setViewport({ xMin: 0, xMax: 8_000, yMin: -1.6, yMax: 1.6 });
      chart.start();
    },
  };
}

function streamingSeriesPlugin(): ChartPlugin {
  return {
    install(chart: Chart) {
      const line = chart.addLine({ capacity: 60_000, name: "react stream" }, { lineWidth: 2 });
      const scatter = chart.addScatter({ capacity: 3_000, downsample: "none", name: "events" }, { pointSize: 5, color: [1, 0.45, 0.25, 1] });
      let x = 0;
      let seed = 0x1234abcd;
      const random = (): number => {
        seed = Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x9e3779b9;
        return ((seed ^ (seed >>> 14)) >>> 0) / 4_294_967_296;
      };

      const timer = window.setInterval(() => {
        const count = 512;
        const xs = new Float64Array(count);
        const ys = new Float32Array(count);
        const eventXs: number[] = [];
        const eventYs: number[] = [];
        for (let i = 0; i < count; i++) {
          xs[i] = x;
          const y = Math.sin(x * 0.018) + 0.2 * Math.sin(x * 0.11);
          ys[i] = y;
          if (random() > 0.985) {
            eventXs.push(x);
            eventYs.push(y + 0.15 + random() * 0.25);
          }
          x++;
        }
        line.append(xs, ys);
        if (eventXs.length > 0) scatter.append(eventXs, eventYs);
        chart.setViewport({ xMin: Math.max(0, x - 12_000), xMax: Math.max(12_000, x), yMin: -1.6, yMax: 1.8 });
      }, 40);

      chart.start();
      return () => window.clearInterval(timer);
    },
  };
}

function ReactPreview(): React.ReactElement {
  const staticOptions = React.useMemo(
    () => ({ plugins: [legendPlugin(), tooltipPlugin(), interactionsPlugin(), staticSeriesPlugin()] }),
    [],
  );
  const streamingOptions = React.useMemo(
    () => ({ plugins: [legendPlugin(), tooltipPlugin(), interactionsPlugin(), streamingSeriesPlugin()] }),
    [],
  );

  return (
    <div className="app">
      <header id="topbar" aria-label="Project links">
        <div className="left">
          <span className="brand">BlazePlot React preview</span>
        </div>
        <nav>
          <a className="text-link" href="../">main preview</a>
          <a className="text-link" href="../features/">feature preview</a>
          <a className="text-link" href="../mobile/">mobile preview</a>
          <a className="text-link" href="https://github.com/Federicocervelli/blazeplot/tree/main/src/react.ts" target="_blank" rel="noreferrer">wrapper source</a>
          <a href="https://github.com/Federicocervelli/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot on GitHub">
            <img src="https://img.shields.io/github/stars/Federicocervelli/blazeplot?style=flat&logo=github&logoColor=white&label=GitHub&labelColor=111111&color=444444" alt="GitHub stars: blazeplot" />
          </a>
          <a href="https://www.npmjs.com/package/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot on npm">
            <img src="https://img.shields.io/npm/v/blazeplot?style=flat&logo=npm&logoColor=CB3837&label=npm&labelColor=111111&color=444444" alt="npm: blazeplot" />
          </a>
          <a href="https://cervelli.dev" target="_blank" rel="noreferrer" aria-label="Federico Cervelli portfolio">
            <img src="https://img.shields.io/badge/Portfolio-cervelli.dev-444444?style=flat&logo=googlechrome&logoColor=4285F4&labelColor=111111" alt="Portfolio: cervelli.dev" />
          </a>
          <a href="https://liberapay.com/cervelli/donate" target="_blank" rel="noreferrer" aria-label="Donate on Liberapay">
            <img src="https://img.shields.io/badge/Donate-Liberapay-444444?style=flat&logo=liberapay&logoColor=F6C915&labelColor=111111" alt="Donate: Liberapay" />
          </a>
        </nav>
      </header>
      <main>
        <section>
          <h2>Static dataset via &lt;BlazeChart /&gt;</h2>
          <BlazeChart className="chart" options={staticOptions} />
        </section>
        <section>
          <h2>Streaming data via React-installed plugin</h2>
          <BlazeChart className="chart" options={streamingOptions} />
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<ReactPreview />);
