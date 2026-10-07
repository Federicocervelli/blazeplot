import type { AxisController } from "../interaction/AxisController.js";
import type { ChartLayoutElements, ChartLayoutConfig } from "./ChartLayout.js";
import { DEFAULT_CHART_THEME } from "./theme.js";
import { measureText } from "./TextMeasure.js";

/** Maximum X-axis ticks per frame; tick spacing also respects a minimum pixel gap. */
export const X_TICK_LIMIT = 12;
/** Maximum Y-axis ticks per frame. */
export const Y_TICK_LIMIT = 8;

/** Visual options for SVG axis overlays. */
export interface AxisOverlayOptions {
  readonly font?: string;
  readonly color?: string;
}

/** Axis layout configuration consumed by `AxisOverlay`. */
export type AxisOverlayConfig = ChartLayoutConfig;

type RenderAxis = "x" | "y" | "y2";

const AXIS_LABEL_COLLISION_GAP_PX = 2;
const NO_TICKS: readonly number[] = [];

/**
 * One pooled tick label: its element plus what was last written to it. Every dynamic write is
 * compared against this record first, so a frame that changes nothing (a repaint, a hover, a
 * stream that does not move the ticks) touches no style or text and invalidates no layout.
 */
interface AxisLabel {
  readonly el: HTMLDivElement;
  text: string;
  /** The value and `AxisController.formatGeneration` `text` was formatted from; formatting is skipped while both match. */
  value: number;
  generation: number;
  /** Whether the element is currently displayed. */
  shown: boolean;
  /** Last written left (X axis) or top (Y axes) in CSS pixels; `NaN` until the first write. */
  pos: number;
  /** This frame's collision interval along the axis, and whether it is pinned to a plot edge. */
  start: number;
  end: number;
  edge: boolean;
  /** Whether this frame's tick is inside the plot and shown unless it collides. */
  wanted: boolean;
}

/** Edge labels win collisions, then the one closest to the axis origin. */
function byCollisionPriority(a: AxisLabel, b: AxisLabel): number {
  return Number(b.edge) - Number(a.edge) || a.start - b.start;
}

/**
 * @internal Smooths an auto-sized gutter: it grows at once and shrinks only after the smaller
 * size has held for `SHRINK_AFTER_FRAMES` frames, so live charts with changing label lengths do
 * not jitter the plot width.
 */
export class GutterTracker {
  private current: number | null = null;
  private shrinkFrames = 0;
  private shrinkTarget = 0;

  /** Feed the size needed this frame; returns the new gutter size when it should change, else `null`. */
  next(desired: number): number | null {
    if (this.current === null || desired > this.current) {
      this.shrinkFrames = 0;
      this.current = desired;
      return desired;
    }
    if (desired >= this.current - GUTTER_SHRINK_SLACK_PX) {
      this.shrinkFrames = 0;
      return null;
    }
    this.shrinkTarget = this.shrinkFrames === 0 ? desired : Math.max(this.shrinkTarget, desired);
    this.shrinkFrames++;
    if (this.shrinkFrames < GUTTER_SHRINK_AFTER_FRAMES) return null;
    this.shrinkFrames = 0;
    this.current = this.shrinkTarget;
    return this.current;
  }
}

/** Frames a smaller auto gutter must hold before the gutter shrinks. */
export const GUTTER_SHRINK_AFTER_FRAMES = 60;
const GUTTER_SHRINK_SLACK_PX = 6;
/** Pixels added around the widest label (4px inset on each side). */
export const AUTO_GUTTER_PADDING_PX = 10;

/**
 * @internal DOM overlay that renders axis tick labels.
 *
 * Per frame it does the minimum DOM work: label text is measured through a per-document memo
 * (`measureText`), the constant part of each label's style is written once when the label is
 * created, and the changing part (display, left/top) is written only when it differs from what the
 * label already holds. Overlap resolution runs on reusable scratch arrays so a steady frame
 * allocates nothing.
 */
export class AxisOverlay {
  private measured = { x: 0, y: 0, y2: 0 };
  private xPool: AxisLabel[] = [];
  private yPool: AxisLabel[] = [];
  private y2Pool: AxisLabel[] = [];
  /** Labels competing for space this frame, sorted in place by collision priority. */
  private readonly candidates: AxisLabel[] = [];
  /** Occupied [start, end] intervals as a flat list, in placement order. */
  private readonly placed: number[] = [];

  /** Create an axis overlay attached to a chart layout. */
  constructor(
    private readonly layout: ChartLayoutElements,
    private readonly config: AxisOverlayConfig,
    private options: AxisOverlayOptions = {},
  ) {}

  /** Update axis overlay styling. */
  setOptions(options: AxisOverlayOptions): void {
    this.options = options;
    for (const pool of [this.xPool, this.yPool, this.y2Pool]) {
      for (const label of pool) this.styleLabel(label.el);
    }
  }

  /**
   * Position labels for tick values the chart computed this frame. `plotWidth` and `plotHeight`
   * are the plot size the chart already read for this frame; they default to reading the layout.
   */
  update(
    axis: AxisController,
    rightAxis: AxisController,
    xTicks: readonly number[],
    yTicks: readonly number[],
    y2Ticks: readonly number[],
    plotWidth: number = this.layout.plot.clientWidth,
    plotHeight: number = this.layout.plot.clientHeight,
  ): void {
    const plotW = Math.max(1, plotWidth);
    const plotH = Math.max(1, plotHeight);
    this.measured.x = 0;
    this.measured.y = 0;
    this.measured.y2 = 0;
    this.updateAxis(this.xPool, this.config.x.visible ? xTicks : NO_TICKS, "x", plotW, plotH, axis);
    this.updateAxis(this.yPool, this.config.y.visible ? yTicks : NO_TICKS, "y", plotW, plotH, axis);
    this.updateAxis(this.y2Pool, this.config.y2.visible ? y2Ticks : NO_TICKS, "y2", plotW, plotH, rightAxis);
  }

