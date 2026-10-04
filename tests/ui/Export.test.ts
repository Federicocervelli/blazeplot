import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { copyChartScreenshotToClipboard, downloadBlob, downloadChartScreenshot } from "../../src/export.ts";
import type { Chart, ChartScreenshotOptions } from "../../src/ui/Chart.ts";
import { countNodes, setupDom } from "./fakes.ts";
import type { TestEnv } from "./fakes.ts";

let env: TestEnv;
beforeAll(() => {
  env = setupDom();
});
afterAll(() => env.teardown());

interface ClickedAnchor {
  readonly href: string;
  readonly download: string;
  readonly connected: boolean;
}

let clicked: ClickedAnchor[];
let revoked: string[];
let restoreUrl: () => void;
let clickSpy: { mockRestore(): void };

beforeEach(() => {
  clicked = [];
  revoked = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  restoreUrl = () => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  };
  // Record the anchor at click time; happy-dom would otherwise try to navigate.
  clickSpy = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download, connected: this.isConnected });
  });
});
afterEach(() => {
  restoreUrl();
  clickSpy.mockRestore();
});

function fakeChart(blob: Blob): { chart: Chart; options: ChartScreenshotOptions[] } {
  const options: ChartScreenshotOptions[] = [];
  const chart = {
    screenshot: async (opts: ChartScreenshotOptions = {}) => {
      options.push(opts);
      return blob;
    },
  } as unknown as Chart;
  return { chart, options };
}

describe("downloadBlob", () => {
  it("clicks a temporary hidden anchor, removes it, and revokes the object URL on the next tick", async () => {
    const nodes = countNodes(document.body);
    downloadBlob(new Blob(["x"]), "plot.png");
    expect(clicked).toEqual([{ href: "blob:fake", download: "plot.png", connected: true }]);
    expect(countNodes(document.body)).toBe(nodes);
    expect(revoked).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(revoked).toEqual(["blob:fake"]);
  });

  it("defaults the filename to blazeplot.png", () => {
    downloadBlob(new Blob(["x"]));
    expect(clicked[0]!.download).toBe("blazeplot.png");
  });
});

describe("downloadChartScreenshot", () => {
  it("downloads the screenshot blob with a filename matching the image type", async () => {
    const blob = new Blob(["img"], { type: "image/png" });
    const { chart, options } = fakeChart(blob);
    await expect(downloadChartScreenshot(chart)).resolves.toBe(blob);
    await downloadChartScreenshot(chart, { type: "image/jpeg", quality: 0.5 });
    await downloadChartScreenshot(chart, { type: "image/webp" });
    await downloadChartScreenshot(chart, { filename: "mine.png", type: "image/jpeg" });
    expect(clicked.map((c) => c.download)).toEqual(["blazeplot.png", "blazeplot.jpg", "blazeplot.webp", "mine.png"]);
    // The filename is not forwarded to the screenshot call.
    expect(options[1]).toEqual({ type: "image/jpeg", quality: 0.5 });
    expect(options[3]).toEqual({ type: "image/jpeg" });
  });
});

describe("copyChartScreenshotToClipboard", () => {
  class FakeClipboardItem {
    constructor(readonly items: Record<string, Blob>) {}
  }
  const g = globalThis as { ClipboardItem?: unknown };
  let original: unknown;
  beforeEach(() => {
    original = g.ClipboardItem;
    g.ClipboardItem = FakeClipboardItem;
  });
  afterEach(() => {
    g.ClipboardItem = original;
  });

  it("writes the blob to the given clipboard keyed by its MIME type", async () => {
    const blob = new Blob(["img"], { type: "image/webp" });
    const written: FakeClipboardItem[][] = [];
    const clipboard = { write: async (items: FakeClipboardItem[]) => { written.push(items); } } as unknown as Clipboard;
    const { chart } = fakeChart(blob);
    await expect(copyChartScreenshotToClipboard(chart, { clipboard })).resolves.toBe(blob);
    expect(Object.keys(written[0]![0]!.items)).toEqual(["image/webp"]);
  });

  it("falls back to image/png when the blob has no type", async () => {
    const written: FakeClipboardItem[][] = [];
    const clipboard = { write: async (items: FakeClipboardItem[]) => { written.push(items); } } as unknown as Clipboard;
    const { chart } = fakeChart(new Blob(["img"]));
    await copyChartScreenshotToClipboard(chart, { clipboard });
    expect(Object.keys(written[0]![0]!.items)).toEqual(["image/png"]);
  });

  it("rejects clearly when ClipboardItem or the Clipboard API is unavailable", async () => {
    const { chart } = fakeChart(new Blob(["img"]));
    g.ClipboardItem = undefined;
    await expect(copyChartScreenshotToClipboard(chart, { clipboard: {} as Clipboard })).rejects.toThrow("ClipboardItem is not available");
    g.ClipboardItem = FakeClipboardItem;
    const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    try {
      await expect(copyChartScreenshotToClipboard(chart)).rejects.toThrow("Clipboard API is not available");
    } finally {
      if (nav) Object.defineProperty(globalThis, "navigator", nav);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});
