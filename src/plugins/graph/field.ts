/**
 * Lines per pixel over the view, for a dense graph: how many of its edges cover each point. Drawing `n` lines of
 * opacity `alpha` over each other leaves `(1 - alpha)^n` of what is under them, so this count is all a frame of
 * edges in one style shows; the painter turns it into opacity once, at the end.
 *
 * Each pair of cells of the pair hierarchy adds the bundle of edges between them, modelled as the lines between two
 * even spreads of points: across the bundle, at a fraction `t` of the way from cell A to cell B, its lines are
 * spread as the sum of A's spread scaled by `1 - t` and B's scaled by `t` (two even spreads: a trapezoid), and along
 * it they start over A's extent and end over B's (ramps). The spread of a cell is its nodes' standard deviation
 * times sqrt(3), the half-width of an even spread with that deviation.
 *
 * The field is sampled on grids `step`, `2 step`, `4 step`... CSS pixels apart (a multigrid). A bundle is written on
 * the coarsest grid that still has a few vertices across its finest feature on the view, as a piecewise linear
 * profile per row (or per column, for bundles nearer horizontal) through its second differences, so it costs a few
 * writes per row of that grid; `resolve` integrates each grid and adds it into the next finer by bilinear
 * interpolation, which a piecewise linear profile of that scale survives.
 */

/** Whether a bundle along (`ux`, `uy`) is walked by rows (nearer vertical) or by columns. */
function rowsWiseOf(ux: number, uy: number): boolean {
  return Math.abs(uy) >= Math.abs(ux);
}

/** Grids of the field: level `l` samples every `step * 2^l` CSS pixels. */
const LEVELS = 7;

/** Vertices a bundle's finest feature spans, at least, on the grid it is written to. */
const SAMPLES_PER_FEATURE = 2;

class Level {
  step = 1;
  cols = 0;
  rows = 0;
  /** Second differences along x, per row (bundles nearer vertical): `cols + 2` per row. */
  alongX = new Float64Array(0);
  /** Second differences along y, per column (bundles nearer horizontal): `rows + 2` per column. */
  alongY = new Float64Array(0);
  /** Counts written per vertex (the inside of cells). */
  direct = new Float32Array(0);
  /** This level resolved, plus every coarser one. */
  sum = new Float32Array(0);
  used = false;

  reset(width: number, height: number, step: number): void {
    this.step = step;
    this.cols = Math.ceil(width / step) + 1;
    this.rows = Math.ceil(height / step) + 1;
    const cells = this.cols * this.rows;
    const ax = (this.cols + 2) * this.rows;
    const ay = (this.rows + 2) * this.cols;
    // Cleared whole after use, so a smaller view leaves nothing behind for a larger one.
    if (this.alongX.length < ax) this.alongX = new Float64Array(ax);
    else if (this.used) this.alongX.fill(0);
    if (this.alongY.length < ay) this.alongY = new Float64Array(ay);
    else if (this.used) this.alongY.fill(0);
    if (this.direct.length < cells) {
      this.direct = new Float32Array(cells);
      this.sum = new Float32Array(cells);
    } else if (this.used) this.direct.fill(0);
    this.used = false;
  }
}

export class LineField {
  /** The finest grid's spacing (CSS px) and size: `out` is sampled on it. */
  step = 1;
  cols = 0;
  rows = 0;
  private readonly levels: Level[] = Array.from({ length: LEVELS }, () => new Level());
  /** The resolved count per vertex of the finest grid, row by row. */
  out = new Float32Array(0);
  /** Whether anything was added since `reset`. */
  used = false;

  /** Clear the field for a view `width` x `height` CSS pixels, its finest grid sampled every `step` pixels. */
  reset(width: number, height: number, step: number): void {
    for (let l = 0; l < LEVELS; l++) this.levels[l]!.reset(width, height, step * 2 ** l);
    const fine = this.levels[0]!;
    this.step = step;
    this.cols = fine.cols;
    this.rows = fine.rows;
    this.used = false;
  }

