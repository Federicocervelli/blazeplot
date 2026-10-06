import type { RgbaColor, SeriesStyle } from "../core/types.js";
import type { SeriesStore } from "../core/SeriesStore.js";
import type { ChartAccessibilityOptions } from "./ChartOptions.js";
import type { ChartLayout } from "./ChartLayout.js";
import { titleText } from "./ChartLayout.js";
import type { ChartSummary } from "./ChartSummary.js";
import { withAlpha } from "./ChartConfig.js";
import { installSharedStyle } from "./SharedStyle.js";

/** Minimum delay between regenerated accessibility summaries while data changes. */
const SUMMARY_THROTTLE_MS = 1_000;
/** Class for content that is read by assistive technology but not drawn. */
const VISUALLY_HIDDEN_CLASS = "blazeplot-visually-hidden";
/**
 * Shared chart stylesheet: theme-aware `:focus-visible` rings for the root and every focusable
 * plugin control inside it, the visually-hidden utility, and the forced-colors focus ring. Plugins
 * inject their own forced-colors rules (`installPluginStyle`).
 */
const CHART_STYLESHEET = [
  ".blazeplot-root:focus-visible{outline:2px solid var(--blazeplot-focus-ring,Highlight);outline-offset:-2px}",
  ".blazeplot-root :focus-visible{outline:2px solid var(--blazeplot-focus-ring,Highlight);outline-offset:2px}",
  `.${VISUALLY_HIDDEN_CLASS}{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important}`,
  "@media (forced-colors:active){",
  ".blazeplot-root:focus-visible,.blazeplot-root :focus-visible{outline-color:Highlight}",
  "}",
].join("");

let nextSummaryId = 1;

/** What the accessibility layer reads from the chart. */
export interface ChartAccessibilityHost {
  /** `ChartOptions.accessibility`. */
  options(): boolean | ChartAccessibilityOptions | undefined;
  /** `ChartOptions.title` and `subtitle` text, joined into the default label. */
  titles(): { readonly title: unknown; readonly subtitle: unknown };
  layout(): ChartLayout;
  getSummary(): ChartSummary;
  disposed(): boolean;
  /** Whether `ChartOptions.plugins` is non-empty (a plugin may handle keyboard input on the root). */
  hasPlugins(): boolean;
  series(): readonly SeriesStore[];
  /** Series palette of the active (possibly forced-colors) theme. */
  seriesColors(): readonly RgbaColor[];
  /** Called when the forced-colors media query changes. */
  onForcedColorsChange(): void;
}

/**
 * Core accessibility for a chart: ARIA attributes, the throttled summary element, the shared
 * stylesheet, and forced-colors (high-contrast) detection with the series style overrides it needs.
 */
export class ChartAccessibility {
  /** Series styles saved while forced colors replace them. */
  readonly originalStyles = new Map<SeriesStore, SeriesStyle>();
  private forcedColorsQuery: MediaQueryList | null = null;
  private forcedColorsMatches = false;
  private summaryElement: HTMLElement | null = null;
  private summaryTimer: ReturnType<typeof setTimeout> | null = null;
  private summaryDirty = false;
  private releaseStyle: (() => void) | null = null;
  private readonly handleForcedColorsChange = (): void => {
    this.host.onForcedColorsChange();
  };
  private readonly flushSummary = (): void => {
    this.summaryTimer = null;
    this.updateSummary();
  };

  constructor(private readonly host: ChartAccessibilityHost) {}

  /** Whether the operating system's forced-colors mode is currently being honored. */
  get forcedColorsActive(): boolean {
    return this.forcedColorsMatches;
  }

  /** Whether a summary element exists (so the chart root should flush it on focus). */
  get hasSummary(): boolean {
    return this.summaryElement !== null;
  }

  /** Watch `(forced-colors: active)` unless accessibility or `forcedColors` is turned off. */
  watchForcedColors(): void {
    const option = this.host.options();
    if (option === false || (typeof option === "object" && option.forcedColors === false)) return;
    const view = this.host.layout().view;
    if (typeof view.matchMedia !== "function") return;
    const query = view.matchMedia("(forced-colors: active)");
    this.forcedColorsQuery = query;
    this.forcedColorsMatches = query.matches;
    query.addEventListener?.("change", this.handleForcedColorsChange);
  }