  /** Widest (Y, Y2) or tallest (X) tick label of the last update, in CSS pixels. */
  measuredExtent(axis: RenderAxis): number {
    return this.measured[axis];
  }

  /**
   * Release the overlay. By default its label nodes are removed from the DOM; a chart that is
   * tearing down its whole layout passes `false`, since removing the root takes every label with
   * it in one operation instead of one detach (and one style invalidation) per label.
   */
  dispose(removeLabels: boolean = true): void {
    if (removeLabels) {
      for (const pool of [this.xPool, this.yPool, this.y2Pool]) {
        for (const label of pool) label.el.remove();
      }
    }
    this.xPool = [];
    this.yPool = [];
    this.y2Pool = [];
  }

  private get font(): string {
    return this.options.font ?? DEFAULT_CHART_THEME.axisFont;
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

  /** The theme-dependent part of a label's style (the rest never changes after creation). */
  private styleLabel(el: HTMLElement): void {
    el.style.font = this.font;
    el.style.color = this.options.color ?? DEFAULT_CHART_THEME.axisColor;
  }

  /**
   * Create a label with its constant style set once. Its placement across the axis follows from the
   * axis config (an X label sits 4px from the top or bottom of its gutter, a Y label 4px from the
   * left or right), so only the position along the axis and its visibility change per frame.
   */
  private createLabel(axis: RenderAxis, parent: HTMLElement): AxisLabel {
    const el = this.layout.doc.createElement("div");
    const outside = this.config[axis].position === "outside";
    // Outside Y labels hug the plot-facing edge of their gutter, inside ones the plot edge itself.
    const side = axis === "x" ? (outside ? "top" : "bottom") : (outside === (axis === "y2") ? "left" : "right");
    // One cssText write (a single style parse) carries the constant style and the theme font and color.
    el.style.cssText = `position:absolute;pointer-events:none;white-space:nowrap;user-select:none;${side}:4px;font:${this.font};color:${this.options.color ?? DEFAULT_CHART_THEME.axisColor}`;
    parent.appendChild(el);
    return { el, text: "", value: NaN, generation: -1, shown: true, pos: NaN, start: 0, end: 0, edge: false, wanted: false };
  }

  private updateAxis(
    pool: AxisLabel[],
    values: readonly number[],
    axis: RenderAxis,
    plotW: number,
    plotH: number,
    controller: AxisController,
  ): void {
    const parent = this.parentForAxis(axis);
    const horizontal = axis === "x";
    const doc = this.layout.doc;
    const font = this.font;
    const candidates = this.candidates;
    candidates.length = 0;
    const generation = controller.formatGeneration;

    while (pool.length < values.length) pool.push(this.createLabel(axis, parent));

    for (let i = 0; i < pool.length; i++) {
      const label = pool[i]!;
      label.wanted = false;
      if (i >= values.length) continue;

      const value = values[i]!;
      if (label.value !== value || label.generation !== generation) {
        label.value = value;
        label.generation = generation;
        const next = controller.formatValue(value, horizontal ? "x" : "y");
        if (label.text !== next) {
          label.text = next;
          label.el.textContent = next;
        }
      }
      const text = label.text;
      // X ticks map clip -1..1 left to right, Y ticks bottom to top, so Y is flipped to screen space.
      const clip = controller.valueToClip(value, horizontal ? "x" : "y");
      const screen = horizontal ? (clip + 1) * 0.5 * plotW : (1 - clip) * 0.5 * plotH;
      if (screen < 0 || screen > (horizontal ? plotW : plotH)) continue;

      const extent = measureText(doc, font, text);
      // Length along the axis decides collisions and clamping; the other dimension feeds auto gutters.
      const length = horizontal ? extent.width : extent.height;
      const across = horizontal ? extent.height : extent.width;
      if (across > this.measured[axis]) this.measured[axis] = across;
      const room = Math.max(0, (horizontal ? plotW : plotH) - length);
      const start = Math.min(Math.max(0, screen - length * 0.5), room);
      label.start = start;
      label.end = start + length;
      label.edge = start === 0 || start === room;
      label.wanted = true;
      candidates.push(label);
    }

    this.resolveCollisions(candidates);

    for (const label of pool) {
      const show = label.wanted;
      if (label.shown !== show) {
        label.shown = show;
        label.el.style.display = show ? "block" : "none";
      }
      if (show && label.pos !== label.start) {
        label.pos = label.start;
        if (horizontal) label.el.style.left = `${label.start}px`;
        else label.el.style.top = `${label.start}px`;
      }
    }
  }

  /** Clear `wanted` on every label that overlaps one with higher priority. */
  private resolveCollisions(labels: AxisLabel[]): void {
    labels.sort(byCollisionPriority);
    const placed = this.placed;
    placed.length = 0;
    for (const label of labels) {
      let overlaps = false;
      for (let i = 0; i < placed.length; i += 2) {
        if (label.start < placed[i + 1]! + AXIS_LABEL_COLLISION_GAP_PX && label.end > placed[i]! - AXIS_LABEL_COLLISION_GAP_PX) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) label.wanted = false;
      else placed.push(label.start, label.end);
    }
  }
}
