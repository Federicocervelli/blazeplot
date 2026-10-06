/** Pure helpers for the performance regression gate (`scripts/perf-gate.ts`); unit-tested in `tests/scripts/perfGate.test.ts`. */

export interface MetricThreshold {
  /** Expected median value on the reference runner; the failure limit is `baseline * headroom`. */
  readonly baseline: number;
  /** Multiplier over `baseline` above which the gate fails. Overrides `defaultHeadroom`. */
  readonly headroom?: number;
  /** Human-readable description printed in the report. */
  readonly description?: string;
}

export interface PerfThresholds {
  readonly scenario: string;
  /** Measured repetitions per attempt (after discarded warmup repetitions). */
  readonly repetitions: number;
  /** Extra repetitions added when the first attempt fails, to rule out a noisy runner before failing. */
  readonly retryRepetitions: number;
  /** Repetitions run and thrown away first, so browser/GPU-process startup does not skew the samples. */
  readonly discardedRepetitions: number;
  readonly defaultHeadroom: number;
  readonly metrics: Readonly<Record<string, MetricThreshold>>;
}

/** Raw numbers the gate reads from one benchmark page run (a subset of the bench page's result). */
export interface GateRunInput {
  readonly calibrationMs: number;
  readonly ingestMs: number;
  readonly chart: {
    readonly frameMs: { readonly p50: number; readonly p95: number };
    readonly pointsRendered: { readonly p95: number };
    readonly drawCalls: { readonly p95: number };
    readonly uploadBytes: { readonly p95: number };
  };
}

export type MetricValues = Readonly<Record<string, number>>;

export interface MetricVerdict {
  readonly name: string;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly baseline: number;
  readonly limit: number;
  readonly ratioToBaseline: number;
  readonly pass: boolean;
}

export const METRIC_NAMES = ["frameP50Ratio", "frameP95Ratio", "ingestRatio", "drawCallsP95", "pointsRenderedP95", "uploadBytesP95"] as const;

/**
 * Turns one page result into gate metrics. Time metrics are divided by the in-page calibration
 * workload time, so they are dimensionless and mostly independent of runner speed and load.
 * Count metrics are deterministic for a fixed scenario and are compared as-is.
 */
