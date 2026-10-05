import type { ChartRendererFactory } from "../render/ChartRenderer.js";
import { Canvas2DRenderer } from "../render/Canvas2DRenderer.js";
import { webgl2Renderer } from "../render/webgl2Renderer.js";

export { Canvas2DUnavailableError } from "../render/Canvas2DRenderer.js";

/**
 * Renderer factory that draws with Canvas 2D: no WebGL2 needed, lower throughput. Pass it as
 * `new Chart(el, { renderer: canvas2dRenderer() })`.
 */
export function canvas2dRenderer(): ChartRendererFactory {
  return ({ canvas }) => new Canvas2DRenderer(canvas);
}

/**
 * Renderer factory that uses WebGL2 and falls back to Canvas 2D when WebGL2 is unavailable or
 * its context cannot be created. Check `chart.renderer` to see which one was chosen.
 */
export function autoRenderer(): ChartRendererFactory {
  const webgl = webgl2Renderer();
  const canvas2d = canvas2dRenderer();
  return (context) => {
    try {
      return webgl(context);
    } catch {
      return canvas2d(context);
    }
  };
}
