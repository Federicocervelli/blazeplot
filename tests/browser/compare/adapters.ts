import {
  BarController,
  BarElement,
  Chart as ChartJs,
  Decimation,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
} from "chart.js";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Chart, LIGHT_CHART_THEME, StaticDataset } from "@/index.ts";
import { canvas2dRenderer } from "@/renderers/canvas2d.ts";
import { sharedRenderer } from "@/renderers/shared.ts";
import { crosshairPlugin } from "@/plugins/crosshair.ts";
import { tooltipPlugin } from "@/plugins/tooltip.ts";
import type { SeriesStore } from "@/index.ts";
import type { ChartHandle, ChartSpec, LibraryId, ViewportRange } from "./common.ts";
import { cssColor, seriesColor, streamY, type ChartJsPoint, type LibraryData } from "./data.ts";
import { ProceduralBenchmarkDataset } from "./procedural.ts";

ChartJs.register(LineController, BarController, ScatterController, LineElement, PointElement, BarElement, LinearScale, Decimation, Filler, Legend, Tooltip);

/** Fixed axis gutters (CSS px) forced on every library so all three plot into the same rectangle. */
export const LEFT_GUTTER = 52;
export const RIGHT_GUTTER = 52;
export const BOTTOM_GUTTER = 28;
export const POINT_DIAMETER = 3;
export const BAR_WIDTH_FRACTION = 0.8;
export const LINE_COLOR = "#3b73f2";

export function createChart(library: LibraryId, host: HTMLElement, spec: ChartSpec, data: LibraryData, viewport: ViewportRange): ChartHandle {
  switch (library) {
    case "blazeplot":
      return createBlazePlot(host, spec, data, viewport, spec.sharedContext ? "shared" : "webgl2");
    case "blazeplot-canvas2d":
      return createBlazePlot(host, spec, data, viewport, "canvas2d");
    case "uplot":
      return createUPlot(host, spec, data, viewport);
    case "chartjs":
      return createChartJs(host, spec, data, viewport);
  }
}

// ---------------------------------------------------------------- BlazePlot

function createBlazePlot(host: HTMLElement, spec: ChartSpec, data: LibraryData, viewport: ViewportRange, backend: "webgl2" | "canvas2d" | "shared"): ChartHandle {
  if (data.library !== "blazeplot") throw new Error("BlazePlot adapter received data for another library.");
  const chart = new Chart(host, {
    theme: LIGHT_CHART_THEME,
    axes: {
      x: { position: "outside" },
      y: { position: "outside" },
      ...(spec.dualAxis ? { y2: { position: "outside" } } : {}),
    },
    grid: false,
    renderLoop: "auto",
    renderer: backend === "canvas2d" ? canvas2dRenderer() : backend === "shared" ? sharedRenderer() : "webgl2",
    plugins: spec.hover ? [crosshairPlugin(), tooltipPlugin()] : [],
  });
  let draws = 0;
  chart.subscribe("render", () => {
    draws++;
  });

  const stores: SeriesStore[] = [];
  for (let k = 0; k < spec.seriesCount; k++) {
    const rgb = seriesColor(k, spec.seriesCount);
    const color = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1] as [number, number, number, number];
    const yAxis = spec.dualAxis && k === 1 ? ("right" as const) : undefined;
    if (spec.stream) {
      stores.push(chart.addLine({ capacity: spec.points + (spec.windowed ? 0 : (spec.streamExtra ?? 0)), xStart: 0, xStep: 1, downsample: "minmax", name: "Benchmark line" }, { color, lineWidth: 1 }));
      stores[0]!.append({ y: data.ys[0]! });
      continue;
    }
    const dataset = spec.accelerated ? new ProceduralBenchmarkDataset(spec.points) : new StaticDataset(data.x!, data.ys[k]!);
    const base = { dataset, name: `Series ${k}`, ...(yAxis ? { yAxis } : {}) };
    switch (spec.kind) {
      case "line":
        stores.push(chart.addLine({ ...base, downsample: "minmax" }, { color, lineWidth: 1 }));
        break;
      case "area":
        stores.push(chart.addArea(base, { color, lineWidth: 1, fillColor: [color[0], color[1], color[2], 0.25] }));
        break;
      case "scatter":
        stores.push(chart.addScatter(base, { color, pointSize: POINT_DIAMETER }));
        break;
      case "bar":
        stores.push(chart.addBar(base, { color, barWidth: BAR_WIDTH_FRACTION }));
        break;
    }
  }

  const applyViewport = (next: ViewportRange): void => {
    chart.setViewport({ xMin: next.xMin, xMax: next.xMax, yMin: next.yMin, yMax: next.yMax });
    if (spec.dualAxis && next.y2Min !== undefined && next.y2Max !== undefined) chart.setViewport({ yMin: next.y2Min, yMax: next.y2Max }, "right");
  };
  applyViewport(viewport);
  chart.start();

  const first = stores[0]!;
  const canvas = chart.canvas;
  return {
    setViewport: applyViewport,
    append: (startX, count, next) => {
      const y = new Float32Array(count);
      for (let i = 0; i < count; i++) y[i] = streamY(startX + i);
      first.append({ y });
      applyViewport(next);
    },
    drawCount: () => draws,
    hasContent: () => chart.getFrameStats().drawCalls > 0,
    plotWidth: () => canvas.clientWidth,
    plotHeight: () => canvas.clientHeight,
    hoverActive: () => chart.getHoverState() !== null,
    internalStats: () => {
      const stats = chart.getFrameStats();
      return { frameMs: stats.frameMs, pointsRendered: stats.pointsRendered, drawCalls: stats.drawCalls };
    },
    destroy: () => chart.dispose(),
  };
}

