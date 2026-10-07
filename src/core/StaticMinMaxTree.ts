import { MinMaxTree } from "./MinMaxTree.js";

/**
 * Min/max tree of a fixed array that can be summarized in one pass. For a first query that spans most
 * of a large static series (the full-range first view) the lazy walk visits nearly every node anyway,
 * and one pass over the blocks followed by one pass per level costs a fraction of walking the tree node
 * by node. Kept apart from `MinMaxTree` so the shared lazy tree, which the streaming buffers use, is untouched.
 */
export class StaticMinMaxTree extends MinMaxTree {
  /** Summarize every block now, level by level. Nodes that are already current are kept. */
  summarizeAll(): void {
    const { valid, minTree, maxTree, values, base, blockSize, validEnd } = this;
    for (let leaf = base; leaf < base * 2; leaf++) {
      if (valid[leaf] !== 0) continue;
      const from = (leaf - base) * blockSize;
      summarizeBlock(values, from, Math.min(validEnd, from + blockSize), minTree, maxTree, leaf);
      valid[leaf] = 1;
    }
    for (let low = base >> 1, high = base; low >= 1; low >>= 1, high >>= 1) {
      for (let parent = low; parent < high; parent++) {
        if (valid[parent] !== 0) continue;
        const left = parent << 1;
        minTree[parent] = Math.min(minTree[left]!, minTree[left + 1]!);
        maxTree[parent] = Math.max(maxTree[left]!, maxTree[left + 1]!);
        valid[parent] = 1;
      }
    }
  }
}

/**
 * Write the finite extent of `values[from, to)` to `minTree[node]` / `maxTree[node]` (an empty block gets
 * `Infinity` / `-Infinity`). Four independent accumulators, because one running pair is a serial
 * compare-and-select chain per sample. NaN fails every comparison, so gaps are skipped for free; only an
 * infinity gets through, and it shows up as an infinite extreme, which sends the block to the exact loop.
 */
function summarizeBlock(values: ArrayLike<number>, from: number, to: number, minTree: Float32Array | Float64Array, maxTree: Float32Array | Float64Array, node: number): void {
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
    for (let j = from; j < to; j++) {
      const value = values[j]!;
      if (!Number.isFinite(value)) continue;
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
  }
  minTree[node] = minY;
  maxTree[node] = maxY;
}
