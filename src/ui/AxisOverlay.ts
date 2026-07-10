import type { AxisController } from "../interaction/AxisController.js";
import type { ChartLayoutElements, ChartLayoutConfig } from "./ChartLayout.js";

/** Visual options for SVG axis overlays. */
export interface AxisOverlayOptions {
  readonly font?: string;
  readonly color?: string;
}

/** Axis layout configuration consumed by `AxisOverlay`. */
export type AxisOverlayConfig = ChartLayoutConfig;

type RenderAxis = "x" | "y" | "y2";

const AXIS_LABEL_COLLISION_GAP_PX = 2;

interface AxisLabelInterval {
  readonly el: HTMLDivElement;
  readonly start: number;
  readonly end: number;
  readonly edge: boolean;
}

function hideOverlappingLabels(labels: readonly AxisLabelInterval[]): void {
  const placed: Array<{ start: number; end: number }> = [];
  for (const label of [...labels].sort((a, b) => Number(b.edge) - Number(a.edge) || a.start - b.start)) {
    const overlaps = placed.some((used) => label.start < used.end + AXIS_LABEL_COLLISION_GAP_PX && label.end > used.start - AXIS_LABEL_COLLISION_GAP_PX);
    if (overlaps) {
      label.el.style.display = "none";
    } else {
      placed.push({ start: label.start, end: label.end });
    }
  }
}

