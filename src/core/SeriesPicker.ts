import { SeriesSource } from "./SeriesSource.js";
import type { SeriesSample, Viewport } from "./types.js";

const NEAREST_POINT_LEAF_SIZE = 64;
export const identity = (value: number): number => value;

type PointSearchInterval = {
  readonly start: number;
  readonly end: number;
  readonly lowerBoundSq: number;
};

/**
 * Nearest-sample queries: by X value (hover on the X axis) and by screen-space distance, which prunes
 * with min/max interval bounds when the dataset can answer them.
 */
export class SeriesPicker extends SeriesSource {
  /** @internal Find the nearest non-gap sample by X value, optionally constrained to a viewport. */
  nearestSampleByX(x: number, viewport?: Viewport): SeriesSample | null {
    const range = this.visibleIndexRange(viewport);
    if (range.start >= range.end) return null;

    const lower = this.dataset.lowerBoundX(x);
    let left = Math.min(lower - 1, range.end - 1);
    let right = Math.max(lower, range.start);

    while (left >= range.start || right < range.end) {
      const leftDx = left >= range.start ? Math.abs(this.dataset.getX(left) - x) : Infinity;
      const rightDx = right < range.end ? Math.abs(this.dataset.getX(right) - x) : Infinity;
      if (leftDx <= rightDx) {
        const sample = this.sampleAt(left);
        if (sample) return sample;
        left--;
      } else {
        const sample = this.sampleAt(right);
        if (sample) return sample;
        right++;
      }
    }

    return null;
  }

  /** @internal Find the nearest non-gap sample in screen-space distance. */
  nearestSampleByPoint(
    x: number,
    y: number,
    viewport: Viewport,
    plotWidth: number,
    plotHeight: number,
    maxDistancePx: number = Infinity,
    xTransform: (value: number) => number = identity,
    yTransform: (value: number) => number = identity,
  ): SeriesSample | null {
    const range = this.visibleIndexRange(viewport);
    const transformedX = xTransform(x);
    const transformedY = yTransform(y);
    const xRange = xTransform(viewport.xMax) - xTransform(viewport.xMin);
    const yRange = yTransform(viewport.yMax) - yTransform(viewport.yMin);
    if (range.start >= range.end || plotWidth <= 0 || plotHeight <= 0 || xRange <= 0 || yRange <= 0) return null;

    const xScale = plotWidth / xRange;
    const yScale = plotHeight / yRange;
    let bestIndex = -1;
    let bestDistanceSq = maxDistancePx < 0
      ? -1
      : Number.isFinite(maxDistancePx)
        ? maxDistancePx * maxDistancePx
        : Infinity;

    const visitSample = (index: number): void => {
      const sampleY = this.dataset.getY(index);
      if (this.isGap(index, sampleY)) return;
      const dx = (xTransform(this.dataset.getX(index)) - transformedX) * xScale;
      const dy = (yTransform(sampleY) - transformedY) * yScale;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistanceSq || (bestIndex < 0 && d2 <= bestDistanceSq)) {
        bestDistanceSq = d2;
        bestIndex = index;
      }
    };

    const lower = this.dataset.lowerBoundX(x);
    const nearest = Math.min(Math.max(lower, range.start), range.end - 1);
    visitSample(nearest);
    if (nearest > range.start) visitSample(nearest - 1);
    if (nearest + 1 < range.end) visitSample(nearest + 1);

    if (this.hasPointIntervalBounds() && range.end - range.start > NEAREST_POINT_LEAF_SIZE) {
      const rootBound = this.pointIntervalDistanceSq(range.start, range.end, transformedX, transformedY, xScale, yScale, xTransform, yTransform);
      const stack: PointSearchInterval[] = rootBound <= bestDistanceSq
        ? [{ start: range.start, end: range.end, lowerBoundSq: rootBound }]
        : [];

      while (stack.length > 0) {
        const interval = stack.pop()!;
        if (interval.lowerBoundSq > bestDistanceSq) continue;

        const length = interval.end - interval.start;
        if (length <= NEAREST_POINT_LEAF_SIZE) {
          for (let i = interval.start; i < interval.end; i++) visitSample(i);
          continue;
        }

        const mid = interval.start + (length >> 1);
        const leftBound = this.pointIntervalDistanceSq(interval.start, mid, transformedX, transformedY, xScale, yScale, xTransform, yTransform);
        const rightBound = this.pointIntervalDistanceSq(mid, interval.end, transformedX, transformedY, xScale, yScale, xTransform, yTransform);
        const left: PointSearchInterval = { start: interval.start, end: mid, lowerBoundSq: leftBound };
        const right: PointSearchInterval = { start: mid, end: interval.end, lowerBoundSq: rightBound };

        if (leftBound < rightBound) {
          if (rightBound <= bestDistanceSq) stack.push(right);
          if (leftBound <= bestDistanceSq) stack.push(left);
        } else {
          if (leftBound <= bestDistanceSq) stack.push(left);
          if (rightBound <= bestDistanceSq) stack.push(right);
        }
      }
    } else {
      let left = Math.min(lower - 1, range.end - 1);
      let right = Math.max(lower, range.start);
      while (left >= range.start || right < range.end) {
        const leftDxSq = left >= range.start ? this.pointXDistanceSq(left, transformedX, xScale, xTransform) : Infinity;
        const rightDxSq = right < range.end ? this.pointXDistanceSq(right, transformedX, xScale, xTransform) : Infinity;
        if (leftDxSq > bestDistanceSq && rightDxSq > bestDistanceSq) break;

        if (leftDxSq <= rightDxSq) {
          if (leftDxSq <= bestDistanceSq) visitSample(left);
          left--;
        } else {
          if (rightDxSq <= bestDistanceSq) visitSample(right);
          right++;
        }
      }
    }

    if (bestIndex < 0) return null;
    const sample = this.sampleAt(bestIndex);
    return sample ? { ...sample, distancePx: Math.sqrt(bestDistanceSq) } : null;
  }

  private pointXDistanceSq(index: number, x: number, xScale: number, xTransform: (value: number) => number): number {
    const dx = (xTransform(this.dataset.getX(index)) - x) * xScale;
    return dx * dx;
  }

  private pointIntervalDistanceSq(
    start: number,
    end: number,
    x: number,
    y: number,
    xScale: number,
    yScale: number,
    xTransform: (value: number) => number,
    yTransform: (value: number) => number,
  ): number {
    if (end <= start) return Infinity;

    const x0 = xTransform(this.dataset.getX(start));
    const x1 = xTransform(this.dataset.getX(end - 1));
    const dx = x < x0 ? (x0 - x) * xScale : x > x1 ? (x - x1) * xScale : 0;

    const range = this.pointIntervalMinMaxY(start, end);
    if (!range) return Infinity;
    const minY = yTransform(range.minY);
    const maxY = yTransform(range.maxY);
    const dy = y < minY ? (minY - y) * yScale : y > maxY ? (y - maxY) * yScale : 0;
    return dx * dx + dy * dy;
  }
}
