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

/** Borderless shapes at most this many device pixels across are dots: batched by color (see `fillShapes`). */
const DOT_SHAPE_PX = 8;
/** Dots at most this many device pixels across (2 CSS pixels on a phone) are filled as plain rectangles: their corners cannot show. */
const TINY_SHAPE_PX = 5;
/** The side of a square with a unit-diameter circle's area. */
const EQUAL_AREA_SQUARE = Math.sqrt(Math.PI) / 2;

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
  /** One path per dot color, reused by `fillShapes` (a frame is synchronous, so one map serves every call). */
  private dotPaths: Map<number, { fill: string; path: Path2D; used: boolean }> | undefined;
  /** The snapped rectangle `addSnappedRect` has not yet added to the path (it may still absorb the next ones). */
  private rectOpen = false;
  private rectLeft = 0;
  private rectTop = 0;
  private rectRight = 0;
  private rectBottom = 0;

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
    let n = Math.min(vertexCount, d.length >> 1);
    const { sx, ox, sy, oy } = this.project(projection);
    const ctx = this.ctx;
    const width = Math.max(1, lineWidth * this.pixelRatio);
    ctx.beginPath();
    // A non-finite projection puts every vertex off the canvas; the staged path marks subpaths with NaN, so skip it.
    if (!Number.isFinite(sx + ox + sy + oy)) n = 0;
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
    // The reduced points are staged and replayed into the canvas in a second, tight loop: interleaving the
    // reduction arithmetic with the native `lineTo` calls is about a quarter slower than running each alone.
    // At most one point per vertex plus one subpath marker per vertex.
    if (pathScratch.length < n * 4 + 8) pathScratch = new Float64Array(n * 4 + 8);
    const out = pathScratch;
    let o = 0;
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

      if (!pen) {
        // A NaN x marks the start of a subpath: the next point is a `moveTo`.
        out[o++] = NaN;
        out[o++] = 0;
        pen = true;
      }
      out[o++] = firstX;
      out[o++] = firstY;
      if (count === 1) continue;
      // Extremes strictly inside the column; the first and last vertices are emitted anyway.
      const lowFirst = minAt < maxAt;
      const firstAt = lowFirst ? minAt : maxAt;
      const secondAt = lowFirst ? maxAt : minAt;
      if (firstAt > 0 && firstAt < count - 1) {
        out[o++] = key + 0.5;
        out[o++] = lowFirst ? minY : maxY;
      }
      if (secondAt > 0 && secondAt < count - 1) {
        out[o++] = key + 0.5;
        out[o++] = lowFirst ? maxY : minY;
      }
      out[o++] = lastX;
      out[o++] = lastY;
    }

    const ctx = this.ctx;
    let move = false;
    for (let k = 0; k < o; k += 2) {
      const x = out[k]!;
      if (x !== x) {
        move = true;
        continue;
      }
      if (move) {
        ctx.moveTo(x, out[k + 1]!);
        move = false;
      } else ctx.lineTo(x, out[k + 1]!);
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
    this.flushRect();
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
    this.flushRect();
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

  /**
   * Rounded shapes with an inner border (see `ChartRenderSurface.fillShapes`). Consecutive borderless
   * shapes of one color share a path and one fill; a bordered shape is filled and stroked on its own so
   * a later shape still covers an earlier one's border, as on the GPU.
   */
  fillShapes(shapes: Float32Array, count: number): void {
    this.drawCalls++;
    const n = Math.min(count, Math.floor(shapes.length / 14));
    const ctx = this.ctx;
    let open = false;
    let openKey = -1;
    // Dots (borderless shapes a few pixels across) go into one path per color and are filled together: a graph's
    // dots alternate colors, and a fill per dot is what makes tens of thousands slow. Only overlapping dots of
    // different colors could tell the order apart, at that size. Larger or bordered shapes keep their order,
    // after every dot before them.
    const dots = typeof Path2D === "undefined" ? null : (this.dotPaths ??= new Map());
    let dotted = false;
    const flushDots = (): void => {
      if (!dotted || !dots) return;
      for (const bucket of dots.values()) {
        if (!bucket.used) continue;
        if (bucket.fill !== this.fill) ctx.fillStyle = this.fill = bucket.fill;
        ctx.fill(bucket.path);
        bucket.path = new Path2D();
        bucket.used = false;
      }
      this.rectColor[3] = NaN;
      dotted = false;
    };
    for (let i = 0; i < n; i++) {
      const o = i * 14;
      const x = shapes[o]!;
      const y = shapes[o + 1]!;
      const w = shapes[o + 2]!;
      const h = shapes[o + 3]!;
      if (!Number.isFinite(x + y + w + h + shapes[o + 4]! + shapes[o + 5]!) || !(w > 0) || !(h > 0)) continue;
      if (x + w < 0 || y + h < 0 || x > this.width || y > this.height) continue;
      const half = Math.min(w, h) / 2;
      const radius = Math.min(Math.max(0, shapes[o + 4]!), half);
      const border = Math.min(Math.max(0, shapes[o + 5]!), half);
      const bordered = border > 0 && shapes[o + 13]! > 0;
      const key = colorKey(shapes[o + 6]!, shapes[o + 7]!, shapes[o + 8]!, shapes[o + 9]!);
      if (dots && !bordered && w <= DOT_SHAPE_PX && h <= DOT_SHAPE_PX) {
        let bucket = dots.get(key);
        if (!bucket) {
          bucket = { fill: rgbaString(shapes[o + 6]!, shapes[o + 7]!, shapes[o + 8]!, shapes[o + 9]!), path: new Path2D(), used: false };
          dots.set(key, bucket);
        }
        traceDot(bucket.path, x, y, w, h, radius);
        bucket.used = true;
        dotted = true;
        continue;
      }
      // An open path is filled before pending dots are, since flushing them changes the fill color.
      if (open && (bordered || key !== openKey || dotted)) {
        ctx.fill();
        open = false;
      }
      flushDots();
      if (!open) {
        const fill = rgbaString(shapes[o + 6]!, shapes[o + 7]!, shapes[o + 8]!, shapes[o + 9]!);
        if (fill !== this.fill) ctx.fillStyle = this.fill = fill;
        this.rectColor[3] = NaN;
        ctx.beginPath();
        open = true;
        openKey = key;
      }
      traceRoundRect(ctx, x, y, w, h, radius, false);
      if (!bordered) continue;
      ctx.fill();
      open = false;
      // The border lies inside the shape: stroke the path inset by half its width.
      const inset = border / 2;
      const stroke = rgbaString(shapes[o + 10]!, shapes[o + 11]!, shapes[o + 12]!, shapes[o + 13]!);
      if (stroke !== this.strokeColor) ctx.strokeStyle = this.strokeColor = stroke;
      if (border !== this.strokeWidth) ctx.lineWidth = this.strokeWidth = border;
      ctx.beginPath();
      traceRoundRect(ctx, x + inset, y + inset, w - border, h - border, Math.max(0, radius - inset), true);
      ctx.stroke();
    }
    if (open) ctx.fill();
    flushDots();
  }


  /**
   * Segments with per-segment width, dash, and color (see `ChartRenderSurface.strokeSegments`).
   * Consecutive segments with the same style share one path and one stroke.
   */
  strokeSegments(segments: Float32Array, count: number): void {
    this.drawCalls++;
    const n = Math.min(count, Math.floor(segments.length / 12));
    const ctx = this.ctx;
    let open = false;
    // The style of the open stroke, compared as raw floats so no string is built per segment.
    let r = NaN;
    let g = NaN;
    let b = NaN;
    let a = NaN;
    let lineWidth = NaN;
    let dashLength = NaN;
    let gapLength = NaN;
    let strokeOffset = 0;
    // Where the last segment ended, and how far along its dash pattern: a segment that continues it joins
    // the same subpath, whose dashes Canvas 2D carries on by itself.
    let lastX = NaN;
    let lastY = NaN;
    let along = 0;
    const flush = (): void => {
      if (!open) return;
      ctx.stroke();
      open = false;
    };
    for (let i = 0; i < n; i++) {
      const o = i * 12;
      const x0 = segments[o]!;
      const y0 = segments[o + 1]!;
      const x1 = segments[o + 2]!;
      const y1 = segments[o + 3]!;
      const width = segments[o + 4]!;
      if (!Number.isFinite(x0 + y0 + x1 + y1 + width) || !(width > 0)) continue;
      if ((x0 > x1 ? x0 : x1) + width < 0 || (y0 > y1 ? y0 : y1) + width < 0 || (x0 < x1 ? x0 : x1) - width > this.width || (y0 < y1 ? y0 : y1) - width > this.height) continue;
      const dash = segments[o + 5]!;
      const gap = segments[o + 6]!;
      const dashed = dash > 0 && gap > 0 && Number.isFinite(dash + gap);
      const offset = dashed && Number.isFinite(segments[o + 7]!) ? segments[o + 7]! : 0;
      const sr = segments[o + 8]!;
      const sg = segments[o + 9]!;
      const sb = segments[o + 10]!;
      const sa = segments[o + 11]!;
      const sameStyle = open && sr === r && sg === g && sb === b && sa === a && width === lineWidth && (dashed ? dash === dashLength && gap === gapLength : !(dashLength > 0));
      const connected = sameStyle && x0 === lastX && y0 === lastY && (!dashed || Math.abs(offset - along) < 0.01);
      if (connected) {
        ctx.lineTo(x1, y1);
      } else if (sameStyle && (!dashed || Math.abs(offset - strokeOffset) < 0.01)) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      } else {
        flush();
        r = sr;
        g = sg;
        b = sb;
        a = sa;
        lineWidth = width;
        dashLength = dashed ? dash : 0;
        gapLength = dashed ? gap : 0;
        strokeOffset = offset;
        const color = rgbaString(sr, sg, sb, sa);
        if (color !== this.strokeColor) ctx.strokeStyle = this.strokeColor = color;
        if (width !== this.strokeWidth) ctx.lineWidth = this.strokeWidth = width;
        ctx.lineCap = "butt";
        ctx.setLineDash(dashed ? [dash, gap] : []);
        ctx.lineDashOffset = offset;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        open = true;
      }
      lastX = x1;
      lastY = y1;
      along = offset + Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    }
    flush();
    // Later strokes (series, grid) expect solid lines.
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }


  /**
   * Triangles with per-vertex colors (see `ChartRenderSurface.fillTriangles`). Canvas 2D has no
   * per-vertex color, so each triangle takes its first vertex's color; consecutive triangles of one
   * color share a path and one fill.
   */
  fillTriangles(vertices: Float32Array, vertexCount: number): void {
    this.drawCalls++;
    const n = Math.min(vertexCount, Math.floor(vertices.length / 6));
    const ctx = this.ctx;
    let open = false;
    let openFill = "";
    for (let v = 0; v + 2 < n; v += 3) {
      const o = v * 6;
      const x0 = vertices[o]!;
      const y0 = vertices[o + 1]!;
      const x1 = vertices[o + 6]!;
      const y1 = vertices[o + 7]!;
      const x2 = vertices[o + 12]!;
      const y2 = vertices[o + 13]!;
      if (!Number.isFinite(x0 + y0 + x1 + y1 + x2 + y2)) continue;
      const fill = rgbaString(vertices[o + 2]!, vertices[o + 3]!, vertices[o + 4]!, vertices[o + 5]!);
      if (open && fill !== openFill) {
        ctx.fill();
        open = false;
      }
      if (!open) {
        if (fill !== this.fill) ctx.fillStyle = this.fill = fill;
        this.rectColor[3] = NaN;
        ctx.beginPath();
        open = true;
        openFill = fill;
      }
      // No closePath: a fill closes every subpath itself, and closing each of many subpaths of one long path
      // is what made 100k arrowheads take seconds in Chromium.
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    if (open) ctx.fill();
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
   * at least 1px each way. Callers fill a whole batch of these with one `fill()`, after `flushRect()`.
   *
   * Dense min/max buckets can be several per pixel column (the sampler takes up to 4096 buckets whatever the
   * plot width), and after snapping each is a whole-pixel rectangle. A rectangle with exactly the same
   * snapped columns as the pending one that touches or overlaps it vertically is merged into it: both are
   * unions of whole device pixels, so their union is the merged rectangle and the filled pixels are exactly
   * the same, with a fraction of the path-building calls into the native canvas.
   */
  private addSnappedRect(xa: number, ya: number, xb: number, yb: number): void {
    if (!Number.isFinite(xa + ya + xb + yb)) return;
    if (xa === xb || ya === yb) return;
    const left = Math.round(Math.min(xa, xb));
    const top = Math.round(Math.min(ya, yb));
    const right = Math.max(Math.round(Math.max(xa, xb)), left + 1);
    const bottom = Math.max(Math.round(Math.max(ya, yb)), top + 1);
    if (right < 0 || bottom < 0 || left > this.width || top > this.height) return;
    if (this.rectOpen) {
      if (left === this.rectLeft && right === this.rectRight && top <= this.rectBottom && bottom >= this.rectTop) {
        if (top < this.rectTop) this.rectTop = top;
        if (bottom > this.rectBottom) this.rectBottom = bottom;
        return;
      }
      this.ctx.rect(this.rectLeft, this.rectTop, this.rectRight - this.rectLeft, this.rectBottom - this.rectTop);
    }
    this.rectOpen = true;
    this.rectLeft = left;
    this.rectTop = top;
    this.rectRight = right;
    this.rectBottom = bottom;
  }

  /** Emit the pending merged rectangle (see `addSnappedRect`) into the path; call before filling it. */
  private flushRect(): void {
    if (!this.rectOpen) return;
    this.rectOpen = false;
    this.ctx.rect(this.rectLeft, this.rectTop, this.rectRight - this.rectLeft, this.rectBottom - this.rectTop);
  }
}


/** Reduced polyline points staged by `tracePolyline`; shared by every chart (a trace is synchronous). */
let pathScratch = new Float64Array(8192);

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

/** A color as one integer (8 bits a channel), to compare and bucket colors without building strings. */
function colorKey(r: number, g: number, b: number, a: number): number {
  const c = (v: number): number => (v > 0 ? (v < 1 ? Math.round(v * 255) : 255) : 0);
  return ((c(r) * 256 + c(g)) * 256 + c(b)) * 256 + c(a);
}

/** Unit octagon corners, cos and sin of k * 45 degrees. */
const OCTAGON = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? Math.cos : Math.sin)(Math.floor(i / 2) * (Math.PI / 4)));

