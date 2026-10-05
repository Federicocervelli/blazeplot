import type { ResolvedChartTheme } from "./theme.js";
import type { AxisPosition, ChartTitleConfig, TextOverlayConfig } from "./ChartOptions.js";

const TITLE_TOP_PX = 6;
/** Height of the subtitle line, reserved below the title. */
const SUBTITLE_ROW_PX = 20;
const SUBTITLE_TOP_PX = 26;
const TITLE_SIDE_INSET_PX = 8;
const AXIS_TITLE_INSET_PX = 4;

/** Plain text of a title given as a string or overlay config. */
export function titleText(config: string | TextOverlayConfig | undefined): string {
  return typeof config === "string" ? config : config?.text ?? "";
}

/** Placement for chart axis labels and ticks. */

/** Normalized visibility and placement for one axis. */
export interface NormalizedAxisConfig {
  readonly visible: boolean;
  readonly position: AxisPosition;
  readonly title?: unknown;
  /**
   * Gutter size for an outside axis, in CSS pixels, not counting the title allowance.
   * `"auto"` sizes it from the widest (Y, Y2) or tallest (X) measured tick label.
   * Defaults to 52 (Y, Y2) and 28 (X).
   */
  readonly size?: number | "auto";
}

/** Layout configuration for chart axes. */
export interface ChartLayoutConfig {
  readonly x: NormalizedAxisConfig;
  readonly y: NormalizedAxisConfig;
  readonly y2: NormalizedAxisConfig;
}

/** DOM elements created or managed by `ChartLayout`. */
export interface ChartLayoutElements {
  /** Document that owns the chart (an iframe or popup document when embedded there). */
  readonly doc: Document;
  /** Window that owns the chart; falls back to the global when the document has no view. */
  readonly view: Window & typeof globalThis;
  readonly root: HTMLDivElement;
  readonly plot: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly xAxis: HTMLDivElement;
  readonly yAxis: HTMLDivElement;
  readonly y2Axis: HTMLDivElement;
}

/** Default left-axis gutter width in CSS pixels. */
export const LEFT_AXIS_GUTTER_CSS = 52;
/** Default right-axis gutter width in CSS pixels. */
export const RIGHT_AXIS_GUTTER_CSS = 52;
/** Default bottom-axis gutter height in CSS pixels. */
export const BOTTOM_AXIS_GUTTER_CSS = 28;
/** Default left-axis title gutter width in CSS pixels. */
export const LEFT_AXIS_TITLE_GUTTER_CSS = 76;
/** Default right-axis title gutter width in CSS pixels. */
export const RIGHT_AXIS_TITLE_GUTTER_CSS = 76;
/** Default bottom-axis title gutter height in CSS pixels. */
export const BOTTOM_AXIS_TITLE_GUTTER_CSS = 48;

/**
 * Elements are styled with one `cssText` write each: a single parse and a single style
 * invalidation instead of one per property, which is where chart construction spends its time in
 * layout code.
 */
function styledDiv(doc: Document, className: string, cssText: string): HTMLDivElement {
  const element = doc.createElement("div");
  element.className = className;
  element.style.cssText = cssText;
  return element;
}

/** A grid cell that may shrink below its content size. */
function gridCell(column: number, row: number): string {
  return `grid-column:${column};grid-row:${row};min-width:0;min-height:0;`;
}

/** An axis gutter: a clipped grid cell that lets pointer input through. */
function axisCell(column: number, row: number): string {
  return `${gridCell(column, row)}position:relative;overflow:hidden;pointer-events:none;`;
}

/** A title overlay: hidden until it has text, never selectable or hit by the pointer. */
function titleOverlay(placement: string): string {
  return `position:absolute;pointer-events:none;user-select:none;white-space:nowrap;z-index:18;display:none;${placement}`;
}

type TitleSlot = "title" | "subtitle" | "xAxisTitle" | "yAxisTitle" | "y2AxisTitle";

