import { describeRenderer } from "../ChartRenderer.js";
import type { ChartRenderer, ChartRendererCapabilities, ChartRendererFactory, ChartRendererFactoryContext, ChartRendererInfo, FrameReport, RenderProjection, RendererLossState } from "../ChartRenderer.js";
import { WebGL2Renderer } from "./WebGL2Renderer.js";
import type { GpuBackend } from "./types.js";
import type { RgbaColor, SeriesStyle } from "../../core/types.js";

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
  private renderer_: WebGL2Renderer | null = null;
  /**
   * @param doc Document that owns the hidden canvas; defaults to the first attached chart's document.
   * @param createBackend Builds the backend on the hidden canvas (a seam for tests).
   */
  constructor(private readonly doc?: Document, private readonly createBackend?: (canvas: HTMLCanvasElement) => GpuBackend) {}
  private readonly clients = new Set<SharedWebGLRenderer>();
  private readonly handleLoss = (state: RendererLossState): void => {
    for (const client of Array.from(this.clients)) client.notifyLoss(state);
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
      const doc = this.doc ?? client.ownerDocument ?? globalThis.document;
      if (!doc) throw new Error("A shared render context needs a DOM.");
      const canvas = doc.createElement("canvas");
      // Rendering happens in the shared canvas; it only needs a size, never to be attached to the page.
      // The engine owns the hidden canvas's loss/restore events and rebuilds itself; the context just fans them out.
      const renderer = new WebGL2Renderer(canvas, { createBackend: this.createBackend });
      renderer.setLossListener(this.handleLoss);
      this.canvas = canvas;
      this.renderer_ = renderer;
    }
    this.clients.add(client);
  }

  /** @internal */
  detach(client: SharedWebGLRenderer): void {
    this.clients.delete(client);
    this.teardownIfIdle();
  }

  /** @internal Prepare the shared canvas for a frame of `width` x `height` device pixels. */
  beginFrame(width: number, height: number, pixelRatio: number): WebGL2Renderer {
    const canvas = this.requireCanvas();
    // Resizing reallocates the drawing buffer, so only touch the size when the next chart differs.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const renderer = this.renderer_!;
    renderer.beginFrame(width, height, pixelRatio);
    return renderer;
  }

  /** @internal Submit the frame and return the canvas holding it. */
  endFrame(): { readonly source: HTMLCanvasElement; readonly report: FrameReport } {
    const report = this.renderer_?.endFrame() ?? { uploadBytes: 0, drawCalls: 0 };
    return { source: this.requireCanvas(), report };
  }

  /** @internal Whether the shared context is currently lost. */
  get isLost(): boolean {
    return this.renderer_?.isLost ?? false;
  }

  /** @internal Capabilities of the shared engine. */
  get capabilities(): ChartRendererCapabilities {
    return { gpu: true, contextLoss: true, shared: true, maxDrawingBufferPixels: this.renderer_?.info.capabilities.maxDrawingBufferPixels ?? 0 };
  }

  /** @internal The shared renderer; draw calls from the active chart go straight to it. */
  get active(): WebGL2Renderer {
    return this.renderer_!;
  }

  private requireCanvas(): HTMLCanvasElement {
    if (!this.canvas) throw new Error("The shared render context has no attached charts.");
    return this.canvas;
  }

  private teardownIfIdle(): void {
    if (this.clients.size > 0 || !this.canvas) return;
    const canvas = this.canvas;
    const renderer = this.renderer_;
    this.canvas = null;
    this.renderer_ = null;
    try {
      // Releases the WebGL context as well.
      renderer?.dispose();
    } catch {
      // Cleanup can throw while the context is lost; there is nothing left to free.
    }
    // Dropping the size frees the drawing buffer even if the browser keeps the context object around.
    canvas.width = 1;
    canvas.height = 1;
  }
}

/** @internal Per-chart renderer that draws into a `SharedWebGLContext` and blits into the chart canvas. */
class SharedWebGLRenderer implements ChartRenderer {
  readonly kind = "shared" as const;
  readonly info: ChartRendererInfo;
  private lossListener: ((state: RendererLossState) => void) | null = null;
  private readonly target: CanvasRenderingContext2D;
  private readonly chartCanvas: HTMLCanvasElement;
  private width = 1;
  private height = 1;
  private attached = true;

  /** @internal Document that owns the chart canvas. */
  get ownerDocument(): Document | undefined {
    return this.chartCanvas.ownerDocument ?? undefined;
  }

  constructor(private readonly shared: SharedWebGLContext, context: ChartRendererFactoryContext) {
    const target = context.canvas.getContext("2d");
    if (!target) throw new Error("BlazePlot could not create a 2D context on the chart canvas.");
    this.target = target;
    this.chartCanvas = context.canvas;
    shared.attach(this);
    this.info = describeRenderer("shared", shared.capabilities);
  }

  beginFrame(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.shared.beginFrame(this.width, this.height, pixelRatio);
  }

  get isLost(): boolean {
    return this.shared.isLost;
  }

  setLossListener(listener: ((state: RendererLossState) => void) | null): void {
    this.lossListener = listener;
  }

  endFrame(): FrameReport {
    const { source, report } = this.shared.endFrame();
    const target = this.target;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, this.width, this.height);
    // A lost shared context has no valid pixels; the chart keeps its previous image until it is restored.
    if (!this.shared.isLost) target.drawImage(source, 0, 0);
    return report;
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
    this.lossListener = null;
    this.shared.detach(this);
  }

  /** @internal Forward a shared-context loss or restore to the chart that owns this renderer. */
  notifyLoss(state: RendererLossState): void {
    this.lossListener?.(state);
  }
}
