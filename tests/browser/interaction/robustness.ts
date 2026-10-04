import { Chart, StaticDataset } from "@/index.ts";
import type { ChartOptions } from "@/index.ts";
import { createLinkedCharts } from "@/linked.ts";

/** Results of viewport-robustness and lifecycle probes, asserted by `scripts/interaction-test.ts`. */
export interface RobustnessResults {
  readonly zoomInThrew: string | null;
  readonly zoomInSpan: number;
  readonly logFitYMin: number;
  readonly logFitRendered: boolean;
  readonly logIncludeZeroChangedY: boolean;
  readonly invalidSetViewportError: string | null;
  readonly invalidSetViewportUnchanged: boolean;
  readonly invalidDomainLogs: number;
  readonly rendersWhileInvalid: number;
  readonly recoveredAfterInvalid: boolean;
  readonly failedChartLeftDom: number;
  readonly failedChartRestoredCanvas: boolean;
  readonly failedLinkedLeftDom: number;
}

const failingBackend: ChartOptions["backendFactory"] = () => {
  throw new Error("WebGL2 unavailable (test)");
};

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let seen = 0;
    const tick = (): void => {
      if (++seen >= count) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Run `action` and return the message it threw, or `null` when it did not throw. */
function thrownMessage(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

function mount(options: ChartOptions): { chart: Chart; host: HTMLDivElement; renders: () => number } {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:480px;height:240px;opacity:0;pointer-events:none";
  document.body.appendChild(host);
  const chart = new Chart(host, options);
  let renders = 0;
  chart.subscribe("render", () => {
    renders++;
  });
  return { chart, host, renders: () => renders };
}

function unmount({ chart, host }: { chart: Chart; host: HTMLDivElement }): void {
  chart.dispose();
  host.remove();
}

export async function runRobustnessProbes(): Promise<RobustnessResults> {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    // Zooming far into a timestamp axis stops at float precision instead of throwing.
    const time = mount({ axes: { x: { scale: "time" } } });
    const start = Date.UTC(2026, 0, 1);
    time.chart.setViewport({ xMin: start, xMax: start + 1_000, yMin: 0, yMax: 1 });
    const zoomInThrew = thrownMessage(() => {
      for (let i = 0; i < 200; i++) time.chart.zoom({ factor: 2, cx: 0.37, cy: 0.5, axis: "x" });
    });
    const zoomed = time.chart.getViewport();
    unmount(time);

    // Fitting a log axis pads in log space, so the domain stays positive and renders.
    const log = mount({ axes: { y: { scale: "log" } } });
    log.chart.addLine({
      dataset: new StaticDataset(
        Float64Array.from({ length: 100 }, (_, i) => i),
        Float32Array.from({ length: 100 }, (_, i) => 1 + i * 10),
      ),
    });
    log.chart.fitToData({ padding: 0.1 });
    log.chart.start();
    await frames(2);
    const logFitYMin = log.chart.getViewport().yMin;
    const logFitRendered = log.renders() > 0;
    const logIncludeZeroChangedY = log.chart.fitToData({ x: false, includeZero: true });

    // setViewport rejects an invalid scale domain synchronously and atomically.
    const beforeInvalid = log.chart.getViewport();
    const invalidSetViewportError = thrownMessage(() => log.chart.setViewport({ xMin: 5, xMax: 6, yMin: -1, yMax: 10 }));
    const afterInvalid = log.chart.getViewport();
    const invalidSetViewportUnchanged = JSON.stringify(afterInvalid) === JSON.stringify(beforeInvalid);
    unmount(log);

    // A camera moved into an invalid domain skips frames, logs once, and recovers without stopping the loop.
    const loop = mount({ axes: { y: { scale: "log" } }, renderLoop: "continuous" });
    loop.chart.setViewport({ xMin: 0, xMax: 10, yMin: 1, yMax: 100 });
    loop.chart.addLine({ dataset: new StaticDataset(Float64Array.of(0, 10), Float32Array.of(2, 50)) });
    loop.chart.start();
    await frames(3);
    const errorsBefore = errors.length;
    const rendersBefore = loop.renders();
    loop.chart.getCamera().setViewport({ yMin: -5, yMax: 10 });
    await frames(8);
    const invalidDomainLogs = errors.length - errorsBefore;
    const rendersWhileInvalid = loop.renders() - rendersBefore;
    loop.chart.getCamera().setViewport({ yMin: 1, yMax: 100 });
    await frames(3);
    const recoveredAfterInvalid = loop.renders() - rendersBefore > rendersWhileInvalid;
    unmount(loop);

    // Construction failures leave no DOM behind and give back a caller-supplied canvas.
    const failedHost = document.createElement("div");
    document.body.appendChild(failedHost);
    thrownMessage(() => new Chart(failedHost, { backendFactory: failingBackend }));
    const failedChartLeftDom = failedHost.childElementCount;
    const canvasHost = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvasHost.appendChild(canvas);
    document.body.appendChild(canvasHost);
    thrownMessage(() => new Chart(canvas, { backendFactory: failingBackend }));
    const failedChartRestoredCanvas = canvas.parentElement === canvasHost && canvasHost.childElementCount === 1;
    failedHost.remove();
    canvasHost.remove();

    const linkedHost = document.createElement("div");
    document.body.appendChild(linkedHost);
    thrownMessage(() => createLinkedCharts(linkedHost, { panels: [{}, { options: { backendFactory: failingBackend } }] }));
    const failedLinkedLeftDom = linkedHost.childElementCount;
    linkedHost.remove();

    return {
      zoomInThrew,
      zoomInSpan: zoomed.xMax - zoomed.xMin,
      logFitYMin,
      logFitRendered,
      logIncludeZeroChangedY,
      invalidSetViewportError,
      invalidSetViewportUnchanged,
      invalidDomainLogs,
      rendersWhileInvalid,
      recoveredAfterInvalid,
      failedChartLeftDom,
      failedChartRestoredCanvas,
      failedLinkedLeftDom,
    };
  } finally {
    console.error = originalError;
  }
}