/** Class name and initial placement of each title element. */
const TITLE_SLOTS: Record<TitleSlot, { readonly className: string; readonly css: string }> = {
  title: { className: "blazeplot-title", css: titleOverlay("top:6px;left:50%;transform:translateX(-50%);text-align:center;") },
  subtitle: { className: "blazeplot-subtitle", css: titleOverlay("top:26px;left:50%;transform:translateX(-50%);text-align:center;") },
  xAxisTitle: { className: "blazeplot-axis-title blazeplot-axis-title-x", css: titleOverlay("left:50%;bottom:4px;transform:translateX(-50%);text-align:center;") },
  yAxisTitle: { className: "blazeplot-axis-title blazeplot-axis-title-y", css: titleOverlay("left:4px;top:50%;transform:rotate(-90deg) translateX(-50%);transform-origin:0 0;") },
  y2AxisTitle: { className: "blazeplot-axis-title blazeplot-axis-title-y2", css: titleOverlay("right:4px;top:50%;transform:rotate(90deg) translateX(50%);transform-origin:100% 0;") },
};

/** DOM layout manager for chart chrome, axes, titles, and canvas. */
export class ChartLayout implements ChartLayoutElements {
  /** Document that owns the chart (an iframe or popup document when embedded there). */
  readonly doc: Document;
  /** Window that owns the chart; falls back to the global when the document has no view. */
  readonly view: Window & typeof globalThis;
  readonly root: HTMLDivElement;
  readonly plot: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly xAxis: HTMLDivElement;
  readonly yAxis: HTMLDivElement;
  readonly y2Axis: HTMLDivElement;

  /**
   * Title elements, created the first time they have text. Most charts have no title, subtitle or
   * axis titles, so they carry none of these five elements (and their style and layout cost).
   */
  private readonly titles: Partial<Record<TitleSlot, HTMLDivElement>> = {};
  /** Last values `update` wrote, so repeating an update (a gutter that did not change) writes nothing. */
  private readonly written = { columns: "", rows: "", y: "", y2: "", x: "" };
  private lastConfig: ChartLayoutConfig | null = null;
  private titleInset = 0;
  /** Bottom grid row height (px), used to center Y titles on the plot area. */
  private bottomRow = 0;
  private readonly yTitleOffsetY = { y: 0, y2: 0 };
  private readonly autoSizes: Record<"x" | "y" | "y2", number | null> = { x: null, y: null, y2: null };
  private readonly externalCanvas: boolean;
  private readonly originalCanvasCssText: string;
  private readonly originalCanvasParent: HTMLElement | null;

  /**
   * Create chart layout DOM around a target element or canvas. `createCanvas` supplies the plot canvas
   * when `target` is not one (the engine layer can hand out a warm one); the default is a new canvas.
   */
  constructor(target: HTMLElement, config: ChartLayoutConfig, createCanvas?: (doc: Document) => HTMLCanvasElement) {
    const doc = target.ownerDocument;
    this.doc = doc;
    this.view = doc.defaultView ?? (globalThis as Window & typeof globalThis);
    const canvasTarget = target.tagName === "CANVAS" ? (target as HTMLCanvasElement) : null;
    this.externalCanvas = canvasTarget !== null;
    this.originalCanvasCssText = canvasTarget?.style.cssText ?? "";
    this.originalCanvasParent = canvasTarget?.parentElement ?? null;

    this.root = styledDiv(doc, "blazeplot-root", "position:relative;display:grid;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;box-sizing:border-box;outline-offset:-2px;");
    this.plot = styledDiv(doc, "blazeplot-plot", `${gridCell(2, 2)}position:relative;overflow:hidden;`);
    this.canvas = canvasTarget ?? createCanvas?.(doc) ?? doc.createElement("canvas");
    this.canvas.classList.add("blazeplot-canvas");
    this.canvas.style.cssText += ";position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;";
    this.yAxis = styledDiv(doc, "blazeplot-axis blazeplot-axis-y", axisCell(1, 2));
    this.y2Axis = styledDiv(doc, "blazeplot-axis blazeplot-axis-y2", axisCell(3, 2));
    this.xAxis = styledDiv(doc, "blazeplot-axis blazeplot-axis-x", axisCell(2, 3));

    this.mount(target);
    this.update(config);
  }

