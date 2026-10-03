import { Chart, UniformRingBuffer, type SeriesStore } from "../../../../src/index.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const demandTarget = target.querySelector<HTMLElement>("[data-render-loop-demand]");
    const continuousTarget = target.querySelector<HTMLElement>("[data-render-loop-continuous]");
    const demandCount = target.querySelector<HTMLElement>("[data-render-loop-demand-count]");
    const continuousCount = target.querySelector<HTMLElement>("[data-render-loop-continuous-count]");
    const appendButton = target.querySelector<HTMLButtonElement>("[data-render-loop-append]");
    const requestButton = target.querySelector<HTMLButtonElement>("[data-render-loop-request]");
    const panButton = target.querySelector<HTMLButtonElement>("[data-render-loop-pan]");
    if (!demandTarget || !continuousTarget || !demandCount || !continuousCount) throw new Error("Missing render-loop preview elements");

    const count = 720;
    const signal = (x: number): number => Math.sin(x * 0.035) + Math.sin(x * 0.11) * 0.22;
    const makeChart = (element: HTMLElement, label: string, renderLoop: "auto" | "continuous"): { chart: Chart; series: SeriesStore } => {
      const dataset = new UniformRingBuffer(count * 2);
      for (let i = 0; i < count; i += 1) dataset.push(i, signal(i));
      const chart = new Chart(element, siteChartOptions({
        axes: { x: { position: "outside" }, y: { position: "outside" } },
        grid: true,
        plugins: [interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true })],
        accessibility: { label },
        renderLoop,
      }));
      const series = chart.addLine({ dataset, name: label }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
      chart.setViewport({ xMin: 0, xMax: count - 1, yMin: -1.4, yMax: 1.4 });
      this.previewCharts.push(chart);
      return { chart, series };
    };

    const demand = makeChart(demandTarget, "on-demand", "auto");
    const continuous = makeChart(continuousTarget, "continuous", "continuous");
    let demandRenders = 0;
    let continuousRenders = 0;
    let panOffset = 0;
    let nextX = count;
    this.previewDisposers.push(demand.chart.subscribe("render", () => { demandRenders += 1; }));
    this.previewDisposers.push(continuous.chart.subscribe("render", () => { continuousRenders += 1; }));

    demand.chart.start();
    continuous.chart.start();

    const refresh = (): void => {
      demandCount.textContent = String(demandRenders);
      continuousCount.textContent = String(continuousRenders);
    };
    const interval = window.setInterval(refresh, 100);
    this.previewDisposers.push(() => window.clearInterval(interval));

    if (appendButton) {
      const onClick = (): void => {
        demand.series.append({ y: signal(nextX++) });
      };
      appendButton.addEventListener("click", onClick);
      this.previewDisposers.push(() => appendButton.removeEventListener("click", onClick));
    }
    if (requestButton) {
      const onClick = (): void => demand.chart.requestRender();
      requestButton.addEventListener("click", onClick);
      this.previewDisposers.push(() => requestButton.removeEventListener("click", onClick));
    }
    if (panButton) {
      const onClick = (): void => {
        panOffset = (panOffset + 40) % 160;
        demand.chart.setViewport({ xMin: panOffset, xMax: panOffset + count - 1, yMin: -1.4, yMax: 1.4 });
      };
      panButton.addEventListener("click", onClick);
      this.previewDisposers.push(() => panButton.removeEventListener("click", onClick));
    }
  }

}
