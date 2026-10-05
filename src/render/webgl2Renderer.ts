import type { ChartRendererFactory } from "./ChartRenderer.js";
import { Renderer } from "./Renderer.js";
import { WebGL2Backend } from "./WebGL2Backend.js";

/** The default renderer factory: WebGL2, throwing `WebGL2UnavailableError` when it is unavailable. */
export function webgl2Renderer(): ChartRendererFactory {
  return ({ canvas }) => new Renderer(new WebGL2Backend(canvas));
}