  /** Set title, subtitle, and axis-title text, theme styling, and placement; reserves the title row. */
  applyTitles(input: { readonly title: string | ChartTitleConfig | undefined; readonly subtitle: string | ChartTitleConfig | undefined; readonly axes: ChartLayoutConfig; readonly theme: ResolvedChartTheme }): void {
    const { theme } = input;
    const hasTitle = titleText(input.title) !== "";
    const hasSubtitle = titleText(input.subtitle) !== "";
    this.applyChartTitle("title", input.title, theme.titleColor, theme.titleFont, TITLE_TOP_PX);
    this.applyChartTitle("subtitle", input.subtitle, theme.subtitleColor, theme.subtitleFont, hasTitle ? SUBTITLE_TOP_PX : TITLE_TOP_PX);
    // Title and subtitle get their own grid row, so they never sit on top of the plot.
    this.setTitleInset((hasTitle ? SUBTITLE_TOP_PX : 0) + (hasSubtitle ? SUBTITLE_ROW_PX : 0));
    this.applyAxisTitle("xAxisTitle", input.axes.x.title as string | TextOverlayConfig | undefined, "x", theme);
    this.applyAxisTitle("yAxisTitle", input.axes.y.title as string | TextOverlayConfig | undefined, "y", theme);
    this.applyAxisTitle("y2AxisTitle", input.axes.y2.title as string | TextOverlayConfig | undefined, "y2", theme);
  }

  /** The element for a title slot, created and attached on first use. */
  private titleElement(slot: TitleSlot): HTMLDivElement {
    let element = this.titles[slot];
    if (!element) {
      const { className, css } = TITLE_SLOTS[slot];
      element = styledDiv(this.doc, className, css);
      this.titles[slot] = element;
      this.root.appendChild(element);
    }
    return element;
  }

  /**
   * Set text and theme styling on a title element; returns the custom config when visible. An
   * empty title never creates its element, and hides (and empties) one that exists.
   */
  private applyTitleText(slot: TitleSlot, config: string | TextOverlayConfig | undefined, color: string, font: string): { readonly el: HTMLElement; readonly custom: TextOverlayConfig } | null {
    const text = titleText(config);
    if (!text) {
      const existing = this.titles[slot];
      if (existing) {
        existing.textContent = "";
        existing.style.display = "none";
      }
      return null;
    }
    const el = this.titleElement(slot);
    el.textContent = text;
    el.style.display = "block";
    const custom = typeof config === "string" ? { text } : config!;
    el.style.color = custom.color ?? color;
    el.style.font = custom.font ?? font;
    return { el, custom };
  }

  private applyChartTitle(slot: "title" | "subtitle", config: string | ChartTitleConfig | undefined, color: string, font: string, top: number): void {
    const applied = this.applyTitleText(slot, config, color, font);
    if (!applied) return;
    const custom = applied.custom as ChartTitleConfig;

    const align = custom.align ?? "center";
    const offsetX = custom.offsetX ?? 0;
    const style = applied.el.style;
    style.top = `${top + (custom.offsetY ?? 0)}px`;
    style.left = align === "left" ? `${TITLE_SIDE_INSET_PX + offsetX}px` : align === "right" ? "auto" : `calc(50% + ${offsetX}px)`;
    style.right = align === "right" ? `${TITLE_SIDE_INSET_PX - offsetX}px` : "auto";
    style.transform = align === "center" ? "translateX(-50%)" : "none";
    style.textAlign = align;
  }

  private applyAxisTitle(slot: "xAxisTitle" | "yAxisTitle" | "y2AxisTitle", config: string | TextOverlayConfig | undefined, axis: "x" | "y" | "y2", theme: ResolvedChartTheme): void {
    const applied = this.applyTitleText(slot, config, theme.axisTitleColor, theme.axisTitleFont);
    if (!applied) return;

    const offsetX = applied.custom.offsetX ?? 0;
    const offsetY = applied.custom.offsetY ?? 0;
    const style = applied.el.style;
    if (axis === "x") {
      style.left = `calc(50% + ${offsetX}px)`;
      style.bottom = `${AXIS_TITLE_INSET_PX - offsetY}px`;
      style.transform = "translateX(-50%)";
    } else if (axis === "y") {
      style.left = `${AXIS_TITLE_INSET_PX + offsetX}px`;
      this.yTitleOffsetY.y = offsetY;
      style.transform = "rotate(-90deg) translateX(-50%)";
    } else {
      style.right = `${AXIS_TITLE_INSET_PX - offsetX}px`;
      this.yTitleOffsetY.y2 = offsetY;
      style.transform = "rotate(90deg) translateX(50%)";
    }
    this.positionYTitles();
  }

