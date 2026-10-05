import { MinMaxTree } from "./MinMaxTree.js";
import type { MinMaxOut, MinMaxY } from "./MinMaxTree.js";
import { lowerBound, upperBound } from "./search.js";
import { createValueArray } from "./valueArray.js";
import type { BufferOverflowStrategy, InvalidSample, TimeRange, ValuePrecision } from "./types.js";
import { assertEqualLengths, MAX_X, MIN_X, firstInvalidX, invalidSampleWarning, invalidXReason } from "./validation.js";

/** Options for `RingBuffer`. */
export interface RingBufferOptions {
  /** Behavior once the buffer is full. Defaults to `"wrap"` (drop the oldest sample). */
  readonly overflow?: BufferOverflowStrategy;
  /** Y storage. Defaults to `"float32"`; use `"float64"` to keep large values exact. */
  readonly valuePrecision?: ValuePrecision;
  /**
   * Called for each sample skipped because its X is non-finite or below the last accepted X
   * (or, for `update`, outside its neighbors). When set, the one-time console warning is not logged.
   */
  readonly onInvalidSample?: (sample: InvalidSample) => void;
}

/**
 * Fixed-capacity sorted XY buffer for explicit X values.
 *
 * X must be finite and non-decreasing. A sample that breaks that rule is skipped (never
 * thrown), counted in `rejectedSamples`, reported to `onInvalidSample`, and logged with one
 * console warning per buffer when no callback is set. Non-finite Y is stored and drawn as a gap.
 *
 * This differs from `StaticDataset`, `StaticOhlcDataset`, and `ServerSampledDataset`, which throw a
 * `RangeError` on a non-finite or decreasing X: a live feed should not crash on one bad packet, but
 * data you hand over in one piece should be fixed at the source. See "Data semantics" in the docs.
 */
export class RingBuffer {
  /** Maximum number of retained samples. */
  readonly capacity: number;
  readonly rangeMinMaxExcludesGaps = true;
  private _length: number = 0;
  private _head: number = 0;
  /** Samples ever stored, including ones skipped by oversized appends. */
  private _written: number = 0;
  private _rejected: number = 0;
  private readonly onInvalidSample: ((sample: InvalidSample) => void) | undefined;
  private readonly warnInvalid: ReturnType<typeof invalidSampleWarning>;

  private readonly xData: Float64Array;
  private readonly yData: Float32Array | Float64Array;
  private readonly tree: MinMaxTree;
  private readonly overflow: BufferOverflowStrategy;

  /** Create an explicit-X ring buffer with a fixed sample capacity. */
  constructor(capacity: number, options: RingBufferOptions = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be a positive integer.");
    }