  /** The coarsest level whose step leaves `SAMPLES_PER_FEATURE` vertices across `feature` CSS pixels. */
  private levelFor(feature: number): Level {
    let l = 0;
    while (l + 1 < LEVELS && this.levels[l + 1]!.step * SAMPLES_PER_FEATURE <= feature) l++;
    return this.levels[l]!;
  }

  /**
   * Add, on line `base` of `count` vertices `step` apart, a trapezoid: 0 at X0, rising to `h` at X1, flat to X2,
   * falling to 0 at X3 (CSS px), as four hinges `m * max(0, x - X)` whose samples at the vertices come out exact.
   */
  private static trapezoid(d: Float64Array, base: number, count: number, step: number, x0: number, x1: number, x2: number, x3: number, h: number): void {
    const rise = x1 - x0;
    const fall = x3 - x2;
    for (let k = 0; k < 4; k++) {
      const X = k === 0 ? x0 : k === 1 ? x1 : k === 2 ? x2 : x3;
      const width = k < 2 ? rise : fall;
      if (!(width > 0)) continue;
      const m = (k === 0 || k === 3 ? h : -h) / width;
      const u = X / step;
      if (u >= count - 1) continue;
      if (u < 0) {
        // The hinge is already rising at the first vertex.
        d[base]! += -m * X;
        d[base + 1]! += m * step + m * X;
        continue;
      }
      const i = Math.floor(u);
      const f = u - i;
      d[base + i + 1]! += m * step * (1 - f);
      d[base + i + 2]! += m * step * f;
    }
  }

