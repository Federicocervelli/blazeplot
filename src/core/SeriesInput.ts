/**
 * Payload types accepted by `SeriesStore.append` / `updateAt` / `replace` and the guards that tell them apart.
 */
import type { Dataset, OhlcDataset } from "./types.js";

export function toArrayLike(value: SeriesScalarOrArray): ArrayLike<number> {
  return typeof value === "number" ? [value] : value;
}

export function isOhlcAppendData(data: SeriesObjectAppendData | SeriesAppendRow): data is SeriesOhlcAppendData | SeriesOhlcAppendRow {
  return typeof data === "object" && data !== null && "open" in data && "high" in data && "low" in data && "close" in data;
}

export function isOhlcUpdateData(data: SeriesUpdateData): data is SeriesOhlcUpdateData {
  return "open" in data && "high" in data && "low" in data && "close" in data;
}

/** Single numeric sample value or a batch of values. */
export type SeriesScalarOrArray = number | ArrayLike<number>;

/** Object form for appending one XY sample or a batch of X/Y arrays. Omit `x` for implicit-X series. */
export interface SeriesXYAppendData {
  readonly x?: SeriesScalarOrArray;
  readonly y: SeriesScalarOrArray;
}

/** Object form for appending one OHLC sample or a batch of OHLC arrays. */
export interface SeriesOhlcAppendData {
  readonly x: SeriesScalarOrArray;
  readonly open: SeriesScalarOrArray;
  readonly high: SeriesScalarOrArray;
  readonly low: SeriesScalarOrArray;
  readonly close: SeriesScalarOrArray;
}

/** Convenient object-row form for appending one XY sample inside a row batch. */
export interface SeriesXYAppendRow {
  readonly x?: number;
  readonly y: number;
}

/** Convenient object-row form for appending one OHLC sample inside a row batch. */
export interface SeriesOhlcAppendRow {
  readonly x: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Object form for updating one XY sample. */
export interface SeriesXYUpdateData {
  readonly x?: number;
  readonly y: number;
}

/** Object form for updating one OHLC sample. */
export interface SeriesOhlcUpdateData {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** Any supported update payload for the last or indexed sample. */
export type SeriesUpdateData = SeriesXYUpdateData | SeriesOhlcUpdateData;
/** Any supported object row for batched appends. */
export type SeriesAppendRow = SeriesXYAppendRow | SeriesOhlcAppendRow;
/** Any object payload for appending one or more samples. */
export type SeriesObjectAppendData = SeriesXYAppendData | SeriesOhlcAppendData;
/** Any payload accepted by `SeriesStore.append`. */
export type SeriesAppendData = SeriesObjectAppendData | readonly SeriesAppendRow[];

/** Payload accepted by `series.replace(...)`: whatever the backing dataset's `replace` method takes. */
export type SeriesReplaceData<D extends Dataset> = D extends { replace(data: infer T): void } ? T : never;

/** Object form for appending Y-only samples to an evenly spaced (implicit-X) series. */
export interface SeriesYAppendData {
  readonly y: SeriesScalarOrArray;
  readonly x?: undefined;
}

/** Object form for appending X/Y samples, with X required. */
export interface SeriesXYExplicitAppendData {
  readonly x: SeriesScalarOrArray;
  readonly y: SeriesScalarOrArray;
}

/** Object form for updating a Y-only (implicit-X) sample. */
export interface SeriesYUpdateData {
  readonly y: number;
  readonly x?: undefined;
}

/**
 * What `series.append(...)` accepts for a series backed by dataset `D`, so a call the dataset cannot
 * serve fails to compile (and still throws a `TypeError` at run time):
 *
 * - X/Y datasets with `append(x, y)` such as `RingBuffer` take `{ x, y }` (scalars or arrays) or rows of `{ x, y }`.
 * - Implicit-X datasets with `appendY(y)` such as `UniformRingBuffer` take `{ y }` or rows of `{ y }`.
 * - OHLC datasets with `append(x, open, high, low, close)` such as `OhlcRingBuffer` take OHLC objects or rows.
 * - Read-only datasets such as `StaticDataset` take nothing (`never`).
 * - A series typed as the bare `Dataset` interface, which promises no append method, takes nothing: keep the
 *   concrete dataset type (the `add*` helpers return it) to append.
 */
export type SeriesAppendFor<D extends Dataset> =
    | (D extends OhlcDataset & { append(x: ArrayLike<number>, open: ArrayLike<number>, high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>): void }
      ? SeriesOhlcAppendData | readonly SeriesOhlcAppendRow[]
      : never)
    | (D extends { append(x: ArrayLike<number>, y: ArrayLike<number>): void } ? SeriesXYExplicitAppendData | readonly Required<SeriesXYAppendRow>[] : never)
    | (D extends { appendY(y: ArrayLike<number>): void } ? SeriesYAppendData | readonly { readonly y: number }[] : never);

/**
 * What `series.updateLast(...)` and `series.updateAt(...)` accept for a series backed by dataset `D`:
 * `{ x?, y }` for `RingBuffer`, `{ y }` for `UniformRingBuffer`, `{ open, high, low, close }` for
 * `OhlcRingBuffer`, and `never` for datasets without update support, including a bare `Dataset`.
 */
export type SeriesUpdateFor<D extends Dataset> =
    | (D extends OhlcDataset & { updateAt(index: number, open: number, high: number, low: number, close: number): boolean } ? SeriesOhlcUpdateData : never)
    | (D extends { update(index: number, x: number, y: number): boolean }
      ? SeriesXYUpdateData
      : D extends { updateY(index: number, y: number): boolean }
        ? SeriesYUpdateData
        : never);
