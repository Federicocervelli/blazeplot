import type { SeriesStyle } from "../src/core/types.ts";

/** A fully resolved series style for constructing `SeriesStore` directly in tests. */
export function testStyle(overrides: Partial<SeriesStyle> = {}): SeriesStyle {
  return {
    color: [1, 1, 1, 1],
    lineWidth: 1,
    pointSize: 4,
    barWidth: 0.8,
    baseline: 0,
    fillColor: [1, 1, 1, 0.25],
    tickWidth: 0.8,
    upColor: [1, 1, 1, 1],
    downColor: [1, 1, 1, 0.45],
    wickColor: [1, 1, 1, 1],
    ...overrides,
  };
}