  /**
   * The bundle of `edges` lines `lineWidth` wide from cell A, centered at (`ax`, `ay`), to cell B at (`bx`, `by`)
   * (CSS px): `ha` and `hb` the cells' half-spreads across the bundle, `ea` and `eb` along it. Features finer
   * than `minFeature` CSS px are drawn on a grid as coarse as that allows (for lines too faint to see one by one).
   */
  addBundle(ax: number, ay: number, bx: number, by: number, ha: number, hb: number, ea: number, eb: number, edges: number, lineWidth: number, minFeature = 0): void {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!(length > 0) || !(edges > 0)) return;
    const ux = dx / length;
    const uy = dy / length;
    const half = lineWidth / 2;
    const fine = this.levels[0]!;
    const width = (fine.cols - 1) * fine.step;
    const height = (fine.rows - 1) * fine.step;
    // The part of the axis (from -ea to length + eb) over the view, as distances along it.
    let lo = -ea;
    let hi = length + eb;
    for (let k = 0; k < 4; k++) {
      const p = k === 0 ? -ux : k === 1 ? ux : k === 2 ? -uy : uy;
      const q = k === 0 ? ax : k === 1 ? width - ax : k === 2 ? ay : height - ay;
      const reach = Math.max(ha, hb) + half;
      if (p === 0) {
        if (q < -reach) return;
        continue;
      }
      // Grown by the band's reach, so a band whose axis passes beside the view still counts.
      const r = (q + reach) / p;
      if (p < 0) lo = Math.max(lo, r);
      else hi = Math.min(hi, r);
    }
    if (lo > hi) return;
    // The finest feature at a point of the axis: the ramps across (narrowest near an end, where the lines all start
    // from one cell's spread), and the ramps along, where it reaches a cell. The bundle is cut along its axis into
    // pieces each written on the level that feature allows, cross-faded where one hands over to the next (weights
    // that sum to one, linear, which the coarser grid's interpolation keeps exact).
    const featureAt = (tau: number): number => {
      const t = Math.min(1, Math.max(0, tau / length));
      let f = 2 * Math.min(ha * (1 - t), hb * t + half);
      if (Math.abs(tau) < ea * 2) f = Math.min(f, 2 * ea);
      if (Math.abs(tau - length) < eb * 2) f = Math.min(f, 2 * eb);
      return Math.max(f, lineWidth, minFeature);
    };
    const levelAt = (tau: number): number => {
      const f = featureAt(tau);
      let l = 0;
      while (l + 1 < LEVELS && this.levels[l + 1]!.step * SAMPLES_PER_FEATURE <= f) l++;
      return l;
    };
    // Sample points, geometric toward both ends, where features are finest.
    const span = hi - lo;
    const marks = this.marks;
    let count = 0;
    marks[count++] = 0;
    for (let k = 12; k >= 1; k--) marks[count++] = 2 ** -k;
    for (let k = 2; k <= 12; k++) marks[count++] = 1 - 2 ** -k;
    marks[count++] = 1;
    // Pieces: runs of intervals on one level (an interval takes the finer of its two ends).
    const pieceStart = this.pieceStart;
    const pieceLevel = this.pieceLevel;
    let pieces = 0;
    let previous = levelAt(lo);
    for (let k = 0; k + 1 < count; k++) {
      const next = levelAt(lo + span * marks[k + 1]!);
      const l = Math.min(previous, next);
      if (pieces === 0 || pieceLevel[pieces - 1] !== l) {
        pieceStart[pieces] = lo + span * marks[k]!;
        pieceLevel[pieces] = l;
        pieces++;
      }
      previous = next;
    }
    pieceStart[pieces] = hi;
    const walk = Math.abs(rowsWiseOf(ux, uy) ? uy : ux);
    for (let k = 0; k < pieces; k++) {
      const level = this.levels[pieceLevel[k]!]!;
      // Hand-overs as wide as two steps of the coarser side, at most half of either piece.
      const fade = (j: number): number => {
        if (j <= 0 || j >= pieces) return 0;
        const coarse = Math.max(this.levels[pieceLevel[j - 1]!]!.step, this.levels[pieceLevel[j]!]!.step);
        return Math.min((2 * coarse) / walk, (pieceStart[j]! - pieceStart[j - 1]!) / 2, (pieceStart[j + 1]! - pieceStart[j]!) / 2);
      };
      const fadeIn = fade(k);
      const fadeOut = fade(k + 1);
      this.rasterize(level, ax, ay, ux, uy, length, ha, hb, ea, eb, edges, lineWidth, pieceStart[k]! - fadeIn / 2, pieceStart[k + 1]! + fadeOut / 2, fadeIn, fadeOut);
    }
    this.used = true;
  }

  /** Pieces of the bundle being added: where each starts along its axis (one more for the end), and its level. */
  private readonly marks = new Float64Array(32);
  private readonly pieceStart = new Float64Array(33);
  private readonly pieceLevel = new Int32Array(32);

  /**
   * Write the part of a bundle from `lo` to `hi` along its axis on `level`, weighted up over its first `fadeIn` and
   * down over its last `fadeOut` (distances along the axis).
   */
  private rasterize(level: Level, ax: number, ay: number, ux: number, uy: number, length: number, ha: number, hb: number, ea: number, eb: number, edges: number, lineWidth: number, lo: number, hi: number, fadeIn: number, fadeOut: number): void {
    const half = lineWidth / 2;
    const step = level.step;
    // Nearer vertical: walk rows, the profile along x; nearer horizontal: walk columns, along y.
    const rowsWise = rowsWiseOf(ux, uy);
    const aw = rowsWise ? ay : ax;
    const ac = rowsWise ? ax : ay;
    const uw = rowsWise ? uy : ux;
    const uc = rowsWise ? ux : uy;
    const lines = rowsWise ? level.rows : level.cols;
    const count = rowsWise ? level.cols : level.rows;
    const d = rowsWise ? level.alongX : level.alongY;
    const ink = edges * lineWidth;
    const reach = Math.max(ha, hb) + half;
    const w0 = aw + uw * lo;
    const w1 = aw + uw * hi;
    const first = Math.max(0, Math.ceil((Math.min(w0, w1) - reach) / step));
    const last = Math.min(lines - 1, Math.floor((Math.max(w0, w1) + reach) / step));
    // Across distance s maps to the across coordinate with slope 1 / |uw|.
    const stretch = 1 / Math.abs(uw);
    for (let line = first; line <= last; line++) {
      const w = line * step;
      // Where the axis crosses this line, and how far along the bundle that is.
      const tau = (w - aw) / uw;
      if (tau < lo || tau > hi) continue;
      const begun = ea > 0 ? Math.min(1, Math.max(0, (tau + ea) / (2 * ea))) : tau >= 0 ? 1 : 0;
      const left = eb > 0 ? Math.min(1, Math.max(0, (length + eb - tau) / (2 * eb))) : tau <= length ? 1 : 0;
      let present = begun * left;
      if (fadeIn > 0) present *= Math.min(1, (tau - lo) / fadeIn);
      if (fadeOut > 0) present *= Math.min(1, (hi - tau) / fadeOut);
      if (present <= 0) continue;
      const t = Math.min(1, Math.max(0, tau / length));
      const p = ha * (1 - t);
      const q = hb * t + half;
      let outer = (p + q) * stretch;
      let inner = Math.abs(p - q) * stretch;
      // Lines per unit across, times the width each covers.
      let h = (ink * present) / (2 * Math.max(p, q));
      // Averaged over a step, so a bundle narrower than the grid is not missed between two vertices (the area,
      // h times outer plus inner, is kept).
      const area = h * (outer + inner);
      outer += step / 2;
      inner = Math.max(0, inner - step / 2);
      h = area / (outer + inner);
      const center = ac + uc * tau;
      LineField.trapezoid(d, line * (count + 2), count, step, center - outer, center - inner, center + inner, center + outer, h);
    }
    level.used = true;
    this.used = true;
  }

  /**
   * The `edges` lines `lineWidth` wide between the nodes of one cell, its box `x0`..`x1`, `y0`..`y1` (CSS px):
   * their ink (edges times width times their mean length, that of two even points in the box) spread as
   * 6u(1 - u) across each side, which is zero at the box's edges, where no line between two points inside crosses.
   */
  addCell(x0: number, y0: number, x1: number, y1: number, edges: number, lineWidth: number): void {
    const fine = this.levels[0]!;
    const w = Math.max(x1 - x0, fine.step);
    const h = Math.max(y1 - y0, fine.step);
    // A few vertices across its narrower side at least, so its shape survives interpolation.
    const level = this.levelFor(Math.min(w, h) / 4);
    const step = level.step;
    const cols = level.cols;
    const mean = 0.5214 * Math.sqrt((w * w + h * h) / 2);
    const density = (edges * lineWidth * mean) / (w * h);
    const c0 = Math.max(0, Math.ceil(x0 / step));
    const c1 = Math.min(cols - 1, Math.floor((x0 + w) / step));
    const r0 = Math.max(0, Math.ceil(y0 / step));
    const r1 = Math.min(level.rows - 1, Math.floor((y0 + h) / step));
    level.used = true;
    this.used = true;
    if (c0 > c1 || r0 > r1) {
      // Smaller than a step: its ink onto the nearest vertex.
      const col = Math.round((x0 + w / 2) / step);
      const row = Math.round((y0 + h / 2) / step);
      if (col >= 0 && col < cols && row >= 0 && row < level.rows) level.direct[row * cols + col]! += (density * w * h) / (step * step);
      return;
    }
    for (let row = r0; row <= r1; row++) {
      const v = (row * step - y0) / h;
      const gy = 6 * v * (1 - v);
      if (gy <= 0) continue;
      for (let col = c0; col <= c1; col++) {
        const u = (col * step - x0) / w;
        const gx = 6 * u * (1 - u);
        if (gx > 0) level.direct[row * cols + col]! += density * gx * gy;
      }
    }
  }

  /** Integrate every grid, coarse to fine, each added into the next finer: the count per vertex in `out`. */
  resolve(): Float32Array {
    let coarser: Level | null = null;
    for (let l = LEVELS - 1; l >= 0; l--) {
      const level = this.levels[l]!;
      if (!level.used && !coarser) continue;
      const { cols, rows, sum } = level;
      if (level.used) {
        const ax = level.alongX;
        const ay = level.alongY;
        const direct = level.direct;
        for (let row = 0; row < rows; row++) {
          const base = row * (cols + 2);
          let slope = 0;
          let value = 0;
          const o = row * cols;
          for (let col = 0; col < cols; col++) {
            slope += ax[base + col]!;
            value += slope;
            sum[o + col] = value + direct[o + col]!;
          }
        }
        for (let col = 0; col < cols; col++) {
          const base = col * (rows + 2);
          let slope = 0;
          let value = 0;
          for (let row = 0; row < rows; row++) {
            slope += ay[base + row]!;
            value += slope;
            sum[row * cols + col]! += value;
          }
        }
      } else sum.fill(0, 0, cols * rows);
      if (coarser) {
        // Bilinear: a vertex at an even index sits on a coarse one, an odd one halfway between two.
        const cc = coarser.cols;
        const cr = coarser.rows;
        const cs = coarser.sum;
        for (let row = 0; row < rows; row++) {
          const r0 = Math.min(cr - 1, row >> 1);
          const r1 = Math.min(cr - 1, (row + 1) >> 1);
          for (let col = 0; col < cols; col++) {
            const c0 = Math.min(cc - 1, col >> 1);
            const c1 = Math.min(cc - 1, (col + 1) >> 1);
            sum[row * cols + col]! += (cs[r0 * cc + c0]! + cs[r0 * cc + c1]! + cs[r1 * cc + c0]! + cs[r1 * cc + c1]!) / 4;
          }
        }
      }
      coarser = level;
    }
    const fine = this.levels[0]!;
    const cells = fine.cols * fine.rows;
    if (this.out.length < cells) this.out = new Float32Array(cells);
    const out = this.out;
    if (!coarser) out.fill(0, 0, cells);
    else {
      // Rounding in the running sums can leave a hair below zero.
      const sum = fine.sum;
      for (let k = 0; k < cells; k++) out[k] = sum[k]! > 0 ? sum[k]! : 0;
    }
    return out;
  }

  /**
   * Clear the vertices outside a convex polygon (`points`, x and y pairs in CSS px, `count` corners), where no
   * edge can be: every edge lies inside the convex hull of its graph's nodes. Call after `resolve`.
   */
  clip(points: Float64Array, count: number): void {
    if (count < 3) return;
    const { cols, rows, step, out } = this;
    for (let row = 0; row < rows; row++) {
      const y = row * step;
      let left = Infinity;
      let right = -Infinity;
      for (let e = 0; e < count; e++) {
        const f = (e + 1) % count;
        const x0 = points[e * 2]!;
        const y0 = points[e * 2 + 1]!;
        const x1 = points[f * 2]!;
        const y1 = points[f * 2 + 1]!;
        if ((y < y0 && y < y1) || (y > y0 && y > y1)) continue;
        if (y0 === y1) {
          left = Math.min(left, x0, x1);
          right = Math.max(right, x0, x1);
          continue;
        }
        const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
        if (x < left) left = x;
        if (x > right) right = x;
      }
      const from = row * cols;
      if (left > right) {
        out.fill(0, from, from + cols);
        continue;
      }
      const c0 = Math.min(cols, Math.max(0, Math.ceil(left / step)));
      const c1 = Math.min(cols - 1, Math.floor(right / step));
      if (c0 > 0) out.fill(0, from, from + c0);
      if (c1 + 1 < cols) out.fill(0, from + Math.max(0, c1 + 1), from + cols);
    }
  }
}
