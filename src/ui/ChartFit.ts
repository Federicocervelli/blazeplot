import type { SeriesStore } from "../core/SeriesStore.js";
import type { AxisController } from "../interaction/AxisController.js";
import type { Camera2D } from "../interaction/Camera2D.js";
import { domainsAlmostEqual, normalizeFitPadding, paddedAxisDomain } from "./ChartConfig.js";
import type { ChartFitToDataOptions } from "./ChartViewportTypes.js";

/** A camera with the axis controller that scales it. */
export interface FitTarget {
  readonly camera: Camera2D;
  readonly controller: AxisController;
}

/**
 * Fit the cameras to the data bounds of `candidates` (see `Chart.fitToData`): padding applies in scale
 * space, and an axis with no usable domain is left alone. Returns whether any camera changed; the
 * caller syncs the right camera, emits the viewport change, and refreshes hover.
 */
export function fitCameras(candidates: readonly SeriesStore[], options: ChartFitToDataOptions, left: FitTarget, right: FitTarget): boolean {
  const fitX = options.x !== false;
  const fitY = options.y !== false;
  if (!fitX && !fitY) return false;

  const yAxis = options.yAxis ?? "both";
  const padding = normalizeFitPadding(options.padding);
  let xMin = Infinity;
  let xMax = -Infinity;
  let leftYMin = Infinity;
  let leftYMax = -Infinity;
  let rightYMin = Infinity;
  let rightYMax = -Infinity;

  for (const series of candidates) {
    const bounds = series.dataBounds({ xMin: options.xMin, xMax: options.xMax });
    if (!bounds) continue;

    xMin = Math.min(xMin, bounds.xMin);
    xMax = Math.max(xMax, bounds.xMax);
    if (series.config.yAxis === "right") {
      rightYMin = Math.min(rightYMin, bounds.yMin);
      rightYMax = Math.max(rightYMax, bounds.yMax);
    } else {
      leftYMin = Math.min(leftYMin, bounds.yMin);
      leftYMax = Math.max(leftYMax, bounds.yMax);
    }
  }

  let changed = false;
  if (fitX && Number.isFinite(xMin) && Number.isFinite(xMax)) {
    const xDomain = paddedAxisDomain(left.controller, "x", xMin, xMax, padding.x, false);
    if (xDomain && !domainsAlmostEqual(left.camera.xMin, left.camera.xMax, xDomain.min, xDomain.max)) {
      left.camera.setViewport({ xMin: xDomain.min, xMax: xDomain.max });
      changed = true;
    }
  }
  const fitYAxis = (camera: Camera2D, controller: AxisController, min: number, max: number): void => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    const domain = paddedAxisDomain(controller, "y", min, max, padding.y, options.includeZero === true);
    if (!domain || domainsAlmostEqual(camera.yMin, camera.yMax, domain.min, domain.max)) return;
    camera.setViewport({ yMin: domain.min, yMax: domain.max });
    changed = true;
  };
  if (fitY && yAxis !== "right") fitYAxis(left.camera, left.controller, leftYMin, leftYMax);
  if (fitY && yAxis !== "left") fitYAxis(right.camera, right.controller, rightYMin, rightYMax);
  return changed;
}
