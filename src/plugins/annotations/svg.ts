/** Annotation drawing: renders the SVG overlay for the visible annotations and patches it in place. */

import type { ChartPluginContext } from "../../ui/PluginTypes.js";

import type { Annotation, AnnotationLabelOptions, LabelAnnotation, PointAnnotation } from "./types.js";
import { labelOptions, labelText, annotationProjectors, clampRect, createSvgElement, isInsidePlot } from "./geometry.js";

export function renderAnnotations(
  chart: ChartPluginContext,
  overlay: SVGSVGElement,
  annotations: readonly Annotation[],
  cache: Map<Annotation, SVGGElement>,
  defaultColor: string,
  defaultFillColor: string,
  defaultFont: string,
): void {
  const plot = chart.layout.plotRect();
  const width = Math.max(1, plot.width);
  const height = Math.max(1, plot.height);
  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Keep one SVG group per annotation and sync attributes in place, so a pan or live frame
  // does not create or remove DOM nodes unless the annotation list or visibility changes.
  const ordered: SVGGElement[] = [];
  const live = new Set<Annotation>();
  for (const annotation of annotations) {
    if (annotation.visible === false) continue;
    const fresh = drawAnnotation(chart, annotation, width, height, defaultColor, defaultFillColor, defaultFont);
    const existing = cache.get(annotation);
    if (!fresh) continue;
    live.add(annotation);
    if (existing && syncSvg(existing, fresh)) {
      ordered.push(existing);
    } else {
      cache.set(annotation, fresh);
      ordered.push(fresh);
    }
  }
  for (const [annotation, group] of cache) {
    if (live.has(annotation)) continue;
    group.remove();
    cache.delete(annotation);
  }
  let same = overlay.childNodes.length === ordered.length;
  for (let i = 0; same && i < ordered.length; i++) same = overlay.childNodes[i] === ordered[i];
  if (!same) overlay.replaceChildren(...ordered);
}

/** Copy `fresh` onto `existing` in place when both have the same structure. Returns false when they differ structurally. */
export function syncSvg(existing: Element, fresh: Element): boolean {
  if (existing.tagName !== fresh.tagName || existing.children.length !== fresh.children.length) return false;
  for (let i = 0; i < fresh.children.length; i++) {
    if (existing.children[i]!.tagName !== fresh.children[i]!.tagName) return false;
  }
  for (const attr of Array.from(existing.attributes)) {
    if (!fresh.hasAttribute(attr.name)) existing.removeAttribute(attr.name);
  }
  for (const attr of Array.from(fresh.attributes)) {
    if (existing.getAttribute(attr.name) !== attr.value) existing.setAttribute(attr.name, attr.value);
  }
  if (fresh.children.length === 0 && existing.textContent !== fresh.textContent) existing.textContent = fresh.textContent;
  for (let i = 0; i < fresh.children.length; i++) {
    if (!syncSvg(existing.children[i]!, fresh.children[i]!)) return false;
  }
  return true;
}

