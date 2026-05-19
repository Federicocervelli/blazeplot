import { Chart, ServerSampledDataset } from "@/index";
import { interactionsPlugin } from "@/plugins/interactions";
import { tooltipPlugin } from "@/plugins/tooltip";
import { legendPlugin } from "@/plugins/legend";

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

const chartEl = document.querySelector<HTMLDivElement>("#chart")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const symbolSelect = document.querySelector<HTMLSelectElement>("#symbolSelect")!;
const intervalSelect = document.querySelector<HTMLSelectElement>("#intervalSelect")!;
const reloadButton = document.querySelector<HTMLButtonElement>("#reloadButton")!;

const dataset = new ServerSampledDataset();
const chart = new Chart(chartEl, {
  title: "Binance public klines rendered as server-sampled min/max buckets",
  subtitle: "The browser receives already sampled OHLC buckets and uses downsample: \"server\" to render them directly.",
  axes: {
    x: { position: "outside", scale: "time", timezone: "utc", title: "UTC time" },
    y: { position: "outside", title: "price" },
  },
  hover: { mode: "nearest-x", group: "x", maxDistancePx: 48 },
  plugins: [
    interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true }),
    tooltipPlugin({ formatter: (item) => `${new Date(item.x).toISOString()}\nmid: ${item.y.toFixed(2)}` }),
    legendPlugin(),
  ],
  accessibility: { label: "Server sampled Binance kline preview" },
});

const series = chart.addLine(
  { dataset, downsample: "server", name: "server OHLC high/low buckets" },
  { color: [0.35, 0.75, 1, 1], lineWidth: 1.5 },
);

async function loadKlines(): Promise<void> {
  const symbol = symbolSelect.value;
  const interval = intervalSelect.value;
  statusEl.textContent = `fetching ${symbol} ${interval} klines…`;
  reloadButton.disabled = true;
  try {
    // Binance documents this market-data-only host as public/no-auth. Klines are already sampled by interval.
    const url = new URL("https://data-api.binance.vision/api/v3/klines");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "1000");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const klines = await response.json() as BinanceKline[];

    dataset.replaceBuckets({
      xStart: klines.map((row) => row[0]),
      xEnd: klines.map((row) => row[6]),
      minY: klines.map((row) => Number(row[3])),
      maxY: klines.map((row) => Number(row[2])),
    });
    series.markDirty();
    chart.fitToData({ padding: { x: 0.01, y: 0.08 } });
    statusEl.textContent = `${klines.length} server-sampled buckets from Binance public market data API`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.textContent = `fetch failed (${message}); using built-in demo buckets`;
    loadFallbackBuckets();
  } finally {
    reloadButton.disabled = false;
  }
}

function loadFallbackBuckets(): void {
  const now = Date.now();
  const count = 500;
  const step = 60 * 60 * 1000;
  const xStart = new Float64Array(count);
  const xEnd = new Float64Array(count);
  const minY = new Float32Array(count);
  const maxY = new Float32Array(count);
  let price = 60_000;
  for (let i = 0; i < count; i++) {
    const x = now - (count - i) * step;
    const wave = Math.sin(i * 0.05) * 450 + Math.sin(i * 0.19) * 120;
    price += Math.sin(i * 0.07) * 35;
    xStart[i] = x;
    xEnd[i] = x + step;
    minY[i] = price + wave - 180 - Math.random() * 80;
    maxY[i] = price + wave + 180 + Math.random() * 80;
  }
  dataset.replaceBuckets({ xStart, xEnd, minY, maxY });
  series.markDirty();
  chart.fitToData({ padding: { x: 0.01, y: 0.08 } });
}

reloadButton.addEventListener("click", () => void loadKlines());
symbolSelect.addEventListener("change", () => void loadKlines());
intervalSelect.addEventListener("change", () => void loadKlines());

void loadKlines();
chart.start();
