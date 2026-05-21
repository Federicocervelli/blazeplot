import type { ChartPlugin, ChartPluginContext } from "./Chart.js";
import { placeFixedWithinViewport } from "./OverlayUtils.js";
import { rgbaCss, type RgbaColor } from "./theme.js";

const DEFAULT_FRAME_HEIGHT = 1;
const DEFAULT_MIN_FRAME_WIDTH_PX = 0.5;
const DEFAULT_MIN_FRAME_HEIGHT_PX = 1;
const DEFAULT_LABEL_MIN_WIDTH_PX = 28;
const DEFAULT_FRAME_GAP_PX = 1;
const DEFAULT_TOOLTIP_Z_INDEX = 10_000;
const FLOATS_PER_FRAME = 4;
const VERT_SHADER = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec4 aBounds;
in vec4 aColor;
uniform vec4 uViewport;
out vec4 vColor;
void main() {
  vec2 minPoint = vec2(aBounds.x, aBounds.z);
  vec2 maxPoint = vec2(aBounds.y, aBounds.w);
  vec2 data = mix(minPoint, maxPoint, aCorner);
  float spanX = max(1e-30, uViewport.y - uViewport.x);
  float spanY = max(1e-30, uViewport.w - uViewport.z);
  float clipX = ((data.x - uViewport.x) / spanX) * 2.0 - 1.0;
  float clipY = ((data.y - uViewport.z) / spanY) * 2.0 - 1.0;
  gl_Position = vec4(clipX, clipY, 0.0, 1.0);
  vColor = aColor;
}`;
const FRAG_SHADER = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vColor;
}`;

export interface FlameGraphFrame<T = unknown> {
  readonly name: string;
  readonly start: number;
  readonly value: number;
  readonly depth: number;
  readonly color?: RgbaColor;
  readonly id?: string;
  readonly metadata?: T;
  readonly parent?: number;
}

export interface FlameGraphRenderableFrame<T = unknown> extends FlameGraphFrame<T> {
  readonly end: number;
  readonly index: number;
}

export interface FlameGraphLevelIndex {
  readonly depth: number;
  readonly indices: readonly number[];
  readonly starts: readonly number[];
}

export interface FlameGraphModel<T = unknown> {
  readonly frames: readonly FlameGraphRenderableFrame<T>[];
  readonly levels: readonly FlameGraphLevelIndex[];
  readonly total: number;
  readonly minX: number;
  readonly maxX: number;
  readonly maxDepth: number;
  readonly countName: string;
}

export interface FlameGraphFoldedStack<T = unknown> {
  readonly stack: string | readonly string[];
  readonly value: number;
  readonly delta?: number;
  readonly metadata?: T;
}

export interface FlameGraphStatusSpan<T = unknown> {
  readonly name: string;
  readonly start: number;
  readonly end?: number;
  readonly value?: number;
  readonly depth?: number;
  readonly color?: RgbaColor;
  readonly id?: string;
  readonly metadata?: T;
}

export interface BuildFlameGraphModelOptions {
  readonly separator?: string;
  readonly flameChart?: boolean;
  readonly includeRoot?: boolean;
  readonly rootName?: string;
  readonly countName?: string;
  readonly sort?: boolean | ((a: string, b: string) => number);
}

export interface BuildStatusChartModelOptions {
  readonly countName?: string;
}

export interface FlameGraphPick<T = unknown> {
  readonly frame: FlameGraphRenderableFrame<T>;
  readonly plotX: number;
  readonly plotY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly dataX: number;
  readonly dataY: number;
  readonly percent: number;
}

export interface FlameGraphPluginOptions<T = unknown> {
  readonly model?: FlameGraphModel<T>;
  readonly foldedStacks?: string | readonly FlameGraphFoldedStack<T>[];
  readonly statusSpans?: readonly FlameGraphStatusSpan<T>[];
  readonly build?: BuildFlameGraphModelOptions;
  readonly autoFit?: boolean;
  readonly inverted?: boolean;
  readonly minFrameWidthPx?: number;
  readonly minFrameHeightPx?: number;
  readonly labelMinWidthPx?: number;
  readonly frameGapPx?: number;
  readonly font?: string;
  readonly textColor?: string;
  readonly highlightColor?: RgbaColor;
  readonly hoverHighlight?: boolean;
  readonly hoverHighlightColor?: RgbaColor;
  readonly search?: string | RegExp | null;
  readonly tooltip?: boolean;
  readonly tooltipClassName?: string;
  readonly tooltipFormatter?: (pick: FlameGraphPick<T>, model: FlameGraphModel<T>) => string;
  readonly onFrameHover?: (pick: FlameGraphPick<T> | null) => void;
  readonly onFrameClick?: (pick: FlameGraphPick<T>, event: MouseEvent) => void;
  readonly zIndex?: number;
}

