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
    const style = getComputedStyle(canvas);
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
    const style = getComputedStyle(source);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const rect = source.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const clone = source.cloneNode(true) as SVGSVGElement;
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
  }
}

/** Attribute that opts a DOM overlay element into background and border painting in screenshots. */
const SCREENSHOT_BOX_ATTRIBUTE = "data-blazeplot-screenshot-box";

function isRenderable(el: Element, style: CSSStyleDeclaration): boolean {
  return !(style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.closest(".blazeplot-visually-hidden"));
}

/** Closest element (starting at `el`) with a CSS transform, up to `root`. */
function transformedAncestor(el: Element, root: Element): { element: Element; matrix: DOMMatrix } | null {
  for (let node: Element | null = el; node && node !== root.parentElement; node = node.parentElement) {
    const transform = getComputedStyle(node).transform;
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
  for (let i = 0; i < value.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getBoundingClientRect();
    const char = value[i]!;
    if (rect.width === 0 && rect.height === 0) {
      // Collapsed whitespace or a line break: it ends the current line when it is a newline.
      if (char === "\n" && current) {
        lines.push({ text: current.text, rect: new DOMRect(current.left, current.top, current.right - current.left, current.bottom - current.top) });
        current = null;
      }
      continue;
    }
    if (current && rect.top >= current.bottom - rect.height / 2) {
      lines.push({ text: current.text, rect: new DOMRect(current.left, current.top, current.right - current.left, current.bottom - current.top) });
      current = null;
    }
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
  if (current) lines.push({ text: current.text, rect: new DOMRect(current.left, current.top, current.right - current.left, current.bottom - current.top) });
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
  const style = getComputedStyle(parent);
  if (!isRenderable(parent, style)) return;
  const raw = node.data;
  if (!raw.trim()) return;

  ctx.save();
  ctx.font = style.font;
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
    ctx.fillText(raw.replace(/\s+/g, " ").trim(), 0, 0);
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
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 1 | 4 /* NodeFilter.SHOW_ELEMENT | SHOW_TEXT */, {
    acceptNode(node: Node): number {
      if (node.nodeType === 1) {
        const tag = (node as Element).tagName.toLowerCase();
        if (tag === "svg" || tag === "canvas" || tag === "script" || tag === "style") return 2; // FILTER_REJECT
        if ((node as Element).classList.contains("blazeplot-visually-hidden")) return 2;
      }
      return 1; // FILTER_ACCEPT
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      if (el.hasAttribute?.(SCREENSHOT_BOX_ATTRIBUTE)) {
        const style = getComputedStyle(el);
        if (isRenderable(el, style) && !transformedAncestor(el, root)) drawBox(ctx, el, style, rootRect, scaleX, scaleY);
      }
    } else if (node.parentElement) {
      drawTextNode(ctx, node as Text, node.parentElement, rootRect, root, scaleX, scaleY);
    }
  }
}
