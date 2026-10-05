import type { ChartPointerEvent } from "./ChartEvents.js";
import type { ChartPlugin, ChartPluginContext } from "./PluginTypes.js";
import type { SeriesYAxis } from "../core/types.js";
import { asElement } from "./OverlayUtils.js";
import { singleChartPlugin } from "./OverlayUtils.js";

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
  /** Accessible name for the focusable annotation. Defaults to the label text, else a generated description. */
  readonly ariaLabel?: string;
  /** Put this annotation in the Tab order. Defaults to the plugin's `focusable` option. */
  readonly focusable?: boolean;
  /** Let Delete or Backspace remove this annotation while it has focus. Defaults to the plugin's `removable` option. */
  readonly removable?: boolean;
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
  readonly source?: ChartPointerEvent;
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
  /** Called for a pointer click on an annotation, and for Enter or Space while it has keyboard focus. */
  readonly onClick?: (event: AnnotationHitEvent) => void;
  /**
   * Give each visible annotation a keyboard focus target (`role="button"`, named by its label)
   * in the Tab order. Enter or Space activates it like a click. Defaults to true.
   */
  readonly focusable?: boolean;
  /** Let Delete or Backspace remove a focused annotation. Annotations can override it. Defaults to false. */
  readonly removable?: boolean;
  /** Called after an annotation was removed from the keyboard. */
  readonly onRemove?: (annotation: Annotation) => void;
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

function createSvgElement<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, tag);
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

/** Trim sub-millipixel float noise from projected coordinates. */
const roundPx = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Data-to-plot projectors that honor log/symlog/custom scales and reversed axes via `ctx.coords`.
 * Non-finite inputs (open-ended bands) map to the matching plot edge direction so rect clamping works.
 */