export interface FlameGraphPlugin<T = unknown> extends ChartPlugin {
  setModel(model: FlameGraphModel<T>): void;
  setFoldedStacks(stacks: string | readonly FlameGraphFoldedStack<T>[], options?: BuildFlameGraphModelOptions): void;
  setStatusSpans(spans: readonly FlameGraphStatusSpan<T>[], options?: BuildStatusChartModelOptions): void;
  setSearch(search: string | RegExp | null): void;
  fitToData(): void;
  pick(clientX: number, clientY: number): FlameGraphPick<T> | null;
  dispose(): void;
}

interface TrieNode<T> {
  name: string;
  value: number;
  metadata?: T;
  children: Map<string, TrieNode<T>>;
}

interface VisibleFrame<T> {
  frame: FlameGraphRenderableFrame<T>;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  plotX0: number;
  plotX1: number;
  plotY0: number;
  plotY1: number;
}

interface TinyBucketCache<T> {
  signature: string;
  byDepth: Map<number, Map<number, FlameGraphRenderableFrame<T> | null>>;
}

interface WebGLState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  cornerBuffer: WebGLBuffer;
  boundsBuffer: WebGLBuffer;
  colorBuffer: WebGLBuffer;
  viewportLocation: WebGLUniformLocation;
  capacity: number;
}

export function parseFoldedStacks<T = unknown>(input: string, separator = ";"): FlameGraphFoldedStack<T>[] {
  const stacks: FlameGraphFoldedStack<T>[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(.*)\s+(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?$/.exec(line);
    if (!match) continue;
    const stack = match[1]?.trim();
    const value = Number(match[2]);
    if (!stack || !Number.isFinite(value)) continue;
    const delta = match[3] === undefined ? undefined : Number(match[3]) - value;
    stacks.push({ stack: stack.split(separator), value, delta });
  }
  return stacks;
}

export function buildFlameGraphModel<T = unknown>(
  input: string | readonly FlameGraphFoldedStack<T>[],
  options: BuildFlameGraphModelOptions = {},
): FlameGraphModel<T> {
  const stacks = typeof input === "string" ? parseFoldedStacks<T>(input, options.separator) : input;
  const normalized = stacks
    .map((entry) => ({ ...entry, parts: normalizeStack(entry.stack, options.separator) }))
    .filter((entry) => entry.parts.length > 0 && Number.isFinite(entry.value) && entry.value > 0);

  if (options.flameChart) return buildFlameChartModel(normalized, options);

  const sort = options.sort === false ? undefined : options.sort === true || options.sort === undefined ? defaultSort : options.sort;
  if (sort) normalized.sort((a, b) => compareStacks(a.parts, b.parts, sort));

  const root: TrieNode<T> = { name: options.rootName ?? "all", value: 0, children: new Map<string, TrieNode<T>>() };
  for (const entry of normalized) {
    root.value += entry.value;
    let node = root;
    for (const part of entry.parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, value: 0, children: new Map<string, TrieNode<T>>() };
        node.children.set(part, child);
      }
      child.value += entry.value;
      if (entry.metadata !== undefined) child.metadata = entry.metadata;
      node = child;
    }
  }

  const frames: FlameGraphFrame<T>[] = [];
  const childSort = sort ?? defaultSort;
  const appendNode = (node: TrieNode<T>, start: number, depth: number, parent?: number): number => {
    const index = frames.length;
    const shouldPush = depth >= 0;
    if (shouldPush) {
      frames.push({ name: node.name, start, value: node.value, depth, metadata: node.metadata, parent });
    }
    let childStart = start;
    const frameParent = shouldPush ? index : undefined;
    const children = Array.from(node.children.values()).sort((a, b) => childSort(a.name, b.name));
    for (const child of children) {
      appendNode(child, childStart, depth + 1, frameParent);
      childStart += child.value;
    }
    return index;
  };
  appendNode(root, 0, options.includeRoot ? 0 : -1);
  return finalizeModel(frames, root.value, options.countName ?? "samples");
}

