import {
  FILL_BATCH_SIZE,
  LIVE_BATCH_SIZE,
  OHLC_INTERVAL,
  SPARSE_INTERVAL,
  TRACE_PERIOD,
  VIEW_SAMPLES,
  type PreviewDataBatch,
  type PreviewDataWorkerRequest,
} from "./dataConfig.ts";

type WorkerGlobal = {
  addEventListener(type: "message", listener: (event: MessageEvent<PreviewDataWorkerRequest>) => void): void;
  postMessage(message: PreviewDataBatch, transfer: Transferable[]): void;
};

const worker = globalThis as unknown as WorkerGlobal;
const TAU = Math.PI * 2;
const OMEGA = TAU / TRACE_PERIOD;
const SPARSE_SIN_STEP = Math.sin(OMEGA * SPARSE_INTERVAL);
const SPARSE_COS_STEP = Math.cos(OMEGA * SPARSE_INTERVAL);
const pools = new Map<number, ArrayBuffer[]>();
let t = 0;
let randomState = 0x9e3779b9;

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "release") {
    for (const buffer of message.buffers) releaseBuffer(buffer);
    return;
  }

  postBatch(generateBatch());
});

function generateBatch(): PreviewDataBatch {
  const start = t;
  const batchSize = t < VIEW_SAMPLES ? Math.min(FILL_BATCH_SIZE, VIEW_SAMPLES - t) : LIVE_BATCH_SIZE;
  const end = start + batchSize;
  const sparseStart = Math.ceil(start / SPARSE_INTERVAL) * SPARSE_INTERVAL;
  const sparseCount = sparseStart < end ? Math.floor((end - 1 - sparseStart) / SPARSE_INTERVAL) + 1 : 0;
  const areaY = sparseCount > 0 ? acquireFloat32(sparseCount) : null;
  const spikeY = sparseCount > 0 ? acquireFloat32(sparseCount) : null;
  const barY = sparseCount > 0 ? acquireFloat32(sparseCount) : null;
  if (sparseCount > 0 && areaY && spikeY && barY) {
    fillSparse(sparseStart, sparseCount, areaY, spikeY, barY);
  }

  const ohlcStart = Math.ceil(start / OHLC_INTERVAL) * OHLC_INTERVAL;
  const ohlcCount = ohlcStart < end ? Math.floor((end - 1 - ohlcStart) / OHLC_INTERVAL) + 1 : 0;
  const ohlcX = ohlcCount > 0 ? acquireFloat64(ohlcCount) : null;
  const ohlcOpen = ohlcCount > 0 ? acquireFloat32(ohlcCount) : null;
  const ohlcHigh = ohlcCount > 0 ? acquireFloat32(ohlcCount) : null;
  const ohlcLow = ohlcCount > 0 ? acquireFloat32(ohlcCount) : null;
  const ohlcClose = ohlcCount > 0 ? acquireFloat32(ohlcCount) : null;
  if (ohlcCount > 0 && ohlcX && ohlcOpen && ohlcHigh && ohlcLow && ohlcClose) {
    fillOhlc(ohlcStart, ohlcCount, ohlcX, ohlcOpen, ohlcHigh, ohlcLow, ohlcClose);
  }

  t = end;
  return {
    type: "batch",
    start,
    end,
    batchSize,
    sparseCount,
    ohlcCount,
    areaY: areaY ? areaY.buffer as ArrayBuffer : null,
    spikeY: spikeY ? spikeY.buffer as ArrayBuffer : null,
    barY: barY ? barY.buffer as ArrayBuffer : null,
    ohlcX: ohlcX ? ohlcX.buffer as ArrayBuffer : null,
    ohlcOpen: ohlcOpen ? ohlcOpen.buffer as ArrayBuffer : null,
    ohlcHigh: ohlcHigh ? ohlcHigh.buffer as ArrayBuffer : null,
    ohlcLow: ohlcLow ? ohlcLow.buffer as ArrayBuffer : null,
    ohlcClose: ohlcClose ? ohlcClose.buffer as ArrayBuffer : null,
    sparseStart,
  };
}

