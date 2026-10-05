import type { ResolvedChartTheme } from "./theme.js";
import type { ChartTitleConfig, TextOverlayConfig } from "./ChartTypes.js";

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
export type AxisPosition = "inside" | "outside";

/** Normalized visibility and placement for one axis. */
export interface NormalizedAxisConfig {
  readonly visible: boolean;
  readonly position: AxisPosition;
  readonly title?: unknown;
  /**
   * Gutter size for an outside axis, in CSS pixels, not counting the title allowance.
   * `"auto"` sizes it from the widest (Y) or tallest (X) measured tick label.
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
  readonly corner: HTMLDivElement;
  readonly cornerRight: HTMLDivElement;
  readonly title: HTMLDivElement;
  readonly subtitle: HTMLDivElement;
  readonly xAxisTitle: HTMLDivElement;
  readonly yAxisTitle: HTMLDivElement;
  readonly y2AxisTitle: HTMLDivElement;
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

type InlineStyle = Partial<CSSStyleDeclaration>;

function styledDiv(doc: Document, className: string, style: InlineStyle): HTMLDivElement {
  const element = doc.createElement("div");
  element.className = className;
  Object.assign(element.style, style);
  return element;
}

/** A grid cell that may shrink below its content size. */
function gridCell(column: number, row: number): InlineStyle {
  return { gridColumn: String(column), gridRow: String(row), minWidth: "0", minHeight: "0" };
}

/** An axis gutter: a clipped grid cell that lets pointer input through. */
function axisCell(column: number, row: number): InlineStyle {
  return { ...gridCell(column, row), position: "relative", overflow: "hidden", pointerEvents: "none" };
}

/** A title overlay: hidden until it has text, never selectable or hit by the pointer. */
function titleOverlay(placement: InlineStyle): InlineStyle {
  return { position: "absolute", pointerEvents: "none", userSelect: "none", whiteSpace: "nowrap", zIndex: "18", display: "none", ...placement };
}

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
  readonly corner: HTMLDivElement;
  readonly cornerRight: HTMLDivElement;
  readonly title: HTMLDivElement;
  readonly subtitle: HTMLDivElement;
  readonly xAxisTitle: HTMLDivElement;
  readonly yAxisTitle: HTMLDivElement;
  readonly y2AxisTitle: HTMLDivElement;

  private lastConfig: ChartLayoutConfig | null = null;
  private titleInset = 0;
  /** Bottom grid row height (px), used to center Y titles on the plot area. */
  private bottomRow = 0;
  private readonly yTitleOffsetY = { y: 0, y2: 0 };
  private readonly autoSizes: Record<"x" | "y" | "y2", number | null> = { x: null, y: null, y2: null };
  private readonly externalCanvas: boolean;
  private readonly originalCanvasCssText: string;
  private readonly originalCanvasParent: HTMLElement | null;

  /** Create chart layout DOM around a target element or canvas. */
  constructor(target: HTMLElement, config: ChartLayoutConfig) {
    const doc = target.ownerDocument;
    this.doc = doc;
    this.view = doc.defaultView ?? (globalThis as Window & typeof globalThis);
    const canvasTarget = target.tagName === "CANVAS" ? (target as HTMLCanvasElement) : null;
    this.externalCanvas = canvasTarget !== null;
    this.originalCanvasCssText = canvasTarget?.style.cssText ?? "";
    this.originalCanvasParent = canvasTarget?.parentElement ?? null;

    this.root = styledDiv(doc, "blazeplot-root", {
      position: "relative",
      display: "grid",
      width: "100%",
      height: "100%",
      minWidth: "0",
      minHeight: "0",
      overflow: "hidden",
      boxSizing: "border-box",
      outlineOffset: "-2px",
    });
    this.plot = styledDiv(doc, "blazeplot-plot", { ...gridCell(2, 2), position: "relative", overflow: "hidden" });
    this.canvas = canvasTarget ?? doc.createElement("canvas");
    this.canvas.classList.add("blazeplot-canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", zIndex: "1", display: "block", width: "100%", height: "100%" });
    this.yAxis = styledDiv(doc, "blazeplot-axis blazeplot-axis-y", axisCell(1, 2));
    this.y2Axis = styledDiv(doc, "blazeplot-axis blazeplot-axis-y2", axisCell(3, 2));
    this.xAxis = styledDiv(doc, "blazeplot-axis blazeplot-axis-x", axisCell(2, 3));
    this.corner = styledDiv(doc, "blazeplot-axis-corner", { ...gridCell(1, 3), pointerEvents: "none" });
    this.cornerRight = styledDiv(doc, "blazeplot-axis-corner blazeplot-axis-corner-right", { ...gridCell(3, 3), pointerEvents: "none" });
    this.title = styledDiv(doc, "blazeplot-title", titleOverlay({ top: "6px", left: "50%", transform: "translateX(-50%)", textAlign: "center" }));
    this.subtitle = styledDiv(doc, "blazeplot-subtitle", titleOverlay({ top: "26px", left: "50%", transform: "translateX(-50%)", textAlign: "center" }));
    this.xAxisTitle = styledDiv(doc, "blazeplot-axis-title blazeplot-axis-title-x", titleOverlay({ left: "50%", bottom: "4px", transform: "translateX(-50%)", textAlign: "center" }));
    this.yAxisTitle = styledDiv(doc, "blazeplot-axis-title blazeplot-axis-title-y", titleOverlay({
      left: "4px",
      top: "50%",
      transform: "rotate(-90deg) translateX(-50%)",
      transformOrigin: "0 0",
    }));
    this.y2AxisTitle = styledDiv(doc, "blazeplot-axis-title blazeplot-axis-title-y2", titleOverlay({
      right: "4px",
      top: "50%",
      transform: "rotate(90deg) translateX(50%)",
      transformOrigin: "100% 0",
    }));

