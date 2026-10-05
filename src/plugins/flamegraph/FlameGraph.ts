import type { ChartPluginContext } from "../../ui/PluginTypes.js";
import { placeFixedWithinViewport, singleChartPlugin } from "../common/OverlayUtils.js";
import { rgbaCss } from "../../ui/theme.js";
import { buildFlameGraphModel, buildStatusChartModel, initialModel, modelDepthFromRenderY, modelDepthToRenderDepth, pickFrame } from "./model.js";
import {
  collectVisibleFrames,
  createOverlayCanvas,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_MIN_FRAME_WIDTH_PX,
  drawLabels,
  drawRectangles,
  resizeCanvases,
} from "./render.js";
import type { RenderSurface, TinyBucketCache, VisibleFrame } from "./render.js";
import type { FlameGraphModel, FlameGraphPick, FlameGraphPlugin, FlameGraphPluginOptions } from "./types.js";



const DEFAULT_TOOLTIP_Z_INDEX = 10_000;

/**
 * Create a plugin that renders flame graph or status chart models.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export function flameGraphPlugin<T = unknown>(options: FlameGraphPluginOptions<T> = {}): FlameGraphPlugin<T> {
  let chart: ChartPluginContext | null = null;
  let model = initialModel(options);
  let search = options.search ?? null;
  let rectCanvas: HTMLCanvasElement | null = null;
  let labelCanvas: HTMLCanvasElement | null = null;
  let tooltip: HTMLDivElement | null = null;
  let hoverHighlightElement: HTMLDivElement | null = null;
  let surface: RenderSurface | null = null;
  let rafId = 0;
  let disposed = false;
  const subscriptionDisposers: Array<() => void> = [];
  let lastHover: FlameGraphPick<T> | null = null;
  let modelVersion = 0;
  let lastRenderSignature = "";
  const tinyBucketCache: TinyBucketCache<T> = { signature: "", byDepth: new Map() };
  const visibleFrameScratch: VisibleFrame<T>[] = [];
  let clickStart: { readonly pointerId: number; readonly x: number; readonly y: number; readonly shiftKey: boolean } | null = null;
  let suppressNextClick = false;

  const plugin: FlameGraphPlugin<T> = {
    install(nextChart) {
      chart = nextChart;
      disposed = false;
      rectCanvas = createOverlayCanvas(nextChart.dom.document, "blazeplot-flamegraph-canvas", options.zIndex ?? 6);
      labelCanvas = createOverlayCanvas(nextChart.dom.document, "blazeplot-flamegraph-labels", (options.zIndex ?? 6) + 1);
      // The rectangle layer follows the chart's engine, so it joins a shared context instead of opening its own.
      surface = nextChart.unstable.createRenderSurface(rectCanvas);
      surface.setLossListener(handleSurfaceState);
      subscriptionDisposers.push(nextChart.dom.mount("plot", rectCanvas), nextChart.dom.mount("plot", labelCanvas));
      if (options.hoverHighlight !== false) {
        hoverHighlightElement = nextChart.dom.document.createElement("div");
        hoverHighlightElement.className = "blazeplot-flamegraph-hover";
        hoverHighlightElement.style.position = "absolute";
        hoverHighlightElement.style.pointerEvents = "none";
        hoverHighlightElement.style.display = "none";
        hoverHighlightElement.style.zIndex = String((options.zIndex ?? 6) + 2);
        hoverHighlightElement.style.background = rgbaCss(options.hoverHighlightColor ?? [1, 0.95, 0.35, 0.48]);
        hoverHighlightElement.style.outline = "1px solid rgba(255,255,255,0.88)";
        subscriptionDisposers.push(nextChart.dom.mount("plot", hoverHighlightElement));
      }
      if (options.tooltip !== false) {
        tooltip = nextChart.dom.document.createElement("div");
        tooltip.className = options.tooltipClassName ?? "blazeplot-flamegraph-tooltip";
        tooltip.style.position = "fixed";
        tooltip.style.left = "0";
        tooltip.style.top = "0";
        tooltip.style.zIndex = String(DEFAULT_TOOLTIP_Z_INDEX);
        tooltip.style.pointerEvents = "none";
        tooltip.style.display = "none";
        tooltip.style.background = nextChart.theme.tooltipBackgroundColor;
        tooltip.style.color = nextChart.theme.tooltipTextColor;
        tooltip.style.font = nextChart.theme.tooltipFont;
        tooltip.style.padding = "8px 10px";
        tooltip.style.whiteSpace = "pre";
        tooltip.setAttribute("role", "tooltip");
        tooltip.setAttribute("aria-hidden", "true");
        subscriptionDisposers.push(nextChart.dom.mount("body", tooltip));
      }

      subscriptionDisposers.push(
        nextChart.dom.listen("plot", "pointerdown", handlePointerDown),
        nextChart.dom.listen("plot", "pointermove", handlePointerMove),
        nextChart.dom.listen("plot", "pointerup", handlePointerUp),
        nextChart.dom.listen("plot", "pointercancel", handlePointerCancel),
        nextChart.dom.listen("plot", "pointerleave", handlePointerLeave),
        nextChart.dom.listen("plot", "click", handleClick),
        nextChart.events.subscribe("render", () => render()),
        nextChart.events.subscribe("viewportchange", scheduleRender),
      );
      if (options.autoFit !== false) plugin.fitToData();
      scheduleRender();
      return {
        dispose: () => plugin.dispose(),
        onResize: scheduleRender,
        onThemeChange: handleThemeChange,
      };
    },
    setModel(nextModel) {
      model = nextModel;
      modelVersion++;
      lastRenderSignature = "";
      if (options.autoFit !== false) plugin.fitToData();
      scheduleRender();
    },
    setFoldedStacks(stacks, buildOptions) {
      plugin.setModel(buildFlameGraphModel<T>(stacks, { ...options.build, ...buildOptions }));
    },
    setStatusSpans(spans, buildOptions) {
      plugin.setModel(buildStatusChartModel<T>(spans, buildOptions));
    },
    setSearch(nextSearch) {
      search = nextSearch;
      scheduleRender();
    },
    fitToData() {
      if (!chart) return;
      const xMin = model.minX;
      const xMax = model.maxX > model.minX ? model.maxX : model.minX + 1;
      chart.viewport.set({ xMin, xMax, yMin: 0, yMax: Math.max(1, model.maxDepth + 1) }, undefined, { source: "fit" });
    },
    pick(clientX, clientY) {
      if (!chart) return null;
      const rect = chart.layout.plotRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const plotX = clientX - rect.left;
      const plotY = clientY - rect.top;
      if (plotX < 0 || plotY < 0 || plotX > rect.width || plotY > rect.height) return null;
      const viewport = chart.viewport.get();
      const dataX = viewport.xMin + (plotX / rect.width) * (viewport.xMax - viewport.xMin);
      const dataY = viewport.yMax - (plotY / rect.height) * (viewport.yMax - viewport.yMin);
      const drawn = pickVisibleFrame(visibleFrameScratch, plotX, plotY);
      const frame = drawn?.frame ?? pickFrame(model, dataX, modelDepthFromRenderY(dataY, model, options.inverted === true));
      if (!frame) return null;
      return {
        frame,
        plotX,
        plotY,
        clientX,
        clientY,
        dataX,
        dataY,
        percent: model.total > 0 ? frame.value / model.total : 0,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== 0) (chart?.dom.view ?? globalThis).cancelAnimationFrame(rafId);
      rafId = 0;
      // Listeners, subscriptions, and mounted elements registered through the plugin context.
      for (const disposeSubscription of subscriptionDisposers.splice(0)) disposeSubscription();
      surface?.dispose();
      surface = null;
      rectCanvas = null;
      labelCanvas = null;
      tooltip = null;
      hoverHighlightElement = null;
      chart = null;
    },
  };

  function scheduleRender(): void {
    if (disposed || rafId !== 0) return;
    rafId = (chart?.dom.view ?? globalThis).requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  }

  function render(): void {
    if (!chart || !rectCanvas || !labelCanvas || !surface || surface.isLost) return;
    const viewport = chart.viewport.get();
    resizeCanvases(rectCanvas, labelCanvas);
    const signature = [
      modelVersion,
      viewport.xMin,
      viewport.xMax,
      viewport.yMin,
      viewport.yMax,
      rectCanvas.width,
      rectCanvas.height,
      rectCanvas.clientWidth,
      rectCanvas.clientHeight,
      String(search),
      options.inverted === true ? 1 : 0,
    ].join("|");
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    const visible = collectVisibleFrames(model, viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax, rectCanvas.clientWidth, rectCanvas.clientHeight, options, tinyBucketCache, `${modelVersion}|${options.minFrameWidthPx ?? DEFAULT_MIN_FRAME_WIDTH_PX}|${viewport.xMax - viewport.xMin}`, visibleFrameScratch);
    drawRectangles(surface, rectCanvas, visible, viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax, options, search);
    drawLabels(labelCanvas, visible, model, options, search);
    updateHoverHighlight(lastHover);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch" || event.button !== 0) {
      clickStart = null;
      return;
    }
    clickStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, shiftKey: event.shiftKey };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (clickStart?.pointerId === event.pointerId && Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 5) {
      suppressNextClick = true;
    }
    const pick = plugin.pick(event.clientX, event.clientY);
    lastHover = pick;
    updateHoverHighlight(pick);
    showTooltip(pick);
    options.onFrameHover?.(pick);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (clickStart?.pointerId === event.pointerId) {
      if (clickStart.shiftKey || event.shiftKey || Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 5) {
        suppressNextClick = true;
      }
      clickStart = null;
    }
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (clickStart?.pointerId === event.pointerId) clickStart = null;
    suppressNextClick = true;
  }

  function handlePointerLeave(): void {
    clickStart = null;
    lastHover = null;
    updateHoverHighlight(null);
    showTooltip(null);
    options.onFrameHover?.(null);
  }

  function handleClick(event: MouseEvent): void {
    if (suppressNextClick || event.shiftKey) {
      suppressNextClick = false;
      return;
    }
    const pick = plugin.pick(event.clientX, event.clientY) ?? lastHover;
    if (!pick) return;
    options.onFrameClick?.(pick, event);
  }

  function handleThemeChange(): void {
    if (tooltip && chart) {
      tooltip.style.background = chart.theme.tooltipBackgroundColor;
      tooltip.style.color = chart.theme.tooltipTextColor;
      tooltip.style.font = chart.theme.tooltipFont;
    }
    scheduleRender();
  }

  function updateHoverHighlight(pick: FlameGraphPick<T> | null): void {
    if (!hoverHighlightElement || !chart) return;
    if (!pick) {
      hoverHighlightElement.style.display = "none";
      return;
    }
    const viewport = chart.viewport.get();
    const { width, height } = chart.layout.plotRect();
    if (width <= 0 || height <= 0 || viewport.xMax <= viewport.xMin || viewport.yMax <= viewport.yMin) {
      hoverHighlightElement.style.display = "none";
      return;
    }
    const y0 = modelDepthToRenderDepth(pick.frame.depth, model, options.inverted === true);
    const y1 = y0 + DEFAULT_FRAME_HEIGHT;
    const left = Math.max(0, ((pick.frame.start - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width);
    const right = Math.min(width, ((pick.frame.end - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width);
    const top = Math.max(0, height - ((y1 - viewport.yMin) / (viewport.yMax - viewport.yMin)) * height);
    const bottom = Math.min(height, height - ((y0 - viewport.yMin) / (viewport.yMax - viewport.yMin)) * height);
    const minWidth = options.minFrameWidthPx ?? DEFAULT_MIN_FRAME_WIDTH_PX;
    const actualWidth = Math.max(minWidth, right - left);
    hoverHighlightElement.style.display = "block";
    hoverHighlightElement.style.left = `${Math.min(width - actualWidth, Math.max(0, left))}px`;
    hoverHighlightElement.style.top = `${top}px`;
    hoverHighlightElement.style.width = `${actualWidth}px`;
    hoverHighlightElement.style.height = `${Math.max(1, bottom - top)}px`;
  }

  function showTooltip(pick: FlameGraphPick<T> | null): void {
    if (!tooltip || !chart) return;
    if (!pick) {
      tooltip.style.display = "none";
      tooltip.setAttribute("aria-hidden", "true");
      return;
    }
    tooltip.textContent = options.tooltipFormatter ? options.tooltipFormatter(pick, model) : defaultTooltip(pick, model);
    tooltip.style.display = "block";
    tooltip.setAttribute("aria-hidden", "false");
    placeFixedWithinViewport(tooltip, pick.clientX, pick.clientY, { offsetX: 12, offsetY: 12 });
  }

  /** A restored context starts blank, so draw the rectangles again; while lost, `render` skips them. */
  function handleSurfaceState(state: "lost" | "restored"): void {
    if (state !== "restored") return;
    lastRenderSignature = "";
    scheduleRender();
  }

  return singleChartPlugin("flameGraph", plugin);
}

function pickVisibleFrame<T>(visible: readonly VisibleFrame<T>[], plotX: number, plotY: number): VisibleFrame<T> | null {
  for (let i = visible.length - 1; i >= 0; i--) {
    const item = visible[i]!;
    if (plotX >= item.plotX0 && plotX <= item.plotX1 && plotY >= item.plotY0 && plotY <= item.plotY1) return item;
  }
  return null;
}

function defaultTooltip<T>(pick: FlameGraphPick<T>, model: FlameGraphModel<T>): string {
  const value = formatNumber(pick.frame.value);
  const percent = (pick.percent * 100).toFixed(2);
  return `${pick.frame.name}\n${value} ${model.countName} (${percent}%)`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
