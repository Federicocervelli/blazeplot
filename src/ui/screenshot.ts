import type { ChartScreenshotOptions } from "./Chart.js";
import type { ChartLayout } from "./ChartLayout.js";
import { rgbaCss } from "./theme.js";
import type { ResolvedChartTheme } from "./theme.js";

/** DOM and theme inputs used to compose a screenshot blob. */
export interface ComposeChartScreenshotContext {
  readonly layout: ChartLayout;
  readonly canvas: HTMLCanvasElement;
  readonly theme: ResolvedChartTheme;
}

/** Compose the chart canvas and DOM overlays into one image blob. */
export async function composeChartScreenshot(
  context: ComposeChartScreenshotContext,
  options: ChartScreenshotOptions = {},
): Promise<Blob> {
  const { layout, canvas: sourceCanvas, theme } = context;
  const rootRect = layout.root.getBoundingClientRect();
  const plotRect = layout.plot.getBoundingClientRect();
  const dpr = Number.isFinite(options.dpr) ? Math.max(1, options.dpr!) : Math.max(1, globalThis.devicePixelRatio || 1);
  const width = Number.isFinite(options.width) ? Math.max(1, Math.round(options.width!)) : Math.max(1, Math.round(rootRect.width * dpr));
  const height = Number.isFinite(options.height) ? Math.max(1, Math.round(options.height!)) : Math.max(1, Math.round(rootRect.height * dpr));
  const scaleX = width / Math.max(1, rootRect.width);
  const scaleY = height / Math.max(1, rootRect.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create a 2D canvas context for screenshot export.");

  const background = options.background === undefined ? rgbaCss(theme.backgroundColor) : options.background;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  drawCanvasesForScreenshot(ctx, layout.root, sourceCanvas, plotRect, rootRect, scaleX, scaleY);
  await drawSvgOverlaysForScreenshot(ctx, layout.root, rootRect, scaleX, scaleY);
  drawDomForScreenshot(ctx, layout.root, rootRect, scaleX, scaleY);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Unable to encode chart screenshot.")),
      options.type ?? "image/png",
      options.quality,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load SVG overlay for screenshot export."));
    image.src = src;
  });
}

function drawCanvasesForScreenshot(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
  fallbackCanvas: HTMLCanvasElement,
  fallbackPlotRect: DOMRect,
  rootRect: DOMRect,
  scaleX: number,
  scaleY: number,
): void {
  const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>("canvas"));
  const sources = canvases.length > 0 ? canvases : [fallbackCanvas];
  for (const canvas of sources) {
    const style = computedStyle(canvas);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const rect = canvas.isConnected ? canvas.getBoundingClientRect() : fallbackPlotRect;
    if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : 1;
    ctx.drawImage(
      canvas,
      (rect.left - rootRect.left) * scaleX,
      (rect.top - rootRect.top) * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
    );
    ctx.restore();
  }
}

