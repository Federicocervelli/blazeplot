/** Placement for chart axis labels and ticks. */
export type AxisPosition = "inside" | "outside";

/** Normalized visibility and placement for one axis. */
export interface NormalizedAxisConfig {
  readonly visible: boolean;
  readonly position: AxisPosition;
  readonly title?: unknown;
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
    this.plot = styledDiv(doc, "blazeplot-plot", { ...gridCell(2, 1), position: "relative", overflow: "hidden" });
    this.canvas = canvasTarget ?? doc.createElement("canvas");
    this.canvas.classList.add("blazeplot-canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", zIndex: "1", display: "block", width: "100%", height: "100%", touchAction: "none" });
    this.yAxis = styledDiv(doc, "blazeplot-axis blazeplot-axis-y", axisCell(1, 1));
    this.y2Axis = styledDiv(doc, "blazeplot-axis blazeplot-axis-y2", axisCell(3, 1));
    this.xAxis = styledDiv(doc, "blazeplot-axis blazeplot-axis-x", axisCell(2, 2));
    this.corner = styledDiv(doc, "blazeplot-axis-corner", { ...gridCell(1, 2), pointerEvents: "none" });
    this.cornerRight = styledDiv(doc, "blazeplot-axis-corner blazeplot-axis-corner-right", { ...gridCell(3, 2), pointerEvents: "none" });
    this.title = styledDiv(doc, "blazeplot-title", titleOverlay({ top: "6px", left: "50%", transform: "translateX(-50%)", textAlign: "center" }));
    this.subtitle = styledDiv(doc, "blazeplot-subtitle", titleOverlay({ top: "26px", left: "50%", transform: "translateX(-50%)", textAlign: "center" }));
    this.xAxisTitle = styledDiv(doc, "blazeplot-axis-title blazeplot-axis-title-x", titleOverlay({ left: "50%", bottom: "4px", transform: "translateX(-50%)", textAlign: "center" }));
    this.yAxisTitle = styledDiv(doc, "blazeplot-axis-title blazeplot-axis-title-y", titleOverlay({
      left: "4px",
      top: "50%",
      transform: "translateY(-50%) rotate(-90deg)",
      transformOrigin: "left center",
    }));
    this.y2AxisTitle = styledDiv(doc, "blazeplot-axis-title blazeplot-axis-title-y2", titleOverlay({
      right: "4px",
      top: "50%",
      transform: "translateY(-50%) rotate(90deg)",
      transformOrigin: "right center",
    }));

    this.mount(target);
    this.update(config);
  }

  /** Update axis visibility and layout placement. */
  update(config: ChartLayoutConfig): void {
    const hasOutsideY = config.y.visible && config.y.position === "outside";
    const hasOutsideY2 = config.y2.visible && config.y2.position === "outside";
    const hasOutsideX = config.x.visible && config.x.position === "outside";
    const yGutter = config.y.title ? LEFT_AXIS_TITLE_GUTTER_CSS : LEFT_AXIS_GUTTER_CSS;
    const y2Gutter = config.y2.title ? RIGHT_AXIS_TITLE_GUTTER_CSS : RIGHT_AXIS_GUTTER_CSS;
    const xGutter = config.x.title ? BOTTOM_AXIS_TITLE_GUTTER_CSS : BOTTOM_AXIS_GUTTER_CSS;

    this.root.style.gridTemplateColumns = `${hasOutsideY ? yGutter : 0}px minmax(0, 1fr) ${hasOutsideY2 ? y2Gutter : 0}px`;
    this.root.style.gridTemplateRows = `minmax(0, 1fr) ${hasOutsideX ? xGutter : 0}px`;
    this.yAxis.style.display = hasOutsideY ? "block" : "none";
    this.y2Axis.style.display = hasOutsideY2 ? "block" : "none";
    this.xAxis.style.display = hasOutsideX ? "block" : "none";
    this.corner.style.display = hasOutsideX && hasOutsideY ? "block" : "none";
    this.cornerRight.style.display = hasOutsideX && hasOutsideY2 ? "block" : "none";
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
