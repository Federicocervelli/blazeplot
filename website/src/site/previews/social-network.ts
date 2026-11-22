import { Chart } from "../../../../src/index.ts";
import type { RgbaColor } from "../../../../src/index.ts";
import { graphPlugin } from "../../../../src/plugins/graph.ts";
import { SITE_SERIES, siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

const PEOPLE = 20_000;
const MEAN_FRIENDS = 10;

interface SocialNetwork {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly weight: Float64Array;
  readonly community: Uint32Array;
  readonly communities: number;
  readonly source: Uint32Array;
  readonly target: Uint32Array;
}

/**
 * A synthetic social network laid out the way a force layout leaves a real one. People are grouped in communities of
 * power-law sizes, placed apart; each person has a power-law number of friends (a few hubs have hundreds), mostly
 * people near them in their community, some in a nearby community, and a few far away. Seeded, so every visit draws
 * the same network.
 */
function socialNetwork(count: number): SocialNetwork {
  let seed = 11;
  const rand = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const gauss = (): number => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  // Expected friends: a power law with exponent 2.5, from 2 up.
  const weight = new Float64Array(count);
  for (let i = 0; i < count; i++) weight[i] = Math.min(400, 2 * (1 - rand()) ** (-1 / 1.5));

  // Communities: power-law sizes, centers on a spiral spaced so their areas do not overlap.
  const community = new Uint32Array(count);
  const sizes: number[] = [];
  for (let i = 0; i < count; ) {
    const size = Math.min(count - i, Math.round(Math.min(2500, 30 * (1 - rand()) ** (-1 / 1.1))));
    for (let k = 0; k < size; k++) community[i++] = sizes.length;
    sizes.push(size);
  }
  const spread = sizes.map((size) => 3.2 * Math.sqrt(size));
  const cx = new Float64Array(sizes.length);
  const cy = new Float64Array(sizes.length);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let area = 0;
  for (let k = 0; k < sizes.length; k++) {
    area += Math.PI * (spread[k]! * 1.6) ** 2;
    const r = Math.sqrt(area / Math.PI);
    cx[k] = Math.cos(k * golden) * r;
    cy[k] = Math.sin(k * golden) * r;
  }
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const c = community[i]!;
    x[i] = cx[c]! + gauss() * spread[c]! * 0.5;
    y[i] = cy[c]! + gauss() * spread[c]! * 0.5;
  }

  // A grid of people, for "the person nearest to this point".
  const cellSize = 12;
  const grid = new Map<number, number[]>();
  const key = (gx: number, gy: number): number => (gx + 32768) * 65536 + (gy + 32768);
  for (let i = 0; i < count; i++) {
    const k = key(Math.floor(x[i]! / cellSize), Math.floor(y[i]! / cellSize));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  const nearest = (px: number, py: number, not: number): number => {
    const gx = Math.floor(px / cellSize);
    const gy = Math.floor(py / cellSize);
    let best = -1;
    let bestDistance = Infinity;
    for (let ring = 0; ring < 6 && best < 0; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          for (const j of grid.get(key(gx + dx, gy + dy)) ?? []) {
            if (j === not) continue;
            const distance = (x[j]! - px) ** 2 + (y[j]! - py) ** 2;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = j;
            }
          }
        }
      }
    }
    return best;
  };

  // Pick people by weight, so hubs make more friends.
  const cumulative = new Float64Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) cumulative[i] = total += weight[i]!;
  const pick = (): number => {
    const r = rand() * total;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const wanted = Math.round((count * MEAN_FRIENDS) / 2);
  const source = new Uint32Array(wanted);
  const target = new Uint32Array(wanted);
  const seen = new Set<number>();
  let m = 0;
  for (let tries = 0; m < wanted && tries < wanted * 4; tries++) {
    const u = pick();
    const c = community[u]!;
    const roll = rand();
    let px: number;
    let py: number;
    if (roll < 0.85) {
      // A hub reaches across its whole community; everyone else mostly near themselves.
      const reach = spread[c]! * Math.min(1, 0.15 + Math.sqrt(weight[u]!) / 20);
      px = x[u]! + gauss() * reach;
      py = y[u]! + gauss() * reach;
    } else {
      const other = roll < 0.98 ? Math.min(sizes.length - 1, Math.max(0, c + Math.round(gauss() * 5))) : Math.floor(rand() * sizes.length);
      px = cx[other]! + gauss() * spread[other]! * 0.5;
      py = cy[other]! + gauss() * spread[other]! * 0.5;
    }
    const v = nearest(px, py, u);
    if (v < 0) continue;
    const pair = Math.min(u, v) * count + Math.max(u, v);
    if (seen.has(pair)) continue;
    seen.add(pair);
    source[m] = u;
    target[m] = v;
    m++;
  }
  return { x, y, weight, community, communities: sizes.length, source: source.subarray(0, m), target: target.subarray(0, m) };
}

/** A 20 000-person social network: hubs, communities, and bridges between them, drawn by level of detail. */
export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const network = socialNetwork(PEOPLE);
    const palette: readonly RgbaColor[] = Object.values(SITE_SERIES);
    const nodes = Array.from({ length: PEOPLE }, (_, i) => ({ id: String(i), x: network.x[i]!, y: network.y[i]! }));
    // One style object per community, so styles are shared, not made per node.
    const nodeStyles = Array.from({ length: network.communities }, (_, c) => ({ shape: "circle" as const, fill: palette[c % palette.length]! }));
    const graph = graphPlugin({
      nodes,
      edges: { source: network.source, target: network.target },
      draggable: true,
      maxZoom: 64,
      drawNode: null,
      nodeStyle: (node) => {
        const i = Number(node.id);
        return { ...nodeStyles[network.community[i]!]!, width: 2 + Math.sqrt(network.weight[i]!) * 0.8 };
      },
      edgeStyle: { color: "rgba(232, 202, 168, 0.12)", width: 1 },
      messages: {
        describeNode: (node) => `Person ${node.id}, community ${network.community[Number(node.id)]! + 1}`,
      },
    });
    const chart = new Chart(target, siteChartOptions({ axes: false, grid: false, plugins: [graph], accessibility: { label: `Social network preview: ${PEOPLE.toLocaleString("en-US")} people, ${network.source.length.toLocaleString("en-US")} friendships` } }));
    this.previewCharts.push(chart);
  }
}
