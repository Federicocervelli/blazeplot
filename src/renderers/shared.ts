import type { ChartRenderContext } from "../render/SharedWebGL.js";
import { SharedWebGLContext } from "../render/SharedWebGL.js";
import type { ChartRendererFactory } from "../render/ChartRenderer.js";

export type { ChartRenderContext } from "../render/SharedWebGL.js";

/**
 * Create a render context: one hidden WebGL2 context shared by every chart that uses
 * `context.renderer()`. Charts keep their own visible canvas, so the page holds a single WebGL
 * context regardless of how many charts it mounts.
 */
export function createChartRenderContext(): ChartRenderContext {
  return new SharedWebGLContext();
}

let documentContext: SharedWebGLContext | null = null;

/**
 * Renderer factory backed by a shared WebGL2 context. Without an argument every chart on the page
 * shares one document-wide context; pass a context from `createChartRenderContext()` to group charts.
 * Throws `WebGL2UnavailableError` when WebGL2 is unavailable.
 */
export function sharedRenderer(context?: ChartRenderContext): ChartRendererFactory {
  const target = context ?? (documentContext ??= new SharedWebGLContext());
  return target.renderer();
}
