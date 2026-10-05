import { chartInternals } from "../../src/ui/ChartInternals.ts";
import { describe, expect, it } from "bun:test";
import { stubPlot, useChartHarness } from "./harness.ts";

const h = useChartHarness();

/** Count layout reads (`clientWidth`, `clientHeight`, `getBoundingClientRect`) on every canvas while `run` executes. */
function countCanvasLayoutReads(run: () => void): number {
  const proto = window.HTMLCanvasElement.prototype;
  const widthGetter = Object.getOwnPropertyDescriptor(proto, "clientWidth")!.get!;
  const heightGetter = Object.getOwnPropertyDescriptor(proto, "clientHeight")!.get!;
  const rectRead = proto.getBoundingClientRect;
  let reads = 0;
  Object.defineProperty(proto, "clientWidth", { configurable: true, get() { reads++; return widthGetter.call(this); } });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get() { reads++; return heightGetter.call(this); } });
  proto.getBoundingClientRect = function (this: HTMLCanvasElement) { reads++; return rectRead.call(this); };
  try {
    run();
  } finally {
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: widthGetter });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: heightGetter });
    proto.getBoundingClientRect = rectRead;
  }
  return reads;
}

describe("chart constructor", () => {
  it("reads no layout, so mounting many charts in one task does not lay the page out per chart", () => {
    const charts: Array<ReturnType<typeof h.make>> = [];
    const reads = countCanvasLayoutReads(() => {
      for (let i = 0; i < 10; i++) {
        const chart = h.make({ axes: { x: true, y: true } });
        chart.addLine({ capacity: 4 }).append({ x: 1, y: 2 });
        chart.start();
        charts.push(chart);
      }
    });
    expect(reads).toBe(0);
    for (const chart of charts) chart.dispose();
  });

  it("sizes the drawing buffer from layout on the first frame", () => {
    const chart = h.make({ axes: { x: true, y: true } });
    const canvas = chartInternals(chart).canvas;
    stubPlot(chart, { width: 320, height: 180 });
    expect(canvas.width).not.toBe(320);
    chart.start();
    h.raf.flush();
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
    chart.dispose();
  });

  it("does not let the first frame override an explicit resize", () => {
    const chart = h.make({ axes: { x: true, y: true } });
    const canvas = chartInternals(chart).canvas;
    stubPlot(chart, { width: 320, height: 180 });
    expect(chart.resize(1)).toBe(true);
    expect(canvas.width).toBe(320);
    chart.start();
    h.raf.flush();
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
    chart.dispose();
  });
});
