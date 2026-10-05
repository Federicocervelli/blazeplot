import type { ChartOptions, ChartTheme, RgbaColor } from "../../../../src/index.ts";

/** Site palette for chart series: flame first, then hues that stay distinct on the warm dark background. */
export const SITE_SERIES: Readonly<Record<"flame" | "sky" | "mint" | "amber" | "violet" | "sand", RgbaColor>> = {
  flame: [0.988, 0.29, 0.02, 1],
  sky: [0.31, 0.66, 1, 1],
  mint: [0.24, 0.81, 0.56, 1],
  amber: [0.96, 0.71, 0.0, 1],
  violet: [0.65, 0.55, 0.98, 1],
  sand: [0.91, 0.79, 0.66, 1],
};

const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "'IBM Plex Sans Variable', 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";

/** Chart theme matching the website tokens in tailwind.css. */
export const SITE_CHART_THEME: ChartTheme = {
  backgroundColor: "#0d0c0b",
  gridColor: "rgba(238, 226, 214, 0.07)",
  axisColor: "#8a837c",
  axisFont: `11px ${MONO}`,
  seriesColors: Object.values(SITE_SERIES),
  tooltipBackgroundColor: "rgba(25, 23, 21, 0.96)",
  tooltipTextColor: "#eeece9",
  tooltipFont: `11px/1.45 ${MONO}`,
  legendBackgroundColor: "rgba(19, 17, 16, 0.92)",
  legendBorderColor: "#2a2623",
  legendTextColor: "#eeece9",
  legendMutedTextColor: "#8a837c",
  legendFont: `12px/1.4 ${SANS}`,
  titleColor: "#eeece9",
  titleFont: `600 14px ${SANS}`,
  subtitleColor: "#b5afa8",
  subtitleFont: `12px ${SANS}`,
  axisTitleColor: "#b5afa8",
  axisTitleFont: `12px ${SANS}`,
  selectionFillColor: "rgba(252, 74, 5, 0.12)",
  selectionStrokeColor: "rgba(255, 122, 69, 0.9)",
  crosshairColor: "rgba(238, 236, 233, 0.32)",
  // Also outlines the hovered bar/bin, so it must contrast with the background.
  markerStrokeColor: "#eeece9",
};

export function siteChartOptions(options: ChartOptions = {}): ChartOptions {
  return { ...options, theme: { ...SITE_CHART_THEME, ...(options.theme === "auto" ? undefined : options.theme) } };
}

export function darkOutsideAxesOptions(options: ChartOptions = {}): ChartOptions {
  const optionAxes = typeof options.axes === "object" ? options.axes : {};
  return siteChartOptions({
    ...options,
    axes: options.axes === false ? false : { x: { position: "outside" }, y: { position: "outside" }, ...optionAxes },
    grid: options.grid ?? true,
  });
}
