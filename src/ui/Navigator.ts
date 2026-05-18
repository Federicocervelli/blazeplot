import type { SeriesStore } from "../core/SeriesStore.js";
import type { Chart, ChartPlugin } from "./Chart.js";

export interface NavigatorPluginOptions {
  readonly height?: number;
  readonly placement?: "bottom" | "top";
  readonly series?: SeriesStore | readonly SeriesStore[];
  readonly maxSamplesPerSeries?: number;
  readonly followLive?: boolean;
  readonly className?: string;
  readonly background?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly fill?: string;
  readonly windowFill?: string;
  readonly windowStroke?: string;
  readonly handleWidth?: number;
  readonly zIndex?: number;
  readonly onRangeChange?: (range: { readonly xMin: number; readonly xMax: number }) => void;
}

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
  readonly mode: DragMode;
  readonly startClientX: number;
  readonly startXMin: number;
  readonly startXMax: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function seriesList(chart: Chart, option: NavigatorPluginOptions["series"]): SeriesStore[] {
  if (option) return Array.isArray(option) ? [...(option as readonly SeriesStore[])] : [option as SeriesStore];
  return chart.getSeriesState().filter((state) => state.visible).map((state) => state.series);
}

function computeDomain(series: readonly SeriesStore[], maxSamplesPerSeries: number): Domain | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const s of series) {
    if (s.length <= 0) continue;
    const first = s.sampleAt(0);
    const last = s.sampleAt(s.length - 1);
    if (!first || !last) continue;
    xMin = Math.min(xMin, first.x, last.x);
    xMax = Math.max(xMax, first.x, last.x);
    const stride = Math.max(1, Math.ceil(s.length / maxSamplesPerSeries));
    for (let i = 0; i < s.length; i += stride) {
      const sample = s.sampleAt(i);
      if (!sample) continue;
      yMin = Math.min(yMin, sample.y);
      yMax = Math.max(yMax, sample.y);
    }
  }

  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin || !Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
  if (yMax <= yMin) {
    yMin -= 1;
    yMax += 1;
  }
  return { xMin, xMax, yMin, yMax };
}

