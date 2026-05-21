import { LitElement, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { Chart, OhlcRingBuffer, ServerSampledDataset, StaticDataset, UniformRingBuffer, type ChartFrameStats, type ChartPickGroup, type ChartPickMode, type ChartTheme, type SeriesStore, type ViewportPolicy } from "../../src/index.ts";
import { createLinkedCharts } from "../../src/linked.ts";
import { annotationsPlugin } from "../../src/plugins/annotations.ts";
import { crosshairPlugin } from "../../src/plugins/crosshair.ts";
import { buildFlameGraphModel, flameGraphPlugin } from "../../src/plugins/flamegraph.ts";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import { legendPlugin } from "../../src/plugins/legend.ts";
import { navigatorPlugin } from "../../src/plugins/navigator.ts";
import { tooltipPlugin } from "../../src/plugins/tooltip.ts";
import { DOC_NAV_SECTIONS, DOC_PAGES, getDocPage, type DocPage } from "./docs.ts";
import { ProceduralLineDataset } from "./ProceduralLineDataset.ts";
import { DEFAULT_APPEND_RATE, LIVE_BATCH_SIZE, MAX_VIEW_SAMPLES, OHLC_INTERVAL, SPARSE_INTERVAL, VIEW_SAMPLES, Y_VIEW, type PreviewDataBatch } from "./preview-data-config.ts";
import { renderMarkdown } from "./markdown.ts";
import overviewMarkdown from "../../docs/overview.md?raw";
import globalStyles from "./tailwind.css?inline";
import logoUrl from "./blazeplot-dark-cropped.png";
import githubSvg from "./github-mark.svg?raw";

declare const __BLAZEPLOT_VERSION__: string;

type Section = "home" | "docs" | "previews";
type HomeDataMode = "static" | "streaming";
type HomeChartMode = "line" | "ohlc" | "multi";
type PreviewId = "live" | "features" | "linked" | "server-sampled" | "flamechart" | "render-loop" | "mobile";

interface PreviewLink {
  title: string;
  id: PreviewId;
}

const PREVIEWS: readonly PreviewLink[] = [
  { title: "Live performance", id: "live" },
  { title: "Feature gallery", id: "features" },
  { title: "Linked charts", id: "linked" },
  { title: "Server-sampled", id: "server-sampled" },
  { title: "Flame chart", id: "flamechart" },
  { title: "Render loop", id: "render-loop" },
  { title: "Mobile", id: "mobile" },
] as const;

export class BlazeplotSite extends LitElement {
  static override styles = unsafeCSS(globalStyles);

  private section: Section = "home";
  private docSlug = DOC_PAGES[0]?.slug ?? "examples";
  private previewIndex = 0;
  private homeChart: Chart | null = null;
  private previewCharts: Chart[] = [];
  private previewDisposers: Array<() => void> = [];
  private previewStreamRaf = 0;
  private mountedPreviewId: PreviewId | null = null;
  private homeStreamRaf = 0;
  private homeDataMode: HomeDataMode = "streaming";
  private homeChartMode: HomeChartMode = "multi";
  private githubStars: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.syncRoute();
    this.loadGithubStars();
    window.addEventListener("hashchange", this.onHash);
    window.addEventListener("popstate", this.onPopState);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("hashchange", this.onHash);
    window.removeEventListener("popstate", this.onPopState);
    this.disposeHomeChart();
    this.disposePreviewCharts();
    super.disconnectedCallback();
  }

  override updated(): void {
    if (this.section === "home") this.mountHomeChart();
    else this.disposeHomeChart();

    if (this.section === "previews") this.mountPreviewCharts();
    else this.disposePreviewCharts();
  }

  override render(): TemplateResult {
    const doc = getDocPage(this.docSlug);
    return html`
      <div class="min-h-screen bg-black text-[#e5e5e5] font-mono text-[13px] leading-relaxed" @click=${this.handleRouteClick}>
        ${this.renderTopbar()}
        <main class="w-full ${this.section === "previews" ? "overflow-auto px-0 pb-0 pt-1.5" : "mx-auto max-w-[1180px] px-3 pb-5 pt-3 sm:px-4 sm:pb-8 sm:pt-4"}">
          ${this.section === "home" ? this.renderHome() : nothing}
          ${this.section === "docs" ? this.renderDocs(doc) : nothing}
          ${this.section === "previews" ? this.renderPreviews() : nothing}
        </main>

      </div>
    `;
  }

  /* ── Top bar ── */

  private async loadGithubStars(): Promise<void> {
    try {
      const response = await fetch("https://api.github.com/repos/Federicocervelli/blazeplot", { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) return;
      const data = await response.json() as { stargazers_count?: unknown };
      if (typeof data.stargazers_count === "number") {
        this.githubStars = data.stargazers_count;
        this.requestUpdate();
      }
    } catch {
      // Keep the top bar usable when the GitHub API is unavailable.
    }
  }

  private formatGithubStars(): string {
    if (this.githubStars === null) return "—";
    if (this.githubStars >= 1000) return `${(this.githubStars / 1000).toFixed(this.githubStars >= 10_000 ? 0 : 1)}k`;
    return String(this.githubStars);
  }

  private renderTopbar(): TemplateResult {
    return html`
      <header class="sticky top-0 z-50 flex flex-col gap-2 border-b border-[#222] bg-[#0a0a0a] px-3 py-2 select-none sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <a href=${this.appHref("home")} class="flex items-center text-[#e5e5e5] no-underline" aria-label="BlazePlot home">
          <img src=${logoUrl} alt="BlazePlot" class="block h-5 w-auto" />
        </a>
        <nav class="flex w-full items-center gap-2 overflow-x-auto pb-0.5 text-[12px] sm:w-auto sm:overflow-visible sm:pb-0">
          <a href=${this.appHref(`docs/${DOC_PAGES[0]?.slug ?? "examples"}`)} class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span class="inline-flex h-3.5 items-center leading-none" style="position: relative; top: 2px;">Docs</span>
          </a>
          <a href=${this.appHref("previews")} class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span class="inline-flex h-3.5 items-center leading-none" style="position: relative; top: 2px;">Previews</span>
          </a>
          <a href="https://github.com/Federicocervelli/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot on GitHub, ${this.formatGithubStars()} stars" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center [&_svg]:block [&_svg]:h-full [&_svg]:w-full">${unsafeHTML(githubSvg)}</span>
            <span class="inline-flex h-3.5 items-center leading-none tabular-nums" style="position: relative; top: 2px;">${this.formatGithubStars()}</span>
          </a>
          <a href="https://www.npmjs.com/package/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot on npm" class="flex shrink-0 items-center whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="block h-3.5 w-3.5 shrink-0">
              <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
            </svg>
          </a>
          <a href="https://cervelli.dev" target="_blank" rel="noreferrer" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>
            <span class="inline-flex h-3.5 items-center leading-none" style="position: relative; top: 2px;">Portfolio</span>
          </a>
        </nav>
      </header>
    `;
  }

  /* ── Home ── */

  private renderHome(): TemplateResult {
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
              <a href="https://liberapay.com/cervelli/donate" target="_blank" rel="noreferrer" aria-label="Donate to BlazePlot">
                <img src="https://img.shields.io/liberapay/patrons/cervelli.svg?logo=liberapay" alt="Liberapay patrons" class="block h-5" />
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

  /* ── Docs ── */

  private renderDocs(doc: DocPage): TemplateResult {
    return html`
      <section>
        <div class="mb-4 flex justify-between gap-4 border-b border-[#222] pb-2">
          <a href=${this.appHref("docs/docs-map")} class="text-[12px] text-[#555] no-underline hover:text-[#fc4a05]">all docs</a>
          <a href=${`https://github.com/Federicocervelli/blazeplot/blob/development/${doc.sourcePath}`} target="_blank" rel="noreferrer" class="text-[12px] text-[#555] no-underline hover:text-[#fc4a05]">source</a>
        </div>
        <div class="flex flex-col gap-5 md:flex-row md:gap-6">
          <nav class="-mx-3 flex shrink-0 gap-5 overflow-x-auto px-3 text-sm md:mx-0 md:block md:w-[200px] md:space-y-4 md:overflow-visible md:px-0">
            ${DOC_NAV_SECTIONS.map((section) => html`
              <div class="contents md:block">
                <div class="hidden px-3 pb-1 text-[11px] uppercase tracking-[0.16em] text-[#555] md:block">${section.title}</div>
                <div class="contents md:block md:space-y-0.5">
                  ${section.slugs.map((slug) => {
                    const page = DOC_PAGES.find((candidate) => candidate.slug === slug);
                    if (!page) return "";
                    return html`
                      <a
                        href=${this.appHref(`docs/${page.slug}`)}
                        class="block shrink-0 whitespace-nowrap rounded px-3 py-1.5 no-underline ${page.slug === doc.slug ? "bg-[#111] text-[#e5e5e5]" : "text-[#888] hover:bg-[#0a0a0a] hover:text-[#fc4a05]"}"
                      >${page.title}</a>
                    `;
                  })}
                </div>
              </div>
            `)}
          </nav>
          <article class="article flex-1 min-w-0">
            <p class="mb-5 mt-0 text-sm text-[#888]">${doc.description}</p>
            ${unsafeHTML(renderMarkdown(doc.markdown, { sourcePath: doc.sourcePath }))}
          </article>
        </div>
      </section>
    `;
  }

  /* ── Previews ── */

  private renderPreviews(): TemplateResult {
    const selected = PREVIEWS[this.previewIndex] ?? PREVIEWS[0]!;
    return html`
      <section class="grid h-[calc(100dvh-82px)] min-h-[640px] min-w-[760px] grid-rows-[auto_minmax(0,1fr)] sm:h-[calc(100dvh-58px)]">
        <nav class="mb-2 flex gap-5 overflow-x-auto border-b border-[#1a1a1a] text-[12px] leading-none">
          ${PREVIEWS.map(
            (p, i) => html`
              <button
                type="button"
                @click=${() => { this.selectPreview(i); }}
                class="shrink-0 whitespace-nowrap border-0 border-b px-0 pb-2 pt-0 font-mono ${i === this.previewIndex ? "border-[#fc4a05] bg-transparent text-[#e5e5e5]" : "border-transparent bg-transparent text-[#777] hover:text-[#fc4a05]"}"
              >${p.title}</button>
            `,
          )}
        </nav>
        <div class="min-h-0 min-w-0">${this.renderSelectedPreview(selected.id)}</div>
      </section>
    `;
  }

  private renderSelectedPreview(id: PreviewId): TemplateResult {
    if (id === "features") return this.renderFeaturePreview();
    if (id === "linked") return this.renderLinkedChartsPreview();
    if (id === "server-sampled") return this.renderServerSampledPreview();
    if (id === "flamechart") return this.renderFlameChartPreview();
    if (id === "render-loop") return this.renderRenderLoopPreview();
    if (id === "mobile") return this.renderMobilePreview();
    return this.renderLivePreview();
  }

  private renderPreviewPanel(_title: string, _description: string, body: TemplateResult): TemplateResult {
    return html`
      <div class="grid h-full min-h-[520px] min-w-[760px] overflow-hidden border border-[#222] bg-black">
        <div class="min-h-0 min-w-0">${body}</div>
      </div>
    `;
  }

  private renderLivePreview(): TemplateResult {
    return html`
      <section data-live-preview-root class="grid h-full min-h-[620px] min-w-[760px] grid-rows-[minmax(0,1fr)_auto] overflow-hidden border border-[#222] bg-black text-[12px]">
        <div class="relative min-h-0">
          <div data-preview-chart="live" class="h-full w-full"></div>
          <div data-live-overlay class="absolute left-0 top-0 z-40 whitespace-pre border border-[#222]/70 bg-[#0a0a0a]/90 px-2.5 py-2 text-[#e5e5e5]"><span data-live-overlay-text>BlazePlot booting...</span></div>
        </div>
        <section class="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-[#222] px-2 pb-0 pt-1 text-[#e5e5e5]" aria-label="Preview controls">
          <button data-live-perf-toggle type="button" class="border border-[#333] bg-[#111] px-2 py-1">hide stats</button>
          <button data-live-copy type="button" title="Copy stats" class="border border-[#333] bg-[#111] px-2 py-1">📋</button>
          <label class="inline-flex items-center gap-1 whitespace-nowrap">theme
            <select data-live-theme class="border border-[#333] bg-[#111] px-1.5 py-1 text-inherit"><option value="default">default</option><option value="light">light</option></select>
          </label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap">hover
            <select data-live-hover-mode class="border border-[#333] bg-[#111] px-1.5 py-1 text-inherit"><option value="nearest-x">nearest-x</option><option value="nearest-point">nearest-point</option></select>
          </label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap">group
            <select data-live-hover-group class="border border-[#333] bg-[#111] px-1.5 py-1 text-inherit"><option value="x">x</option><option value="none">none</option></select>
          </label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap">view samples
            <input data-live-view-samples type="number" min="1000" max="1000000000" step="1000000" value="86400" class="w-[12ch] border border-[#333] bg-[#111] px-1.5 py-1 text-inherit" />
          </label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap">samples/sec
            <input data-live-append-rate type="number" min="1" max="1000000" step="1000" value="1000" class="w-[9ch] border border-[#333] bg-[#111] px-1.5 py-1 text-inherit" />
          </label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap">axes
            <select data-live-axes class="border border-[#333] bg-[#111] px-1.5 py-1 text-inherit"><option value="outside">outside</option><option value="inside">inside</option><option value="off">off</option></select>
          </label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap"><input data-live-follow type="checkbox" checked class="accent-[#777]" /> follow live</label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap"><input data-live-stream type="checkbox" checked class="accent-[#777]" /> stream data</label>
          <label class="inline-flex items-center gap-1 whitespace-nowrap"><input data-live-sync-x type="checkbox" checked class="accent-[#777]" /> sync X / Y-only zoom</label>
          <button data-live-reset type="button" class="border border-[#333] bg-[#111] px-2 py-1">reset view</button>
          <button data-live-screenshot type="button" class="border border-[#333] bg-[#111] px-2 py-1">screenshot</button>
        </section>
      </section>
    `;
  }

  private renderFeaturePreview(): TemplateResult {
    return html`
      <div class="grid h-full min-h-[560px] min-w-[760px] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        ${this.renderPreviewPanel(
          "Feature gallery",
          "legend · tooltip · annotations · navigator · ruler",
          html`<div data-preview-chart="feature-hero" class="h-full min-h-[520px] w-full"></div>`,
        )}
        <div class="min-h-0">
          <pre data-feature-log class="m-0 h-full min-h-[220px] overflow-auto border border-[#222] bg-[#050505] p-3 text-[11px] leading-relaxed text-[#777]"></pre>
        </div>
      </div>
    `;
  }

  private renderLinkedChartsPreview(): TemplateResult {
    return html`
      <div class="grid h-full min-h-[560px] min-w-[760px] gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
        ${this.renderPreviewPanel("Linked charts", "shared X range · synced crosshair · log axis", html`<div data-preview-chart="feature-linked" class="h-full min-h-[520px] w-full"></div>`)}
        <div class="content-start">
          <button data-feature-reset type="button" class="w-full border border-[#222] bg-[#0a0a0a] px-3 py-2 text-left font-mono text-[12px] text-[#888] hover:border-[#fc4a05] hover:text-[#fc4a05]">reset linked views</button>
        </div>
      </div>
    `;
  }

  private renderServerSampledPreview(): TemplateResult {
    return html`
      <section data-server-sampled-root class="grid h-full min-h-[680px] min-w-[760px] grid-rows-[auto_minmax(0,0.9fr)_minmax(0,1.25fr)] overflow-hidden border border-[#1f2937] bg-[#05070d] text-[13px] text-[#e5e7eb]">
        <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#1f2937] bg-[#0b1020] px-3 py-2">
          <strong>Binance preview</strong>
          <label class="inline-flex items-center gap-1.5">symbol
            <select data-server-symbol class="border border-[#374151] bg-[#111827] px-2 py-1 text-inherit"><option>BTCUSDT</option><option>ETHUSDT</option><option>BNBUSDT</option></select>
          </label>
          <label class="inline-flex items-center gap-1.5">server interval
            <select data-server-interval class="border border-[#374151] bg-[#111827] px-2 py-1 text-inherit"><option value="15m">15m</option><option value="1h" selected>1h</option><option value="4h">4h</option><option value="1d">1d</option></select>
          </label>
          <button data-server-reload type="button" class="border border-[#374151] bg-[#111827] px-2 py-1">fetch sampled buckets</button>
          <span data-server-sampled-status class="text-[#9ca3af]">loading…</span>
          <span data-server-live-status class="text-[#9ca3af]">connecting 5s live…</span>
        </header>
        <section class="relative min-h-0 border-t border-[#111827]"><div data-server-sampled-chart class="h-full w-full"></div></section>
        <section class="relative min-h-0 border-t border-[#111827]"><div data-server-live-chart class="h-full w-full"></div></section>
        <div data-preview-chart="server-sampled" class="hidden"></div>
      </section>
    `;
  }

  private renderFlameChartPreview(): TemplateResult {
    return this.renderPreviewPanel(
      "Flame chart",
      "WebGL stack rectangles · gigantic synthetic render trace",
      html`<div data-preview-chart="flamechart" class="h-full min-h-[520px] w-full"></div>`,
    );
  }

  private renderRenderLoopPreview(): TemplateResult {
    return this.renderPreviewPanel(
      "Render loop",
      "default on-demand rendering vs explicit continuous rendering",
      html`
        <section data-preview-chart="render-loop" class="grid h-full min-h-[560px] w-full grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 text-[12px] text-[#aaa]">
          <div class="flex flex-wrap items-center gap-3 border-b border-[#222] pb-2">
            <span>Default <code>chart.start()</code> renders on demand; series appends should wake it without continuous RAF.</span>
            <button data-render-loop-append type="button" class="border border-[#333] bg-[#111] px-2 py-1 text-[#e5e5e5]">append sample</button>
            <button data-render-loop-request type="button" class="border border-[#333] bg-[#111] px-2 py-1 text-[#e5e5e5]">request on-demand render</button>
            <button data-render-loop-pan type="button" class="border border-[#333] bg-[#111] px-2 py-1 text-[#e5e5e5]">change viewport</button>
          </div>
          <div class="grid min-h-0 grid-cols-2 gap-3">
            <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-[#222]">
              <div class="border-b border-[#222] px-2 py-1">on-demand renders: <span data-render-loop-demand-count>0</span></div>
              <div data-render-loop-demand class="min-h-0"></div>
            </div>
            <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-[#222]">
              <div class="border-b border-[#222] px-2 py-1">continuous renders: <span data-render-loop-continuous-count>0</span></div>
              <div data-render-loop-continuous class="min-h-0"></div>
            </div>
          </div>
        </section>
      `,
    );
  }

  private renderMobilePreview(): TemplateResult {
    return this.renderPreviewPanel(
      "Mobile interaction",
      "touch pan · pinch zoom · full available viewport",
      html`<div data-preview-chart="mobile" class="h-full min-h-[560px] w-full"></div>`,
    );
  }

  /* ── Lit-rendered preview charts ── */

  private selectPreview(index: number): void {
    if (index === this.previewIndex) return;
    this.previewIndex = index;
    const selected = PREVIEWS[index];
    if (selected) window.history.replaceState(null, "", this.appHref(`previews/${selected.id}`));
    this.disposePreviewCharts();
    this.requestUpdate();
  }

  private mountPreviewCharts(): void {
    const selected = PREVIEWS[this.previewIndex] ?? PREVIEWS[0]!;
    if (this.mountedPreviewId === selected.id && this.previewCharts.length > 0) return;
    this.disposePreviewCharts();
    this.mountedPreviewId = selected.id;

    const targets = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-preview-chart]"));
    for (const target of targets) {
      const kind = target.dataset.previewChart;
      try {
        if (kind === "live") this.mountLivePreviewChart(target);
        else if (kind === "feature-hero") this.mountFeatureHeroChart(target);
        else if (kind === "feature-linked") this.mountFeatureLinkedCharts(target);
        else if (kind === "server-sampled") this.mountServerSampledChart(target);
        else if (kind === "flamechart") this.mountFlameChartPreview(target);
        else if (kind === "render-loop") this.mountRenderLoopPreview(target);
        else if (kind === "mobile") this.mountMobileChart(target);
      } catch {
        target.replaceChildren();
        const fallback = document.createElement("div");
        fallback.className = "grid h-full place-items-center text-[#555]";
        fallback.textContent = "WebGL2 unavailable";
        target.append(fallback);
      }
    }
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

    const dataWorker = new Worker(new URL("./preview-data-worker.ts", import.meta.url), { type: "module" });
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
    const reset = this.renderRoot.querySelector<HTMLButtonElement>("[data-feature-reset]");
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
    const reset = this.renderRoot.querySelector<HTMLButtonElement>("[data-feature-reset]");
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
    const target = this.renderRoot.querySelector<HTMLPreElement>("[data-feature-log]");
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
      y[i] = this.homeSignal(i, 0);
    }
    chart.addLine({ dataset: new StaticDataset(x, y), name: "mobile" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    chart.setViewport({ xMin: 0, xMax: count - 1, yMin: -1.35, yMax: 1.35 });
    chart.start();
  }

  private disposePreviewCharts(): void {
    if (this.previewStreamRaf !== 0) cancelAnimationFrame(this.previewStreamRaf);
    this.previewStreamRaf = 0;
    for (const dispose of this.previewDisposers.splice(0)) dispose();
    for (const chart of this.previewCharts.splice(0)) chart.dispose();
    this.mountedPreviewId = null;
  }

  /* ── Home chart ── */

  private mountHomeChart(): void {
    if (this.homeChart) return;
    const target = this.renderRoot.querySelector<HTMLElement>("[data-home-chart]");
    if (!target || target.dataset.chartError === "1") return;

    const initialCount = 420;
    let nextX = initialCount;
    let followLive = this.homeDataMode === "streaming";
    const resetViewport = (): { xMin: number; xMax: number; yMin: number; yMax: number } => {
      if (this.homeDataMode === "streaming") {
        followLive = true;
        return { xMin: nextX - initialCount, xMax: nextX - 1, yMin: -1.35, yMax: 1.35 };
      }
      return { xMin: 0, xMax: initialCount - 1, yMin: -1.35, yMax: 1.35 };
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
        camera.setViewport({ xMin: nextX - initialCount, xMax: nextX - 1, yMin: -1.35, yMax: 1.35 });
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
      target.replaceChildren();
      const fallback = document.createElement("div");
      fallback.className = "grid h-full place-items-center text-[#555]";
      fallback.textContent = "WebGL2 unavailable";
      target.append(fallback);
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
      for (let i = 0; i < count; i += 1) dataset.push(i, this.homeSignal(i, 0));
      const series = chart.addLine({ dataset, name: "line" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
      return { append: (x) => series.append({ x, y: this.homeSignal(x, 0) }) };
    }

    const x = new Float32Array(count);
    const y = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      x[i] = i;
      y[i] = this.homeSignal(i, 0);
    }
    chart.addLine({ dataset: new StaticDataset(x, y), name: "line" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    return null;
  }

  private addHomeMultiSeries(chart: Chart, count: number): { append: (x: number) => void } | null {
    const colors = [[0.988, 0.29, 0.02, 1], [0.3, 0.6, 1, 0.92], [0.2, 0.8, 0.45, 0.9]] as const;
    if (this.homeDataMode === "streaming") {
      const datasets = colors.map(() => new UniformRingBuffer(count * 2));
      for (let i = 0; i < count; i += 1) datasets.forEach((dataset, index) => dataset.push(i, this.homeSignal(i, index)));
      const series = datasets.map((dataset, index) => chart.addLine({ dataset, name: `series ${index + 1}` }, { color: colors[index]!, lineWidth: 1.5 }));
      return { append: (x) => series.forEach((item, index) => item.append({ x, y: this.homeSignal(x, index) })) };
    }

    for (let series = 0; series < colors.length; series += 1) {
      const x = new Float32Array(count);
      const y = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        x[i] = i;
        y[i] = this.homeSignal(i, series);
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
      const [open, high, low, close] = this.homeOhlcValues(x);
      series.append({ x, open, high, low, close });
    } } : null;
  }

  private pushHomeOhlc(dataset: OhlcRingBuffer, x: number): void {
    const [open, high, low, close] = this.homeOhlcValues(x);
    dataset.push(x, open, high, low, close);
  }

  private homeOhlcValues(x: number): readonly [number, number, number, number] {
    const open = this.homeSignal(x - 1, 0) * 0.75;
    const close = this.homeSignal(x, 0) * 0.75;
    const spread = 0.12 + Math.abs(Math.sin(x * 0.19)) * 0.08;
    return [open, Math.max(open, close) + spread, Math.min(open, close) - spread, close];
  }

  private homeSignal(x: number, phase: number): number {
    const t = x / 12;
    return Math.sin(t + phase * 0.8) * 0.65 + Math.sin(t * 0.33 + phase) * 0.32 + Math.cos(t * 1.8 + phase) * 0.08;
  }

  private readonly handleHomeDataModeChange = (event: Event): void => {
    this.homeDataMode = (event.currentTarget as HTMLSelectElement).value as HomeDataMode;
    this.disposeHomeChart();
    this.requestUpdate();
  };

  private readonly handleHomeChartModeChange = (event: Event): void => {
    this.homeChartMode = (event.currentTarget as HTMLSelectElement).value as HomeChartMode;
    this.disposeHomeChart();
    this.requestUpdate();
  };

  private disposeHomeChart(): void {
    if (this.homeStreamRaf !== 0) cancelAnimationFrame(this.homeStreamRaf);
    this.homeStreamRaf = 0;
    this.homeChart?.dispose();
    this.homeChart = null;
  }

  /* ── Routing ── */

  private readonly onHash = (): void => {
    const route = this.appRouteFromHash(window.location.hash);
    if (route) {
      this.navigateToAppRoute(route, { replace: true, scroll: false });
      return;
    }
    this.syncRoute();
  };

  private readonly onPopState = (): void => {
    this.syncRoute();
  };

  private readonly handleRouteClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.composedPath().find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement);
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (anchor.target && anchor.target !== "_self") return;

    const hashRoute = href.startsWith("#") ? this.appRouteFromHash(href) : null;
    if (hashRoute) {
      event.preventDefault();
      this.navigateToAppRoute(hashRoute);
      return;
    }

    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin) return;
    const route = this.appRouteFromPath(url.pathname);
    if (!route) return;

    event.preventDefault();
    this.navigateToAppRoute(route);
  };

  private navigateToAppRoute(route: string, options: { replace?: boolean; scroll?: boolean } = {}): void {
    const targetUrl = this.appHref(route === "home" ? "" : route);
    const target = new URL(targetUrl, window.location.origin);
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const targetPath = `${target.pathname}${target.search}${target.hash}`;

    if (options.scroll !== false) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (currentPath !== targetPath) {
      window.history[options.replace ? "replaceState" : "pushState"](null, "", targetPath);
    }
    this.syncRoute();
  }

  private appHref(route: string): string {
    const normalizedBase = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const normalizedRoute = route.replace(/^\/+|\/+$/gu, "");
    return normalizedRoute === "" || normalizedRoute === "home" ? normalizedBase : `${normalizedBase}${normalizedRoute}`;
  }

  private appRouteFromHash(hashHref: string): string | null {
    const hash = hashHref.replace(/^#/, "").replace(/^\/+|\/+$/gu, "");
    if (hash === "home") return "home";
    if (hash === "previews" || hash.startsWith("previews/") || hash.startsWith("docs/")) return hash;
    return null;
  }

  private appRouteFromPath(pathname: string): string | null {
    const basePath = new URL(import.meta.env.BASE_URL, window.location.origin).pathname;
    let relative = pathname;
    if (relative.startsWith(basePath)) relative = relative.slice(basePath.length);
    relative = relative.replace(/^\/+|\/+$/gu, "");

    if (relative === "") return "home";
    if (relative === "home") return "home";
    if (relative === "previews" || relative.startsWith("previews/") || relative.startsWith("docs/")) return relative;
    if (relative === "features") return "previews/features";
    if (relative === "linked") return "previews/linked";
    if (relative === "server-sampled") return "previews/server-sampled";
    if (relative === "flamechart") return "previews/flamechart";
    if (relative === "mobile") return "previews/mobile";
    return null;
  }

  private syncRoute(): void {
    const hashRoute = this.appRouteFromHash(window.location.hash);
    if (hashRoute) {
      this.navigateToAppRoute(hashRoute, { replace: true, scroll: false });
      return;
    }

    const route = this.appRouteFromPath(window.location.pathname) ?? "home";
    if (route.startsWith("docs/")) {
      const slug = route.slice(5);
      this.section = "docs";
      this.docSlug = getDocPage(slug).slug;
    } else if (route === "previews" || route.startsWith("previews/")) {
      this.section = "previews";
      const id = route.split("/")[1] as PreviewId | undefined;
      const index = id ? PREVIEWS.findIndex((preview) => preview.id === id) : 0;
      if (index >= 0) this.previewIndex = index;
    } else {
      this.section = "home";
    }
    this.requestUpdate();
  }
}

export function defineBlazeplotSite(): void {
  if (!customElements.get("blazeplot-site")) {
    customElements.define("blazeplot-site", BlazeplotSite);
  }
}
