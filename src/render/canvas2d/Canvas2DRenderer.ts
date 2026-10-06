import { describeRenderer } from "../ChartRenderer.js";
import type { ChartRenderer, ChartRendererInfo, FrameReport, RenderProjection, RendererLossState, RendererOrigin } from "../ChartRenderer.js";
import type { RgbaColor, SeriesStyle } from "../../core/types.js";

/** Error thrown when a Canvas 2D renderer cannot be created. */
export class Canvas2DUnavailableError extends Error {
  /** Create an unavailable-Canvas-2D error. */
  constructor(message = "BlazePlot could not create a Canvas 2D context on the chart canvas.") {
    super(message);
    this.name = "Canvas2DUnavailableError";
  }
}

/**
 * Stroke width, in device pixels, up to which a line counts as thin: it is stroked with mitered joins and may
 * be reduced to its pixel columns (see `tracePolyline`). Wider strokes keep every vertex and round joins,
 * because their sub-pixel geometry is visible (and costs, as WebGL does, proportionally more anyway).
 */
const THIN_STROKE_PX = 1.5;

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
  readonly info: ChartRendererInfo;
  private readonly ctx: CanvasRenderingContext2D;
  private lossListener: ((state: RendererLossState) => void) | null = null;
  private lost = false;
  private drawCalls = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private readonly map: PixelMap = { sx: 0, ox: 0, sy: 0, oy: 0 };
  /** What was last written to the context's `fillStyle`, `strokeStyle`, `lineWidth`, and `lineJoin` this frame. */
  private fill: string | null = null;
  private strokeColor: string | null = null;
  private strokeWidth = NaN;
  private strokeJoin: string | null = null;
  /** Scratch for the float color of the rect being filled (compared with `fill` before a string is built). */
  private readonly rectColor: [number, number, number, number] = [0, 0, 0, 0];

  constructor(private readonly canvas: HTMLCanvasElement, origin?: RendererOrigin) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Canvas2DUnavailableError();
    this.ctx = ctx;
    this.info = describeRenderer("canvas2d", { gpu: false, contextLoss: true, shared: false, maxDrawingBufferPixels: MAX_CANVAS_PIXELS }, origin);
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
    // Style state lives on the context (a restore resets it), so forget what was last set and set it per frame.
    this.fill = null;
    this.strokeColor = null;
    this.strokeWidth = NaN;
    this.strokeJoin = null;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** Canvas 2D draws immediately in each draw call, so there is nothing left to submit or upload. */
  endFrame(): FrameReport {
    return { uploadBytes: 0, drawCalls: this.drawCalls };
  }

  drawLines(
    d: Float32Array,
    vertexCount: number,
    color: RgbaColor,
    lineWidth: number,
    projection: RenderProjection,
    primitive: "line_strip" | "lines" = "line_strip",
  ): void {
    this.drawCalls++;
    const n = Math.min(vertexCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const ctx = this.ctx;
    const width = Math.max(1, lineWidth * this.pixelRatio);
    ctx.beginPath();
    if (primitive === "line_strip") this.tracePolyline(d, n, sx, ox, sy, oy, width <= THIN_STROKE_PX);
    else this.traceSegments(d, n, sx, ox, sy, oy, false);
    this.stroke(color, width);
  }

  /**
   * Add a polyline through `n` data-space vertices to the current path; with `reduce`, reduced to its pixel columns.
   *
   * A device pixel can only show one column of ink, so a run of consecutive vertices that land in the same
   * pixel column is replaced by the vertices that define what that column looks like: the first, the lowest
   * and highest (in the order they occurred), and the last. Everything dropped lies strictly between those
   * in the column, so no spike or dip is lost and the line enters and leaves the column exactly as before;
   * only sub-pixel wiggles inside one column disappear. The two extremes are placed on the column's pixel
   * center: a vertical stroke there fills its pixel column the way the overdraw of many sub-pixel strokes
   * does, where at their true x they would straddle two columns and read lighter than the unreduced line
   * (this keeps a dense, noisy 1px trace within the cross-engine ink tolerance). Canvas 2D strokes cost per path segment, so a 10k
   * sample window on a 1k pixel plot (dense raw data is the common live-chart case) emits about a third of
   * the segments, while sparse data, with at most one vertex per column, passes through unchanged. The
   * reduction depends only on the projected geometry, never on the series, and a non-finite vertex still
   * breaks the line. Only thin strokes (<= `THIN_STROKE_PX`) reduce: a wider stroke makes the sub-pixel x
   * spread of a column visible. Each column is scanned in one inner loop so all of its state lives in locals.
   */
  private tracePolyline(d: Float32Array, n: number, sx: number, ox: number, sy: number, oy: number, reduce: boolean): void {
    const ctx = this.ctx;
    let pen = false;
    let i = 0;
    while (i < n) {
      const fx = d[i * 2]!;
      const fy = d[i * 2 + 1]!;
      i++;
      if (!Number.isFinite(fx + fy)) {
        pen = false;
        continue;
      }
      const firstX = fx * sx + ox;
      const firstY = fy * sy + oy;
      const key = Math.floor(firstX);
      let lastX = firstX;
      let lastY = firstY;
      let minY = firstY;
      let maxY = firstY;
      let minAt = 0;
      let maxAt = 0;
      let count = 1;
      for (; i < n; i++) {
        const dx = d[i * 2]!;
        const dy = d[i * 2 + 1]!;
        if (!Number.isFinite(dx + dy)) break;
        const x = dx * sx + ox;
        if (!reduce || Math.floor(x) !== key) break;
        const y = dy * sy + oy;
        lastX = x;
        lastY = y;
        if (y < minY) {
          minY = y;
          minAt = count;
        }
        if (y > maxY) {
          maxY = y;
          maxAt = count;
        }
        count++;
      }

      if (pen) ctx.lineTo(firstX, firstY);
      else {
        ctx.moveTo(firstX, firstY);
        pen = true;
      }
      if (count === 1) continue;
      // Extremes strictly inside the column; the first and last vertices are emitted anyway.
      const lowFirst = minAt < maxAt;
      const firstAt = lowFirst ? minAt : maxAt;
      const secondAt = lowFirst ? maxAt : minAt;
      if (firstAt > 0 && firstAt < count - 1) ctx.lineTo(key + 0.5, lowFirst ? minY : maxY);
      if (secondAt > 0 && secondAt < count - 1) ctx.lineTo(key + 0.5, lowFirst ? maxY : minY);
      ctx.lineTo(lastX, lastY);
    }
  }

  /** Add independent segments (`n` vertices, two per segment) to the current path; with `snap`, axis-aligned ones sit on pixel centers. */
  private traceSegments(d: Float32Array, n: number, sx: number, ox: number, sy: number, oy: number, snap: boolean): void {
    const ctx = this.ctx;
    for (let i = 0; i + 1 < n; i += 2) {
      let x0 = d[i * 2]! * sx + ox;
      let y0 = d[i * 2 + 1]! * sy + oy;
      let x1 = d[i * 2 + 2]! * sx + ox;
      let y1 = d[i * 2 + 3]! * sy + oy;
      if (!Number.isFinite(x0 + y0 + x1 + y1)) continue;
      // Snapped grid lines stay crisp at 1px.
      if (snap && x0 === x1) x0 = x1 = Math.min(Math.floor(x0), this.width - 1) + 0.5;
      if (snap && y0 === y1) y0 = y1 = Math.min(Math.floor(y0), this.height - 1) + 0.5;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
  }

  drawClipLines(d: Float32Array, vertexCount: number, color: RgbaColor): void {
    this.drawCalls++;
    const hw = this.width * 0.5;
    const hh = this.height * 0.5;
    this.ctx.beginPath();
    // Clip space is the pixel map x * hw + hw, y * -hh + hh.
    this.traceSegments(d, Math.min(vertexCount, d.length >> 1), hw, hw, -hh, hh, true);
    this.stroke(color, 1);
  }

  drawPoints(d: Float32Array, pointCount: number, color: RgbaColor, pointSize: number, projection: RenderProjection): void {
    this.drawCalls++;
    const n = Math.min(pointCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const radius = Math.max(0.5, pointSize * this.pixelRatio * 0.5);
    const ctx = this.ctx;
    this.setFill(color);
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

  drawBarsInstanced(d: Float32Array, barCount: number, style: SeriesStyle, projection: RenderProjection, yOrigin: number = 0): void {
    this.drawCalls++;
    const n = Math.min(barCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const half = style.barWidth * 0.5;
    const base = (style.baseline - yOrigin) * sy + oy;
    this.setFill(style.color);
    // One path and one fill for the whole batch instead of a fill call per bar.
    this.ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = d[i * 2]!;
      const y = d[i * 2 + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      this.addSnappedRect((x - half) * sx + ox, y * sy + oy, (x + half) * sx + ox, base);
    }
    this.ctx.fill();
  }

  drawTriangles(
    d: Float32Array,
    vertexCount: number,
    color: RgbaColor,
    projection: RenderProjection,
    primitive: "triangles" | "triangle_strip" = "triangles",
  ): void {
    this.drawCalls++;
    const n = Math.min(vertexCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const ctx = this.ctx;
    this.setFill(color);

    if (primitive === "triangle_strip") {
      // A strip is a ribbon: even vertices run along one edge, odd vertices along the other. A pair with a
      // non-finite vertex breaks the strip, as the triangles that touch it vanish on a GPU, so each run of
      // complete pairs is its own closed subpath (along the even vertices, then back along the odd ones)
      // instead of bridging the gap; all of them are filled with one fill.
      const pairs = n >> 1;
      let runStart = -1;
      ctx.beginPath();
      for (let pair = 0; pair <= pairs; pair++) {
        const complete = pair < pairs && Number.isFinite(d[pair * 4]! + d[pair * 4 + 1]! + d[pair * 4 + 2]! + d[pair * 4 + 3]!);
        if (complete) {
          if (runStart < 0) runStart = pair;
          continue;
        }
        if (runStart >= 0 && pair - runStart >= 2) {
          ctx.moveTo(d[runStart * 4]! * sx + ox, d[runStart * 4 + 1]! * sy + oy);
          for (let p = runStart + 1; p < pair; p++) ctx.lineTo(d[p * 4]! * sx + ox, d[p * 4 + 1]! * sy + oy);
          for (let p = pair - 1; p >= runStart; p--) ctx.lineTo(d[p * 4 + 2]! * sx + ox, d[p * 4 + 3]! * sy + oy);
          ctx.closePath();
        }
        runStart = -1;
      }
      ctx.fill();
      return;
    }

    // The chart emits axis-aligned rectangles as two triangles (6 vertices). Fill those as pixel-snapped
    // rects so adjacent dense buckets leave no antialiasing seams, all in one path with one fill (a dense
    // min/max line is one rect per pixel column, and a fill call per rect dominates its frame time);
    // anything else is filled as plain triangles.
    let generic: Path2D | null = null;
    ctx.beginPath();
    for (let v = 0; v + 5 < n; v += 6) {
      const o = v * 2;
      if (isRectPair(d, o)) {
        this.addSnappedRect(d[o]! * sx + ox, d[o + 1]! * sy + oy, d[o + 2]! * sx + ox, d[o + 5]! * sy + oy);
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
    ctx.fill();
    // Free triangles keep their own path: its winding is unrelated to the rects', and a shared nonzero fill
    // would cancel where opposite windings overlap.
    if (generic) ctx.fill(generic);
  }

  fillRects(rects: Float32Array, count: number): void {
    this.drawCalls++;
    const n = Math.min(count, rects.length >> 3);
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      const x = rects[o]!;
      const y = rects[o + 1]!;
      const w = rects[o + 2]!;
      const h = rects[o + 3]!;
      if (!Number.isFinite(x + y + w + h)) continue;
      if (x + w < 0 || y + h < 0 || x > this.width || y > this.height) continue;
      // Rect colors arrive as floats, so compare them with the last fill color before building a string.
      const r = rects[o + 4]!;
      const g = rects[o + 5]!;
      const b = rects[o + 6]!;
      const a = rects[o + 7]!;
      const last = this.rectColor;
      if (this.fill === null || last[0] !== r || last[1] !== g || last[2] !== b || last[3] !== a) {
        last[0] = r;
        last[1] = g;
        last[2] = b;
        last[3] = a;
        const next = css(last);
        if (next !== this.fill) ctx.fillStyle = this.fill = next;
      }
      ctx.fillRect(x, y, w, h);
    }
  }

  createSurface(canvas: HTMLCanvasElement): ChartRenderer {
    return new Canvas2DRenderer(canvas);
  }

  dispose(): void {
    this.canvas.removeEventListener("contextlost", this.handleContextLost);
    this.canvas.removeEventListener("contextrestored", this.handleContextRestored);
    this.lossListener = null;
    this.beginFrame(this.width, this.height, this.pixelRatio);
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
    const next = cssOf(color);
    if (next !== this.strokeColor) ctx.strokeStyle = this.strokeColor = next;
    if (width !== this.strokeWidth) ctx.lineWidth = this.strokeWidth = width;
    const join = width > THIN_STROKE_PX ? "round" : "miter";
    if (join !== this.strokeJoin) ctx.lineJoin = this.strokeJoin = join;
    ctx.stroke();
  }

  /** Set the fill color unless the context already has it. */
  private setFill(color: RgbaColor): void {
    const next = cssOf(color);
    if (next !== this.fill) this.ctx.fillStyle = this.fill = next;
    this.rectColor[3] = NaN;
  }

  /**
   * Add the rectangle spanned by two device-pixel corners to the current path, snapped to whole pixels and
   * at least 1px each way. Callers fill a whole batch of these with one `fill()`.
   */
  private addSnappedRect(xa: number, ya: number, xb: number, yb: number): void {
    if (!Number.isFinite(xa + ya + xb + yb)) return;
    if (xa === xb || ya === yb) return;
    const left = Math.round(Math.min(xa, xb));
    const top = Math.round(Math.min(ya, yb));
    const right = Math.max(Math.round(Math.max(xa, xb)), left + 1);
    const bottom = Math.max(Math.round(Math.max(ya, yb)), top + 1);
    if (right < 0 || bottom < 0 || left > this.width || top > this.height) return;
    this.ctx.rect(left, top, right - left, bottom - top);
  }
}


/** CSS strings by color tuple: series styles are resolved once, so every frame after the first hits. */
const cssCache = new WeakMap<RgbaColor, string>();

function cssOf(color: RgbaColor): string {
  let value = cssCache.get(color);
  if (value === undefined) {
    value = css(color);
    cssCache.set(color, value);
  }
  return value;
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