    this.mount(target);
    this.update(config);
  }

  /** Set title, subtitle, and axis-title text, theme styling, and placement; reserves the title row. */
  applyTitles(input: { readonly title: string | ChartTitleConfig | undefined; readonly subtitle: string | ChartTitleConfig | undefined; readonly axes: ChartLayoutConfig; readonly theme: ResolvedChartTheme }): void {
    const { theme } = input;
    const hasTitle = titleText(input.title) !== "";
    const hasSubtitle = titleText(input.subtitle) !== "";
    this.applyChartTitle(this.title, input.title, theme.titleColor, theme.titleFont, TITLE_TOP_PX);
    this.applyChartTitle(this.subtitle, input.subtitle, theme.subtitleColor, theme.subtitleFont, hasTitle ? SUBTITLE_TOP_PX : TITLE_TOP_PX);
    // Title and subtitle get their own grid row, so they never sit on top of the plot.
    this.setTitleInset((hasTitle ? SUBTITLE_TOP_PX : 0) + (hasSubtitle ? SUBTITLE_ROW_PX : 0));
    this.applyAxisTitle(this.xAxisTitle, input.axes.x.title as string | TextOverlayConfig | undefined, "x", theme);
    this.applyAxisTitle(this.yAxisTitle, input.axes.y.title as string | TextOverlayConfig | undefined, "y", theme);
    this.applyAxisTitle(this.y2AxisTitle, input.axes.y2.title as string | TextOverlayConfig | undefined, "y2", theme);
  }

  /** Set text and theme styling on a title element; returns the custom config when visible. */
  private applyTitleText(el: HTMLElement, config: string | TextOverlayConfig | undefined, color: string, font: string): TextOverlayConfig | null {
    const text = titleText(config);
    el.textContent = text;
    el.style.display = text ? "block" : "none";
    if (!text) return null;
    const custom = typeof config === "string" ? { text } : config!;
    el.style.color = custom.color ?? color;
    el.style.font = custom.font ?? font;
    return custom;
  }

  private applyChartTitle(el: HTMLElement, config: string | ChartTitleConfig | undefined, color: string, font: string, top: number): void {
    const custom = this.applyTitleText(el, config, color, font) as ChartTitleConfig | null;
    if (!custom) return;

    const align = custom.align ?? "center";
    const offsetX = custom.offsetX ?? 0;
    const style = el.style;
    style.top = `${top + (custom.offsetY ?? 0)}px`;
    style.left = align === "left" ? `${TITLE_SIDE_INSET_PX + offsetX}px` : align === "right" ? "auto" : `calc(50% + ${offsetX}px)`;
    style.right = align === "right" ? `${TITLE_SIDE_INSET_PX - offsetX}px` : "auto";
    style.transform = align === "center" ? "translateX(-50%)" : "none";
    style.textAlign = align;
  }

  private applyAxisTitle(el: HTMLElement, config: string | TextOverlayConfig | undefined, axis: "x" | "y" | "y2", theme: ResolvedChartTheme): void {
    const custom = this.applyTitleText(el, config, theme.axisTitleColor, theme.axisTitleFont);
    if (!custom) return;

    const offsetX = custom.offsetX ?? 0;
    const offsetY = custom.offsetY ?? 0;
    const style = el.style;
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
    this.yAxisTitle.style.top = center(this.yTitleOffsetY.y);
    this.y2AxisTitle.style.top = center(this.yTitleOffsetY.y2);
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

  /** Update axis visibility and layout placement. */
  update(config: ChartLayoutConfig): void {
    this.lastConfig = config;
    const hasOutsideY = config.y.visible && config.y.position === "outside";
    const hasOutsideY2 = config.y2.visible && config.y2.position === "outside";
    const hasOutsideX = config.x.visible && config.x.position === "outside";
    const yGutter = this.gutter("y", config.y, LEFT_AXIS_GUTTER_CSS, LEFT_AXIS_TITLE_GUTTER_CSS);
    const y2Gutter = this.gutter("y2", config.y2, RIGHT_AXIS_GUTTER_CSS, RIGHT_AXIS_TITLE_GUTTER_CSS);
    const xGutter = this.gutter("x", config.x, BOTTOM_AXIS_GUTTER_CSS, BOTTOM_AXIS_TITLE_GUTTER_CSS);

    this.root.style.gridTemplateColumns = `${hasOutsideY ? yGutter : 0}px minmax(0, 1fr) ${hasOutsideY2 ? y2Gutter : 0}px`;
    this.root.style.gridTemplateRows = `${this.titleInset}px minmax(0, 1fr) ${hasOutsideX ? xGutter : 0}px`;
    this.bottomRow = hasOutsideX ? xGutter : 0;
    this.positionYTitles();
    this.yAxis.style.display = hasOutsideY ? "block" : "none";
    this.y2Axis.style.display = hasOutsideY2 ? "block" : "none";
    this.xAxis.style.display = hasOutsideX ? "block" : "none";
    this.corner.style.display = hasOutsideX && hasOutsideY ? "block" : "none";
    this.cornerRight.style.display = hasOutsideX && hasOutsideY2 ? "block" : "none";
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

    this.root.append(
      this.yAxis,
      this.plot,
      this.y2Axis,
      this.corner,
      this.xAxis,
      this.cornerRight,
      this.title,
      this.subtitle,
      this.xAxisTitle,
      this.yAxisTitle,
      this.y2AxisTitle,
    );
    this.plot.appendChild(this.canvas);
  }
}
