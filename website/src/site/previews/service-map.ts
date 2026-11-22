import { Chart } from "../../../../src/index.ts";
import { createGraphIcon, graphPlugin } from "../../../../src/plugins/graph.ts";
import { siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

const TIERS = [
  ["edge-eu", "edge-us", "edge-ap"],
  ["gateway", "auth", "search"],
  ["orders", "billing", "catalog", "users"],
  ["postgres", "redis", "kafka", "s3"],
] as const;

/** Source, target, and whether traffic on the link is shown moving. */
const LINKS: ReadonlyArray<readonly [string, string, boolean]> = [
  ["edge-eu", "gateway", true],
  ["edge-us", "gateway", true],
  ["edge-ap", "gateway", true],
  ["gateway", "auth", false],
  ["gateway", "search", true],
  ["gateway", "orders", true],
  ["auth", "users", false],
  ["search", "catalog", true],
  ["orders", "billing", true],
  ["orders", "catalog", false],
  ["billing", "postgres", true],
  ["orders", "kafka", true],
  ["users", "postgres", false],
  ["catalog", "redis", true],
  ["catalog", "s3", false],
  ["kafka", "billing", false],
];

/** A small service map: rounded cards with icons, arrows, moving flows on busy links, draggable cards. */
export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const server = createGraphIcon(["M4 4h16v6H4z", "M4 14h16v6H4z", "M7 7h.01", "M7 17h.01"]);
    const nodes = TIERS.flatMap((tier, row) => tier.map((id, col) => ({ id, label: id, x: (col - (tier.length - 1) / 2) * 210, y: row * 130 })));
    const edges = LINKS.map(([source, target, busy]) => ({ source, target, data: { busy } }));
    const graph = graphPlugin<unknown, { busy: boolean }>({
      nodes,
      edges,
      draggable: true,
      background: { kind: "dots", gap: 24, color: "rgba(238, 226, 214, 0.08)" },
      fitOnLoad: { padding: 32 },
      nodeStyle: (_node, state) => ({
        shape: "rect",
        width: 150,
        height: 52,
        cornerRadius: 10,
        fill: "var(--color-surface)",
        borderColor: state.hovered || state.dragging ? "var(--color-flame-hi)" : "var(--color-line-strong)",
        borderWidth: 1.5,
        ring: state.focused ? { color: "var(--color-flame)", width: 2 } : undefined,
      }),
      edgeStyle: (edge) => ({
        arrow: "end",
        width: 1.5,
        color: edge.data?.busy ? "var(--color-flame)" : "var(--color-fg-3)",
        flow: edge.data?.busy ? { speed: 40, shape: "dot" } : undefined,
      }),
      drawNode: (ctx, node, frame) => {
        server(ctx, 12, 14, 24, "#b5afa8");
        if (frame.zoom < 0.45) return;
        ctx.font = "600 14px 'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif";
        ctx.fillStyle = "#eeece9";
        ctx.textBaseline = "middle";
        ctx.fillText(node.label ?? node.id, 46, frame.height / 2);
      },
    });
    const chart = new Chart(target, siteChartOptions({ axes: false, grid: false, plugins: [graph], accessibility: { label: "Service map preview" } }));
    this.previewCharts.push(chart);
  }
}