export function buildStatusChartModel<T = unknown>(
  spans: readonly FlameGraphStatusSpan<T>[],
  options: BuildStatusChartModelOptions = {},
): FlameGraphModel<T> {
  const frames: FlameGraphFrame<T>[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  for (const span of spans) {
    const start = span.start;
    const end = span.end ?? (span.value === undefined ? NaN : span.start + span.value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    minX = Math.min(minX, start);
    maxX = Math.max(maxX, end);
    frames.push({
      name: span.name,
      start,
      value: end - start,
      depth: Math.max(0, Math.floor(span.depth ?? 0)),
      color: span.color,
      id: span.id,
      metadata: span.metadata,
    });
  }
  return finalizeModel(frames, Number.isFinite(maxX - minX) ? maxX - minX : 0, options.countName ?? "time");
}

export function flameGraphPlugin<T = unknown>(options: FlameGraphPluginOptions<T> = {}): FlameGraphPlugin<T> {
  let chart: ChartPluginContext | null = null;
  let model = initialModel(options);
  let search = options.search ?? null;
  let rectCanvas: HTMLCanvasElement | null = null;
  let labelCanvas: HTMLCanvasElement | null = null;
  let tooltip: HTMLDivElement | null = null;
  let hoverHighlightElement: HTMLDivElement | null = null;
  let glState: WebGLState | null = null;
  let rafId = 0;
  let resizeObserver: ResizeObserver | null = null;
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
      rectCanvas = createOverlayCanvas("blazeplot-flamegraph-canvas", options.zIndex ?? 6);
      labelCanvas = createOverlayCanvas("blazeplot-flamegraph-labels", (options.zIndex ?? 6) + 1);
      glState = createWebGLState(rectCanvas);
      nextChart.plotElement.appendChild(rectCanvas);
      nextChart.plotElement.appendChild(labelCanvas);
      if (options.hoverHighlight !== false) {
        hoverHighlightElement = document.createElement("div");
        hoverHighlightElement.className = "blazeplot-flamegraph-hover";
        hoverHighlightElement.style.position = "absolute";
        hoverHighlightElement.style.pointerEvents = "none";
        hoverHighlightElement.style.display = "none";
        hoverHighlightElement.style.zIndex = String((options.zIndex ?? 6) + 2);
        hoverHighlightElement.style.background = rgbaCss(options.hoverHighlightColor ?? [1, 0.95, 0.35, 0.48]);
        hoverHighlightElement.style.outline = "1px solid rgba(255,255,255,0.88)";
        nextChart.plotElement.appendChild(hoverHighlightElement);
      }
      if (options.tooltip !== false) {
        tooltip = document.createElement("div");
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
        (nextChart.rootElement.ownerDocument.body ?? nextChart.rootElement).appendChild(tooltip);
      }

      rectCanvas.addEventListener("webglcontextlost", handleContextLost);
      rectCanvas.addEventListener("webglcontextrestored", handleContextRestored);
      nextChart.canvas.addEventListener("pointerdown", handlePointerDown);
      nextChart.canvas.addEventListener("pointermove", handlePointerMove);
      nextChart.canvas.addEventListener("pointerup", handlePointerUp);
      nextChart.canvas.addEventListener("pointercancel", handlePointerCancel);
      nextChart.canvas.addEventListener("pointerleave", handlePointerLeave);
      nextChart.canvas.addEventListener("click", handleClick);
      const unsubRender = nextChart.subscribe("render", () => render());
      const unsubViewport = nextChart.subscribe("viewportchange", scheduleRender);
      const unsubTheme = nextChart.subscribe("themechange", handleThemeChange);
      subscriptionDisposers.push(unsubRender, unsubViewport, unsubTheme);
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleRender);
        resizeObserver.observe(nextChart.plotElement);
      }
      if (options.autoFit !== false) plugin.fitToData();
      scheduleRender();
      return plugin;
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
      chart.setViewport({ xMin, xMax, yMin: 0, yMax: Math.max(1, model.maxDepth + 1) });
    },
    pick(clientX, clientY) {
      if (!chart) return null;
      const rect = chart.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const plotX = clientX - rect.left;
      const plotY = clientY - rect.top;
      if (plotX < 0 || plotY < 0 || plotX > rect.width || plotY > rect.height) return null;
      const viewport = chart.getViewport();
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
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
      resizeObserver?.disconnect();
      resizeObserver = null;
      for (const disposeSubscription of subscriptionDisposers.splice(0)) disposeSubscription();
      if (chart) {
        chart.canvas.removeEventListener("pointerdown", handlePointerDown);
        chart.canvas.removeEventListener("pointermove", handlePointerMove);
        chart.canvas.removeEventListener("pointerup", handlePointerUp);
        chart.canvas.removeEventListener("pointercancel", handlePointerCancel);
        chart.canvas.removeEventListener("pointerleave", handlePointerLeave);
        chart.canvas.removeEventListener("click", handleClick);
      }
      rectCanvas?.removeEventListener("webglcontextlost", handleContextLost);
      rectCanvas?.removeEventListener("webglcontextrestored", handleContextRestored);
      disposeWebGLState(glState);
      glState = null;
      rectCanvas?.remove();
      labelCanvas?.remove();
      tooltip?.remove();
      hoverHighlightElement?.remove();
      rectCanvas = null;
      labelCanvas = null;
      tooltip = null;
      hoverHighlightElement = null;
      chart = null;
    },
  };

  function scheduleRender(): void {
    if (disposed || rafId !== 0) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  }

  function render(): void {
    if (!chart || !rectCanvas || !labelCanvas || !glState) return;
    const viewport = chart.getViewport();
    const resized = resizeCanvases(rectCanvas, labelCanvas);
    if (resized) glState.gl.viewport(0, 0, rectCanvas.width, rectCanvas.height);
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
    drawRectangles(glState, visible, viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax, options, search);
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
    const viewport = chart.getViewport();
    const width = chart.canvas.clientWidth;
    const height = chart.canvas.clientHeight;
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

  function handleContextLost(event: Event): void {
    event.preventDefault();
    disposeWebGLState(glState);
    glState = null;
  }

  function handleContextRestored(): void {
    if (!rectCanvas) return;
    glState = createWebGLState(rectCanvas);
    scheduleRender();
  }

  return plugin;
}

