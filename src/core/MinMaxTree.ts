/** Inclusive Y extent of a sample range. */
export interface MinMaxY {
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Reusable, mutable result slot for the allocation-free `*Into` queries. Callers keep one per
 * extraction pass so a dense min/max bucket loop does not allocate a `MinMaxY` per bucket.
 */
export interface MinMaxOut {
  minY: number;
  maxY: number;
}

const DEFAULT_BLOCK_SIZE = 64;

/**
 * Lazily built block min/max segment tree over a fixed-capacity array of Y values.
 *
 * Leaves summarize `blockSize` physical samples, so memory stays small while range queries cost one
 * partial-block scan at each end plus a logarithmic tree walk. Non-finite values are treated as
 * gaps and ignored.
 *
 * Design: every node carries a validity flag and is computed from the data the first time a query
 * needs it (children first, a leaf by scanning its block). Nothing is summarized up front, so
 *
 * - the first query over a range costs about one pass over just the samples it touches (a pan over a
 *   huge static series never summarizes the off-screen part), and later queries reuse the nodes;
 * - writes only mark the touched blocks and their ancestors stale (`update`), so a burst of appends
 *   between two frames is summarized once, when the next frame asks for it;
 * - invariant: a valid node has valid children, so staleness always propagates to the root.
 *
 * Min/max values are stored in the element type of the data (`Float32Array` data gets a
 * `Float32Array` tree; a float32 extremum round-trips exactly), which halves the tree's footprint
 * for the default float32 value storage.
 */
export class MinMaxTree {
  private readonly base: number;
  private readonly minTree: Float32Array | Float64Array;
  private readonly maxTree: Float32Array | Float64Array;
  /** 1 once the node's summary matches the data. */
  private readonly valid: Uint8Array;
  /** Physical samples at or beyond this index hold no data yet (a ring buffer fills from index 0). */
  private validEnd: number;
  /** Result slot for recomputing one node, so refreshing allocates nothing. */
  private readonly scratch: MinMaxOut = { minY: Infinity, maxY: -Infinity };

  constructor(
    private readonly values: ArrayLike<number>,
    readonly capacity: number,
    private readonly blockSize: number = DEFAULT_BLOCK_SIZE,
  ) {
    const blockCount = Math.max(1, Math.ceil(capacity / blockSize));
    this.base = 2 ** Math.ceil(Math.log2(blockCount));
    const Storage = values instanceof Float32Array ? Float32Array : Float64Array;
    this.minTree = new Storage(this.base * 2);
    this.maxTree = new Storage(this.base * 2);
    this.valid = new Uint8Array(this.base * 2);
    this.validEnd = capacity;
  }

  /**
   * Mark the blocks covering physical `[start, end)` stale after the data there changed, and record
   * that only indices below `validEnd` hold data (`update(0, capacity, 0)` forgets everything).
   */
  update(start: number, end: number, validEnd: number = this.capacity): void {
    this.validEnd = validEnd;
    if (end <= start) return;
    let left = this.base + Math.floor(start / this.blockSize);
    let right = this.base + Math.floor((end - 1) / this.blockSize);
    while (left >= 1) {
      for (let node = left; node <= right; node++) this.valid[node] = 0;
      left >>= 1;
      right >>= 1;
    }
  }

  /**
   * Write the Y extent of physical `[start, end)` into `out` and return whether it holds a finite
   * value. Queries never allocate: callers keep one `out` slot per extraction pass. The range must
   * lie within `[0, capacity]`.
   */
  queryInto(start: number, end: number, out: MinMaxOut): boolean {
    out.minY = Infinity;
    out.maxY = -Infinity;
    this.fold(start, end, out);
    return out.minY <= out.maxY;
  }

  /** `queryInto` over `count` samples of a ring buffer starting at a physical index, wrapping at capacity. */
  queryRingInto(physicalStart: number, count: number, out: MinMaxOut): boolean {
    out.minY = Infinity;
    out.maxY = -Infinity;
    const end = physicalStart + count;
    if (end <= this.capacity) {
      this.fold(physicalStart, end, out);
    } else {
      this.fold(physicalStart, this.capacity, out);
      this.fold(0, end - this.capacity, out);
    }
    return out.minY <= out.maxY;
  }

  /**
   * Widen `out` by the extent of physical `[start, end)`: partial blocks at either end by scanning,
   * whole blocks through the tree. Written with local accumulators and no helper calls because it
   * runs once per dense min/max bucket, every frame.
   */
  private fold(start: number, end: number, out: MinMaxOut): void {
    const values = this.values;
    const blockSize = this.blockSize;
    let minY = out.minY;
    let maxY = out.maxY;
    let i = start;
    const to = end;
    const firstFullBlock = Math.ceil(i / blockSize);
    const lastFullBlock = Math.floor(to / blockSize);
    // Short ranges are one scan; otherwise scan up to the first block edge, walk the tree, scan the tail.
    const headEnd = firstFullBlock >= lastFullBlock ? to : firstFullBlock * blockSize;
    for (; i < headEnd; i++) {
      const value = values[i]!;
      if (!Number.isFinite(value)) continue;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }

    if (firstFullBlock < lastFullBlock) {
      const minTree = this.minTree;
      const maxTree = this.maxTree;
      let left = this.base + firstFullBlock;
      let right = this.base + lastFullBlock;
      while (left < right) {
        if (left & 1) {
          this.refresh(left);
          if (minTree[left]! < minY) minY = minTree[left]!;
          if (maxTree[left]! > maxY) maxY = maxTree[left]!;
          left++;
        }
        if (right & 1) {
          right--;
          this.refresh(right);
          if (minTree[right]! < minY) minY = minTree[right]!;
          if (maxTree[right]! > maxY) maxY = maxTree[right]!;
        }
        left >>= 1;
        right >>= 1;
      }
      for (i = lastFullBlock * blockSize; i < to; i++) {
        const value = values[i]!;
        if (!Number.isFinite(value)) continue;
        if (value < minY) minY = value;
        if (value > maxY) maxY = value;
      }
    }
    out.minY = minY;
    out.maxY = maxY;
  }

  /** Bring a node summary up to date: children first, a leaf by scanning its block. */
  private refresh(node: number): void {
    if (this.valid[node] !== 0) return;
    const own = this.scratch;
    own.minY = Infinity;
    own.maxY = -Infinity;
    if (node >= this.base) {
      const from = (node - this.base) * this.blockSize;
      const to = Math.min(this.validEnd, from + this.blockSize);
      for (let i = from; i < to; i++) {
        const value = this.values[i]!;
        if (!Number.isFinite(value)) continue;
        if (value < own.minY) own.minY = value;
        if (value > own.maxY) own.maxY = value;
      }
    } else {
      const left = node << 1;
      this.refresh(left);
      this.refresh(left + 1);
      own.minY = Math.min(this.minTree[left]!, this.minTree[left + 1]!);
      own.maxY = Math.max(this.maxTree[left]!, this.maxTree[left + 1]!);
    }
    this.minTree[node] = own.minY;
    this.maxTree[node] = own.maxY;
    this.valid[node] = 1;
  }
}
