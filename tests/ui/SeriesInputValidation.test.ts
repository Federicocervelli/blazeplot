import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { FakeBackend, setupDom } from "./fakes.ts";
import type { TestEnv } from "./fakes.ts";
import type { Chart as ChartType } from "../../src/ui/Chart.ts";
import type { InvalidSample } from "../../src/core/types.ts";

let env: TestEnv;
let Chart: typeof ChartType;
let target: HTMLDivElement;

beforeAll(async () => {
  env = setupDom();
  ({ Chart } = await import("../../src/ui/Chart.ts"));
});
afterAll(() => env.teardown());

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
});
afterEach(() => target.remove());

describe("chart-owned series input validation", () => {
  it("passes SeriesConfig.onInvalidSample to the RingBuffer it creates", () => {
    const chart = new Chart(target, { backendFactory: (ctx) => new FakeBackend(ctx.canvas) });
    const reported: InvalidSample[] = [];
    const series = chart.addLine({ capacity: 8, onInvalidSample: (sample) => reported.push(sample) });
    series.append({ x: [1, 2, NaN, 0, 3], y: [1, 2, 3, 4, 5] });
    expect(series.length).toBe(3);
    expect(reported.map((s) => [s.reason, s.index])).toEqual([["non-finite-x", 2], ["decreasing-x", 3]]);
    chart.dispose();
  });
});