/** A dot into `path`: a rectangle when tiny, an octagon when round, else a rounded rectangle. */
function traceDot(path: Path2D, x: number, y: number, w: number, h: number, radius: number): void {
  if (radius <= 0) {
    path.rect(x, y, w, h);
    return;
  }
  if (w <= TINY_SHAPE_PX && h <= TINY_SHAPE_PX) {
    // A tiny round dot as a square of the same area (side sqrt(pi)/2 of the diameter), so it carries the same ink.
    const round = w === h && radius >= w / 2;
    const side = round ? w * EQUAL_AREA_SQUARE : w;
    const tall = round ? side : h;
    path.rect(x + (w - side) / 2, y + (h - tall) / 2, side, tall);
    return;
  }
  if (w === h && radius >= w / 2) {
    // At dot size an octagon cannot be told from a circle, and eight straight edges cost less than an arc.
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = w / 2;
    path.moveTo(cx + r, cy);
    for (let k = 1; k < 8; k++) path.lineTo(cx + r * OCTAGON[k * 2]!, cy + r * OCTAGON[k * 2 + 1]!);
    return;
  }
  traceRoundRect(path as unknown as CanvasRenderingContext2D, x, y, w, h, radius, false);
}

function rgbaString(r: number, g: number, b: number, a: number): string {
  const clamp = (value: number): number => (value > 0 ? (value < 1 ? value : 1) : 0);
  return `rgba(${Math.round(clamp(r) * 255)},${Math.round(clamp(g) * 255)},${Math.round(clamp(b) * 255)},${clamp(a)})`;
}

/**
 * Add a rounded rectangle to the current path (a circle for a square with half-side corners). `close` closes the
 * subpath, which a stroke needs and a fill does not.
 */
function traceRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, close: boolean): void {
  if (radius <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  const r = Math.min(radius, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  if (close) ctx.closePath();
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
