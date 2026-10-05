/**
 * Annotation geometry: projecting annotations to plot pixels, hit testing, hit events, focus rectangles,
 * and accessible names. Reads the chart through the plugin context; draws nothing.
 */
import type { ChartPointerEvent } from "../../ui/ChartEvents.js";
import type { ChartPluginContext } from "../../ui/PluginTypes.js";

import { DEFAULT_ANNOTATIONS_MESSAGES } from "./types.js";
import type { Annotation, AnnotationHitBounds, AnnotationHitEvent, AnnotationLabelOptions, AnnotationsMessages } from "./types.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function createSvgElement<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, tag);
}

export function labelText(label: string | AnnotationLabelOptions | undefined): string | null {
  if (!label) return null;
  return typeof label === "string" ? label : label.text;
}

export function labelOptions(label: string | AnnotationLabelOptions | undefined): AnnotationLabelOptions {
  return typeof label === "string" ? { text: label } : label ?? { text: "" };
}

export function clampRect(x0: number, y0: number, x1: number, y1: number, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(width, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(height, Math.max(y0, y1));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function isInsidePlot(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

export function isNear(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

export function isInsideRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }, tolerance: number): boolean {
  return x >= rect.x - tolerance && x <= rect.x + rect.w + tolerance && y >= rect.y - tolerance && y <= rect.y + rect.h + tolerance;
}

export function annotationBounds(annotation: Annotation): AnnotationHitBounds {
  switch (annotation.type) {
    case "x-line":
      return { x: annotation.x, xMin: annotation.x, xMax: annotation.x };
    case "y-line":
      return { y: annotation.y, yMin: annotation.y, yMax: annotation.y };
    case "x-range":
      return { xMin: Math.min(annotation.xMin, annotation.xMax), xMax: Math.max(annotation.xMin, annotation.xMax) };
    case "y-range":
      return { yMin: Math.min(annotation.yMin, annotation.yMax), yMax: Math.max(annotation.yMin, annotation.yMax) };
    case "box":
      return {
        xMin: Math.min(annotation.xMin, annotation.xMax),
        xMax: Math.max(annotation.xMin, annotation.xMax),
        yMin: Math.min(annotation.yMin, annotation.yMax),
        yMax: Math.max(annotation.yMin, annotation.yMax),
      };
    case "point":
    case "label":
      return { x: annotation.x, y: annotation.y };
  }
}

/** Trim sub-millipixel float noise from projected coordinates. */
export const roundPx = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Data-to-plot projectors that honor log/symlog/custom scales and reversed axes via `ctx.coords`.
 * Non-finite inputs (open-ended bands) map to the matching plot edge direction so rect clamping works.
 */
export function annotationProjectors(chart: ChartPluginContext, annotation: Annotation): { xToPx: (x: number) => number; yToPx: (y: number) => number } {
  const yAxis = annotation.yAxis ?? "left";
  const vp = chart.viewport.get(yAxis);
  const mid = [(vp.xMin + vp.xMax) / 2, (vp.yMin + vp.yMax) / 2] as const;
  return {
    xToPx: (x) => {
      if (x === Infinity || x === -Infinity) return x;
      const px = roundPx(chart.coords.dataToPlot(x, mid[1], yAxis)[0]);
      return Number.isNaN(px) ? -Infinity : px;
    },
    yToPx: (y) => {
      if (y === Infinity || y === -Infinity) return -y;
      const py = roundPx(chart.coords.dataToPlot(mid[0], y, yAxis)[1]);
      return Number.isNaN(py) ? Infinity : py;
    },
  };
}

export function hitTestAnnotation(chart: ChartPluginContext, annotation: Annotation, plotX: number, plotY: number, width: number, height: number, tolerance: number): boolean {
  if (annotation.visible === false) return false;
  const { xToPx, yToPx } = annotationProjectors(chart, annotation);

  switch (annotation.type) {
    case "x-line":
      return isNear(plotX, xToPx(annotation.x), tolerance) && plotY >= -tolerance && plotY <= height + tolerance;
    case "y-line":
      return isNear(plotY, yToPx(annotation.y), tolerance) && plotX >= -tolerance && plotX <= width + tolerance;
    case "x-range": {
      const rect = clampRect(xToPx(annotation.xMin), 0, xToPx(annotation.xMax), height, width, height);
      return rect ? isInsideRect(plotX, plotY, rect, tolerance) : false;
    }
    case "y-range": {
      const rect = clampRect(0, yToPx(annotation.yMax), width, yToPx(annotation.yMin), width, height);
      return rect ? isInsideRect(plotX, plotY, rect, tolerance) : false;
    }
    case "box": {
      const rect = clampRect(xToPx(annotation.xMin), yToPx(annotation.yMax), xToPx(annotation.xMax), yToPx(annotation.yMin), width, height);
      return rect ? isInsideRect(plotX, plotY, rect, tolerance) : false;
    }
    case "point": {
      const dx = plotX - xToPx(annotation.x);
      const dy = plotY - yToPx(annotation.y);
      const radius = annotation.radiusPx ?? 5;
      return dx * dx + dy * dy <= (radius + tolerance) * (radius + tolerance);
    }
    case "label": {
      const x = xToPx(annotation.x);
      const y = yToPx(annotation.y);
      const rect = { x: x - tolerance, y: y - 16 - tolerance, w: Math.max(16, annotation.text.length * 7 + 8) + tolerance * 2, h: 22 + tolerance * 2 };
      return isInsideRect(plotX, plotY, rect, 0);
    }
  }
}

export function createHitEvent(chart: ChartPluginContext, annotation: Annotation, clientX: number, clientY: number, source?: ChartPointerEvent): AnnotationHitEvent | null {
  const rect = chart.layout.plotRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const plotX = clientX - rect.left;
  const plotY = clientY - rect.top;
  const data = chart.coords.clientToData(clientX, clientY, annotation.yAxis ?? "left");
  if (!data) return null;
  return {
    annotation,
    clientX,
    clientY,
    plotX,
    plotY,
    dataX: data[0],
    dataY: data[1],
    bounds: annotationBounds(annotation),
    source,
  };
}

/** Plot-space box a keyboard focus target covers for one annotation, or `null` when it is off-screen. */
export function annotationFocusRect(chart: ChartPluginContext, annotation: Annotation, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const { xToPx, yToPx } = annotationProjectors(chart, annotation);
  const band = 4;
  switch (annotation.type) {
    case "x-line": {
      const x = xToPx(annotation.x);
      return x < 0 || x > width ? null : { x: x - band, y: 0, w: band * 2, h: height };
    }
    case "y-line": {
      const y = yToPx(annotation.y);
      return y < 0 || y > height ? null : { x: 0, y: y - band, w: width, h: band * 2 };
    }
    case "x-range":
      return clampRect(xToPx(annotation.xMin), 0, xToPx(annotation.xMax), height, width, height);
    case "y-range":
      return clampRect(0, yToPx(annotation.yMax), width, yToPx(annotation.yMin), width, height);
    case "box":
      return clampRect(xToPx(annotation.xMin), yToPx(annotation.yMax), xToPx(annotation.xMax), yToPx(annotation.yMin), width, height);
    case "point": {
      const x = xToPx(annotation.x);
      const y = yToPx(annotation.y);
      const radius = (annotation.radiusPx ?? 5) + 2;
      return isInsidePlot(x, y, width, height) ? { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 } : null;
    }
    case "label": {
      const x = xToPx(annotation.x);
      const y = yToPx(annotation.y);
      return isInsidePlot(x, y, width, height) ? { x: x - 4, y: y - 2, w: Math.max(16, annotation.text.length * 7 + 8), h: 18 } : null;
    }
  }
}

/** Accessible name: `ariaLabel`, else the label text, else a description of the shape and position. */
export function annotationName(chart: ChartPluginContext, annotation: Annotation, messages: AnnotationsMessages = DEFAULT_ANNOTATIONS_MESSAGES): string {
  if (annotation.ariaLabel) return annotation.ariaLabel;
  const text = labelText(annotation.label) ?? (annotation.type === "label" ? annotation.text : null);
  if (text) return text;
  const yAxis = annotation.yAxis ?? "left";
  const x = (value: number): string => chart.coords.format(value, "x", yAxis);
  const y = (value: number): string => chart.coords.format(value, "y", yAxis);
  switch (annotation.type) {
    case "x-line": return messages.xLine(x(annotation.x));
    case "y-line": return messages.yLine(y(annotation.y));
    case "x-range": return messages.xRange(x(annotation.xMin), x(annotation.xMax));
    case "y-range": return messages.yRange(y(annotation.yMin), y(annotation.yMax));
    case "box": return messages.box(x(annotation.xMin), x(annotation.xMax), y(annotation.yMin), y(annotation.yMax));
    case "point": return messages.point(x(annotation.x), y(annotation.y));
    case "label": return messages.label(x(annotation.x), y(annotation.y));
  }
}

