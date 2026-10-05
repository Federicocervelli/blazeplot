import { Chart, OhlcRingBuffer, UniformRingBuffer, type ChartFrameStats, type ChartPickGroup, type ChartPickMode, type ChartTheme, type SeriesStore, type ViewportPolicy } from "../../../../src/index.ts";
import { annotationsPlugin } from "../../../../src/plugins/annotations.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { legendPlugin } from "../../../../src/plugins/legend.ts";
import { tooltipPlugin } from "../../../../src/plugins/tooltip.ts";
import { ProceduralLineDataset } from "../../ProceduralLineDataset.ts";
import { DEFAULT_APPEND_RATE, LIVE_BATCH_SIZE, MAX_VIEW_SAMPLES, OHLC_INTERVAL, SPARSE_INTERVAL, VIEW_SAMPLES, Y_VIEW, type PreviewDataBatch } from "../../preview-data-config.ts";
import { addDisposableListener, runFeedbackAction } from ".././charts/dom.ts";
import { SITE_CHART_THEME, siteChartOptions } from "../charts/options.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const liveRoot = target.closest<HTMLElement>("[data-live-preview-root]") ?? target;
    const requireControl = <T extends HTMLElement>(selector: string): T => this.requireControl<T>(liveRoot, selector);
    const overlay = requireControl<HTMLElement>("[data-live-overlay]");
    const overlayText = requireControl<HTMLSpanElement>("[data-live-overlay-text]");
    const actionStatus = requireControl<HTMLElement>("[data-live-action-status]");
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
    // oxlint-disable-next-line no-unused-vars -- frame counter is reset/incremented but not currently read
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

    const chart = new Chart(target, siteChartOptions({
      viewportPolicy: previewPolicy,
      axes: { x: { position: "outside", scale: "time", timezone: "local" }, y: { position: "outside" } },
      hover: hoverOptions,
      plugins: [
        interactionsPlugin({ axis: () => syncX ? "y" : "xy" }),
        annotations,
        legendPlugin({ toggleOnClick: true }),
        tooltipPlugin(tooltipOptions),
      ],
    }));
    this.previewCharts.push(chart);

    const dataWorker = new Worker(new URL("../../preview-data-worker.ts", import.meta.url), { type: "module" });
    this.previewDisposers.push(() => dataWorker.terminate());
    const onWorkerMessage = (event: MessageEvent<PreviewDataBatch>): void => appendGeneratedBatch(event.data);
    dataWorker.addEventListener("message", onWorkerMessage);
    this.previewDisposers.push(() => dataWorker.removeEventListener("message", onWorkerMessage));

    const addListener = <K extends keyof HTMLElementEventMap>(element: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void): void => addDisposableListener(this.previewDisposers, element, type, listener);

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
      const barDataset = new UniformRingBuffer(sparseHistoryCapacity(), { xStart: previewStartTime, xStep: SPARSE_INTERVAL * xStep });
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
      lineSeries?.append({ y: { length: batch.batchSize } });
      if (batch.sparseCount > 0 && batch.areaY && batch.spikeY && batch.barY) {
        areaSeries?.append({ y: new Float32Array(batch.areaY) });
        scatterSeries?.append({ y: new Float32Array(batch.spikeY) });
        barSeries?.append({ y: new Float32Array(batch.barY) });
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
        `engine: ${chart.renderer}${chart.rendererInfo.fallbackFrom ? ` (fell back from ${chart.rendererInfo.fallbackFrom})` : ""}`,
        `render mode: ${chartStats.renderMode}`,
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
      chart.setTheme(name === "light" ? lightTheme : SITE_CHART_THEME);
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
      try { link.click(); }
      finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    };
    const asPreviewTheme = (value: string): PreviewTheme => value === "light" ? "light" : "default";
    const asHoverMode = (value: string): ChartPickMode => value === "nearest-point" ? "nearest-point" : "nearest-x";
    const asHoverGroup = (value: string): ChartPickGroup => value === "none" ? "none" : "x";

    addListener(copyIcon, "click", () => { void runFeedbackAction(copyIcon, actionStatus, () => navigator.clipboard.writeText(overlayText.textContent?.trim() ?? ""), "Stats copied", "Could not copy stats. Check clipboard permissions and try again."); });
    addListener(themeSelect, "change", () => applyTheme(asPreviewTheme(themeSelect.value)));
    addListener(hoverModeSelect, "change", () => { const mode = asHoverMode(hoverModeSelect.value); hoverOptions.mode = mode; tooltipOptions.mode = mode; chart.setViewport({}); });
    addListener(hoverGroupSelect, "change", () => { const group = asHoverGroup(hoverGroupSelect.value); hoverOptions.group = group; tooltipOptions.group = group; chart.setViewport({}); });
    addListener(viewSamplesInput, "change", () => setViewSamples(viewSamplesInput.value));
    addListener(appendRateInput, "change", () => setAppendRate(appendRateInput.value));
    addListener(followToggle, "change", () => { followLive = followToggle.checked; });
    addListener(streamToggle, "change", () => { const nextStreaming = streamToggle.checked; if (nextStreaming === streaming) return; streaming = nextStreaming; if (streaming) syncStreamClock(); });
    addListener(syncXToggle, "change", () => { syncX = syncXToggle.checked; });
    addListener(perfToggleButton, "click", () => { showPerfPanel = !showPerfPanel; perfToggleButton.textContent = showPerfPanel ? "Hide stats" : "Show stats"; if (!showPerfPanel) overlayText.textContent = ""; });
    addListener(axesSelect, "change", () => {
      if (axesSelect.value === "off") chart.setAxes(false);
      else {
        const position = axesSelect.value === "inside" ? "inside" : "outside";
        chart.setAxes({ x: { position, scale: "time", timezone: "local" }, y: { position } });
      }
    });
    addListener(resetViewButton, "click", resetView);
    addListener(screenshotButton, "click", () => { void runFeedbackAction(screenshotButton, actionStatus, downloadScreenshot, "Screenshot download started", "Could not export the screenshot. Try again or check browser support."); });

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

}
