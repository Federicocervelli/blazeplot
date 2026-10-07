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
 * Buckets whose extents one bulk call computes, with the result slots every dense min/max pass shares (a
 * frame is synchronous, so one pair serves every chart).
 */
export const BUCKET_CHUNK = 1024;
/** Both slots also serve as the raw-segment scratch of `SeriesSampler` (never in use at the same time), so they are sized for it and add no memory. */
const RAW_SCRATCH_LENGTH = 2049;
export const BUCKET_MIN: Float64Array = new Float64Array(RAW_SCRATCH_LENGTH);
export const BUCKET_MAX: Float64Array = new Float64Array(RAW_SCRATCH_LENGTH);

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
    let left = this.base + ((start / this.blockSize) | 0);
    let right = this.base + (((end - 1) / this.blockSize) | 0);
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
   * Y extents of `count` consecutive equal-width buckets, one `queryRingInto` result per bucket, in one
   * call. Bucket `b` covers logical `[first + b * width, first + (b + 1) * width)` clamped to
   * `[lo, hi)`; logical index `l` lives at physical `(l + shift) % capacity`. An empty bucket or one
   * without a finite value gets `minOut = Infinity` and `maxOut = -Infinity`.
   *
   * Dense min/max extraction asks for thousands of small buckets per frame. For buckets that fit in a
   * few blocks, a call per bucket (range split, two scans, tree walk) costs several times more than the
   * samples themselves, so those buckets are scanned directly: consecutive buckets read consecutive
   * memory and the loop carries no per-bucket call. The scan skips the per-sample finite test (a NaN
   * never compares less or greater) and only re-reads a bucket with the test when an infinity made it
   * through, so the result equals the guarded query. Wider buckets still use the tree.
   */
  bucketExtentsInto(first: number, width: number, count: number, lo: number, hi: number, shift: number, minOut: Float64Array, maxOut: Float64Array): void {
    const capacity = this.capacity;
    const scanLimit = this.blockSize * 2;
    const slot = { minY: 0, maxY: 0 };
    for (let b = 0; b < count; b++) {
      let s = first + b * width;
      let e = s + width;
      if (s < lo) s = lo;
      if (e > hi) e = hi;
      slot.minY = Infinity;
      slot.maxY = -Infinity;
      const length = e - s;
      if (length > 0) {
        let p = s + shift;
        if (p >= capacity) p -= capacity;
        if (length <= scanLimit && p + length <= capacity) this.scanExtent(p, p + length, slot);
        else this.queryRingInto(p, length, slot);
      }
      minOut[b] = slot.minY;
      maxOut[b] = slot.maxY;
    }
  }

  /**
   * Y extent of physical `[start, stop)` by scanning, into `out`. No per-sample finite test (a NaN never
   * compares less or greater); only when an infinity got through is the range read again with the test.
   */
  private scanExtent(start: number, stop: number, out: MinMaxOut): void {
    const values = this.values;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = start; i < stop; i++) {
      const value = values[i]!;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
    if (minY === -Infinity || maxY === Infinity) {
      minY = Infinity;
      maxY = -Infinity;
      for (let i = start; i < stop; i++) {
        const value = values[i]!;
        if (!Number.isFinite(value)) continue;
        if (value < minY) minY = value;
        if (value > maxY) maxY = value;
      }
    }
    out.minY = minY;
    out.maxY = maxY;
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
      const valid = this.valid;
      let left = this.base + firstFullBlock;
      let right = this.base + lastFullBlock;
      while (left < right) {
        if (left & 1) {
          if (valid[left] === 0) this.refresh(left);
          if (minTree[left]! < minY) minY = minTree[left]!;
          if (maxTree[left]! > maxY) maxY = maxTree[left]!;
          left++;
        }
        if (right & 1) {
          right--;
          if (valid[right] === 0) this.refresh(right);
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

  /**
   * Bring a node summary up to date. A leaf scans its block. An internal node refreshes its whole stale
   * subtree level by level, leaves first and then each level above them, instead of recursing node by
   * node: summarizing a large series for the first time touches tens of thousands of nodes, and the
   * recursive form cost several times the scan of the samples themselves.
   */
  private refresh(node: number): void {
    if (this.valid[node] !== 0) return;
    if (node >= this.base) {
      this.refreshLeaf(node);
      return;
    }
    const valid = this.valid;
    let low = node;
    let high = node + 1;
    while (low < this.base) {
      low <<= 1;
      high <<= 1;
    }
    const minTree = this.minTree;
    const maxTree = this.maxTree;
    const { values, base, blockSize, validEnd } = this;
    for (let leaf = low; leaf < high; leaf++) {
      if (valid[leaf] !== 0) continue;
      const from = (leaf - base) * blockSize;
      summarizeBlock(values, from, Math.min(validEnd, from + blockSize), minTree, maxTree, leaf);
      valid[leaf] = 1;
    }
    // Each level above the leaves, bottom-up, so both children are current when a parent is computed.
    for (low >>= 1, high >>= 1; low >= node; low >>= 1, high >>= 1) {
      for (let parent = low; parent < high; parent++) {
        if (valid[parent] !== 0) continue;
        const left = parent << 1;
        minTree[parent] = Math.min(minTree[left]!, minTree[left + 1]!);
        maxTree[parent] = Math.max(maxTree[left]!, maxTree[left + 1]!);
        valid[parent] = 1;
      }
    }
  }

  /** Summarize one block by scanning its samples below `validEnd`. */
  private refreshLeaf(node: number): void {
    const from = (node - this.base) * this.blockSize;
    summarizeBlock(this.values, from, Math.min(this.validEnd, from + this.blockSize), this.minTree, this.maxTree, node);
    this.valid[node] = 1;
  }
}

/**
 * Write the finite extent of `values[from, to)` to `minTree[node]` / `maxTree[node]` (an empty block
 * gets `Infinity` / `-Infinity`). A free function over its arguments rather than a method: the engine
 * compiles a scan loop over typed arrays it receives as parameters much tighter than one over arrays
 * read from instance fields, and summarizing a large series for the first time runs this once per block.
 * NaN fails both comparisons, so the plain loop already skips gaps. Only an infinity gets through, and it
 * shows up as an infinite extreme, which sends the block to the exact loop.
 */
function summarizeBlock(values: ArrayLike<number>, from: number, to: number, minTree: Float32Array | Float64Array, maxTree: Float32Array | Float64Array, node: number): void {
  // Four independent min/max accumulators: one running pair is a serial compare-and-select chain per
  // sample, and four chains in flight scan about 4x faster (measured on a 1M-sample first view).
  let min0 = Infinity;
  let max0 = -Infinity;
  let min1 = Infinity;
  let max1 = -Infinity;
  let min2 = Infinity;
  let max2 = -Infinity;
  let min3 = Infinity;
  let max3 = -Infinity;
  let i = from;
  for (; i + 3 < to; i += 4) {
    const a = values[i]!;
    const b = values[i + 1]!;
    const c = values[i + 2]!;
    const d = values[i + 3]!;
    if (a < min0) min0 = a;
    if (a > max0) max0 = a;
    if (b < min1) min1 = b;
    if (b > max1) max1 = b;
    if (c < min2) min2 = c;
    if (c > max2) max2 = c;
    if (d < min3) min3 = d;
    if (d > max3) max3 = d;
  }
  for (; i < to; i++) {
    const value = values[i]!;
    if (value < min0) min0 = value;
    if (value > max0) max0 = value;
  }
  if (min1 < min0) min0 = min1;
  if (min3 < min2) min2 = min3;
  if (min2 < min0) min0 = min2;
  if (max1 > max0) max0 = max1;
  if (max3 > max2) max2 = max3;
  if (max2 > max0) max0 = max2;
  let minY = min0;
  let maxY = max0;
  if (minY === -Infinity || maxY === Infinity) {
    minY = Infinity;
    maxY = -Infinity;
    for (let i = from; i < to; i++) {
      const value = values[i]!;
      if (!Number.isFinite(value)) continue;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
  }
  minTree[node] = minY;
  maxTree[node] = maxY;
}
