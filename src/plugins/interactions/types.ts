/** Public interactions plugin option types. */
import type { ZoomAxis } from "../../interaction/types.js";
import type { Viewport } from "../../core/types.js";

/** Static or dynamic axis choice for wheel and drag interactions. */
export type InteractionAxisOption = ZoomAxis | (() => ZoomAxis);

/** Appearance and wording of the cooperative-gesture hint. */
export interface InteractionsGestureHintOptions {
  /** Shown when the wheel is used without the modifier. Defaults to "Use Ctrl + scroll to zoom" ("Use ⌘ + scroll to zoom" on Apple devices). */
  readonly wheelText?: string;
  /** Shown when one finger drags a `touchPan: "two-finger"` chart. Defaults to "Use two fingers to move the chart". */
  readonly touchText?: string;
  /** How long the hint stays visible. Defaults to 1200. */
  readonly durationMs?: number;
  readonly className?: string;
  /** Defaults to `theme.tooltipBackgroundColor`. */
  readonly backgroundColor?: string;
  /** Defaults to `theme.tooltipTextColor`. */
  readonly textColor?: string;
  /** Defaults to `theme.tooltipFont`. */
  readonly font?: string;
}

/** Keyboard pan and zoom step sizes for `interactionsPlugin({ keyboard })`. */
export interface InteractionsKeyboardOptions {
  /** Fraction of the viewport moved per arrow key. Defaults to 0.1. */
  readonly panFraction?: number;
  /** Zoom factor per +/- key. Defaults to 1.25. */
  readonly zoomFactor?: number;
}

/** Options for mouse, wheel, touch, and keyboard chart interactions. */
export interface InteractionsPluginOptions {
  /**
   * Arrow-key pan, +/- zoom, PageUp/PageDown Y zoom, and Home or 0 to fit, from the focused chart root.
   * Enabled by default; pass `false` to turn it off or an object to tune the step sizes.
   * The chart does not navigate by keyboard without this plugin.
   */
  readonly keyboard?: boolean | InteractionsKeyboardOptions;
  readonly axis?: InteractionAxisOption;
  /**
   * Drag a rectangle on the plot to zoom into it. Defaults to true. The drag starts on a plain
   * press (no modifier) unless `boxZoomModifier` says otherwise, and `selectionPlugin` takes a
   * plain drag first when both are installed; see `boxZoomModifier`.
   */
  readonly boxZoom?: boolean;
  /**
   * Modifier that starts a box zoom. By default any drag that is not a shift-drag pan zooms.
   * Set it to require exactly one modifier (or `"none"` for no modifier at all); use `"alt"`
   * or `"ctrl"` when `selectionPlugin` (or another plugin) owns the plain drag. `"shift"`
   * replaces shift-drag pan.
   */
  readonly boxZoomModifier?: "none" | "shift" | "alt" | "ctrl";
  /**
   * Wheel zoom and trackpad pan. `true` (the default) always handles the wheel over the plot and
   * axes. `"modifier"` is cooperative: the wheel scrolls the page unless Ctrl or Cmd is held
   * (trackpad pinch arrives as Ctrl+wheel, so it still zooms) and a hint explains the shortcut.
   * `false` leaves the wheel to the page.
   */
  readonly wheelZoom?: boolean | "modifier";
  readonly wheelZoomSensitivity?: number;
  readonly trackpadPinchSensitivity?: number;
  readonly trackpadPan?: boolean;
  readonly trackpadPanSensitivity?: number;
  readonly axisInteractions?: boolean;
  readonly axisHover?: boolean;
  readonly axisHoverColor?: string;
  readonly axisHoverFilter?: string;
  readonly shiftDragPan?: boolean;
  readonly doubleClickReset?: boolean;
  /**
   * When double-click/tap reset is used on a live-follow chart, resume the
   * chart's latest-X follow after applying the reset viewport. Defaults to true.
   */
  readonly resumeFollowOnReset?: boolean;
  readonly resetViewport?: () => Viewport;
  /**
   * Touch pan. `"two-finger"` (the default) is cooperative: one finger scrolls the page, and two
   * fingers pan and zoom the plot (a hint explains it). Axis gutters still pan with one finger.
   * `true` opts into one-finger pan, which blocks page scrolling over the plot (use it for
   * full-viewport charts). `false` disables touch pan.
   */
  readonly touchPan?: boolean | "two-finger";
  readonly pinchZoom?: boolean;
  /**
   * The hint shown in cooperative modes (`wheelZoom: "modifier"`, `touchPan: "two-finger"`)
   * when the user scrolls or drags without the required modifier or second finger. Defaults to
   * true; `false` turns it off. The overlay is `aria-hidden` and takes its colors and font
   * from the chart theme's tooltip tokens unless overridden.
   */
  readonly gestureHint?: boolean | InteractionsGestureHintOptions;
  readonly doubleTapReset?: boolean;
  readonly minDragDistancePx?: number;
}
