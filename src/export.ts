import type { Chart, ChartScreenshotOptions, ChartScreenshotPreset } from "./ui/Chart.js";

/** Reusable screenshot option presets for common export backgrounds. */
export const CHART_SCREENSHOT_PRESETS: Record<Exclude<ChartScreenshotPreset, "theme">, ChartScreenshotOptions> = {
  transparent: { preset: "transparent" },
  dark: { preset: "dark" },
  light: { preset: "light" },
};

/** Options for downloading a chart screenshot. */
export interface ChartDownloadOptions extends ChartScreenshotOptions {
  readonly filename?: string;
}

/** Options for copying a chart screenshot to the clipboard. */
export interface ChartClipboardOptions extends ChartScreenshotOptions {
  readonly clipboard?: Clipboard;
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename = "blazeplot.png"): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Capture a chart screenshot, download it, and return the created blob. */
export async function downloadChartScreenshot(chart: Chart, options: ChartDownloadOptions = {}): Promise<Blob> {
  const { filename = defaultScreenshotFilename(options.type), ...screenshotOptions } = options;
  const blob = await chart.screenshot(screenshotOptions);
  downloadBlob(blob, filename);
  return blob;
}

/** Copy an image blob to the Clipboard API. */
export async function copyBlobToClipboard(blob: Blob, clipboard?: Clipboard): Promise<void> {
  if (typeof ClipboardItem === "undefined") {
    throw new Error("ClipboardItem is not available in this browser.");
  }
  const targetClipboard = clipboard ?? defaultClipboard();
  await targetClipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
}

/** Capture a chart screenshot, copy it to the clipboard, and return the blob. */
export async function copyChartScreenshotToClipboard(chart: Chart, options: ChartClipboardOptions = {}): Promise<Blob> {
  const { clipboard, ...screenshotOptions } = options;
  const blob = await chart.screenshot(screenshotOptions);
  await copyBlobToClipboard(blob, clipboard);
  return blob;
}

function defaultClipboard(): Clipboard {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard API is not available in this environment.");
  }
  return navigator.clipboard;
}

function defaultScreenshotFilename(type: string | undefined): string {
  switch (type) {
    case "image/jpeg":
      return "blazeplot.jpg";
    case "image/webp":
      return "blazeplot.webp";
    default:
      return "blazeplot.png";
  }
}
