export type RgbaColor = readonly [number, number, number, number];

export interface ChartTheme {
  readonly backgroundColor?: RgbaColor;
  readonly gridColor?: RgbaColor;
  readonly axisColor?: string;
  readonly axisFont?: string;
  readonly seriesColors?: readonly RgbaColor[];
  readonly tooltipBackgroundColor?: string;
  readonly tooltipTextColor?: string;
  readonly tooltipFont?: string;
  readonly legendBackgroundColor?: string;
  readonly legendBorderColor?: string;
  readonly legendTextColor?: string;
  readonly legendMutedTextColor?: string;
  readonly legendFont?: string;
}

export interface ResolvedChartTheme {
  readonly backgroundColor: RgbaColor;
  readonly gridColor: RgbaColor;
  readonly axisColor: string;
  readonly axisFont: string;
  readonly seriesColors: readonly RgbaColor[];
  readonly tooltipBackgroundColor: string;
  readonly tooltipTextColor: string;
  readonly tooltipFont: string;
  readonly legendBackgroundColor: string;
  readonly legendBorderColor: string;
  readonly legendTextColor: string;
  readonly legendMutedTextColor: string;
  readonly legendFont: string;
}

const DEFAULT_SERIES_COLORS: readonly RgbaColor[] = [
  [0.3, 0.6, 1.0, 1.0],
  [0.95, 0.35, 0.35, 1.0],
  [0.2, 0.8, 0.4, 0.9],
  [0.95, 0.72, 0.25, 1.0],
  [0.72, 0.45, 0.95, 1.0],
  [0.25, 0.85, 0.95, 1.0],
];

export const DEFAULT_CHART_THEME: ResolvedChartTheme = {
  backgroundColor: [0.08, 0.10, 0.16, 1],
  gridColor: [0.22, 0.30, 0.44, 0.45],
  axisColor: "#bfd6ff",
  axisFont: "11px ui-monospace, monospace, sans-serif",
  seriesColors: DEFAULT_SERIES_COLORS,
  tooltipBackgroundColor: "rgba(4, 8, 16, 0.85)",
  tooltipTextColor: "#bfd6ff",
  tooltipFont: "11px/1.35 ui-monospace, monospace",
  legendBackgroundColor: "rgba(4, 8, 16, 0.85)",
  legendBorderColor: "transparent",
  legendTextColor: "#bfd6ff",
  legendMutedTextColor: "#789",
  legendFont: "11px/1.35 ui-monospace, monospace",
};

export function resolveChartTheme(theme: ChartTheme | undefined): ResolvedChartTheme {
  if (!theme) return DEFAULT_CHART_THEME;

  return {
    backgroundColor: theme.backgroundColor ?? DEFAULT_CHART_THEME.backgroundColor,
    gridColor: theme.gridColor ?? DEFAULT_CHART_THEME.gridColor,
    axisColor: theme.axisColor ?? DEFAULT_CHART_THEME.axisColor,
    axisFont: theme.axisFont ?? DEFAULT_CHART_THEME.axisFont,
    seriesColors: theme.seriesColors?.length ? theme.seriesColors : DEFAULT_CHART_THEME.seriesColors,
    tooltipBackgroundColor: theme.tooltipBackgroundColor ?? DEFAULT_CHART_THEME.tooltipBackgroundColor,
    tooltipTextColor: theme.tooltipTextColor ?? DEFAULT_CHART_THEME.tooltipTextColor,
    tooltipFont: theme.tooltipFont ?? DEFAULT_CHART_THEME.tooltipFont,
    legendBackgroundColor: theme.legendBackgroundColor ?? DEFAULT_CHART_THEME.legendBackgroundColor,
    legendBorderColor: theme.legendBorderColor ?? DEFAULT_CHART_THEME.legendBorderColor,
    legendTextColor: theme.legendTextColor ?? DEFAULT_CHART_THEME.legendTextColor,
    legendMutedTextColor: theme.legendMutedTextColor ?? DEFAULT_CHART_THEME.legendMutedTextColor,
    legendFont: theme.legendFont ?? DEFAULT_CHART_THEME.legendFont,
  };
}

export function rgbaCss(color: RgbaColor): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}