// -------------------------------------------------------------------- uPlot

function createUPlot(host: HTMLElement, spec: ChartSpec, data: LibraryData, viewport: ViewportRange): ChartHandle {
  if (data.library !== "uplot") throw new Error("uPlot adapter received data for another library.");
  const xValues = data.x;
  const yValues = data.ys;
  const plotData = [xValues, ...yValues] as unknown as NonNullable<ConstructorParameters<typeof uPlot>[1]>;
  let draws = 0;

  const series: uPlot.Series[] = [{}];
  for (let k = 0; k < spec.seriesCount; k++) {
    const rgb = seriesColor(k, spec.seriesCount);
    const stroke = cssColor(rgb);
    const scale = spec.dualAxis && k === 1 ? "y2" : "y";
    const common = { label: `Series ${k}`, stroke, scale };
    switch (spec.kind) {
      case "line":
        series.push({ ...common, width: 1, points: { show: false } });
        break;
      case "area":
        series.push({ ...common, width: 1, fill: cssColor(rgb, 0.25), fillTo: () => 0, points: { show: false } });
        break;
      case "scatter":
        series.push({ ...common, width: 0, paths: () => null, points: { show: true, size: POINT_DIAMETER, width: 0, fill: stroke, stroke } });
        break;
      case "bar":
        series.push({ ...common, width: 0, fill: stroke, paths: uPlot.paths.bars?.({ size: [BAR_WIDTH_FRACTION, Infinity] }), points: { show: false } });
        break;
    }
  }

  const axes: uPlot.Axis[] = [
    { show: true, grid: { show: false }, size: BOTTOM_GUTTER },
    { show: true, grid: { show: false }, size: LEFT_GUTTER },
  ];
  const scales: uPlot.Scales = {
    x: { time: false, min: viewport.xMin, max: viewport.xMax },
    y: { auto: false, range: () => [spec.yMin, spec.yMax] },
  };
  if (spec.dualAxis) {
    axes.push({ show: true, scale: "y2", side: 1, grid: { show: false }, size: RIGHT_GUTTER });
    scales.y2 = { auto: false, range: () => [viewport.y2Min ?? spec.yMin, viewport.y2Max ?? spec.yMax] };
  }

  const options: uPlot.Options = {
    width: spec.width,
    height: spec.height,
    legend: { show: spec.hover === true, live: spec.hover === true },
    cursor: spec.hover ? { show: true, drag: { x: false, y: false } } : { show: false, drag: { x: false, y: false } },
    scales,
    axes,
    series,
    // Fixed gutters and no auto padding so the plotting rectangle matches BlazePlot's.
    padding: [0, 0, 0, 0],
    hooks: { draw: [() => { draws++; }] },
  };
  const plot = new uPlot(options, plotData, host);
  const pxRatio = window.devicePixelRatio || 1;

  let observer: ResizeObserver | null = null;
  if (spec.responsive) {
    // uPlot has no built-in container tracking; the documented pattern is a ResizeObserver that calls setSize().
    observer = new ResizeObserver(() => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width > 0 && height > 0 && (width !== plot.width || height !== plot.height)) plot.setSize({ width, height });
    });
    observer.observe(host);
  }

  const applyViewport = (next: ViewportRange): void => {
    plot.batch(() => {
      plot.setScale("x", { min: next.xMin, max: next.xMax });
      plot.setScale("y", { min: next.yMin, max: next.yMax });
      if (spec.dualAxis && next.y2Min !== undefined && next.y2Max !== undefined) plot.setScale("y2", { min: next.y2Min, max: next.y2Max });
    }, true);
  };

  return {
    setViewport: applyViewport,
    append: (startX, count, next) => {
      const x = xValues as number[];
      const y = yValues[0] as number[];
      for (let i = 0; i < count; i++) {
        x.push(startX + i);
        y.push(streamY(startX + i));
      }
      if (spec.windowed && x.length > spec.points) {
        // Sliding window: uPlot has no ring buffer, so the application drops the oldest samples.
        const excess = x.length - spec.points;
        x.splice(0, excess);
        y.splice(0, excess);
      }
      plot.batch(() => {
        plot.setData(plotData, false);
        plot.setScale("x", { min: next.xMin, max: next.xMax });
        plot.setScale("y", { min: next.yMin, max: next.yMax });
      }, true);
    },
    drawCount: () => draws,
    hasContent: () => draws > 0,
    plotWidth: () => plot.bbox.width / pxRatio,
    plotHeight: () => plot.bbox.height / pxRatio,
    hoverActive: () => plot.cursor.idx !== null && plot.cursor.idx !== undefined,
    destroy: () => {
      observer?.disconnect();
      plot.destroy();
    },
  };
}