async function drawSvgOverlaysForScreenshot(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
  rootRect: DOMRect,
  scaleX: number,
  scaleY: number,
): Promise<void> {
  const svgs = root.querySelectorAll<SVGSVGElement>("svg");
  const serializer = new XMLSerializer();
  for (const source of svgs) {
    const style = computedStyle(source);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const rect = source.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const clone = source.cloneNode(true) as SVGSVGElement;
    // Text is drawn on the 2D canvas afterwards: an SVG rasterized as an <img> cannot see the
    // page fonts, so its text would fall back to the default serif face.
    for (const text of Array.from(clone.querySelectorAll("text"))) text.remove();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    const blob = new Blob([serializer.serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      ctx.save();
      ctx.globalAlpha = Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : 1;
      ctx.drawImage(
        image,
        (rect.left - rootRect.left) * scaleX,
        (rect.top - rootRect.top) * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
      );
      ctx.restore();
    } finally {
      URL.revokeObjectURL(url);
    }
    drawSvgTextForScreenshot(ctx, source, rect, rootRect, scaleX, scaleY);
  }
}


/** Attribute that opts a DOM overlay element into background and border painting in screenshots. */
export const SCREENSHOT_BOX_ATTRIBUTE = "data-blazeplot-screenshot-box";

/** Computed style through the element's own window, so charts in iframes and popups resolve correctly. */
function computedStyle(el: Element): CSSStyleDeclaration {
  return (el.ownerDocument?.defaultView ?? globalThis).getComputedStyle(el);
}

/**
 * Canvas `font` string for a computed style. Some engines leave the `font` shorthand empty on
 * computed styles, which would silently keep the canvas default (10px sans-serif).
 */
export function resolveCanvasFont(style: Pick<CSSStyleDeclaration, "font" | "fontStyle" | "fontWeight" | "fontSize" | "fontFamily">): string {
  if (style.font) return style.font;
  const parts = [style.fontStyle, style.fontWeight, style.fontSize || "16px", style.fontFamily || "sans-serif"];
  return parts.filter((part) => part && part !== "normal").join(" ");
}

function isRenderable(el: Element, style: CSSStyleDeclaration): boolean {
  return !(style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.closest(".blazeplot-visually-hidden"));
}

function isSkippedElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "svg" || tag === "canvas" || tag === "script" || tag === "style" || el.classList.contains("blazeplot-visually-hidden");
}

/** Non-empty text nodes of the chart DOM that should be painted, in document order (SVG/canvas excluded). */
export function collectScreenshotTextNodes(root: HTMLElement): Text[] {
  const result: Text[] = [];
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        if (!isSkippedElement(child as Element)) walk(child);
      } else if (child.nodeType === 3 && (child as Text).data.trim()) {
        result.push(child as Text);
      }
    }
  };
  walk(root);
  return result;
}

