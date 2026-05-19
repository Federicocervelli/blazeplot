import type { Chart, ChartScreenshotOptions, ChartScreenshotPreset } from "./ui/Chart.js";
export * from "./data.js";

export const CHART_SCREENSHOT_PRESETS: Record<Exclude<ChartScreenshotPreset, "theme">, ChartScreenshotOptions> = {
  transparent: { preset: "transparent" },
  dark: { preset: "dark" },
  light: { preset: "light" },
};

export interface ChartDownloadOptions extends ChartScreenshotOptions {
  readonly filename?: string;
}

export interface ChartClipboardOptions extends ChartScreenshotOptions {
  readonly clipboard?: Clipboard;
}

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

export async function downloadChartScreenshot(chart: Chart, options: ChartDownloadOptions = {}): Promise<Blob> {
  const { filename = defaultScreenshotFilename(options.type), ...screenshotOptions } = options;
  const blob = await chart.screenshot(screenshotOptions);
  downloadBlob(blob, filename);
  return blob;
}

export async function copyBlobToClipboard(blob: Blob, clipboard?: Clipboard): Promise<void> {
  if (typeof ClipboardItem === "undefined") {
    throw new Error("ClipboardItem is not available in this browser.");
  }
  const targetClipboard = clipboard ?? defaultClipboard();
  await targetClipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
}

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
