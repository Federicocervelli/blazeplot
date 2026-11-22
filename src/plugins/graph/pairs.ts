/**
 * Dense graphs as pairs of node sets instead of edges.
 *
 * A k-d tree splits the nodes into cells; a pair hierarchy then covers every pair of distinct nodes exactly once
 * with pairs of cells (a well-separated pair decomposition: two cells are separated when the gap between them is
 * at least `SEPARATION` times the larger one's radius). It has O(n) pairs, a few per node, where the graph may
 * have O(n²) edges. Each pair knows how many of the listed edges join its two cells. A frame walks the hierarchy from the top and
 * stops where a pair is small on screen, or separated: such a pair is drawn as one band from one cell's centroid
 * to the other's, as wide as each cell's spread across the band, with the opacity of its edges drawn over each
 * other. Where both cells are single leaves and large on screen, its edges are drawn one by one.
 *
 * Measured against rasterizing every edge (1 000 nodes, every pair joined): bands fitted this way are within about
 * 4.5% per pixel of the truth with 2 700 items, where an even random sample of 4 000 edges is 6.8% off; the
 * hierarchy covers all pairs exactly, with 4 to 9 pairs per node from 1 000 to 100 000 nodes. Pure: no DOM.
 */

/** Nodes per tree leaf at most. */
const LEAF = 4;
/** Gap between two cells, in units of the larger radius, from which they count as separated. */
const SEPARATION = 2;

export class PairTree {
  count = 0;
  /** Per cell: its nodes are `order[lo..hi)`. */
  lo: Int32Array = new Int32Array(0);
  hi: Int32Array = new Int32Array(0);
  /** Per cell: its children, or -1 for a leaf. */
  left: Int32Array = new Int32Array(0);
  right: Int32Array = new Int32Array(0);
  /** Per cell: its parent, or -1 for the root. */
  parent: Int32Array = new Int32Array(0);
  /** Per cell: bounding box, centroid, and covariance of its nodes (graph units). */
  minX: Float64Array = new Float64Array(0);
  minY: Float64Array = new Float64Array(0);
  maxX: Float64Array = new Float64Array(0);
  maxY: Float64Array = new Float64Array(0);
  mx: Float64Array = new Float64Array(0);
  my: Float64Array = new Float64Array(0);
  sxx: Float64Array = new Float64Array(0);
  syy: Float64Array = new Float64Array(0);
  sxy: Float64Array = new Float64Array(0);
  /** Per cell: half its bounding box's diagonal (graph units), kept with the box. */
  rad: Float64Array = new Float64Array(0);
  /** Nodes in tree order, and each node's place in it and its leaf. */
  order: Uint32Array = new Uint32Array(0);
  pos: Uint32Array = new Uint32Array(0);
  leafOf: Int32Array = new Int32Array(0);
  /**
   * Nodes taken out of their cells (moved away from where the tree was built, see `exclude`): per node 1 or 0,
   * and per cell how many of its nodes are out. Cells fit, count, and hull only the nodes still in.
   */
  excluded: Uint8Array = new Uint8Array(0);
  gone: Int32Array = new Int32Array(0);
  /** The convex hull of the nodes, counterclockwise: x, y pairs (graph units), `hullCount` of them. */
  hull: Float64Array = new Float64Array(0);
  hullCount = 0;
  /** The node positions last fitted to (graph units). */
  x: Float64Array = new Float64Array(0);
  y: Float64Array = new Float64Array(0);

  /** Build over `n` nodes at (`x`, `y`): median splits across each cell's longer side. */
  build(n: number, x: Float64Array, y: Float64Array): void {
    const capacity = Math.max(1, 2 * Math.ceil(n / LEAF) * 2 + 2);
    const I = (): Int32Array => new Int32Array(capacity) as Int32Array;
    const F = (): Float64Array => new Float64Array(capacity) as Float64Array;
    this.lo = I();
    this.hi = I();
    this.left = I().fill(-1);
    this.right = I().fill(-1);
    this.parent = I().fill(-1);
    this.minX = F();
    this.minY = F();
    this.maxX = F();
    this.maxY = F();
    this.mx = F();
    this.my = F();
    this.sxx = F();
    this.syy = F();
    this.sxy = F();
    this.rad = F();
    this.order = Uint32Array.from({ length: n }, (_, i) => i);
    this.pos = new Uint32Array(n);
    this.leafOf = new Int32Array(n);
    this.excluded = new Uint8Array(n);
    this.gone = I();
    this.count = 0;
    if (n === 0) return;
    // Iterative, so a deep tree cannot overflow the stack: [cell, lo, hi] entries.
    const stack: number[] = [this.alloc(0, n, -1)];
    while (stack.length > 0) {
      const cell = stack.pop()!;
      const lo = this.lo[cell]!;
      const hi = this.hi[cell]!;
      this.boundsOf(cell, x, y);
      if (hi - lo <= LEAF) continue;
      const byX = this.maxX[cell]! - this.minX[cell]! >= this.maxY[cell]! - this.minY[cell]!;
      const mid = (lo + hi) >> 1;
      select(this.order, lo, hi, mid, byX ? x : y);
      const a = this.alloc(lo, mid, cell);
      const b = this.alloc(mid, hi, cell);
      this.left[cell] = a;
      this.right[cell] = b;
      stack.push(a, b);
    }
    for (let k = 0; k < n; k++) this.pos[this.order[k]!] = k;
    this.refit(x, y);
  }

  private alloc(lo: number, hi: number, parent: number): number {
    const id = this.count++;
    this.lo[id] = lo;
    this.hi[id] = hi;
    this.parent[id] = parent;
    return id;
  }

