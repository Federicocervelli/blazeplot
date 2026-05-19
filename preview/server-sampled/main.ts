import { Chart, OhlcRingBuffer, ServerSampledDataset } from "@/index";
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

interface BinanceAggTrade {
  readonly e: "aggTrade";
  readonly E: number;
  readonly s: string;
  readonly p: string;
  readonly q: string;
  readonly T: number;
}

const sampledChartEl = document.querySelector<HTMLDivElement>("#sampledChart")!;
const liveChartEl = document.querySelector<HTMLDivElement>("#liveChart")!;
const sampledStatusEl = document.querySelector<HTMLSpanElement>("#sampledStatus")!;
const liveStatusEl = document.querySelector<HTMLSpanElement>("#liveStatus")!;
const symbolSelect = document.querySelector<HTMLSelectElement>("#symbolSelect")!;
const intervalSelect = document.querySelector<HTMLSelectElement>("#intervalSelect")!;
const reloadButton = document.querySelector<HTMLButtonElement>("#reloadButton")!;

const sampledDataset = new ServerSampledDataset();
const sampledChart = new Chart(sampledChartEl, {
  title: "Server-sampled min/max buckets",
  subtitle: "Binance public klines arrive already sampled by interval; downsample: \"server\" renders them directly.",
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

const sampledSeries = sampledChart.addLine(
  { dataset: sampledDataset, downsample: "server", name: "server OHLC high/low buckets" },
  { color: [0.35, 0.75, 1, 1], lineWidth: 1.5 },
);

const liveDataset = new OhlcRingBuffer(360);
const liveChart = new Chart(liveChartEl, {
  title: "Live 10s candlestick bars",
  subtitle: "Binance has no native 10s kline interval, so this preview aggregates public aggTrade messages into 10s candles in real time.",
  axes: {
    x: { position: "outside", scale: "time", timezone: "utc", title: "UTC time" },
    y: { position: "outside", title: "price" },
  },
  followX: { window: 5 * 60 * 1000, pauseOnInteraction: true },
  autoFitY: { padding: { y: 0.08 } },
  plugins: [
    interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true }),
    legendPlugin(),
  ],
  accessibility: { label: "Live Binance ten second candlestick chart" },
});

liveChart.addCandlestick(
  { dataset: liveDataset, name: "10s aggTrade candles" },
  {
    color: [0.8, 0.86, 1, 1],
    lineWidth: 1,
    barWidth: 8_000,
    upColor: [0.16, 0.86, 0.56, 1],
    downColor: [0.96, 0.32, 0.36, 1],
    wickColor: [0.75, 0.82, 0.92, 1],
  },
);

let socket: WebSocket | null = null;
let currentBucketStart = NaN;
let currentOpen = NaN;
let currentHigh = NaN;
let currentLow = NaN;
let currentClose = NaN;
let tradeCount = 0;
const candleMs = 10_000;

async function loadKlines(): Promise<void> {
  const symbol = symbolSelect.value;
  const interval = intervalSelect.value;
  sampledStatusEl.textContent = `fetching ${symbol} ${interval} klines…`;
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

    sampledDataset.replaceBuckets({
      xStart: klines.map((row) => row[0]),
      xEnd: klines.map((row) => row[6]),
      minY: klines.map((row) => Number(row[3])),
      maxY: klines.map((row) => Number(row[2])),
    });
    sampledSeries.markDirty();
    sampledChart.fitToData({ padding: { x: 0.01, y: 0.08 } });
    sampledStatusEl.textContent = `${klines.length} server-sampled buckets from Binance public market data API`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sampledStatusEl.textContent = `fetch failed (${message}); using built-in demo buckets`;
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
  sampledDataset.replaceBuckets({ xStart, xEnd, minY, maxY });
  sampledSeries.markDirty();
  sampledChart.fitToData({ padding: { x: 0.01, y: 0.08 } });
}

function connectLiveTrades(): void {
  socket?.close();
  liveDataset.clear();
  currentBucketStart = NaN;
  currentOpen = NaN;
  currentHigh = NaN;
  currentLow = NaN;
  currentClose = NaN;
  tradeCount = 0;
  liveChart.resumeXFollow();

  const symbol = symbolSelect.value.toLowerCase();
  const url = `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`;
  liveStatusEl.textContent = `connecting ${symbolSelect.value} aggTrade stream…`;
  socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    liveStatusEl.textContent = `live ${symbolSelect.value} aggTrade stream connected; building 10s candles…`;
  });
  socket.addEventListener("message", (event) => {
    try {
      const trade = JSON.parse(String(event.data)) as BinanceAggTrade;
      ingestTrade(Number(trade.p), trade.T);
    } catch (error) {
      liveStatusEl.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  socket.addEventListener("close", () => {
    liveStatusEl.textContent = `live stream closed for ${symbolSelect.value}`;
  });
  socket.addEventListener("error", () => {
    liveStatusEl.textContent = "live stream error; Binance WebSocket may be blocked by the browser/network";
  });
}

function ingestTrade(price: number, time: number): void {
  if (!Number.isFinite(price) || !Number.isFinite(time)) return;
  const bucketStart = Math.floor(time / candleMs) * candleMs;
  if (bucketStart !== currentBucketStart) {
    currentBucketStart = bucketStart;
    currentOpen = price;
    currentHigh = price;
    currentLow = price;
    currentClose = price;
    liveDataset.push(bucketStart, currentOpen, currentHigh, currentLow, currentClose);
  } else {
    currentHigh = Math.max(currentHigh, price);
    currentLow = Math.min(currentLow, price);
    currentClose = price;
    liveDataset.updateLast(currentOpen, currentHigh, currentLow, currentClose);
  }
  tradeCount++;
  if (liveDataset.length === 1) liveChart.fitToData({ padding: { x: 0.1, y: 0.1 } });
  liveStatusEl.textContent = `${symbolSelect.value} live: ${liveDataset.length} × 10s candles, ${tradeCount} aggTrades, latest ${price.toFixed(2)}`;
}

reloadButton.addEventListener("click", () => void loadKlines());
symbolSelect.addEventListener("change", () => {
  void loadKlines();
  connectLiveTrades();
});
intervalSelect.addEventListener("change", () => void loadKlines());

void loadKlines();
connectLiveTrades();
sampledChart.start();
liveChart.start();