export function extractMetrics(run: GateRunInput): MetricValues {
  if (!(run.calibrationMs > 0)) throw new Error(`Invalid calibrationMs: ${run.calibrationMs}`);
  return {
    frameP50Ratio: run.chart.frameMs.p50 / run.calibrationMs,
    frameP95Ratio: run.chart.frameMs.p95 / run.calibrationMs,
    ingestRatio: run.ingestMs / run.calibrationMs,
    drawCallsP95: run.chart.drawCalls.p95,
    pointsRenderedP95: run.chart.pointsRendered.p95,
    uploadBytesP95: run.chart.uploadBytes.p95,
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function limitFor(threshold: MetricThreshold, defaultHeadroom: number): number {
  return threshold.baseline * (threshold.headroom ?? defaultHeadroom);
}

/** Compares the median of each metric across runs with its limit. Metrics without a threshold are ignored. */
export function evaluate(thresholds: PerfThresholds, runs: readonly MetricValues[]): MetricVerdict[] {
  if (runs.length === 0) throw new Error("No benchmark runs to evaluate");
  return Object.entries(thresholds.metrics).map(([name, threshold]) => {
    const values = runs.map((run) => {
      const value = run[name];
      if (value === undefined || !Number.isFinite(value)) throw new Error(`Run is missing metric '${name}'`);
      return value;
    });
    const med = median(values);
    const limit = limitFor(threshold, thresholds.defaultHeadroom);
    return {
      name,
      median: med,
      min: Math.min(...values),
      max: Math.max(...values),
      baseline: threshold.baseline,
      limit,
      ratioToBaseline: threshold.baseline > 0 ? med / threshold.baseline : Infinity,
      pass: med <= limit,
    };
  });
}

/** Returns a copy of `thresholds` whose baselines are the measured medians, rounded to 4 significant digits. */
export function withBaselines(thresholds: PerfThresholds, runs: readonly MetricValues[]): PerfThresholds {
  const metrics: Record<string, MetricThreshold> = {};
  for (const [name, threshold] of Object.entries(thresholds.metrics)) {
    const med = median(runs.map((run) => run[name] ?? Number.NaN));
    if (!Number.isFinite(med)) throw new Error(`Run is missing metric '${name}'`);
    metrics[name] = { ...threshold, baseline: Number(med.toPrecision(4)) };
  }
  return { ...thresholds, metrics };
}

/** Engines the gate can measure; `webgl2` is the file's top level, the others live under `renderers`. */
export const GATE_RENDERERS = ["webgl2", "canvas2d"] as const;
export type GateRenderer = (typeof GATE_RENDERERS)[number];

/**
 * Parse the thresholds for one engine. The top level of the file is the WebGL2 gate; `renderers.<name>`
 * overrides any of its fields (typically `metrics`: a CPU-drawn engine has its own timings and uploads nothing).
 */
export function parseThresholds(raw: unknown, renderer: GateRenderer = "webgl2"): PerfThresholds {
  if (!raw || typeof raw !== "object") throw new Error("thresholds file must contain a JSON object");
  let value = raw as Record<string, unknown>;
  if (renderer !== "webgl2") {
    const variant = (value.renderers as Record<string, unknown> | undefined)?.[renderer];
    if (!variant || typeof variant !== "object") throw new Error(`thresholds.renderers.${renderer} is missing`);
    value = { ...value, ...(variant as Record<string, unknown>) };
  }
  const positive = (key: string, allowZero = false): number => {
    const n = value[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new Error(`thresholds.${key} must be a ${allowZero ? "non-negative" : "positive"} number`);
    return n;
  };
  if (typeof value.scenario !== "string" || !value.scenario) throw new Error("thresholds.scenario must be a non-empty string");
  const metricsRaw = value.metrics;
  if (!metricsRaw || typeof metricsRaw !== "object") throw new Error("thresholds.metrics must be an object");
  const metrics: Record<string, MetricThreshold> = {};
  for (const [name, entry] of Object.entries(metricsRaw)) {
    const e = entry as Partial<MetricThreshold> | null;
    if (!e || typeof e.baseline !== "number" || !Number.isFinite(e.baseline) || e.baseline <= 0) throw new Error(`thresholds.metrics.${name}.baseline must be a positive number`);
    if (e.headroom !== undefined && (typeof e.headroom !== "number" || !(e.headroom > 1))) throw new Error(`thresholds.metrics.${name}.headroom must be a number greater than 1`);
    metrics[name] = { baseline: e.baseline, ...(e.headroom !== undefined ? { headroom: e.headroom } : {}), ...(typeof e.description === "string" ? { description: e.description } : {}) };
  }
  const defaultHeadroom = positive("defaultHeadroom");
  if (defaultHeadroom <= 1) throw new Error("thresholds.defaultHeadroom must be greater than 1");
  return {
    scenario: value.scenario,
    repetitions: positive("repetitions"),
    retryRepetitions: positive("retryRepetitions", true),
    discardedRepetitions: positive("discardedRepetitions", true),
    defaultHeadroom,
    metrics,
  };
}

export function formatReport(verdicts: readonly MetricVerdict[]): string {
  const rows = verdicts.map((v) => [
    v.pass ? "ok" : "FAIL",
    v.name,
    fmt(v.median),
    `${fmt(v.min)}..${fmt(v.max)}`,
    fmt(v.baseline),
    fmt(v.limit),
    `${v.ratioToBaseline.toFixed(2)}x`,
  ]);
  const header = ["", "metric", "median", "min..max", "baseline", "limit", "vs baseline"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] as string).length)));
  const line = (cells: readonly string[]): string => cells.map((c, i) => c.padEnd(widths[i] as number)).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return Number(value.toPrecision(4)).toString();
}

/** Write refreshed thresholds back into the raw file object: the top level for WebGL2, `renderers.<name>` otherwise. */
export function withUpdatedThresholds(raw: Record<string, unknown>, renderer: GateRenderer, next: PerfThresholds): Record<string, unknown> {
  if (renderer === "webgl2") return { ...raw, ...next, ...(raw.renderers ? { renderers: raw.renderers } : {}) };
  const renderers = (raw.renderers ?? {}) as Record<string, Record<string, unknown>>;
  return { ...raw, renderers: { ...renderers, [renderer]: { ...renderers[renderer], metrics: next.metrics } } };
}
