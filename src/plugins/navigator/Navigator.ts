import type { SeriesStore } from "../../core/SeriesStore.js";
import type { ChartPlugin, ChartPluginContext } from "../../ui/PluginTypes.js";
import { createSvgElement, installPluginStyle, singleChartPlugin } from "../common/OverlayUtils.js";
import { rgbaCss } from "../../ui/theme.js";

// The navigator window is outlined; a filled wash would tint the overview series.
const NAVIGATOR_CSS = "@media (forced-colors:active){.blazeplot-navigator-window{fill:transparent}}";

/** Overridable navigator strings, for localization. Unset keys keep their English defaults. */
export interface NavigatorMessages {
  /** Accessible name of the slider. */
  readonly label: string;
  /** Value text announced for the visible range. `from` and `to` are formatted with the X axis formatter (dates on a time axis). */
  readonly visibleRange: (from: string, to: string) => string;
}

/** English defaults for `NavigatorMessages`. */
export const DEFAULT_NAVIGATOR_MESSAGES: NavigatorMessages = {
  label: "Chart navigator visible X range",
  visibleRange: (from, to) => `Visible X range ${from} to ${to}`,
};

/** Options for the overview navigator plugin. */
export interface NavigatorPluginOptions {
  /** Override the slider label and value text wording, for localization. */
  readonly messages?: Partial<NavigatorMessages>;
  /** Accessible name of the slider; shorthand for `messages.label`. */
  readonly label?: string;
  /**
   * Full control of the slider's `aria-valuetext`. Receives the visible X range in data units. Defaults to
   * `messages.visibleRange` over the range formatted with the chart's X axis formatter, so a time axis
   * reads as dates instead of epoch milliseconds.
   */
  readonly formatValueText?: (range: { readonly xMin: number; readonly xMax: number }) => string;
  /** Overview height in CSS pixels (at least 24). Defaults to 56. */
  readonly heightPx?: number;
  readonly placement?: "bottom" | "top";
  readonly series?: SeriesStore | readonly SeriesStore[];
  /** Series up to this many samples (default 512) draw as an exact polyline; denser series draw a min/max envelope. */
  readonly maxSamplesPerSeries?: number;
  readonly followLive?: boolean;
  readonly className?: string;
  readonly backgroundColor?: string;
  readonly borderColor?: string;
  readonly strokeColor?: string;
  /** Overview line width in CSS pixels. Defaults to the series' `lineWidth`. */
  readonly strokeWidthPx?: number;
  readonly fillColor?: string;
  readonly windowFillColor?: string;
  readonly windowStrokeColor?: string;
  /** Drawn width of each window handle, in CSS pixels (at least 4). Defaults to 8. */
  readonly handleWidthPx?: number;
  /** Pointer hit width of each window handle, in CSS pixels. Defaults to 18. */
  readonly handleHitWidthPx?: number;
  readonly zIndex?: number;
  readonly reserveSpace?: boolean;
  /** Gap around the overview, in CSS pixels. Defaults to 8. */
  readonly marginPx?: number;
  readonly align?: "plot" | "chart";
  readonly onRangeChange?: (range: { readonly xMin: number; readonly xMax: number }) => void;
}

/** Navigator plugin with an imperative viewport update hook. */
export interface NavigatorPlugin extends ChartPlugin {
  refresh(): void;
}

interface Domain {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

type DragMode = "pan" | "left" | "right";

interface DragState {
  readonly pointerId: number;
  readonly mode: DragMode;
  readonly startClientX: number;
  readonly startXMin: number;
  readonly startXMax: number;
}

function seriesList(chart: ChartPluginContext, option: NavigatorPluginOptions["series"]): SeriesStore[] {
  if (option) return Array.isArray(option) ? [...(option as readonly SeriesStore[])] : [option as SeriesStore];
  return chart.state.getSeries().filter((state) => state.visible).map((state) => state.series);
}

/** Union of the series' data bounds. `dataBounds()` skips gaps and includes OHLC high/low and bar/area baselines. */
function computeDomain(series: readonly SeriesStore[]): Domain | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const s of series) {
    const bounds = s.dataBounds();
    if (!bounds) continue;
    xMin = Math.min(xMin, bounds.xMin);
    xMax = Math.max(xMax, bounds.xMax);
    yMin = Math.min(yMin, bounds.yMin);
    yMax = Math.max(yMax, bounds.yMax);
  }

  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin || !Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
  if (yMax <= yMin) {
    yMin -= 1;
    yMax += 1;
  }
  return { xMin, xMax, yMin, yMax };
}

