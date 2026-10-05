import type { ChartPointerEvent } from "../../ui/ChartEvents.js";
import type { ChartPluginContext } from "../../ui/PluginTypes.js";

import { asElement, singleChartPlugin } from "../common/OverlayUtils.js";
import { createSvgElement, annotationFocusRect, annotationName, createHitEvent, hitTestAnnotation } from "./geometry.js";
import { renderAnnotations } from "./svg.js";
import type { Annotation, AnnotationHitEvent, AnnotationHitEventType, AnnotationsPlugin, AnnotationsPluginOptions } from "./types.js";

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
    if (chartRef && overlay) renderAnnotations(chartRef, overlay, annotations, groupCache, color, fillColor, font);
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
