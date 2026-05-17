export type AxisPosition = "inside" | "outside";

export interface NormalizedAxisConfig {
  readonly visible: boolean;
  readonly position: AxisPosition;
}

export interface ChartLayoutConfig {
  readonly x: NormalizedAxisConfig;
  readonly y: NormalizedAxisConfig;
}

export interface ChartLayoutElements {
  readonly root: HTMLDivElement;
  readonly plot: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly xAxis: HTMLDivElement;
  readonly yAxis: HTMLDivElement;
  readonly corner: HTMLDivElement;
}

export const LEFT_AXIS_GUTTER_CSS = 52;
export const BOTTOM_AXIS_GUTTER_CSS = 28;

export class ChartLayout implements ChartLayoutElements {
  readonly root: HTMLDivElement;
  readonly plot: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly xAxis: HTMLDivElement;
  readonly yAxis: HTMLDivElement;
  readonly corner: HTMLDivElement;

  private readonly externalCanvas: boolean;
  private readonly originalCanvasCssText: string;
  private readonly originalCanvasParent: HTMLElement | null;

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
    this.corner = document.createElement("div");

    this.root.className = "blazeplot-root";
    this.plot.className = "blazeplot-plot";
    this.canvas.classList.add("blazeplot-canvas");
    this.xAxis.className = "blazeplot-axis blazeplot-axis-x";
    this.yAxis.className = "blazeplot-axis blazeplot-axis-y";
    this.corner.className = "blazeplot-axis-corner";

    this.applyBaseStyles();
    this.mount(target);
    this.update(config);
  }

  update(config: ChartLayoutConfig): void {
    const hasOutsideY = config.y.visible && config.y.position === "outside";
    const hasOutsideX = config.x.visible && config.x.position === "outside";

    this.root.style.gridTemplateColumns = `${hasOutsideY ? LEFT_AXIS_GUTTER_CSS : 0}px minmax(0, 1fr)`;
    this.root.style.gridTemplateRows = `minmax(0, 1fr) ${hasOutsideX ? BOTTOM_AXIS_GUTTER_CSS : 0}px`;
    this.yAxis.style.display = hasOutsideY ? "block" : "none";
    this.xAxis.style.display = hasOutsideX ? "block" : "none";
    this.corner.style.display = hasOutsideX && hasOutsideY ? "block" : "none";
  }

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
    this.root.appendChild(this.corner);
    this.root.appendChild(this.xAxis);
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
  }
}