function pickVisibleFrame<T>(visible: readonly VisibleFrame<T>[], plotX: number, plotY: number): VisibleFrame<T> | null {
  for (let i = visible.length - 1; i >= 0; i--) {
    const item = visible[i]!;
    if (plotX >= item.plotX0 && plotX <= item.plotX1 && plotY >= item.plotY0 && plotY <= item.plotY1) return item;
  }
  return null;
}

export function pickFrame<T>(model: FlameGraphModel<T>, dataX: number, dataY: number): FlameGraphRenderableFrame<T> | null {
  const depth = Math.floor(dataY);
  const level = model.levels[depth];
  if (!level || !Number.isFinite(dataX)) return null;
  const insertion = upperBound(level.starts, dataX);
  const candidates = [insertion - 1, insertion];
  for (const position of candidates) {
    if (position < 0 || position >= level.indices.length) continue;
    const frame = model.frames[level.indices[position]!];
    if (frame && dataX >= frame.start && dataX <= frame.end) return frame;
  }
  return null;
}

function initialModel<T>(options: FlameGraphPluginOptions<T>): FlameGraphModel<T> {
  if (options.model) return options.model;
  if (options.statusSpans) return buildStatusChartModel(options.statusSpans);
  if (options.foldedStacks) return buildFlameGraphModel(options.foldedStacks, options.build);
  return finalizeModel([], 0, options.build?.countName ?? "samples");
}

function normalizeStack(stack: string | readonly string[], separator = ";"): string[] {
  const parts = typeof stack === "string" ? stack.split(separator) : Array.from(stack);
  return parts.map((part) => String(part).trim()).filter(Boolean);
}

function buildFlameChartModel<T>(
  entries: readonly (FlameGraphFoldedStack<T> & { readonly parts: readonly string[] })[],
  options: BuildFlameGraphModelOptions,
): FlameGraphModel<T> {
  const frames: FlameGraphFrame<T>[] = [];
  let x = 0;
  for (const entry of entries) {
    let parent: number | undefined;
    for (let depth = 0; depth < entry.parts.length; depth++) {
      const index = frames.length;
      frames.push({ name: entry.parts[depth]!, start: x, value: entry.value, depth, metadata: entry.metadata, parent });
      parent = index;
    }
    x += entry.value;
  }
  return finalizeModel(frames, x, options.countName ?? "samples");
}