// ----------------------------------------------------------------- Chart.js

type MutableChartJsDataset = ChartDataset<"line" | "bar" | "scatter", ChartJsPoint[]> & { _data?: ChartJsPoint[] };

function createChartJs(host: HTMLElement, spec: ChartSpec, data: LibraryData, viewport: ViewportRange): ChartHandle {
  if (data.library !== "chartjs") throw new Error("Chart.js adapter received data for another library.");
  const canvas = document.createElement("canvas");
  if (!spec.responsive) {
    canvas.width = spec.width;
    canvas.height = spec.height;
    canvas.style.width = `${spec.width}px`;
    canvas.style.height = `${spec.height}px`;
  }
  host.append(canvas);
  let draws = 0;

  const datasets: MutableChartJsDataset[] = data.points.map((points, k) => {
    const rgb = seriesColor(k, spec.seriesCount);
    const stroke = cssColor(rgb);
    const yAxisID = spec.dualAxis && k === 1 ? "y2" : "y";
    const base = { label: `Series ${k}`, data: points, parsing: false as const, normalized: true as const, yAxisID };
    switch (spec.kind) {
      case "line":
        return { ...base, borderColor: stroke, borderWidth: 1, pointRadius: 0, pointHitRadius: spec.hover ? 4 : 0, tension: 0 } as MutableChartJsDataset;
      case "area":
        return { ...base, borderColor: stroke, borderWidth: 1, pointRadius: 0, pointHitRadius: 0, tension: 0, fill: "origin", backgroundColor: cssColor(rgb, 0.25) } as MutableChartJsDataset;
      case "scatter":
        return { ...base, borderColor: stroke, backgroundColor: stroke, pointRadius: POINT_DIAMETER / 2, pointStyle: "circle", pointHitRadius: 0, showLine: false } as MutableChartJsDataset;
      case "bar":
        return { ...base, backgroundColor: stroke, borderWidth: 0 } as MutableChartJsDataset;
    }
  });
  const type = spec.kind === "bar" ? "bar" : spec.kind === "scatter" ? "scatter" : "line";
  const scales: Record<string, unknown> = {
    x: {
      type: "linear",
      min: viewport.xMin,
      max: viewport.xMax,
      ticks: { sampleSize: 8, maxRotation: 0 },
      grid: { display: false },
      afterFit: (scale: { height: number; paddingLeft: number; paddingRight: number }) => {
        scale.height = BOTTOM_GUTTER;
        scale.paddingLeft = 0;
        scale.paddingRight = 0;
      },
    },
    y: {
      type: "linear",
      min: viewport.yMin,
      max: viewport.yMax,
      ticks: { sampleSize: 8, maxRotation: 0 },
      grid: { display: false },
      afterFit: (scale: { width: number; paddingTop: number; paddingBottom: number }) => {
        scale.width = LEFT_GUTTER;
        scale.paddingTop = 0;
        scale.paddingBottom = 0;
      },
    },
  };
  if (spec.dualAxis) {
    scales.y2 = {
      type: "linear",
      position: "right",
      min: viewport.y2Min ?? spec.yMin,
      max: viewport.y2Max ?? spec.yMax,
      ticks: { sampleSize: 8, maxRotation: 0 },
      grid: { display: false },
      afterFit: (scale: { width: number; paddingTop: number; paddingBottom: number }) => {
        scale.width = RIGHT_GUTTER;
        scale.paddingTop = 0;
        scale.paddingBottom = 0;
      },
    };
  }
  const config = {
    type,
    data: { datasets },
    options: {
      responsive: spec.responsive === true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      events: spec.hover ? ["mousemove", "mouseout"] : [],
      devicePixelRatio: window.devicePixelRatio,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      elements: {
        point: { radius: 0, hitRadius: spec.hover ? 4 : 0, hoverRadius: spec.hover ? 3 : 0 },
        line: { borderWidth: 1, tension: 0 },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: spec.hover === true },
        decimation: spec.kind === "line" || spec.kind === "area"
          ? { enabled: true, algorithm: "min-max", threshold: Math.max(1_000, spec.width * 4) }
          : { enabled: false },
      },
      scales,
    },
    plugins: [{ id: "benchmarkDrawCount", afterRender: () => { draws++; } }],
  } as unknown as ChartConfiguration;
  const chart = new ChartJs(canvas, config);

  const applyViewport = (next: ViewportRange): void => {
    const target = chart.options.scales as Record<string, { min?: number; max?: number } | undefined>;
    const x = target.x;
    const y = target.y;
    const y2 = target.y2;
    if (x) {
      x.min = next.xMin;
      x.max = next.xMax;
    }
    if (y) {
      y.min = next.yMin;
      y.max = next.yMax;
    }
    if (y2 && next.y2Min !== undefined && next.y2Max !== undefined) {
      y2.min = next.y2Min;
      y2.max = next.y2Max;
    }
  };

  return {
    setViewport: (next) => {
      applyViewport(next);
      chart.update("none");
    },
    append: (startX, count, next) => {
      const dataset = datasets[0]!;
      const source = dataset._data ?? dataset.data;
      for (let i = 0; i < count; i++) source.push({ x: startX + i, y: streamY(startX + i) });
      if (spec.windowed && source.length > spec.points) source.splice(0, source.length - spec.points);
      applyViewport(next);
      chart.update("none");
    },
    drawCount: () => draws,
    hasContent: () => draws > 0,
    plotWidth: () => chart.chartArea.right - chart.chartArea.left,
    plotHeight: () => chart.chartArea.bottom - chart.chartArea.top,
    hoverActive: () => chart.tooltip !== undefined && (chart.tooltip?.getActiveElements().length ?? 0) > 0,
    destroy: () => chart.destroy(),
  };
}
