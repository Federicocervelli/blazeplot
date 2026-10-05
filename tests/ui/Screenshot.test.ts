import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_CHART_THEME, rgbaCss } from "../../src/ui/theme.ts";
import type { ChartLayout } from "../../src/ui/ChartLayout.ts";
import { composeChartScreenshot } from "../../src/ui/screenshot.ts";
import { setupDom } from "./fakes.ts";
import type { TestEnv } from "./fakes.ts";

let env: TestEnv;
beforeAll(() => {
  env = setupDom();
});
afterAll(() => env.teardown());

type Op = { readonly op: string; readonly args: readonly unknown[] } | { readonly set: string; readonly value: unknown };

/** A 2D context stand-in that records every call and property assignment, in order. */
function recordingContext(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => {
      if (typeof key === "symbol") return undefined;
      if (key in target) return target[key];
      return (...args: unknown[]) => void ops.push({ op: key, args });
    },
    set: (target, key, value) => {
      if (typeof key === "string") ops.push({ set: key, value });
      target[String(key)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

const calls = (ops: readonly Op[], name: string): unknown[][] => ops.filter((entry): entry is { op: string; args: unknown[] } => "op" in entry && entry.op === name).map((entry) => [...entry.args]);
const sets = (ops: readonly Op[], name: string): unknown[] => ops.filter((entry): entry is { set: string; value: unknown } => "set" in entry && entry.set === name).map((entry) => entry.value);

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
}

function place<T extends Element>(el: T, box: DOMRect): T {
  el.getBoundingClientRect = () => box;
  return el;
}

interface Fixture {
  readonly root: HTMLDivElement;
  readonly plot: HTMLDivElement;
  readonly plotCanvas: HTMLCanvasElement;
  readonly layout: ChartLayout;
  readonly output: ReturnType<typeof recordingContext>;
  readonly outputCanvas: { width: number; height: number; getContext: (kind: string) => unknown; toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void; encoded: { type?: string; quality?: number } };
}

let fixtures: HTMLElement[] = [];
let savedCreateElement: typeof document.createElement;
let imageBehavior: "load" | "error" = "load";
let createdUrls: string[] = [];
let revokedUrls: string[] = [];
const savedUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  fixtures = [];
  imageBehavior = "load";
  createdUrls = [];
  revokedUrls = [];
  savedCreateElement = document.createElement.bind(document);
  // SVG overlays are drawn through an <img>; happy-dom never loads images, so settle them by hand.
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    if (tag !== "img") return savedCreateElement(tag, options);
    const image = { onload: null as null | (() => void), onerror: null as null | (() => void), set src(_value: string) {
      queueMicrotask(() => (imageBehavior === "load" ? image.onload?.() : image.onerror?.()));
    } };
    return image as unknown as HTMLElement;
  }) as typeof document.createElement;
  URL.createObjectURL = ((blob: Blob) => {
    void blob;
    const url = `blob:fake-${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => void revokedUrls.push(url)) as typeof URL.revokeObjectURL;
});
afterEach(() => {
  document.createElement = savedCreateElement;
  URL.createObjectURL = savedUrl.create;
  URL.revokeObjectURL = savedUrl.revoke;
  for (const el of fixtures) el.remove();
});

function fixture(options: { dpr?: number; rootBox?: DOMRect; plotBox?: DOMRect; context?: boolean; blob?: boolean } = {}): Fixture {
  const root = savedCreateElement("div") as HTMLDivElement;
  const plot = savedCreateElement("div") as HTMLDivElement;
  const plotCanvas = savedCreateElement("canvas") as HTMLCanvasElement;
  plotCanvas.width = 400;
  plotCanvas.height = 200;
  plot.appendChild(plotCanvas);
  root.appendChild(plot);
  document.body.appendChild(root);
  fixtures.push(root);
  place(root, options.rootBox ?? rect(10, 20, 200, 100));
  place(plot, options.plotBox ?? rect(30, 20, 180, 80));
  place(plotCanvas, options.plotBox ?? rect(30, 20, 180, 80));

  const output = recordingContext();
  const encoded: { type?: string; quality?: number } = {};
  const outputCanvas = {
    width: 0,
    height: 0,
    encoded,
    getContext: (kind: string) => (kind === "2d" && options.context !== false ? output.ctx : null),
    toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => {
      encoded.type = type;
      encoded.quality = quality;
      callback(options.blob === false ? null : new Blob(["png"], { type: type ?? "image/png" }));
    },
  };
  const layout = {
    root,
    plot,
    doc: { createElement: (tag: string) => (tag === "canvas" ? outputCanvas : savedCreateElement(tag)) },
    view: { devicePixelRatio: options.dpr ?? 1 },
  } as unknown as ChartLayout;
  return { root, plot, plotCanvas, layout, output, outputCanvas };
}

const compose = (f: Fixture, options?: Parameters<typeof composeChartScreenshot>[1]): Promise<Blob> =>
  composeChartScreenshot({ layout: f.layout, canvas: f.plotCanvas, theme: DEFAULT_CHART_THEME }, options);

describe("composeChartScreenshot output", () => {
  it("sizes the image from the root box and the device pixel ratio, and encodes with the requested type", async () => {
    const f = fixture({ dpr: 2 });
    const blob = await compose(f, { type: "image/jpeg", quality: 0.8 });
    expect(blob.type).toBe("image/jpeg");
    expect(f.outputCanvas.width).toBe(400);
    expect(f.outputCanvas.height).toBe(200);
    expect(f.outputCanvas.encoded).toEqual({ type: "image/jpeg", quality: 0.8 });
  });

  it("lets pixelRatio, width, and height options override the measured size, with a one pixel floor", async () => {
    const dpr = fixture({ dpr: 2 });
    await compose(dpr, { pixelRatio: 3 });
    expect([dpr.outputCanvas.width, dpr.outputCanvas.height]).toEqual([600, 300]);

    const sized = fixture();
    await compose(sized, { width: 500.4, height: 0 });
    expect([sized.outputCanvas.width, sized.outputCanvas.height]).toEqual([500, 1]);

    const low = fixture({ dpr: 0.5 });
    await compose(low);
    // A device pixel ratio below one is raised to one so the export is never smaller than the layout.
    expect([low.outputCanvas.width, low.outputCanvas.height]).toEqual([200, 100]);
  });

  it("defaults to PNG and fills the theme background unless it is overridden or removed", async () => {
    const themed = fixture();
    const blob = await compose(themed);
    expect(blob.type).toBe("image/png");
    expect(calls(themed.output.ops, "fillRect")[0]).toEqual([0, 0, 200, 100]);
    expect(sets(themed.output.ops, "fillStyle")[0]).toBe(rgbaCss(DEFAULT_CHART_THEME.backgroundColor));

    const custom = fixture();
    await compose(custom, { background: "#123456" });
    expect(sets(custom.output.ops, "fillStyle")[0]).toBe("#123456");

    const transparent = fixture();
    await compose(transparent, { background: null });
    expect(calls(transparent.output.ops, "fillRect")).toHaveLength(0);
  });

  it("throws when the export canvas has no 2D context, and rejects when encoding fails", async () => {
    await expect(compose(fixture({ context: false }))).rejects.toThrow("Unable to create a 2D canvas context");
    await expect(compose(fixture({ blob: false }))).rejects.toThrow("Unable to encode chart screenshot.");
  });
});

describe("composeChartScreenshot canvases", () => {
  it("draws the plot canvas at its offset inside the root, scaled to the output", async () => {
    const f = fixture({ dpr: 2 });
    await compose(f);
    const [draw] = calls(f.output.ops, "drawImage");
    expect(draw).toEqual([f.plotCanvas, (30 - 10) * 2, (20 - 20) * 2, 180 * 2, 80 * 2]);
  });

  it("skips hidden and empty canvases, applies opacity, and falls back to the chart canvas when the root has none", async () => {
    const f = fixture();
    const hidden = place(savedCreateElement("canvas") as HTMLCanvasElement, rect(0, 0, 50, 50));
    hidden.width = 10;
    hidden.height = 10;
    hidden.style.display = "none";
    const empty = place(savedCreateElement("canvas") as HTMLCanvasElement, rect(0, 0, 0, 0));
    empty.width = 10;
    empty.height = 10;
    const faded = place(savedCreateElement("canvas") as HTMLCanvasElement, rect(10, 20, 20, 10));
    faded.width = 10;
    faded.height = 10;
    faded.style.opacity = "0.5";
    f.root.append(hidden, empty, faded);
    await compose(f);
    expect(calls(f.output.ops, "drawImage").map((args) => args[0])).toEqual([f.plotCanvas, faded]);
    expect(sets(f.output.ops, "globalAlpha")).toContain(0.5);

    const orphan = fixture();
    orphan.plot.removeChild(orphan.plotCanvas);
    await compose(orphan);
    // The detached chart canvas is placed over the plot box.
    expect(calls(orphan.output.ops, "drawImage")[0]).toEqual([orphan.plotCanvas, 20, 0, 180, 80]);
  });
});

describe("composeChartScreenshot SVG overlays", () => {
  function addSvg(f: Fixture, box: DOMRect, style: Partial<CSSStyleDeclaration> = {}): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    place(svg, box);
    Object.assign(svg.style, style);
    f.root.appendChild(svg);
    return svg;
  }

  it("rasterizes visible SVG overlays through an image and revokes the object URL", async () => {
    const f = fixture({ dpr: 2 });
    addSvg(f, rect(30, 20, 100, 40));
    await compose(f);
    const images = calls(f.output.ops, "drawImage").filter((args) => args[0] !== f.plotCanvas);
    expect(images).toHaveLength(1);
    expect(images[0]!.slice(1)).toEqual([(30 - 10) * 2, 0, 200, 80]);
    expect(createdUrls).toHaveLength(1);
    expect(revokedUrls).toEqual(createdUrls);
  });

  it("skips hidden and empty overlays", async () => {
    const f = fixture();
    addSvg(f, rect(0, 0, 100, 40), { display: "none" });
    addSvg(f, rect(0, 0, 100, 40), { visibility: "hidden" });
    addSvg(f, rect(0, 0, 0, 0));
    await compose(f);
    expect(createdUrls).toHaveLength(0);
    expect(calls(f.output.ops, "drawImage")).toHaveLength(1);
  });

  it("rejects when the overlay image cannot load, and still revokes its URL", async () => {
    const f = fixture();
    addSvg(f, rect(0, 0, 100, 40));
    imageBehavior = "error";
    await expect(compose(f)).rejects.toThrow("Unable to load SVG overlay for screenshot export.");
    expect(revokedUrls).toEqual(createdUrls);
  });
});

describe("composeChartScreenshot DOM text and boxes", () => {
  /** Give every character of `node` a 7x14 box on the line `lineOf` assigns it; whitespace and newlines collapse. */
  function stubRange(lineOf: (index: number, text: string) => number, collapsed: (char: string) => boolean = (char) => char === "\n"): () => void {
    const original = document.createRange.bind(document);
    document.createRange = (() => {
      let node: Text | null = null;
      let index = 0;
      return {
        setStart(target: Text, offset: number) {
          node = target;
          index = offset;
        },
        setEnd() {},
        getBoundingClientRect() {
          const text = node!.data;
          if (collapsed(text[index]!)) return rect(0, 0, 0, 0);
          return rect(100 + index * 7, 40 + lineOf(index, text) * 14, 7, 14);
        },
      } as unknown as Range;
    }) as typeof document.createRange;
    return () => {
      document.createRange = original;
    };
  }

  function addText(f: Fixture, text: string, style: Partial<CSSStyleDeclaration> = {}, parent: Element = f.root): HTMLDivElement {
    const el = savedCreateElement("div") as HTMLDivElement;
    el.textContent = text;
    Object.assign(el.style, style);
    place(el, rect(100, 40, 70, 14));
    parent.appendChild(el);
    return el;
  }

  it("paints text lines at their box position relative to the root, scaled to the output", async () => {
    const f = fixture({ dpr: 2 });
    const restore = stubRange(() => 0);
    try {
      addText(f, "Hz", { font: "12px sans-serif", color: "rgb(1, 2, 3)" });
      await compose(f);
    } finally {
      restore();
    }
    expect(calls(f.output.ops, "fillText")).toEqual([["Hz", 90, 20]]);
    expect(calls(f.output.ops, "scale")).toContainEqual([2, 2]);
    expect(sets(f.output.ops, "fillStyle")).toContain("rgb(1, 2, 3)");
    expect(sets(f.output.ops, "textBaseline")).toContain("top");
  });

  it("splits wrapped text into one fillText per visual line and drops collapsed whitespace", async () => {
    const f = fixture();
    const restore = stubRange((index) => (index < 3 ? 0 : 1), (char) => char === "\n");
    try {
      addText(f, "abc\ndef");
      await compose(f);
    } finally {
      restore();
    }
    expect(calls(f.output.ops, "fillText").map((args) => args[0])).toEqual(["abc", "def"]);
  });

  it("starts a new line when a character's box drops below the current line (soft wrap)", async () => {
    const f = fixture();
    const restore = stubRange((index) => (index < 3 ? 0 : 1), () => false);
    try {
      addText(f, "abcdef");
      await compose(f);
    } finally {
      restore();
    }
    expect(calls(f.output.ops, "fillText").map((args) => args[0])).toEqual(["abc", "def"]);
  });

  it("skips hidden, visually hidden, blank, style, and script text", async () => {
    const f = fixture();
    const restore = stubRange(() => 0);
    try {
      addText(f, "gone", { display: "none" });
      addText(f, "gone", { visibility: "hidden" });
      addText(f, "gone", { opacity: "0" });
      addText(f, "   ");
      const hiddenParent = addText(f, "");
      hiddenParent.className = "blazeplot-visually-hidden";
      addText(f, "gone", {}, hiddenParent);
      const style = savedCreateElement("style");
      style.textContent = "gone";
      f.root.appendChild(style);
      const script = savedCreateElement("script");
      script.textContent = "gone";
      f.root.appendChild(script);
      addText(f, "kept");
      await compose(f);
    } finally {
      restore();
    }
    expect(calls(f.output.ops, "fillText").map((args) => args[0])).toEqual(["kept"]);
  });

  it("draws text inside a transformed element centered on its box with the rotation applied", async () => {
    const f = fixture();
    const restore = stubRange(() => 0);
    const saved = (globalThis as { DOMMatrix?: unknown }).DOMMatrix;
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class {
      a: number;
      b: number;
      c: number;
      d: number;
      constructor(value: string) {
        const [a, b, c, d] = /matrix\(([^)]+)\)/.exec(value)![1]!.split(",").map(Number);
        [this.a, this.b, this.c, this.d] = [a!, b!, c!, d!];
      }
    };
    try {
      const rotated = addText(f, "  Axis   title ", { transform: "matrix(0, -1, 1, 0, 0, 0)" });
      place(rotated, rect(20, 30, 14, 70));
      await compose(f);
    } finally {
      restore();
      (globalThis as { DOMMatrix?: unknown }).DOMMatrix = saved;
    }
    expect(calls(f.output.ops, "fillText")).toEqual([["Axis title", 0, 0]]);
    expect(calls(f.output.ops, "translate")).toContainEqual([20 + 7 - 10, 30 + 35 - 20]);
    expect(calls(f.output.ops, "transform")).toContainEqual([0, -1, 1, 0, 0, 0]);
    expect(sets(f.output.ops, "textAlign")).toContain("center");
    expect(sets(f.output.ops, "textBaseline")).toContain("middle");
  });

  it("falls back to untransformed text when the transform cannot be parsed", async () => {
    const f = fixture();
    const restore = stubRange(() => 0);
    const saved = (globalThis as { DOMMatrix?: unknown }).DOMMatrix;
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class {
      constructor() {
        throw new SyntaxError("bad transform");
      }
    };
    try {
      addText(f, "plain", { transform: "rotate(-90deg)" });
      await compose(f);
    } finally {
      restore();
      (globalThis as { DOMMatrix?: unknown }).DOMMatrix = saved;
    }
    expect(calls(f.output.ops, "fillText").map((args) => args[0])).toEqual(["plain"]);
  });

  it("paints background and border only for elements that opt in with data-blazeplot-screenshot-box", async () => {
    const f = fixture({ dpr: 2 });
    const restore = stubRange(() => 0);
    try {
      const box = addText(f, "", { backgroundColor: "rgb(10, 20, 30)", borderTopWidth: "2px", borderTopStyle: "solid", borderTopColor: "rgb(200, 0, 0)" });
      box.setAttribute("data-blazeplot-screenshot-box", "");
      place(box, rect(60, 50, 40, 20));
      const plain = addText(f, "", { backgroundColor: "rgb(1, 1, 1)" });
      place(plain, rect(0, 0, 10, 10));
      const empty = addText(f, "", { backgroundColor: "rgb(5, 5, 5)" });
      empty.setAttribute("data-blazeplot-screenshot-box", "");
      place(empty, rect(0, 0, 0, 0));
      const transparent = addText(f, "", { backgroundColor: "transparent" });
      transparent.setAttribute("data-blazeplot-screenshot-box", "");
      place(transparent, rect(0, 0, 10, 10));
      await compose(f);
    } finally {
      restore();
    }
    // The background fill, in root-relative CSS pixels under a scale(dpr) transform.
    const fills = calls(f.output.ops, "fillRect").slice(1);
    expect(fills).toEqual([[50, 30, 40, 20]]);
    expect(sets(f.output.ops, "fillStyle")).toContain("rgb(10, 20, 30)");
    expect(calls(f.output.ops, "strokeRect")).toEqual([[51, 31, 38, 18]]);
    expect(sets(f.output.ops, "lineWidth")).toContain(2);
    expect(sets(f.output.ops, "strokeStyle")).toContain("rgb(200, 0, 0)");
  });
});
