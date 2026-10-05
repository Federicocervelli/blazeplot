import type { ChartRenderer, ChartRendererCapabilities, FrameReport, RenderProjection, RendererLossState } from "../ChartRenderer.js";
import type { RgbaColor, SeriesStyle } from "../../core/types.js";

/** Error thrown when a Canvas 2D renderer cannot be created. */
export class Canvas2DUnavailableError extends Error {
  /** Create an unavailable-Canvas-2D error. */
  constructor(message = "BlazePlot could not create a Canvas 2D context on the chart canvas.") {
    super(message);
    this.name = "Canvas2DUnavailableError";
  }
}

/** Typical desktop-browser limit on a canvas's area; browsers do not expose it. */
const MAX_CANVAS_PIXELS = 16_384 * 16_384;

/** Device-pixel mapping of the linear data -> clip projection (y flipped). */
interface PixelMap {
  sx: number;
  ox: number;
  sy: number;
  oy: number;
}

/** @internal CPU-projected Canvas 2D implementation of `ChartRenderer`, used without WebGL2. */
export class Canvas2DRenderer implements ChartRenderer {
  readonly kind = "canvas2d" as const;
  readonly capabilities: ChartRendererCapabilities = { gpu: false, contextLoss: true, shared: false, maxDrawingBufferPixels: MAX_CANVAS_PIXELS };
  private readonly ctx: CanvasRenderingContext2D;
  private lossListener: ((state: RendererLossState) => void) | null = null;
  private lost = false;
  private drawCalls = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private readonly map: PixelMap = { sx: 0, ox: 0, sy: 0, oy: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Canvas2DUnavailableError();
    this.ctx = ctx;
    canvas.addEventListener("contextlost", this.handleContextLost);
    canvas.addEventListener("contextrestored", this.handleContextRestored);
  }

  get isLost(): boolean {
    return this.lost || this.ctx.isContextLost?.() === true;
  }

  setLossListener(listener: ((state: RendererLossState) => void) | null): void {
    this.lossListener = listener;
  }

