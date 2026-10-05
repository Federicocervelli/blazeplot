/**
 * Type-level tests for the series API. This file is never executed: `bun run typecheck` (tsc) is the
 * test. Every `@ts-expect-error` line must keep failing to compile, and every line without one must
 * keep compiling, so loosening the types fails the typecheck just like tightening them does.
 */
import { Chart, HistogramDataset, OhlcRingBuffer, RingBuffer, StaticDataset, StaticOhlcDataset, UniformRingBuffer } from "../../src/index.ts";
import type { SeriesStore } from "../../src/index.ts";

declare const chart: Chart;
declare const x: Float64Array;
declare const y: Float32Array;

const staticData = new StaticDataset(x, y);
const ohlcData = new StaticOhlcDataset(x, y, y, y, y);

// --- accepted configs, and the dataset type each one returns -------------------------------------

const fromDataset: SeriesStore<StaticDataset> = chart.addLine({ dataset: staticData, name: "static" });
const fromRing: SeriesStore<RingBuffer> = chart.addLine({ capacity: 100, overflow: "drop-new", valuePrecision: "float64" });
const fromUniform: SeriesStore<UniformRingBuffer> = chart.addArea({ capacity: 100, xStep: 1, xStart: 0 });
const fromUniformStartOnly: SeriesStore<UniformRingBuffer> = chart.addScatter({ capacity: 100, xStart: 10 });
const bars: SeriesStore<HistogramDataset> = chart.addBar({ dataset: HistogramDataset.from([1, 2, 3], { binCount: 2 }) });
const candles: SeriesStore<StaticOhlcDataset> = chart.addCandlestick({ dataset: ohlcData });
const ohlcRing = new OhlcRingBuffer(10);
const ohlcSeries: SeriesStore<OhlcRingBuffer> = chart.addOhlc({ dataset: ohlcRing });
const viaAddSeries: SeriesStore<RingBuffer> = chart.addSeries({ mode: "line", capacity: 10 });

// --- config errors ---------------------------------------------------------------------------------

// @ts-expect-error a candlestick needs an OhlcDataset: there is no capacity shorthand
chart.addCandlestick({ capacity: 100 });
// @ts-expect-error an OHLC series needs an OhlcDataset, not an XY dataset
chart.addOhlc({ dataset: staticData });
// @ts-expect-error capacity configures a chart-created buffer and is ignored next to a dataset
chart.addLine({ capacity: 100, dataset: staticData });
// @ts-expect-error xStep without capacity describes no buffer
chart.addLine({ xStep: 1 });
// @ts-expect-error xStep cannot be combined with a dataset
chart.addLine({ dataset: staticData, xStep: 1 });
// @ts-expect-error a series needs a dataset or a capacity
chart.addLine({ name: "empty" });
// @ts-expect-error overflow other than "wrap" does not exist on a uniform buffer
chart.addLine({ capacity: 10, xStep: 1, overflow: "error" });
// @ts-expect-error onInvalidSample belongs to the explicit-X buffer; a uniform buffer never rejects samples
chart.addLine({ capacity: 10, xStep: 1, onInvalidSample: () => undefined });
// @ts-expect-error xStart needs a capacity too
chart.addLine({ xStart: 0 });
// @ts-expect-error addSeries takes the same union: candlestick modes need a dataset
chart.addSeries({ mode: "candlestick", capacity: 10 });
// @ts-expect-error unknown option names are rejected, not ignored
chart.addLine({ capacity: 10, capacty: 20 });

// --- append / update by dataset ---------------------------------------------------------------------

fromRing.append({ x: 1, y: 2 });
fromRing.append({ x: [1, 2], y: [3, 4] });
fromRing.append([{ x: 1, y: 2 }]);
fromRing.updateLast({ x: 1, y: 2 });
fromRing.updateAt(0, { y: 5 });
// @ts-expect-error an explicit-X ring needs x
fromRing.append({ y: 2 });
// @ts-expect-error OHLC payloads do not fit an XY ring
fromRing.append({ x: 1, open: 1, high: 2, low: 0, close: 1 });

fromUniform.append({ y: 1 });
fromUniform.append({ y: [1, 2, 3] });
fromUniform.updateLast({ y: 2 });
// @ts-expect-error a uniform series derives X; updating X is not possible
fromUniform.updateAt(0, { x: 1, y: 2 });

// @ts-expect-error a StaticDataset-backed series cannot be appended to
fromDataset.append({ x: 1, y: 2 });
// @ts-expect-error nor updated
fromDataset.updateLast({ y: 2 });

ohlcSeries.append({ x: 1, open: 1, high: 2, low: 0, close: 1 });
ohlcSeries.updateLast({ open: 1, high: 2, low: 0, close: 1 });
// @ts-expect-error an OHLC series takes OHLC payloads, not { y }
ohlcSeries.append({ y: 1 });
// @ts-expect-error nor an XY update
ohlcSeries.updateLast({ y: 1 });
// @ts-expect-error a static OHLC series is read-only
candles.append({ x: 1, open: 1, high: 2, low: 0, close: 1 });

// A bare `SeriesStore` (what `getSeriesState()` hands out) keeps every form; the runtime still checks.
declare const anySeries: SeriesStore;
anySeries.append({ y: 1 });
anySeries.append({ x: 1, y: 1 });

export const used = [fromDataset, fromRing, fromUniform, fromUniformStartOnly, bars, candles, ohlcSeries, viaAddSeries];