export function drawAnnotation(
  chart: ChartPluginContext,
  annotation: Annotation,
  width: number,
  height: number,
  defaultColor: string,
  defaultFillColor: string,
  defaultFont: string,
): SVGGElement | null {
  const { xToPx, yToPx } = annotationProjectors(chart, annotation);
  const group = createSvgElement(chart.dom.document, "g");
  if (annotation.className) group.classList.add(annotation.className);

  switch (annotation.type) {
    case "x-line": {
      const x = xToPx(annotation.x);
      if (x < 0 || x > width) return null;
      const line = createSvgElement(group.ownerDocument, "line");
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
      line.setAttribute("y1", "0");
      line.setAttribute("y2", String(height));
      styleStroke(line, annotation.color ?? defaultColor, annotation.width, annotation.dash);
      group.appendChild(line);
      appendLabel(group, annotation.label, x + 4, 6, "start", defaultColor, defaultFont);
      break;
    }
    case "y-line": {
      const y = yToPx(annotation.y);
      if (y < 0 || y > height) return null;
      const line = createSvgElement(group.ownerDocument, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("x2", String(width));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      styleStroke(line, annotation.color ?? defaultColor, annotation.width, annotation.dash);
      group.appendChild(line);
      appendLabel(group, annotation.label, width - 4, y - 4, "end", defaultColor, defaultFont);
      break;
    }
    case "x-range": {
      const rect = clampRect(xToPx(annotation.xMin), 0, xToPx(annotation.xMax), height, width, height);
      if (!rect) return null;
      appendRect(group, rect, annotation.fillColor ?? defaultFillColor, annotation.borderColor, annotation.borderWidth);
      appendLabel(group, annotation.label, rect.x + rect.w * 0.5, 6, "middle", defaultColor, defaultFont);
      break;
    }
    case "y-range": {
      const rect = clampRect(0, yToPx(annotation.yMax), width, yToPx(annotation.yMin), width, height);
      if (!rect) return null;
      appendRect(group, rect, annotation.fillColor ?? defaultFillColor, annotation.borderColor, annotation.borderWidth);
      appendLabel(group, annotation.label, width - 4, rect.y + rect.h * 0.5, "end", defaultColor, defaultFont);
      break;
    }
    case "box": {
      const rect = clampRect(xToPx(annotation.xMin), yToPx(annotation.yMax), xToPx(annotation.xMax), yToPx(annotation.yMin), width, height);
      if (!rect) return null;
      appendRect(group, rect, annotation.fillColor ?? defaultFillColor, annotation.borderColor, annotation.borderWidth);
      appendLabel(group, annotation.label, rect.x + rect.w * 0.5, rect.y + 6, "middle", defaultColor, defaultFont);
      break;
    }
    case "point": {
      const x = xToPx(annotation.x);
      const y = yToPx(annotation.y);
      const radius = annotation.radius ?? 5;
      if (!isInsidePlot(x, y, width, height)) return null;
      appendMarker(group, x, y, radius, annotation);
      appendLabel(group, annotation.label, x + radius + 4, y - radius - 2, "start", defaultColor, defaultFont);
      break;
    }
    case "label": {
      const x = xToPx(annotation.x);
      const y = yToPx(annotation.y);
      if (!isInsidePlot(x, y, width, height)) return null;
      appendStandaloneLabel(group, annotation, x, y, defaultColor, defaultFont);
      break;
    }
  }

  return group;
}

export function styleStroke(el: SVGElement, color: string, width: number = 1, dash?: string): void {
  el.setAttribute("stroke", color);
  el.setAttribute("stroke-width", String(width));
  el.setAttribute("fill", "none");
  if (dash) el.setAttribute("stroke-dasharray", dash);
}

export function appendRect(group: SVGGElement, rect: { x: number; y: number; w: number; h: number }, fill: string, stroke?: string, strokeWidth: number = 0): void {
  const el = createSvgElement(group.ownerDocument, "rect");
  el.setAttribute("x", String(rect.x));
  el.setAttribute("y", String(rect.y));
  el.setAttribute("width", String(rect.w));
  el.setAttribute("height", String(rect.h));
  el.setAttribute("fill", fill);
  if (stroke) {
    el.setAttribute("stroke", stroke);
    el.setAttribute("stroke-width", String(strokeWidth || 1));
  }
  group.appendChild(el);
}

export function appendMarker(group: SVGGElement, x: number, y: number, radius: number, annotation: PointAnnotation): void {
  const fill = annotation.color ?? "rgba(255,255,255,0.95)";
  const stroke = annotation.strokeColor ?? "rgba(0,0,0,0.35)";
  const strokeWidth = annotation.strokeWidth ?? 1;
  if (annotation.shape === "diamond") {
    const polygon = createSvgElement(group.ownerDocument, "polygon");
    polygon.setAttribute("points", `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`);
    polygon.setAttribute("fill", fill);
    polygon.setAttribute("stroke", stroke);
    polygon.setAttribute("stroke-width", String(strokeWidth));
    group.appendChild(polygon);
    return;
  }

  if (annotation.shape === "cross") {
    for (const [x1, y1, x2, y2] of [[x - radius, y, x + radius, y], [x, y - radius, x, y + radius]] as const) {
      const line = createSvgElement(group.ownerDocument, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      styleStroke(line, fill, strokeWidth + 1);
      group.appendChild(line);
    }
    return;
  }

  const circle = createSvgElement(group.ownerDocument, "circle");
  circle.setAttribute("cx", String(x));
  circle.setAttribute("cy", String(y));
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", fill);
  circle.setAttribute("stroke", stroke);
  circle.setAttribute("stroke-width", String(strokeWidth));
  group.appendChild(circle);
}

export function appendStandaloneLabel(group: SVGGElement, annotation: LabelAnnotation, x: number, y: number, defaultColor: string, defaultFont: string): void {
  const text = appendText(group, annotation.text, x, y, "start", annotation.color ?? defaultColor, annotation.font ?? defaultFont);
  if (annotation.backgroundColor) {
    const rect = createSvgElement(group.ownerDocument, "rect");
    rect.setAttribute("x", String(x - 4));
    rect.setAttribute("y", String(y - 14));
    rect.setAttribute("width", String(Math.max(16, annotation.text.length * 7 + 8)));
    rect.setAttribute("height", "18");
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", annotation.backgroundColor);
    group.insertBefore(rect, text);
  }
}

export function appendLabel(group: SVGGElement, label: string | AnnotationLabelOptions | undefined, x: number, y: number, anchor: "start" | "middle" | "end", defaultColor: string, defaultFont: string): void {
  const textValue = labelText(label);
  if (!textValue) return;
  const opts = labelOptions(label);
  appendText(group, textValue, x + (opts.offsetX ?? 0), y + (opts.offsetY ?? 0), anchor, opts.color ?? defaultColor, opts.font ?? defaultFont);
}

export function appendText(group: SVGGElement, textValue: string, x: number, y: number, anchor: "start" | "middle" | "end", color: string, font: string): SVGTextElement {
  const text = createSvgElement(group.ownerDocument, "text");
  text.textContent = textValue;
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));
  text.setAttribute("fill", color);
  text.setAttribute("font", font);
  text.setAttribute("text-anchor", anchor);
  text.setAttribute("dominant-baseline", "hanging");
  text.setAttribute("paint-order", "stroke");
  text.setAttribute("stroke", "rgba(0,0,0,0.45)");
  text.setAttribute("stroke-width", "3");
  group.appendChild(text);
  return text;
}

