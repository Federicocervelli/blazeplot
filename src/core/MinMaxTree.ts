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

/** Bucket-extent cache: slots (a power of two, at least a frame's worth of buckets), shortest bucket cached, and the passes that must repeat before the cache is allocated. */
const BUCKET_CACHE_SLOTS = 4096;
const BUCKET_CACHE_MIN_LENGTH = 16;
const BUCKET_CACHE_AFTER_PASSES = 512;
/** Bucket lengths below this pack into a cache key together with the physical start. */
const BUCKET_KEY_RADIX = 256;

/**
 * Buckets whose extents one bulk call computes, with the result slots every dense min/max pass shares (a
 * frame is synchronous, so one pair serves every chart).
 */
export const BUCKET_CHUNK = 1024;
export const BUCKET_MIN = new Float64Array(BUCKET_CHUNK);
export const BUCKET_MAX = new Float64Array(BUCKET_CHUNK);

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
  /** Counts `update` calls; a cached bucket is current while no block it covers was written after it was cached. */
  private clock = 0;
  /** Clock of the last write per block; allocated together with the bucket cache. */
  private blockStamp: Float64Array | null = null;
  /** `[key, clock, minY, maxY]` per slot, direct-mapped by bucket position; see `bucketExtentsInto`. */
  private bucketCache: Float64Array | null = null;
  /** Dense passes seen so far; the cache is only allocated once a series is redrawn repeatedly. */
  private bucketPasses = 0;

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
    this.clock++;
    const stamps = this.blockStamp;
    if (stamps !== null) {
      const last = Math.min(stamps.length - 1, ((end - 1) / this.blockSize) | 0);
      for (let block = (start / this.blockSize) | 0; block <= last; block++) stamps[block] = this.clock;
    }
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
    const values = this.values;
    const capacity = this.capacity;
    const scanLimit = this.blockSize * 2;
    const slot = { minY: 0, maxY: 0 };
    const cached = scanLimit < BUCKET_KEY_RADIX && this.enableBucketCache();
    for (let b = 0; b < count; b++) {
      let s = first + b * width;
      let e = s + width;
      if (s < lo) s = lo;
      if (e > hi) e = hi;
      let minY = Infinity;
      let maxY = -Infinity;
      const length = e - s;
      if (length > 0) {
        let p = s + shift;
        if (p >= capacity) p -= capacity;
        if (length <= scanLimit && p + length <= capacity) {
          const stop = p + length;
          let cache = cached ? this.bucketCache : null;
          let slot = 0;
          if (cache !== null && length >= BUCKET_CACHE_MIN_LENGTH) {
            slot = ((((p / width) | 0) & (BUCKET_CACHE_SLOTS - 1)) << 2);
            if (cache[slot] === p * BUCKET_KEY_RADIX + length && cache[slot + 1]! >= this.newestWrite(p, stop)) {
              minOut[b] = cache[slot + 2]!;
              maxOut[b] = cache[slot + 3]!;
              continue;
            }
          } else {
            cache = null;
          }
          for (let i = p; i < stop; i++) {
            const value = values[i]!;
            if (value < minY) minY = value;
            if (value > maxY) maxY = value;
          }
          if (minY === -Infinity || maxY === Infinity) {
            minY = Infinity;
            maxY = -Infinity;
            for (let i = p; i < stop; i++) {
              const value = values[i]!;
              if (!Number.isFinite(value)) continue;
              if (value < minY) minY = value;
              if (value > maxY) maxY = value;
            }
          }
          if (cache !== null) {
            cache[slot] = p * BUCKET_KEY_RADIX + length;
            cache[slot + 1] = this.clock;
            cache[slot + 2] = minY;
            cache[slot + 3] = maxY;
          }
        } else {
          this.queryRingInto(p, length, slot);
          minY = slot.minY;
          maxY = slot.maxY;
        }
      }
      minOut[b] = minY;
      maxOut[b] = maxY;
    }
  }

  /**
   * Whether bucket extents may be cached, allocating the cache once a tree has served 512 dense passes (sustained panning or streaming, not a first paint or a few warm-up frames). Panning
   * and live charts ask for the same ordinal-aligned buckets frame after frame (only the buckets at
   * the edges change), so a repeat is answered from the cache instead of rescanning its samples; a
   * chart drawn once or twice never pays the memory.
   */
  private enableBucketCache(): boolean {
    if (this.bucketCache !== null) return true;
    if (++this.bucketPasses < BUCKET_CACHE_AFTER_PASSES) return false;
    this.bucketCache = new Float64Array(BUCKET_CACHE_SLOTS * 4);
    this.blockStamp = new Float64Array(Math.max(1, Math.ceil(this.capacity / this.blockSize)));
    return true;
  }

  /** Clock of the latest write to any block of physical `[start, end)` (0 when none was recorded). */
  private newestWrite(start: number, end: number): number {
    const stamps = this.blockStamp!;
    let newest = 0;
    for (let block = (start / this.blockSize) | 0, last = ((end - 1) / this.blockSize) | 0; block <= last; block++) {
      if (stamps[block]! > newest) newest = stamps[block]!;
    }
    return newest;
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

  /** Bring a node summary up to date: children first, a leaf by scanning its block. */
  private refresh(node: number): void {
    if (this.valid[node] !== 0) return;
    let minY = Infinity;
    let maxY = -Infinity;
    if (node >= this.base) {
      const from = (node - this.base) * this.blockSize;
      const to = Math.min(this.validEnd, from + this.blockSize);
      for (let i = from; i < to; i++) {
        const value = this.values[i]!;
        if (!Number.isFinite(value)) continue;
        if (value < minY) minY = value;
        if (value > maxY) maxY = value;
      }
    } else {
      const left = node << 1;
      this.refresh(left);
      this.refresh(left + 1);
      minY = Math.min(this.minTree[left]!, this.minTree[left + 1]!);
      maxY = Math.max(this.maxTree[left]!, this.maxTree[left + 1]!);
    }
    this.minTree[node] = minY;
    this.maxTree[node] = maxY;
    this.valid[node] = 1;
  }
}
