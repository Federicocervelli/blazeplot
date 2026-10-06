import { copyCode } from "../copy-code.ts";
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { Chart, OhlcRingBuffer, StaticDataset, UniformRingBuffer, type ViewportPolicy } from "../../../../src/index.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { tooltipPlugin } from "../../../../src/plugins/tooltip.ts";
import benchmarks from "../../../../benchmarks/latest.json";
import { renderMarkdown } from "../../markdown.ts";
import { demoOhlcValues, demoSignal, lineData } from "../charts/signals.ts";
import { showChartFallback } from "../charts/dom.ts";
import { SITE_SERIES, siteChartOptions } from "../charts/options.ts";
import { siteStyles } from "../styles.ts";
import { appHref, PREVIEWS, type HomeChartMode, type HomeDataMode } from "../shared.ts";

const QUICK_START = `\`\`\`ts
import { Chart } from "blazeplot";
import { tooltipPlugin } from "blazeplot/plugins/tooltip";

const chart = new Chart(document.getElementById("chart")!, {
  followX: { window: 60_000 },
  autoFitY: true,
  plugins: [tooltipPlugin()],
});

const cpu = chart.addLine({ capacity: 100_000, name: "cpu" });
chart.start();

socket.addEventListener("message", (event) => {
  const { time, value } = JSON.parse(event.data);
  cpu.append({ x: time, y: value });
});
\`\`\``;

const FEATURES: ReadonlyArray<{ label: string; title: string; body: string }> = [
  { label: "01", title: "Drawn on the GPU", body: "Lines, areas, bars, scatter, OHLC, and candlesticks are WebGL2 draw calls. The DOM only holds axis labels and the plugin UI you opt into." },
  { label: "02", title: "Level of detail built in", body: "Each frame reduces the visible range to min/max buckets per pixel through a segment tree, so spikes survive and a 10M-point series still pans at display refresh rate." },
  { label: "03", title: "Made for streams", body: "Fixed-capacity ring buffers, a uniform-rate shortcut for evenly spaced samples, and a follow-latest viewport that pauses while someone is inspecting history." },
  { label: "04", title: "Pay for what you import", body: "Tooltip, legend, crosshair, navigator, annotations, selection, and flamegraph ship as separate subpath entries. No runtime dependencies." },
];

interface BenchRow { readonly library: string; readonly name: string; readonly value: number }

interface BenchResult { readonly library: string; readonly ok: boolean; readonly metrics?: Record<string, { readonly median: number } | undefined> }

function benchmarkRows(scenarioName: string, metric: "fps" | "work"): BenchRow[] {
  const scenario = (benchmarks.scenarios as ReadonlyArray<{ readonly name: string; readonly results: readonly BenchResult[] }>).find((candidate) => candidate.name === scenarioName);
  if (!scenario) return [];
  const libraries = benchmarks.libraries as Record<string, { name: string; version: string }>;
  const metricId = metric === "fps" ? "rafFps" : "workP95Ms";
  return scenario.results.flatMap((result) => {
    const value = result.metrics?.[metricId]?.median;
    if (!result.ok || value === undefined) return [];
    return [{ library: result.library, name: libraries[result.library]?.name ?? result.library, value }];
  });
}

