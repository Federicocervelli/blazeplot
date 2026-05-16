import type { RingBuffer } from "./RingBuffer.js";

export class DataCursor {
  private _index: number = -1;
  private _buffer: RingBuffer | null = null;

  bind(buffer: RingBuffer): void {
    this._buffer = buffer;
    this._index = -1;
  }

  get index(): number {
    return this._index;
  }

  seekTimestamp(x: number): number {
    if (!this._buffer || this._buffer.length === 0) return -1;
    let lo = 0;
    let hi = this._buffer.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._buffer.getX(mid) < x) lo = mid + 1;
      else hi = mid;
    }
    this._index = lo;
    return lo;
  }
}