function postBatch(batch: PreviewDataBatch): void {
  const transfer: Transferable[] = [];
  appendTransfer(transfer, batch.areaY, batch.spikeY, batch.barY);
  appendTransfer(transfer, batch.ohlcX, batch.ohlcOpen, batch.ohlcHigh, batch.ohlcLow, batch.ohlcClose);
  worker.postMessage(batch, transfer);
}

function appendTransfer(transfer: Transferable[], ...buffers: ArrayBufferOrNull[]): void {
  for (const buffer of buffers) {
    if (buffer) transfer.push(buffer);
  }
}

type ArrayBufferOrNull = ArrayBuffer | null;

function fillSparse(
  start: number,
  count: number,
  areaY: Float32Array,
  spikeY: Float32Array,
  barY: Float32Array,
): void {
  let sin = Math.sin(start * OMEGA);
  let cos = Math.cos(start * OMEGA);
  for (let i = 0; i < count; i++) {
    const x = start + i * SPARSE_INTERVAL;
    const minute = Math.floor(x / SPARSE_INTERVAL);
    const workdayPulse = Math.max(0, sin);
    const batchPulse = minute % 90 < 8 ? 0.14 : 0;
    const incident = minute % 677 < 6 ? 1 : 0;

    areaY[i] = 0.10 + workdayPulse * 0.42 + batchPulse + random01() * 0.025;
    spikeY[i] = -0.58 + random01() * 0.16 + incident * (0.18 + random01() * 0.20);
    barY[i] = -1.08 + workdayPulse * 0.48 + (minute % 30 < 4 ? 0.08 : 0) + random01() * 0.025;
    const nextSin = sin * SPARSE_COS_STEP + cos * SPARSE_SIN_STEP;
    cos = cos * SPARSE_COS_STEP - sin * SPARSE_SIN_STEP;
    sin = nextSin;
  }
}

function fillOhlc(
  start: number,
  count: number,
  xs: Float64Array,
  opens: Float32Array,
  highs: Float32Array,
  lows: Float32Array,
  closes: Float32Array,
): void {
  for (let i = 0; i < count; i++) {
    const x = start + i * OHLC_INTERVAL;
    const index = Math.floor(x / OHLC_INTERVAL);
    const previousX = Math.max(0, x - OHLC_INTERVAL);
    const open = ohlcCloseAt(previousX);
    const close = ohlcCloseAt(x);
    xs[i] = x;
    opens[i] = open;
    highs[i] = Math.max(open, close) + 0.025 + (index % 5) * 0.003;
    lows[i] = Math.min(open, close) - 0.025 - (index % 7) * 0.002;
    closes[i] = close;
  }
}

function ohlcCloseAt(x: number): number {
  const index = Math.floor(x / OHLC_INTERVAL);
  const slowTrend = Math.sin(x * OMEGA * 0.5) * 0.025;
  const intraday = Math.sin(x * OMEGA) * 0.045;
  const micro = Math.cos(index * 0.37) * 0.018;
  return 1.02 + slowTrend + intraday + micro;
}

function random01(): number {
  randomState += 0x6d2b79f5;
  let value = randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function acquireFloat32(length: number): Float32Array {
  return new Float32Array(acquireBuffer(length * Float32Array.BYTES_PER_ELEMENT));
}

function acquireFloat64(length: number): Float64Array {
  return new Float64Array(acquireBuffer(length * Float64Array.BYTES_PER_ELEMENT));
}

function acquireBuffer(byteLength: number): ArrayBuffer {
  return pools.get(byteLength)?.pop() ?? new ArrayBuffer(byteLength);
}

function releaseBuffer(buffer: ArrayBuffer): void {
  let pool = pools.get(buffer.byteLength);
  if (!pool) {
    pool = [];
    pools.set(buffer.byteLength, pool);
  }
  pool.push(buffer);
}
