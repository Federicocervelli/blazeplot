import type { SeriesStore } from "../core/SeriesStore.js";
import type { AxisController } from "../interaction/AxisController.js";
import type {
  ChartEventMap,
  ChartHoverState,
  ChartInspectionTarget,
  ChartPickItem,
  ChartPickOptions,
  ChartPointerEvent,
  ChartPointerEventType,
} from "./ChartEvents.js";
import { ChartPicker, hoverStatesEqual, insidePlot, plotToData } from "./ChartPicker.js";
import type { PlotRect } from "./ChartPicker.js";

/** What hover tracking reads from and reports to the chart. */
export interface ChartHoverHost {
  readonly picker: ChartPicker;
  canvas(): HTMLCanvasElement;
  view(): Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;
  series(): readonly SeriesStore[];
  hoverOptions(): ChartPickOptions | undefined;
  /** Plot size in CSS pixels from the chart's last layout read; reading it never forces layout. */
  plotSize(): { readonly width: number; readonly height: number };
  /** Controller of the left Y axis, which maps pointer positions to data. */
  axis(): AxisController;
  emit<K extends "hover" | ChartPointerEventType | "seriesclick">(event: K, payload: ChartEventMap[K]): void;
  hasListeners(event: "pointermove"): boolean;
}

/**
 * Pointer and keyboard-inspection hover state: tracks the last pointer position, re-picks under
 * it each frame, emits pointer events, and keeps the inspected sample's hover state.
 */
export class ChartHover {
  /** Current hover state, or `null` when nothing is hovered. */
  state: ChartHoverState | null = null;
  /** Sample under keyboard inspection; takes precedence over the pointer. */
  inspection: ChartInspectionTarget | null = null;
  private lastClientX = 0;
  private lastClientY = 0;
  private lastPlotX = 0;
  private lastPlotY = 0;
  private lastButtons = 0;
  private pointerInPlot = false;
  private rafId = 0;

  readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") {
      // A real pointer over the plot takes over from keyboard inspection.
      this.inspection = null;
      this.pointerInPlot = true;
      this.lastClientX = event.clientX;
      this.lastClientY = event.clientY;
      this.lastPlotX = event.offsetX;
      this.lastPlotY = event.offsetY;
      this.lastButtons = event.buttons;
      // Resolve now: the overlay plugins that subscribe to `hover` only touch DOM, so the pointer is answered in
      // this event instead of a frame later. Browsers deliver at most one mouse move per frame (last wins), so
      // this is not extra work, and the plot size is cached, so it adds no layout read.
      this.cancelScheduled();
      this.refresh();
    }
    if (this.host.hasListeners("pointermove")) this.emitPointerEvent("pointermove", event);
  };
  readonly onPointerDown = (event: PointerEvent): void => {
    this.lastButtons = event.buttons;
    if (event.pointerType === "touch") {
      this.pointerInPlot = false;
      this.set(this.inspectionHoverState());
    }
    this.emitPointerEvent("pointerdown", event);
  };
  readonly onPointerUp = (event: PointerEvent): void => {
    this.lastButtons = event.buttons;
    this.emitPointerEvent("pointerup", event);
    this.refresh();
  };
  readonly onClick = (event: MouseEvent): void => {
    const pointerEvent = this.emitPointerEvent("click", event);
    const item = pointerEvent?.items[0];
    if (pointerEvent && item) this.host.emit("seriesclick", { ...pointerEvent, item });
  };
  readonly onDoubleClick = (event: MouseEvent): void => {
    this.emitPointerEvent("dblclick", event);
  };
  readonly onPointerLeave = (): void => {
    this.pointerInPlot = false;
    this.lastButtons = 0;
    this.set(this.inspectionHoverState());
  };

  constructor(private readonly host: ChartHoverHost) {}

  /** Re-pick on the next animation frame; coalesces bursts of pointer moves. */
  schedule(): void {
    if (this.rafId !== 0) return;
    this.rafId = this.host.view().requestAnimationFrame(() => {
      this.rafId = 0;
      this.refresh();
    });
  }

  /** Drop a scheduled refresh (the render that is about to run refreshes anyway). */
  cancelScheduled(): void {
    if (this.rafId === 0) return;
    this.host.view().cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /**
   * Re-pick under the last pointer position; while a button is held, keep the same items and only reproject them.
   * A caller that already read the plot size this frame passes it in, so the refresh adds no layout read.
   */
  refresh(): void {
    if (this.inspection) {
      this.set(this.inspectionHoverState());
      return;
    }
    if (!this.pointerInPlot) return;
    const { width, height } = this.host.plotSize();
    const rect: PlotRect = {
      left: this.lastClientX - this.lastPlotX,
      top: this.lastClientY - this.lastPlotY,
      width,
      height,
    };
    if (this.lastButtons !== 0) {
      this.set(this.host.picker.reprojectHoverState(this.state, rect, { clientX: this.lastClientX, clientY: this.lastClientY, plotX: this.lastPlotX, plotY: this.lastPlotY }));
      return;
    }
    this.set(this.host.picker.pickAtPlot(this.lastPlotX, this.lastPlotY, this.lastClientX, this.lastClientY, rect));
  }

  /** Emit `hover` only when the picked items or the anchor actually changed. */
  set(state: ChartHoverState | null): void {
    if (hoverStatesEqual(this.state, state)) return;
    this.state = state;
    this.host.emit("hover", state);
  }

  /** Show a sample as the hover state (keyboard inspection), or end inspection with `null`. */
  inspect(target: ChartInspectionTarget | null): ChartHoverState | null {
    if (target) {
      if (!this.host.series().includes(target.series)) throw new RangeError("chart inspection target series is not attached to this chart.");
      if (!Number.isInteger(target.index) || target.index < 0 || target.index >= target.series.length) {
        throw new RangeError(`chart inspection index ${target.index} is outside the series (length ${target.series.length}).`);
      }
      this.inspection = { series: target.series, index: target.index };
      this.set(this.inspectionHoverState());
    } else {
      this.inspection = null;
      if (this.pointerInPlot) this.refresh();
      else this.set(null);
    }
    return this.state;
  }

  /**
   * Hover state for the inspected sample: it is `items[0]`, followed by other visible series at
   * the same X when hover grouping is `"x"`. `null` when it is hidden, a gap, or outside the plot.
   */
  private inspectionHoverState(): ChartHoverState | null {
    const target = this.inspection;
    if (!target) return null;
    const { series } = target;
    const seriesIndex = this.host.series().indexOf(series);
    const sample = seriesIndex === -1 || !series.visible ? null : series.sampleAt(target.index);
    if (!sample) return null;
    const { picker } = this.host;
    const rect = this.host.canvas().getBoundingClientRect();
    const probe = picker.createPickItem(sample, series, seriesIndex, 0, 0, rect);
    if (!insidePlot(probe.plotX, probe.plotY, rect)) return null;
    const { clientX, clientY } = probe;
    const primary: ChartPickItem = { ...probe, distancePx: 0 };
    const group = this.host.hoverOptions()?.group ?? "x";
    const items = group === "none"
      ? [primary]
      : [primary, ...picker.collectPickItems(sample.x, clientX, clientY, rect).filter((item) => item.series !== series)];
    return {
      clientX,
      clientY,
      plotX: primary.plotX,
      plotY: primary.plotY,
      dataX: sample.x,
      dataY: sample.y,
      anchorX: sample.x,
      mode: "nearest-x",
      group,
      maxDistancePx: Infinity,
      items,
      source: "inspection",
    };
  }

  private emitPointerEvent(type: ChartPointerEventType, source: MouseEvent | PointerEvent): ChartPointerEvent | null {
    const rect = this.host.canvas().getBoundingClientRect();
    const plotX = source.clientX - rect.left;
    const plotY = source.clientY - rect.top;
    if (!insidePlot(plotX, plotY, rect)) return null;

    const [dataX, dataY] = plotToData(plotX, plotY, rect, this.host.axis());
    const hover = this.host.picker.pickAtPlot(plotX, plotY, source.clientX, source.clientY, rect, this.host.hoverOptions());
    const event: ChartPointerEvent = {
      type,
      clientX: source.clientX,
      clientY: source.clientY,
      plotX,
      plotY,
      dataX,
      dataY,
      button: source.button,
      buttons: source.buttons,
      altKey: source.altKey,
      ctrlKey: source.ctrlKey,
      metaKey: source.metaKey,
      shiftKey: source.shiftKey,
      items: hover?.items ?? [],
    };
    this.host.emit(type, event);
    return event;
  }

  /** Cancel the pending refresh and forget inspection. */
  dispose(): void {
    this.cancelScheduled();
    this.inspection = null;
  }
}
