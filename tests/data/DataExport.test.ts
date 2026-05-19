import { describe, expect, it } from "bun:test";
import { StaticDataset } from "../../src/core/StaticDataset.ts";
import { StaticOhlcDataset } from "../../src/core/OhlcDataset.ts";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import type { SeriesMode, SeriesYAxis, Viewport } from "../../src/core/types.ts";
import type { Chart, ChartSeriesState } from "../../src/ui/Chart.ts";
import type { SelectionState } from "../../src/ui/Selection.ts";
import {
  binSamples,
  chartDataToCSV,
  chartDataToJSON,
  exportSelectedChartData,
  exportVisibleChartData,
  rollingMean,
} from "../../src/data.ts";

const STYLE = { color: [1, 1, 1, 1] as const, lineWidth: 1 };
const LEFT_VIEWPORT: Viewport = { xMin: 1, xMax: 3, yMin: 15, yMax: 35 };
const RIGHT_VIEWPORT: Viewport = { xMin: 1, xMax: 3, yMin: -100, yMax: 100 };

function makeSeries(
  mode: SeriesMode,
  x: readonly number[],
  y: readonly number[],
  options: { id?: string; name?: string; yAxis?: SeriesYAxis; visible?: boolean } = {},
): ChartSeriesState {
  const dataset = new StaticDataset(x, y);
  const series = new SeriesStore(
    dataset,
    { mode, dataset, id: options.id, name: options.name, yAxis: options.yAxis },
    STYLE,
  );
  series.setVisible(options.visible ?? true);
  return {
    series,
    index: 0,
    id: options.id,
    name: options.name,
    mode,
    visible: series.visible,
    color: STYLE.color,
    yAxis: options.yAxis ?? "left",
  };
}

function makeOhlcSeries(): ChartSeriesState {
  const dataset = new StaticOhlcDataset([1, 2, 3], [10, 20, 30], [14, 26, 40], [8, 18, 28], [13, 24, 32]);
  const series = new SeriesStore(dataset, { mode: "candlestick", dataset, id: "ohlc" }, STYLE);
  return {
    series,
    index: 0,
    id: "ohlc",
    mode: "candlestick",
    visible: true,
    color: STYLE.color,
    yAxis: "left",
  };
}

function makeChart(states: readonly ChartSeriesState[]): Chart {
  return {
    getSeriesState: () => states,
    getViewport: (axis: SeriesYAxis = "left") => axis === "right" ? RIGHT_VIEWPORT : LEFT_VIEWPORT,
  } as unknown as Chart;
}

describe("chart data export helpers", () => {
  it("collects visible x-range data and serializes CSV/JSON", () => {
    const state = makeSeries("line", [0, 1, 2, 3, 4], [10, 20, 30, 40, 50], { id: "s,1", name: "quoted \"name\"" });
    const chart = makeChart([state]);

    const data = exportVisibleChartData(chart, { maxRowsPerSeries: 2 });

    expect(data.source).toBe("visible");
    expect(data.series[0]?.total).toBe(3);
    expect(data.series[0]?.truncated).toBe(true);
    expect(data.series[0]?.samples).toEqual([
      { index: 1, x: 1, y: 20 },
      { index: 2, x: 2, y: 30 },
    ]);

    const csv = chartDataToCSV(data);
    expect(csv).toContain('"s,1","quoted ""name"""');
    expect(csv.split("\n")).toHaveLength(3);

    expect(JSON.parse(chartDataToJSON(data)).series[0].samples[1]).toEqual({ index: 2, x: 2, y: 30 });
  });

  it("can filter visible exports by y viewport", () => {
    const state = makeSeries("scatter", [1, 2, 3], [10, 20, 90]);
    const data = exportVisibleChartData(makeChart([state]), { includeYRange: true });

    expect(data.series[0]?.samples).toEqual([{ index: 1, x: 2, y: 20 }]);
  });

  it("collects selected xy data only for the selected y axis", () => {
    const left = makeSeries("line", [1, 2, 3], [10, 20, 30], { id: "left" });
    const right = makeSeries("line", [1, 2, 3], [20, 30, 40], { id: "right", yAxis: "right" });
    const selection: SelectionState = {
      mode: "xy",
      yAxis: "left",
      bounds: { xMin: 1, xMax: 3, yMin: 15, yMax: 35 },
      plotBounds: { left: 0, top: 0, width: 10, height: 10 },
      samples: [],
    };

    const data = exportSelectedChartData(makeChart([left, right]), selection);

    expect(data.series).toHaveLength(1);
    expect(data.series[0]?.id).toBe("left");
    expect(data.series[0]?.samples).toEqual([
      { index: 1, x: 2, y: 20 },
      { index: 2, x: 3, y: 30 },
    ]);
  });

  it("includes all axes for x-range selections", () => {
    const left = makeSeries("line", [1, 2], [10, 20], { id: "left" });
    const right = makeSeries("line", [1, 2], [30, 40], { id: "right", yAxis: "right" });
    const selection: SelectionState = {
      mode: "x-range",
      yAxis: "left",
      bounds: { xMin: 1, xMax: 1, yMin: -Infinity, yMax: Infinity },
      plotBounds: { left: 0, top: 0, width: 10, height: 10 },
      samples: [],
    };

    const data = exportSelectedChartData(makeChart([left, right]), selection);

    expect(data.series.map((series) => series.id)).toEqual(["left", "right"]);
    expect(data.series[1]?.samples).toEqual([{ index: 0, x: 1, y: 30 }]);
  });

  it("exports OHLC fields and filters by candle high/low overlap", () => {
    const state = makeOhlcSeries();
    const data = exportVisibleChartData(makeChart([state]), { includeYRange: true });

    expect(data.series[0]?.samples).toEqual([
      { index: 1, x: 2, y: 24, open: 20, high: 26, low: 18, close: 24 },
      { index: 2, x: 3, y: 32, open: 30, high: 40, low: 28, close: 32 },
    ]);
  });
});

describe("pure data transforms", () => {
  it("bins samples with reducers", () => {
    const binned = binSamples([
      { x: 0, y: 1 },
      { x: 0.5, y: 3 },
      { x: 1.2, y: 5 },
    ], 1, { reducer: "mean", x: "start" });

    expect(binned).toEqual([
      { x: 0, y: 2, xStart: 0, xEnd: 1, count: 2, minY: 1, maxY: 3 },
      { x: 1, y: 5, xStart: 1, xEnd: 2, count: 1, minY: 5, maxY: 5 },
    ]);
  });

  it("computes rolling means", () => {
    expect(rollingMean([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 8 },
    ], 2)).toEqual([
      { x: 1, y: 2, count: 1 },
      { x: 2, y: 3, count: 2 },
      { x: 3, y: 6, count: 2 },
    ]);
  });
});
