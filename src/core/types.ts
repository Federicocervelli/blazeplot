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
  readonly pointSize?: number;
  readonly barWidth?: number;
  readonly baseline?: number;
}

export type SeriesMode = "line" | "envelope" | "scatter" | "bar";

export interface Dataset {
  readonly length: number;
  readonly range: TimeRange | null;
  getX(index: number): number;
  getY(index: number): number;
  lowerBoundX(x: number): number;
  upperBoundX(x: number): number;
}

export interface AppendableDataset extends Dataset {
  push(x: number, y: number): void;
  append(x: ArrayLike<number>, y: ArrayLike<number>): void;
  clear(): void;
}

export type LODStrategy = "minmax" | "none";

export interface SeriesConfig {
  readonly mode: SeriesMode;
  readonly capacity: number;
  readonly downsample?: LODStrategy;
  readonly dataset?: Dataset;
}