/** Closest element (starting at `el`) with a CSS transform, up to `root`. */
function transformedAncestor(el: Element, root: Element): { element: Element; matrix: DOMMatrix } | null {
  for (let node: Element | null = el; node && node !== root.parentElement; node = node.parentElement) {
    const transform = computedStyle(node).transform;
    if (transform && transform !== "none") {
      try {
        return { element: node, matrix: new DOMMatrix(transform) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Split a text node into visual lines using per-character client rects. */
function textLines(node: Text): Array<{ text: string; rect: DOMRect }> {
  const value = node.data;
  const range = node.ownerDocument.createRange();
  const lines: Array<{ text: string; rect: DOMRect }> = [];
  let current: { text: string; left: number; top: number; right: number; bottom: number } | null = null;
  const flush = (): void => {
    if (current) lines.push({ text: current.text, rect: new DOMRect(current.left, current.top, current.right - current.left, current.bottom - current.top) });
    current = null;
  };
  for (let i = 0; i < value.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getBoundingClientRect();
    const char = value[i]!;
    if (rect.width === 0 && rect.height === 0) {
      // Collapsed whitespace or a line break: a newline ends the current line.
      if (char === "\n") flush();
      continue;
    }
    if (current && rect.top >= current.bottom - rect.height / 2) flush();
    if (!current) {
      current = { text: char, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    } else {
      current.text += char;
      current.left = Math.min(current.left, rect.left);
      current.right = Math.max(current.right, rect.right);
      current.top = Math.min(current.top, rect.top);
      current.bottom = Math.max(current.bottom, rect.bottom);
    }
  }
  flush();
  return lines;
}

function drawBox(ctx: CanvasRenderingContext2D, el: HTMLElement, style: CSSStyleDeclaration, rootRect: DOMRect, scaleX: number, scaleY: number): void {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const x = rect.left - rootRect.left;
  const y = rect.top - rootRect.top;
  ctx.save();
  ctx.scale(scaleX, scaleY);
  const background = style.backgroundColor;
  if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") {
    ctx.fillStyle = background;
    ctx.fillRect(x, y, rect.width, rect.height);
  }
  const borderWidth = Number.parseFloat(style.borderTopWidth);
  if (borderWidth > 0 && style.borderTopStyle !== "none") {
    ctx.strokeStyle = style.borderTopColor;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(x + borderWidth / 2, y + borderWidth / 2, rect.width - borderWidth, rect.height - borderWidth);
  }
  ctx.restore();
}

function drawTextNode(ctx: CanvasRenderingContext2D, node: Text, parent: Element, rootRect: DOMRect, root: Element, scaleX: number, scaleY: number): void {
  const style = computedStyle(parent);
  if (!isRenderable(parent, style)) return;

  ctx.save();
  ctx.font = resolveCanvasFont(style);
  ctx.fillStyle = style.color;
  const transformed = transformedAncestor(parent, root);
  if (transformed) {
    // Draw around the center of the transformed box using its rotation/scale, ignoring translation.
    const box = transformed.element.getBoundingClientRect();
    const { a, b, c, d } = transformed.matrix;
    ctx.scale(scaleX, scaleY);
    ctx.translate(box.left + box.width / 2 - rootRect.left, box.top + box.height / 2 - rootRect.top);
    ctx.transform(a, b, c, d, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.data.replace(/\s+/g, " ").trim(), 0, 0);
    ctx.restore();
    return;
  }

  ctx.scale(scaleX, scaleY);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (const line of textLines(node)) {
    if (line.rect.width <= 0 || line.rect.height <= 0) continue;
    ctx.fillText(line.text, line.rect.left - rootRect.left, line.rect.top - rootRect.top);
  }
  ctx.restore();
}

/** Paint SVG `<text>` (annotation labels) with its computed font so it matches the page. */
function drawSvgTextForScreenshot(
  ctx: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  svgRect: DOMRect,
  rootRect: DOMRect,
  scaleX: number,
  scaleY: number,
): void {
  for (const text of svg.querySelectorAll("text")) {
    const value = text.textContent;
    if (!value || !value.trim()) continue;
    const style = computedStyle(text);
    if (!isRenderable(text, style)) continue;
    const anchor = text.getAttribute("text-anchor") ?? style.textAnchor;
    const x = Number.parseFloat(text.getAttribute("x") ?? "0") || 0;
    const y = Number.parseFloat(text.getAttribute("y") ?? "0") || 0;
    const fill = text.getAttribute("fill") ?? style.fill;
    const stroke = text.getAttribute("stroke") ?? style.stroke;
    const strokeWidth = Number.parseFloat(text.getAttribute("stroke-width") ?? style.strokeWidth) || 0;
    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.font = resolveCanvasFont(style);
    ctx.textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
    ctx.textBaseline = text.getAttribute("dominant-baseline") === "hanging" ? "hanging" : "alphabetic";
    const px = svgRect.left - rootRect.left + x;
    const py = svgRect.top - rootRect.top + y;
    if (stroke && stroke !== "none" && strokeWidth > 0) {
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(value, px, py);
    }
    if (fill && fill !== "none") {
      ctx.fillStyle = fill;
      ctx.fillText(value, px, py);
    }
    ctx.restore();
  }
}

/**
 * Paint DOM overlay text (any element, not just leaf divs), rotated text, and the boxes of
 * elements that opt in with `data-blazeplot-screenshot-box`, in document order.
 */
function drawDomForScreenshot(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
  rootRect: DOMRect,
  scaleX: number,
  scaleY: number,
): void {
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        const el = child as HTMLElement;
        if (isSkippedElement(el)) continue;
        if (el.hasAttribute(SCREENSHOT_BOX_ATTRIBUTE)) {
          const style = computedStyle(el);
          if (isRenderable(el, style) && !transformedAncestor(el, root)) drawBox(ctx, el, style, rootRect, scaleX, scaleY);
        }
        walk(el);
      } else if (child.nodeType === 3 && (child as Text).data.trim() && child.parentElement) {
        drawTextNode(ctx, child as Text, child.parentElement, rootRect, root, scaleX, scaleY);
      }
    }
  };
  walk(root);
}