function finalizeModel<T>(frames: readonly FlameGraphFrame<T>[], total: number, countName: string): FlameGraphModel<T> {
  const renderable = frames
    .filter((frame) => Number.isFinite(frame.start) && Number.isFinite(frame.value) && Number.isFinite(frame.depth) && frame.value > 0 && frame.depth >= 0)
    .map((frame, index): FlameGraphRenderableFrame<T> => ({ ...frame, index, end: frame.start + frame.value }));

  const levelMap = new Map<number, FlameGraphRenderableFrame<T>[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  let maxDepth = 0;
  for (const frame of renderable) {
    const level = levelMap.get(frame.depth) ?? [];
    level.push(frame);
    levelMap.set(frame.depth, level);
    minX = Math.min(minX, frame.start);
    maxX = Math.max(maxX, frame.end);
    maxDepth = Math.max(maxDepth, frame.depth);
  }

  const levels: FlameGraphLevelIndex[] = [];
  for (const depth of Array.from(levelMap.keys()).sort((a, b) => a - b)) {
    const levelFrames = levelMap.get(depth)!.sort((a, b) => a.start - b.start || a.end - b.end);
    levels[depth] = {
      depth,
      indices: levelFrames.map((frame) => frame.index),
      starts: levelFrames.map((frame) => frame.start),
    };
  }

  return {
    frames: renderable,
    levels,
    total: Number.isFinite(total) ? total : 0,
    minX: Number.isFinite(minX) ? minX : 0,
    maxX: Number.isFinite(maxX) ? maxX : 1,
    maxDepth,
    countName,
  };
}

function compareStacks(a: readonly string[], b: readonly string[], sort: (a: string, b: string) => number): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const result = sort(a[i]!, b[i]!);
    if (result !== 0) return result;
  }
  return a.length - b.length;
}

function defaultSort(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function createOverlayCanvas(className: string, zIndex: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = String(zIndex);
  return canvas;
}

function createWebGLState(canvas: HTMLCanvasElement): WebGLState {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("Flame graph plugin requires WebGL2.");
  const program = createProgram(gl, VERT_SHADER, FRAG_SHADER);
  const vao = requireGlObject(gl.createVertexArray(), "vertex array");
  const cornerBuffer = requireGlObject(gl.createBuffer(), "corner buffer");
  const boundsBuffer = requireGlObject(gl.createBuffer(), "bounds buffer");
  const colorBuffer = requireGlObject(gl.createBuffer(), "color buffer");
  const viewportLocation = requireGlObject(gl.getUniformLocation(program, "uViewport"), "uViewport uniform");
  gl.bindVertexArray(vao);
  bindStaticCorners(gl, program, cornerBuffer);
  bindInstancedAttribute(gl, program, boundsBuffer, "aBounds", 4);
  bindInstancedAttribute(gl, program, colorBuffer, "aColor", 4);
  gl.bindVertexArray(null);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return { gl, program, vao, cornerBuffer, boundsBuffer, colorBuffer, viewportLocation, capacity: 0 };
}

function createProgram(gl: WebGL2RenderingContext, vertSource: string, fragSource: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);
  const program = requireGlObject(gl.createProgram(), "program");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown error";
    gl.deleteProgram(program);
    throw new Error(`Unable to link flame graph shader program: ${log}`);
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = requireGlObject(gl.createShader(type), "shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown error";
    gl.deleteShader(shader);
    throw new Error(`Unable to compile flame graph shader: ${log}`);
  }
  return shader;
}

function requireGlObject<T>(value: T | null, label: string): T {
  if (!value) throw new Error(`Unable to create flame graph ${label}.`);
  return value;
}

function bindStaticCorners(gl: WebGL2RenderingContext, program: WebGLProgram, buffer: WebGLBuffer): void {
  const location = gl.getAttribLocation(program, "aCorner");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function bindInstancedAttribute(gl: WebGL2RenderingContext, program: WebGLProgram, buffer: WebGLBuffer, name: string, size: number): void {
  const location = gl.getAttribLocation(program, name);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(location, 1);
}

function disposeWebGLState(state: WebGLState | null): void {
  if (!state) return;
  const { gl } = state;
  gl.deleteBuffer(state.cornerBuffer);
  gl.deleteBuffer(state.boundsBuffer);
  gl.deleteBuffer(state.colorBuffer);
  gl.deleteVertexArray(state.vao);
  gl.deleteProgram(state.program);
}

function resizeCanvases(rectCanvas: HTMLCanvasElement, labelCanvas: HTMLCanvasElement): boolean {
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rectCanvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(rectCanvas.clientHeight * dpr));
  const changed = rectCanvas.width !== width || rectCanvas.height !== height;
  for (const canvas of [rectCanvas, labelCanvas]) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
  return changed;
}

