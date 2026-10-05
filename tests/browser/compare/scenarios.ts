import type { ChartSpec, ViewportRange } from "./common.ts";

export type ScenarioKind = "static" | "cold" | "pan" | "stream" | "hover" | "resize" | "many" | "cycle" | "soak" | "throughput";

export interface ScenarioImpl {
  readonly kind: ScenarioKind;
  readonly spec: Omit<ChartSpec, "width" | "height">;
  readonly measureMs: number;
  readonly warmupMs: number;
  /** Stream: samples appended per 1/60 s batch. */
  readonly streamBatchSize?: number;
  /** Many-charts: number of charts. Cycle: number of mount/destroy cycles. */
  readonly count?: number;
  /** Many-charts: size of each small chart. */
  readonly cell?: { readonly width: number; readonly height: number };
}

const Y = { yMin: -1.25, yMax: 1.25 } as const;
const PAN = { measureMs: 3_000, warmupMs: 500 } as const;
const NONE = { measureMs: 0, warmupMs: 0 } as const;

export const SCENARIOS: Record<string, ScenarioImpl> = {
  "line-100k-static": { kind: "static", ...NONE, spec: { kind: "line", seriesCount: 1, points: 100_000, visible: 100_000, ...Y } },
  "line-1m-static": { kind: "static", ...NONE, spec: { kind: "line", seriesCount: 1, points: 1_000_000, visible: 1_000_000, ...Y } },
  "cold-first-chart": { kind: "cold", ...NONE, spec: { kind: "line", seriesCount: 1, points: 100_000, visible: 100_000, ...Y } },
  "line-1m-pan": { kind: "pan", ...PAN, spec: { kind: "line", seriesCount: 1, points: 1_000_000, visible: 100_000, ...Y } },
  "line-1m-stream": { kind: "stream", ...PAN, streamBatchSize: 1_024, spec: { kind: "line", seriesCount: 1, points: 1_000_000, visible: 100_000, stream: true, ...Y } },
  "line-10m-accelerated-pan": { kind: "pan", ...PAN, spec: { kind: "line", seriesCount: 1, points: 10_000_000, visible: 5_000_000, accelerated: true, ...Y } },
  "multi-10x100k-pan": { kind: "pan", ...PAN, spec: { kind: "line", seriesCount: 10, points: 100_000, visible: 50_000, ...Y } },
  "multi-100x20k-pan": { kind: "pan", ...PAN, spec: { kind: "line", seriesCount: 100, points: 20_000, visible: 10_000, ...Y } },
  "area-1m-pan": { kind: "pan", ...PAN, spec: { kind: "area", seriesCount: 1, points: 1_000_000, visible: 100_000, ...Y } },
  "scatter-1m-pan": { kind: "pan", ...PAN, spec: { kind: "scatter", seriesCount: 1, points: 1_000_000, visible: 100_000, ...Y } },
  "bar-100k-pan": { kind: "pan", ...PAN, spec: { kind: "bar", seriesCount: 1, points: 100_000, visible: 10_000, ...Y } },
  "dual-axis-1m-pan": { kind: "pan", ...PAN, spec: { kind: "line", seriesCount: 2, points: 500_000, visible: 100_000, dualAxis: true, ...Y } },
  "hover-1m": { kind: "hover", measureMs: 0, warmupMs: 0, spec: { kind: "line", seriesCount: 1, points: 1_000_000, visible: 1_000_000, hover: true, ...Y } },
  "hover-1m-rich": { kind: "hover", measureMs: 0, warmupMs: 0, spec: { kind: "line", seriesCount: 1, points: 1_000_000, visible: 1_000_000, hover: true, hoverRich: true, ...Y } },
  "resize-1m": { kind: "resize", measureMs: 0, warmupMs: 0, spec: { kind: "line", seriesCount: 1, points: 1_000_000, visible: 1_000_000, responsive: true, ...Y } },
  "many-charts-50": { kind: "many", ...NONE, count: 50, cell: { width: 400, height: 180 }, spec: { kind: "line", seriesCount: 1, points: 10_000, visible: 10_000, sharedContext: true, ...Y } },
  "mount-destroy-cycle": { kind: "cycle", ...NONE, count: 40, spec: { kind: "line", seriesCount: 1, points: 100_000, visible: 100_000, ...Y } },
  "heap-soak-1m-pan": { kind: "soak", measureMs: 8_000, warmupMs: 500, spec: { kind: "line", seriesCount: 1, points: 1_000_000, visible: 100_000, ...Y } },
  "stream-throughput": { kind: "throughput", measureMs: 1_200, warmupMs: 500, spec: { kind: "line", seriesCount: 1, points: 100_000, visible: 100_000, stream: true, windowed: true, ...Y } },
};

/** Sustained append rates (samples per second) tried in order by `stream-throughput`. */
export const THROUGHPUT_RATES = [50_000, 100_000, 200_000, 400_000, 800_000, 1_600_000, 3_200_000, 6_400_000, 12_800_000, 25_600_000, 51_200_000, 102_400_000] as const;

export function y2Range(spec: Pick<ChartSpec, "dualAxis">): { y2Min?: number; y2Max?: number } {
  return spec.dualAxis ? { y2Min: -125, y2Max: 125 } : {};
}

export function staticViewport(spec: Pick<ChartSpec, "visible" | "yMin" | "yMax" | "dualAxis">): ViewportRange {
  return { xMin: 0, xMax: Math.max(1, spec.visible - 1), yMin: spec.yMin, yMax: spec.yMax, ...y2Range(spec) };
}

export function latestViewport(spec: Pick<ChartSpec, "visible" | "yMin" | "yMax" | "dualAxis">, nextX: number): ViewportRange {
  const xMax = Math.max(1, nextX - 1);
  const xMin = Math.max(0, xMax - spec.visible + 1);
  return { xMin, xMax, yMin: spec.yMin, yMax: spec.yMax, ...y2Range(spec) };
}

export function panViewport(spec: Pick<ChartSpec, "visible" | "points" | "yMin" | "yMax" | "dualAxis">, elapsedMs: number, durationMs: number): ViewportRange {
  const span = Math.max(1, Math.min(spec.visible, spec.points));
  const maxStart = Math.max(0, spec.points - span);
  const t = elapsedMs / Math.max(1, durationMs);
  const xMin = maxStart * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
  return { xMin, xMax: xMin + span - 1, yMin: spec.yMin, yMax: spec.yMax, ...y2Range(spec) };
}
