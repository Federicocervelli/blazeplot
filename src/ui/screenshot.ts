import type { ChartScreenshotOptions } from "./Chart.js";
import type { ChartLayout } from "./ChartLayout.js";
import { rgbaCss } from "./theme.js";
import type { ResolvedChartTheme } from "./theme.js";

export interface ComposeChartScreenshotContext {
  readonly layout: ChartLayout;
  readonly canvas: HTMLCanvasElement;
  readonly theme: ResolvedChartTheme;
}

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

  const background = screenshotBackground(options, rgbaCss(theme.backgroundColor));
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  drawCanvasesForScreenshot(ctx, layout.root, sourceCanvas, plotRect, rootRect, scaleX, scaleY);
  await drawSvgOverlaysForScreenshot(ctx, layout.root, rootRect, scaleX, scaleY);
  drawDomTextForScreenshot(ctx, layout.root, rootRect, scaleX, scaleY);

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

function screenshotBackground(options: ChartScreenshotOptions, themeBackground: string): string | null | undefined {
  if (options.background !== undefined) return options.background;
  if (options.transparent === true || options.preset === "transparent") return null;
  if (options.preset === "dark") return "#0b1020";
  if (options.preset === "light") return "#ffffff";
  return themeBackground;
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

function drawDomTextForScreenshot(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
  rootRect: DOMRect,
  scaleX: number,
  scaleY: number,
): void {
  const elements = root.querySelectorAll<HTMLElement>("div");
  for (const el of elements) {
    const text = el.textContent;
    if (!text || el.children.length > 0) continue;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.font = style.font;
    ctx.fillStyle = style.color;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(text, rect.left - rootRect.left, rect.top - rootRect.top);
    ctx.restore();
  }
}
