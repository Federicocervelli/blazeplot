import type { Camera2D } from "./Camera2D.js";
import type { PanIntent, ZoomIntent } from "./types.js";

/** Optional hooks that can constrain or react to viewport changes. */
export interface ViewportPolicy {
  beforePan?(camera: Camera2D, intent: PanIntent): PanIntent | null;
  beforeZoom?(camera: Camera2D, intent: ZoomIntent): ZoomIntent | null;
  beforeRender?(camera: Camera2D): void;
}
