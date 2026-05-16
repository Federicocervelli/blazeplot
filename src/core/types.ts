export interface Viewport {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface LODBucket {
  readonly xStart: number;
  readonly xEnd: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface LODView {
  readonly buckets: Float32Array;
  readonly bucketCount: number;
  readonly level: number;
  readonly samplesPerPixel: number;
}

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export interface SeriesStyle {
  readonly color: readonly [number, number, number, number];
  readonly lineWidth: number;
}

export type SeriesMode = "line" | "envelope" | "scatter";

export interface SeriesConfig {
  readonly mode: SeriesMode;
  readonly capacity: number;
  readonly downsample: "minmax";
}
