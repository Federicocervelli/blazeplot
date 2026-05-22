import { lowerBound } from "./search.js";
import type { Dataset } from "./types.js";

/** Cursor helper for seeking within a sorted dataset by X value. */
export class DataCursor {
  private _index: number = -1;
  private _buffer: Dataset | null = null;

  /** Bind the cursor to a dataset and reset its current index. */
  bind(buffer: Dataset): void {
    this._buffer = buffer;
    this._index = -1;
  }

  /** Last index returned by `seekTimestamp`, or -1 before a successful seek. */
  get index(): number {
    return this._index;
  }

  /** Seek to the first sample whose X value is at least `x`. */
  seekTimestamp(x: number): number {
    if (!this._buffer || this._buffer.length === 0) return -1;
    const index = lowerBound(this._buffer.length, (i) => this._buffer!.getX(i), x);
    this._index = index;
    return index;
  }
}
