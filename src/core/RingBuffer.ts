import { MinMaxTree } from "./MinMaxTree.js";
import type { MinMaxY } from "./MinMaxTree.js";
import { lowerBound, unsortedXWarning, upperBound } from "./search.js";
import { createValueArray } from "./valueArray.js";
import type { BufferOverflowStrategy, TimeRange, ValuePrecision } from "./types.js";

/** Options for `RingBuffer`. */
export interface RingBufferOptions {
  /** Behavior once the buffer is full. Defaults to `"wrap"` (drop the oldest sample). */
  readonly overflow?: BufferOverflowStrategy;
  /** Y storage. Defaults to `"float32"`; use `"float64"` to keep large values exact. */
  readonly valuePrecision?: ValuePrecision;
}

/** Fixed-capacity sorted XY buffer for explicit X values. */
export class RingBuffer {
  /** Maximum number of retained samples. */
  readonly capacity: number;
  readonly rangeMinMaxExcludesGaps = true;
  private _length: number = 0;
  private _head: number = 0;
  /** Samples ever stored, including ones skipped by oversized appends. */
  private _written: number = 0;
  private readonly checkOrder = unsortedXWarning("RingBuffer");

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

  /** X range covered by retained samples, or `null` when empty. */
  get range(): TimeRange | null {
    if (this._length === 0) return null;
    return { start: this.getX(0), end: this.getX(this._length - 1) };
  }

  /** Append one XY sample. */
  push(x: number, y: number): void {
    if (this._length >= this.capacity) {
      if (this.overflow === "drop-new") return;
      if (this.overflow === "error") throw new RangeError("RingBuffer capacity exceeded.");
    }

    const lastX = this.lastX();
    if (x < lastX) this.checkOrder(lastX, x);
    const physical = this._head;
    this.xData[physical] = x;
    this.yData[physical] = y;
    this._head = (physical + 1) % this.capacity;
    this._written++;
    if (this._length < this.capacity) {
      this._length++;
      this.tree.include(physical, this.yData[physical]!);
    } else {
      this.tree.update(physical, physical + 1);
    }
  }

  /** Append matching X and Y arrays. */
  append(x: ArrayLike<number>, y: ArrayLike<number>): void {
    const requested = Math.min(x.length, y.length);
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

  /** Replace a sample by logical index. */
  update(index: number, x: number, y: number): boolean {
    if (!this.isValidIndex(index)) return false;
    if (index > 0) this.checkOrder(this.getX(index - 1), x);
    if (index < this._length - 1) this.checkOrder(x, this.getX(index + 1));
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
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(this._length, Math.ceil(end));
    if (to <= from) return null;
    return this.tree.queryRing(this.logicalToPhysical(from), to - from);
  }

  /** Remove all retained samples. */
  clear(): void {
    this._length = 0;
    this._head = 0;
    this.tree.reset();
  }

  private appendChunks(x: ArrayLike<number>, y: ArrayLike<number>, sourceOffset: number, count: number): void {
    let source = sourceOffset;
    let remaining = count;
    let previousX = this.lastX();
    while (remaining > 0) {
      const start = this._head;
      const chunk = Math.min(remaining, this.capacity - start);
      for (let i = 0; i < chunk; i++) {
        const nextX = x[source + i]!;
        if (nextX < previousX) this.checkOrder(previousX, nextX);
        previousX = nextX;
        this.xData[start + i] = nextX;
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

  /** X of the newest sample, or NaN when empty (NaN never compares as out of order). */
  private lastX(): number {
    return this._length > 0 ? this.xData[this._head === 0 ? this.capacity - 1 : this._head - 1]! : NaN;
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
