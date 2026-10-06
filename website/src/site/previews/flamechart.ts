import { Chart } from "../../../../src/index.ts";
import { flameGraphPlugin } from "../../../../src/plugins/flamegraph.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const stacks = this.flameChartStacks();
    const maxDepth = stacks.reduce((max, entry) => Math.max(max, entry.stack.length - 1), 0);
    const flame = flameGraphPlugin({
      foldedStacks: stacks,
      build: { flameChart: true, countName: "ms" },
      search: null,
      minFrameWidthPx: 1,
      labelMinWidthPx: 18,
      onFrameClick: ({ frame }) => {
        chart.setViewport({ xMin: frame.start, xMax: frame.end, yMin: Math.max(0, frame.depth - 0.5), yMax: Math.min(maxDepth + 1, frame.depth + 3.5) });
      },
      tooltipFormatter: (pick) => `${pick.frame.name}\n${pick.frame.value.toFixed(1)} ms (${(pick.percent * 100).toFixed(2)}%)`,
    });
    const chart = new Chart(target, siteChartOptions({
      axes: { x: { position: "outside", title: "profile time (ms)" }, y: { position: "outside", title: "stack depth" } },
      grid: false,
      plugins: [interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true }), flame],
      accessibility: { label: "Flame chart preview" },
    }));
    this.previewCharts.push(chart);
    flame.fitToData();
    chart.start();
  }

  private flameChartStackCount(): number {
    return 75_000;
  }

  private flameChartStacks(): Array<{ stack: readonly string[]; value: number }> {
    const roots = ["render", "render-worker", "render-scheduler", "render-flush", "render-io"] as const;
    const stages = ["render", "render:diff", "render:layout", "render:paint", "render:compose", "render:serialize", "render:cache", "render:commit"] as const;
    const leaves = ["lookup", "hydrate", "diff", "layout", "paint", "encode", "await", "notify", "measure", "raster", "commit", "flush"] as const;
    const stackCount = this.flameChartStackCount();
    return Array.from({ length: stackCount }, (_, i) => {
      const stage = stages[(i * 5 + Math.floor(i / 97)) % stages.length]!;
      const root = roots[(i + Math.floor(i / 4096)) % roots.length]!;
      const leaf = leaves[(i * 7 + Math.floor(i / 43)) % leaves.length]!;
      const nested = i % 3 === 0
        ? ["hot-path", leaves[(i * 3) % leaves.length]!, `batch-${i % 128}`]
        : i % 5 === 0
          ? ["fallback", `retry-${i % 64}`]
          : [`lane-${i % 256}`];
      return {
        stack: [root, stage, ...nested, leaf],
        value: 0.4 + Math.abs(Math.sin(i * 0.23)) * 4 + (i % 211 === 0 ? 16 : 0) + (i % 997 === 0 ? 28 : 0),
      };
    });
  }

}