interface OverviewPath {
  readonly d: string;
  /** True for a closed min/max envelope that should be filled. */
  readonly envelope: boolean;
}

/**
 * Build the overview geometry for one series. Series with at most `maxSamples` samples draw as an
 * exact polyline (gaps break it). Denser series draw a closed min/max envelope with one bucket per
 * CSS pixel, so spikes between samples survive.
 */
function pathForSeries(series: SeriesStore, domain: Domain, width: number, height: number, maxSamples: number, scratch: { buckets: Float64Array }): OverviewPath {
  if (series.length <= 0 || width <= 0 || height <= 0) return { d: "", envelope: false };
  const xScale = (width - 1) / (domain.xMax - domain.xMin);
  const yScale = (height - 1) / (domain.yMax - domain.yMin);
  const toY = (y: number): number => (height - 1) - (y - domain.yMin) * yScale;

  if (series.length <= maxSamples) {
    let path = "";
    let penDown = false;
    for (let i = 0; i < series.length; i++) {
      const sample = series.sampleAt(i);
      if (!sample) {
        penDown = false;
        continue;
      }
      const x = (sample.x - domain.xMin) * xScale;
      path += `${penDown ? " L" : path ? " M" : "M"} ${x.toFixed(2)} ${toY(sample.y).toFixed(2)}`;
      penDown = true;
    }
    return { d: path, envelope: false };
  }

  const bucketCount = Math.max(1, Math.floor(width));
  if (scratch.buckets.length < bucketCount * 2) scratch.buckets = new Float64Array(bucketCount * 2);
  const buckets = scratch.buckets;
  series.copyXBucketBounds(domain.xMin, domain.xMax, bucketCount, buckets);
  const bucketWidth = (width - 1) / bucketCount;

  let path = "";
  let run: number[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    // Top edge left to right, bottom edge right to left, then close.
    let top = "";
    let bottom = "";
    for (const b of run) {
      const x = ((b + 0.5) * bucketWidth).toFixed(2);
      top += `${top ? " L" : "M"} ${x} ${toY(buckets[b * 2 + 1]!).toFixed(2)}`;
      bottom = ` L ${x} ${toY(buckets[b * 2]!).toFixed(2)}${bottom}`;
    }
    path += `${path ? " " : ""}${top}${bottom} Z`;
    run = [];
  };
  for (let b = 0; b < bucketCount; b++) {
    if (Number.isNaN(buckets[b * 2]!)) flush();
    else run.push(b);
  }
  flush();
  return { d: path, envelope: true };
}

interface OverviewCache {
  readonly width: number;
  readonly series: readonly SeriesStore[];
  readonly versions: readonly number[];
  readonly lengths: readonly number[];
  readonly domain: Domain | null;
  readonly paths: readonly OverviewPath[];
}

/**
 * Create a plugin that renders a draggable X-range overview.
 *
 * Stateful: an instance serves one chart at a time. Installing it on a second chart while the first is
 * alive throws; create one instance per chart (linked layouts: `panelPlugins`). Disposing the chart frees it.
 */