  beginFrame(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = Math.max(1, pixelRatio);
    this.drawCalls = 0;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** Canvas 2D draws immediately in each draw call, so there is nothing left to submit or upload. */
  endFrame(): FrameReport {
    return { uploadBytes: 0, drawCalls: this.drawCalls };
  }

  drawLines(
    data: Float32Array,
    vertexCount: number,
    color: RgbaColor,
    lineWidth: number,
    projection: RenderProjection,
    primitive: "line_strip" | "lines" = "line_strip",
  ): void {
    this.drawCalls++;
    const d = data;
    const n = Math.min(vertexCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const ctx = this.ctx;
    ctx.beginPath();
    if (primitive === "line_strip") {
      let pen = false;
      for (let i = 0; i < n; i++) {
        const x = d[i * 2]!;
        const y = d[i * 2 + 1]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x * sx + ox, y * sy + oy);
        else {
          ctx.moveTo(x * sx + ox, y * sy + oy);
          pen = true;
        }
      }
    } else {
      for (let i = 0; i + 1 < n; i += 2) {
        const x0 = d[i * 2]!;
        const y0 = d[i * 2 + 1]!;
        const x1 = d[i * 2 + 2]!;
        const y1 = d[i * 2 + 3]!;
        if (!Number.isFinite(x0 + y0 + x1 + y1)) continue;
        ctx.moveTo(x0 * sx + ox, y0 * sy + oy);
        ctx.lineTo(x1 * sx + ox, y1 * sy + oy);
      }
    }
    this.stroke(color, Math.max(1, lineWidth * this.pixelRatio));
  }

  drawClipLines(data: Float32Array, vertexCount: number, color: RgbaColor): void {
    this.drawCalls++;
    const d = data;
    const n = Math.min(vertexCount, d.length >> 1);
    const hw = this.width * 0.5;
    const hh = this.height * 0.5;
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i + 1 < n; i += 2) {
      let x0 = (d[i * 2]! + 1) * hw;
      let y0 = (1 - d[i * 2 + 1]!) * hh;
      let x1 = (d[i * 2 + 2]! + 1) * hw;
      let y1 = (1 - d[i * 2 + 3]!) * hh;
      // Snap axis-aligned grid lines to pixel centers so 1px lines stay crisp.
      if (x0 === x1) x0 = x1 = Math.min(Math.floor(x0), this.width - 1) + 0.5;
      if (y0 === y1) y0 = y1 = Math.min(Math.floor(y0), this.height - 1) + 0.5;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    this.stroke(color, 1);
  }

  drawPoints(data: Float32Array, pointCount: number, color: RgbaColor, pointSize: number, projection: RenderProjection): void {
    this.drawCalls++;
    const d = data;
    const n = Math.min(pointCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const radius = Math.max(0.5, pointSize * this.pixelRatio * 0.5);
    const ctx = this.ctx;
    ctx.fillStyle = css(color);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = d[i * 2]! * sx + ox;
      const y = d[i * 2 + 1]! * sy + oy;
      if (!Number.isFinite(x + y)) continue;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  drawBarsInstanced(data: Float32Array, barCount: number, style: SeriesStyle, projection: RenderProjection, yOrigin: number = 0): void {
    this.drawCalls++;
    const d = data;
    const n = Math.min(barCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const half = style.barWidth * 0.5;
    const base = (style.baseline - yOrigin) * sy + oy;
    this.ctx.fillStyle = css(style.color);
    for (let i = 0; i < n; i++) {
      const x = d[i * 2]!;
      const y = d[i * 2 + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      this.fillSnapped((x - half) * sx + ox, y * sy + oy, (x + half) * sx + ox, base);
    }
  }

  drawTriangles(
    data: Float32Array,
    vertexCount: number,
    color: RgbaColor,
    projection: RenderProjection,
    primitive: "triangles" | "triangle_strip" = "triangles",
  ): void {
    this.drawCalls++;
    const d = data;
    const n = Math.min(vertexCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const ctx = this.ctx;
    ctx.fillStyle = css(color);

    if (primitive === "triangle_strip") {
      // A strip is a ribbon: even vertices run along one edge, odd vertices along the other.
      if (n < 3) return;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i += 2) {
        const x = d[i * 2]! * sx + ox;
        const y = d[i * 2 + 1]! * sy + oy;
        if (!Number.isFinite(x + y)) continue;
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      for (let i = (n - 1) | 1; i >= 1; i -= 2) {
        if (i >= n) continue;
        const x = d[i * 2]! * sx + ox;
        const y = d[i * 2 + 1]! * sy + oy;
        if (Number.isFinite(x + y)) ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }

    // The chart emits axis-aligned rectangles as two triangles (6 vertices). Fill those with
    // pixel-snapped rects so adjacent dense buckets leave no antialiasing seams; anything else is
    // filled as plain triangles.
    let generic: Path2D | null = null;
    for (let v = 0; v + 5 < n; v += 6) {
      const o = v * 2;
      if (isRectPair(d, o)) {
        this.fillSnapped(d[o]! * sx + ox, d[o + 1]! * sy + oy, d[o + 2]! * sx + ox, d[o + 5]! * sy + oy);
        continue;
      }
      generic ??= new Path2D();
      for (let t = 0; t < 2; t++) {
        const p = o + t * 6;
        const x0 = d[p]! * sx + ox;
        const y0 = d[p + 1]! * sy + oy;
        const x1 = d[p + 2]! * sx + ox;
        const y1 = d[p + 3]! * sy + oy;
        const x2 = d[p + 4]! * sx + ox;
        const y2 = d[p + 5]! * sy + oy;
        if (!Number.isFinite(x0 + y0 + x1 + y1 + x2 + y2)) continue;
        generic.moveTo(x0, y0);
        generic.lineTo(x1, y1);
        generic.lineTo(x2, y2);
        generic.closePath();
      }
    }
    if (generic) ctx.fill(generic);
  }

  dispose(): void {
    this.canvas.removeEventListener("contextlost", this.handleContextLost);
    this.canvas.removeEventListener("contextrestored", this.handleContextRestored);
    this.lossListener = null;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.lossListener?.("lost");
  };

  private readonly handleContextRestored = (): void => {
    // The 2D state is reset on restore; every frame sets its transform again, so nothing needs rebuilding.
    this.lost = false;
    this.lossListener?.("restored");
  };

  private project(p: RenderProjection): PixelMap {
    const m = this.map;
    m.sx = p.scaleX * this.width * 0.5;
    m.ox = (p.offsetX + 1) * this.width * 0.5;
    m.sy = -p.scaleY * this.height * 0.5;
    m.oy = (1 - p.offsetY) * this.height * 0.5;
    return m;
  }

  private stroke(color: RgbaColor, width: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = css(color);
    ctx.lineWidth = width;
    ctx.lineJoin = width > 1.5 ? "round" : "miter";
    ctx.lineCap = "butt";
    ctx.stroke();
  }

  /** Fill the rectangle spanned by two device-pixel corners, snapped to whole pixels and at least 1px each way. */
  private fillSnapped(xa: number, ya: number, xb: number, yb: number): void {
    if (!Number.isFinite(xa + ya + xb + yb)) return;
    if (xa === xb || ya === yb) return;
    const left = Math.round(Math.min(xa, xb));
    const top = Math.round(Math.min(ya, yb));
    const right = Math.max(Math.round(Math.max(xa, xb)), left + 1);
    const bottom = Math.max(Math.round(Math.max(ya, yb)), top + 1);
    if (right < 0 || bottom < 0 || left > this.width || top > this.height) return;
    this.ctx.fillRect(left, top, right - left, bottom - top);
  }
}

function css(color: RgbaColor): string {
  return `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${color[3]})`;
}

/** Whether vertices `[o, o + 12)` are `(x0,y0) (x1,y0) (x0,y1) (x0,y1) (x1,y0) (x1,y1)`. */
function isRectPair(d: Float32Array, o: number): boolean {
  return (
    d[o + 3] === d[o + 1] &&
    d[o + 4] === d[o] &&
    d[o + 6] === d[o] &&
    d[o + 7] === d[o + 5] &&
    d[o + 8] === d[o + 2] &&
    d[o + 9] === d[o + 1] &&
    d[o + 10] === d[o + 2] &&
    d[o + 11] === d[o + 5]
  );
}