  private boundsOf(cell: number, x: Float64Array, y: Float64Array): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const out = this.excluded;
    for (let k = this.lo[cell]!; k < this.hi[cell]!; k++) {
      const i = this.order[k]!;
      if (out[i] === 1) continue;
      if (x[i]! < minX) minX = x[i]!;
      if (x[i]! > maxX) maxX = x[i]!;
      if (y[i]! < minY) minY = y[i]!;
      if (y[i]! > maxY) maxY = y[i]!;
    }
    this.minX[cell] = minX;
    this.minY[cell] = minY;
    this.maxX[cell] = maxX;
    this.maxY[cell] = maxY;
  }

  /** Recompute every cell's statistics from current positions, keeping the structure (after positions change). */
  refit(x: Float64Array, y: Float64Array): void {
    this.x = x;
    this.y = y;
    // Children are allocated after their parent, so walking backwards visits children first.
    for (let c = this.count - 1; c >= 0; c--) {
      this.fit(c, x, y);
      this.rad[c] = this.size(c) > 0 ? Math.hypot(this.maxX[c]! - this.minX[c]!, this.maxY[c]! - this.minY[c]!) / 2 : 0;
    }
    this.findHull();
  }

  /** Recompute the statistics of one node's leaf and its ancestors (after that node moved). */
  refitNode(node: number, x: Float64Array, y: Float64Array): void {
    this.x = x;
    this.y = y;
    for (let c = this.leafOf[node]!; c >= 0; c = this.parent[c]!) {
      this.fit(c, x, y);
      this.rad[c] = this.size(c) > 0 ? Math.hypot(this.maxX[c]! - this.minX[c]!, this.maxY[c]! - this.minY[c]!) / 2 : 0;
    }
    this.findHull();
  }

  private fit(c: number, x: Float64Array, y: Float64Array): void {
    const l = this.left[c]!;
    if (l < 0) {
      this.boundsOf(c, x, y);
      let mx = 0;
      let my = 0;
      const out = this.excluded;
      const n = this.size(c);
      for (let k = this.lo[c]!; k < this.hi[c]!; k++) {
        const i = this.order[k]!;
        this.leafOf[i] = c;
        if (out[i] === 1) continue;
        mx += x[i]!;
        my += y[i]!;
      }
      if (n === 0) {
        // Every node out: an empty cell, which nothing is drawn for.
        this.mx[c] = 0;
        this.my[c] = 0;
        this.sxx[c] = 0;
        this.syy[c] = 0;
        this.sxy[c] = 0;
        return;
      }
      mx /= n;
      my /= n;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let k = this.lo[c]!; k < this.hi[c]!; k++) {
        const i = this.order[k]!;
        if (out[i] === 1) continue;
        sxx += (x[i]! - mx) ** 2;
        syy += (y[i]! - my) ** 2;
        sxy += (x[i]! - mx) * (y[i]! - my);
      }
      this.mx[c] = mx;
      this.my[c] = my;
      this.sxx[c] = sxx / n;
      this.syy[c] = syy / n;
      this.sxy[c] = sxy / n;
      return;
    }
    const r = this.right[c]!;
    const na = this.size(l);
    const nb = this.size(r);
    const n = na + nb;
    if (n === 0) {
      this.mx[c] = 0;
      this.my[c] = 0;
      this.sxx[c] = 0;
      this.syy[c] = 0;
      this.sxy[c] = 0;
      this.minX[c] = Infinity;
      this.minY[c] = Infinity;
      this.maxX[c] = -Infinity;
      this.maxY[c] = -Infinity;
      return;
    }
    const mx = (na * this.mx[l]! + nb * this.mx[r]!) / n;
    const my = (na * this.my[l]! + nb * this.my[r]!) / n;
    // Covariances merge with the spread between the two means.
    const merge = (cl: number, cr: number, ax: number, ay: number, bx: number, by: number): number => (na * (cl + ax * ay) + nb * (cr + bx * by)) / n;
    const dlx = this.mx[l]! - mx;
    const dly = this.my[l]! - my;
    const drx = this.mx[r]! - mx;
    const dry = this.my[r]! - my;
    this.sxx[c] = merge(this.sxx[l]!, this.sxx[r]!, dlx, dlx, drx, drx);
    this.syy[c] = merge(this.syy[l]!, this.syy[r]!, dly, dly, dry, dry);
    this.sxy[c] = merge(this.sxy[l]!, this.sxy[r]!, dlx, dly, drx, dry);
    this.mx[c] = mx;
    this.my[c] = my;
    this.minX[c] = Math.min(this.minX[l]!, this.minX[r]!);
    this.minY[c] = Math.min(this.minY[l]!, this.minY[r]!);
    this.maxX[c] = Math.max(this.maxX[l]!, this.maxX[r]!);
    this.maxY[c] = Math.max(this.maxY[l]!, this.maxY[r]!);
  }

  /** Nodes in cell `c`, less those taken out. */
  size(c: number): number {
    return this.hi[c]! - this.lo[c]! - this.gone[c]!;
  }

  /**
   * Take `node` out of its cells (`out` true) or put it back, and fit them again at (`x`, `y`): a node moved far
   * from where the tree was built would stretch its cells over the gap, so its edges are drawn on their own
   * instead (see the painter's star).
   */
  exclude(node: number, out: boolean, x: Float64Array, y: Float64Array): void {
    if (node < 0 || node >= this.excluded.length || (this.excluded[node] === 1) === out) return;
    this.excluded[node] = out ? 1 : 0;
    for (let c = this.leafOf[node]!; c >= 0; c = this.parent[c]!) this.gone[c]! += out ? 1 : -1;
    this.refitNode(node, x, y);
  }

  radius(c: number): number {
    return this.rad[c]!;
  }

  contains(c: number, node: number): boolean {
    const p = this.pos[node]!;
    return p >= this.lo[c]! && p < this.hi[c]!;
  }

  /**
   * The convex hull of the nodes (Andrew's monotone chain), over only the nodes that can be on it: the extreme
   * nodes in eight directions make an octagon inside the hull, and cells whose box lies inside that octagon are
   * skipped whole (Akl and Toussaint), so an even layout costs about its outline in cells.
   */
  private findHull(): void {
    this.hullCount = 0;
    const n = this.order.length;
    if (n === 0 || this.count === 0) return;
    const x = this.x;
    const y = this.y;
    // The extremes along x, y, x + y, and x - y, each way: the octagon, counterclockwise.
    const ext = [0, 0, 0, 0, 0, 0, 0, 0];
    const best = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
    const out = this.excluded;
    let first = 0;
    while (first < n && out[first] === 1) first++;
    if (first === n) return;
    ext.fill(first);
    for (let i = first; i < n; i++) {
      if (out[i] === 1) continue;
      const px = x[i]!;
      const py = y[i]!;
      // Counterclockwise from the lowest: -y, x - y, x, x + y, y, y - x, -x, -x - y.
      const v0 = -py;
      const v1 = px - py;
      const v2 = px;
      const v3 = px + py;
      if (v0 > best[0]!) {
        best[0] = v0;
        ext[0] = i;
      }
      if (v1 > best[1]!) {
        best[1] = v1;
        ext[1] = i;
      }
      if (v2 > best[2]!) {
        best[2] = v2;
        ext[2] = i;
      }
      if (v3 > best[3]!) {
        best[3] = v3;
        ext[3] = i;
      }
      if (-v0 > best[4]!) {
        best[4] = -v0;
        ext[4] = i;
      }
      if (-v1 > best[5]!) {
        best[5] = -v1;
        ext[5] = i;
      }
      if (-v2 > best[6]!) {
        best[6] = -v2;
        ext[6] = i;
      }
      if (-v3 > best[7]!) {
        best[7] = -v3;
        ext[7] = i;
      }
    }
    const inside = (px: number, py: number): boolean => {
      for (let d = 0; d < 8; d++) {
        const a = ext[d]!;
        const b = ext[(d + 1) % 8]!;
        if (a === b) continue;
        if ((x[b]! - x[a]!) * (py - y[a]!) - (y[b]! - y[a]!) * (px - x[a]!) <= 0) return false;
      }
      return true;
    };
    const candidates: number[] = [];
    const stack = [0];
    while (stack.length > 0) {
      const c = stack.pop()!;
      if (inside(this.minX[c]!, this.minY[c]!) && inside(this.maxX[c]!, this.minY[c]!) && inside(this.minX[c]!, this.maxY[c]!) && inside(this.maxX[c]!, this.maxY[c]!)) continue;
      if (this.left[c]! >= 0) {
        stack.push(this.left[c]!, this.right[c]!);
        continue;
      }
      for (let k = this.lo[c]!; k < this.hi[c]!; k++) if (out[this.order[k]!] !== 1) candidates.push(this.order[k]!);
    }
    for (const e of ext) candidates.push(e);
    candidates.sort((a, b) => x[a]! - x[b]! || y[a]! - y[b]!);
    const hull: number[] = [];
    const cross = (o: number, a: number, b: number): number => (x[a]! - x[o]!) * (y[b]! - y[o]!) - (y[a]! - y[o]!) * (x[b]! - x[o]!);
    for (const p of candidates) {
      while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop();
      hull.push(p);
    }
    const lower = hull.length + 1;
    for (let k = candidates.length - 2; k >= 0; k--) {
      const p = candidates[k]!;
      while (hull.length >= lower && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
    if (this.hull.length < hull.length * 2) this.hull = new Float64Array(hull.length * 2);
    for (let k = 0; k < hull.length; k++) {
      this.hull[k * 2] = x[hull[k]!]!;
      this.hull[k * 2 + 1] = y[hull[k]!]!;
    }
    this.hullCount = hull.length;
  }

  /** Whether the box around nodes `i` and `j` (graph units) meets the view. */
  segmentMeets(i: number, j: number, view: CutView): boolean {
    const x = this.x;
    const y = this.y;
    return !(Math.max(x[i]!, x[j]!) < view.minX || Math.min(x[i]!, x[j]!) > view.maxX || Math.max(y[i]!, y[j]!) < view.minY || Math.min(y[i]!, y[j]!) > view.maxY);
  }

  /** The spread (standard deviation) of a cell's nodes along the unit direction (`nx`, `ny`). */
  spread(c: number, nx: number, ny: number): number {
    return Math.sqrt(Math.max(0, this.sxx[c]! * nx * nx + this.syy[c]! * ny * ny + 2 * this.sxy[c]! * nx * ny));
  }
}

/** Partially sort `order[lo..hi)` by `key` so the element at `k` is in place (quickselect, median of three). */
function select(order: Uint32Array, lo: number, hi: number, k: number, key: Float64Array): void {
  let l = lo;
  let r = hi - 1;
  while (r > l) {
    const m = (l + r) >> 1;
    const a = key[order[l]!]!;
    const b = key[order[m]!]!;
    const c = key[order[r]!]!;
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let i = l;
    let j = r;
    while (i <= j) {
      while (key[order[i]!]! < pivot) i++;
      while (key[order[j]!]! > pivot) j--;
      if (i <= j) {
        const t = order[i]!;
        order[i] = order[j]!;
        order[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) r = j;
    else if (k >= i) l = i;
    else return;
  }
}

/**
 * The pair hierarchy, stored: so the edge counts of its pairs stay valid when nodes move (the cover is by node
 * sets, not by geometry). A pair `p` joins cells `cellA[p]` and `cellB[p]` (the same cell for the pairs inside it);
 * its children are `first[p] .. first[p] + children[p]`.
 */
export class PairHierarchy {
  count = 0;
  cellA: Int32Array = new Int32Array(0);
  cellB: Int32Array = new Int32Array(0);
  first: Int32Array = new Int32Array(0);
  children: Uint8Array = new Uint8Array(0);
  /** Edges between the pair's two cells (inside the cell for a same-cell pair). */
  edges: Float64Array = new Float64Array(0);

  constructor(readonly tree: PairTree) {}

  /** Build over the tree as it is now. */
  build(): void {
    const tree = this.tree;
    let capacity = Math.max(64, tree.count * 8);
    this.cellA = new Int32Array(capacity);
    this.cellB = new Int32Array(capacity);
    this.first = new Int32Array(capacity).fill(-1);
    this.children = new Uint8Array(capacity);
    this.count = 0;
    if (tree.count === 0) return;
    const grow = (need: number): void => {
      if (need <= capacity) return;
      while (capacity < need) capacity *= 2;
      const resizeI = (a: Int32Array, fill: number): Int32Array => {
        const b = new Int32Array(capacity).fill(fill);
        b.set(a);
        return b;
      };
      this.cellA = resizeI(this.cellA, 0);
      this.cellB = resizeI(this.cellB, 0);
      this.first = resizeI(this.first, -1);
      const kids = new Uint8Array(capacity);
      kids.set(this.children);
      this.children = kids;
    };
    const make = (a: number, b: number): number => {
      grow(this.count + 1);
      const p = this.count++;
      this.cellA[p] = a;
      this.cellB[p] = b;
      return p;
    };
    const stack = [make(0, 0)];
    while (stack.length > 0) {
      const p = stack.pop()!;
      const a = this.cellA[p]!;
      const b = this.cellB[p]!;
      let kids: [number, number][] = [];
      if (a === b) {
        if (tree.left[a]! >= 0) {
          const l = tree.left[a]!;
          const r = tree.right[a]!;
          kids = [
            [l, l],
            [r, r],
            [l, r],
          ];
        }
      } else if (!this.separated(a, b) && !(tree.left[a]! < 0 && tree.left[b]! < 0)) {
        const splitA = tree.left[b]! < 0 || (tree.left[a]! >= 0 && tree.radius(a) >= tree.radius(b));
        kids = splitA
          ? [
              [tree.left[a]!, b],
              [tree.right[a]!, b],
            ]
          : [
              [a, tree.left[b]!],
              [a, tree.right[b]!],
            ];
      }
      if (kids.length === 0) continue;
      this.first[p] = this.count;
      this.children[p] = kids.length;
      for (const [ka, kb] of kids) stack.push(make(ka, kb));
    }
    this.edges = new Float64Array(this.count);
  }

  private separated(a: number, b: number): boolean {
    const t = this.tree;
    const dx = (t.minX[a]! + t.maxX[a]!) / 2 - (t.minX[b]! + t.maxX[b]!) / 2;
    const dy = (t.minY[a]! + t.maxY[a]!) / 2 - (t.minY[b]! + t.maxY[b]!) / 2;
    const ra = t.radius(a);
    const rb = t.radius(b);
    return Math.hypot(dx, dy) - ra - rb >= SEPARATION * Math.max(ra, rb);
  }

  /** The leaf pair holding the pair of nodes `i`, `j`. */
  leafOf(i: number, j: number): number {
    const t = this.tree;
    let p = 0;
    while (this.first[p]! >= 0) {
      const f = this.first[p]!;
      let next = -1;
      for (let k = 0; k < this.children[p]!; k++) {
        const c = f + k;
        const a = this.cellA[c]!;
        const b = this.cellB[c]!;
        if ((t.contains(a, i) && t.contains(b, j)) || (t.contains(a, j) && t.contains(b, i))) {
          next = c;
          break;
        }
      }
      if (next < 0) return -1;
      p = next;
    }
    return p;
  }

  /**
   * Per leaf pair, the edges that fall in it, kept so a frame can split a leaf pair further (see `refine`). `list[listStart[p] .. listEnd[p])` are indices
   * into `listSource` and `listTarget` (an empty range for a pair split further); `refine` reorders them within
   * that range as it splits.
   */
  listStart: Int32Array = new Int32Array(1);
  listEnd: Int32Array = new Int32Array(1);
  list: Uint32Array = new Uint32Array(0);
  listSource: ArrayLike<number> = [];
  listTarget: ArrayLike<number> = [];
  /**
   * Which edges the counts cover (null: all). Edges styled apart from the common style are
   * drawn one by one, so they are left out here and counted once.
   */
  keep: Uint8Array | null = null;
  /**
   * Per edge, 1 when the counts cover it: kept, and with neither end
   * taken out of the tree (see `PairTree.exclude`). Set by `recount`.
   */
  counted: Uint8Array = new Uint8Array(0);

  /** Counts for listed edges: each assigned to its leaf pair. */
  countListed(source: Uint32Array, target: Uint32Array, edgeCount: number, keep: Uint8Array | null = null): void {
    this.assign(source, target, edgeCount);
    this.deepen();
    this.recount(keep);
  }

  /**
   * Count again: after a restyle moved listed edges in or out of `keep` (1 kept, null all), or nodes were taken
   * out of the tree or put back.
   */
  recount(keep: Uint8Array | null): void {
    const t = this.tree;
    this.keep = keep;
    const entries = Math.min(this.listSource.length, this.listTarget.length);
    if (this.counted.length !== entries) this.counted = new Uint8Array(entries);
    const out = t.excluded;
    const src = this.listSource;
    const dst = this.listTarget;
    const kept = this.keep;
    for (let k = 0; k < entries; k++) this.counted[k] = (kept ? kept[k]! : 1) && out[src[k]!] !== 1 && out[dst[k]!] !== 1 ? 1 : 0;
    for (let p = 0; p < this.count; p++) {
      if (this.first[p]! >= 0) continue;
      let n = 0;
      for (let k = this.listStart[p]!; k < this.listEnd[p]!; k++) n += this.counted[this.list[k]!]!;
      this.edges[p] = n;
    }
    this.sumUp();
  }

  /** Sort entries (`source[k]`, `target[k]`) into the lists of their leaf pairs (a counting sort). */
  private assign(source: ArrayLike<number>, target: ArrayLike<number>, count: number): void {
    const leaves = new Int32Array(count);
    const start = new Int32Array(this.count + 1);
    for (let k = 0; k < count; k++) {
      const i = source[k]!;
      const j = target[k]!;
      const leaf = i === j || !(i >= 0 && j >= 0 && i < this.tree.order.length && j < this.tree.order.length) ? -1 : this.leafOf(i, j);
      leaves[k] = leaf;
      if (leaf >= 0) start[leaf + 1]!++;
    }
    for (let p = 0; p < this.count; p++) start[p + 1]! += start[p]!;
    const list = new Uint32Array(start[this.count]!);
    const fill = start.slice(0, this.count);
    for (let k = 0; k < count; k++) if (leaves[k]! >= 0) list[fill[leaves[k]!]!++] = k;
    this.listStart = start.subarray(0, this.count);
    this.listEnd = start.slice(1);
    this.list = list;
    this.listSource = source;
    this.listTarget = target;
  }

  /**
   * Split stored leaf pairs further while they list more than `LEAF_LIST` edges, partitioning each list once here
   * instead of in every frame that splits it: the larger cell is halved (a pair inside one cell becomes its
   * halves' insides and the pair between them), as `refine` would. Children are appended, after their parent.
   */
  private deepen(): void {
    const t = this.tree;
    const list = this.list;
    const src = this.listSource;
    const dst = this.listTarget;
    let capacity = this.count;
    const grow = (need: number): void => {
      if (need <= capacity) return;
      capacity = Math.max(need, capacity * 2);
      const I = (a: Int32Array, fill: number): Int32Array => {
        const b = new Int32Array(capacity).fill(fill);
        b.set(a.subarray(0, this.count));
        return b;
      };
      this.cellA = I(this.cellA, 0);
      this.cellB = I(this.cellB, 0);
      this.first = I(this.first, -1);
      this.listStart = I(this.listStart, 0);
      this.listEnd = I(this.listEnd, 0);
      const kids = new Uint8Array(capacity);
      kids.set(this.children.subarray(0, this.count));
      this.children = kids;
    };
    grow(this.count + 1);
    const inCell = (k: number, c: number): number => {
      const lo = t.lo[c]!;
      const hi = t.hi[c]!;
      const i = t.pos[src[k]!]!;
      const j = t.pos[dst[k]!]!;
      return (i >= lo && i < hi ? 1 : 0) + (j >= lo && j < hi ? 1 : 0);
    };
    /** Move the entries of `list[lo..hi)` that `test` accepts to the front; returns where the rest start. */
    const partition = (lo: number, hi: number, test: (k: number) => boolean): number => {
      let i = lo;
      let j = hi - 1;
      while (i <= j) {
        if (test(list[i]!)) i++;
        else {
          const x = list[i]!;
          list[i] = list[j]!;
          list[j] = x;
          j--;
        }
      }
      return i;
    };
    for (let p = 0; p < this.count; p++) {
      if (this.first[p]! >= 0 || this.listEnd[p]! - this.listStart[p]! <= LEAF_LIST) continue;
      const a = this.cellA[p]!;
      const b = this.cellB[p]!;
      const lo = this.listStart[p]!;
      const hi = this.listEnd[p]!;
      const kids: number[] = [];
      if (a === b) {
        if (t.left[a]! < 0) continue;
        const l = t.left[a]!;
        const r = t.right[a]!;
        const m1 = partition(lo, hi, (k) => inCell(k, l) === 2);
        const m2 = partition(m1, hi, (k) => inCell(k, r) === 2);
        kids.push(l, l, lo, m1, r, r, m1, m2, l, r, m2, hi);
      } else {
        if (t.left[a]! < 0 && t.left[b]! < 0) continue;
        const splitA = t.left[b]! < 0 || (t.left[a]! >= 0 && t.radius(a) >= t.radius(b));
        const cell = splitA ? a : b;
        const other = splitA ? b : a;
        const l = t.left[cell]!;
        const r = t.right[cell]!;
        const mid = partition(lo, hi, (k) => inCell(k, l) > 0);
        if (splitA) kids.push(l, other, lo, mid, r, other, mid, hi);
        else kids.push(other, l, lo, mid, other, r, mid, hi);
      }
      const n = kids.length / 4;
      grow(this.count + n);
      this.first[p] = this.count;
      this.children[p] = n;
      this.listStart[p] = 0;
      this.listEnd[p] = 0;
      for (let k = 0; k < n; k++) {
        const c = this.count++;
        this.cellA[c] = kids[k * 4]!;
        this.cellB[c] = kids[k * 4 + 1]!;
        this.first[c] = -1;
        this.children[c] = 0;
        this.listStart[c] = kids[k * 4 + 2]!;
        this.listEnd[c] = kids[k * 4 + 3]!;
      }
    }
    if (this.edges.length < this.count) this.edges = new Float64Array(this.count);
  }

  /** Internal pairs total their children; children come after their parent, so a backward walk suffices. */
  private sumUp(): void {
    for (let p = this.count - 1; p >= 0; p--) {
      const f = this.first[p]!;
      if (f < 0) continue;
      let total = 0;
      for (let k = 0; k < this.children[p]!; k++) total += this.edges[f + k]!;
      this.edges[p] = total;
    }
  }

  isLeaf(p: number): boolean {
    return this.first[p]! < 0;
  }
}

/** What a cut draws: bands (pairs of cells) and single edges, with their area for the budget. */
export interface CutSink {
  band(a: number, b: number, edges: number): void;
  /** One edge (its index), to be drawn on its own. */
  edge(e: number): void;
}

/** The view a cut is for: graph-unit rectangle, zoom, line width (CSS px). */
export interface CutView {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly zoom: number;
}

/** The listed edges `list[lo..hi)` that the counts cover and whose segment's box meets the view: emitted, and counted. */
function emitEdges(pairs: PairHierarchy, lo: number, hi: number, sink: CutSink | null, view: CutView): number {
  const t = pairs.tree;
  const counted = pairs.counted;
  let items = 0;
  for (let k = lo; k < hi; k++) {
    const edge = pairs.list[k]!;
    if (counted[edge] === 0) continue;
    if (!t.segmentMeets(pairs.listSource[edge]!, pairs.listTarget[edge]!, view)) continue;
    sink?.edge?.(edge);
    items++;
  }
  return items;
}

/**
 * The edges of one node to every other, for a dragged node: cells small on screen or far from it (separated from
 * the point) are one band from the node to the cell; nearer ones are walked down to single nodes.
 */
export function starCut(tree: PairTree, node: number, px: number, py: number, view: CutView, tau: number, sink: { band(cell: number, edges: number): void; node(j: number): void }): void {
  if (tree.count === 0) return;
  const stack = [0];
  while (stack.length > 0) {
    const c = stack.pop()!;
    const cx = (tree.minX[c]! + tree.maxX[c]!) / 2;
    const cy = (tree.minY[c]! + tree.maxY[c]!) / 2;
    const r = tree.radius(c);
    const minX = Math.min(px, tree.minX[c]!);
    const maxX = Math.max(px, tree.maxX[c]!);
    const minY = Math.min(py, tree.minY[c]!);
    const maxY = Math.max(py, tree.maxY[c]!);
    if (maxX < view.minX || minX > view.maxX || maxY < view.minY || minY > view.maxY) continue;
    const size = tree.size(c) - (tree.contains(c, node) ? 1 : 0);
    if (size <= 0) continue;
    const far = Math.hypot(cx - px, cy - py) - r >= SEPARATION * r;
    if ((r * 2 * view.zoom <= tau || far) && !tree.contains(c, node)) {
      sink.band(c, size);
      continue;
    }
    if (tree.left[c]! < 0) {
      for (let k = tree.lo[c]!; k < tree.hi[c]!; k++) if (tree.order[k] !== node) sink.node(tree.order[k]!);
      continue;
    }
    stack.push(tree.left[c]!, tree.right[c]!);
  }
}

/** What `refine` may spend: items drawn, band area (CSS px²), line area (CSS px²), and density-field work. */
export interface RefineBudget {
  readonly items: number;
  readonly area: number;
  readonly lines: number;
  readonly field: number;
  /** Pairs no larger than this on screen (CSS px) are never split. */
  readonly minSize: number;
}

/** The cost of drawing things, which `refine` weighs against its budget. */
export interface RefineCosts {
  /**
   * Drawing `edges` edges as one band between cells `a` and `b` (or as a density over cell `a` when `b` is `a`):
   * its area into `out[0]` and its density-field work into `out[1]` (both unused for a cell), and into `out[2]`
   * how much splitting it could change what is seen, from 0 to 1: 1 - its opacity, as an opaque band looks the
   * same split.
   */
  band(a: number, b: number, edges: number, out: Float64Array): void;
  /** The line area of the edges between the nodes of leaf cells `a` and `b` (the same cell for its inside). */
  lines(a: number, b: number): number;
  /**
   * How much drawing `edges` edges between cells `a` and `b` (or inside `a` when `b` is `a`) as one bundle could
   * differ from drawing them one by one, in pixels times levels on the view: the entry with the most is split
   * first. Optional: without it, an entry ranks by its size on the view times `out[2]` of `band`.
   */
  error?(a: number, b: number, edges: number): number;
}

export interface RefineSink extends CutSink {
  /** The edges inside cell `c`, not split further: drawn as the density they spread over the cell. */
  cell(c: number, edges: number): void;
}

/** A stored leaf pair of listed edges lists at most this many, unless its cells cannot be split (see `deepen`). */
const LEAF_LIST = 64;

/** Size classes of `refine`'s queue: a quarter octave each, from 1 CSS px up. */
const CLASSES = 128;
const CLASSES_PER_OCTAVE = 4;

/** Scratch for `refine`, kept between frames so a frame allocates nothing once it has grown. */
export class RefineScratch {
  /**
   * Queued entries, one FIFO list per size class through `next`. An entry is a pair of cells with its edge count:
   * a stored pair of the hierarchy (`pair` its index), or a part of a stored leaf pair split further this frame
   * (`pair` -1), whose entries are `list[lo..hi)` of the hierarchy.
   */
  next: Int32Array = new Int32Array(1024);
  pair: Int32Array = new Int32Array(1024);
  cellA: Int32Array = new Int32Array(1024);
  cellB: Int32Array = new Int32Array(1024);
  lo: Int32Array = new Int32Array(1024);
  hi: Int32Array = new Int32Array(1024);
  edges: Float64Array = new Float64Array(1024);
  /** What each entry costs while it is drawn as one band. */
  area: Float64Array = new Float64Array(1024);
  field: Float64Array = new Float64Array(1024);
  readonly head: Int32Array = new Int32Array(CLASSES);
  readonly tail: Int32Array = new Int32Array(CLASSES);
  /** Each entry's place in the queue: its size on the view times how much splitting it shows (see `refine`). */
  key: Float64Array = new Float64Array(1024);
  readonly out: Float64Array = new Float64Array(3);

  grow(): void {
    const n = this.next.length * 2;
    const I = (a: Int32Array): Int32Array => {
      const b = new Int32Array(n);
      b.set(a);
      return b;
    };
    const F = (a: Float64Array): Float64Array => {
      const b = new Float64Array(n);
      b.set(a);
      return b;
    };
    this.next = I(this.next);
    this.pair = I(this.pair);
    this.cellA = I(this.cellA);
    this.cellB = I(this.cellB);
    this.lo = I(this.lo);
    this.hi = I(this.hi);
    this.edges = F(this.edges);
    this.area = F(this.area);
    this.field = F(this.field);
    this.key = F(this.key);
  }
}

/**
 * The cut of the hierarchy that fits a budget, in one walk: the entry whose splitting shows most first, every entry
 * is split while what its parts cost fits, and the walk stops at the first one that does not, so the cut is about
 * equally fine everywhere (as with one size threshold), as fine as the budget allows. What splitting shows is an
 * entry's size on the view (only the part of each cell on the view: detail off it shows only as a band's
 * direction) times 1 - its opacity (an opaque band looks the same split), at least a twentieth of it. Entries are
 * queued by size classes of that key a quarter octave apart, first in first out within one; a part never ranks
 * above what it was split from, so the classes are visited from the top down once.
 *
 * A stored pair splits into its stored children. A leaf pair, whose cells are separated, splits too while it is
 * large on screen, so a node's edges to far cells become lines when zoomed in: its larger cell is halved, and its
 * edge list is partitioned between the halves, which gives each half its exact count. Pairs of
 * two tree leaves become their edges when those fit. Entries off the view are dropped. Returns the size
 * (CSS px) at which refinement stopped.
 */
export function refine(pairs: PairHierarchy, view: CutView, budget: RefineBudget, costs: RefineCosts, sink: RefineSink, scratch: RefineScratch): number {
  const t = pairs.tree;
  if (pairs.count === 0 || pairs.edges[0]! <= 0) return budget.minSize;
  const zoom = view.zoom;
  const out = scratch.out;
  const head = scratch.head.fill(-1);
  const tail = scratch.tail;
  const list = pairs.list;
  const src = pairs.listSource;
  const dst = pairs.listTarget;
  let used = 0;
  let top = 0;
  let items = 0;
  let area = 0;
  let lines = 0;
  let field = 0;
  const visible = (a: number, b: number): boolean =>
    !(Math.max(t.maxX[a]!, t.maxX[b]!) < view.minX || Math.min(t.minX[a]!, t.minX[b]!) > view.maxX || Math.max(t.maxY[a]!, t.maxY[b]!) < view.minY || Math.min(t.minY[a]!, t.minY[b]!) > view.maxY);
  /** A new entry, its cost worked out (a band: one item, area, field work; the inside of a cell costs nothing). */
  const make = (pair: number, a: number, b: number, lo: number, hi: number, edges: number): number => {
    if (used === scratch.next.length) scratch.grow();
    const e = used++;
    scratch.pair[e] = pair;
    scratch.cellA[e] = a;
    scratch.cellB[e] = b;
    scratch.lo[e] = lo;
    scratch.hi[e] = hi;
    scratch.edges[e] = edges;
    costs.band(a, b, edges, out);
    scratch.area[e] = a === b ? 0 : out[0]!;
    scratch.field[e] = a === b ? 0 : out[1]!;
    scratch.key[e] = costs.error ? costs.error(a, b, edges) : Math.max(onView(a), onView(b)) * Math.min(1, Math.max(0.05, out[2]!));
    return e;
  };
  const onView = (c: number): number => {
    const w = Math.min(t.maxX[c]!, view.maxX) - Math.max(t.minX[c]!, view.minX);
    const h = Math.min(t.maxY[c]!, view.maxY) - Math.max(t.minY[c]!, view.minY);
    return w < 0 || h < 0 ? 0 : Math.sqrt(w * w + h * h) * zoom;
  };
  const push = (e: number): void => {
    const size = scratch.key[e]!;
    const c = size <= 1 ? 0 : Math.min(CLASSES - 1, Math.floor(Math.log2(size) * CLASSES_PER_OCTAVE));
    scratch.next[e] = -1;
    if (head[c]! < 0) head[c] = e;
    else scratch.next[tail[c]!] = e;
    tail[c] = e;
    if (c > top) top = c;
  };
  const emit = (e: number): void => {
    const a = scratch.cellA[e]!;
    const b = scratch.cellB[e]!;
    if (a === b) sink.cell(a, scratch.edges[e]!);
    else sink.band(a, b, scratch.edges[e]!);
  };
  const itemsOf = (e: number): number => (scratch.cellA[e] === scratch.cellB[e] ? 0 : 1);
  /** Entries for the stored pair `p`, when it has edges and lies on the view; returns the entry or -1. */
  const stored = (p: number): number => {
    if (pairs.edges[p]! <= 0 || !visible(pairs.cellA[p]!, pairs.cellB[p]!)) return -1;
    return make(p, pairs.cellA[p]!, pairs.cellB[p]!, pairs.listStart[p]!, pairs.listEnd[p]!, pairs.edges[p]!);
  };
  // The parts an entry splits into, made but not yet queued: `parts[0..partCount)`.
  const parts = [0, 0, 0];
  let partCount = 0;
  /** Split an entry; returns false when it cannot be (two tree leaves, or a cell inside a tree leaf). */
  const split = (e: number): boolean => {
    partCount = 0;
    const p = scratch.pair[e]!;
    if (p >= 0 && !pairs.isLeaf(p)) {
      const f = pairs.first[p]!;
      for (let k = 0; k < pairs.children[p]!; k++) {
        const c = stored(f + k);
        if (c >= 0) parts[partCount++] = c;
      }
      return true;
    }
    const a = scratch.cellA[e]!;
    const b = scratch.cellB[e]!;
    if (a === b || (t.left[a]! < 0 && t.left[b]! < 0)) return false;
    // Halve the larger cell (that can be halved); the other is kept.
    const splitA = t.left[b]! < 0 || (t.left[a]! >= 0 && onView(a) >= onView(b));
    const cell = splitA ? a : b;
    const other = splitA ? b : a;
    const left = t.left[cell]!;
    const right = t.right[cell]!;
    // Partition the list: entries with an end in the left half first.
    const leftLo = t.lo[left]!;
    const leftHi = t.hi[left]!;
    const inLeft = (k: number): boolean => {
      const i = t.pos[src[k]!]!;
      const j = t.pos[dst[k]!]!;
      return (i >= leftLo && i < leftHi) || (j >= leftLo && j < leftHi);
    };
    // Counting the entries the counts cover in each half on the way.
    const keep = pairs.counted;
    let keptLeft = 0;
    let keptRight = 0;
    let i = scratch.lo[e]!;
    let j = scratch.hi[e]! - 1;
    while (i <= j) {
      const x = list[i]!;
      if (inLeft(x)) {
        keptLeft += keep[x]!;
        i++;
      } else {
        keptRight += keep[x]!;
        list[i] = list[j]!;
        list[j] = x;
        j--;
      }
    }
    const mid = i;
    for (const [half, lo, hi, kept] of [
      [left, scratch.lo[e]!, mid, keptLeft],
      [right, mid, scratch.hi[e]!, keptRight],
    ] as const) {
      const edges = kept;
      if (edges <= 0 || !visible(half, other)) continue;
      parts[partCount++] = splitA ? make(-1, half, other, lo, hi, edges) : make(-1, other, half, lo, hi, edges);
    }
    return true;
  };
  const root = stored(0);
  if (root >= 0) push(root);
  const floor = budget.minSize <= 1 ? 0 : Math.floor(Math.log2(budget.minSize) * CLASSES_PER_OCTAVE);
  let stopped = budget.minSize;
  walk: while (top > floor) {
    while (head[top]! < 0) {
      if (--top <= floor) break walk;
    }
    const e = head[top]!;
    const own = itemsOf(e);
    const mark = used;
    if (split(e)) {
      let dItems = -own;
      let dArea = -scratch.area[e]!;
      let dField = -scratch.field[e]!;
      for (let k = 0; k < partCount; k++) {
        dItems += itemsOf(parts[k]!);
        dArea += scratch.area[parts[k]!]!;
        dField += scratch.field[parts[k]!]!;
      }
      if (items + dItems > budget.items || area + dArea > budget.area || field + dField > budget.field) {
        used = mark;
        stopped = 2 ** (top / CLASSES_PER_OCTAVE);
        break;
      }
      head[top] = scratch.next[e]!;
      items += dItems;
      area += dArea;
      field += dField;
      for (let k = 0; k < partCount; k++) {
        scratch.key[parts[k]!] = Math.min(scratch.key[parts[k]!]!, scratch.key[e]!);
        push(parts[k]!);
      }
      continue;
    }
    // Two tree leaves (or the inside of one): their edges, one by one.
    const a = scratch.cellA[e]!;
    const b = scratch.cellB[e]!;
    const count = emitEdges(pairs, scratch.lo[e]!, scratch.hi[e]!, null, view);
    const cost = costs.lines(a, b);
    if (items - own + count > budget.items || lines + cost > budget.lines) {
      stopped = 2 ** (top / CLASSES_PER_OCTAVE);
      break;
    }
    head[top] = scratch.next[e]!;
    items += count - own;
    lines += cost;
    area -= scratch.area[e]!;
    field -= scratch.field[e]!;
    emitEdges(pairs, scratch.lo[e]!, scratch.hi[e]!, sink, view);
  }
  for (let c = CLASSES - 1; c >= 0; c--) for (let e = head[c]!; e >= 0; e = scratch.next[e]!) emit(e);
  return stopped;
}
