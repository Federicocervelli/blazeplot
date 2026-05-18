import { Chart, StaticDataset } from "@/index.ts";
import type { ChartViewportChangeEvent } from "@/index.ts";
import { annotationsPlugin } from "@/plugins/annotations.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { interactionsPlugin } from "@/plugins/interactions.ts";
import { legendPlugin } from "@/plugins/legend.ts";
import { navigatorPlugin } from "@/plugins/navigator.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import { createLinkedCharts } from "@/linked.ts";

const heroTarget = requireElement<HTMLElement>("heroChart");
const linkedTarget = requireElement<HTMLElement>("linkedCharts");
const eventLog = requireElement<HTMLPreElement>("eventLog");
const resetButton = requireElement<HTMLButtonElement>("resetButton");

const HOUR = 60 * 60 * 1000;
const start = Date.UTC(2026, 4, 18, 0, 0, 0);
const count = 360;
const xs = Float64Array.from({ length: count }, (_, i) => start + i * HOUR);
const cpu = Float32Array.from({ length: count }, (_, i) => 48 + Math.sin(i * 0.095) * 18 + Math.sin(i * 0.43) * 5);
const latency = Float32Array.from({ length: count }, (_, i) => 25 + Math.abs(Math.sin(i * 0.13)) * 72 + Math.sin(i * 0.51) * 6);
const throughput = Float32Array.from({ length: count }, (_, i) => 90 + Math.sin(i * 0.055) * 28 + Math.cos(i * 0.21) * 8);
const incidents = Float32Array.from({ length: count }, (_, i) => i % 53 === 0 ? 96 : -999);

let logLines: string[] = [];
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const valueFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 });

const hero = new Chart(heroTarget, {

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
      onMeasureStart: (position) => pushLog(`ruler start: ${formatDate(position.dataX)}, ${formatValue(position.dataY)}`),
      onMeasureChange: (measurement) => pushLog(`ruler Δx ${formatDuration(measurement.deltaX)}  Δy ${formatValue(measurement.deltaY)}`),
      onMeasureEnd: (measurement) => pushLog(`ruler end: Δx ${formatDuration(measurement.deltaX)}  Δy ${formatValue(measurement.deltaY)}  samples ${measurement.sampleCount.toLocaleString()}`),
    }),
    navigatorPlugin({ height: 58, placement: "bottom", followLive: false }),
    legendPlugin({ toggleOnClick: true }),
    tooltipPlugin({ mode: "nearest-x", group: "x", maxDistancePx: 48, formatter: formatTooltipItem }),
  ],
});

hero.addArea(
  { capacity: count, dataset: new StaticDataset(xs, throughput), downsample: "none", name: "Throughput" },
  { baseline: 0, fillColor: [0.125, 0.827, 0.933, 0.16], lineWidth: 1 },
);
hero.addLine(
  { capacity: count, dataset: new StaticDataset(xs, cpu), downsample: "minmax", name: "CPU" },
  { color: [0.22, 0.74, 0.97, 1], lineWidth: 2 },
);
hero.addLine(
  { capacity: count, dataset: new StaticDataset(xs, latency), downsample: "minmax", name: "Latency", yAxis: "right" },
  { color: [0.98, 0.45, 0.45, 1], lineWidth: 2 },
);
hero.addScatter(
  { capacity: count, dataset: new StaticDataset(xs, incidents), downsample: "none", name: "Incidents" },
  { color: [1, 0.85, 0.25, 1], pointSize: 8 },
);

const initialXMin = xs[70]!;
const initialXMax = xs[230]!;
hero.setViewport({ xMin: initialXMin, xMax: initialXMax, yMin: 0, yMax: 120 });
hero.setYViewport("right", { yMin: 0, yMax: 130 });
hero.subscribe("viewportchange", (event: ChartViewportChangeEvent) => pushLog(`viewport: ${formatDate(event.viewport.xMin)} → ${formatDate(event.viewport.xMax)}`));
hero.subscribe("seriesclick", (event) => pushLog(`seriesclick: ${event.item.name ?? event.item.seriesIndex} @ ${formatDate(event.item.x)}`));
hero.start();

const linked = createLinkedCharts(linkedTarget, {
  rows: 2,
  spacing: 8,
  sharedX: true,
  panels: [
    {
      options: {
        axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } },
        plugins: [interactionsPlugin({ boxZoom: false, shiftDragPan: true }), crosshairPlugin({ group: "linked-preview", snap: "nearest-x", formatX: formatDate, formatY: formatValue }), tooltipPlugin({ formatter: formatTooltipItem })],
      },
    },
    {
      options: {
        axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside", scale: "log", logBase: 10 } },
        plugins: [interactionsPlugin({ boxZoom: false, shiftDragPan: true }), crosshairPlugin({ group: "linked-preview", snap: "nearest-x", formatX: formatDate, formatY: formatValue }), tooltipPlugin({ formatter: formatTooltipItem })],
      },
    },
  ],
});

const linkedA = linked.charts[0]!;
const linkedB = linked.charts[1]!;
linkedA.addLine({ capacity: count, dataset: new StaticDataset(xs, cpu), downsample: "minmax", name: "CPU" }, { lineWidth: 2 });
linkedB.addLine({ capacity: count, dataset: new StaticDataset(xs, latency.map((value) => Math.max(1, value))), downsample: "minmax", name: "Latency log ticks" }, { color: [0.98, 0.45, 0.45, 1], lineWidth: 2 });
linked.setXRange(initialXMin, initialXMax);
linkedA.setViewport({ yMin: 0, yMax: 120 });
linkedB.setViewport({ yMin: 1, yMax: 140 });
linkedA.start();
linkedB.start();

resetButton.addEventListener("click", () => {
  hero.setViewport({ xMin: initialXMin, xMax: initialXMax, yMin: 0, yMax: 120 });
  hero.setYViewport("right", { yMin: 0, yMax: 130 });
  linked.setXRange(initialXMin, initialXMax);
  pushLog("views reset");
});

pushLog("feature preview ready");

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function pushLog(line: string): void {
  logLines = [`${new Date().toLocaleTimeString()}  ${line}`, ...logLines].slice(0, 12);
  eventLog.textContent = logLines.join("\n");
}

function formatTooltipItem(item: { readonly x: number; readonly y: number }): string {
  return `(${formatDate(item.x)}, ${formatValue(item.y)})`;
}

function formatDuration(ms: number): string {
  const hours = ms / HOUR;
  return `${valueFormatter.format(hours)}h`;
}

function formatValue(value: number): string {
  return valueFormatter.format(value);
}

function formatDate(value: number): string {
  return dateFormatter.format(new Date(value));
}
