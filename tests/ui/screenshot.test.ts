import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { setupDom } from "./fakes.ts";
import type { TestEnv } from "./fakes.ts";

let env: TestEnv;
let collectScreenshotTextNodes: typeof import("../../src/ui/screenshot.ts").collectScreenshotTextNodes;
let resolveCanvasFont: typeof import("../../src/ui/screenshot.ts").resolveCanvasFont;

beforeAll(async () => {
  env = setupDom();
  ({ collectScreenshotTextNodes, resolveCanvasFont } = await import("../../src/ui/screenshot.ts"));
});
afterAll(() => env.teardown());

describe("resolveCanvasFont", () => {
  it("uses the computed font shorthand when present", () => {
    const font = resolveCanvasFont({ font: "600 14px system-ui", fontStyle: "normal", fontWeight: "400", fontSize: "10px", fontFamily: "serif" });
    expect(font).toBe("600 14px system-ui");
  });

  it("rebuilds the font from longhands when the shorthand is empty", () => {
    const font = resolveCanvasFont({ font: "", fontStyle: "italic", fontWeight: "700", fontSize: "12px", fontFamily: "Inter, sans-serif" });
    expect(font).toBe("italic 700 12px Inter, sans-serif");
  });

  it("skips normal keywords and falls back to defaults", () => {
    expect(resolveCanvasFont({ font: "", fontStyle: "normal", fontWeight: "normal", fontSize: "11px", fontFamily: "monospace" })).toBe("11px monospace");
    expect(resolveCanvasFont({ font: "", fontStyle: "", fontWeight: "", fontSize: "", fontFamily: "" })).toBe("16px sans-serif");
  });
});

describe("collectScreenshotTextNodes", () => {
  it("collects text from any element in document order, not only leaf divs", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="title">Title</div>
      <div class="legend"><button><span>Wave</span> <span>Area</span></button></div>
      <div>   </div>`;
    expect(collectScreenshotTextNodes(root).map((node) => node.data.trim())).toEqual(["Title", "Wave", "Area"]);
  });

  it("skips svg, canvas, script, style, and visually hidden subtrees", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <svg><text>annotation</text></svg>
      <canvas>fallback</canvas>
      <style>.a { color: red }</style>
      <div class="blazeplot-visually-hidden">status</div>
      <div>visible</div>`;
    expect(collectScreenshotTextNodes(root).map((node) => node.data.trim())).toEqual(["visible"]);
  });
});