export class BlazeplotHomePage extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    homeDataMode: { state: true },
    homeChartMode: { state: true },
    followingLive: { state: true },
    chartFailed: { state: true },
  };

  declare private homeDataMode: HomeDataMode;
  declare private homeChartMode: HomeChartMode;
  private homeChart: Chart | null = null;
  declare private followingLive: boolean;
  declare private chartFailed: boolean;
  private resumeLive: (() => void) | null = null;
  private readonly quickStartHtml = renderMarkdown(QUICK_START);

  constructor() {
    super();
    this.chartFailed = false;
    this.followingLive = true;
    this.homeDataMode = "streaming";
    this.homeChartMode = "multi";
  }
  private homeStreamRaf = 0;
  private unsubscribeHomeState: (() => void) | null = null;

  override disconnectedCallback(): void {
    this.disposeHomeChart();
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues): void {
    if (changedProperties.has("homeDataMode") || changedProperties.has("homeChartMode")) {
      this.disposeHomeChart();
      this.chartFailed = false;
    }
    this.mountHomeChart();
  }

  override render(): TemplateResult {
    return html`
      ${this.renderHero()}
      ${this.renderFeatures()}
      ${this.renderQuickStart()}
      ${this.renderBenchmarks()}
      ${this.renderDemos()}
    `;
  }

  private renderHero(): TemplateResult {
    const segmented = <T extends string>(label: string, attr: string, value: T, options: ReadonlyArray<[T, string]>, onSelect: (value: T) => void): TemplateResult => html`
      <div class="segmented" role="group" aria-label=${label}>
        ${options.map(([option, text]) => html`<button type="button" data-home-option=${`${attr}:${option}`} aria-pressed=${value === option ? "true" : "false"} @click=${() => onSelect(option)}>${text}</button>`)}
      </div>`;
    return html`
      <section class="relative overflow-hidden">
        <div class="pointer-events-none absolute inset-0 opacity-[0.55] [background-image:linear-gradient(to_right,var(--color-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-line)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden="true"></div>
        <div class="relative mx-auto grid max-w-[1200px] gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14 lg:pb-24 lg:pt-20">
          <div>
            <h1 class="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-fg sm:text-[52px]">Charts for data that<br class="hidden sm:block" /> doesn’t fit on screen.</h1>
            <p class="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-fg-2">BlazePlot renders on the GPU, reduces millions of samples to what each pixel can show, and keeps the DOM out of the render loop. Built for dense history and live feeds.</p>
            <div class="mt-8 flex flex-wrap items-center gap-3">
              <a class="btn btn-primary btn-lg" href=${appHref("docs/overview")}>Get started</a>
              <a class="btn btn-lg" href=${appHref("previews")}>Browse demos</a>
            </div>
            <div class="code-block home-install-code mt-8 max-w-[22rem]" @click=${copyCode}>
              <div class="flex items-center">
                <pre class="flex-1 py-2.5!"><span class="select-none text-fg-3">$ </span><code>npm install blazeplot</code></pre>
                <button type="button" class="home-copy-button icon-btn mr-1" data-copy-code data-copy-state="ready" aria-label="Copy install command" title="Copy command">
                  <svg data-copy-icon width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>
                  <svg data-copied-icon width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="m5 12 4 4L19 6" /></svg>
                  <svg data-copy-failed-icon width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="M12 9v4m0 4h.01M10.3 3.9 1.9 18.5a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
                </button>
              </div>
              <span class="sr-only" role="status" aria-live="polite"></span>
            </div>
            <div class="home-badges mt-5 flex flex-wrap items-center gap-2" data-home-badges>
              <a href="https://www.npmjs.com/package/blazeplot" target="_blank" rel="noreferrer noopener"><img src="https://img.shields.io/npm/dm/blazeplot?style=flat-square&label=npm%20downloads&color=cb3837&logo=npm" alt="npm downloads per month" height="20" class="block h-5 w-auto" /></a>
              <a href="https://github.com/sponsors/Federicocervelli" target="_blank" rel="noreferrer noopener"><img src="https://img.shields.io/badge/sponsor-GitHub%20Sponsors-ea4aaa?style=flat-square&logo=githubsponsors" alt="Sponsor BlazePlot on GitHub Sponsors" height="20" class="block h-5 w-auto" /></a>
            </div>
          </div>
          <div class="stage min-w-0 shadow-[0_24px_80px_-32px_rgb(0_0_0/0.9)]">
            <div class="stage-bar top justify-between">
              ${segmented<HomeChartMode>("Chart type", "mode", this.homeChartMode, [["multi", "Multi"], ["line", "Line"], ["ohlc", "OHLC"]], (mode) => { this.homeChartMode = mode; })}
              <div class="flex items-center gap-2">
                ${this.homeDataMode === "streaming" && !this.chartFailed && !this.followingLive
                  ? html`<button type="button" class="btn btn-sm" data-home-resume @click=${() => this.resumeLive?.()}>Resume live</button>`
                  : nothing}
                ${segmented<HomeDataMode>("Data source", "data", this.homeDataMode, [["streaming", "Live"], ["static", "Static"]], (mode) => { this.homeDataMode = mode; })}
              </div>
            </div>
            <div data-home-chart class="h-[280px] w-full sm:h-[340px] lg:h-[380px]"></div>
          </div>
        </div>
      </section>
    `;
  }

  private renderFeatures(): TemplateResult {
    return html`
      <section aria-labelledby="features-title">
        <div class="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <h2 id="features-title" class="sr-only">What BlazePlot does</h2>
          <div class="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            ${FEATURES.map((feature) => html`
              <div class="bg-bg p-6">
                <p class="font-mono text-xs text-flame">${feature.label}</p>
                <h3 class="mt-3 text-base font-semibold text-fg">${feature.title}</h3>
                <p class="mt-2 text-sm leading-relaxed text-fg-2">${feature.body}</p>
              </div>
            `)}
          </div>
        </div>
      </section>
    `;
  }

  private renderQuickStart(): TemplateResult {
    return html`
      <section>
        <div class="mx-auto grid max-w-[1200px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:gap-16">
          <div>
            <p class="eyebrow mb-3">Quick start</p>
            <h2 class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg">A live chart in a dozen lines.</h2>
            <p class="mt-4 text-fg-2">Give it a sized element, add a series, and append samples as they arrive. The viewport follows the newest minute and Y fits whatever is visible.</p>
            <ul class="mt-6 space-y-3 text-sm text-fg-2">
              <li class="flex gap-3"><span class="mt-[9px] h-px w-3 shrink-0 bg-flame"></span><span>Typed helpers for every series kind: <code class="font-mono text-[13px] text-fg">addLine</code>, <code class="font-mono text-[13px] text-fg">addArea</code>, <code class="font-mono text-[13px] text-fg">addBar</code>, <code class="font-mono text-[13px] text-fg">addCandlestick</code>…</span></li>
              <li class="flex gap-3"><span class="mt-[9px] h-px w-3 shrink-0 bg-flame"></span><span>Datasets accept typed arrays, plain arrays, or object rows.</span></li>
              <li class="flex gap-3"><span class="mt-[9px] h-px w-3 shrink-0 bg-flame"></span><span>Call <code class="font-mono text-[13px] text-fg">chart.dispose()</code> when the element goes away.</span></li>
            </ul>
            <div class="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <a class="link" href=${appHref("docs/overview")}>Read the overview</a>
              <a class="link" href=${appHref("docs/examples")}>More examples</a>
            </div>
          </div>
          <div class="article min-w-0 [&_.code-block]:my-0" @click=${copyCode}>${unsafeHTML(this.quickStartHtml)}</div>
        </div>
      </section>
    `;
  }

  private renderBenchmarks(): TemplateResult {
    const fps = benchmarkRows("line-10m-accelerated-pan", "fps");
    const work = benchmarkRows("line-1m-stream", "work");
    if (fps.length === 0 || work.length === 0) return html``;
    const version = (benchmarks.libraries as Record<string, { version: string }>).blazeplot?.version ?? "";
    const date = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(benchmarks.generatedAt));
    const bars = (rows: readonly BenchRow[], unit: string, higherIsBetter: boolean): TemplateResult => {
      const max = Math.max(...rows.map((row) => row.value));
      const best = higherIsBetter ? Math.max(...rows.map((row) => row.value)) : Math.min(...rows.map((row) => row.value));
      return html`<dl class="space-y-3">${rows.map((row) => html`
        <div class="grid grid-cols-[84px_minmax(0,1fr)_76px] items-center gap-3 text-sm">
          <dt class=${row.library === "blazeplot" ? "font-medium text-fg" : "text-fg-2"}>${row.name}</dt>
          <div class="h-2 rounded-full bg-surface" aria-hidden="true"><div class="h-2 rounded-full ${row.library === "blazeplot" ? "bg-flame" : "bg-line-strong"}" style=${`width:${Math.max(2, (row.value / max) * 100)}%`}></div></div>
          <dd class="whitespace-nowrap text-right font-mono text-xs ${row.value === best ? "text-fg" : "text-fg-3"}">${row.value.toFixed(1)} ${unit}</dd>
        </div>`)}</dl>`;
    };
    return html`
      <section aria-labelledby="bench-title">
        <div class="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p class="eyebrow mb-3">Benchmarks</p>
              <h2 id="bench-title" class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg">Measured, not claimed.</h2>
            </div>
            <a class="link text-sm" href=${appHref("docs/benchmarks")}>Full results and method</a>
          </div>
          <div class="mt-10 grid gap-6 md:grid-cols-2">
            <figure class="rounded-xl border border-line bg-raised p-6">
              <figcaption class="mb-5"><span class="block font-medium text-fg">Panning a 10M-point line</span><span class="text-sm text-fg-3">Frames per second, higher is better</span></figcaption>
              ${bars(fps, "fps", true)}
            </figure>
            <figure class="rounded-xl border border-line bg-raised p-6">
              <figcaption class="mb-5"><span class="block font-medium text-fg">Streaming into a 1M-point line</span><span class="text-sm text-fg-3">Per-frame work p95 in ms, lower is better</span></figcaption>
              ${bars(work, "ms", false)}
            </figure>
          </div>
          <p class="mt-5 text-xs text-fg-3">Headed Chrome, ${benchmarks.environment.machine.cpuModel}, ${date}. BlazePlot ${version}. Reproduce with <code class="font-mono">bun run bench:compare</code>.</p>
        </div>
      </section>
    `;
  }

  private renderDemos(): TemplateResult {
    return html`
      <section aria-labelledby="demos-title">
        <div class="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p class="eyebrow mb-3">Demos</p>
              <h2 id="demos-title" class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg">See it run in your browser.</h2>
            </div>
            <a class="link text-sm" href=${appHref("previews")}>All demos</a>
          </div>
          <ul class="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            ${PREVIEWS.map((preview) => html`
              <li class="bg-bg">
                <a href=${appHref(`previews/${preview.id}`)} class="group flex h-full flex-col gap-2 p-5 hover:bg-raised">
                  <span class="flex items-center justify-between">
                    <span class="font-medium text-fg">${preview.title}</span>
                    <span class="font-mono text-[11px] text-fg-3">${preview.group}</span>
                  </span>
                  <span class="line-clamp-2 text-sm text-fg-2">${preview.description}</span>
                </a>
              </li>
            `)}
          </ul>
        </div>
      </section>
    `;
  }

  private mountHomeChart(): void {
    if (this.homeChart || this.chartFailed) return;
    const target = this.renderRoot.querySelector<HTMLElement>("[data-home-chart]");
    if (!target) return;

    const initialCount = 420;
    let nextX = initialCount;
    this.followingLive = this.homeDataMode === "streaming";
    const homeViewport = (xMin: number, xMax: number): { xMin: number; xMax: number; yMin: number; yMax: number } => {
      const yRange = this.homeChartMode === "ohlc" ? this.homeOhlcYRange(xMin, xMax) : { yMin: -1.35, yMax: 1.35 };
      return { xMin, xMax, ...yRange };
    };
    const resetViewport = (): { xMin: number; xMax: number; yMin: number; yMax: number } => {
      if (this.homeDataMode === "streaming") {
        return homeViewport(nextX - initialCount, nextX - 1);
      }
      return homeViewport(0, initialCount - 1);
    };
    const viewportPolicy: ViewportPolicy = {
      beforeRender: (camera) => {
        if (this.homeChart?.getFollowXState() !== "following") return;
        const { yMin, yMax } = homeViewport(nextX - initialCount, nextX - 1);
        camera.setViewport({ yMin, yMax });
      },
    };

    try {
      const chart = new Chart(target, siteChartOptions({
        viewportPolicy,
        axes: { x: { position: "outside" }, y: { position: "outside" } },
        hover: { mode: "nearest-x", group: "x" },
        plugins: [
          interactionsPlugin({
            // Wheel and trackpad scrolling stay with the page on the landing hero.
            wheelZoom: false,
            trackpadPan: false,
            shiftDragPan: true,
            boxZoom: true,
            doubleClickReset: true,
            pinchZoom: true,
            doubleTapReset: true,
            resetViewport,
          }),
          ...(this.homeChartMode === "multi"
            ? [tooltipPlugin({ mode: "nearest-x", group: "x" })]
            : [crosshairPlugin({ mode: "crosshair", axis: "xy", snap: "nearest-x" })]),
        ],
      }));

      this.homeChart = chart;
      const stream = this.addHomeSeries(chart, initialCount);
      chart.setViewport(resetViewport());
      if (stream) chart.followX({ window: initialCount - 1, pauseOnInteraction: true });
      this.unsubscribeHomeState = chart.subscribe("render", () => { this.followingLive = chart.getFollowXState() === "following"; });
      chart.start();
      this.resumeLive = () => {
        chart.setViewport(resetViewport());
        chart.setFollowXPaused(false);
      };

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
    } catch (error) {
      this.disposeHomeChart();
      this.chartFailed = true;
      showChartFallback(target, error);
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
      const series = chart.addLine({ dataset, name: "signal" }, { color: SITE_SERIES.flame, lineWidth: 2 });
      return { append: (x) => series.append({ x, y: demoSignal(x, 0) }) };
    }

    const { x, y } = lineData(count);
    chart.addLine({ dataset: new StaticDataset(x, y), name: "signal" }, { color: SITE_SERIES.flame, lineWidth: 2 });
    return null;
  }

  private addHomeMultiSeries(chart: Chart, count: number): { append: (x: number) => void } | null {
    const colors = [SITE_SERIES.flame, SITE_SERIES.sky, SITE_SERIES.mint] as const;
    if (this.homeDataMode === "streaming") {
      const datasets = colors.map(() => new UniformRingBuffer(count * 2));
      for (let i = 0; i < count; i += 1) datasets.forEach((dataset, index) => dataset.push(i, demoSignal(i, index)));
      const series = datasets.map((dataset, index) => chart.addLine({ dataset, name: `series ${index + 1}` }, { color: colors[index]!, lineWidth: 1.5 }));
      return { append: (x) => series.forEach((item, index) => item.append({ x, y: demoSignal(x, index) })) };
    }

    for (let series = 0; series < colors.length; series += 1) {
      const { x, y } = lineData(count, series);
      chart.addLine({ dataset: new StaticDataset(x, y), name: `series ${series + 1}` }, { color: colors[series]!, lineWidth: 1.5 });
    }
    return null;
  }

  private addHomeOhlcSeries(chart: Chart, count: number): { append: (x: number) => void } | null {
    const dataset = new OhlcRingBuffer(this.homeDataMode === "streaming" ? count * 2 : count);
    for (let i = 0; i < count; i += 1) this.pushHomeOhlc(dataset, i);
    const series = chart.addOhlc(
      { dataset, name: "ohlc" },
      { color: [0.78, 0.76, 0.72, 1], upColor: SITE_SERIES.mint, downColor: SITE_SERIES.flame, wickColor: [0.6, 0.57, 0.54, 1], tickWidth: 0.7 },
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

  private disposeHomeChart(): void {
    if (this.homeStreamRaf !== 0) cancelAnimationFrame(this.homeStreamRaf);
    this.homeStreamRaf = 0;
    this.unsubscribeHomeState?.();
    this.unsubscribeHomeState = null;
    this.homeChart?.dispose();
    this.homeChart = null;
    this.resumeLive = null;
  }
}

export function defineBlazeplotHomePage(): void {
  if (!customElements.get("blazeplot-home")) {
    customElements.define("blazeplot-home", BlazeplotHomePage);
  }
}
