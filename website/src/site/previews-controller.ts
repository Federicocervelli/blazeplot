import { type ReactiveController, type ReactiveControllerHost } from "lit";
import { Chart, OhlcRingBuffer, ServerSampledDataset, StaticDataset, UniformRingBuffer, type ChartFrameStats, type ChartPickGroup, type ChartPickMode, type ChartTheme, type SeriesStore, type ViewportPolicy } from "../../../src/index.ts";
import { createLinkedCharts } from "../../../src/linked.ts";
import { annotationsPlugin } from "../../../src/plugins/annotations.ts";
import { crosshairPlugin } from "../../../src/plugins/crosshair.ts";
import { buildFlameGraphModel, flameGraphPlugin } from "../../../src/plugins/flamegraph.ts";
import { interactionsPlugin } from "../../../src/plugins/interactions.ts";
import { legendPlugin } from "../../../src/plugins/legend.ts";
import { navigatorPlugin } from "../../../src/plugins/navigator.ts";
import { tooltipPlugin } from "../../../src/plugins/tooltip.ts";
import { ProceduralLineDataset } from "../ProceduralLineDataset.ts";
import { DEFAULT_APPEND_RATE, LIVE_BATCH_SIZE, MAX_VIEW_SAMPLES, OHLC_INTERVAL, SPARSE_INTERVAL, VIEW_SAMPLES, Y_VIEW, type PreviewDataBatch } from "../preview-data-config.ts";
import { showChartFallback } from "./charts/dom.ts";
import { demoSignal } from "./charts/signals.ts";
import { PREVIEWS, type PreviewId } from "./shared.ts";

interface PreviewHost extends ReactiveControllerHost {
  readonly previewId: PreviewId;
  readonly renderRoot: HTMLElement | DocumentFragment;
}

export class PreviewChartsController implements ReactiveController {
  private readonly host: PreviewHost;
  private previewCharts: Chart[] = [];
  private previewDisposers: Array<() => void> = [];
  private mountedPreviewId: PreviewId | null = null;

  constructor(host: PreviewHost) {
    this.host = host;
    host.addController(this);
  }

  hostUpdated(): void {
    this.mountPreviewCharts();
  }

  hostDisconnected(): void {
    this.disposePreviewCharts();
  }

  private get previewIndex(): number {
    const index = PREVIEWS.findIndex((preview) => preview.id === this.host.previewId);
    return index >= 0 ? index : 0;
  }

  private mountPreviewCharts(): void {
    const selected = PREVIEWS[this.previewIndex] ?? PREVIEWS[0]!;
    if (this.mountedPreviewId === selected.id && this.previewCharts.length > 0) return;
    this.disposePreviewCharts();
    this.mountedPreviewId = selected.id;

    const targets = Array.from(this.host.renderRoot.querySelectorAll<HTMLElement>("[data-preview-chart]"));
    for (const target of targets) {
      const kind = target.dataset.previewChart;
      try {
        if (kind === "live") this.mountLivePreviewChart(target);
        else if (kind === "sensor") this.mountSensorStreamPreview(target);
        else if (kind === "feature-hero") this.mountFeatureHeroChart(target);
        else if (kind === "histogram") this.mountHistogramPreview(target);
        else if (kind === "feature-linked") this.mountFeatureLinkedCharts(target);
        else if (kind === "server-sampled") this.mountServerSampledChart(target);
        else if (kind === "flamechart") this.mountFlameChartPreview(target);
        else if (kind === "render-loop") this.mountRenderLoopPreview(target);
        else if (kind === "mobile") this.mountMobileChart(target);
      } catch {
        showChartFallback(target);
      }
    }
  }

