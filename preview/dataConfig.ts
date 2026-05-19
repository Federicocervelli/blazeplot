export const LIVE_BATCH_SIZE = 256;
export const VIEW_SAMPLES = 86_400;
export const PREVIEW_X_STEP_MS = 1;
export const DEFAULT_APPEND_RATE = 1_000;
export const MAX_VIEW_SAMPLES = 1_000_000_000;
export const PREVIEW_START_TIME = Date.now() - VIEW_SAMPLES * PREVIEW_X_STEP_MS;
export const TRACE_PERIOD = VIEW_SAMPLES;
export const SPARSE_INTERVAL = 60; // one sparse point per minute
export const OHLC_INTERVAL = SPARSE_INTERVAL * 5; // five-minute candles

// Default capacities. The main preview recreates its datasets when the user
// changes the view span so history follows the requested visible sample count.
export const HISTORY_SAMPLES = VIEW_SAMPLES;
export const SPARSE_HISTORY_CAPACITY = Math.ceil(HISTORY_SAMPLES / SPARSE_INTERVAL) + 2;
export const OHLC_HISTORY_CAPACITY = Math.ceil(HISTORY_SAMPLES / OHLC_INTERVAL) + 2;
export const Y_VIEW = { yMin: -1.25, yMax: 1.35 } as const;

export interface PreviewDataBatch {
  readonly type: "batch";
  readonly generation: number;
  readonly start: number;
  readonly end: number;
  readonly batchSize: number;
  readonly sparseCount: number;
  readonly ohlcCount: number;
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
  | { readonly type: "generate"; readonly batchSize: number; readonly generation: number }
  | { readonly type: "reset"; readonly generation: number; readonly xStart: number; readonly xStepMs: number }
  | { readonly type: "release"; readonly buffers: readonly ArrayBuffer[] };