/** SVG overlay that renders chart axes and ticks. */
export class AxisOverlay {
  private xPool: HTMLDivElement[] = [];
  private yPool: HTMLDivElement[] = [];
  private y2Pool: HTMLDivElement[] = [];
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];
  private readonly y2Ticks: number[] = [];
  private readonly measureContext = document.createElement("canvas").getContext("2d");

  /** Create an axis overlay attached to a chart layout. */
  constructor(
    private readonly layout: ChartLayoutElements,
    private readonly config: AxisOverlayConfig,
    private options: AxisOverlayOptions = {},
  ) {}

  /** Update axis overlay styling. */
  setOptions(options: AxisOverlayOptions): void {
    this.options = options;
    for (const el of [...this.xPool, ...this.yPool, ...this.y2Pool]) {
      el.style.font = this.options.font ?? "11px ui-monospace, monospace, sans-serif";
      el.style.color = this.options.color ?? "#bfd6ff";
    }
  }

  /** Render axis ticks from the latest camera and axis controller state. */
  update(axis: AxisController, rightAxis: AxisController = axis): void {
    const plotW = Math.max(1, this.layout.plot.clientWidth);
    const plotH = Math.max(1, this.layout.plot.clientHeight);

    if (this.config.x.visible) {
      axis.getXTickValues(plotW, 12, this.xTicks);
    } else {
      this.xTicks.length = 0;
    }

    if (this.config.y.visible) {
      axis.getYTickValues(plotH, 8, this.yTicks);
    } else {
      this.yTicks.length = 0;
    }

    if (this.config.y2.visible) {
      rightAxis.getYTickValues(plotH, 8, this.y2Ticks);
    } else {
      this.y2Ticks.length = 0;
    }

    this.updateAxis(this.xPool, this.xTicks, "x", plotW, plotH, axis);
    this.updateAxis(this.yPool, this.yTicks, "y", plotW, plotH, axis);
    this.updateAxis(this.y2Pool, this.y2Ticks, "y2", plotW, plotH, rightAxis);
  }

  /** Remove all axis overlay DOM nodes. */
  dispose(): void {
    for (const el of this.xPool) el.remove();
    for (const el of this.yPool) el.remove();
    for (const el of this.y2Pool) el.remove();
    this.xPool = [];
    this.yPool = [];
    this.y2Pool = [];
  }

  private parentForAxis(axis: RenderAxis): HTMLElement {
    if (axis === "x") {
      return this.config.x.position === "outside" ? this.layout.xAxis : this.layout.plot;
    }
    if (axis === "y2") {
      return this.config.y2.position === "outside" ? this.layout.y2Axis : this.layout.plot;
    }
    return this.config.y.position === "outside" ? this.layout.yAxis : this.layout.plot;
  }

  private updateAxis(
    pool: HTMLDivElement[],
    values: number[],
    axis: RenderAxis,
    plotW: number,
    plotH: number,
    controller: AxisController,
  ): void {
    const parent = this.parentForAxis(axis);

    while (pool.length < values.length) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      el.style.whiteSpace = "nowrap";
      el.style.font = this.options.font ?? "11px ui-monospace, monospace, sans-serif";
      el.style.color = this.options.color ?? "#bfd6ff";
      el.style.userSelect = "none";
      parent.appendChild(el);
      pool.push(el);
    }

    for (const el of pool) {
      if (el.parentElement !== parent) parent.appendChild(el);
    }

    for (let i = values.length; i < pool.length; i++) {
      pool[i]!.style.display = "none";
    }

    if (axis === "x") {
      const labels: AxisLabelInterval[] = [];
      for (let i = 0; i < values.length; i++) {
        const el = pool[i]!;
        const value = values[i]!;
        const text = controller.formatValue(value, "x");
        if (el.textContent !== text) el.textContent = text;
        const screenX = (controller.valueToClip(value, "x") + 1) * 0.5 * plotW;
        if (screenX < 0 || screenX > plotW) {
          el.style.display = "none";
          continue;
        }
        el.style.display = "block";
        const labelWidth = this.measureLabel(text, "width");
        const centeredLeft = screenX - labelWidth * 0.5;
        const maxLeft = Math.max(0, plotW - labelWidth);
        const labelLeft = Math.min(Math.max(0, centeredLeft), maxLeft);
        const edge = labelLeft === 0 || labelLeft === maxLeft;
        el.style.left = `${labelLeft}px`;
        el.style.right = "auto";
        el.style.transform = "none";
        if (this.config.x.position === "outside") {
          el.style.top = "4px";
          el.style.bottom = "auto";
        } else {
          el.style.top = "auto";
          el.style.bottom = "4px";
        }
        labels.push({ el, start: labelLeft, end: labelLeft + labelWidth, edge });
      }

      hideOverlappingLabels(labels);
      return;
    }

    const isRight = axis === "y2";
    const config = isRight ? this.config.y2 : this.config.y;
    const labels: AxisLabelInterval[] = [];
    for (let i = 0; i < values.length; i++) {
      const el = pool[i]!;
      const value = values[i]!;
      const text = controller.formatValue(value, "y");
      if (el.textContent !== text) el.textContent = text;
      const screenY = (1 - controller.valueToClip(value, "y")) * 0.5 * plotH;
      if (screenY < 0 || screenY > plotH) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "block";
      const labelHeight = this.measureLabel(text, "height");
      const centeredTop = screenY - labelHeight * 0.5;
      const maxTop = Math.max(0, plotH - labelHeight);
      const labelTop = Math.min(Math.max(0, centeredTop), maxTop);
      const edge = labelTop === 0 || labelTop === maxTop;
      el.style.top = `${labelTop}px`;
      el.style.bottom = "auto";
      el.style.transform = "none";
      if (config.position === "outside") {
        el.style.left = isRight ? "4px" : "auto";
        el.style.right = isRight ? "auto" : "4px";
      } else {
        el.style.left = isRight ? "auto" : "4px";
        el.style.right = isRight ? "4px" : "auto";
      }
      labels.push({ el, start: labelTop, end: labelTop + labelHeight, edge });
    }

    hideOverlappingLabels(labels);
  }

  private measureLabel(text: string, dimension: "width" | "height"): number {
    const context = this.measureContext;
    if (!context) return 12;
    context.font = this.options.font ?? "11px ui-monospace, monospace, sans-serif";
    const metrics = context.measureText(text);
    return Math.max(1, dimension === "width"
      ? Math.ceil(metrics.width)
      : Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent));
  }
}
