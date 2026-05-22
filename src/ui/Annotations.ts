import type { ChartPlugin, ChartPluginContext, ChartPointerEventState } from "./Chart.js";
import type { SeriesYAxis } from "../core/types.js";

/** Label styling for annotation overlays. */
export interface AnnotationLabelOptions {
  readonly text: string;
  readonly position?: "start" | "center" | "end" | "top" | "bottom" | "left" | "right";
  readonly color?: string;
  readonly font?: string;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

/** Common fields shared by all annotation types. */
export interface AnnotationBase {
  readonly id?: string;
  readonly visible?: boolean;
  readonly yAxis?: SeriesYAxis;
  readonly className?: string;
  readonly label?: string | AnnotationLabelOptions;
}

/** Vertical annotation line at a data X value. */
export interface XLineAnnotation extends AnnotationBase {
  readonly type: "x-line";
  readonly x: number;
  readonly color?: string;
  readonly width?: number;
  readonly dash?: string;
}

/** Horizontal annotation line at a data Y value. */
export interface YLineAnnotation extends AnnotationBase {
  readonly type: "y-line";
  readonly y: number;
  readonly color?: string;
  readonly width?: number;
  readonly dash?: string;
}

/** Vertical band annotation spanning an X range. */
export interface XRangeAnnotation extends AnnotationBase {
  readonly type: "x-range";
  readonly xMin: number;
  readonly xMax: number;
  readonly fillColor?: string;
  readonly borderColor?: string;
  readonly borderWidth?: number;
}

/** Horizontal band annotation spanning a Y range. */
export interface YRangeAnnotation extends AnnotationBase {
  readonly type: "y-range";
  readonly yMin: number;
  readonly yMax: number;
  readonly fillColor?: string;
  readonly borderColor?: string;
  readonly borderWidth?: number;
}

/** Rectangular annotation spanning X and Y ranges. */
export interface BoxAnnotation extends AnnotationBase {
  readonly type: "box";
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly fillColor?: string;
  readonly borderColor?: string;
  readonly borderWidth?: number;
}

/** Point marker annotation at one data coordinate. */
export interface PointAnnotation extends AnnotationBase {
  readonly type: "point";
  readonly x: number;
  readonly y: number;
  readonly radius?: number;
  readonly color?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly shape?: "circle" | "diamond" | "cross";
}

/** Free-standing text label annotation. */
export interface LabelAnnotation extends AnnotationBase {
  readonly type: "label";
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color?: string;
  readonly font?: string;
  readonly backgroundColor?: string;
}

/** Any annotation supported by `annotationsPlugin`. */
export type Annotation =
  | XLineAnnotation
  | YLineAnnotation
  | XRangeAnnotation
  | YRangeAnnotation
  | BoxAnnotation
  | PointAnnotation
  | LabelAnnotation;

/** Screen bounds used for annotation hit testing. */
export interface AnnotationHitBounds {
  readonly xMin?: number;
  readonly xMax?: number;
  readonly yMin?: number;
  readonly yMax?: number;
  readonly x?: number;
  readonly y?: number;
}

/** Event payload emitted when pointer state changes over an annotation. */
export interface AnnotationHitEvent {
  readonly annotation: Annotation;
  readonly clientX: number;
  readonly clientY: number;
  readonly plotX: number;
  readonly plotY: number;
  readonly dataX: number;
  readonly dataY: number;
  readonly bounds: AnnotationHitBounds;
  readonly source?: ChartPointerEventState;
}

/** Pointer interaction event type for annotations. */
export type AnnotationHitEventType = "hover" | "click";

/** Options for the annotation overlay plugin. */
export interface AnnotationsPluginOptions {
  readonly annotations?: readonly Annotation[];
  readonly className?: string;
  readonly defaultColor?: string;
  readonly defaultFillColor?: string;
  readonly defaultFont?: string;
  readonly zIndex?: number;
  readonly hitTolerancePx?: number;
  readonly onHover?: (event: AnnotationHitEvent | null) => void;
  readonly onClick?: (event: AnnotationHitEvent) => void;
}

/** Annotation plugin with imperative annotation updates. */
export interface AnnotationsPlugin extends ChartPlugin {
  add(annotation: Annotation): void;
  remove(id: string): boolean;
  clear(): void;
  setAnnotations(annotations: readonly Annotation[]): void;
  getAnnotations(): readonly Annotation[];
  pick(clientX: number, clientY: number): AnnotationHitEvent | null;
  subscribe(event: "hover", callback: (event: AnnotationHitEvent | null) => void): () => void;
  subscribe(event: "click", callback: (event: AnnotationHitEvent) => void): () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function labelText(label: string | AnnotationLabelOptions | undefined): string | null {
  if (!label) return null;
  return typeof label === "string" ? label : label.text;
}

function labelOptions(label: string | AnnotationLabelOptions | undefined): AnnotationLabelOptions {
  return typeof label === "string" ? { text: label } : label ?? { text: "" };
}

function clampRect(x0: number, y0: number, x1: number, y1: number, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(width, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(height, Math.max(y0, y1));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function isInsidePlot(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function isNear(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

function isInsideRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }, tolerance: number): boolean {
  return x >= rect.x - tolerance && x <= rect.x + rect.w + tolerance && y >= rect.y - tolerance && y <= rect.y + rect.h + tolerance;
}

function annotationBounds(annotation: Annotation): AnnotationHitBounds {
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

function hitTestAnnotation(chart: ChartPluginContext, annotation: Annotation, plotX: number, plotY: number, width: number, height: number, tolerance: number): boolean {
  if (annotation.visible === false) return false;
  const viewport = chart.getViewport(annotation.yAxis ?? "left");
  const xToPx = (x: number): number => ((x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width;
  const yToPx = (y: number): number => ((viewport.yMax - y) / (viewport.yMax - viewport.yMin)) * height;

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
      const radius = annotation.radius ?? 5;
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

function createHitEvent(chart: ChartPluginContext, annotation: Annotation, clientX: number, clientY: number, source?: ChartPointerEventState): AnnotationHitEvent | null {
  const rect = chart.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const plotX = clientX - rect.left;
  const plotY = clientY - rect.top;
  const data = chart.clientToData(clientX, clientY, annotation.yAxis ?? "left");
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

/** Create a plugin that renders lines, ranges, boxes, points, and labels. */
export function annotationsPlugin(options: AnnotationsPluginOptions = {}): AnnotationsPlugin {
  let annotations = [...(options.annotations ?? [])];
  let chartRef: ChartPluginContext | null = null;
  let overlay: SVGSVGElement | null = null;
  const color = options.defaultColor ?? "rgba(255,255,255,0.85)";
  const fillColor = options.defaultFillColor ?? "rgba(255,255,255,0.12)";
  const font = options.defaultFont ?? "12px system-ui, sans-serif";
  const hitTolerancePx = Math.max(0, options.hitTolerancePx ?? 6);
  const hoverSubscribers = new Set<(event: AnnotationHitEvent | null) => void>();
  const clickSubscribers = new Set<(event: AnnotationHitEvent) => void>();
  let lastHoverAnnotation: Annotation | null = null;

  const requestRender = (): void => {
    if (chartRef && overlay) render(chartRef, overlay, annotations, color, fillColor, font);
  };

  const pickAt = (clientX: number, clientY: number, source?: ChartPointerEventState): AnnotationHitEvent | null => {
    if (!chartRef) return null;
    const rect = chartRef.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const plotX = clientX - rect.left;
    const plotY = clientY - rect.top;
    for (let i = annotations.length - 1; i >= 0; i--) {
      const annotation = annotations[i]!;
      if (hitTestAnnotation(chartRef, annotation, plotX, plotY, rect.width, rect.height, hitTolerancePx)) {
        return createHitEvent(chartRef, annotation, clientX, clientY, source);
      }
    }
    return null;
  };

  const emitHover = (event: AnnotationHitEvent | null): void => {
    options.onHover?.(event);
    for (const callback of hoverSubscribers) callback(event);
  };

  const emitClick = (event: AnnotationHitEvent): void => {
    options.onClick?.(event);
    for (const callback of clickSubscribers) callback(event);
  };

  return {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      overlay = svg("svg");
      overlay.classList.add(options.className ?? "blazeplot-annotations");
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.pointerEvents = "none";
      overlay.style.overflow = "hidden";
      overlay.style.zIndex = String(options.zIndex ?? 12);
      overlay.setAttribute("aria-hidden", "true");
      chart.plotElement.appendChild(overlay);
      const unsubscribeRender = chart.subscribe("render", () => requestRender());
      const unsubscribeMove = chart.subscribe("pointermove", (event) => {
        const hit = pickAt(event.clientX, event.clientY, event);
        const nextAnnotation = hit?.annotation ?? null;
        if (nextAnnotation !== lastHoverAnnotation || hit) emitHover(hit);
        lastHoverAnnotation = nextAnnotation;
      });
      const unsubscribeClick = chart.subscribe("click", (event) => {
        const hit = pickAt(event.clientX, event.clientY, event);
        if (hit) emitClick(hit);
      });
      requestRender();
      return () => {
        unsubscribeRender();
        unsubscribeMove();
        unsubscribeClick();
        overlay?.remove();
        overlay = null;
        chartRef = null;
      };
    },
    add(annotation: Annotation): void {
      annotations = [...annotations, annotation];
      requestRender();
    },
    remove(id: string): boolean {
      const next = annotations.filter((annotation) => annotation.id !== id);
      const changed = next.length !== annotations.length;
      if (changed) {
        annotations = next;
        requestRender();
      }
      return changed;
    },
    clear(): void {
      annotations = [];
      requestRender();
    },
    setAnnotations(next: readonly Annotation[]): void {
      annotations = [...next];
      requestRender();
    },
    getAnnotations(): readonly Annotation[] {
      return annotations;
    },
    pick(clientX: number, clientY: number): AnnotationHitEvent | null {
      return pickAt(clientX, clientY);
    },
    subscribe(event: AnnotationHitEventType, callback: ((event: AnnotationHitEvent | null) => void) | ((event: AnnotationHitEvent) => void)): () => void {
      if (event === "hover") {
        const cb = callback as (event: AnnotationHitEvent | null) => void;
        hoverSubscribers.add(cb);
        return () => hoverSubscribers.delete(cb);
      }
      const cb = callback as (event: AnnotationHitEvent) => void;
      clickSubscribers.add(cb);
      return () => clickSubscribers.delete(cb);
    },
  };
}

function render(
  chart: ChartPluginContext,
  overlay: SVGSVGElement,
  annotations: readonly Annotation[],
  defaultColor: string,
  defaultFillColor: string,
  defaultFont: string,
): void {
  const width = Math.max(1, chart.canvas.clientWidth);
  const height = Math.max(1, chart.canvas.clientHeight);
  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  overlay.replaceChildren();

  for (const annotation of annotations) {
    if (annotation.visible === false) continue;
    drawAnnotation(chart, overlay, annotation, width, height, defaultColor, defaultFillColor, defaultFont);
  }
}

function drawAnnotation(
  chart: ChartPluginContext,
  overlay: SVGSVGElement,
  annotation: Annotation,
  width: number,
  height: number,
  defaultColor: string,
  defaultFillColor: string,
  defaultFont: string,
): void {
  const viewport = chart.getViewport(annotation.yAxis ?? "left");
  const xToPx = (x: number): number => ((x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width;
  const yToPx = (y: number): number => ((viewport.yMax - y) / (viewport.yMax - viewport.yMin)) * height;
  const group = svg("g");
  if (annotation.className) group.classList.add(annotation.className);

  switch (annotation.type) {
    case "x-line": {
      const x = xToPx(annotation.x);
      if (x < 0 || x > width) return;
      const line = svg("line");
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
      if (y < 0 || y > height) return;
      const line = svg("line");
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
      if (!rect) return;
      appendRect(group, rect, annotation.fillColor ?? defaultFillColor, annotation.borderColor, annotation.borderWidth);
      appendLabel(group, annotation.label, rect.x + rect.w * 0.5, 6, "middle", defaultColor, defaultFont);
      break;
    }
    case "y-range": {
      const rect = clampRect(0, yToPx(annotation.yMax), width, yToPx(annotation.yMin), width, height);
      if (!rect) return;
      appendRect(group, rect, annotation.fillColor ?? defaultFillColor, annotation.borderColor, annotation.borderWidth);
      appendLabel(group, annotation.label, width - 4, rect.y + rect.h * 0.5, "end", defaultColor, defaultFont);
      break;
    }
    case "box": {
      const rect = clampRect(xToPx(annotation.xMin), yToPx(annotation.yMax), xToPx(annotation.xMax), yToPx(annotation.yMin), width, height);
      if (!rect) return;
      appendRect(group, rect, annotation.fillColor ?? defaultFillColor, annotation.borderColor, annotation.borderWidth);
      appendLabel(group, annotation.label, rect.x + rect.w * 0.5, rect.y + 6, "middle", defaultColor, defaultFont);
      break;
    }
    case "point": {
      const x = xToPx(annotation.x);
      const y = yToPx(annotation.y);
      const radius = annotation.radius ?? 5;
      if (!isInsidePlot(x, y, width, height)) return;
      appendMarker(group, x, y, radius, annotation);
      appendLabel(group, annotation.label, x + radius + 4, y - radius - 2, "start", defaultColor, defaultFont);
      break;
    }
    case "label": {
      const x = xToPx(annotation.x);
      const y = yToPx(annotation.y);
      if (!isInsidePlot(x, y, width, height)) return;
      appendStandaloneLabel(group, annotation, x, y, defaultColor, defaultFont);
      break;
    }
  }

  overlay.appendChild(group);
}

function styleStroke(el: SVGElement, color: string, width: number = 1, dash?: string): void {
  el.setAttribute("stroke", color);
  el.setAttribute("stroke-width", String(width));
  el.setAttribute("fill", "none");
  if (dash) el.setAttribute("stroke-dasharray", dash);
}

function appendRect(group: SVGGElement, rect: { x: number; y: number; w: number; h: number }, fill: string, stroke?: string, strokeWidth: number = 0): void {
  const el = svg("rect");
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

function appendMarker(group: SVGGElement, x: number, y: number, radius: number, annotation: PointAnnotation): void {
  const fill = annotation.color ?? "rgba(255,255,255,0.95)";
  const stroke = annotation.strokeColor ?? "rgba(0,0,0,0.35)";
  const strokeWidth = annotation.strokeWidth ?? 1;
  if (annotation.shape === "diamond") {
    const polygon = svg("polygon");
    polygon.setAttribute("points", `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`);
    polygon.setAttribute("fill", fill);
    polygon.setAttribute("stroke", stroke);
    polygon.setAttribute("stroke-width", String(strokeWidth));
    group.appendChild(polygon);
    return;
  }

  if (annotation.shape === "cross") {
    for (const [x1, y1, x2, y2] of [[x - radius, y, x + radius, y], [x, y - radius, x, y + radius]] as const) {
      const line = svg("line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      styleStroke(line, fill, strokeWidth + 1);
      group.appendChild(line);
    }
    return;
  }

  const circle = svg("circle");
  circle.setAttribute("cx", String(x));
  circle.setAttribute("cy", String(y));
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", fill);
  circle.setAttribute("stroke", stroke);
  circle.setAttribute("stroke-width", String(strokeWidth));
  group.appendChild(circle);
}

function appendStandaloneLabel(group: SVGGElement, annotation: LabelAnnotation, x: number, y: number, defaultColor: string, defaultFont: string): void {
  const text = appendText(group, annotation.text, x, y, "start", annotation.color ?? defaultColor, annotation.font ?? defaultFont);
  if (annotation.backgroundColor) {
    const rect = svg("rect");
    rect.setAttribute("x", String(x - 4));
    rect.setAttribute("y", String(y - 14));
    rect.setAttribute("width", String(Math.max(16, annotation.text.length * 7 + 8)));
    rect.setAttribute("height", "18");
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", annotation.backgroundColor);
    group.insertBefore(rect, text);
  }
}

function appendLabel(group: SVGGElement, label: string | AnnotationLabelOptions | undefined, x: number, y: number, anchor: "start" | "middle" | "end", defaultColor: string, defaultFont: string): void {
  const textValue = labelText(label);
  if (!textValue) return;
  const opts = labelOptions(label);
  appendText(group, textValue, x + (opts.offsetX ?? 0), y + (opts.offsetY ?? 0), anchor, opts.color ?? defaultColor, opts.font ?? defaultFont);
}

function appendText(group: SVGGElement, textValue: string, x: number, y: number, anchor: "start" | "middle" | "end", color: string, font: string): SVGTextElement {
  const text = svg("text");
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
