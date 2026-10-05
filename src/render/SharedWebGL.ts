import type { ChartRenderer, ChartRendererFactory, ChartRendererFactoryContext } from "./ChartRenderer.js";
import { Renderer } from "./Renderer.js";
import type { RenderProjection } from "./Renderer.js";
import { releaseWebGLContext } from "./releaseWebGLContext.js";
import { WebGL2Backend } from "./WebGL2Backend.js";
import type { RgbaColor, SeriesStyle } from "../core/types.js";

/**
 * One hidden WebGL2 canvas that renders every attached chart's plot area in turn and copies the
 * result into each chart's own (2D) canvas with `drawImage`. Browsers cap live WebGL contexts per
 * page (about 16) and evict the oldest, so this keeps the page at one context no matter how many
 * charts it hosts. See `docs/internal/shared-render-context.md`.
 */
export interface ChartRenderContext {
  /** Renderer factory for `new Chart(el, { renderer: context.renderer() })`. */
  renderer(): ChartRendererFactory;
  /** Number of charts currently attached. */
  readonly chartCount: number;
  /** Detach nothing, but release the WebGL context now if no chart is attached. Charts release it themselves on dispose. */
  dispose(): void;
}

/** @internal Shared state of one render context; reference counted by attached charts. */
export class SharedWebGLContext implements ChartRenderContext {
  private canvas: HTMLCanvasElement | null = null;
  private renderer_: Renderer | null = null;
  private readonly clients = new Set<SharedWebGLRenderer>();
  private lost = false;
  private readonly handleLost = (event: Event): void => {
    // Allow the browser to restore the context, and tell every chart so it stops drawing.
    event.preventDefault();
    this.lost = true;
    for (const client of Array.from(this.clients)) client.notify("webglcontextlost");
  };
  private readonly handleRestored = (): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const previous = this.renderer_;
    try {
      this.renderer_ = new Renderer(new WebGL2Backend(canvas));
    } catch (error) {
      console.error("BlazePlot failed to restore the shared WebGL2 context.", error);
      return;
    }
    this.lost = false;
    try {
      previous?.dispose();
    } catch {
      // The previous renderer belonged to the lost context generation; nothing is left to free.
    }
    for (const client of Array.from(this.clients)) client.notify("webglcontextrestored");
  };

  get chartCount(): number {
    return this.clients.size;
  }

  renderer(): ChartRendererFactory {
    return (context) => new SharedWebGLRenderer(this, context);
  }

  dispose(): void {
    this.teardownIfIdle();
  }

  /** @internal */
  attach(client: SharedWebGLRenderer): void {
    if (!this.canvas) {
      if (typeof document === "undefined") throw new Error("A shared render context needs a DOM.");
      const canvas = document.createElement("canvas");
      // Rendering happens in the shared canvas; it only needs a size, never to be attached to the page.
      const renderer = new Renderer(new WebGL2Backend(canvas));
      canvas.addEventListener("webglcontextlost", this.handleLost);
      canvas.addEventListener("webglcontextrestored", this.handleRestored);
      this.canvas = canvas;
      this.renderer_ = renderer;
      this.lost = false;
    }
    this.clients.add(client);
  }

  /** @internal */
  detach(client: SharedWebGLRenderer): void {
    this.clients.delete(client);
    this.teardownIfIdle();
  }

  /** @internal Prepare the shared canvas for a frame of `width` x `height` device pixels. */
  beginFrame(width: number, height: number, pixelRatio: number): Renderer {
    const canvas = this.requireCanvas();
    // Resizing reallocates the drawing buffer, so only touch the size when the next chart differs.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const renderer = this.renderer_!;
    renderer.beginFrame(width, height, pixelRatio);
    return renderer;
  }

  /** @internal Submit the frame and return the canvas holding it. */
  endFrame(): HTMLCanvasElement {
    this.renderer_?.endFrame();
    return this.requireCanvas();
  }

  /** @internal Whether the shared context is currently lost. */
  get isLost(): boolean {
    return this.lost;
  }

  /** @internal The shared renderer; draw calls from the active chart go straight to it. */
  get active(): Renderer {
    return this.renderer_!;
  }

  private requireCanvas(): HTMLCanvasElement {
    if (!this.canvas) throw new Error("The shared render context has no attached charts.");
    return this.canvas;
  }

  private teardownIfIdle(): void {
    if (this.clients.size > 0 || !this.canvas) return;
    const canvas = this.canvas;
    canvas.removeEventListener("webglcontextlost", this.handleLost);
    canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    const renderer = this.renderer_;
    const gl = renderer?.getWebGLContext() ?? null;
    this.canvas = null;
    this.renderer_ = null;
    try {
      renderer?.dispose();
    } catch {
      // Cleanup can throw while the context is lost; the context is released below regardless.
    }
    releaseWebGLContext(gl);
    // Dropping the size frees the drawing buffer even if the browser keeps the context object around.
    canvas.width = 1;
    canvas.height = 1;
  }
}

/** @internal Per-chart renderer that draws into a `SharedWebGLContext` and blits into the chart canvas. */
class SharedWebGLRenderer implements ChartRenderer {
  readonly kind = "webgl2-shared" as const;
  private readonly target: CanvasRenderingContext2D;
  private readonly chartCanvas: HTMLCanvasElement;
  private width = 1;
  private height = 1;
  private attached = true;

  constructor(private readonly shared: SharedWebGLContext, context: ChartRendererFactoryContext) {
    const target = context.canvas.getContext("2d");
    if (!target) throw new Error("BlazePlot could not create a 2D context on the chart canvas.");
    this.target = target;
    this.chartCanvas = context.canvas;
    shared.attach(this);
  }

  beginFrame(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.shared.beginFrame(this.width, this.height, pixelRatio);
  }

  endFrame(): void {
    const source = this.shared.endFrame();
    const target = this.target;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, this.width, this.height);
    // A lost shared context has no valid pixels; the chart keeps its previous image until it is restored.
    if (!this.shared.isLost) target.drawImage(source, 0, 0);
  }

  getWebGLContext(): null {
    // The context is shared between charts; no chart or plugin may keep or release it.
    return null;
  }

  drawLines(data: Float32Array, vertexCount: number, color: RgbaColor, lineWidth: number, projection: RenderProjection, primitive?: "line_strip" | "lines"): void {
    this.shared.active.drawLines(data, vertexCount, color, lineWidth, projection, primitive);
  }

  drawClipLines(data: Float32Array, vertexCount: number, color: RgbaColor): void {
    this.shared.active.drawClipLines(data, vertexCount, color);
  }

  drawPoints(data: Float32Array, pointCount: number, color: RgbaColor, pointSize: number, projection: RenderProjection): void {
    this.shared.active.drawPoints(data, pointCount, color, pointSize, projection);
  }

  drawBarsInstanced(data: Float32Array, barCount: number, style: SeriesStyle, projection: RenderProjection, yOrigin: number = 0): void {
    this.shared.active.drawBarsInstanced(data, barCount, style, projection, yOrigin);
  }

  drawTriangles(data: Float32Array, vertexCount: number, color: RgbaColor, projection: RenderProjection, primitive?: "triangles" | "triangle_strip"): void {
    this.shared.active.drawTriangles(data, vertexCount, color, projection, primitive);
  }

  dispose(): void {
    if (!this.attached) return;
    this.attached = false;
    this.shared.detach(this);
  }

  /** @internal Re-dispatch a shared-context event on this chart's canvas, where the chart listens for it. */
  notify(type: "webglcontextlost" | "webglcontextrestored"): void {
    this.chartCanvas.dispatchEvent(new Event(type, { cancelable: true }));
  }
}