  /** Center the Y/Y2 titles on the plot row (below the title row, above the X gutter), not on the whole chart. */
  private positionYTitles(): void {
    const center = (offset: number): string => `calc(${this.titleInset}px + (100% - ${this.titleInset + this.bottomRow}px) / 2 + ${offset}px)`;
    const { yAxisTitle, y2AxisTitle } = this.titles;
    if (yAxisTitle) yAxisTitle.style.top = center(this.yTitleOffsetY.y);
    if (y2AxisTitle) y2AxisTitle.style.top = center(this.yTitleOffsetY.y2);
  }

  /** Reserve a top row for the chart title and subtitle so they never cover the plot. */
  setTitleInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (next === this.titleInset) return;
    this.titleInset = next;
    if (this.lastConfig) this.update(this.lastConfig);
  }

  /** Set the measured gutter for an `size: "auto"` axis, or `null` to fall back to the default. Returns whether it changed. */
  setAutoSize(axis: "x" | "y" | "y2", px: number | null): boolean {
    const next = px === null ? null : Math.max(0, Math.ceil(px));
    if (this.autoSizes[axis] === next) return false;
    this.autoSizes[axis] = next;
    if (this.lastConfig) this.update(this.lastConfig);
    return true;
  }

  /** Update axis visibility and layout placement. Only values that differ from the last update are written. */
  update(config: ChartLayoutConfig): void {
    this.lastConfig = config;
    const hasOutsideY = config.y.visible && config.y.position === "outside";
    const hasOutsideY2 = config.y2.visible && config.y2.position === "outside";
    const hasOutsideX = config.x.visible && config.x.position === "outside";
    const yGutter = this.gutter("y", config.y, LEFT_AXIS_GUTTER_CSS, LEFT_AXIS_TITLE_GUTTER_CSS);
    const y2Gutter = this.gutter("y2", config.y2, RIGHT_AXIS_GUTTER_CSS, RIGHT_AXIS_TITLE_GUTTER_CSS);
    const xGutter = this.gutter("x", config.x, BOTTOM_AXIS_GUTTER_CSS, BOTTOM_AXIS_TITLE_GUTTER_CSS);
    const written = this.written;

    const columns = `${hasOutsideY ? yGutter : 0}px minmax(0, 1fr) ${hasOutsideY2 ? y2Gutter : 0}px`;
    if (columns !== written.columns) this.root.style.gridTemplateColumns = written.columns = columns;
    const rows = `${this.titleInset}px minmax(0, 1fr) ${hasOutsideX ? xGutter : 0}px`;
    if (rows !== written.rows) this.root.style.gridTemplateRows = written.rows = rows;
    this.bottomRow = hasOutsideX ? xGutter : 0;
    this.positionYTitles();
    const display = (shown: boolean): string => (shown ? "block" : "none");
    if (display(hasOutsideY) !== written.y) this.yAxis.style.display = written.y = display(hasOutsideY);
    if (display(hasOutsideY2) !== written.y2) this.y2Axis.style.display = written.y2 = display(hasOutsideY2);
    if (display(hasOutsideX) !== written.x) this.xAxis.style.display = written.x = display(hasOutsideX);
  }

  /** Gutter in CSS pixels: the tick-label size plus the title allowance when the axis has a title. */
  private gutter(axis: "x" | "y" | "y2", config: NormalizedAxisConfig, base: number, withTitle: number): number {
    const size = typeof config.size === "number" && Number.isFinite(config.size)
      ? Math.max(0, config.size)
      : config.size === "auto" ? (this.autoSizes[axis] ?? base) : base;
    return size + (config.title ? withTitle - base : 0);
  }

  /** Restore external canvas state and remove layout DOM. */
  dispose(): void {
    if (this.externalCanvas && this.originalCanvasParent) {
      this.canvas.style.cssText = this.originalCanvasCssText;
      this.originalCanvasParent.insertBefore(this.canvas, this.root);
    }
    this.root.remove();
  }

  private mount(target: HTMLElement): void {
    if (this.externalCanvas) {
      this.originalCanvasParent?.insertBefore(this.root, target);
    } else {
      target.appendChild(this.root);
    }

    this.root.append(this.yAxis, this.plot, this.y2Axis, this.xAxis);
    this.plot.appendChild(this.canvas);
  }
}