function collectVisibleFrames<T>(
  model: FlameGraphModel<T>,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  widthPx: number,
  heightPx: number,
  options: FlameGraphPluginOptions<T>,
  tinyBucketCache?: TinyBucketCache<T>,
  tinyBucketCacheSignature?: string,
  reusableVisible?: VisibleFrame<T>[],
): VisibleFrame<T>[] {
  if (widthPx <= 0 || heightPx <= 0 || xMax <= xMin || yMax <= yMin) return [];
  const minFrameWidthPx = options.minFrameWidthPx ?? DEFAULT_MIN_FRAME_WIDTH_PX;
  const visible = reusableVisible ?? [];
  let visibleCount = 0;
  if (tinyBucketCache && tinyBucketCache.signature !== tinyBucketCacheSignature) {
    tinyBucketCache.signature = tinyBucketCacheSignature ?? "";
    tinyBucketCache.byDepth.clear();
  }
  const modelDepthA = renderDepthToModelDepth(yMin, model, options.inverted === true);
  const modelDepthB = renderDepthToModelDepth(yMax, model, options.inverted === true);
  const startDepth = Math.max(0, Math.floor(Math.min(modelDepthA, modelDepthB)) - 1);
  const endDepth = Math.min(model.maxDepth, Math.ceil(Math.max(modelDepthA, modelDepthB)) + 1);
  const spanX = xMax - xMin;
  const spanY = yMax - yMin;
  const pxPerX = widthPx / spanX;
  const pxPerY = heightPx / spanY;
  const minFrameHeightPx = options.minFrameHeightPx ?? DEFAULT_MIN_FRAME_HEIGHT_PX;
  const minFrameHeightY = minFrameHeightPx > 0 ? minFrameHeightPx / pxPerY : 0;
  const tinyBucketWidthX = minFrameWidthPx > 0 ? minFrameWidthPx / pxPerX : 0;
  const tinyBucketOriginX = model.minX;
  const pushFrame = (frame: FlameGraphRenderableFrame<T>, drawX0: number, drawX1: number): void => {
    const rawY0 = modelDepthToRenderDepth(frame.depth, model, options.inverted === true);
    const rawY1 = rawY0 + DEFAULT_FRAME_HEIGHT;
    if (rawY1 < yMin || rawY0 > yMax) return;
    const rawHeightPx = (rawY1 - rawY0) * pxPerY;
    const paddedY = rawHeightPx > 0 && rawHeightPx < minFrameHeightPx && minFrameHeightY > 0;
    const centerY = (rawY0 + rawY1) * 0.5;
    const y0 = paddedY ? centerY - minFrameHeightY * 0.5 : rawY0;
    const y1 = paddedY ? centerY + minFrameHeightY * 0.5 : rawY1;
    const clippedDrawX0 = Math.max(xMin, drawX0);
    const clippedDrawX1 = Math.min(xMax, drawX1);
    const item = visible[visibleCount] ?? ({} as VisibleFrame<T>);
    item.frame = frame;
    item.x0 = clippedDrawX0;
    item.x1 = clippedDrawX1;
    item.y0 = y0;
    item.y1 = y1;
    item.plotX0 = ((clippedDrawX0 - xMin) / spanX) * widthPx;
    item.plotX1 = ((clippedDrawX1 - xMin) / spanX) * widthPx;
    item.plotY0 = heightPx - ((y1 - yMin) / spanY) * heightPx;
    item.plotY1 = heightPx - ((y0 - yMin) / spanY) * heightPx;
    visible[visibleCount] = item;
    visibleCount++;
  };

  for (let depth = startDepth; depth <= endDepth; depth++) {
    const level = model.levels[depth];
    if (!level) continue;
    const firstPosition = Math.max(0, upperBound(level.starts, xMin) - 1);
    const endPosition = Math.min(level.indices.length, upperBound(level.starts, xMax));
    const visibleCount = Math.max(0, endPosition - firstPosition);
    const bucketStart = tinyBucketWidthX > 0 ? Math.floor((xMin - tinyBucketOriginX) / tinyBucketWidthX) : 0;
    const bucketEnd = tinyBucketWidthX > 0 ? Math.ceil((xMax - tinyBucketOriginX) / tinyBucketWidthX) : 0;
    const bucketCount = Math.max(0, bucketEnd - bucketStart);

    if (tinyBucketWidthX > 0 && bucketCount > 0 && visibleCount > bucketCount * 2) {
      let depthCache = tinyBucketCache?.byDepth.get(depth);
      if (tinyBucketCache && !depthCache) {
        depthCache = new Map();
        tinyBucketCache.byDepth.set(depth, depthCache);
      }
      for (let bucket = bucketStart; bucket < bucketEnd; bucket++) {
        const drawX0 = tinyBucketOriginX + bucket * tinyBucketWidthX;
        const drawX1 = drawX0 + tinyBucketWidthX;
        if (drawX1 < xMin || drawX0 > xMax) continue;

        let frame = depthCache?.get(bucket);
        if (frame === undefined) {
          const positionBeforeBucket = upperBound(level.starts, drawX0) - 1;
          frame = positionBeforeBucket >= 0 ? model.frames[level.indices[positionBeforeBucket]!] ?? null : null;
          if (!frame || frame.end < drawX0) {
            const nextPosition = positionBeforeBucket + 1;
            frame = nextPosition < level.indices.length ? model.frames[level.indices[nextPosition]!] ?? null : null;
          }
          if (!frame || frame.start > drawX1 || frame.end < drawX0) frame = null;
          depthCache?.set(bucket, frame);
        }
        if (!frame) continue;
        pushFrame(frame, drawX0, drawX1);
      }
      continue;
    }

    let position = firstPosition;
    let lastTinyBucket = -1;
    while (position < level.indices.length) {
      const frame = model.frames[level.indices[position]!];
      if (!frame) break;
      if (frame.start > xMax) break;
      position++;
      if (frame.end < xMin) continue;
      const clippedStart = Math.max(frame.start, xMin);
      const clippedEnd = Math.min(frame.end, xMax);
      const visibleWidthPx = (clippedEnd - clippedStart) * pxPerX;
      let drawX0 = frame.start;
      let drawX1 = frame.end;
      if (visibleWidthPx < minFrameWidthPx && tinyBucketWidthX > 0) {
        const centerX = (clippedStart + clippedEnd) * 0.5;
        // Aggregate sub-pixel frames into buckets fixed in data space, not screen
        // space. Viewport-anchored pixel buckets make stationary columns change
        // color during pan as neighboring frames take over the same screen bin.
        const bucket = Math.floor((centerX - tinyBucketOriginX) / tinyBucketWidthX);
        if (bucket === lastTinyBucket) continue;
        lastTinyBucket = bucket;
        drawX0 = tinyBucketOriginX + bucket * tinyBucketWidthX;
        drawX1 = drawX0 + tinyBucketWidthX;
      }
      pushFrame(frame, drawX0, drawX1);
    }
  }
  visible.length = visibleCount;
  return visible;
}

