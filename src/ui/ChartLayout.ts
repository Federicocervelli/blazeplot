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

/** DOM layout manager for chart chrome, axes, titles, and canvas. */
export class ChartLayout implements ChartLayoutElements {
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
    const canvasTarget = target instanceof HTMLCanvasElement ? target : null;
    this.externalCanvas = canvasTarget !== null;
    this.originalCanvasCssText = canvasTarget?.style.cssText ?? "";
    this.originalCanvasParent = canvasTarget?.parentElement ?? null;

    this.root = document.createElement("div");
    this.plot = document.createElement("div");
    this.canvas = canvasTarget ?? document.createElement("canvas");
    this.xAxis = document.createElement("div");
    this.yAxis = document.createElement("div");
    this.y2Axis = document.createElement("div");
    this.corner = document.createElement("div");
    this.cornerRight = document.createElement("div");
    this.title = document.createElement("div");
    this.subtitle = document.createElement("div");
    this.xAxisTitle = document.createElement("div");
    this.yAxisTitle = document.createElement("div");
    this.y2AxisTitle = document.createElement("div");

    this.root.className = "blazeplot-root";
    this.plot.className = "blazeplot-plot";
    this.canvas.classList.add("blazeplot-canvas");
    this.xAxis.className = "blazeplot-axis blazeplot-axis-x";
    this.yAxis.className = "blazeplot-axis blazeplot-axis-y";
    this.y2Axis.className = "blazeplot-axis blazeplot-axis-y2";
    this.corner.className = "blazeplot-axis-corner";
    this.cornerRight.className = "blazeplot-axis-corner blazeplot-axis-corner-right";
    this.title.className = "blazeplot-title";
    this.subtitle.className = "blazeplot-subtitle";
    this.xAxisTitle.className = "blazeplot-axis-title blazeplot-axis-title-x";
    this.yAxisTitle.className = "blazeplot-axis-title blazeplot-axis-title-y";
    this.y2AxisTitle.className = "blazeplot-axis-title blazeplot-axis-title-y2";

    this.applyBaseStyles();
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

    this.root.appendChild(this.yAxis);
    this.root.appendChild(this.plot);
    this.root.appendChild(this.y2Axis);
    this.root.appendChild(this.corner);
    this.root.appendChild(this.xAxis);
    this.root.appendChild(this.cornerRight);
    this.root.appendChild(this.title);
    this.root.appendChild(this.subtitle);
    this.root.appendChild(this.xAxisTitle);
    this.root.appendChild(this.yAxisTitle);
    this.root.appendChild(this.y2AxisTitle);
    this.plot.appendChild(this.canvas);
  }

  private applyBaseStyles(): void {
    this.root.style.position = "relative";
    this.root.style.display = "grid";
    this.root.style.width = "100%";
    this.root.style.height = "100%";
    this.root.style.minWidth = "0";
    this.root.style.minHeight = "0";
    this.root.style.overflow = "hidden";
    this.root.style.boxSizing = "border-box";
    this.root.style.outlineOffset = "-2px";

    this.plot.style.position = "relative";
    this.plot.style.gridColumn = "2";
    this.plot.style.gridRow = "1";
    this.plot.style.minWidth = "0";
    this.plot.style.minHeight = "0";
    this.plot.style.overflow = "hidden";

    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.touchAction = "none";

    this.yAxis.style.position = "relative";
    this.yAxis.style.gridColumn = "1";
    this.yAxis.style.gridRow = "1";
    this.yAxis.style.minWidth = "0";
    this.yAxis.style.minHeight = "0";
    this.yAxis.style.overflow = "hidden";
    this.yAxis.style.pointerEvents = "none";

    this.y2Axis.style.position = "relative";
    this.y2Axis.style.gridColumn = "3";
    this.y2Axis.style.gridRow = "1";
    this.y2Axis.style.minWidth = "0";
    this.y2Axis.style.minHeight = "0";
    this.y2Axis.style.overflow = "hidden";
    this.y2Axis.style.pointerEvents = "none";

    this.xAxis.style.position = "relative";
    this.xAxis.style.gridColumn = "2";
    this.xAxis.style.gridRow = "2";
    this.xAxis.style.minWidth = "0";
    this.xAxis.style.minHeight = "0";
    this.xAxis.style.overflow = "hidden";
    this.xAxis.style.pointerEvents = "none";

    this.corner.style.gridColumn = "1";
    this.corner.style.gridRow = "2";
    this.corner.style.minWidth = "0";
    this.corner.style.minHeight = "0";
    this.corner.style.pointerEvents = "none";

    this.cornerRight.style.gridColumn = "3";
    this.cornerRight.style.gridRow = "2";
    this.cornerRight.style.minWidth = "0";
    this.cornerRight.style.minHeight = "0";
    this.cornerRight.style.pointerEvents = "none";

    for (const el of [this.title, this.subtitle, this.xAxisTitle, this.yAxisTitle, this.y2AxisTitle]) {
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      el.style.userSelect = "none";
      el.style.whiteSpace = "nowrap";
      el.style.zIndex = "18";
      el.style.display = "none";
    }

    this.title.style.top = "6px";
    this.title.style.left = "50%";
    this.title.style.transform = "translateX(-50%)";
    this.title.style.textAlign = "center";

    this.subtitle.style.top = "26px";
    this.subtitle.style.left = "50%";
    this.subtitle.style.transform = "translateX(-50%)";
    this.subtitle.style.textAlign = "center";

    this.xAxisTitle.style.left = "50%";
    this.xAxisTitle.style.bottom = "4px";
    this.xAxisTitle.style.transform = "translateX(-50%)";
    this.xAxisTitle.style.textAlign = "center";

    this.yAxisTitle.style.left = "4px";
    this.yAxisTitle.style.top = "50%";
    this.yAxisTitle.style.transform = "translateY(-50%) rotate(-90deg)";
    this.yAxisTitle.style.transformOrigin = "left center";

    this.y2AxisTitle.style.right = "4px";
    this.y2AxisTitle.style.top = "50%";
    this.y2AxisTitle.style.transform = "translateY(-50%) rotate(90deg)";
    this.y2AxisTitle.style.transformOrigin = "right center";
  }
}
