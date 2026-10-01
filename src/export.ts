import type { Chart, ChartScreenshotOptions } from "./ui/Chart.js";

/** Options for downloading a chart screenshot. */
export interface ChartDownloadOptions extends ChartScreenshotOptions {
  /** Defaults to `blazeplot.png` (or `.jpg`/`.webp` to match `type`). */
  readonly filename?: string;
}

/** Options for copying a chart screenshot to the clipboard. */
export interface ChartClipboardOptions extends ChartScreenshotOptions {
  /** Defaults to `navigator.clipboard`. */
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

/** Capture a chart screenshot, copy it to the clipboard, and return the blob. */
export async function copyChartScreenshotToClipboard(chart: Chart, options: ChartClipboardOptions = {}): Promise<Blob> {
  const { clipboard, ...screenshotOptions } = options;
  const blob = await chart.screenshot(screenshotOptions);
  if (typeof ClipboardItem === "undefined") {
    throw new Error("ClipboardItem is not available in this browser.");
  }
  const target = clipboard ?? (typeof navigator === "undefined" ? undefined : navigator.clipboard);
  if (!target) throw new Error("Clipboard API is not available in this environment.");
  await target.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
  return blob;
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