  private mountSensorStreamPreview(target: HTMLElement): void {
    const root = target.closest<HTMLElement>("section") ?? target;
    const status = root.querySelector<HTMLElement>("[data-sensor-status]");
    const liveButton = root.querySelector<HTMLButtonElement>("[data-sensor-live]");

    const chart = new Chart(target, {
      axes: { x: { position: "outside", scale: "time" }, y: { position: "outside" }, y2: { visible: true, position: "outside" } },
      grid: true,
      autoFitY: { padding: { y: 0.15 }, yAxis: "both" },
      plugins: [
        interactionsPlugin({ minDragDistancePx: 4 }),
        tooltipPlugin(),
        crosshairPlugin({ snap: "nearest-x", label: true }),
        legendPlugin({ position: "top-left" }),
      ],
    });
    this.previewCharts.push(chart);

    const temperature = chart.addLine({ capacity: 20_000, name: "temperature °C" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    const humidity = chart.addLine({ capacity: 20_000, name: "humidity %" }, { color: [0.2, 0.85, 0.45, 1], lineWidth: 1.5 });
    const vibration = chart.addLine({ capacity: 20_000, name: "vibration RMS", yAxis: "right" }, { color: [0.2, 0.7, 1, 1], lineWidth: 1.5 });

    const streamStartMs = Date.now();
    let nextSampleAt = streamStartMs - 60_000;
    let tick = 0;
    let timeoutId = 0;
    let dropoutUntil = -Infinity;

    const nextSensorInterval = (): number => 12 + Math.random() * 18;

    const sensorValues = (timestampMs: number): { temp: number; humidity: number; vibe: number } => {
      const seconds = (timestampMs - streamStartMs) / 1000;
      const dutyCycle = Math.sin(seconds * 0.23) > 0.72 ? 1 : 0;
      const temp = 24
        + Math.sin(seconds * 0.055) * 2.2
        + Math.sin(seconds * 0.72) * 0.42
        + dutyCycle * 0.9
        + (Math.random() - 0.5) * 0.18;
      const humidity = 50
        - (temp - 24) * 1.45
        + Math.sin(seconds * 0.031 + 1.7) * 3.8
        + (Math.random() - 0.5) * 0.35;
      const spike = Math.random() < 0.012 ? 0.4 + Math.random() * 0.8 : 0;
      const vibe = 0.42
        + Math.abs(Math.sin(seconds * 16.5)) * 0.075
        + Math.sin(seconds * 0.9) * 0.035
        + dutyCycle * 0.16
        + spike
        + Math.random() * 0.035;
      return { temp, humidity, vibe };
    };

    const isHistoricalDropout = (timestampMs: number): boolean => {
      const offset = timestampMs - streamStartMs;
      return (offset > -45_000 && offset < -43_700) || (offset > -21_500 && offset < -20_300) || (offset > -7_800 && offset < -7_000);
    };

    const seedX: number[] = [];
    const seedTemp: number[] = [];
    const seedHumidity: number[] = [];
    const seedVibration: number[] = [];
    while (nextSampleAt < streamStartMs) {
      const timestamp = nextSampleAt;
      const values = sensorValues(timestamp);
      const missing = isHistoricalDropout(timestamp);
      seedX.push(timestamp);
      seedTemp.push(missing ? NaN : values.temp);
      seedHumidity.push(missing ? NaN : values.humidity);
      seedVibration.push(missing ? NaN : values.vibe);
      nextSampleAt += nextSensorInterval();
    }
    temperature.append({ x: Float64Array.from(seedX), y: Float32Array.from(seedTemp) });
    humidity.append({ x: Float64Array.from(seedX), y: Float32Array.from(seedHumidity) });
    vibration.append({ x: Float64Array.from(seedX), y: Float32Array.from(seedVibration) });

    const updateStatus = (delay: number, batchCount: number, missingCount: number, values: { temp: number; humidity: number; vibe: number }): void => {
      if (!status) return;
      const dropout = missingCount > 0 ? ` · ${missingCount} dropout gaps` : "";
      status.textContent = `samples ${tick.toLocaleString()} · batch ${batchCount} · next ${Math.round(delay)}ms · ${values.temp.toFixed(2)}°C · ${values.humidity.toFixed(1)}% RH · ${values.vibe.toFixed(3)} RMS${dropout}`;
    };

    const schedule = (): void => {
      const delay = 70 + Math.random() * 110;
      timeoutId = window.setTimeout(() => {
        const flushNow = Date.now();
        const xBatch: number[] = [];
        const tempBatch: number[] = [];
        const humidityBatch: number[] = [];
        const vibrationBatch: number[] = [];
        let missingCount = 0;
        let latest = sensorValues(nextSampleAt);
        while (nextSampleAt <= flushNow && xBatch.length < 96) {
          const timestamp = nextSampleAt;
          if (timestamp > dropoutUntil && tick > 0 && tick % 600 === 0) dropoutUntil = timestamp + 850 + Math.random() * 450;
          const missing = timestamp < dropoutUntil;
          latest = sensorValues(timestamp);
          xBatch.push(timestamp);
          tempBatch.push(missing ? NaN : latest.temp);
          humidityBatch.push(missing ? NaN : latest.humidity);
          vibrationBatch.push(missing ? NaN : latest.vibe);
          if (missing) missingCount += 1;
          tick += 1;
          nextSampleAt += nextSensorInterval();
        }
        if (xBatch.length > 0) {
          temperature.append({ x: Float64Array.from(xBatch), y: Float32Array.from(tempBatch) });
          humidity.append({ x: Float64Array.from(xBatch), y: Float32Array.from(humidityBatch) });
          vibration.append({ x: Float64Array.from(xBatch), y: Float32Array.from(vibrationBatch) });
          updateStatus(delay, xBatch.length, missingCount, latest);
        }
        schedule();
      }, delay);
    };

    const onLive = (): void => chart.resumeLatestXFollow();
    liveButton?.addEventListener("click", onLive);
    if (liveButton) this.previewDisposers.push(() => liveButton.removeEventListener("click", onLive));
    this.previewDisposers.push(() => window.clearTimeout(timeoutId));

    chart.fitToData({ padding: { x: 0.02, y: 0.12 } });
    chart.followLatestX({ window: 30_000, pauseOnInteraction: true, currentX: () => Date.now() });
    chart.start();
    schedule();
  }

  private mountLivePreviewChart(target: HTMLElement): void {
    const liveRoot = target.closest<HTMLElement>("[data-live-preview-root]") ?? target;
    const requireControl = <T extends HTMLElement>(selector: string): T => {
      const element = liveRoot.querySelector<T>(selector);
      if (!element) throw new Error(`Missing live preview control ${selector}`);
      return element;
    };
    const overlay = requireControl<HTMLElement>("[data-live-overlay]");
    const overlayText = requireControl<HTMLSpanElement>("[data-live-overlay-text]");
    const copyIcon = requireControl<HTMLButtonElement>("[data-live-copy]");
    const themeSelect = requireControl<HTMLSelectElement>("[data-live-theme]");
    const hoverModeSelect = requireControl<HTMLSelectElement>("[data-live-hover-mode]");
    const hoverGroupSelect = requireControl<HTMLSelectElement>("[data-live-hover-group]");
    const axesSelect = requireControl<HTMLSelectElement>("[data-live-axes]");
    const viewSamplesInput = requireControl<HTMLInputElement>("[data-live-view-samples]");
    const appendRateInput = requireControl<HTMLInputElement>("[data-live-append-rate]");
    const followToggle = requireControl<HTMLInputElement>("[data-live-follow]");
    const streamToggle = requireControl<HTMLInputElement>("[data-live-stream]");
    const syncXToggle = requireControl<HTMLInputElement>("[data-live-sync-x]");
    const perfToggleButton = requireControl<HTMLButtonElement>("[data-live-perf-toggle]");
    const resetViewButton = requireControl<HTMLButtonElement>("[data-live-reset]");
    const screenshotButton = requireControl<HTMLButtonElement>("[data-live-screenshot]");

    type PreviewTheme = "default" | "light";
    const lightTheme: ChartTheme = {
      backgroundColor: "#ffffff",
      gridColor: "rgba(0, 0, 0, 0.14)",
      axisColor: "#222",
      tooltipBackgroundColor: "rgba(255, 255, 255, 0.94)",
      tooltipTextColor: "#111",
      legendBackgroundColor: "rgba(255, 255, 255, 0.88)",
      legendBorderColor: "rgba(0, 0, 0, 0.16)",
      legendTextColor: "#111",
      legendMutedTextColor: "#666",
    };

    let t = 0;
    let viewSamples = VIEW_SAMPLES;
    let appendRate = DEFAULT_APPEND_RATE;
    let previewStartTime = Date.now();
    let dataGeneration = 0;
    let frames = 0;
    let appendedSinceStats = 0;
    let lastStatsAt = performance.now();
    let workerPending = false;
    let followLive = true;
    let streaming = true;
    let streamClockStartedAt = performance.now();
    let syncX = true;
    let showPerfPanel = true;
    let currentTheme: PreviewTheme = "default";
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 2,
    });
    const numberFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 });
    const hoverOptions: { mode: ChartPickMode; group: ChartPickGroup } = { mode: "nearest-x", group: "x" };
    const tooltipOptions: { mode: ChartPickMode; group: ChartPickGroup; highlight: boolean; formatter: (item: { readonly x: number; readonly y: number }) => string } = {
      mode: hoverOptions.mode,
      group: hoverOptions.group,
      highlight: true,
      formatter: (item) => `(${dateFormatter.format(new Date(item.x))}, ${numberFormatter.format(item.y)})`,
    };
    const maxAppendRate = 1_000_000;

    let lineSeries: SeriesStore | null = null;
    let areaSeries: SeriesStore | null = null;
    let scatterSeries: SeriesStore | null = null;
    let barSeries: SeriesStore | null = null;
    let ohlcSeries: SeriesStore | null = null;
    let ohlcDataset: OhlcRingBuffer | null = null;
    const chartStats: ChartFrameStats = {
      fps: 0,
      frameMs: 0,
      pointsRendered: 0,
      drawCalls: 0,
      uploadBytes: 0,
      renderMode: "none",
    };

    const sampleStepMs = (): number => 1000 / appendRate;
    const sampleToTime = (sample: number): number => previewStartTime + sample * sampleStepMs();
    const liveXViewport = (): { xMin: number; xMax: number } => {
      const xMax = sampleToTime(t);
      return { xMin: xMax - viewSamples * sampleStepMs(), xMax };
    };

    const annotations = annotationsPlugin({
      annotations: [
        { id: "target-band", type: "y-range", yMin: 0.95, yMax: 1.18, fillColor: "rgba(96, 165, 250, 0.10)", borderColor: "rgba(147, 197, 253, 0.35)", label: "target zone" },
        { id: "release-window", type: "x-range", xMin: sampleToTime(VIEW_SAMPLES * 0.18), xMax: sampleToTime(VIEW_SAMPLES * 0.24), fillColor: "rgba(250, 204, 21, 0.10)", borderColor: "rgba(250, 204, 21, 0.35)", label: "event window" },
        { id: "threshold", type: "y-line", y: -0.25, color: "rgba(248, 113, 113, 0.85)", dash: "5 4", label: "spike threshold" },
        { id: "marker", type: "point", x: sampleToTime(VIEW_SAMPLES * 0.5), y: 0.82, radius: 6, color: "rgba(34, 211, 238, 0.95)", shape: "diamond", label: "marker" },
      ],
    });

    const previewPolicy: ViewportPolicy = {
      beforePan(_camera, intent) {
        if (syncX) return { ...intent, dx: 0 };
        followLive = false;
        followToggle.checked = followLive;
        return intent;
      },
      beforeZoom(_camera, intent) {
        if (syncX) return { ...intent, axis: "y" };
        followLive = false;
        followToggle.checked = followLive;
        return intent;
      },
      beforeRender(camera) {
        if (!followLive) return;
        camera.setViewport(liveXViewport());
      },
    };

    const chart = new Chart(target, {
      viewportPolicy: previewPolicy,
      axes: { x: { position: "outside", scale: "time", timezone: "local" }, y: { position: "outside" } },
      hover: hoverOptions,
      plugins: [
        interactionsPlugin({ axis: () => syncX ? "y" : "xy", viewportPolicy: previewPolicy }),
        annotations,
        legendPlugin({ toggleOnClick: true }),
        tooltipPlugin(tooltipOptions),
      ],
    });
    this.previewCharts.push(chart);

    const dataWorker = new Worker(new URL("../preview-data-worker.ts", import.meta.url), { type: "module" });
    this.previewDisposers.push(() => dataWorker.terminate());
    const onWorkerMessage = (event: MessageEvent<PreviewDataBatch>): void => appendGeneratedBatch(event.data);
    dataWorker.addEventListener("message", onWorkerMessage);
    this.previewDisposers.push(() => dataWorker.removeEventListener("message", onWorkerMessage));

    const addListener = <K extends keyof HTMLElementEventMap>(element: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
      element.addEventListener(type, listener as EventListener);
      this.previewDisposers.push(() => element.removeEventListener(type, listener as EventListener));
    };

    const historySamples = (): number => Math.max(1, viewSamples);
    const sparseHistoryCapacity = (): number => Math.ceil(historySamples() / SPARSE_INTERVAL) + 2;
    const ohlcHistoryCapacity = (): number => Math.ceil(historySamples() / OHLC_INTERVAL) + 2;
    const maxBatchSize = (): number => Math.max(LIVE_BATCH_SIZE, Math.ceil(appendRate / 20));
    const nextBatchSize = (): number => {
      const targetSamples = Math.floor(((performance.now() - streamClockStartedAt) * appendRate) / 1000);
      const due = targetSamples - t;
      return due <= 0 ? 0 : Math.min(maxBatchSize(), due);
    };
    const syncStreamClock = (now: number = performance.now()): void => {
      streamClockStartedAt = now - (t * 1000) / appendRate;
    };

    const configureWorker = (): void => {
      dataWorker.postMessage({ type: "reset", generation: dataGeneration, xStart: previewStartTime, xStepMs: sampleStepMs() });
    };
    const installSeries = (): void => {
      const history = historySamples();
      const xStep = sampleStepMs();
      lineSeries = chart.addLine(
        { dataset: new ProceduralLineDataset(history, { xStart: previewStartTime, xStep, tracePeriod: viewSamples }), downsample: "minmax", name: "Wave" },
        { lineWidth: 1 },
      );
      const areaDataset = new UniformRingBuffer(sparseHistoryCapacity(), { xStart: previewStartTime, xStep: SPARSE_INTERVAL * xStep });
      const spikeDataset = new UniformRingBuffer(sparseHistoryCapacity(), { xStart: previewStartTime, xStep: SPARSE_INTERVAL * xStep });
      const barDataset = new UniformRingBuffer(sparseHistoryCapacity(), { xStart: previewStartTime, xStep: SPARSE_INTERVAL * xStep, blockSize: 16 });
      areaSeries = chart.addArea({ dataset: areaDataset, downsample: "none", name: "Area" }, { baseline: -0.05, lineWidth: 1 });
      scatterSeries = chart.addScatter({ dataset: spikeDataset, downsample: "none", name: "Spikes" }, { pointSize: 5 });
      barSeries = chart.addBar({ dataset: barDataset, downsample: "minmax", name: "Power" }, { barWidth: SPARSE_INTERVAL * xStep, baseline: -1.1 });
      ohlcDataset = new OhlcRingBuffer(ohlcHistoryCapacity());
      ohlcSeries = chart.addOhlc({ dataset: ohlcDataset, downsample: "none", name: "OHLC" }, { tickWidth: OHLC_INTERVAL * xStep * 0.7, lineWidth: 1 });
    };
    const removeSeries = (): void => {
      if (lineSeries) chart.removeSeries(lineSeries);
      if (areaSeries) chart.removeSeries(areaSeries);
      if (scatterSeries) chart.removeSeries(scatterSeries);
      if (barSeries) chart.removeSeries(barSeries);
      if (ohlcSeries) chart.removeSeries(ohlcSeries);
      lineSeries = areaSeries = scatterSeries = barSeries = ohlcSeries = null;
    };
    const resetDataModel = (): void => {
      if (lineSeries) removeSeries();
      t = 0;
      appendedSinceStats = 0;
      frames = 0;
      workerPending = false;
      previewStartTime = Date.now();
      streamClockStartedAt = performance.now();
      dataGeneration++;
      installSeries();
      configureWorker();
      chart.setViewport({ ...liveXViewport(), ...Y_VIEW });
      updateOverlay(true);
    };
    const releaseBuffers = (batch: PreviewDataBatch): ArrayBuffer[] => {
      const buffers: ArrayBuffer[] = [];
      if (batch.areaY) buffers.push(batch.areaY);
      if (batch.spikeY) buffers.push(batch.spikeY);
      if (batch.barY) buffers.push(batch.barY);
      if (batch.ohlcX) buffers.push(batch.ohlcX);
      if (batch.ohlcOpen) buffers.push(batch.ohlcOpen);
      if (batch.ohlcHigh) buffers.push(batch.ohlcHigh);
      if (batch.ohlcLow) buffers.push(batch.ohlcLow);
      if (batch.ohlcClose) buffers.push(batch.ohlcClose);
      return buffers;
    };
    const appendGeneratedBatch = (batch: PreviewDataBatch): void => {
      const release = releaseBuffers(batch);
      if (batch.generation !== dataGeneration) {
        if (release.length > 0) dataWorker.postMessage({ type: "release", buffers: release }, release);
        return;
      }
      lineSeries?.appendY({ length: batch.batchSize });
      if (batch.sparseCount > 0 && batch.areaY && batch.spikeY && batch.barY) {
        areaSeries?.appendY(new Float32Array(batch.areaY));
        scatterSeries?.appendY(new Float32Array(batch.spikeY));
        barSeries?.appendY(new Float32Array(batch.barY));
      }
      if (batch.ohlcCount > 0 && ohlcSeries && batch.ohlcX && batch.ohlcOpen && batch.ohlcHigh && batch.ohlcLow && batch.ohlcClose) {
        ohlcSeries.append({
          x: new Float64Array(batch.ohlcX),
          open: new Float32Array(batch.ohlcOpen),
          high: new Float32Array(batch.ohlcHigh),
          low: new Float32Array(batch.ohlcLow),
          close: new Float32Array(batch.ohlcClose),
        });
      }
      t = batch.end;
      appendedSinceStats += batch.batchSize;
      frames++;
      workerPending = false;
      dataWorker.postMessage({ type: "release", buffers: release }, release);
      updateOverlay();
    };
    const updateOverlay = (force = false): void => {
      const now = performance.now();
      if (!force && now - lastStatsAt < 500) return;
      const elapsedMs = now - lastStatsAt;
      const actualAppendRate = (appendedSinceStats * 1000) / elapsedMs;
      chart.getFrameStats(chartStats);
      overlay.toggleAttribute("hidden", !showPerfPanel);
      if (!showPerfPanel) {
        frames = 0;
        appendedSinceStats = 0;
        lastStatsAt = now;
        return;
      }
      overlayText.textContent = [
        `status: ${streaming ? workerPending ? "worker pending" : "streaming" : "paused"}`,
        `renderer: ${chartStats.renderMode}`,
        `samples: ${t.toLocaleString()}`,
        `sample rate: ${appendRate.toLocaleString()}/sec target, ${actualAppendRate.toFixed(0)}/sec actual`,
        `view samples: ${viewSamples.toLocaleString()}`,
        `render fps: ${chartStats.fps.toFixed(1)}`,
        `render ms/frame: ${chartStats.frameMs.toFixed(2)}`,
        `points rendered/frame: ${chartStats.pointsRendered.toLocaleString()}`,
        `draw calls/frame: ${chartStats.drawCalls}`,
      ].join("\n");
      frames = 0;
      appendedSinceStats = 0;
      lastStatsAt = now;
    };
    const applyTheme = (name: PreviewTheme): void => {
      currentTheme = name;
      liveRoot.dataset.previewTheme = name;
      chart.setTheme(name === "light" ? lightTheme : undefined);
    };
    const resetView = (): void => {
      followLive = true;
      followToggle.checked = true;
      chart.setViewport({ ...liveXViewport(), ...Y_VIEW });
    };
    const setViewSamples = (value: string): void => {
      const parsed = Number(value.replaceAll(",", ""));
      viewSamples = Number.isFinite(parsed) ? Math.round(Math.min(MAX_VIEW_SAMPLES, Math.max(1_000, parsed))) : VIEW_SAMPLES;
      viewSamplesInput.value = String(viewSamples);
      resetDataModel();
    };
    const setAppendRate = (value: string): void => {
      const parsed = Number(value.replaceAll(",", ""));
      appendRate = Number.isFinite(parsed) ? Math.round(Math.min(maxAppendRate, Math.max(1, parsed))) : DEFAULT_APPEND_RATE;
      appendRateInput.value = String(appendRate);
      resetDataModel();
    };
    const downloadScreenshot = async (): Promise<void> => {
      const blob = await chart.screenshot();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `blazeplot-${currentTheme}.png`;
      link.click();
      URL.revokeObjectURL(url);
    };
    const asPreviewTheme = (value: string): PreviewTheme => value === "light" ? "light" : "default";
    const asHoverMode = (value: string): ChartPickMode => value === "nearest-point" ? "nearest-point" : "nearest-x";
    const asHoverGroup = (value: string): ChartPickGroup => value === "none" ? "none" : "x";

    addListener(copyIcon, "click", () => navigator.clipboard.writeText(overlayText.textContent?.trim() ?? "").catch(() => {}));
    addListener(themeSelect, "change", () => applyTheme(asPreviewTheme(themeSelect.value)));
    addListener(hoverModeSelect, "change", () => { const mode = asHoverMode(hoverModeSelect.value); hoverOptions.mode = mode; tooltipOptions.mode = mode; chart.setViewport({}); });
    addListener(hoverGroupSelect, "change", () => { const group = asHoverGroup(hoverGroupSelect.value); hoverOptions.group = group; tooltipOptions.group = group; chart.setViewport({}); });
    addListener(viewSamplesInput, "change", () => setViewSamples(viewSamplesInput.value));
    addListener(appendRateInput, "change", () => setAppendRate(appendRateInput.value));
    addListener(followToggle, "change", () => { followLive = followToggle.checked; });
    addListener(streamToggle, "change", () => { const nextStreaming = streamToggle.checked; if (nextStreaming === streaming) return; streaming = nextStreaming; if (streaming) syncStreamClock(); });
    addListener(syncXToggle, "change", () => { syncX = syncXToggle.checked; });
    addListener(perfToggleButton, "click", () => { showPerfPanel = !showPerfPanel; perfToggleButton.textContent = showPerfPanel ? "hide stats" : "show stats"; if (!showPerfPanel) overlayText.textContent = ""; });
    addListener(axesSelect, "change", () => {
      if (axesSelect.value === "off") chart.setAxes(false);
      else {
        const position = axesSelect.value === "inside" ? "inside" : "outside";
        chart.setAxes({ x: { position, scale: "time", timezone: "local" }, y: { position } });
      }
    });
    addListener(resetViewButton, "click", resetView);
    addListener(screenshotButton, "click", () => { void downloadScreenshot(); });

    installSeries();
    configureWorker();
    viewSamplesInput.max = String(MAX_VIEW_SAMPLES);
    viewSamplesInput.value = String(viewSamples);
    appendRateInput.value = String(appendRate);
    applyTheme("default");
    chart.setViewport({ ...liveXViewport(), ...Y_VIEW });
    chart.start();

    let raf = 0;
    const stream = (): void => {
      if (streaming) {
        const batchSize = nextBatchSize();
        if (!workerPending && batchSize !== 0) {
          workerPending = true;
          dataWorker.postMessage({ type: "generate", batchSize, generation: dataGeneration });
        }
      } else {
        frames++;
        updateOverlay();
      }
      raf = requestAnimationFrame(stream);
    };
    raf = requestAnimationFrame(stream);
    this.previewDisposers.push(() => cancelAnimationFrame(raf));
  }

  private mountFlameChartPreview(target: HTMLElement): void {
    const model = buildFlameGraphModel(this.flameChartStacks(), { flameChart: true, countName: "ms" });
    const flame = flameGraphPlugin({
      model,
      search: null,
      minFrameWidthPx: 1,
      labelMinWidthPx: 18,
      onFrameClick: ({ frame }) => {
        chart.setViewport({ xMin: frame.start, xMax: frame.end, yMin: Math.max(0, frame.depth - 0.5), yMax: Math.min(model.maxDepth + 1, frame.depth + 3.5) });
      },
      tooltipFormatter: (pick) => `${pick.frame.name}\n${pick.frame.value.toFixed(1)} ms (${(pick.percent * 100).toFixed(2)}%)`,
    });
    const chart = new Chart(target, {
      axes: { x: { position: "outside", title: "profile time (ms)" }, y: { position: "outside", title: "stack depth" } },
      grid: false,
      plugins: [interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true }), flame],
      accessibility: { label: "Flame chart preview" },
    });
    this.previewCharts.push(chart);
    chart.setViewport({ xMin: model.minX, xMax: model.maxX, yMin: 0, yMax: model.maxDepth + 1 });
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

  private mountHistogramPreview(target: HTMLElement): void {
    const values = new Float64Array(18_000);
    for (let index = 0; index < values.length; index++) {
      const phase = index / values.length;
      const cluster = index % 9;
      const baseline = cluster < 5 ? 70 : cluster < 8 ? 115 : 165;
      const seasonal = Math.sin(phase * Math.PI * 10) * 8 + Math.sin(index * 0.017) * 5;
      const jitter = (Math.sin(index * 12.9898) * 43758.5453 % 1) * 10;
      values[index] = baseline + seasonal + jitter + (index % 997 === 0 ? 85 : 0);
    }

    const chart = new Chart(target, {
      axes: { x: { position: "outside", title: "latency (ms)" }, y: { position: "outside", title: "density" } },
      grid: true,
      hover: { mode: "nearest-x", group: "none" },
      plugins: [
        interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true }),
        crosshairPlugin({ snap: "nearest-x", label: true, labelPlacement: "top-right", formatX: (value) => `${value.toFixed(0)} ms`, formatY: (value) => value.toFixed(4) }),
        legendPlugin({ position: "top-left" }),
      ],
      accessibility: { label: "Histogram preview" },
    });
    this.previewCharts.push(chart);

    chart.addHistogram({ values, binSize: 5, min: 40, max: 260, normalize: "density", name: "Latency density", downsample: "none" }, {
      color: [0.988, 0.29, 0.02, 0.95],
      baseline: 0,
    });
    chart.fitToData({ includeZero: true, padding: { y: 0.12 } });
    chart.setViewport({ ...chart.getViewport(), xMin: 40, xMax: 260, yMin: 0 });
    chart.start();
  }

  private mountFeatureHeroChart(target: HTMLElement): void {
    const { xs, cpu, latency, throughput, incidents, initialXMin, initialXMax } = this.featureData();
    const formatDate = this.featureFormatDate;
    const formatValue = this.featureFormatValue;
    const chart = new Chart(target, {
      axes: {
        x: { position: "outside", scale: "time", timezone: "utc", tickFormat: "%b %d %H:%M" },
        y: { position: "outside", title: "CPU / throughput" },
        y2: { position: "outside", title: "Latency (ms)" },
      },
      hover: { mode: "nearest-x", group: "x", maxDistancePx: 32 },
      grid: true,
      plugins: [
        interactionsPlugin({ wheelZoom: true, shiftDragPan: true }),
        annotationsPlugin({
          annotations: [
            { type: "y-range", yMin: 80, yMax: 100, fillColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)", label: "hot zone" },
            { type: "x-range", xMin: xs[120]!, xMax: xs[150]!, fillColor: "rgba(250,204,21,0.10)", borderColor: "rgba(250,204,21,0.35)", label: "deploy window" },
          ],
        }),
        crosshairPlugin({
          group: "feature-preview",
          snap: "nearest-x",
          mode: "ruler",
          rulerModifier: "ctrl",
          formatX: formatDate,
          formatY: formatValue,
          onMeasureStart: (position) => this.featureLog(`ruler start: ${formatDate(position.dataX)}, ${formatValue(position.dataY)}`),
          onMeasureChange: (measurement) => this.featureLog(`ruler Δx ${this.featureFormatDuration(measurement.deltaX)}  Δy ${formatValue(measurement.deltaY)}`),
          onMeasureEnd: (measurement) => this.featureLog(`ruler end: Δx ${this.featureFormatDuration(measurement.deltaX)}  Δy ${formatValue(measurement.deltaY)}  samples ${measurement.sampleCount.toLocaleString()}`),
        }),
        navigatorPlugin({ height: 58, placement: "bottom", followLive: false }),
        legendPlugin({ toggleOnClick: true }),
        tooltipPlugin({ mode: "nearest-x", group: "x", maxDistancePx: 48, formatter: (item) => `(${formatDate(item.x)}, ${formatValue(item.y)})` }),
      ],
    });
    this.previewCharts.push(chart);

    chart.addArea({ capacity: xs.length, dataset: new StaticDataset(xs, throughput), downsample: "none", name: "Throughput" }, { baseline: 0, fillColor: [0.125, 0.827, 0.933, 0.16], lineWidth: 1 });
    chart.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, cpu), downsample: "minmax", name: "CPU" }, { color: [0.22, 0.74, 0.97, 1], lineWidth: 2 });
    chart.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, latency), downsample: "minmax", name: "Latency", yAxis: "right" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    chart.addScatter({ capacity: xs.length, dataset: new StaticDataset(xs, incidents), downsample: "none", name: "Incidents" }, { color: [1, 0.85, 0.25, 1], pointSize: 8 });
    chart.setViewport({ xMin: initialXMin, xMax: initialXMax, yMin: 0, yMax: 120 });
    chart.setYViewport("right", { yMin: 0, yMax: 130 });
    chart.subscribe("viewportchange", (event) => this.featureLog(`viewport: ${formatDate(event.viewport.xMin)} → ${formatDate(event.viewport.xMax)}`));
    chart.subscribe("seriesclick", (event) => this.featureLog(`seriesclick: ${event.item.name ?? event.item.seriesIndex} @ ${formatDate(event.item.x)}`));
    const reset = this.host.renderRoot.querySelector<HTMLButtonElement>("[data-feature-reset]");
    if (reset) {
      const onReset = (): void => {
        chart.setViewport({ xMin: initialXMin, xMax: initialXMax, yMin: 0, yMax: 120 });
        chart.setYViewport("right", { yMin: 0, yMax: 130 });
        this.featureLog("views reset");
      };
      reset.addEventListener("click", onReset);
      this.previewDisposers.push(() => reset.removeEventListener("click", onReset));
    }
    chart.start();
    this.featureLog("feature preview ready");
  }

  private mountFeatureLinkedCharts(target: HTMLElement): void {
    const { xs, cpu, latency, initialXMin, initialXMax } = this.featureData();
    const linked = createLinkedCharts(target, {
      rows: 2,
      spacing: 8,
      sharedX: true,
      panels: [
        {
          options: {
            axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } },
            plugins: [interactionsPlugin({ boxZoom: false, shiftDragPan: true }), crosshairPlugin({ group: "linked-preview", snap: "nearest-x", formatX: this.featureFormatDate, formatY: this.featureFormatValue })],
          },
        },
        {
          options: {
            axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside", scale: "log", logBase: 10 } },
            plugins: [interactionsPlugin({ boxZoom: false, shiftDragPan: true }), crosshairPlugin({ group: "linked-preview", snap: "nearest-x", formatX: this.featureFormatDate, formatY: this.featureFormatValue })],
          },
        },
      ],
    });
    this.previewDisposers.push(() => linked.dispose());
    const linkedA = linked.charts[0]!;
    const linkedB = linked.charts[1]!;
    linkedA.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, cpu), downsample: "minmax", name: "CPU" }, { lineWidth: 2 });
    linkedB.addLine({ capacity: xs.length, dataset: new StaticDataset(xs, latency.map((value) => Math.max(1, value))), downsample: "minmax", name: "Latency log ticks" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    linked.setXRange(initialXMin, initialXMax);
    linkedA.setViewport({ yMin: 0, yMax: 120 });
    linkedB.setViewport({ yMin: 1, yMax: 140 });
    linkedA.start();
    linkedB.start();
    const reset = this.host.renderRoot.querySelector<HTMLButtonElement>("[data-feature-reset]");
    if (reset) {
      const onReset = (): void => {
        linked.setXRange(initialXMin, initialXMax);
        linkedA.setViewport({ yMin: 0, yMax: 120 });
        linkedB.setViewport({ yMin: 1, yMax: 140 });
      };
      reset.addEventListener("click", onReset);
      this.previewDisposers.push(() => reset.removeEventListener("click", onReset));
    }
  }

  private featureData(): {
    xs: Float64Array;
    cpu: Float32Array;
    latency: Float32Array;
    throughput: Float32Array;
    incidents: Float32Array;
    initialXMin: number;
    initialXMax: number;
  } {
    const hour = 60 * 60 * 1000;
    const start = Date.UTC(2026, 4, 18, 0, 0, 0);
    const count = 360;
    const xs = Float64Array.from({ length: count }, (_, i) => start + i * hour);
    const cpu = Float32Array.from({ length: count }, (_, i) => 48 + Math.sin(i * 0.095) * 18 + Math.sin(i * 0.43) * 5);
    const latency = Float32Array.from({ length: count }, (_, i) => 25 + Math.abs(Math.sin(i * 0.13)) * 72 + Math.sin(i * 0.51) * 6);
    const throughput = Float32Array.from({ length: count }, (_, i) => 90 + Math.sin(i * 0.055) * 28 + Math.cos(i * 0.21) * 8);
    const incidents = Float32Array.from({ length: count }, (_, i) => i % 53 === 0 ? 96 : -999);
    return { xs, cpu, latency, throughput, incidents, initialXMin: xs[70]!, initialXMax: xs[230]! };
  }

  private featureLog(line: string): void {
    const target = this.host.renderRoot.querySelector<HTMLPreElement>("[data-feature-log]");
    if (!target) return;
    const lines = target.textContent ? target.textContent.split("\n") : [];
    target.textContent = [`${new Date().toLocaleTimeString()}  ${line}`, ...lines].slice(0, 12).join("\n");
  }

  private featureFormatDate = (value: number): string => {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
  };

  private featureFormatValue = (value: number): string => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(value);

  private featureFormatDuration(ms: number): string {
    return `${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(ms / (60 * 60 * 1000))}h`;
  }

  private mountServerSampledChart(target: HTMLElement): void {
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
    const requireControl = <T extends HTMLElement>(selector: string): T => {
      const element = root.querySelector<T>(selector);
      if (!element) throw new Error(`Missing server sampled control ${selector}`);
      return element;
    };

    const sampledChartEl = requireControl<HTMLDivElement>("[data-server-sampled-chart]");
    const liveChartEl = requireControl<HTMLDivElement>("[data-server-live-chart]");
    const sampledStatusEl = requireControl<HTMLSpanElement>("[data-server-sampled-status]");
    const liveStatusEl = requireControl<HTMLSpanElement>("[data-server-live-status]");
    const symbolSelect = requireControl<HTMLSelectElement>("[data-server-symbol]");
    const intervalSelect = requireControl<HTMLSelectElement>("[data-server-interval]");
    const reloadButton = requireControl<HTMLButtonElement>("[data-server-reload]");

    const sampledDataset = new ServerSampledDataset();
    const sampledChart = new Chart(sampledChartEl, {
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
    });
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

    const liveChart = new Chart(liveChartEl, {
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
    });
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

    const addListener = <K extends keyof HTMLElementEventMap>(element: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
      element.addEventListener(type, listener as EventListener);
      this.previewDisposers.push(() => element.removeEventListener(type, listener as EventListener));
    };

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
      sampledDataset.replaceBuckets({ xStart, xEnd, minY, maxY });
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
      liveChart.resumeXFollow();
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

  private mountRenderLoopPreview(target: HTMLElement): void {
    const demandTarget = target.querySelector<HTMLElement>("[data-render-loop-demand]");
    const continuousTarget = target.querySelector<HTMLElement>("[data-render-loop-continuous]");
    const demandCount = target.querySelector<HTMLElement>("[data-render-loop-demand-count]");
    const continuousCount = target.querySelector<HTMLElement>("[data-render-loop-continuous-count]");
    const appendButton = target.querySelector<HTMLButtonElement>("[data-render-loop-append]");
    const requestButton = target.querySelector<HTMLButtonElement>("[data-render-loop-request]");
    const panButton = target.querySelector<HTMLButtonElement>("[data-render-loop-pan]");
    if (!demandTarget || !continuousTarget || !demandCount || !continuousCount) throw new Error("Missing render-loop preview elements");

    const count = 720;
    const signal = (x: number): number => Math.sin(x * 0.035) + Math.sin(x * 0.11) * 0.22;
    const makeChart = (element: HTMLElement, label: string): { chart: Chart; series: SeriesStore } => {
      const dataset = new UniformRingBuffer(count * 2);
      for (let i = 0; i < count; i += 1) dataset.push(i, signal(i));
      const chart = new Chart(element, {
        axes: { x: { position: "outside" }, y: { position: "outside" } },
        grid: true,
        plugins: [interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true })],
        accessibility: { label },
      });
      const series = chart.addLine({ dataset, name: label }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
      chart.setViewport({ xMin: 0, xMax: count - 1, yMin: -1.4, yMax: 1.4 });
      this.previewCharts.push(chart);
      return { chart, series };
    };

    const demand = makeChart(demandTarget, "on-demand");
    const continuous = makeChart(continuousTarget, "continuous");
    let demandRenders = 0;
    let continuousRenders = 0;
    let panOffset = 0;
    let nextX = count;
    this.previewDisposers.push(demand.chart.subscribe("render", () => { demandRenders += 1; }));
    this.previewDisposers.push(continuous.chart.subscribe("render", () => { continuousRenders += 1; }));

    demand.chart.start();
    continuous.chart.start({ renderLoop: "continuous" });

    const refresh = (): void => {
      demandCount.textContent = String(demandRenders);
      continuousCount.textContent = String(continuousRenders);
    };
    const interval = window.setInterval(refresh, 100);
    this.previewDisposers.push(() => window.clearInterval(interval));

    if (appendButton) {
      const onClick = (): void => {
        demand.series.append({ y: signal(nextX++) });
      };
      appendButton.addEventListener("click", onClick);
      this.previewDisposers.push(() => appendButton.removeEventListener("click", onClick));
    }
    if (requestButton) {
      const onClick = (): void => demand.chart.requestRender();
      requestButton.addEventListener("click", onClick);
      this.previewDisposers.push(() => requestButton.removeEventListener("click", onClick));
    }
    if (panButton) {
      const onClick = (): void => {
        panOffset = (panOffset + 40) % 160;
        demand.chart.setViewport({ xMin: panOffset, xMax: panOffset + count - 1, yMin: -1.4, yMax: 1.4 });
      };
      panButton.addEventListener("click", onClick);
      this.previewDisposers.push(() => panButton.removeEventListener("click", onClick));
    }
  }

  private mountMobileChart(target: HTMLElement): void {
    const chart = new Chart(target, {
      axes: { x: { position: "outside" }, y: { position: "outside" } },
      hover: { mode: "nearest-x", group: "x" },
      plugins: [interactionsPlugin({ touchPan: true, pinchZoom: true, doubleTapReset: true }), crosshairPlugin({ mode: "crosshair", axis: "xy", snap: "nearest-x" })],
      theme: { backgroundColor: [0, 0, 0, 1], gridColor: [0.14, 0.14, 0.14, 0.65], axisColor: "#888" },
    });
    this.previewCharts.push(chart);
    const count = 420;
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      x[i] = i;
      y[i] = demoSignal(i, 0);
    }
    chart.addLine({ dataset: new StaticDataset(x, y), name: "mobile" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    chart.setViewport({ xMin: 0, xMax: count - 1, yMin: -1.35, yMax: 1.35 });
    chart.start();
  }

  private disposePreviewCharts(): void {
    for (const dispose of this.previewDisposers.splice(0)) dispose();
    for (const chart of this.previewCharts.splice(0)) chart.dispose();
    this.mountedPreviewId = null;
  }
}
