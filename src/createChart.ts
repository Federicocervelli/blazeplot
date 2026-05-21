import { StaticDataset } from "./core/StaticDataset.js";
import type { StaticDatasetField } from "./core/StaticDataset.js";
import type { BufferOverflowStrategy, Dataset, LODStrategy, SeriesMode, SeriesStyle, SeriesYAxis } from "./core/types.js";
import { Chart } from "./ui/Chart.js";
import type { ChartFitToDataOptions, ChartOptions } from "./ui/Chart.js";

export type CreateChartSeriesType = Extract<SeriesMode, "line" | "area" | "scatter" | "bar">;

interface CreateChartSeriesBase {
  readonly type?: CreateChartSeriesType;
  readonly mode?: CreateChartSeriesType;
  readonly id?: string;
  readonly name?: string;
  readonly yAxis?: SeriesYAxis;
  readonly downsample?: LODStrategy;
  readonly style?: Partial<SeriesStyle>;
}

export interface CreateChartDatasetSeries extends CreateChartSeriesBase {
  readonly dataset: Dataset;
}

export interface CreateChartArraySeries extends CreateChartSeriesBase {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

export interface CreateChartObjectSeries<Row> extends CreateChartSeriesBase {
  readonly data: readonly Row[];
  readonly x: StaticDatasetField<Row>;
  readonly y: StaticDatasetField<Row>;
  readonly sort?: boolean;
}

export interface CreateChartStreamingSeries extends CreateChartSeriesBase {
  readonly capacity: number;
  readonly overflow?: BufferOverflowStrategy;
}

export type CreateChartSeries<Row = Record<string, unknown>> =
  | CreateChartDatasetSeries
  | CreateChartArraySeries
  | CreateChartObjectSeries<Row>
  | CreateChartStreamingSeries;

/**
 * High-level chart configuration for common first-render cases.
 *
 * Use `createChart(...)` when you have static arrays, object rows, or a simple
 * streaming buffer and want BlazePlot to create the chart, add series, fit the
 * initial viewport, and start rendering in one call.
 */
export interface CreateChartOptions<Row = Record<string, unknown>> extends ChartOptions {
  readonly series?: readonly CreateChartSeries<Row>[];
  /**
   * Fit the viewport after adding initial series. Enabled by default because
   * this helper is optimized for first-render ergonomics.
   */
  readonly autoFit?: boolean | ChartFitToDataOptions;
  /**
   * Start the render loop before returning. Enabled by default.
   */
  readonly start?: boolean;
}

/**
 * Create a chart from a compact declarative config.
 *
 * This helper is intentionally thin: it returns the underlying `Chart` instance,
 * so advanced code can still use the full imperative API after setup.
 */
export function createChart<Row = Record<string, unknown>>(
  target: HTMLElement,
  options: CreateChartOptions<Row> = {},
): Chart {
  const { series = [], autoFit = true, start = true, ...chartOptions } = options;
  const chart = new Chart(target, chartOptions);

  for (const item of series) {
    const mode = resolveSeriesMode(item);
    chart.addSeries({
      mode,
      dataset: resolveSeriesDataset(item),
      capacity: "capacity" in item ? item.capacity : undefined,
      overflow: "overflow" in item ? item.overflow : undefined,
      downsample: item.downsample,
      id: item.id,
      name: item.name,
      yAxis: item.yAxis,
    }, item.style);
  }

  if (autoFit) {
    chart.fitToData(typeof autoFit === "object" ? autoFit : undefined);
  }
  if (start) {
    chart.start();
  }

  return chart;
}

function resolveSeriesMode<Row>(series: CreateChartSeries<Row>): CreateChartSeriesType {
  const mode = series.mode ?? series.type ?? "line";
  if (series.mode && series.type && series.mode !== series.type) {
    throw new TypeError(`createChart series mode mismatch: received mode "${series.mode}" and type "${series.type}".`);
  }
  return mode;
}

function resolveSeriesDataset<Row>(series: CreateChartSeries<Row>): Dataset | undefined {
  if ("dataset" in series) return series.dataset;
  if ("data" in series) return StaticDataset.fromObjects(series.data, {
    x: series.x,
    y: series.y,
    sort: series.sort,
  });
  if ("x" in series) return new StaticDataset(series.x, series.y);
  return undefined;
}
