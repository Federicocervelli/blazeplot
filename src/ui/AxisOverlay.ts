import type { Camera2D } from "../interaction/Camera2D.js";
import type { AxisController } from "../interaction/AxisController.js";
import type { ChartLayoutElements, ChartLayoutConfig } from "./ChartLayout.js";

export interface AxisOverlayOptions {
  readonly font?: string;
  readonly color?: string;
}

export type AxisOverlayConfig = ChartLayoutConfig;

export class AxisOverlay {
  private xPool: HTMLDivElement[] = [];
  private yPool: HTMLDivElement[] = [];
  private readonly xTicks: number[] = [];
  private readonly yTicks: number[] = [];

  constructor(
    private readonly layout: ChartLayoutElements,
    private readonly config: AxisOverlayConfig,
    private readonly options: AxisOverlayOptions = {},
  ) {}

  update(camera: Camera2D, axis: AxisController): void {
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

    this.updateAxis(this.xPool, this.xTicks, "x", camera, plotW, plotH, axis);
    this.updateAxis(this.yPool, this.yTicks, "y", camera, plotW, plotH, axis);
  }

  dispose(): void {
    for (const el of this.xPool) el.remove();
    for (const el of this.yPool) el.remove();
    this.xPool = [];
    this.yPool = [];
  }

  private parentForAxis(axis: "x" | "y"): HTMLElement {
    if (axis === "x") {
      return this.config.x.position === "outside" ? this.layout.xAxis : this.layout.plot;
    }
    return this.config.y.position === "outside" ? this.layout.yAxis : this.layout.plot;
  }

  private updateAxis(
    pool: HTMLDivElement[],
    values: number[],
    axis: "x" | "y",
    camera: Camera2D,
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

    for (let i = 0; i < values.length; i++) {
      const el = pool[i]!;
      const value = values[i]!;
      const text = controller.formatValue(value);
      if (el.textContent !== text) {
        el.textContent = text;
      }
      el.style.display = "block";

      if (axis === "x") {
        const [clipX] = camera.toClip(value, camera.yMin);
        const screenX = (clipX + 1) * 0.5 * plotW;
        el.style.left = `${screenX}px`;
        el.style.right = "auto";
        el.style.transform = "translateX(-50%)";
        if (this.config.x.position === "outside") {
          el.style.top = "4px";
          el.style.bottom = "auto";
        } else {
          el.style.top = "auto";
          el.style.bottom = "4px";
        }
      } else {
        const [, clipY] = camera.toClip(camera.xMin, value);
        const screenY = (1 - clipY) * 0.5 * plotH;
        el.style.top = `${screenY}px`;
        el.style.bottom = "auto";
        el.style.transform = "translateY(-50%)";
        if (this.config.y.position === "outside") {
          el.style.left = "auto";
          el.style.right = "4px";
        } else {
          el.style.left = "4px";
          el.style.right = "auto";
        }
      }
    }
  }
}
