/**
 * Flame graph drawing: collecting the frames visible in a viewport (with sub-pixel bucketing),
 * laying out device-pixel rectangles for the chart's render surface, drawing labels on a 2D canvas,
 * and the overlay canvas helpers. No chart or plugin lifecycle.
 */
import type { RgbaColor } from "../../core/types.js";
import type { ChartPluginContext } from "../../ui/PluginTypes.js";
import { modelDepthToRenderDepth, renderDepthToModelDepth, upperBound } from "./model.js";
import type { FlameGraphModel, FlameGraphPluginOptions, FlameGraphRenderableFrame } from "./types.js";

export const DEFAULT_FRAME_HEIGHT = 1;
export const DEFAULT_MIN_FRAME_WIDTH_PX = 0.5;
const DEFAULT_MIN_FRAME_HEIGHT_PX = 1;
const DEFAULT_LABEL_MIN_WIDTH_PX = 28;
const DEFAULT_FRAME_GAP_PX = 1;
/** Floats per rectangle handed to a render surface: x, y, width, height, then r, g, b, a. */
const FLOATS_PER_RECT = 8;

export interface VisibleFrame<T> {
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

export interface TinyBucketCache<T> {
  signature: string;
  byDepth: Map<number, Map<number, FlameGraphRenderableFrame<T> | null>>;
}

/** The chart engine's drawing surface for the rectangle layer (WebGL2, Canvas 2D, or the shared context). */
export type RenderSurface = ReturnType<ChartPluginContext["unstable"]["createRenderSurface"]>;

/** Device pixel ratio of the window that owns `canvas` (an iframe or popup may differ from the global). */
function canvasDpr(canvas: HTMLCanvasElement | OffscreenCanvas): number {
  const view = "ownerDocument" in canvas ? canvas.ownerDocument.defaultView : null;
  return Math.max(1, (view ?? globalThis).devicePixelRatio || 1);
}

export function createOverlayCanvas(doc: Document, className: string, zIndex: number): HTMLCanvasElement {
  const canvas = doc.createElement("canvas");
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

export function resizeCanvases(rectCanvas: HTMLCanvasElement, labelCanvas: HTMLCanvasElement): boolean {
  const dpr = canvasDpr(rectCanvas);
  const width = Math.max(1, Math.round(rectCanvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(rectCanvas.clientHeight * dpr));
  const changed = rectCanvas.width !== width || rectCanvas.height !== height;
  for (const canvas of [rectCanvas, labelCanvas]) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
  return changed;
}

export function collectVisibleFrames<T>(
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

export function drawRectangles<T>(
  surface: RenderSurface,
  canvas: HTMLCanvasElement,
  visible: readonly VisibleFrame<T>[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  options: FlameGraphPluginOptions<T>,
  search: string | RegExp | null,
): void {
  surface.beginFrame(canvas.width, canvas.height, canvasDpr(canvas));
  if (visible.length > 0) surface.fillRects(layoutRectangles(canvas, visible, xMin, xMax, yMin, yMax, options, search), visible.length);
  surface.endFrame();
}

/** Device-pixel rectangles (x, y, width, height, r, g, b, a) for each visible frame, with gaps and minimum widths applied. */
function layoutRectangles<T>(
  canvas: HTMLCanvasElement,
  visible: readonly VisibleFrame<T>[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  options: FlameGraphPluginOptions<T>,
  search: string | RegExp | null,
): Float32Array {
  const dpr = canvasDpr(canvas);
  const cssHeight = Math.max(1, canvas.height / dpr);
  const gapPx = options.frameGapPx ?? DEFAULT_FRAME_GAP_PX;
  const minWidthData = ((options.minFrameWidthPx ?? DEFAULT_MIN_FRAME_WIDTH_PX) * (xMax - xMin)) / Math.max(1, canvas.width / dpr);
  const sx = canvas.width / Math.max(1e-30, xMax - xMin);
  const sy = canvas.height / Math.max(1e-30, yMax - yMin);
  const rects = new Float32Array(visible.length * FLOATS_PER_RECT);
  for (let i = 0; i < visible.length; i++) {
    const item = visible[i]!;
    const frame = item.frame;
    const offset = i * FLOATS_PER_RECT;
    const rawWidth = item.x1 - item.x0;
    const padded = rawWidth > 0 && rawWidth < minWidthData;
    const centerX = (item.x0 + item.x1) * 0.5;
    const x0 = padded ? Math.max(xMin, centerX - minWidthData * 0.5) : item.x0;
    const x1 = padded ? Math.min(xMax, centerX + minWidthData * 0.5) : item.x1;
    const rawHeightPx = ((item.y1 - item.y0) / Math.max(1e-30, yMax - yMin)) * cssHeight;
    const gapY = rawHeightPx > gapPx + 1 ? (gapPx / cssHeight) * (yMax - yMin) : 0;
    const y0 = item.y0 + gapY * 0.5;
    const y1 = Math.max(y0, item.y1 - gapY * 0.5);
    // Data space has Y up; device pixels have Y down from the top edge.
    const left = (x0 - xMin) * sx;
    const top = canvas.height - (y1 - yMin) * sy;
    rects[offset] = left;
    rects[offset + 1] = top;
    rects[offset + 2] = (x1 - xMin) * sx - left;
    rects[offset + 3] = canvas.height - (y0 - yMin) * sy - top;
    const color = matchesSearch(frame.name, search)
      ? options.highlightColor ?? [0.9, 0.05, 0.75, 0.95]
      : frame.color ?? colorForName(frame.name);
    rects.set(color, offset + 4);
  }
  return rects;
}

export function drawLabels<T>(
  canvas: HTMLCanvasElement,
  visible: readonly VisibleFrame<T>[],
  model: FlameGraphModel<T>,
  options: FlameGraphPluginOptions<T>,
  search: string | RegExp | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = canvasDpr(canvas);
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
