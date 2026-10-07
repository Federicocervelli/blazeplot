export type MetricDirection = "min" | "max";

export interface MetricDefinition {
  label: string;
  short: string;
  unit: string;
  direction: MetricDirection;
  absNoise?: number;
}

export interface AggregatedMetric {
  n: number;
  median: number;
  mean: number;
  p95: number;
  min: number;
  max: number;
  /** Half of (max - min) as a percentage of the median. */
  spreadPct: number;
  values: number[];
}

export interface LibraryResult {
  library: string;
  ok: boolean;
  skipped?: string;
  runsRequested: number;
  runsSucceeded: number;
  runsFailed: number;
  errors: string[];
  metrics: Record<string, AggregatedMetric>;
  details: Record<string, number | string | boolean | null>;
}

export interface ScenarioResult {
  name: string;
  title: string;
  label?: string;
  headline?: boolean;
  group: string;
  primary: string;
  metricIds: string[];
  notes?: string[];
  params?: { width: number; height: number; points: number; visible: number; seriesCount: number; scale: number };
  results: LibraryResult[];
}

export interface CompareReport {
  schemaVersion: 2;
  generatedAt: string;
  command: string;
  publishable: boolean;
  warnings: string[];
  noiseFloor?: number;
  metrics: Record<string, MetricDefinition>;
  options: { scenarios: string[]; libraries: string[]; width: number; height: number; runs: number; setupWarmupRuns: number; headed: boolean; scale?: number };
  environment: {
    machine: { label: string; platform: string; release: string; arch: string; cpuModel: string; cpuCount: number; totalMemoryBytes: number };
    browser: { product?: string; userAgent?: string };
    executable: string;
    page: { userAgent: string; devicePixelRatio: number; webglRenderer: string | null; headlessUserAgent: boolean };
  };
  libraries: Record<string, { name: string; version: string }>;
  scenarios: ScenarioResult[];
}

export interface Comparison {
  verdict: "win" | "tie" | "loss";
  lean: "subject" | "reference" | "none";
  advantage: number | null;
  diff: number;
}

export const REPORT_SCHEMA_VERSION: 2;
export const CONTENDERS: string[];
export const PRIMARY_LIBRARY: string;
export const CANVAS_LIBRARY: string;
export function percentile(sortedValues: readonly number[], p: number): number;
export function aggregateValues(values: readonly number[]): AggregatedMetric;
export function libraryName(report: CompareReport, id: string): string;
export function findResult(scenario: ScenarioResult, id: string): LibraryResult | undefined;
export function metricOf(scenario: ScenarioResult, id: string, metricId: string): AggregatedMetric | undefined;
export function compareMetric(subject: AggregatedMetric, reference: AggregatedMetric, def: MetricDefinition, noiseFloor?: number): Comparison;
export function metricWinner(report: CompareReport, scenario: ScenarioResult, metricId: string): { winner: string | null; tied: string[] };
export function collectNonWins(report: CompareReport, subjectId?: string, referenceIds?: string[]): Array<Comparison & { scenario: ScenarioResult; metricId: string; def: MetricDefinition; referenceId: string; subject: AggregatedMetric; reference: AggregatedMetric }>;
export function countComparisons(report: CompareReport, subjectId?: string, referenceIds?: string[]): number;
export function formatNumber(value: number | null | undefined, digits?: number): string;
export function formatValue(def: MetricDefinition, value: number): string;
export function formatRatio(value: number | null | undefined): string;
export function libraryOrder(report: CompareReport): string[];
export function scoreboardLines(report: CompareReport): string[];
export function nonWinLines(report: CompareReport): string[];
export function methodologyLines(report: CompareReport, link?: string): string[];
export function renderReportMarkdown(report: CompareReport, options?: { title?: string; baseline?: CompareReport | null; methodologyLink?: string }): string;
export function renderSummaryMarkdown(report: CompareReport, options?: { title?: string }): string;
export function readmeSummaryLines(report: CompareReport): { scoreboard: string[]; summary: string };
