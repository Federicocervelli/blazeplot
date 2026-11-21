import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { resolveSeriesStyle } from "../../src/ui/ChartConfig.ts";
import { DEFAULT_CHART_THEME, resolveChartTheme, resolveThemeColor } from "../../src/ui/theme.ts";
import { useChartHarness } from "./harness.ts";

useChartHarness();

const FALLBACK = [0.1, 0.2, 0.3, 1] as const;
let restoreComputedStyle: (() => void) | undefined;

afterEach(() => {
  restoreComputedStyle?.();
  restoreComputedStyle = undefined;
});

/**
 * Make `getComputedStyle(probe).color` report what Chromium 155 reports: var() references to modern
 * colors stay in their own color space, and an element without a color inherits the text color.
 */
function computeColorsLike(map: Record<string, string>) {
  const original = window.getComputedStyle;
  window.getComputedStyle = ((element: HTMLElement) => {
    const specified = element.style.color;
    return { color: specified ? map[specified] ?? specified : "rgb(0, 0, 0)" } as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle;
  restoreComputedStyle = () => {
    window.getComputedStyle = original;
  };
}

describe("modern CSS theme colors", () => {
  it("resolves oklch, lab, and color() strings instead of falling back", () => {
    const theme = resolveChartTheme({
      seriesColors: ["oklch(0.65 0.2 250)", "lab(54.29 80.82 69.91 / 50%)", "color(display-p3 0.5 0.5 0.5)"],
      gridColor: "oklab(0.628 0.2249 0.1258 / 0.5)",
    }, document.body);
    const [blue, red, gray] = theme.seriesColors.map((color) => color.map((channel) => Math.round(channel * 255)));
    expect(blue).toEqual([0, 145, 255, 255]);
    expect(red).toEqual([255, 0, 0, 128]);
    expect(gray).toEqual([128, 128, 128, 255]);
    expect(theme.gridColor.map((channel) => Math.round(channel * 255))).toEqual([255, 0, 0, 128]);
  });

  it("parses the computed value of a var() that holds an oklch token", () => {
    computeColorsLike({ "var(--border)": "oklch(0.922 0 0)", "var(--chart-1)": "oklch(0.646 0.222 41.116)" });
    const theme = resolveChartTheme({ seriesColors: ["var(--chart-1)"], gridColor: "var(--border)" }, document.body);
    expect(theme.gridColor.map((channel) => Math.round(channel * 255))).toEqual([229, 229, 229, 255]); // #e5e5e5
    // Tailwind v4 orange-600, about #f54a00.
    const orange = theme.seriesColors[0]!.map((channel) => channel * 255);
    [245, 74, 0, 255].forEach((expected, index) => expect(Math.abs(orange[index]! - expected)).toBeLessThanOrEqual(1));
  });

  it("falls back for invalid strings, warning once per string with its source", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveThemeColor("not-a-color", FALLBACK, document.body, "theme.gridColor")).toEqual(FALLBACK);
      expect(resolveThemeColor("not-a-color", FALLBACK, document.body, "theme.gridColor")).toEqual(FALLBACK);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain('"not-a-color" (theme.gridColor)');

      const theme = resolveChartTheme({ seriesColors: ["#00f", "oklch(nope)"] }, document.body);
      expect(theme.seriesColors[1]).toEqual(DEFAULT_CHART_THEME.seriesColors[1]!);
      expect(warn.mock.calls[1]![0]).toContain('"oklch(nope)" (theme.seriesColors[1])');

      expect(resolveSeriesStyle({ fillColor: "bogus-fill" }, [1, 0, 0, 1], document.body).fillColor).toEqual([1, 0, 0, 0.25]);
      expect(warn.mock.calls[2]![0]).toContain('"bogus-fill" (series style fillColor)');
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a literal color's full alpha precision, which computed styles round to 8 bits", () => {
    // Chromium serializes a computed rgba() alpha of 0.0007 as 0.
    computeColorsLike({ "rgba(56, 189, 248, 0.0007)": "rgba(56, 189, 248, 0)", "oklch(0.7 0.1 200 / 0.002)": "oklch(0.7 0.1 200 / 0)", "var(--faint)": "rgba(0, 0, 0, 0.5)" });
    const [r, g, b, a] = resolveThemeColor("rgba(56, 189, 248, 0.0007)", FALLBACK, document.body);
    expect([r, g, b].map((c) => Math.round(c * 255))).toEqual([56, 189, 248]);
    expect(a).toBeCloseTo(0.0007, 6);
    expect(resolveThemeColor("oklch(0.7 0.1 200 / 0.002)", FALLBACK, document.body)[3]).toBeCloseTo(0.002, 6);
    // Anything the browser must resolve still goes through it.
    expect(resolveThemeColor("var(--faint)", FALLBACK, document.body)).toEqual([0, 0, 0, 0.5]);
  });

  it("does not take the inherited text color for a string the browser rejects", () => {
    computeColorsLike({ red: "rgb(255, 0, 0)" });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveThemeColor("red", FALLBACK, document.body)).toEqual([1, 0, 0, 1]);
      expect(resolveThemeColor("definitely-invalid", FALLBACK, document.body)).toEqual(FALLBACK);
    } finally {
      warn.mockRestore();
    }
  });
});
