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

describe("DOM node growth while streaming with every plugin", () => {
  it("does not grow after warm-up across many renders, hovers, and key presses", () => {
    const chart = h.make({
      followX: { window: 200 },
      autoFitY: true,
      plugins: [
        interactionsPlugin(), legendPlugin(), tooltipPlugin({ mode: "nearest-x", group: "x" }), crosshairPlugin(),
        selectionPlugin(), annotationsPlugin({ annotations: [{ type: "x-line", x: 50, label: "marker" }] }),
        navigatorPlugin(), a11yPlugin({ table: { updateMs: 0 } }),
      ],
    });
    const series = [0, 1].map((i) => chart.addLine({ capacity: 500, name: `s${i}` }));
    let x = 0;
    const tick = (): void => {
      for (const s of series) for (let i = 0; i < 5; i++) s.append({ x: x + i, y: Math.sin((x + i) / 10) * 40 + 50 });
      x += 5;
      fire(chart.canvas, pointerEvent("pointermove", 200, 100));
      fire(chart.canvas, pointerEvent("pointerleave", 200, 100));
      for (const [key, shiftKey] of [["Enter", false], ["ArrowRight", false], ["Escape", false], ["ArrowRight", true], ["Escape", false]] as const) {
        fire(chart.rootElement, keyEvent(key, { shiftKey }));
      }
      h.raf.flush();
      h.raf.flush();
    };
    chart.start();
    for (let i = 0; i < 150; i++) tick();
    const warm = countNodes(document.body);
    for (let i = 0; i < 150; i++) tick();
    expect(countNodes(document.body) - warm).toBeLessThanOrEqual(5);
    chart.dispose();
  });
});
