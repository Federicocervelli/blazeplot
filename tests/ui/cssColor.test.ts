import { describe, expect, it } from "bun:test";
import { parseColorSpaceColor } from "../../src/ui/cssColor.ts";

/** Expect `color` to parse to `rgb` (0-255) and `alpha` within about 1/255. */
function expectRgb(color: string, rgb: readonly [number, number, number], alpha = 1) {
  const parsed = parseColorSpaceColor(color);
  expect(parsed).not.toBeNull();
  const [r, g, b, a] = parsed!;
  for (const [actual, expected] of [[r * 255, rgb[0]], [g * 255, rgb[1]], [b * 255, rgb[2]]] as const) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  }
  expect(a).toBeCloseTo(alpha, 3);
}

// sRGB primaries in each space are the CSS Color 4 / colorjs.io conversions of rgb(255 0 0) and friends;
// the other references are Chromium 155's own rendering of the same color into an sRGB canvas.
describe("parseColorSpaceColor", () => {
  it("parses oklch() with number or percentage lightness and every hue unit", () => {
    expectRgb("oklch(0.628 0.2577 29.23)", [255, 0, 0]);
    expectRgb("oklch(62.8% 0.2577 29.23deg)", [255, 0, 0]);
    expectRgb("oklch(0.7017 0.3225 328.36)", [255, 0, 255]);
    expectRgb("oklch(0.65 0.2 250)", [0, 145, 255]);
    expectRgb("oklch(0.205 0 0)", [23, 23, 23]); // shadcn --primary, #171717
    expectRgb("oklch(0.6 0.1 1.2rad)", [167, 116, 56]);
    expectRgb("OKLCH(0.6 0.1 76.394grad)", [167, 116, 56]);
    expectRgb("oklch(0.6 0.1 0.19099turn)", [167, 116, 56]);
    expectRgb("oklch(60% 25% 68.7549)", [167, 116, 56]); // chroma 100% = 0.4
  });

  it("parses oklab()", () => {
    expectRgb("oklab(0.628 0.2249 0.1258)", [255, 0, 0]);
    expectRgb("oklab(0.5 0.1 0.1)", [161, 66, 3]);
    expectRgb("oklab(80% -12.5% 12.5%)", [170, 200, 155]); // a/b 100% = 0.4
  });

  it("parses CIE lab() and lch() (D50, Bradford-adapted)", () => {
    expectRgb("lab(54.29 80.82 69.91)", [255, 0, 0]);
    expectRgb("lab(97.61 -15.75 93.39)", [255, 255, 0]);
    expectRgb("lab(50% 20 20)", [158, 105, 86]);
    expectRgb("lab(70 -24% 8%)", [112, 186, 152]); // a/b 100% = 125
    expectRgb("lab(100 0 0)", [255, 255, 255]);
    expectRgb("lch(54.29 106.84 40.85)", [255, 0, 0]);
    expectRgb("lch(60 40 120)", [125, 154, 81]);
    expectRgb("lch(40 20% 300deg)", [102, 87, 137]); // chroma 100% = 150
  });

  it("parses the predefined color() spaces", () => {
    expectRgb("color(srgb-linear 0.21404 0.21404 0.21404)", [128, 128, 128]);
    expectRgb("color(srgb-linear 0.3 0.2 0.1)", [149, 124, 89]);
    expectRgb("color(display-p3 0.6 0.4 0.3)", [162, 99, 71]);
    expectRgb("color(display-p3 50% 50% 50%)", [128, 128, 128]);
    expectRgb("color(rec2020 0.5 0.4 0.3)", [154, 112, 87]);
    expectRgb("color(a98-rgb 0.6 0.4 0.3)", [170, 102, 74]);
    expectRgb("color(prophoto-rgb 0.5 0.4 0.3)", [171, 115, 90]);
    expectRgb("color(xyz 0.3 0.25 0.2)", [186, 120, 117]);
    expectRgb("color(xyz-d65 0.9504559 1 1.0890578)", [255, 255, 255]);
    expectRgb("color(xyz-d50 0.3 0.25 0.2)", [177, 121, 136]);
    expectRgb("color(xyz-d50 0.9642956 1 0.8251046)", [255, 255, 255]);
  });

  it("clamps out-of-gamut colors per channel", () => {
    expectRgb("color(display-p3 1 0 0)", [255, 0, 0]);
    expectRgb("color(display-p3 0 1 0)", [0, 255, 0]);
    expect(parseColorSpaceColor("oklch(0.7 0.4 145)")!.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
    expectRgb("lab(150 0 0)", [255, 255, 255]); // lightness clamps to 100
    expectRgb("oklch(0.5 -0.2 30)", parseRgb("oklch(0.5 0 0)")); // negative chroma clamps to 0
  });

  it("reads alpha as a number or a percentage", () => {
    expectRgb("oklch(0.65 0.2 250 / 0.5)", [0, 145, 255], 0.5);
    expectRgb("oklch(0.65 0.2 250 / 50%)", [0, 145, 255], 0.5);
    expectRgb("lab(50 20 20/25%)", [158, 105, 86], 0.25);
    expectRgb("color(display-p3 0.6 0.4 0.3 / 0.75)", [162, 99, 71], 0.75);
    expectRgb("oklab(0.5 0.1 0.1 / 2)", [161, 66, 3], 1);
  });

  it("treats none as 0 in every component", () => {
    expectRgb("oklch(0.5 none none)", parseRgb("oklch(0.5 0 0)"));
    expectRgb("oklch(none 0 0)", [0, 0, 0]);
    expectRgb("lch(60 40 none)", parseRgb("lch(60 40 0)"));
    expectRgb("color(display-p3 none 1 none)", parseRgb("color(display-p3 0 1 0)"));
    expectRgb("oklch(0.5 0.1 30 / none)", parseRgb("oklch(0.5 0.1 30)"), 0);
  });

  it("returns null for other or malformed colors", () => {
    for (const color of [
      "rgb(1 2 3)",
      "#fff",
      "color(srgb 1 0 0)",
      "color(cmyk 1 0 0)",
      "color(display-p3 1 0)",
      "oklch(0.5 0.1)",
      "oklch(0.5 0.1 30 40)",
      "oklch(0.5 0.1 30deg / 0.5 / 0.5)",
      "oklch(0.5 0.1 30px)",
      "lab(50 abc 20)",
      "oklch(calc(0.5) 0.1 30)",
      "oklch(0.5 0.1 30 / )",
      "oklch(0.5 0.1 30",
    ]) {
      expect(parseColorSpaceColor(color)).toBeNull();
    }
  });
});

function parseRgb(color: string): [number, number, number] {
  const [r, g, b] = parseColorSpaceColor(color)!;
  return [r * 255, g * 255, b * 255];
}
