import { Chart, StaticDataset } from "@/index.ts";
import type { ChartOptions } from "@/index.ts";
import { createLinkedCharts } from "@/linked.ts";

/** Results of viewport-robustness and lifecycle probes, asserted by `scripts/interaction-test.ts`. */
export type RobustnessResults = Awaited<ReturnType<typeof runRobustnessProbes>>;

const failingBackend: ChartOptions["backendFactory"] = () => {
  throw new Error("WebGL2 unavailable (test)");
};

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => (--count <= 0 ? resolve() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
}

function thrownMessage(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

/** Mount a hidden chart, run `probe` against it, and dispose it. */
async function withChart<T>(options: ChartOptions, probe: (chart: Chart, renders: () => number) => Promise<T> | T): Promise<T> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:480px;height:240px;opacity:0;pointer-events:none";
  document.body.appendChild(host);
  const chart = new Chart(host, options);
  let renders = 0;
  chart.subscribe("render", () => renders++);
  try {
    return await probe(chart, () => renders);
  } finally {
    chart.dispose();
    host.remove();
  }
}

/** Count the elements a failed construction leaves inside a fresh host. */
function leftoverAfterFailure(build: (host: HTMLElement) => unknown): number {
  const host = document.createElement("div");
  document.body.appendChild(host);
  thrownMessage(() => build(host));
  const leftover = host.childElementCount;
  host.remove();
  return leftover;
}

export async function runRobustnessProbes() {
  const start = Date.UTC(2026, 0, 1);
  const zoom = await withChart({ axes: { x: { scale: "time" } } }, (chart) => {
    chart.setViewport({ xMin: start, xMax: start + 1_000, yMin: 0, yMax: 1 });
    const threw = thrownMessage(() => {
      for (let i = 0; i < 200; i++) chart.zoom({ factor: 2, cx: 0.37, cy: 0.5, axis: "x" });
    });
    const { xMin, xMax } = chart.getViewport();
    return { threw, span: xMax - xMin };
  });

  const log = await withChart({ axes: { y: { scale: "log" } } }, async (chart, renders) => {
    const x = Float64Array.from({ length: 100 }, (_, i) => i);
    chart.addLine({ dataset: new StaticDataset(x, Float32Array.from(x, (i) => 1 + i * 10)) });
    chart.fitToData({ padding: 0.1 });
    chart.start();
    await frames(2);
    const fitYMin = chart.getViewport().yMin;
    const before = JSON.stringify(chart.getViewport());
    const setViewportError = thrownMessage(() => chart.setViewport({ xMin: 5, xMax: 6, yMin: -1, yMax: 10 }));
    return { fitYMin, rendered: renders() > 0, setViewportError, unchanged: JSON.stringify(chart.getViewport()) === before };
  });

  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  const loop = await withChart({ axes: { y: { scale: "log" } }, renderLoop: "continuous" }, async (chart, renders) => {
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 1, yMax: 100 });
    chart.start();
    await frames(3);
    const before = renders();
    chart.getCamera().setViewport({ yMin: -5, yMax: 10 });
    await frames(8);
    const whileInvalid = renders() - before;
    chart.getCamera().setViewport({ yMin: 1, yMax: 100 });
    await frames(3);
    return { logs: errors.length, whileInvalid, recovered: renders() - before > whileInvalid };
  }).finally(() => {
    console.error = originalError;
  });

  const canvasHost = document.createElement("div");
  const canvas = canvasHost.appendChild(document.createElement("canvas"));
  thrownMessage(() => new Chart(canvas, { backendFactory: failingBackend }));
  const canvasRestored = canvas.parentElement === canvasHost && canvasHost.childElementCount === 1;

  return {
    zoom,
    log,
    loop,
    failedChartLeftDom: leftoverAfterFailure((host) => new Chart(host, { backendFactory: failingBackend })),
    failedLinkedLeftDom: leftoverAfterFailure((host) => createLinkedCharts(host, { panels: [{}, { options: { backendFactory: failingBackend } }] })),
    canvasRestored,
  };
}