export function navigatorPlugin(options: NavigatorPluginOptions = {}): NavigatorPlugin {
  const messages: NavigatorMessages = { ...DEFAULT_NAVIGATOR_MESSAGES, ...options.messages };
  const height = Math.max(24, options.heightPx ?? 56);
  const margin = Math.max(0, options.marginPx ?? 8);
  const placement = options.placement ?? "bottom";
  const maxSamplesPerSeries = Math.max(16, options.maxSamplesPerSeries ?? 512);
  const handleWidth = Math.max(4, options.handleWidthPx ?? 8);
  const handleHitWidth = Math.max(handleWidth, options.handleHitWidthPx ?? 18);
  let chartRef: ChartPluginContext | null = null;
  let root: HTMLDivElement | null = null;
  let overlay: SVGSVGElement | null = null;
  let windowRect: SVGRectElement | null = null;
  let leftHandle: SVGRectElement | null = null;
  let rightHandle: SVGRectElement | null = null;
  let leftHandleHit: SVGRectElement | null = null;
  let rightHandleHit: SVGRectElement | null = null;
  let paths: SVGPathElement[] = [];
  let domain: Domain | null = null;
  let overviewCache: OverviewCache | null = null;
  const scratch = { buckets: new Float64Array(0) };
  let drag: DragState | null = null;
  let wasAtRightEdge = true;

  const dataToX = (x: number, width: number): number => domain ? ((x - domain.xMin) / (domain.xMax - domain.xMin)) * width : 0;
  const xToData = (x: number, width: number): number => domain ? domain.xMin + (x / width) * (domain.xMax - domain.xMin) : 0;

  const updateRootPosition = (): void => {
    const chart = chartRef;
    if (!chart || !root) return;
    const rootRect = chart.layout.rootRect();
    const alignRect = options.align === "chart" ? rootRect : chart.layout.plotRect();
    root.style.left = `${Math.max(0, alignRect.left - rootRect.left)}px`;
    root.style.width = `${Math.max(1, alignRect.width)}px`;
  };

  /** `follow` pins the window to newly arrived data; viewport changes pass `false` so they are never undone. */
  const render = (follow = true): void => {
    const chart = chartRef;
    if (!chart || !root || !overlay || !windowRect || !leftHandle || !rightHandle || !leftHandleHit || !rightHandleHit) return;
    updateRootPosition();
    const selectedSeries = seriesList(chart, options.series);
    const width = Math.max(1, root.clientWidth);

    // The overview depends only on the data and the track size, so viewport-only renders reuse it.
    const cacheValid = overviewCache !== null
      && overviewCache.width === width
      && overviewCache.series.length === selectedSeries.length
      && selectedSeries.every((s, i) => overviewCache!.series[i] === s && overviewCache!.versions[i] === s.dataVersion && overviewCache!.lengths[i] === s.length);
    if (!cacheValid) {
      const nextDomain = computeDomain(selectedSeries);
      overviewCache = {
        width,
        series: selectedSeries,
        versions: selectedSeries.map((s) => s.dataVersion),
        lengths: selectedSeries.map((s) => s.length),
        domain: nextDomain,
        paths: nextDomain ? selectedSeries.map((s) => pathForSeries(s, nextDomain, width, height, maxSamplesPerSeries, scratch)) : [],
      };
    }
    const cache = overviewCache!;
    domain = cache.domain;
    if (!domain) {
      root.style.display = "none";
      return;
    }

    root.style.display = "block";
    root.setAttribute("aria-valuemin", String(domain.xMin));
    root.setAttribute("aria-valuemax", String(domain.xMax));
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    overlay.setAttribute("preserveAspectRatio", "none");

    while (paths.length < selectedSeries.length) {
      const path = createSvgElement(chart.dom.document, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      overlay.insertBefore(path, windowRect);
      paths.push(path);
    }
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]!;
      const series = selectedSeries[i];
      if (!series) {
        path.style.display = "none";
        continue;
      }
      path.style.display = "block";
      const overview = cache.paths[i]!;
      const color = rgbaCss(series.style.color);
      path.setAttribute("d", overview.d);
      path.setAttribute("stroke", options.strokeColor ?? color);
      path.setAttribute("stroke-width", String(options.strokeWidthPx ?? Math.max(1, series.style.lineWidth)));
      path.setAttribute("fill", options.fillColor ?? (overview.envelope ? color : "none"));
      if (overview.envelope && options.fillColor === undefined) path.setAttribute("fill-opacity", "0.35");
      else path.removeAttribute("fill-opacity");
    }

    const viewport = chart.viewport.get();
    if (follow && options.followLive !== false && wasAtRightEdge && domain.xMax > viewport.xMax) {
      const span = viewport.xMax - viewport.xMin;
      chart.viewport.set({ xMin: domain.xMax - span, xMax: domain.xMax }, undefined, { source: "follow", pauseFollow: false });
    }

    const current = chart.viewport.get();
    root.setAttribute("aria-valuenow", String((current.xMin + current.xMax) * 0.5));
    root.setAttribute(
      "aria-valuetext",
      options.formatValueText?.({ xMin: current.xMin, xMax: current.xMax })
        ?? messages.visibleRange(chart.coords.format(current.xMin, "x"), chart.coords.format(current.xMax, "x")),
    );
    wasAtRightEdge = Math.abs(current.xMax - domain.xMax) <= (domain.xMax - domain.xMin) * 0.005;
    const left = dataToX(current.xMin, width - 1);
    const right = dataToX(current.xMax, width - 1);
    const winW = Math.max(1, right - left);
    windowRect.setAttribute("x", String(left));
    windowRect.setAttribute("y", "0");
    windowRect.setAttribute("width", String(winW));
    windowRect.setAttribute("height", String(height));
    leftHandle.setAttribute("x", String(left - handleWidth * 0.5));
    rightHandle.setAttribute("x", String(right - handleWidth * 0.5));
    for (const handle of [leftHandle, rightHandle]) {
      handle.setAttribute("y", "0");
      handle.setAttribute("width", String(handleWidth));
      handle.setAttribute("height", String(height));
    }
    leftHandleHit.setAttribute("x", String(left - handleHitWidth * 0.5));
    rightHandleHit.setAttribute("x", String(right - handleHitWidth * 0.5));
    for (const handle of [leftHandleHit, rightHandleHit]) {
      handle.setAttribute("y", "0");
      handle.setAttribute("width", String(handleHitWidth));
      handle.setAttribute("height", String(height));
    }
  };

  const applyRange = (xMin: number, xMax: number): void => {
    const chart = chartRef;
    if (!chart || !domain) return;
    const full = domain.xMax - domain.xMin;
    const minSpan = full / 10_000;
    if (xMax - xMin < minSpan) return;
    const span = xMax - xMin;
    if (xMin < domain.xMin) {
      xMin = domain.xMin;
      xMax = xMin + span;
    }
    if (xMax > domain.xMax) {
      xMax = domain.xMax;
      xMin = xMax - span;
    }
    chart.viewport.set({ xMin, xMax }, undefined, { source: "user" });
    options.onRangeChange?.({ xMin, xMax });
    render(false);
  };

  return singleChartPlugin("navigator", {
    install(chart: ChartPluginContext) {
      chartRef = chart;
      const releaseStyle = installPluginStyle(chart, "navigator", NAVIGATOR_CSS);
      root = chart.dom.document.createElement("div");
      root.className = options.className ?? "blazeplot-navigator";
      root.style.position = "absolute";
      root.style.left = "0";
      root.style.width = "100%";
      root.style[placement] = `${margin}px`;
      root.style.height = `${height}px`;
      root.style.boxSizing = "border-box";
      root.style.border = "0";
      root.style.zIndex = String(options.zIndex ?? 30);
      root.style.touchAction = "none";
      root.style.outlineOffset = "2px";
      root.tabIndex = 0;
      root.setAttribute("role", "slider");
      root.setAttribute("aria-label", options.label ?? messages.label);

      const releaseSpace = options.reserveSpace === false
        ? null
        : chart.layout.reserve(placement === "top" ? { top: height + margin * 2 } : { bottom: height + margin * 2 });

      overlay = createSvgElement(chart.dom.document, "svg");
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.display = "block";
      windowRect = createSvgElement(chart.dom.document, "rect");
      windowRect.setAttribute("class", "blazeplot-navigator-window");
      leftHandle = createSvgElement(chart.dom.document, "rect");
      rightHandle = createSvgElement(chart.dom.document, "rect");
      leftHandleHit = createSvgElement(chart.dom.document, "rect");
      rightHandleHit = createSvgElement(chart.dom.document, "rect");
      for (const handle of [leftHandle, rightHandle]) {
        handle.style.cursor = "ew-resize";
        handle.style.pointerEvents = "none";
      }
      for (const handle of [leftHandleHit, rightHandleHit]) {
        handle.setAttribute("fill", "transparent");
        handle.style.cursor = "ew-resize";
      }
      windowRect.style.cursor = "grab";
      overlay.appendChild(windowRect);
      overlay.appendChild(leftHandle);
      overlay.appendChild(rightHandle);
      overlay.appendChild(leftHandleHit);
      overlay.appendChild(rightHandleHit);
      root.appendChild(overlay);
      chart.dom.mount("root", root);

      const applyTheme = (): void => {
        if (!root || !windowRect || !leftHandle || !rightHandle) return;
        const windowStroke = options.windowStrokeColor ?? chart.theme.axisColor;
        root.setAttribute("data-blazeplot-screenshot-box", "");
        root.style.background = options.backgroundColor ?? chart.theme.legendBackgroundColor;
        root.style.outline = `1px solid ${options.borderColor ?? chart.theme.legendBorderColor}`;
        windowRect.setAttribute("fill", options.windowFillColor ?? rgbaCss(chart.theme.gridColor));
        windowRect.setAttribute("stroke", windowStroke);
        leftHandle.setAttribute("fill", windowStroke);
        rightHandle.setAttribute("fill", windowStroke);
      };

      const onRender = (): void => render();
      chart.events.subscribe("render", onRender);
      chart.events.subscribe("viewportchange", () => render(false));
      applyTheme();

      const onPointerDown = (event: PointerEvent): void => {
        if (!root || !domain || drag || event.button !== 0 || !chart.dom.claimPointer(event)) return;
        const rect = root.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const viewport = chart.viewport.get();
        const left = dataToX(viewport.xMin, rect.width);
        const right = dataToX(viewport.xMax, rect.width);
        const target = event.target;
        const mode: DragMode = target === leftHandleHit || Math.abs(x - left) <= handleHitWidth * 0.5
          ? "left"
          : target === rightHandleHit || Math.abs(x - right) <= handleHitWidth * 0.5
            ? "right"
            : "pan";
        drag = { pointerId: event.pointerId, mode, startClientX: event.clientX, startXMin: viewport.xMin, startXMax: viewport.xMax };
        if (windowRect) windowRect.style.cursor = mode === "pan" ? "grabbing" : "ew-resize";
        root.setPointerCapture(event.pointerId);
        event.preventDefault();
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId || !root || !domain) return;
        const rect = root.getBoundingClientRect();
        const dx = xToData(event.clientX - drag.startClientX, rect.width) - xToData(0, rect.width);
        if (drag.mode === "left") applyRange(drag.startXMin + dx, drag.startXMax);
        else if (drag.mode === "right") applyRange(drag.startXMin, drag.startXMax + dx);
        else applyRange(drag.startXMin + dx, drag.startXMax + dx);
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (root?.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        if (windowRect) windowRect.style.cursor = "grab";
        drag = null;
      };

      const onDoubleClick = (): void => {
        if (domain) applyRange(domain.xMin, domain.xMax);
      };

      const onKeyDown = (event: KeyboardEvent): void => {
        if (!domain || !chartRef) return;
        const viewport = chartRef.viewport.get();
        const span = viewport.xMax - viewport.xMin;
        const step = span * (event.shiftKey ? 0.25 : 0.1);
        let nextMin = viewport.xMin;
        let nextMax = viewport.xMax;
        let handled = true;
        switch (event.key) {
          case "ArrowLeft":
            nextMin -= step;
            nextMax -= step;
            break;
          case "ArrowRight":
            nextMin += step;
            nextMax += step;
            break;
          case "Home":
            nextMin = domain.xMin;
            nextMax = domain.xMin + span;
            break;
          case "End":
            nextMax = domain.xMax;
            nextMin = domain.xMax - span;
            break;
          default:
            handled = false;
            break;
        }
        if (!handled) return;
        event.preventDefault();
        applyRange(nextMin, nextMax);
      };

      root.addEventListener("pointerdown", onPointerDown);
      root.addEventListener("pointermove", onPointerMove);
      root.addEventListener("pointerup", onPointerUp);
      root.addEventListener("pointercancel", onPointerUp);
      root.addEventListener("dblclick", onDoubleClick);
      root.addEventListener("keydown", onKeyDown);
      render();

      return {
        onThemeChange() {
          applyTheme();
          render();
        },
        dispose() {
          releaseStyle();
          root?.removeEventListener("pointerdown", onPointerDown);
          root?.removeEventListener("pointermove", onPointerMove);
          root?.removeEventListener("pointerup", onPointerUp);
          root?.removeEventListener("pointercancel", onPointerUp);
          root?.removeEventListener("dblclick", onDoubleClick);
          root?.removeEventListener("keydown", onKeyDown);
          releaseSpace?.();
          root = null;
          overlay = null;
          windowRect = null;
          leftHandle = null;
          rightHandle = null;
          leftHandleHit = null;
          rightHandleHit = null;
          paths = [];
          domain = null;
          overviewCache = null;
          drag = null;
          chartRef = null;
        },
      };
    },
    refresh(): void {
      overviewCache = null;
      render();
    },
  });
}
