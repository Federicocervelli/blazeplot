import type { ChartRenderer, ChartRendererFactory } from "./ChartRenderer.js";
import { webgl2Renderer } from "./webgl2/WebGL2Renderer.js";

/** The `ChartOptions.renderer` values the engine table understands. */
export type RendererOption = "webgl2" | ChartRendererFactory;

/**
 * Build the engine for a chart's plot canvas from its `renderer` option. Synchronous, so
 * `new Chart()` stays synchronous. Throws what the chosen engine throws when it is unavailable.
 */
export function createEngine(option: RendererOption | undefined, canvas: HTMLCanvasElement): ChartRenderer {
  if (option !== undefined && option !== "webgl2" && typeof option !== "function") {
    throw new TypeError('ChartOptions.renderer must be "webgl2" or a factory such as canvas2dRenderer() from "blazeplot/renderers/canvas2d".');
  }
  const factory = typeof option === "function" ? option : webgl2Renderer();
  return factory({ canvas }) as ChartRenderer;
}
