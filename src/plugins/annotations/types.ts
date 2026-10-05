/** Public annotation types: the annotation shapes, hit events, plugin options, and the plugin handle. */
import type { ChartPlugin } from "../../ui/PluginTypes.js";
import type { SeriesYAxis } from "../../core/types.js";
import type { ChartPointerEvent } from "../../ui/ChartEvents.js";

/** Label styling for annotation overlays. */
export interface AnnotationLabelOptions {
  readonly text: string;
  readonly position?: "start" | "center" | "end" | "top" | "bottom" | "left" | "right";
  readonly color?: string;
  readonly font?: string;
  /** Horizontal shift from the label's default position, in CSS pixels (positive moves right). */
  readonly offsetXPx?: number;
  /** Vertical shift from the label's default position, in CSS pixels (positive moves down). */
  readonly offsetYPx?: number;
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
  /** Line width in CSS pixels. Defaults to 1. */
  readonly widthPx?: number;
  /** SVG `stroke-dasharray`, in CSS pixels (for example `"4 2"`). */
  readonly dash?: string;
}

/** Horizontal annotation line at a data Y value. */
export interface YLineAnnotation extends AnnotationBase {
  readonly type: "y-line";
  readonly y: number;
  readonly color?: string;
  /** Line width in CSS pixels. Defaults to 1. */
  readonly widthPx?: number;
  /** SVG `stroke-dasharray`, in CSS pixels (for example `"4 2"`). */
  readonly dash?: string;
}

/** Vertical band annotation spanning an X range. */
export interface XRangeAnnotation extends AnnotationBase {
  readonly type: "x-range";
  readonly xMin: number;
  readonly xMax: number;
  readonly fillColor?: string;
  readonly borderColor?: string;
  /** Border width in CSS pixels. Defaults to none. */
  readonly borderWidthPx?: number;
}

/** Horizontal band annotation spanning a Y range. */
export interface YRangeAnnotation extends AnnotationBase {
  readonly type: "y-range";
  readonly yMin: number;
  readonly yMax: number;
  readonly fillColor?: string;
  readonly borderColor?: string;
  /** Border width in CSS pixels. Defaults to none. */
  readonly borderWidthPx?: number;
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
  /** Border width in CSS pixels. Defaults to none. */
  readonly borderWidthPx?: number;
}

/** Point marker annotation at one data coordinate. */
export interface PointAnnotation extends AnnotationBase {
  readonly type: "point";
  readonly x: number;
  readonly y: number;
  /** Marker radius in CSS pixels. Defaults to 5. */
  readonly radiusPx?: number;
  readonly color?: string;
  readonly strokeColor?: string;
  /** Marker outline width in CSS pixels. Defaults to 1. */
  readonly strokeWidthPx?: number;
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
/**
 * Overridable annotation strings, for localization. Unset keys keep their English defaults. Names are
 * used for annotations without `ariaLabel` or a label text; coordinates are formatted with the axis formatters.
 */
export interface AnnotationsMessages {
  /** Screen reader role description of a focusable annotation. */
  readonly roleDescription: string;
  readonly xLine: (x: string) => string;
  readonly yLine: (y: string) => string;
  readonly xRange: (from: string, to: string) => string;
  readonly yRange: (from: string, to: string) => string;
  readonly box: (xFrom: string, xTo: string, yFrom: string, yTo: string) => string;
  readonly point: (x: string, y: string) => string;
  readonly label: (x: string, y: string) => string;
}

/** English defaults for `AnnotationsMessages`. */
export const DEFAULT_ANNOTATIONS_MESSAGES: AnnotationsMessages = {
  roleDescription: "annotation",
  xLine: (x) => `Vertical line at x ${x}`,
  yLine: (y) => `Horizontal line at y ${y}`,
  xRange: (from, to) => `X range from ${from} to ${to}`,
  yRange: (from, to) => `Y range from ${from} to ${to}`,
  box: (xFrom, xTo, yFrom, yTo) => `Box from x ${xFrom} to ${xTo}, y ${yFrom} to ${yTo}`,
  point: (x, y) => `Point at x ${x}, y ${y}`,
  label: (x, y) => `Label at x ${x}, y ${y}`,
};

export interface AnnotationsPluginOptions {
  /** Override the accessible names and role description of annotations, for localization. */
  readonly messages?: Partial<AnnotationsMessages>;
  readonly annotations?: readonly Annotation[];
  readonly className?: string;
  readonly defaultColor?: string;
  readonly defaultFillColor?: string;
  readonly defaultFont?: string;
  readonly zIndex?: number;
  /** Extra pointer hit area around thin annotations, in CSS pixels. */
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
