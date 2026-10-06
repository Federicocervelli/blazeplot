import { Canvas2DRenderer } from "./canvas2d/Canvas2DRenderer.js";
import type { ChartRenderer, ChartRendererFactory, RendererChoice, RendererOrigin } from "./ChartRenderer.js";
import type { ChartRenderContext } from "./webgl2/SharedWebGL.js";
import { SharedWebGLContext } from "./webgl2/SharedWebGL.js";
import { WebGL2Renderer } from "./webgl2/WebGL2Renderer.js";
import { acquirePlotCanvas, hasWarmBackend } from "./webgl2/WarmCanvasPool.js";

export type { ChartRenderContext } from "./webgl2/SharedWebGL.js";
export { Canvas2DUnavailableError } from "./canvas2d/Canvas2DRenderer.js";

/**
 * The engine table: the only module that names the rendering engines. Engines are plain synchronous
 * factories, so `new Chart()` stays synchronous and nothing here is loaded lazily.
 */

/**
 * Factories of engines that do not bind a drawing buffer to the chart's own canvas when they are
 * created: Canvas 2D (a 2D context takes whatever size the canvas has later) and the shared WebGL2
 * context (the chart canvas is only a blit target). Every other factory, including the native
 * WebGL2 engine and any custom one, wants the canvas at its final size first, because a WebGL
 * drawing buffer created at the default 300x150 and then resized is reallocated. (A warm canvas
 * from the pool already has its context and buffer, so `createEngine` never pre-sizes it either.)
 */
const sizesCanvasLater = new WeakSet<ChartRendererFactory>();

const sizingLater = (factory: ChartRendererFactory): ChartRendererFactory => sizesCanvasLater.add(factory) && factory;

const webgl2 = (origin: RendererOrigin): ChartRendererFactory => ({ canvas }) => new WebGL2Renderer(canvas, { origin });
const canvas2d = (origin: RendererOrigin): ChartRendererFactory => sizingLater(({ canvas }) => new Canvas2DRenderer(canvas, origin));

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

/** Options for {@link autoRenderer}. */
export interface AutoRendererOptions {
  /**
   * Prefer the shared WebGL2 context over a per-chart one: `true` shares one context per document, or pass
   * a context from `createChartRenderContext()` to group charts. Charts still fall back to Canvas 2D when
   * WebGL2 is unavailable (`rendererInfo.fallbackFrom` is then `"shared"`). The plain `"shared"` name
   * stays strict and throws instead.
   */
  readonly shared?: boolean | ChartRenderContext;
}

/**
 * Renderer factory that uses WebGL2 and falls back to Canvas 2D when WebGL2 is unavailable or its
 * context cannot be created. `chart.rendererInfo.fallbackFrom` says when the fallback happened.
 * Same as `renderer: "auto"`, the default.
 */
export function autoRenderer(options: AutoRendererOptions = {}): ChartRendererFactory {
  const origin: RendererOrigin = { requested: "auto" };
  const shared = options.shared;
  const primary = shared ? sharedFactory(shared === true ? undefined : shared, origin) : webgl2(origin);
  const fallback = canvas2d({ ...origin, fallbackFrom: shared ? "shared" : "webgl2" });
  const factory: ChartRendererFactory = (context) => {
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
  // Both the shared engine and Canvas 2D take the canvas at whatever size it has later.
  return shared ? sizingLater(factory) : factory;
}

/**
 * Renderer factory backed by a WebGL2 context shared between charts. Without an argument every chart
 * on the document shares one context; pass a context from `createChartRenderContext()` to group
 * charts. Throws `WebGL2UnavailableError` when WebGL2 is unavailable. Same as `renderer: "shared"`.
 */
export function sharedRenderer(context?: ChartRenderContext): ChartRendererFactory {
  return sizingLater(sharedFactory(context, {}));
}

/** The shared engine with an origin: `context` (a `createChartRenderContext()` result) or the document's default context. */
function sharedFactory(context: ChartRenderContext | undefined, origin: RendererOrigin): ChartRendererFactory {
  if (context) return context instanceof SharedWebGLContext ? context.renderer(origin) : context.renderer();
  return (factoryContext) => {
    const doc = factoryContext.canvas.ownerDocument ?? globalThis.document;
    let target = documentContexts.get(doc);
    if (!target) documentContexts.set(doc, (target = new SharedWebGLContext(doc)));
    return target.renderer(origin)(factoryContext);
  };
}

/**
 * Optionally warm up WebGL2 before the first chart: at idle time it creates a context on a throwaway
 * canvas, compiles the chart programs, and releases it, so the GPU process is already running when a
 * chart mounts. Nothing needs it; charts work without it. The warm context is kept for about two
 * seconds, so call it shortly before charts mount (for example when a page that will show charts
 * loads). It does nothing on the server, in a browser without WebGL2, or when the browser refuses a
 * context, and it never throws.
 *
 * @param doc Document to warm; defaults to the global `document`. Pass an iframe or popup document.
 */
export function preloadWebGL(doc: Document | undefined = globalThis.document): void {
  if (!doc) return;
  const warmUp = (): void => {
    try {
      const canvas = acquirePlotCanvas(doc);
      const renderer = new WebGL2Renderer(canvas);
      for (const mode of ["line", "area", "scatter", "bar"] as const) renderer.prepare(mode, 1);
      renderer.dispose();
    } catch {
      // No WebGL2 (or no context): there is nothing to warm, and charts report that themselves.
    }
  };
  const view = doc.defaultView;
  if (view && typeof view.requestIdleCallback === "function") view.requestIdleCallback(warmUp, { timeout: 2_000 });
  else setTimeout(warmUp, 0);
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
export function createEngine(option: RendererChoice | ChartRendererFactory | undefined, canvas: HTMLCanvasElement, sizeCanvas?: () => void): ChartRenderer {
  let factory: ChartRendererFactory;
  if (typeof option === "function") factory = option;
  else if (option === undefined) factory = namedRenderers.auto();
  else if (Object.hasOwn(namedRenderers, option)) factory = namedRenderers[option]();
  else throw new TypeError(`ChartOptions.renderer must be one of ${rendererChoices.map((name) => `"${name}"`).join(", ")} or a factory such as canvas2dRenderer(), got ${typeof option === "string" ? `"${option}"` : typeof option}.`);
  // Sizing needs the plot's laid-out size, which forces a synchronous layout, so engines that can
  // be sized later skip it and the chart sizes the canvas on its first frame (many charts mounted in
  // one task then share one layout instead of each forcing their own). A warm canvas skips it too:
  // its context and drawing buffer already exist at the previous chart's size, so sizing it first
  // saves no reallocation, and the first frame resizes it only if the plot area differs.
  if (!sizesCanvasLater.has(factory) && !hasWarmBackend(canvas)) sizeCanvas?.();
  return factory({ canvas }) as ChartRenderer;
}
