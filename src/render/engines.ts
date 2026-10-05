import { Canvas2DRenderer } from "./canvas2d/Canvas2DRenderer.js";
import type { ChartRenderer, ChartRendererFactory, RendererChoice, RendererOrigin } from "./ChartRenderer.js";
import type { ChartRenderContext } from "./webgl2/SharedWebGL.js";
import { SharedWebGLContext } from "./webgl2/SharedWebGL.js";
import { WebGL2Renderer } from "./webgl2/WebGL2Renderer.js";
import { acquirePlotCanvas } from "./webgl2/WarmCanvasPool.js";

export type { ChartRenderContext } from "./webgl2/SharedWebGL.js";
export { Canvas2DUnavailableError } from "./canvas2d/Canvas2DRenderer.js";

/**
 * The engine table: the only module that names the rendering engines. Engines are plain synchronous
 * factories, so `new Chart()` stays synchronous and nothing here is loaded lazily.
 */

const webgl2 = (origin: RendererOrigin): ChartRendererFactory => ({ canvas }) => new WebGL2Renderer(canvas, { origin });
const canvas2d = (origin: RendererOrigin): ChartRendererFactory => ({ canvas }) => new Canvas2DRenderer(canvas, origin);

// One default shared context per document, so charts in an iframe or popup get a canvas from their own document.
const documentContexts = new WeakMap<Document, SharedWebGLContext>();

/** Renderer factory for WebGL2. Throws `WebGL2UnavailableError` when WebGL2 is unavailable. Same as `renderer: "webgl2"`. */
export function webgl2Renderer(): ChartRendererFactory {
  return webgl2({});
}

/** Renderer factory for Canvas 2D: no WebGL2 needed, lower throughput. Throws `Canvas2DUnavailableError` without a 2D context. Same as `renderer: "canvas2d"`. */
export function canvas2dRenderer(): ChartRendererFactory {
  return canvas2d({});
}

/**
 * Renderer factory that uses WebGL2 and falls back to Canvas 2D when WebGL2 is unavailable or its
 * context cannot be created. `chart.rendererInfo.fallbackFrom` says when the fallback happened.
 * Same as `renderer: "auto"`, the default.
 */
export function autoRenderer(): ChartRendererFactory {
  const origin: RendererOrigin = { requested: "auto" };
  const primary = webgl2(origin);
  const fallback = canvas2d({ ...origin, fallbackFrom: "webgl2" });
  return (context) => {
    try {
      return primary(context);
    } catch (webglError) {
      try {
        return fallback(context);
      } catch {
        // Neither engine can start (no canvas at all): report the primary engine's reason.
        throw webglError;
      }
    }
  };
}

/**
 * Renderer factory backed by a WebGL2 context shared between charts. Without an argument every chart
 * on the document shares one context; pass a context from `createChartRenderContext()` to group
 * charts. Throws `WebGL2UnavailableError` when WebGL2 is unavailable. Same as `renderer: "shared"`.
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

/**
 * Create a render context: one hidden WebGL2 context shared by every chart that uses
 * `context.renderer()`. Charts keep their own visible canvas, so the page holds a single WebGL
 * context however many charts it mounts.
 */
export function createChartRenderContext(doc?: Document): ChartRenderContext {
  return new SharedWebGLContext(doc);
}

const namedRenderers: Readonly<Record<RendererChoice, () => ChartRendererFactory>> = {
  auto: autoRenderer,
  webgl2: webgl2Renderer,
  canvas2d: canvas2dRenderer,
  shared: () => sharedRenderer(),
};

/** @internal Names accepted by `ChartOptions.renderer`, for error messages. */
export const rendererChoices = Object.keys(namedRenderers) as readonly RendererChoice[];

/**
 * @internal The canvas for a chart's plot area. Charts that can end up on the native WebGL2 engine
 * (`"webgl2"`, `"auto"`, the default) may get a warm canvas, with a live context and compiled
 * programs, from a recently disposed chart; every other renderer gets a new canvas, because a canvas
 * with a WebGL context cannot give out a 2D one.
 */
export function createPlotCanvas(option: RendererChoice | ChartRendererFactory | undefined, doc: Document): HTMLCanvasElement {
  return option === undefined || option === "auto" || option === "webgl2" ? acquirePlotCanvas(doc) : doc.createElement("canvas");
}

/**
 * @internal Build the engine for a chart's plot canvas from its `renderer` option: a name, a factory, or
 * `undefined` for `"auto"`. Synchronous. Throws what the chosen engine throws when it is unavailable,
 * and a `TypeError` for anything else.
 */
export function createEngine(option: RendererChoice | ChartRendererFactory | undefined, canvas: HTMLCanvasElement): ChartRenderer {
  let factory: ChartRendererFactory;
  if (typeof option === "function") factory = option;
  else if (option === undefined) factory = namedRenderers.auto();
  else if (Object.hasOwn(namedRenderers, option)) factory = namedRenderers[option]();
  else throw new TypeError(`ChartOptions.renderer must be one of ${rendererChoices.map((name) => `"${name}"`).join(", ")} or a factory such as canvas2dRenderer(), got ${typeof option === "string" ? `"${option}"` : typeof option}.`);
  return factory({ canvas }) as ChartRenderer;
}