  unwatchForcedColors(): void {
    this.forcedColorsQuery?.removeEventListener?.("change", this.handleForcedColorsChange);
    this.forcedColorsQuery = null;
  }

  /** Re-read the media query; returns whether forced colors are active. */
  refreshForcedColors(): boolean {
    this.forcedColorsMatches = this.forcedColorsQuery?.matches === true;
    return this.forcedColorsMatches;
  }

  /**
   * While forced colors are active, draw every series in the system palette (by series order)
   * and keep the caller styles to restore afterwards. Otherwise restore any saved styles.
   */
  applyForcedSeriesStyles(): void {
    if (!this.forcedColorsMatches) {
      for (const [series, style] of this.originalStyles) series.applyResolvedStyle(style);
      this.originalStyles.clear();
      return;
    }
    const palette = this.host.seriesColors();
    const series = this.host.series();
    for (let index = 0; index < series.length; index++) {
      const target = series[index]!;
      let original = this.originalStyles.get(target);
      if (!original) {
        original = target.style;
        this.originalStyles.set(target, original);
      }
      const color = palette[index % palette.length]!;
      const contrast = palette[(index + 1) % palette.length]!;
      target.applyResolvedStyle({ ...original, color, fillColor: withAlpha(color, 0.35), upColor: color, downColor: contrast, wickColor: color });
    }
  }

  /** Set the root's role and label, hide decorative elements, and add the stylesheet and summary element. */
  install(): void {
    const option = this.host.options();
    if (option === false) return;

    const config = typeof option === "object" ? option : undefined;
    const { title: chartTitle, subtitle } = this.host.titles();
    const title = [titleText(chartTitle as string | undefined), titleText(subtitle as string | undefined)].filter(Boolean).join(" — ");
    const layout = this.host.layout();
    const root = layout.root;
    const doc = root.ownerDocument;
    // A tab stop is useful when it reads the summary or when a plugin may take keyboard input; a chart with
    // neither (`description: ""`, no plugins) would be an empty stop.
    if (root.tabIndex < 0 && (config?.description !== "" || this.host.hasPlugins())) root.tabIndex = 0;
    root.setAttribute("role", config?.role ?? "figure");
    root.setAttribute("aria-label", config?.label ?? (title || config?.messages?.defaultLabel || "BlazePlot chart"));
    layout.plot.setAttribute("role", "presentation");
    for (const element of [layout.canvas, layout.xAxis, layout.yAxis, layout.y2Axis]) {
      element.setAttribute("aria-hidden", "true");
    }

    this.releaseStyle = installSharedStyle(root, "blazeplot-style", CHART_STYLESHEET);

    if (config?.description === "") return;
    const summary = doc.createElement("div");
    summary.id = `blazeplot-summary-${nextSummaryId++}`;
    summary.className = VISUALLY_HIDDEN_CLASS;
    root.appendChild(summary);
    root.setAttribute("aria-describedby", summary.id);
    this.summaryElement = summary;
  }

  /** Schedule a throttled summary refresh after data changes (skipped for caller-supplied static text). */
  markSummaryDirty(): void {
    if (!this.summaryElement || this.host.disposed()) return;
    const option = this.host.options();
    if (typeof option === "object" && typeof option.description === "string") return;
    this.summaryDirty = true;
    if (this.summaryTimer === null) this.summaryTimer = setTimeout(this.flushSummary, SUMMARY_THROTTLE_MS);
  }

  /** Refresh the summary now if data changed since the last write (used on focus). */
  flushIfDirty(): void {
    if (this.summaryDirty) this.updateSummary();
  }

  /** Write the `aria-describedby` text: the caller's string, or the (optionally reworded) generated summary. */
  updateSummary(): void {
    const element = this.summaryElement;
    if (!element) return;
    this.summaryDirty = false;
    const option = this.host.options();
    const description = typeof option === "object" ? option.description : undefined;
    const text = typeof description === "string"
      ? description
      : description ? description(this.host.getSummary()) : this.host.getSummary().text;
    if (element.textContent !== text) element.textContent = text;
  }

  /** Cancel pending timers, the media-query listener, and this chart's hold on the shared stylesheet. */
  dispose(): void {
    this.unwatchForcedColors();
    this.releaseStyle?.();
    this.releaseStyle = null;
    if (this.summaryTimer !== null) clearTimeout(this.summaryTimer);
    this.summaryTimer = null;
  }
}
