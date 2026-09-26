import { Chart, StaticDataset } from "../../../../src/index.ts";
import { createLinkedCharts } from "../../../../src/linked.ts";
import { annotationsPlugin } from "../../../../src/plugins/annotations.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { legendPlugin } from "../../../../src/plugins/legend.ts";
import { navigatorPlugin } from "../../../../src/plugins/navigator.ts";
import { tooltipPlugin } from "../../../../src/plugins/tooltip.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    if (target.dataset.previewChart === "feature-linked") this.mountFeatureLinkedCharts(target);
    else this.mountFeatureHeroChart(target);
  }

  private mountFeatureHeroChart(target: HTMLElement): void {
    const { xs, cpu, latency, throughput, incidents, initialXMin, initialXMax } = this.featureData();
    const formatDate = this.featureFormatDate;
    const formatValue = this.featureFormatValue;
    const chart = new Chart(target, {
      axes: {
        x: { position: "outside", scale: "time", timezone: "utc", tickFormat: "%b %d %H:%M" },
        y: { position: "outside", title: "CPU / throughput" },
        y2: { position: "outside", title: "Latency (ms)" },
      },
      hover: { mode: "nearest-x", group: "x", maxDistancePx: 32 },
      grid: true,
      plugins: [
        interactionsPlugin({ wheelZoom: true, shiftDragPan: true }),
        annotationsPlugin({
          annotations: [
            { type: "y-range", yMin: 80, yMax: 100, fillColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)", label: "hot zone" },
            { type: "x-range", xMin: xs[120]!, xMax: xs[150]!, fillColor: "rgba(250,204,21,0.10)", borderColor: "rgba(250,204,21,0.35)", label: "deploy window" },
          ],
        }),
        crosshairPlugin({
          group: "feature-preview",
          snap: "nearest-x",
          mode: "ruler",
          rulerModifier: "ctrl",
          formatX: formatDate,
          formatY: formatValue,
          onMeasureStart: (position) => this.featureLog(`ruler start: ${formatDate(position.dataX)}, ${formatValue(position.dataY)}`),
          onMeasureChange: (measurement) => this.featureLog(`ruler Δx ${this.featureFormatDuration(measurement.deltaX)}  Δy ${formatValue(measurement.deltaY)}`),
          onMeasureEnd: (measurement) => this.featureLog(`ruler end: Δx ${this.featureFormatDuration(measurement.deltaX)}  Δy ${formatValue(measurement.deltaY)}  samples ${measurement.sampleCount.toLocaleString()}`),
        }),
        navigatorPlugin({ height: 58, placement: "bottom", followLive: false }),
        legendPlugin({ toggleOnClick: true }),
        tooltipPlugin({ mode: "nearest-x", group: "x", maxDistancePx: 48, formatter: (item) => `(${formatDate(item.x)}, ${formatValue(item.y)})` }),
      ],
    });
    this.previewCharts.push(chart);

    chart.addArea({ capacity: xs.length, dataset: new StaticDataset(xs, throughput), downsample: "none", name: "Throughput" }, { baseline: 0, fillColor: [0.125, 0.827, 0.933, 0.16], lineWidth: 1 });
    chart.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, cpu), downsample: "minmax", name: "CPU" }, { color: [0.22, 0.74, 0.97, 1], lineWidth: 2 });
    chart.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, latency), downsample: "minmax", name: "Latency", yAxis: "right" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    chart.addScatter({ capacity: xs.length, dataset: new StaticDataset(xs, incidents), downsample: "none", name: "Incidents" }, { color: [1, 0.85, 0.25, 1], pointSize: 8 });
    chart.setViewport({ xMin: initialXMin, xMax: initialXMax, yMin: 0, yMax: 120 });
    chart.setYViewport("right", { yMin: 0, yMax: 130 });
    chart.subscribe("viewportchange", (event) => this.featureLog(`viewport: ${formatDate(event.viewport.xMin)} → ${formatDate(event.viewport.xMax)}`));
    chart.subscribe("seriesclick", (event) => this.featureLog(`seriesclick: ${event.item.name ?? event.item.seriesIndex} @ ${formatDate(event.item.x)}`));
    const reset = this.host.renderRoot.querySelector<HTMLButtonElement>("[data-feature-reset]");
    if (reset) {
      const onReset = (): void => {
        chart.setViewport({ xMin: initialXMin, xMax: initialXMax, yMin: 0, yMax: 120 });
        chart.setYViewport("right", { yMin: 0, yMax: 130 });
        this.featureLog("views reset");
      };
      reset.addEventListener("click", onReset);
      this.previewDisposers.push(() => reset.removeEventListener("click", onReset));
    }
    chart.start();
    this.featureLog("feature preview ready");
  }

  private mountFeatureLinkedCharts(target: HTMLElement): void {
    const { xs, cpu, latency, initialXMin, initialXMax } = this.featureData();
    const linked = createLinkedCharts(target, {
      rows: 2,
      spacing: 8,
      sharedX: true,
      panels: [
        {
          options: {
            axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } },
            plugins: [interactionsPlugin({ boxZoom: false, shiftDragPan: true }), crosshairPlugin({ group: "linked-preview", snap: "nearest-x", formatX: this.featureFormatDate, formatY: this.featureFormatValue })],
          },
        },
        {
          options: {
            axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside", scale: "log", logBase: 10 } },
            plugins: [interactionsPlugin({ boxZoom: false, shiftDragPan: true }), crosshairPlugin({ group: "linked-preview", snap: "nearest-x", formatX: this.featureFormatDate, formatY: this.featureFormatValue })],
          },
        },
      ],
    });
    this.previewDisposers.push(() => linked.dispose());
    const linkedA = linked.charts[0]!;
    const linkedB = linked.charts[1]!;
    linkedA.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, cpu), downsample: "minmax", name: "CPU" }, { lineWidth: 2 });
    linkedB.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, latency.map((value) => Math.max(1, value))), downsample: "minmax", name: "Latency log ticks" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    linked.setXRange(initialXMin, initialXMax);
    linkedA.setViewport({ yMin: 0, yMax: 120 });
    linkedB.setViewport({ yMin: 1, yMax: 140 });
    linkedA.start();
    linkedB.start();
    const reset = this.host.renderRoot.querySelector<HTMLButtonElement>("[data-feature-reset]");
    if (reset) {
      const onReset = (): void => {
        linked.setXRange(initialXMin, initialXMax);
        linkedA.setViewport({ yMin: 0, yMax: 120 });
        linkedB.setViewport({ yMin: 1, yMax: 140 });
      };
      reset.addEventListener("click", onReset);
      this.previewDisposers.push(() => reset.removeEventListener("click", onReset));
    }
  }

  private featureData(): {
    xs: Float64Array;
    cpu: Float32Array;
    latency: Float32Array;
    throughput: Float32Array;
    incidents: Float32Array;
    initialXMin: number;
    initialXMax: number;
  } {
    const hour = 60 * 60 * 1000;
    const start = Date.UTC(2026, 4, 18, 0, 0, 0);
    const count = 360;
    const xs = Float64Array.from({ length: count }, (_, i) => start + i * hour);
    const cpu = Float32Array.from({ length: count }, (_, i) => 48 + Math.sin(i * 0.095) * 18 + Math.sin(i * 0.43) * 5);
    const latency = Float32Array.from({ length: count }, (_, i) => 25 + Math.abs(Math.sin(i * 0.13)) * 72 + Math.sin(i * 0.51) * 6);
    const throughput = Float32Array.from({ length: count }, (_, i) => 90 + Math.sin(i * 0.055) * 28 + Math.cos(i * 0.21) * 8);
    const incidents = Float32Array.from({ length: count }, (_, i) => i % 53 === 0 ? 96 : -999);
    return { xs, cpu, latency, throughput, incidents, initialXMin: xs[70]!, initialXMax: xs[230]! };
  }

  private featureLog(line: string): void {
    const target = this.host.renderRoot.querySelector<HTMLPreElement>("[data-feature-log]");
    if (!target) return;
    const lines = target.textContent ? target.textContent.split("\n") : [];
    target.textContent = [`${new Date().toLocaleTimeString()}  ${line}`, ...lines].slice(0, 12).join("\n");
  }

  private featureFormatDate = (value: number): string => {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
  };

  private featureFormatValue = (value: number): string => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(value);

  private featureFormatDuration(ms: number): string {
    return `${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(ms / (60 * 60 * 1000))}h`;
  }

}
