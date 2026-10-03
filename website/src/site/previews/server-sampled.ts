import { Chart, OhlcRingBuffer, ServerSampledDataset } from "../../../../src/index.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { addDisposableListener } from ".././charts/dom.ts";
import { siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];
    interface BinanceAggTrade {
      readonly e: "aggTrade";
      readonly E: number;
      readonly s: string;
      readonly p: string;
      readonly q: string;
      readonly T: number;
    }

    const root = target.closest<HTMLElement>("[data-server-sampled-root]");
    if (!root) throw new Error("Missing server sampled root");
    const requireControl = <T extends HTMLElement>(selector: string): T => this.requireControl<T>(root, selector);

    const sampledChartEl = requireControl<HTMLDivElement>("[data-server-sampled-chart]");
    const liveChartEl = requireControl<HTMLDivElement>("[data-server-live-chart]");
    const sampledStatusEl = requireControl<HTMLSpanElement>("[data-server-sampled-status]");
    const liveStatusEl = requireControl<HTMLSpanElement>("[data-server-live-status]");
    const symbolSelect = requireControl<HTMLSelectElement>("[data-server-symbol]");
    const intervalSelect = requireControl<HTMLSelectElement>("[data-server-interval]");
    const reloadButton = requireControl<HTMLButtonElement>("[data-server-reload]");

    const sampledDataset = new ServerSampledDataset();
    const sampledChart = new Chart(sampledChartEl, siteChartOptions({
      axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } },
      hover: { mode: "nearest-x", group: "x", maxDistancePx: 48 },
      plugins: [
        interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true, touchPan: true, pinchZoom: true }),
        crosshairPlugin({
          axis: "xy",
          snap: "nearest-x",
          label: true,
          highlight: false,
          formatX: (value) => new Date(value).toLocaleString(),
          formatY: (value) => value.toFixed(2),
          formatter: (item) => sampledBucketLabel(item.index),
        }),
      ],
      accessibility: { label: "Server sampled Binance kline preview" },
    }));
    this.previewCharts.push(sampledChart);
    const sampledSeries = sampledChart.addLine({ dataset: sampledDataset, downsample: "server", name: "server buckets" }, { color: [0.35, 0.75, 1, 1], lineWidth: 1.5 });

    const liveDataset = new OhlcRingBuffer(720);
    const liveWindowMs = 2 * 60 * 1000;
    const candleMs = 5_000;
    const candleHalfWidthMs = 2_000;
    let socket: WebSocket | null = null;
    let currentBucketStart = NaN;
    let currentOpen = NaN;
    let currentHigh = NaN;
    let currentLow = NaN;
    let currentClose = NaN;
    let tradeCount = 0;
    let highlightedCandleIndex = -1;

    const liveChart = new Chart(liveChartEl, siteChartOptions({
      axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } },
      hover: { mode: "nearest-x", group: "none", maxDistancePx: 48 },
      followX: { window: liveWindowMs, pauseOnInteraction: true },
      autoFitY: { padding: { y: 0.08 } },
      plugins: [
        interactionsPlugin({
          wheelZoom: true,
          shiftDragPan: true,
          boxZoom: true,
          doubleClickReset: true,
          doubleTapReset: true,
          touchPan: true,
          pinchZoom: true,
          resetViewport: () => resumeLiveFollowViewport(),
        }),
        crosshairPlugin({
          axis: "xy",
          snap: "nearest-x",
          label: true,
          highlight: false,
          formatX: (value) => new Date(value).toLocaleTimeString(),
          formatY: (value) => value.toFixed(2),
          formatter: (item) => candleLabel(item.index),
        }),
      ],
      accessibility: { label: "Live Binance five second candlestick chart" },
    }));
    this.previewCharts.push(liveChart);
    const liveSeries = liveChart.addCandlestick(
      { dataset: liveDataset, name: "5s candles" },
      { color: [0.8, 0.86, 1, 1], lineWidth: 1, barWidth: 4_000, upColor: [0.16, 0.86, 0.56, 1], downColor: [0.96, 0.32, 0.36, 1], wickColor: [0.75, 0.82, 0.92, 1] },
    );
    const candleHighlightOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    candleHighlightOverlay.style.position = "absolute";
    candleHighlightOverlay.style.inset = "0";
    candleHighlightOverlay.style.width = "100%";
    candleHighlightOverlay.style.height = "100%";
    candleHighlightOverlay.style.pointerEvents = "none";
    candleHighlightOverlay.style.zIndex = "28";
    candleHighlightOverlay.setAttribute("aria-hidden", "true");
    liveChart.plotElement.appendChild(candleHighlightOverlay);
    this.previewDisposers.push(() => candleHighlightOverlay.remove());

    const addListener = <K extends keyof HTMLElementEventMap>(element: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void): void => addDisposableListener(this.previewDisposers, element, type, listener);

    const loadKlines = async (): Promise<void> => {
      const symbol = symbolSelect.value;
      const interval = intervalSelect.value;
      sampledStatusEl.textContent = `fetching ${symbol} ${interval} klines…`;
      reloadButton.disabled = true;
      try {
        const url = new URL("https://data-api.binance.vision/api/v3/klines");
        url.searchParams.set("symbol", symbol);
        url.searchParams.set("interval", interval);
        url.searchParams.set("limit", "1000");
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const klines = await response.json() as BinanceKline[];
        sampledDataset.replace({ kind: "minmax",
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
    };

    const loadFallbackBuckets = (): void => {
      const now = Date.now();
      const count = 500;
      const step = 60 * 60 * 1000;
      const xStart = new Float64Array(count);
      const xEnd = new Float64Array(count);
      const minY = new Float32Array(count);
      const maxY = new Float32Array(count);
      let price = 60_000;
      for (let i = 0; i < count; i += 1) {
        const x = now - (count - i) * step;
        const wave = Math.sin(i * 0.05) * 450 + Math.sin(i * 0.19) * 120;
        price += Math.sin(i * 0.07) * 35;
        xStart[i] = x;
        xEnd[i] = x + step;
        minY[i] = price + wave - 180 - Math.random() * 80;
        maxY[i] = price + wave + 180 + Math.random() * 80;
      }
      sampledDataset.replace({ kind: "minmax", xStart, xEnd, minY, maxY });
      sampledSeries.markDirty();
      sampledChart.fitToData({ padding: { x: 0.01, y: 0.08 } });
    };

    const connectLiveTrades = (): void => {
      socket?.close();
      liveSeries.clear();
      currentBucketStart = NaN;
      currentOpen = NaN;
      currentHigh = NaN;
      currentLow = NaN;
      currentClose = NaN;
      tradeCount = 0;
      liveChart.setXFollowPaused(false);
      const symbol = symbolSelect.value.toLowerCase();
      const url = `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`;
      liveStatusEl.textContent = `connecting ${symbolSelect.value}…`;
      socket = new WebSocket(url);
      socket.addEventListener("open", () => { liveStatusEl.textContent = `${symbolSelect.value} live 5s`; });
      socket.addEventListener("message", (event) => {
        try {
          const trade = JSON.parse(String(event.data)) as BinanceAggTrade;
          ingestTrade(Number(trade.p), trade.T);
        } catch (error) {
          liveStatusEl.textContent = error instanceof Error ? error.message : String(error);
        }
      });
      socket.addEventListener("close", () => { liveStatusEl.textContent = `live stream closed for ${symbolSelect.value}`; });
      socket.addEventListener("error", () => { liveStatusEl.textContent = "live stream error; Binance WebSocket may be blocked by the browser/network"; });
    };
    this.previewDisposers.push(() => socket?.close());

    function sampledBucketLabel(index: number): string {
      if (index < 0 || index >= sampledDataset.length) return "";
      const range = sampledDataset.rangeMinMaxY(index, index + 1);
      const x = sampledDataset.getX(index);
      if (!range) return new Date(x).toLocaleString();
      return `${new Date(x).toLocaleString()}\nlow ${range.minY.toFixed(2)}\nhigh ${range.maxY.toFixed(2)}`;
    }

    function candleLabel(index: number): string {
      if (index < 0 || index >= liveDataset.length) return "";
      const x = liveDataset.getX(index);
      const open = liveDataset.getOpen(index);
      const high = liveDataset.getHigh(index);
      const low = liveDataset.getLow(index);
      const close = liveDataset.getClose(index);
      const change = close - open;
      const pct = open !== 0 ? (change / open) * 100 : 0;
      return [
        new Date(x).toLocaleTimeString(),
        `O ${open.toFixed(2)}  H ${high.toFixed(2)}`,
        `L ${low.toFixed(2)}  C ${close.toFixed(2)}`,
        `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%)`,
      ].join("\n");
    }

    const ingestTrade = (price: number, time: number): void => {
      if (!Number.isFinite(price) || !Number.isFinite(time)) return;
      const bucketStart = Math.floor(time / candleMs) * candleMs;
      if (bucketStart !== currentBucketStart) {
        currentBucketStart = bucketStart;
        currentOpen = price;
        currentHigh = price;
        currentLow = price;
        currentClose = price;
        liveSeries.append({ x: bucketStart, open: currentOpen, high: currentHigh, low: currentLow, close: currentClose });
      } else {
        currentHigh = Math.max(currentHigh, price);
        currentLow = Math.min(currentLow, price);
        currentClose = price;
        liveSeries.updateLast({ open: currentOpen, high: currentHigh, low: currentLow, close: currentClose });
      }
      tradeCount += 1;
      if (liveDataset.length === 1) liveChart.fitToData({ padding: { x: 0.1, y: 0.1 } });
      liveStatusEl.textContent = `${symbolSelect.value} 5s: ${liveDataset.length} bars, ${tradeCount} trades, ${price.toFixed(2)}`;
    };

    const resumeLiveFollowViewport = (): { xMin: number; xMax: number; yMin: number; yMax: number } => {
      liveChart.setXFollowPaused(false);
      const current = liveChart.getViewport();
      const range = liveDataset.range;
      if (!range) return current;
      const xMax = range.end;
      return { ...current, xMin: xMax - liveWindowMs, xMax };
    };

    const renderHighlightedCandle = (): void => {
      candleHighlightOverlay.replaceChildren();
      if (highlightedCandleIndex < 0 || highlightedCandleIndex >= liveDataset.length) return;
      const width = Math.max(1, liveChart.canvas.clientWidth);
      const height = Math.max(1, liveChart.canvas.clientHeight);
      candleHighlightOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const x = liveDataset.getX(highlightedCandleIndex);
      const open = liveDataset.getOpen(highlightedCandleIndex);
      const high = liveDataset.getHigh(highlightedCandleIndex);
      const low = liveDataset.getLow(highlightedCandleIndex);
      const close = liveDataset.getClose(highlightedCandleIndex);
      const [cx, highY] = liveChart.dataToPlot(x, high);
      const [, lowY] = liveChart.dataToPlot(x, low);
      const [, openY] = liveChart.dataToPlot(x, open);
      const [, closeY] = liveChart.dataToPlot(x, close);
      const [leftX] = liveChart.dataToPlot(x - candleHalfWidthMs, close);
      const [rightX] = liveChart.dataToPlot(x + candleHalfWidthMs, close);
      const bodyX = Math.min(leftX, rightX);
      const bodyW = Math.max(3, Math.abs(rightX - leftX));
      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.max(2, Math.abs(closeY - openY));
      const up = close >= open;
      const stroke = up ? "#bbf7d0" : "#fecaca";
      const fill = up ? "rgba(34, 197, 94, 0.48)" : "rgba(239, 68, 68, 0.48)";
      const wick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      wick.setAttribute("x1", String(cx));
      wick.setAttribute("x2", String(cx));
      wick.setAttribute("y1", String(highY));
      wick.setAttribute("y2", String(lowY));
      wick.setAttribute("stroke", stroke);
      wick.setAttribute("stroke-width", "3");
      wick.setAttribute("stroke-linecap", "round");
      const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      body.setAttribute("x", String(bodyX));
      body.setAttribute("y", String(bodyY));
      body.setAttribute("width", String(bodyW));
      body.setAttribute("height", String(bodyH));
      body.setAttribute("rx", "1.5");
      body.setAttribute("fill", fill);
      body.setAttribute("stroke", stroke);
      body.setAttribute("stroke-width", "2");
      candleHighlightOverlay.append(wick, body);
    };

    this.previewDisposers.push(liveChart.subscribe("hover", (state) => {
      const item = state?.items.find((candidate) => candidate.series === liveSeries);
      highlightedCandleIndex = item?.index ?? -1;
      renderHighlightedCandle();
    }));
    this.previewDisposers.push(liveChart.subscribe("render", renderHighlightedCandle));

    addListener(reloadButton, "click", () => { void loadKlines(); });
    addListener(symbolSelect, "change", () => { void loadKlines(); connectLiveTrades(); });
    addListener(intervalSelect, "change", () => { void loadKlines(); });

    void loadKlines();
    connectLiveTrades();
    sampledChart.start();
    liveChart.start();
  }

}