function drawRectangles<T>(
  state: WebGLState,
  visible: readonly VisibleFrame<T>[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  options: FlameGraphPluginOptions<T>,
  search: string | RegExp | null,
): void {
  const { gl } = state;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (visible.length === 0) return;
  const cssHeight = Math.max(1, gl.canvas.height / Math.max(1, globalThis.devicePixelRatio || 1));
  const gapPx = options.frameGapPx ?? DEFAULT_FRAME_GAP_PX;
  const minWidthData = ((options.minFrameWidthPx ?? DEFAULT_MIN_FRAME_WIDTH_PX) * (xMax - xMin)) / Math.max(1, gl.canvas.width / Math.max(1, globalThis.devicePixelRatio || 1));
  const bounds = new Float32Array(visible.length * FLOATS_PER_FRAME);
  const colors = new Float32Array(visible.length * FLOATS_PER_FRAME);
  for (let i = 0; i < visible.length; i++) {
    const item = visible[i]!;
    const frame = item.frame;
    const offset = i * FLOATS_PER_FRAME;
    const rawWidth = item.x1 - item.x0;
    const padded = rawWidth > 0 && rawWidth < minWidthData;
    const centerX = (item.x0 + item.x1) * 0.5;
    bounds[offset] = padded ? Math.max(xMin, centerX - minWidthData * 0.5) : item.x0;
    bounds[offset + 1] = padded ? Math.min(xMax, centerX + minWidthData * 0.5) : item.x1;
    const rawHeightPx = ((item.y1 - item.y0) / Math.max(1e-30, yMax - yMin)) * cssHeight;
    const gapY = rawHeightPx > gapPx + 1 ? (gapPx / cssHeight) * (yMax - yMin) : 0;
    bounds[offset + 2] = item.y0 + gapY * 0.5;
    bounds[offset + 3] = Math.max(item.y0 + gapY * 0.5, item.y1 - gapY * 0.5);
    const color = matchesSearch(frame.name, search)
      ? options.highlightColor ?? [0.9, 0.05, 0.75, 0.95]
      : frame.color ?? colorForName(frame.name);
    colors.set(color, offset);
  }
  gl.useProgram(state.program);
  gl.bindVertexArray(state.vao);
  gl.uniform4f(state.viewportLocation, xMin, xMax, yMin, yMax);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.boundsBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, bounds, gl.STREAM_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STREAM_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, visible.length);
  gl.bindVertexArray(null);
}