function annotationProjectors(chart: ChartPluginContext, annotation: Annotation): { xToPx: (x: number) => number; yToPx: (y: number) => number } {
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

function hitTestAnnotation(chart: ChartPluginContext, annotation: Annotation, plotX: number, plotY: number, width: number, height: number, tolerance: number): boolean {
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

function createHitEvent(chart: ChartPluginContext, annotation: Annotation, clientX: number, clientY: number, source?: ChartPointerEvent): AnnotationHitEvent | null {
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
function annotationFocusRect(chart: ChartPluginContext, annotation: Annotation, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
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
      const radius = (annotation.radius ?? 5) + 2;
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
function annotationName(chart: ChartPluginContext, annotation: Annotation): string {
  if (annotation.ariaLabel) return annotation.ariaLabel;
  const text = labelText(annotation.label) ?? (annotation.type === "label" ? annotation.text : null);
  if (text) return text;
  const yAxis = annotation.yAxis ?? "left";
  const x = (value: number): string => chart.coords.format(value, "x", yAxis);
  const y = (value: number): string => chart.coords.format(value, "y", yAxis);
  switch (annotation.type) {
    case "x-line": return `Vertical line at x ${x(annotation.x)}`;
    case "y-line": return `Horizontal line at y ${y(annotation.y)}`;
    case "x-range": return `X range from ${x(annotation.xMin)} to ${x(annotation.xMax)}`;
    case "y-range": return `Y range from ${y(annotation.yMin)} to ${y(annotation.yMax)}`;
    case "box": return `Box from x ${x(annotation.xMin)} to ${x(annotation.xMax)}, y ${y(annotation.yMin)} to ${y(annotation.yMax)}`;
    case "point": return `Point at x ${x(annotation.x)}, y ${y(annotation.y)}`;
    case "label": return `Label at x ${x(annotation.x)}, y ${y(annotation.y)}`;
  }
}

/** Create a plugin that renders lines, ranges, boxes, points, and labels. */
export function annotationsPlugin(options: AnnotationsPluginOptions = {}): AnnotationsPlugin {
  let annotations = [...(options.annotations ?? [])];
  let chartRef: ChartPluginContext | null = null;
  let overlay: SVGSVGElement | null = null;
  const groupCache = new Map<Annotation, SVGGElement>();
  const color = options.defaultColor ?? "rgba(255,255,255,0.85)";
  const fillColor = options.defaultFillColor ?? "rgba(255,255,255,0.12)";
  const font = options.defaultFont ?? "12px system-ui, sans-serif";
  const hitTolerancePx = Math.max(0, options.hitTolerancePx ?? 6);
  const hoverSubscribers = new Set<(event: AnnotationHitEvent | null) => void>();
  const clickSubscribers = new Set<(event: AnnotationHitEvent) => void>();
  let lastHoverAnnotation: Annotation | null = null;
  /** HTML focus targets laid over the (aria-hidden) SVG; they persist across renders so focus survives. */
  let focusLayer: HTMLDivElement | null = null;
  const focusTargets = new Map<Annotation, HTMLDivElement>();
  const focusedAnnotation = new WeakMap<Element, Annotation>();

  const isFocusable = (annotation: Annotation): boolean => annotation.visible !== false && (annotation.focusable ?? options.focusable ?? true);
  const isRemovable = (annotation: Annotation): boolean => annotation.removable ?? options.removable ?? false;

  const syncFocusTargets = (chart: ChartPluginContext, layer: HTMLDivElement): void => {
    const plot = chart.layout.plotRect();
    const width = Math.max(1, plot.width);
    const height = Math.max(1, plot.height);
    const live = new Set<Annotation>();
    let position = 0;
    for (const annotation of annotations) {
      if (!isFocusable(annotation)) continue;
      const rect = annotationFocusRect(chart, annotation, width, height);
      if (!rect) continue;
      live.add(annotation);
      let target = focusTargets.get(annotation);
      if (!target) {
        target = chart.dom.document.createElement("div");
        target.className = "blazeplot-annotation-focus";
        target.tabIndex = 0;
        target.setAttribute("role", "button");
        target.setAttribute("aria-roledescription", "annotation");
        Object.assign(target.style, { position: "absolute", pointerEvents: "none", borderRadius: "2px", boxSizing: "border-box" });
        focusTargets.set(annotation, target);
        focusedAnnotation.set(target, annotation);
      }
      target.setAttribute("aria-label", annotationName(chart, annotation));
      if (isRemovable(annotation)) target.setAttribute("aria-keyshortcuts", "Enter Delete");
      else target.setAttribute("aria-keyshortcuts", "Enter");
      target.style.left = `${rect.x}px`;
      target.style.top = `${rect.y}px`;
      target.style.width = `${rect.w}px`;
      target.style.height = `${rect.h}px`;
      if (layer.children.item(position) !== target) layer.insertBefore(target, layer.children.item(position));
      position++;
    }
    for (const [annotation, target] of focusTargets) {
      if (live.has(annotation)) continue;
      target.remove();
      focusTargets.delete(annotation);
    }
  };

  const requestRender = (): void => {
    if (chartRef && overlay) render(chartRef, overlay, annotations, groupCache, color, fillColor, font);
    if (chartRef && focusLayer) syncFocusTargets(chartRef, focusLayer);
  };

  const removeAnnotation = (annotation: Annotation): void => {
    annotations = annotations.filter((item) => item !== annotation);
    requestRender();
  };

  const pickAt = (clientX: number, clientY: number, source?: ChartPointerEvent): AnnotationHitEvent | null => {
    if (!chartRef) return null;
    const rect = chartRef.layout.plotRect();
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

  return singleChartPlugin("annotations", {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      overlay = createSvgElement(chart.dom.document, "svg");
      overlay.classList.add(options.className ?? "blazeplot-annotations");
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.pointerEvents = "none";
      overlay.style.overflow = "hidden";
      overlay.style.zIndex = String(options.zIndex ?? 12);
      overlay.setAttribute("aria-hidden", "true");
      chart.dom.mount("plot", overlay);

      focusLayer = chart.dom.document.createElement("div");
      focusLayer.className = "blazeplot-annotation-focus-layer";
      Object.assign(focusLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: String(options.zIndex ?? 12) });
      chart.dom.mount("plot", focusLayer);
      const onFocusKeyDown = (event: KeyboardEvent): void => {
        const target = asElement(event.target);
        const annotation = target ? focusedAnnotation.get(target) : undefined;
        if (!target || !annotation || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const box = target.getBoundingClientRect();
          const hit = createHitEvent(chart, annotation, box.left + box.width / 2, box.top + box.height / 2);
          if (hit) emitClick(hit);
          return;
        }
        if ((event.key === "Delete" || event.key === "Backspace") && isRemovable(annotation)) {
          event.preventDefault();
          // Keep focus in the chart: the next annotation, else the previous one, else the chart root.
          const next = (target.nextElementSibling ?? target.previousElementSibling) as HTMLElement | null;
          removeAnnotation(annotation);
          options.onRemove?.(annotation);
          (next?.isConnected ? next : focusLayer?.closest<HTMLElement>(".blazeplot-root"))?.focus();
        }
      };
      focusLayer.addEventListener("keydown", onFocusKeyDown);
      chart.events.subscribe("render", () => requestRender());
      chart.events.subscribe("pointermove", (event) => {
        const hit = pickAt(event.clientX, event.clientY, event);
        const nextAnnotation = hit?.annotation ?? null;
        if (nextAnnotation !== lastHoverAnnotation || hit) emitHover(hit);
        lastHoverAnnotation = nextAnnotation;
      });
      chart.events.subscribe("click", (event) => {
        const hit = pickAt(event.clientX, event.clientY, event);
        if (hit) emitClick(hit);
      });
      requestRender();
      return () => {
        focusLayer?.removeEventListener("keydown", onFocusKeyDown);
        focusLayer?.remove();
        focusLayer = null;
        focusTargets.clear();
        overlay = null;
        groupCache.clear();
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
  });
}

function render(
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
function syncSvg(existing: Element, fresh: Element): boolean {
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

function drawAnnotation(
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

function styleStroke(el: SVGElement, color: string, width: number = 1, dash?: string): void {
  el.setAttribute("stroke", color);
  el.setAttribute("stroke-width", String(width));
  el.setAttribute("fill", "none");
  if (dash) el.setAttribute("stroke-dasharray", dash);
}

function appendRect(group: SVGGElement, rect: { x: number; y: number; w: number; h: number }, fill: string, stroke?: string, strokeWidth: number = 0): void {
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

function appendMarker(group: SVGGElement, x: number, y: number, radius: number, annotation: PointAnnotation): void {
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

function appendStandaloneLabel(group: SVGGElement, annotation: LabelAnnotation, x: number, y: number, defaultColor: string, defaultFont: string): void {
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

function appendLabel(group: SVGGElement, label: string | AnnotationLabelOptions | undefined, x: number, y: number, anchor: "start" | "middle" | "end", defaultColor: string, defaultFont: string): void {
  const textValue = labelText(label);
  if (!textValue) return;
  const opts = labelOptions(label);
  appendText(group, textValue, x + (opts.offsetX ?? 0), y + (opts.offsetY ?? 0), anchor, opts.color ?? defaultColor, opts.font ?? defaultFont);
}

function appendText(group: SVGGElement, textValue: string, x: number, y: number, anchor: "start" | "middle" | "end", color: string, font: string): SVGTextElement {
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
