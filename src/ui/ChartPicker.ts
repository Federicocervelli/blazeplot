import type { Camera2D } from "../interaction/Camera2D.js";
import type { AxisController } from "../interaction/AxisController.js";
import type { SeriesSample, SeriesYAxis } from "../core/types.js";
import type { SeriesStore } from "../core/SeriesStore.js";
import type { ChartHoverState, ChartPickItem, ChartPickOptions } from "./ChartTypes.js";

interface PickCandidate {
  readonly sample: SeriesSample;
  readonly series: SeriesStore;
  readonly seriesIndex: number;
}

/** Plot rectangle in client coordinates (`left`/`top`) and CSS-pixel size. */
export interface PlotRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Last known pointer position, used to reproject held hover items. */
export interface PickPointer {
  readonly clientX: number;
  readonly clientY: number;
  readonly plotX: number;
  readonly plotY: number;
}

/** What the picker reads from the chart. */
export interface PickSource {
  series(): readonly SeriesStore[];
  camera(yAxis: SeriesYAxis | undefined): Camera2D;
  controller(yAxis: SeriesYAxis | undefined): AxisController;
  /** Chart-level default pick options (`ChartOptions.hover`). */
  hoverDefaults(): ChartPickOptions | undefined;
}

/** Whether a plot-local point lies inside a plot of the given size. */
export function insidePlot(plotX: number, plotY: number, rect: PlotRect): boolean {
  return rect.width > 0 && rect.height > 0 && plotX >= 0 && plotY >= 0 && plotX <= rect.width && plotY <= rect.height;
}

/** Plot-local CSS pixels to data coordinates through the axis controller. */
export function plotToData(plotX: number, plotY: number, rect: PlotRect, controller: AxisController): [number, number] {
  return [
    controller.clipToValue((plotX / rect.width) * 2 - 1, "x"),
    controller.clipToValue(1 - (plotY / rect.height) * 2, "y"),
  ];
}

/** Nearest-sample search, pick-item construction, and hover reprojection for a chart. */
export class ChartPicker {
  constructor(private readonly source: PickSource) {}

  pickAtPlot(
    plotX: number,
    plotY: number,
    clientX: number,
    clientY: number,
    rect: PlotRect,
    options: ChartPickOptions = {},
  ): ChartHoverState | null {
    if (!insidePlot(plotX, plotY, rect)) return null;

    const [dataX, dataY] = plotToData(plotX, plotY, rect, this.source.controller("left"));
    const mode = options.mode ?? this.source.hoverDefaults()?.mode ?? "nearest-x";
    const group = options.group ?? this.source.hoverDefaults()?.group ?? "x";
    const maxDistancePx = options.maxDistancePx ?? this.source.hoverDefaults()?.maxDistancePx ?? Infinity;
    const selected = mode === "nearest-point"
      ? this.findNearestPointCandidate(dataX, plotY, rect, maxDistancePx)
      : this.findNearestXCandidate(dataX, rect.width, maxDistancePx);
    if (!selected) return null;

    const anchorX = selected.sample.x;
    const items = group === "none"
      ? [this.createPickItem(selected.sample, selected.series, selected.seriesIndex, clientX, clientY, rect)]
      : this.collectPickItems(anchorX, clientX, clientY, rect);
    return { clientX, clientY, plotX, plotY, dataX, dataY, anchorX, mode, group, maxDistancePx, items, source: "pointer" };
  }

  private findNearestXCandidate(dataX: number, plotWidth: number, maxDistancePx: number): PickCandidate | null {
    let best: PickCandidate | null = null;
    let bestDistancePx = Infinity;

    for (let seriesIndex = 0; seriesIndex < this.source.series().length; seriesIndex++) {
      const series = this.source.series()[seriesIndex]!;
      if (!series.visible) continue;
      const viewport = this.source.camera(series.config.yAxis).viewport;
      const controller = this.source.controller(series.config.yAxis);
      const sample = series.nearestSampleByX(dataX, viewport);
      if (!sample) continue;
      const xScale = plotWidth / (controller.scaleValue(viewport.xMax, "x") - controller.scaleValue(viewport.xMin, "x"));
      const distancePx = Math.abs(controller.scaleValue(sample.x, "x") - controller.scaleValue(dataX, "x")) * xScale;
      if (distancePx < bestDistancePx) {
        best = { sample, series, seriesIndex };
        bestDistancePx = distancePx;
      }
    }

    return best && bestDistancePx <= maxDistancePx ? best : null;
  }

