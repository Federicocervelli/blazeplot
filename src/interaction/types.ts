import type { Camera2D } from "./Camera2D.js";

/** Pan request expressed in data units or screen pixels. */
export interface PanIntent {
  readonly dx: number;
  readonly dy: number;
}

/** Axis affected by a zoom operation. */
export type ZoomAxis = "x" | "y" | "xy";

/** Zoom request with a scale factor and optional anchor point. */
export interface ZoomIntent {
  readonly factor: number;
  readonly cx: number;
  readonly cy: number;
  readonly axis: ZoomAxis;
}

/** Optional hooks that can constrain or react to viewport changes. */
export interface ViewportPolicy {
  beforePan?(camera: Camera2D, intent: PanIntent): PanIntent | null;
  beforeZoom?(camera: Camera2D, intent: ZoomIntent): ZoomIntent | null;
  beforeRender?(camera: Camera2D): void;
}
