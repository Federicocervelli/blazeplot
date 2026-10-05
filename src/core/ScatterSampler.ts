import { shiftY, POINT_Y_OFFSETS } from "./datasetCaps.js";
import { SeriesSource } from "./SeriesSource.js";
import type { Viewport } from "./types.js";

const SCATTER_INTERVAL_LEAF_SIZE = 64;
const SCATTER_BUCKET_RANGE_PRUNE_SIZE = 1024;

/**
 * Extracts scatter points: exact 2D-culled chunks, and a viewport-aware point sampler with min/max
 * interval pruning that only decimates once the exact visible count exceeds the point budget.
 */
export class ScatterSampler extends SeriesSource {
  /** @internal Copy 2D-culled, screen-space sampled scatter points into a render buffer. */
  copyScatterVisible(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    pixelWidth: number,
    pixelHeight: number,
    pointSize: number,
    xOrigin: number = 0,
    yOrigin: number = 0,
  ): number {
    return this.copyVisiblePoints(viewport, target, maxPoints, pixelWidth, pixelHeight, pointSize, xOrigin, yOrigin);
  }

  /** @internal Copy exact Y-culled scatter points for a logical index range. */
  copyScatterRange(
    start: number,
    end: number,
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number = 0,
    pixelHeight: number = 0,
    pointSize: number = 0,
    yOrigin: number = 0,
  ): number {
    if (maxPoints <= 0 || target.length < maxPoints * 2) return 0;

    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this.dataset.length, Math.ceil(end));
    if (to <= from) return 0;

