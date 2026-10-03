import { Chart, StaticDataset } from "../../../../src/index.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { lineData } from ".././charts/signals.ts";
import { siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const chart = new Chart(target, siteChartOptions({
      axes: { x: { position: "outside" }, y: { position: "outside" } },
      hover: { mode: "nearest-x", group: "x" },
      plugins: [interactionsPlugin({ touchPan: true, pinchZoom: true, doubleTapReset: true }), crosshairPlugin({ mode: "crosshair", axis: "xy", snap: "nearest-x" })],
    }));
    this.previewCharts.push(chart);
    const count = 420;
    const { x, y } = lineData(count);
    chart.addLine({ dataset: new StaticDataset(x, y), name: "mobile" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    chart.setViewport({ xMin: 0, xMax: count - 1, yMin: -1.35, yMax: 1.35 });
    chart.start();
  }

}