function drawLabels<T>(
  canvas: HTMLCanvasElement,
  visible: readonly VisibleFrame<T>[],
  model: FlameGraphModel<T>,
  options: FlameGraphPluginOptions<T>,
  search: string | RegExp | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font = options.font ?? "12px Verdana, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = options.textColor ?? "rgba(15, 23, 42, 0.92)";
  const labelMinWidth = options.labelMinWidthPx ?? DEFAULT_LABEL_MIN_WIDTH_PX;
  for (const item of visible) {
    const width = item.plotX1 - item.plotX0;
    const height = item.plotY1 - item.plotY0;
    if (width < labelMinWidth || height < 8) continue;
    const label = trimLabel(ctx, item.frame.name, Math.max(0, width - 6));
    if (!label) continue;
    ctx.fillStyle = matchesSearch(item.frame.name, search)
      ? "#ffffff"
      : options.textColor ?? labelTextColor(item.frame.color ?? colorForName(item.frame.name));
    ctx.fillText(label, item.plotX0 + 3, (item.plotY0 + item.plotY1) / 2);
  }
  ctx.restore();
  void model;
}

function trimLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  if (maxWidth < ctx.measureText("…").width) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "";
}

const generatedColorCache = new Map<string, RgbaColor>();

function colorForName(name: string): RgbaColor {
  const cached = generatedColorCache.get(name);
  if (cached) return cached;
  const hash = hashString(name);
  const jitter = (hash & 0xff) / 255;
  const green = 0.33 + (((hash >>> 8) & 0xff) / 255) * 0.38;
  const blue = 0.05 + (((hash >>> 16) & 0xff) / 255) * 0.10;
  const color: RgbaColor = [0.78 + jitter * 0.20, green, blue, 0.92];
  generatedColorCache.set(name, color);
  return color;
}

function labelTextColor(color: RgbaColor): string {
  const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  return luminance > 0.55 ? "rgba(15, 23, 42, 0.92)" : "rgba(248, 250, 252, 0.95)";
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function matchesSearch(name: string, search: string | RegExp | null): boolean {
  if (!search) return false;
  if (typeof search === "string") return search.length > 0 && name.includes(search);
  search.lastIndex = 0;
  return search.test(name);
}

function modelDepthToRenderDepth(depth: number, model: FlameGraphModel<unknown>, inverted: boolean): number {
  return inverted ? model.maxDepth - depth : depth;
}

function renderDepthToModelDepth(depth: number, model: FlameGraphModel<unknown>, inverted: boolean): number {
  return inverted ? model.maxDepth - depth : depth;
}

function modelDepthFromRenderY(y: number, model: FlameGraphModel<unknown>, inverted: boolean): number {
  return inverted ? model.maxDepth - Math.floor(y) : Math.floor(y);
}

function upperBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function defaultTooltip<T>(pick: FlameGraphPick<T>, model: FlameGraphModel<T>): string {
  const value = formatNumber(pick.frame.value);
  const percent = (pick.percent * 100).toFixed(2);
  return `${pick.frame.name}\n${value} ${model.countName} (${percent}%)`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