    const yRange = viewport.yMax - viewport.yMin;
    const height = Math.max(0, Math.floor(pixelHeight));
    const safePointSize = Number.isFinite(pointSize) ? Math.max(0, pointSize) : 0;
    const yPad = yRange > 0 && height > 0 ? ((safePointSize * 0.5) / height) * yRange : 0;
    return this.copyVisiblePointRange(from, to, viewport.yMin - yPad, viewport.yMax + yPad, target, maxPoints, xOrigin, yOrigin);
  }

  private copyVisiblePoints(
    viewport: Viewport,
    target: Float32Array,
    maxPoints: number,
    pixelWidth: number,
    pixelHeight: number,
    pointSize: number,
    xOrigin: number,
    yOrigin: number,
  ): number {
    if (this.caps.copyVisiblePoints) {
      const written = this.caps.copyVisiblePoints.copyVisiblePoints(viewport, target, maxPoints, xOrigin, pixelWidth, pixelHeight, pointSize);
      shiftY(target, written, 2, POINT_Y_OFFSETS, yOrigin);
      return written;
    }

    if (maxPoints <= 0 || target.length < maxPoints * 2) return 0;

    const xRange = viewport.xMax - viewport.xMin;
    const yRange = viewport.yMax - viewport.yMin;
    const width = Math.max(1, Math.floor(pixelWidth));
    const height = Math.max(1, Math.floor(pixelHeight));
    if (xRange <= 0 || yRange <= 0) return 0;

    const safePointSize = Number.isFinite(pointSize) ? Math.max(0, pointSize) : 0;
    const pointRadius = safePointSize * 0.5;
    const xPad = (pointRadius / width) * xRange;
    const yPad = (pointRadius / height) * yRange;
    const xMin = viewport.xMin - xPad;
    const xMax = viewport.xMax + xPad;
    const yMin = viewport.yMin - yPad;
    const yMax = viewport.yMax + yPad;

    const start = this.dataset.lowerBoundX(xMin);
    const end = this.dataset.upperBoundX(xMax);
    if (end <= start) return 0;

    if (end - start <= maxPoints) {
      return this.copyVisiblePointRange(start, end, yMin, yMax, target, maxPoints, xOrigin, yOrigin);
    }

    const hasIntervalBounds = this.hasPointIntervalBounds();
    const fullRange = hasIntervalBounds ? this.pointIntervalMinMaxY(start, end) : null;
    if (fullRange && (fullRange.maxY < yMin || fullRange.minY > yMax)) return 0;

    if (end - start <= maxPoints * 4) {
      const exact = this.copyVisiblePointsExact(start, end, yMin, yMax, target, maxPoints, xOrigin, yOrigin);
      if (!exact.overflow) return exact.count;
    }

    const fullRangeInside = fullRange !== null && fullRange.minY >= yMin && fullRange.maxY <= yMax;
    return this.copyVisiblePointBuckets(viewport, start, end, yMin, yMax, target, maxPoints, xOrigin, yOrigin, fullRangeInside, hasIntervalBounds);
  }

  private copyVisiblePointRange(
    start: number,
    end: number,
    yMin: number,
    yMax: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
    yOrigin: number,
  ): number {
    let count = 0;
    for (let i = start; i < end && count < maxPoints; i++) {
      const y = this.dataset.getY(i);
      if (this.isGap(i, y) || y < yMin || y > yMax) continue;

      const offset = count * 2;
      target[offset] = this.dataset.getX(i) - xOrigin;
      target[offset + 1] = y - yOrigin;
      count++;
    }
    return count;
  }

  private copyVisiblePointBuckets(
    viewport: Viewport,
    start: number,
    end: number,
    yMin: number,
    yMax: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
    yOrigin: number,
    fullRangeInside: boolean,
    hasIntervalBounds: boolean,
  ): number {
    const bucketWidth = this.stableSampleBucketWidthForViewport(viewport, maxPoints);
    const alignedStart = this.alignBucketStart(start, bucketWidth);
    let count = 0;

    const writeIndex = (index: number): boolean => {
      const y = this.dataset.getY(index);
      if (this.isGap(index, y)) return false;
      const offset = count * 2;
      target[offset] = this.dataset.getX(index) - xOrigin;
      target[offset + 1] = y - yOrigin;
      count++;
      return true;
    };
    const writeRepresentative = (representative: number, from: number, to: number): void => {
      if (writeIndex(representative)) return;
      for (let i = from; i < to; i++) {
        if (writeIndex(i)) return;
      }
    };

    for (let bucketStart = alignedStart; bucketStart < end && count < maxPoints; bucketStart += bucketWidth) {
      const bucketEnd = Math.min(end, bucketStart + bucketWidth);
      const visibleStart = Math.max(start, bucketStart);
      if (bucketEnd <= visibleStart) continue;

      const representative = Math.max(
        visibleStart,
        Math.min(bucketEnd - 1, bucketStart + (bucketWidth >> 1)),
      );

      if (fullRangeInside) {
        writeRepresentative(representative, visibleStart, bucketEnd);
        continue;
      }

      const range = hasIntervalBounds && bucketEnd - visibleStart >= SCATTER_BUCKET_RANGE_PRUNE_SIZE
        ? this.pointIntervalMinMaxY(visibleStart, bucketEnd)
        : null;
      if (range && (range.maxY < yMin || range.minY > yMax)) continue;
      if (range && range.minY >= yMin && range.maxY <= yMax) {
        writeRepresentative(representative, visibleStart, bucketEnd);
        continue;
      }

      for (let i = visibleStart; i < bucketEnd; i++) {
        const y = this.dataset.getY(i);
        if (this.isGap(i, y) || y < yMin || y > yMax) continue;
        writeIndex(i);
        break;
      }
    }

    return count;
  }

  private copyVisiblePointsExact(
    start: number,
    end: number,
    yMin: number,
    yMax: number,
    target: Float32Array,
    maxPoints: number,
    xOrigin: number,
    yOrigin: number,
  ): { count: number; overflow: boolean } {
    let count = 0;
    let overflow = false;
    const hasIntervalBounds = this.hasPointIntervalBounds();

    const writePoint = (index: number): boolean => {
      const y = this.dataset.getY(index);
      if (this.isGap(index, y) || y < yMin || y > yMax) return true;
      if (count >= maxPoints) {
        overflow = true;
        return false;
      }

      const offset = count * 2;
      target[offset] = this.dataset.getX(index) - xOrigin;
      target[offset + 1] = y - yOrigin;
      count++;
      return true;
    };

    const visitInterval = (from: number, to: number): boolean => {
      if (to <= from) return true;

      const range = hasIntervalBounds ? this.pointIntervalMinMaxY(from, to) : null;
      if (range && (range.maxY < yMin || range.minY > yMax)) return true;
      if (to - from <= SCATTER_INTERVAL_LEAF_SIZE || !hasIntervalBounds) {
        for (let i = from; i < to; i++) {
          if (!writePoint(i)) return false;
        }
        return true;
      }

      const mid = from + ((to - from) >> 1);
      return visitInterval(from, mid) && visitInterval(mid, to);
    };

    visitInterval(start, end);
    return { count, overflow };
  }
}
