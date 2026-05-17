import type { Camera2D } from "../interaction/Camera2D.js";
import type { AxisController } from "../interaction/AxisController.js";

export interface AxisOverlayOptions {
  readonly font?: string;
  readonly color?: string;
}

export interface AxisOverlayAxisConfig {
  readonly visible: boolean;
  readonly position: "inside" | "outside";
}

export interface AxisOverlayConfig {
  readonly x: AxisOverlayAxisConfig;
  readonly y: AxisOverlayAxisConfig;
}

export class AxisOverlay {
  private container: HTMLDivElement;
  private xPool: HTMLDivElement[] = [];
  private yPool: HTMLDivElement[] = [];
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly config: AxisOverlayConfig,
    private readonly options: AxisOverlayOptions = {},
  ) {
    this.container = document.createElement("div");
    this.container.style.position = "absolute";
    this.container.style.pointerEvents = "none";
    this.container.style.overflow = "hidden";

    const parent = canvas.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    this.syncPosition();
    parent?.appendChild(this.container);
  }

  update(camera: Camera2D, axis: AxisController, leftMargin: number, bottomMargin: number): void {
    this.syncPosition();

    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const plotW = Math.max(1, cssW - leftMargin);
    const plotH = Math.max(1, cssH - bottomMargin);

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

    this.updateAxis(this.xPool, this.xTicks, "x", camera, cssW, cssH, axis, leftMargin, bottomMargin);
    this.updateAxis(this.yPool, this.yTicks, "y", camera, cssW, cssH, axis, leftMargin, bottomMargin);
  }

  dispose(): void {
    this.container.remove();
  }

  private syncPosition(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const canvasRect = this.canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    this.container.style.top = `${Math.round(canvasRect.top - parentRect.top)}px`;
    this.container.style.left = `${Math.round(canvasRect.left - parentRect.left)}px`;
    this.container.style.width = `${this.canvas.clientWidth}px`;
    this.container.style.height = `${this.canvas.clientHeight}px`;
  }

  private toCssScreen(
    clipX: number,
    clipY: number,
    cssW: number,
    cssH: number,
    leftMargin: number,
    bottomMargin: number,
  ): [number, number] {
    const plotW = Math.max(1, cssW - leftMargin);
    const plotH = Math.max(1, cssH - bottomMargin);
    return [
      (clipX + 1) * 0.5 * plotW + leftMargin,
      (1 - clipY) * 0.5 * plotH,
    ];
  }

  private updateAxis(
    pool: HTMLDivElement[],
    values: number[],
    axis: "x" | "y",
    camera: Camera2D,
    cssW: number,
    cssH: number,
    controller: AxisController,
    leftMargin: number,
    bottomMargin: number,
  ): void {
    while (pool.length < values.length) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      el.style.whiteSpace = "nowrap";
      el.style.font = this.options.font ?? "11px ui-monospace, monospace, sans-serif";
      el.style.color = this.options.color ?? "#bfd6ff";
      el.style.userSelect = "none";
      this.container.appendChild(el);
      pool.push(el);
    }

    for (let i = values.length; i < pool.length; i++) {
      pool[i]!.style.display = "none";
    }

    for (let i = 0; i < values.length; i++) {
      const el = pool[i]!;
      const value = values[i]!;
      const text = controller.formatValue(value);
      if (el.textContent !== text) {
        el.textContent = text;
      }
      el.style.display = "block";

      const [clipX, clipY] =
        axis === "x"
          ? camera.toClip(value, camera.yMin)
          : camera.toClip(camera.xMin, value);
      const [screenX, screenY] = this.toCssScreen(clipX, clipY, cssW, cssH, leftMargin, bottomMargin);

      if (axis === "x") {
        el.style.left = `${screenX}px`;
        el.style.transform = "translateX(-50%)";
        if (this.config.x.position === "outside") {
          el.style.top = `${screenY + 4}px`;
          el.style.bottom = "auto";
        } else {
          el.style.top = "auto";
          el.style.bottom = `${cssH - screenY + 4}px`;
        }
      } else {
        el.style.top = `${screenY}px`;
        el.style.transform = "translateY(-50%)";
        if (this.config.y.position === "outside") {
          el.style.left = "auto";
          el.style.right = `${cssW - screenX + 4}px`;
        } else {
          el.style.left = `${screenX + 4}px`;
          el.style.right = "auto";
        }
      }
    }
  }
}
