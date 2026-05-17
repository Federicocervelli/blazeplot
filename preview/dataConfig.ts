export const FILL_BATCH_SIZE = 65_536;
export const LIVE_BATCH_SIZE = 65_536;
export const VIEW_SAMPLES = 1_000_000_000;
export const TRACE_PERIOD = VIEW_SAMPLES / 5;
export const SPARSE_INTERVAL = 512;
export const OHLC_INTERVAL = SPARSE_INTERVAL * 8;

// Keep all streaming series at roughly the same X-history span. Sparse series
// append one point every SPARSE_INTERVAL samples, so their point capacity must
// be scaled down or they will stay visible much longer than the dense line.
export const HISTORY_SAMPLES = 1_000_000_000;
export const SPARSE_HISTORY_CAPACITY = Math.ceil(HISTORY_SAMPLES / SPARSE_INTERVAL) + 2;
export const OHLC_HISTORY_CAPACITY = Math.ceil(HISTORY_SAMPLES / OHLC_INTERVAL) + 2;
export const Y_VIEW = { yMin: -1.25, yMax: 1.35 } as const;

export interface PreviewDataBatch {
  readonly type: "batch";
  readonly start: number;
  readonly end: number;
  readonly batchSize: number;
  readonly sparseCount: number;
  readonly ohlcCount: number;
  readonly lineY: ArrayBuffer;
  readonly areaY: ArrayBuffer | null;
  readonly spikeY: ArrayBuffer | null;
  readonly barY: ArrayBuffer | null;
  readonly ohlcX: ArrayBuffer | null;
  readonly ohlcOpen: ArrayBuffer | null;
  readonly ohlcHigh: ArrayBuffer | null;
  readonly ohlcLow: ArrayBuffer | null;
  readonly ohlcClose: ArrayBuffer | null;
  readonly sparseStart: number;
}

export type PreviewDataWorkerRequest =
  | { readonly type: "generate" }
  | { readonly type: "release"; readonly buffers: readonly ArrayBuffer[] };
