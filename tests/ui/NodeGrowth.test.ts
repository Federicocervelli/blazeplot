import { describe, expect, it } from "bun:test";
import { a11yPlugin } from "../../src/plugins/a11y.ts";
import { annotationsPlugin } from "../../src/plugins/annotations.ts";
import { crosshairPlugin } from "../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import { legendPlugin } from "../../src/plugins/legend.ts";
import { navigatorPlugin } from "../../src/plugins/navigator.ts";
import { selectionPlugin } from "../../src/plugins/selection.ts";
import { tooltipPlugin } from "../../src/plugins/tooltip.ts";
import { countNodes } from "./fakes.ts";
import { fire, keyEvent, pointerEvent, useChartHarness } from "./harness.ts";

const h = useChartHarness();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("DOM node growth while streaming with every plugin", () => {
  it("does not grow after warm-up across many renders, hovers, and key presses", async () => {
    // Mirrors tests/browser/stability streaming: live follow, autoFitY, every plugin, periodic hover and keys.
    const chart = h.make({
      axes: { x: true, y: true },
      followX: { window: 20_000 },
      autoFitY: true,
      plugins: [
        interactionsPlugin(), legendPlugin(), tooltipPlugin({ mode: "nearest-x", group: "x" }), crosshairPlugin(),
        selectionPlugin(), annotationsPlugin({ annotations: [{ type: "x-line", x: 50, label: "marker" }] }),
        navigatorPlugin(), a11yPlugin({ live: { intervalMs: 1_000 }, table: { updateMs: 5 } }),
      ],
    });
    const series = [0, 1, 2, 3].map((i) => chart.addLine({ capacity: 50_000, name: `stream-${i}` }));
    let x = 0;
    const append = (batch: number): void => {
      for (const [s, line] of series.entries()) {
        const xs = new Float64Array(batch);
        const ys = new Float32Array(batch);
        for (let i = 0; i < batch; i++) {
          xs[i] = x + i;
          ys[i] = Math.sin((x + i) / (30 + s * 7)) * 40 + 50;
        }
        line.append({ x: xs, y: ys });
      }
      x += batch;
    };
    for (let offset = 0; offset < 50_000; offset += 10_000) append(10_000);
    chart.start();
    h.raf.flush();
    let ticks = 0;
    const hover = (): void => {
      fire(chart.canvas, pointerEvent("pointermove", 200, 100));
      fire(chart.canvas, pointerEvent("pointerdown", 200, 100, { button: 0, buttons: 1 }));
      fire(chart.canvas, pointerEvent("pointerup", 200, 100, { button: 0, buttons: 0 }));
      fire(chart.canvas, pointerEvent("pointerleave", 200, 100));
      for (const [key, shiftKey] of [["Enter", false], ["ArrowRight", false], ["Escape", false], ["ArrowRight", true], ["Escape", false]] as const) {
        fire(chart.rootElement, keyEvent(key, { shiftKey }));
      }
    };
    const run = async (count: number): Promise<void> => {
      for (let i = 0; i < count; i++) {
        append(14);
        if (++ticks % 8 === 0) hover();
        h.raf.flush();
        if (ticks % 4 === 0) await sleep(6);
      }
    };
    await run(600);
    const warm = countNodes(document.body);
    const table = document.querySelector("table");
    await run(600);
    // A live data table is updated in place, so streaming leaves no replaced table behind.
    expect(document.querySelector("table")).toBe(table);
    const grown = countNodes(document.body) - warm;
    expect(grown).toBeLessThanOrEqual(40);
    chart.dispose();
  }, 60_000);
});
