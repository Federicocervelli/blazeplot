import { LitElement, html, type PropertyValues, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { Chart, OhlcRingBuffer, StaticDataset, UniformRingBuffer, type ViewportPolicy } from "../../../../src/index.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { tooltipPlugin } from "../../../../src/plugins/tooltip.ts";
import { renderMarkdown } from "../../markdown.ts";
import overviewMarkdown from "../../../../docs/overview.md?raw";
import logoUrl from "../../blazeplot-dark-cropped.png";
import { demoOhlcValues, demoSignal } from "../charts/signals.ts";
import { showChartFallback } from "../charts/dom.ts";
import { siteStyles } from "../styles.ts";
import type { HomeChartMode, HomeDataMode } from "../shared.ts";

declare const __BLAZEPLOT_VERSION__: string;

export class BlazeplotHomePage extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    homeDataMode: { state: true },
    homeChartMode: { state: true },
  };

  declare private homeDataMode: HomeDataMode;
  declare private homeChartMode: HomeChartMode;
  private homeChart: Chart | null = null;

  constructor() {
    super();
    this.homeDataMode = "streaming";
    this.homeChartMode = "multi";
  }
  private homeStreamRaf = 0;

  override disconnectedCallback(): void {
    this.disposeHomeChart();
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues): void {
    if (changedProperties.has("homeDataMode") || changedProperties.has("homeChartMode")) this.disposeHomeChart();
    this.mountHomeChart();
  }

  override render(): TemplateResult {
    return html`
      <section class="grid gap-5 py-6 sm:gap-6 sm:py-10 md:grid-cols-[300px_minmax(0,1fr)] md:items-stretch">
        <div class="flex flex-col justify-between border-y border-[#222] py-4 sm:py-5 md:min-h-[360px]">
          <div>
            <h1 class="mb-4 flex items-center gap-3">
              <img src=${logoUrl} alt="BlazePlot" class="block h-8 w-auto" />
              <span class="mt-[7px] inline-flex h-8 items-center rounded border border-[#333] bg-[#0a0a0a] px-2.5 text-sm font-normal leading-none text-[#aaa]">v${__BLAZEPLOT_VERSION__}</span>
            </h1>
            <div class="mt-4 flex max-w-[34ch] flex-wrap gap-2">
              <a href="https://github.com/Federicocervelli/blazeplot/blob/development/LICENSE" target="_blank" rel="noreferrer" aria-label="BlazePlot license">
                <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license MIT" class="block h-5" />
              </a>
              <a href="https://www.npmjs.com/package/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot npm downloads">
                <img src="https://img.shields.io/npm/dt/blazeplot.svg" alt="npm downloads" class="block h-5" />
              </a>
              <a href="https://github.com/sponsors/Federicocervelli" target="_blank" rel="noreferrer" aria-label="Sponsor BlazePlot on GitHub">
                <img src="https://img.shields.io/badge/sponsor-GitHub%20Sponsors-EA4AAA?logo=githubsponsors" alt="GitHub Sponsors" class="block h-5" />
              </a>
            </div>
          </div>
          <div class="mt-6 grid grid-cols-[80px_140px] items-center gap-x-4 gap-y-3 text-[12px] sm:mt-8">
            <label for="homeDataMode" class="text-[#555]">data</label>
            <select
              id="homeDataMode"
              class="h-7 w-[140px] rounded border border-[#333] bg-[#0a0a0a] px-2 font-mono text-[12px] text-[#e5e5e5] outline-none hover:border-[#fc4a05]"
              @change=${this.handleHomeDataModeChange}
            >
              <option value="static" ?selected=${this.homeDataMode === "static"}>static</option>
              <option value="streaming" ?selected=${this.homeDataMode === "streaming"}>streaming</option>
            </select>
            <label for="homeChartMode" class="text-[#555]">mode</label>
            <select
              id="homeChartMode"
              class="h-7 w-[140px] rounded border border-[#333] bg-[#0a0a0a] px-2 font-mono text-[12px] text-[#e5e5e5] outline-none hover:border-[#fc4a05]"
              @change=${this.handleHomeChartModeChange}
            >
              <option value="line" ?selected=${this.homeChartMode === "line"}>line</option>
              <option value="ohlc" ?selected=${this.homeChartMode === "ohlc"}>ohlc</option>
              <option value="multi" ?selected=${this.homeChartMode === "multi"}>multi</option>
            </select>
          </div>
        </div>
        <div class="min-w-0 overflow-hidden rounded border border-[#222] bg-black">
          <div data-home-chart class="h-[260px] w-full sm:h-[320px] md:h-[360px]"></div>
        </div>
      </section>
      <article class="article border-t border-[#222] pt-8">${unsafeHTML(renderMarkdown(overviewMarkdown, { sourcePath: "docs/overview.md" }))}</article>
    `;
  }

  private mountHomeChart(): void {
    if (this.homeChart) return;
    const target = this.renderRoot.querySelector<HTMLElement>("[data-home-chart]");
    if (!target || target.dataset.chartError === "1") return;

    const initialCount = 420;
    let nextX = initialCount;
    let followLive = this.homeDataMode === "streaming";
    const homeViewport = (xMin: number, xMax: number): { xMin: number; xMax: number; yMin: number; yMax: number } => {
      const yRange = this.homeChartMode === "ohlc" ? this.homeOhlcYRange(xMin, xMax) : { yMin: -1.35, yMax: 1.35 };
      return { xMin, xMax, ...yRange };
    };
    const resetViewport = (): { xMin: number; xMax: number; yMin: number; yMax: number } => {
      if (this.homeDataMode === "streaming") {
        followLive = true;
        return homeViewport(nextX - initialCount, nextX - 1);
      }
      return homeViewport(0, initialCount - 1);
    };
    const viewportPolicy: ViewportPolicy = {
      beforePan(_camera, intent) {
        followLive = false;
        return intent;
      },
      beforeZoom(_camera, intent) {
        followLive = false;
        return intent;
      },
      beforeRender: (camera) => {
        if (this.homeDataMode !== "streaming" || !followLive) return;
        camera.setViewport(homeViewport(nextX - initialCount, nextX - 1));
      },
    };

    try {
      const chart = new Chart(target, {
        viewportPolicy,
        axes: { x: { position: "outside" }, y: { position: "outside" } },
        hover: { mode: "nearest-x", group: "x" },
        plugins: [
          interactionsPlugin({
            wheelZoom: true,
            shiftDragPan: true,
            boxZoom: true,
            doubleClickReset: true,
            resetViewport,
            viewportPolicy,
          }),
          ...(this.homeChartMode === "multi"
            ? [tooltipPlugin({ mode: "nearest-x", group: "x" })]
            : [crosshairPlugin({ mode: "crosshair", axis: "xy", snap: "nearest-x" })]),
        ],
        theme: {
          backgroundColor: [0, 0, 0, 1],
          gridColor: [0.14, 0.14, 0.14, 0.65],
          axisColor: "#888",
          axisFont: "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        },
      });

      const stream = this.addHomeSeries(chart, initialCount);
      chart.setViewport(resetViewport());
      chart.start();
      this.homeChart = chart;

      if (stream) {
        const pointsPerSecond = 180;
        let carry = 0;
        let lastFrame = performance.now();
        const frame = (now: number): void => {
          const elapsed = Math.min(80, now - lastFrame);
          lastFrame = now;
          carry += (elapsed / 1000) * pointsPerSecond;
          const points = Math.floor(carry);
          carry -= points;
          for (let i = 0; i < points; i += 1) stream.append(nextX++);
          this.homeStreamRaf = requestAnimationFrame(frame);
        };
        this.homeStreamRaf = requestAnimationFrame(frame);
      }
    } catch {
      target.dataset.chartError = "1";
      showChartFallback(target);
    }
  }

  private addHomeSeries(chart: Chart, count: number): { append: (x: number) => void } | null {
    if (this.homeChartMode === "ohlc") return this.addHomeOhlcSeries(chart, count);
    if (this.homeChartMode === "multi") return this.addHomeMultiSeries(chart, count);
    return this.addHomeLineSeries(chart, count);
  }

  private addHomeLineSeries(chart: Chart, count: number): { append: (x: number) => void } | null {
    if (this.homeDataMode === "streaming") {
      const dataset = new UniformRingBuffer(count * 2);
      for (let i = 0; i < count; i += 1) dataset.push(i, demoSignal(i, 0));
      const series = chart.addLine({ dataset, name: "line" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
      return { append: (x) => series.append({ x, y: demoSignal(x, 0) }) };
    }

    const x = new Float32Array(count);
    const y = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      x[i] = i;
      y[i] = demoSignal(i, 0);
    }
    chart.addLine({ dataset: new StaticDataset(x, y), name: "line" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    return null;
  }

  private addHomeMultiSeries(chart: Chart, count: number): { append: (x: number) => void } | null {
    const colors = [[0.988, 0.29, 0.02, 1], [0.3, 0.6, 1, 0.92], [0.2, 0.8, 0.45, 0.9]] as const;
    if (this.homeDataMode === "streaming") {
      const datasets = colors.map(() => new UniformRingBuffer(count * 2));
      for (let i = 0; i < count; i += 1) datasets.forEach((dataset, index) => dataset.push(i, demoSignal(i, index)));
      const series = datasets.map((dataset, index) => chart.addLine({ dataset, name: `series ${index + 1}` }, { color: colors[index]!, lineWidth: 1.5 }));
      return { append: (x) => series.forEach((item, index) => item.append({ x, y: demoSignal(x, index) })) };
    }

    for (let series = 0; series < colors.length; series += 1) {
      const x = new Float32Array(count);
      const y = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        x[i] = i;
        y[i] = demoSignal(i, series);
      }
      chart.addLine({ dataset: new StaticDataset(x, y), name: `series ${series + 1}` }, { color: colors[series]!, lineWidth: 1.5 });
    }
    return null;
  }

  private addHomeOhlcSeries(chart: Chart, count: number): { append: (x: number) => void } | null {
    const dataset = new OhlcRingBuffer(this.homeDataMode === "streaming" ? count * 2 : count);
    for (let i = 0; i < count; i += 1) this.pushHomeOhlc(dataset, i);
    const series = chart.addOhlc(
      { dataset, name: "ohlc" },
      { color: [0.78, 0.82, 0.9, 1], upColor: [0.2, 0.8, 0.45, 1], downColor: [0.988, 0.29, 0.02, 1], wickColor: [0.72, 0.76, 0.84, 1], tickWidth: 0.7 },
    );
    return this.homeDataMode === "streaming" ? { append: (x) => {
      const [open, high, low, close] = demoOhlcValues(x);
      series.append({ x, open, high, low, close });
    } } : null;
  }

  private pushHomeOhlc(dataset: OhlcRingBuffer, x: number): void {
    const [open, high, low, close] = demoOhlcValues(x);
    dataset.push(x, open, high, low, close);
  }

  private homeOhlcYRange(xMin: number, xMax: number): { yMin: number; yMax: number } {
    const start = Math.max(0, Math.floor(xMin));
    const end = Math.max(start + 1, Math.ceil(xMax));
    let min = Infinity;
    let max = -Infinity;
    for (let x = start; x <= end; x += 1) {
      const [, high, low] = demoOhlcValues(x);
      min = Math.min(min, low);
      max = Math.max(max, high);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { yMin: -1.35, yMax: 1.35 };
    const padding = Math.max(1, (max - min) * 0.12);
    return { yMin: min - padding, yMax: max + padding };
  }

  private readonly handleHomeDataModeChange = (event: Event): void => {
    this.homeDataMode = (event.currentTarget as HTMLSelectElement).value as HomeDataMode;
  };

  private readonly handleHomeChartModeChange = (event: Event): void => {
    this.homeChartMode = (event.currentTarget as HTMLSelectElement).value as HomeChartMode;
  };

  private disposeHomeChart(): void {
    if (this.homeStreamRaf !== 0) cancelAnimationFrame(this.homeStreamRaf);
    this.homeStreamRaf = 0;
    this.homeChart?.dispose();
    this.homeChart = null;
  }
}

export function defineBlazeplotHomePage(): void {
  if (!customElements.get("blazeplot-home")) {
    customElements.define("blazeplot-home", BlazeplotHomePage);
  }
}
