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
