import type { ChartRenderContext } from "../render/webgl2/SharedWebGL.js";
import { SharedWebGLContext } from "../render/webgl2/SharedWebGL.js";
import type { ChartRendererFactory } from "../render/ChartRenderer.js";

export type { ChartRenderContext } from "../render/webgl2/SharedWebGL.js";

/**
 * Create a render context: one hidden WebGL2 context shared by every chart that uses
 * `context.renderer()`. Charts keep their own visible canvas, so the page holds a single WebGL
 * context regardless of how many charts it mounts.
 */
export function createChartRenderContext(doc?: Document): ChartRenderContext {
  return new SharedWebGLContext(doc);
}

// One default context per document, so charts in an iframe or popup get a canvas from their own document.
const documentContexts = new WeakMap<Document, SharedWebGLContext>();

/**
 * Renderer factory backed by a shared WebGL2 context. Without an argument every chart on the page
 * shares one document-wide context; pass a context from `createChartRenderContext()` to group charts.
 * Throws `WebGL2UnavailableError` when WebGL2 is unavailable.
 */
export function sharedRenderer(context?: ChartRenderContext): ChartRendererFactory {
  if (context) return context.renderer();
  return (factoryContext) => {
    const doc = factoryContext.canvas.ownerDocument ?? globalThis.document;
    let target = documentContexts.get(doc);
    if (!target) documentContexts.set(doc, (target = new SharedWebGLContext(doc)));
    return target.renderer()(factoryContext);
  };
}