function pathForSeries(series: SeriesStore, domain: Domain, width: number, height: number, maxSamples: number): string {
  if (series.length <= 0 || width <= 0 || height <= 0) return "";
  const stride = Math.max(1, Math.ceil(series.length / maxSamples));
  const xRange = domain.xMax - domain.xMin;
  const yRange = domain.yMax - domain.yMin;
  let path = "";
  for (let i = 0; i < series.length; i += stride) {
    const sample = series.sampleAt(i);
    if (!sample) continue;
    const x = ((sample.x - domain.xMin) / xRange) * width;
    const y = height - ((sample.y - domain.yMin) / yRange) * height;
    path += path ? ` L ${x.toFixed(2)} ${y.toFixed(2)}` : `M ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return path;
}

export function navigatorPlugin(options: NavigatorPluginOptions = {}): NavigatorPlugin {
  const height = Math.max(24, options.height ?? 56);
  const maxSamplesPerSeries = Math.max(16, options.maxSamplesPerSeries ?? 512);
  const handleWidth = Math.max(4, options.handleWidth ?? 8);
  let chartRef: Chart | null = null;
  let root: HTMLDivElement | null = null;
  let overlay: SVGSVGElement | null = null;
  let windowRect: SVGRectElement | null = null;
  let leftHandle: SVGRectElement | null = null;
  let rightHandle: SVGRectElement | null = null;
  let paths: SVGPathElement[] = [];
  let domain: Domain | null = null;
  let drag: DragState | null = null;
  let wasAtRightEdge = true;

  const dataToX = (x: number, width: number): number => domain ? ((x - domain.xMin) / (domain.xMax - domain.xMin)) * width : 0;
  const xToData = (x: number, width: number): number => domain ? domain.xMin + (x / width) * (domain.xMax - domain.xMin) : 0;

  const render = (): void => {
    const chart = chartRef;
    if (!chart || !root || !overlay || !windowRect || !leftHandle || !rightHandle) return;
    const selectedSeries = seriesList(chart, options.series);
    domain = computeDomain(selectedSeries, maxSamplesPerSeries);
    if (!domain) {
      root.style.display = "none";
      return;
    }

    root.style.display = "block";
    const width = Math.max(1, root.clientWidth);
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);

    while (paths.length < selectedSeries.length) {
      const path = svg("path");
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
      path.setAttribute("d", pathForSeries(series, domain, width, height, maxSamplesPerSeries));
      path.setAttribute("stroke", options.stroke ?? "rgba(125, 211, 252, 0.9)");
      path.setAttribute("stroke-width", String(options.strokeWidth ?? 1));
      path.setAttribute("fill", options.fill ?? "none");
    }

    const viewport = chart.getViewport();
    if (options.followLive !== false && wasAtRightEdge && domain.xMax > viewport.xMax) {
      const span = viewport.xMax - viewport.xMin;
      chart.setViewport({ xMin: domain.xMax - span, xMax: domain.xMax });
    }

    const current = chart.getViewport();
    wasAtRightEdge = Math.abs(current.xMax - domain.xMax) <= (domain.xMax - domain.xMin) * 0.005;
    const left = dataToX(current.xMin, width);
    const right = dataToX(current.xMax, width);
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
    chart.setViewport({ xMin, xMax });
    options.onRangeChange?.({ xMin, xMax });
    render();
  };

  return {
    install(chart: Chart) {
      chartRef = chart;
      root = document.createElement("div");
      root.className = options.className ?? "blazeplot-navigator";
      root.style.position = "absolute";
      root.style.left = "8px";
      root.style.right = "8px";
      root.style[options.placement === "top" ? "top" : "bottom"] = "8px";
      root.style.height = `${height}px`;
      root.style.background = options.background ?? "rgb(15 23 42 / 0.78)";
      root.style.border = "1px solid rgb(148 163 184 / 0.3)";
      root.style.zIndex = String(options.zIndex ?? 30);
      root.style.touchAction = "none";

      overlay = svg("svg");
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.display = "block";
      windowRect = svg("rect");
      windowRect.setAttribute("fill", options.windowFill ?? "rgba(59, 130, 246, 0.20)");
      windowRect.setAttribute("stroke", options.windowStroke ?? "rgba(191, 219, 254, 0.95)");
      leftHandle = svg("rect");
      rightHandle = svg("rect");
      for (const handle of [leftHandle, rightHandle]) {
        handle.setAttribute("fill", options.windowStroke ?? "rgba(191, 219, 254, 0.95)");
        handle.style.cursor = "ew-resize";
      }
      overlay.appendChild(windowRect);
      overlay.appendChild(leftHandle);
      overlay.appendChild(rightHandle);
      root.appendChild(overlay);
      chart.rootElement.appendChild(root);

      const onRender = (): void => render();
      const unsubscribeRender = chart.subscribe("render", onRender);
      const unsubscribeViewport = chart.subscribe("viewportchange", onRender);

      const onPointerDown = (event: PointerEvent): void => {
        if (!root || !domain || event.button !== 0) return;
        const rect = root.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const viewport = chart.getViewport();
        const left = dataToX(viewport.xMin, rect.width);
        const right = dataToX(viewport.xMax, rect.width);
        const mode: DragMode = Math.abs(x - left) <= handleWidth ? "left" : Math.abs(x - right) <= handleWidth ? "right" : x >= left && x <= right ? "pan" : "pan";
        drag = { mode, startClientX: event.clientX, startXMin: viewport.xMin, startXMax: viewport.xMax };
        root.setPointerCapture(event.pointerId);
        event.preventDefault();
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!drag || !root || !domain) return;
        const rect = root.getBoundingClientRect();
        const dx = xToData(event.clientX - drag.startClientX, rect.width) - xToData(0, rect.width);
        if (drag.mode === "left") applyRange(drag.startXMin + dx, drag.startXMax);
        else if (drag.mode === "right") applyRange(drag.startXMin, drag.startXMax + dx);
        else applyRange(drag.startXMin + dx, drag.startXMax + dx);
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (root?.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        drag = null;
      };

      const onDoubleClick = (): void => {
        if (domain) applyRange(domain.xMin, domain.xMax);
      };

      root.addEventListener("pointerdown", onPointerDown);
      root.addEventListener("pointermove", onPointerMove);
      root.addEventListener("pointerup", onPointerUp);
      root.addEventListener("pointercancel", onPointerUp);
      root.addEventListener("dblclick", onDoubleClick);
      render();

      return () => {
        unsubscribeRender();
        unsubscribeViewport();
        root?.removeEventListener("pointerdown", onPointerDown);
        root?.removeEventListener("pointermove", onPointerMove);
        root?.removeEventListener("pointerup", onPointerUp);
        root?.removeEventListener("pointercancel", onPointerUp);
        root?.removeEventListener("dblclick", onDoubleClick);
        root?.remove();
        root = null;
        overlay = null;
        windowRect = null;
        leftHandle = null;
        rightHandle = null;
        paths = [];
        domain = null;
        drag = null;
        chartRef = null;
      };
    },
    refresh(): void {
      render();
    },
  };
}
