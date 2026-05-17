import { lowerBound } from "./search.js";
import type { Dataset } from "./types.js";

export class DataCursor {
  private _index: number = -1;
  private _buffer: Dataset | null = null;

  bind(buffer: Dataset): void {
    this._buffer = buffer;
    this._index = -1;
  }

  get index(): number {
    return this._index;
  }

  seekTimestamp(x: number): number {
    if (!this._buffer || this._buffer.length === 0) return -1;
    const index = lowerBound(this._buffer.length, (i) => this._buffer!.getX(i), x);
    this._index = index;
    return index;
  }
}
