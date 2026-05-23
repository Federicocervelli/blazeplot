import type { ChartOptions } from "../../../../src/index.ts";

export function darkOutsideAxesOptions(options: ChartOptions = {}): ChartOptions {
  const optionAxes = typeof options.axes === "object" ? options.axes : {};
  return {
    ...options,
    axes: options.axes === false ? false : { x: { position: "outside" }, y: { position: "outside" }, ...optionAxes },
    grid: options.grid ?? true,
    theme: {
      backgroundColor: [0, 0, 0, 1],
      gridColor: [0.14, 0.14, 0.14, 0.65],
      axisColor: "#888",
      axisFont: "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      ...options.theme,
    },
  };
}
