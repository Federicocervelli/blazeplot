/** Shared types and measurement helpers for the comparison benchmark page. */

export type LibraryId = "blazeplot" | "blazeplot-canvas2d" | "uplot" | "chartjs";
export type SeriesKind = "line" | "area" | "scatter" | "bar";

export interface ViewportRange {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** Right-axis Y range, only used by dual-axis scenarios. */
  readonly y2Min?: number;
  readonly y2Max?: number;
}

/** Library-independent description of the chart every adapter must build. */
export interface ChartSpec {
  readonly width: number;
  readonly height: number;
  readonly kind: SeriesKind;
  readonly seriesCount: number;
  /** Samples per series (initial samples for streaming charts). */
  readonly points: number;
  /** Visible samples of the initial viewport. */
  readonly visible: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly dualAxis?: boolean;
  /** Extra samples that will be appended while streaming. */
  readonly streamExtra?: number;
  readonly hover?: boolean;
  /** Chart follows its container size (resize scenario). */
  readonly responsive?: boolean;
  /** BlazePlot only: use its accelerated procedural dataset (10M scenario). */
  readonly accelerated?: boolean;
  /** BlazePlot WebGL only: use the shared WebGL context (many-charts scenario). */
  readonly sharedContext?: boolean;
  /** Series use evenly spaced X (stream scenarios). */
  readonly stream?: boolean;
  /** Streaming keeps only the latest `points` samples: BlazePlot wraps its ring buffer, other libraries drop the oldest samples. */
  readonly windowed?: boolean;
}

export interface ChartHandle {
  /** Move the viewport (and right-axis range when `y2Min`/`y2Max` are set). */
  setViewport(viewport: ViewportRange): void;
  /** Append samples to the first series and follow `viewport`. */
  append(startX: number, count: number, viewport: ViewportRange): void;
  /** Number of completed draws, advanced synchronously by each library's own draw hook. */
  drawCount(): number;
  /** Whether the chart has put real content on screen (BlazePlot renders on its next frame; others draw in the constructor). */
  hasContent(): boolean;
  /** Width of the plotting area in CSS pixels as the library currently reports it. */
  plotWidth(): number;
  plotHeight(): number;
  /** Whether the library currently shows hover feedback (hover scenario sanity check). */
  hoverActive?(): boolean;
  /** Library-internal frame statistics, when the library exposes them. */
  internalStats?(): { frameMs?: number; pointsRendered?: number; drawCalls?: number };
  destroy(): void;
}

export interface NumericSummary {
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly p50: number;
  readonly p95: number;
}

declare global {
  interface Window {
    gc?: () => void;
    __blazeplotCompare: unknown;
  }
  interface Navigator {
    readonly deviceMemory?: number;
  }
  interface Performance {
    readonly memory?: { readonly usedJSHeapSize: number };
  }
}

const nativeRaf = window.requestAnimationFrame.bind(window);
let rafCallbackWorkMs = 0;

/**
 * Wrap `requestAnimationFrame` before any library is constructed so the time every library spends
 * inside its own animation-frame callbacks (BlazePlot renders there) is attributed to main-thread
 * frame cost. The harness itself schedules frames through `nativeRaf`, which is not wrapped.
 */
export function installRafWorkAccounting(): void {
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    nativeRaf((timestamp) => {
      const startedAt = performance.now();
      try {
        callback(timestamp);
      } finally {
        rafCallbackWorkMs += performance.now() - startedAt;
      }
    });
}

/** Return and reset the animation-frame callback time accumulated by libraries. */
export function takeRafCallbackWorkMs(): number {
  const value = rafCallbackWorkMs;
  rafCallbackWorkMs = 0;
  return value;
}

export function animationFrame(): Promise<number> {
  return new Promise((resolve) => nativeRaf(resolve));
}

export async function settleFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await animationFrame();
}

/**
 * Resolves with the time at which the frame after this call has been produced: one animation frame
 * (where every library does its deferred drawing) followed by a task, which runs after that frame's
 * style, layout and paint work has been committed.
 */
export function nextFrameDone(): Promise<number> {
  return new Promise((resolve) => {
    nativeRaf(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve(performance.now());
      };
      channel.port2.postMessage(null);
    });
  });
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function readHeapBytes(): number | null {
  return performance.memory?.usedJSHeapSize ?? null;
}

/** Force garbage collection (needs `--js-flags=--expose-gc`) and return the settled JS heap size. */
export async function settledHeapBytes(): Promise<number | null> {
  for (let i = 0; i < 3; i++) {
    window.gc?.();
    await waitMs(20);
    await animationFrame();
  }
  return readHeapBytes();
}

export function mib(bytes: number | null): number | null {
  return bytes === null ? null : bytes / (1024 * 1024);
}

export function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index] ?? 0;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function summarize(values: readonly number[]): NumericSummary {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: round(sorted[0] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    avg: round(sum(sorted) / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
  };
}