  private findNearestPointCandidate(dataX: number, plotY: number, rect: PlotRect, maxDistancePx: number): PickCandidate | null {
    let best: PickCandidate | null = null;
    for (let seriesIndex = 0; seriesIndex < this.source.series().length; seriesIndex++) {
      const series = this.source.series()[seriesIndex]!;
      if (!series.visible) continue;
      const viewport = this.source.camera(series.config.yAxis).viewport;
      const controller = this.source.controller(series.config.yAxis);
      const dataY = controller.clipToValue(1 - (plotY / rect.height) * 2, "y");
      const sample = series.nearestSampleByPoint(
        dataX,
        dataY,
        viewport,
        rect.width,
        rect.height,
        maxDistancePx,
        controller.isNonlinear("x") ? (value) => controller.scaleValue(value, "x") : undefined,
        controller.isNonlinear("y") ? (value) => controller.scaleValue(value, "y") : undefined,
      );
      if (!sample) continue;
      if (!best || (sample.distancePx ?? Infinity) < (best.sample.distancePx ?? Infinity)) {
        best = { sample, series, seriesIndex };
      }
    }

    return best && (best.sample.distancePx ?? Infinity) <= maxDistancePx ? best : null;
  }

  collectPickItems(anchorX: number, clientX: number, clientY: number, rect: PlotRect): ChartPickItem[] {
    const items: ChartPickItem[] = [];
    for (let seriesIndex = 0; seriesIndex < this.source.series().length; seriesIndex++) {
      const series = this.source.series()[seriesIndex]!;
      if (!series.visible) continue;
      const sample = series.nearestSampleByX(anchorX, this.source.camera(series.config.yAxis).viewport);
      if (sample) items.push(this.createPickItem(sample, series, seriesIndex, clientX, clientY, rect));
    }
    return items;
  }

  createPickItem(
    sample: SeriesSample,
    series: SeriesStore,
    seriesIndex: number,
    clientX: number,
    clientY: number,
    rect: PlotRect,
  ): ChartPickItem {
    const yAxis = series.config.yAxis;
    const controller = this.source.controller(yAxis);
    const [plotX, plotY] = this.source.camera(yAxis).toScreen(
      controller.valueToClip(sample.x, "x"),
      controller.valueToClip(sample.y, "y"),
      rect.width,
      rect.height,
    );
    const itemClientX = rect.left + plotX;
    const itemClientY = rect.top + plotY;
    const xRange = series.xRangeAt(sample.index);
    return {
      index: sample.index,
      x: sample.x,
      y: sample.y,
      ...(xRange ? { xRange } : {}),
      distancePx: Math.hypot(itemClientX - clientX, itemClientY - clientY),
      series,
      seriesIndex,
      id: series.config.id,
      name: series.config.name,
      mode: series.config.mode,
      plotX,
      plotY,
      clientX: itemClientX,
      clientY: itemClientY,
    };
  }


  reprojectHoverState(state: ChartHoverState | null, rect: PlotRect, pointer: PickPointer): ChartHoverState | null {
    if (!state || state.items.length === 0 || rect.width <= 0 || rect.height <= 0) return null;
    const items: ChartPickItem[] = [];
    for (const item of state.items) {
      if (item.series.visible) items.push(this.createPickItem(item, item.series, item.seriesIndex, pointer.clientX, pointer.clientY, rect));
    }
    const anchor = items[0];
    if (!anchor || !insidePlot(anchor.plotX, anchor.plotY, rect)) return null;

    return {
      ...state,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      plotX: pointer.plotX,
      plotY: pointer.plotY,
      items,
    };
  }
}

/** Coordinates closer than this many CSS pixels count as unchanged. */
const HOVER_EPSILON_PX = 1e-3;

const near = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= HOVER_EPSILON_PX;

/** Whether two hover states show the same items at the same anchor (series, index, x, y, and position). */
export function hoverStatesEqual(a: ChartHoverState | null, b: ChartHoverState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.source !== b.source || a.mode !== b.mode || a.group !== b.group || a.maxDistancePx !== b.maxDistancePx) return false;
  if (a.items.length !== b.items.length) return false;
  if (!near(a.plotX, b.plotX) || !near(a.plotY, b.plotY) || !near(a.clientX, b.clientX) || !near(a.clientY, b.clientY)) return false;
  if (!Object.is(a.anchorX, b.anchorX) || !Object.is(a.dataX, b.dataX) || !Object.is(a.dataY, b.dataY)) return false;
  for (let i = 0; i < a.items.length; i++) {
    const p = a.items[i]!;
    const q = b.items[i]!;
    if (p.series !== q.series || p.index !== q.index || !Object.is(p.x, q.x) || !Object.is(p.y, q.y)) return false;
    if (!near(p.plotX, q.plotX) || !near(p.plotY, q.plotY)) return false;
    if (p.xRange?.xStart !== q.xRange?.xStart || p.xRange?.xEnd !== q.xRange?.xEnd) return false;
  }
  return true;
}
