/** Inclusive Y extent of a sample range. */
export interface MinMaxY {
  readonly minY: number;
  readonly maxY: number;
}

const DEFAULT_BLOCK_SIZE = 64;

/**
 * Block min/max segment tree over a fixed-capacity array of Y values.
 *
 * Leaves summarize `blockSize` physical samples, so memory stays small while
 * range queries cost one partial-block scan at each end plus a logarithmic tree
 * walk. Non-finite values are treated as gaps and ignored.
 */
export class MinMaxTree {
  private readonly base: number;
  private readonly minTree: Float64Array;
  private readonly maxTree: Float64Array;

  constructor(
    private readonly values: ArrayLike<number>,
    readonly capacity: number,
    private readonly blockSize: number = DEFAULT_BLOCK_SIZE,
  ) {
    if (!Number.isInteger(blockSize) || blockSize <= 0) {
      throw new RangeError("MinMaxTree blockSize must be a positive integer.");
    }
    const blockCount = Math.max(1, Math.ceil(capacity / blockSize));
    this.base = 2 ** Math.ceil(Math.log2(blockCount));
    this.minTree = new Float64Array(this.base * 2).fill(Infinity);
    this.maxTree = new Float64Array(this.base * 2).fill(-Infinity);
  }

  /** Forget all summarized values. */
  reset(): void {
    this.minTree.fill(Infinity);
    this.maxTree.fill(-Infinity);
  }

  /** Recompute the blocks covering physical `[start, end)`, reading only indices below `validEnd`. */
  update(start: number, end: number, validEnd: number = this.capacity): void {
    if (end <= start) return;
    const firstBlock = Math.floor(start / this.blockSize);
    const lastBlock = Math.floor((end - 1) / this.blockSize);
    for (let block = firstBlock; block <= lastBlock; block++) {
      const from = block * this.blockSize;
      const to = Math.min(validEnd, from + this.blockSize);
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = from; i < to; i++) {
        const value = this.values[i]!;
        if (!Number.isFinite(value)) continue;
        if (value < minY) minY = value;
        if (value > maxY) maxY = value;
      }
      this.minTree[this.base + block] = minY;
      this.maxTree[this.base + block] = maxY;
    }

    let left = (this.base + firstBlock) >> 1;
    let right = (this.base + lastBlock) >> 1;
    while (left >= 1) {
      for (let node = left; node <= right; node++) this.recomputeNode(node);
      left >>= 1;
      right >>= 1;
    }
  }

  /**
   * Fold one newly written value into its block without rescanning. Only valid
   * when the write did not overwrite a previously summarized sample.
   */
  include(index: number, value: number): void {
    if (!Number.isFinite(value)) return;
    let node = this.base + Math.floor(index / this.blockSize);
    while (node >= 1) {
      const minChanged = value < this.minTree[node]!;
      const maxChanged = value > this.maxTree[node]!;
      if (!minChanged && !maxChanged) return;
      if (minChanged) this.minTree[node] = value;
      if (maxChanged) this.maxTree[node] = value;
      node >>= 1;
    }
  }

  /** Return the Y extent of physical `[start, end)`, or `null` when it contains no finite values. */
  query(start: number, end: number): MinMaxY | null {
    let minY = Infinity;
    let maxY = -Infinity;
    let i = Math.max(0, start);
    const to = Math.min(this.capacity, end);

    const firstFullBlock = Math.ceil(i / this.blockSize);
    const lastFullBlock = Math.floor(to / this.blockSize);
    if (firstFullBlock >= lastFullBlock) {
      for (; i < to; i++) {
        const value = this.values[i]!;
        if (!Number.isFinite(value)) continue;
        if (value < minY) minY = value;
        if (value > maxY) maxY = value;
      }
      return minY <= maxY ? { minY, maxY } : null;
    }

    for (const blockEdge = firstFullBlock * this.blockSize; i < blockEdge; i++) {
      const value = this.values[i]!;
      if (!Number.isFinite(value)) continue;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }

    let left = this.base + firstFullBlock;
    let right = this.base + lastFullBlock;
    while (left < right) {
      if (left & 1) {
        if (this.minTree[left]! < minY) minY = this.minTree[left]!;
        if (this.maxTree[left]! > maxY) maxY = this.maxTree[left]!;
        left++;
      }
      if (right & 1) {
        right--;
        if (this.minTree[right]! < minY) minY = this.minTree[right]!;
        if (this.maxTree[right]! > maxY) maxY = this.maxTree[right]!;
      }
      left >>= 1;
      right >>= 1;
    }

    for (i = lastFullBlock * this.blockSize; i < to; i++) {
      const value = this.values[i]!;
      if (!Number.isFinite(value)) continue;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
    return minY <= maxY ? { minY, maxY } : null;
  }

  /** Query `count` samples of a ring buffer starting at a physical index, wrapping at capacity. */
  queryRing(physicalStart: number, count: number): MinMaxY | null {
    if (count <= 0) return null;
    const end = physicalStart + count;
    if (end <= this.capacity) return this.query(physicalStart, end);

    const first = this.query(physicalStart, this.capacity);
    const second = this.query(0, end - this.capacity);
    if (!first) return second;
    if (!second) return first;
    return { minY: Math.min(first.minY, second.minY), maxY: Math.max(first.maxY, second.maxY) };
  }

  private recomputeNode(node: number): void {
    const left = node << 1;
    const right = left + 1;
    this.minTree[node] = Math.min(this.minTree[left]!, this.minTree[right]!);
    this.maxTree[node] = Math.max(this.maxTree[left]!, this.maxTree[right]!);
  }
}
