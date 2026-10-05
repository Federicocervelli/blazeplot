import { Chart, HistogramDataset, type HistogramBin, type HistogramResult } from "../../../../src/index.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { legendPlugin } from "../../../../src/plugins/legend.ts";
import { siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const binCount = 1_000_000;
    const initialBins = 1_000;
    const x = new Float64Array(binCount);
    const y = new Float32Array(binCount);
    const bins = new Array<HistogramBin>(binCount);
    let total = 0;
    let initialYMax = 0;
    for (let index = 0; index < binCount; index++) {
      const wave = 80
        + Math.sin(index * 0.00031) * 34
        + Math.sin(index * 0.017) * 18
        + Math.sin(index * 0.071) * 9;
      const burst = index % 12_001 < 120 ? 70 * (1 - (index % 12_001) / 120) : 0;
      const count = Math.max(1, Math.round(wave + burst + (index % 997 === 0 ? 90 : 0)));
      x[index] = index + 0.5;
      y[index] = count;
      bins[index] = { x: index + 0.5, y: count, xStart: index, xEnd: index + 1, count, index };
      total += count;
      if (index < initialBins && count > initialYMax) initialYMax = count;
    }
    const histogram: HistogramResult = {
      bins,
      x,
      y,
      binWidth: 1,
      total,
      underflow: 0,
      overflow: 0,
      invalid: 0,
      min: 0,
      max: binCount,
    };

    const chart = new Chart(target, siteChartOptions({
      axes: { x: { position: "outside", title: "bin" }, y: { position: "outside", title: "count" } },
      grid: true,
      hover: { mode: "nearest-x", group: "none" },
      plugins: [
        interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true }),
        crosshairPlugin({ snap: "nearest-x", label: true, labelPlacement: "top-right", formatX: (value) => `bin ${Math.floor(value).toLocaleString()}`, formatY: (value) => value.toFixed(0) }),
        legendPlugin({ position: "top-left" }),
      ],
      accessibility: { label: "Histogram preview" },
    }));
    this.previewCharts.push(chart);

    chart.addBar({ name: "1M bins", dataset: new HistogramDataset(histogram) }, {
      color: [0.988, 0.29, 0.02, 0.95],
      baseline: 0,
    });
    chart.setViewport({ xMin: 0, xMax: initialBins, yMin: 0, yMax: initialYMax * 1.12 });
    chart.start();
  }

}
