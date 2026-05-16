import type { Camera2D } from "./Camera2D.js";

export interface PanIntent {
  readonly dx: number;
  readonly dy: number;
}

export type ZoomAxis = "x" | "y" | "xy";

export interface ZoomIntent {
  readonly factor: number;
  readonly cx: number;
  readonly cy: number;
  readonly axis: ZoomAxis;
}

export interface ViewportPolicy {
  beforePan?(camera: Camera2D, intent: PanIntent): PanIntent | null;
  beforeZoom?(camera: Camera2D, intent: ZoomIntent): ZoomIntent | null;
  beforeRender?(camera: Camera2D): void;
}
