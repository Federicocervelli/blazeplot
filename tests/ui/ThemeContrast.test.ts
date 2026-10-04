import { describe, expect, it } from "bun:test";
import type { RgbaColor } from "../../src/core/types.ts";
import { DEFAULT_CHART_THEME, LIGHT_CHART_THEME } from "../../src/ui/theme.ts";
import type { ResolvedChartTheme } from "../../src/ui/theme.ts";

/**
 * WCAG 2.x contrast checks for the built-in themes: text tokens need 4.5:1 against what they sit on,
 * graphical and UI tokens (series, selection border, crosshair, markers, focus ring) need 3:1.
 * Translucent colors are composited over the surface below them first. Grid lines are decorative.
 */
type Rgb = readonly [number, number, number];

function parseCss(color: string): RgbaColor {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [Number.parseInt(full.slice(0, 2), 16) / 255, Number.parseInt(full.slice(2, 4), 16) / 255, Number.parseInt(full.slice(4, 6), 16) / 255, 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color)?.[1];
  if (!rgb) throw new Error(`Unsupported theme color ${color}`);
  const [r = 0, g = 0, b = 0, a = 1] = rgb.split(",").map((part) => Number.parseFloat(part));
  return [r / 255, g / 255, b / 255, a];
}

function over(top: RgbaColor, below: Rgb): Rgb {
  const a = top[3];
  return [top[0] * a + below[0] * (1 - a), top[1] * a + below[1] * (1 - a), top[2] * a + below[2] * (1 - a)];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function checks(theme: ResolvedChartTheme): Array<{ token: string; ratio: number; min: number }> {
  const background = over(theme.backgroundColor, [1, 1, 1]);
  const tooltip = over(parseCss(theme.tooltipBackgroundColor), background);
  const legend = over(parseCss(theme.legendBackgroundColor), background);
  const text = (token: keyof ResolvedChartTheme, surface: Rgb = background): { token: string; ratio: number; min: number } =>
    ({ token, ratio: contrast(over(parseCss(theme[token] as string), surface), surface), min: 4.5 });
  const graphic = (token: string, color: RgbaColor): { token: string; ratio: number; min: number } =>
    ({ token, ratio: contrast(over(color, background), background), min: 3 });
  return [
    text("axisColor"),
    text("titleColor"),
    text("subtitleColor"),
    text("axisTitleColor"),
    text("tooltipTextColor", tooltip),
    text("legendTextColor", legend),
    text("legendMutedTextColor", legend),
    ...theme.seriesColors.map((color, index) => graphic(`seriesColors[${index}]`, color)),
    graphic("selectionStrokeColor", parseCss(theme.selectionStrokeColor)),
    graphic("crosshairColor", parseCss(theme.crosshairColor)),
    graphic("markerStrokeColor", parseCss(theme.markerStrokeColor)),
    graphic("focusRingColor", parseCss(theme.focusRingColor)),
  ];
}

describe("built-in theme contrast", () => {
  for (const [name, theme] of [["dark (DEFAULT_CHART_THEME)", DEFAULT_CHART_THEME], ["light (LIGHT_CHART_THEME)", LIGHT_CHART_THEME]] as const) {
    it(`${name} meets 4.5:1 for text and 3:1 for graphics`, () => {
      const failures = checks(theme)
        .filter(({ ratio, min }) => ratio < min)
        .map(({ token, ratio, min }) => `${token} ${ratio.toFixed(2)}:1 < ${min}:1`);
      expect(failures).toEqual([]);
    });
  }

  it("computes WCAG ratios correctly", () => {
    expect(contrast([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5);
    expect(contrast([1, 1, 1], [1, 1, 1])).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 example.
    expect(contrast(over(parseCss("#767676"), [1, 1, 1]), [1, 1, 1])).toBeCloseTo(4.54, 2);
  });
});