    this.capacity = capacity;
    this.overflow = options.overflow ?? "wrap";
    this.onInvalidSample = options.onInvalidSample;
    this.warnInvalid = invalidSampleWarning("RingBuffer", options.onInvalidSample !== undefined);
    this.xData = new Float64Array(capacity);
    this.yData = createValueArray(capacity, options.valuePrecision);
    this.tree = new MinMaxTree(this.yData, capacity);
  }

  /** Number of retained samples. */
  get length(): number {
    return this._length;
  }

  /** Samples dropped from the front since creation, so `ordinalOffset + index` is stable while the buffer wraps. */
  get ordinalOffset(): number {
    return this._written - this._length;
  }

  /**
   * Samples skipped since creation because their X was non-finite or went backwards,
   * including refused `update` calls. Not reset by `clear()`.
   */
  get rejectedSamples(): number {
    return this._rejected;
  }

  /** X range covered by retained samples, or `null` when empty. */
  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.getX(0), end: this.getX(this._length - 1) };
  }

  /** Append one XY sample. A non-finite `x`, or one below the last accepted X, skips the sample. */
  push(x: number, y: number): void {
    const floor = this.acceptFloor();
    if (!(x >= floor && x <= MAX_X)) {
      this.reject("push", 0, x, y, floor);
      return;
    }
    if (this._length >= this.capacity) {
      if (this.overflow === "drop-new") return;
      if (this.overflow === "error") throw new RangeError("RingBuffer capacity exceeded.");
    }

    const physical = this._head;
    this.xData[physical] = x;
    this.yData[physical] = y;
    this._head = (physical + 1) % this.capacity;
    this._written++;
    if (this._length < this.capacity) this._length++;
    this.tree.update(physical, physical + 1, this.validEnd());
  }

  /**
   * Append matching X and Y arrays. Samples whose X is non-finite or below the previous
   * accepted X are skipped and do not count toward capacity or overflow, so the result
   * matches calling `push` for each pair (except that `overflow: "error"` throws before
   * storing anything).
   */
  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    assertEqualLengths("RingBuffer.append", { x, y });
    let requested = x.length;
    if (requested <= 0) return;

    // drop-new stores at most `limit` samples; later valid samples are dropped without
    // moving the X floor, exactly as if each pair were pushed.
    const limit = this.overflow === "drop-new" ? this.capacity - this._length : requested;
    const storable = Math.min(requested, limit);
    const floor = this.acceptFloor();
    const firstInvalid = firstInvalidX(x, storable, floor);
    if (firstInvalid < storable) {
      const keptX = new Float64Array(storable);
      const keptY = new Float64Array(storable);
      let kept = 0;
      let next = floor;
      for (let i = 0; i < requested; i++) {
        const xi = x[i]!;
        if (!(xi >= next && xi <= MAX_X)) {
          this.reject("append", i, xi, y[i]!, next);
          continue;
        }
        if (kept >= limit) continue;
        next = xi;
        keptX[kept] = xi;
        keptY[kept] = y[i]!;
        kept++;
      }
      x = keptX;
      y = keptY;
      requested = kept;
    } else if (storable < requested) {
      this.rejectDropped(x, y, storable, requested, storable > 0 ? x[storable - 1]! : floor);
      requested = storable;
    }
    if (requested <= 0) return;

    if (this.overflow !== "wrap") {
      const available = this.capacity - this._length;
      if (requested > available && this.overflow === "error") {
        throw new RangeError("RingBuffer capacity exceeded.");
      }
      this.appendChunks(x, y, 0, Math.min(requested, available));
      return;
    }

    if (requested >= this.capacity) {
      this._written += requested - this.capacity;
      this._head = 0;
      this._length = 0;
      this.appendChunks(x, y, requested - this.capacity, this.capacity);
      return;
    }

    this.appendChunks(x, y, 0, requested);
  }

  /**
   * Replace a sample by logical index. An `x` that is non-finite or outside its neighbors'
   * X values leaves the sample unchanged, counts as rejected, and returns `false`.
   */
  update(index: number, x: number, y: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const previous = index > 0 ? this.getX(index - 1) : MIN_X;
    const next = index < this._length - 1 ? this.getX(index + 1) : MAX_X;
    if (!(x >= previous && x <= next)) {
      this.reject("update", index, x, y, x > next ? next : previous);
      return false;
    }
    const physical = this.logicalToPhysical(index);
    this.xData[physical] = x;
    this.yData[physical] = y;
    this.tree.update(physical, physical + 1, this.validEnd());
    return true;
  }

  /** Replace only the Y value at a logical index. */
  updateY(index: number, y: number): boolean {
    if (!this.isValidIndex(index)) return false;
    const physical = this.logicalToPhysical(index);
    this.yData[physical] = y;
    this.tree.update(physical, physical + 1, this.validEnd());
    return true;
  }

  /** Return the X value at a logical index. */
  getX(index: number): number {
    this.assertValidIndex(index);
    return this.xData[this.logicalToPhysical(index)]!;
  }

  /** Return the Y value at a logical index. */
  getY(index: number): number {
    this.assertValidIndex(index);
    return this.yData[this.logicalToPhysical(index)]!;
  }

  /** @internal Bulk-read logical samples `[start, end)` into Float64 scratch arrays (indices must be valid). */
  readXYRange(start: number, end: number, xOut: Float64Array, yOut: Float64Array): void {
    const count = end - start;
    if (count <= 0) return;
    const physical = this.logicalToPhysical(start);
    const first = Math.min(count, this.capacity - physical);
    xOut.set(this.xData.subarray(physical, physical + first), 0);
    yOut.set(this.yData.subarray(physical, physical + first), 0);
    if (first < count) {
      xOut.set(this.xData.subarray(0, count - first), first);
      yOut.set(this.yData.subarray(0, count - first), first);
    }
  }

  /** Return whether the sample should be rendered as a gap. */
  isGap(index: number): boolean {
    return !Number.isFinite(this.getY(index));
  }

  /** Return the first logical index whose X value is at least `x`. */
  lowerBoundX(x: number): number {
    return lowerBound(this._length, (index) => this.xData[this.logicalToPhysical(index)]!, x);
  }

  /** Return the first logical index whose X value is greater than `x`. */
  upperBoundX(x: number): number {
    return upperBound(this._length, (index) => this.xData[this.logicalToPhysical(index)]!, x);
  }

  /** Return min/max Y values for a logical index range. */
  rangeMinMaxY(start: number, end: number): MinMaxY | null {
    const out = { minY: 0, maxY: 0 };
    return this.rangeMinMaxInto(start, end, out) ? out : null;
  }

  /** @internal Allocation-free `rangeMinMaxY`: writes into `out` and returns whether the range holds a finite value. */
  rangeMinMaxInto(start: number, end: number, out: MinMaxOut): boolean {
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    if (to <= from) return false;
    return this.tree.queryRingInto(this.logicalToPhysical(from), to - from, out);
  }

  /** Remove all retained samples. The next sample may start at any finite X. */
  clear(): void {
    this._length = 0;
    this._head = 0;
    this.tree.update(0, this.capacity, 0);
  }

  /** Store already-validated samples. */
  private appendChunks(x: ArrayLike<number>, y: ArrayLike<number>, sourceOffset: number, count: number): void {
    let source = sourceOffset;
    let remaining = count;
    while (remaining > 0) {
      const start = this._head;
      const chunk = Math.min(remaining, this.capacity - start);
      for (let i = 0; i < chunk; i++) {
        this.xData[start + i] = x[source + i]!;
        this.yData[start + i] = y[source + i]!;
      }
      this._head = (start + chunk) % this.capacity;
      this._written += chunk;
      this._length = Math.min(this.capacity, this._length + chunk);
      this.tree.update(start, start + chunk, this.validEnd());
      source += chunk;
      remaining -= chunk;
    }
  }

  /** Lowest X the next sample may have: the newest retained X, or `MIN_X` when empty. */
  private acceptFloor(): number {
    return this._length > 0 ? this.xData[this._head === 0 ? this.capacity - 1 : this._head - 1]! : MIN_X;
  }

  /** Count invalid samples among ones `drop-new` drops anyway; the X floor stays at the last stored sample. */
  private rejectDropped(x: ArrayLike<number>, y: ArrayLike<number>, from: number, to: number, floor: number): void {
    for (let i = from; i < to; i++) {
      const xi = x[i]!;
      if (!(xi >= floor && xi <= MAX_X)) this.reject("append", i, xi, y[i]!, floor);
    }
  }

  private reject(operation: InvalidSample["operation"], index: number, x: number, y: number, neighborX: number): void {
    this._rejected++;
    const reason = invalidXReason(x);
    const neighbor = reason === "decreasing-x" ? neighborX : NaN;
    this.warnInvalid(reason, x, neighbor);
    this.onInvalidSample?.({ reason, operation, index, x, y, neighborX: neighbor });
  }

  /** Physical samples below this index hold live data; the ring fills from index 0. */
  private validEnd(): number {
    return this._length === this.capacity ? this.capacity : this._length;
  }

  private logicalToPhysical(index: number): number {
    return (this._head - this._length + index + this.capacity) % this.capacity;
  }

  private isValidIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this._length;
  }

  private assertValidIndex(index: number): void {
    if (!this.isValidIndex(index)) {
      throw new RangeError(`RingBuffer index out of range: ${index}`);
    }
  }
}
