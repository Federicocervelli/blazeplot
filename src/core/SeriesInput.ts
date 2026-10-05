/**
 * Payload types accepted by `SeriesStore.append` / `updateAt` / `replace` and the guards that tell them apart.
 */
import type { Dataset } from "./types.js";

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
