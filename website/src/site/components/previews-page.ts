import { defineSiteDrawer } from "./site-drawer.ts";
import { LitElement, html, type TemplateResult } from "lit";
import { PreviewChartsController } from "../previews-controller.ts";
import { appHref, PREVIEW_GROUPS, PREVIEWS, REPO_URL, type PreviewId, type PreviewLink } from "../shared.ts";
import { siteStyles } from "../styles.ts";

/** Fixed stage height on large screens so demos fill the viewport without nested page scrolling. */
const STAGE_HEIGHT = "lg:h-[calc(100dvh-var(--header-h)-176px)] lg:min-h-[560px]";

export class BlazeplotPreviewsPage extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    previewId: { type: String },
    previewNavOpen: { state: true },
  };

  declare previewId: PreviewId;
  declare private previewNavOpen: boolean;

  constructor() {
    super();
    this.previewId = "live";
    this.previewNavOpen = false;
    new PreviewChartsController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("blazeplot-previews-nav-toggle", this.togglePreviewNav);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("blazeplot-previews-nav-toggle", this.togglePreviewNav);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const selected = PREVIEWS.find((preview) => preview.id === this.previewId) ?? PREVIEWS[0]!;
    return html`
      <site-drawer .open=${this.previewNavOpen} label="Demo navigation" @drawer-close=${this.closePreviewNav}>
        <div class="space-y-6">${this.renderNav(selected, true)}</div>
      </site-drawer>
      <div class="mx-auto grid max-w-[1440px] md:grid-cols-[240px_minmax(0,1fr)]">
        <aside class="hidden border-r border-line md:block">
          <nav aria-label="Demos" class="sticky top-[var(--header-h)] max-h-[calc(100dvh-var(--header-h))] space-y-6 overflow-y-auto px-4 py-8">
            ${this.renderNav(selected, false)}
          </nav>
        </aside>
        <div class="min-w-0 px-4 pb-12 pt-6 sm:px-8 md:pt-8">
          <header class="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div class="max-w-[720px]">
              <p class="eyebrow mb-2">${selected.group}</p>
              <h1 class="text-2xl font-semibold tracking-[-0.02em] text-fg">${selected.title}</h1>
              <p class="mt-2 text-sm leading-relaxed text-fg-2">${selected.description}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <a class="btn btn-sm" href=${appHref(`docs/${selected.docs}`)}>Read the guide</a>
              <a class="btn btn-sm btn-ghost" href=${`${REPO_URL}/blob/main/website/src/site/previews/${selected.source}`} target="_blank" rel="noreferrer">
                View source
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
              </a>
            </div>
          </header>
          ${this.renderSelectedPreview(selected.id)}
        </div>
      </div>
    `;
  }

  private renderNav(selected: PreviewLink, closeOnSelect: boolean): TemplateResult[] {
    return PREVIEW_GROUPS.map((group) => html`
      <div>
        <h2 class="side-heading">${group}</h2>
        <ul>
          ${PREVIEWS.filter((preview) => preview.group === group).map((preview) => html`
            <li>
              <a href=${appHref(`previews/${preview.id}`)} aria-current=${preview.id === selected.id ? "page" : "false"} class="side-link"
                @click=${closeOnSelect ? this.closePreviewNav : undefined}>${preview.title}</a>
            </li>
          `)}
        </ul>
      </div>
    `);
  }

  private renderSelectedPreview(id: PreviewId): TemplateResult {
    if (id === "sensor") return this.renderSensorStreamPreview();
    if (id === "features") return this.renderFeaturePreview();
    if (id === "histogram") return this.renderChartOnly("histogram");
    if (id === "linked") return this.renderLinkedChartsPreview();
    if (id === "server-sampled") return this.renderServerSampledPreview();
    if (id === "flamechart") return this.renderChartOnly("flamechart");
    if (id === "render-loop") return this.renderRenderLoopPreview();
    if (id === "mobile") return this.renderChartOnly("mobile");
    return this.renderLivePreview();
  }

  private renderChartOnly(chart: string): TemplateResult {
    return html`
      <div class="stage h-[520px] ${STAGE_HEIGHT}">
        <div data-preview-chart=${chart} class="h-full w-full"></div>
      </div>
    `;
  }

  private renderLivePreview(): TemplateResult {
    return html`
      <section data-live-preview-root class="stage flex min-h-[620px] flex-col ${STAGE_HEIGHT}" aria-label="Live performance demo">
        <div class="relative min-h-[300px] flex-1">
          <div data-preview-chart="live" class="h-full w-full"></div>
          <div data-live-overlay hidden class="absolute left-3 top-3 z-40 max-w-[calc(100%-24px)] overflow-x-auto whitespace-pre rounded-md border border-line bg-raised/90 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-2 backdrop-blur-sm"><span data-live-overlay-text>BlazePlot booting...</span></div>
        </div>
        <div class="stage-bar bottom" aria-label="Demo controls" role="group">
          <label class="field">View samples
            <input data-live-view-samples type="number" min="1000" max="1000000000" step="1000000" value="86400" class="input w-[12ch]" />
          </label>
          <label class="switch"><input data-live-follow type="checkbox" checked /> Follow live</label>
          <label class="switch"><input data-live-stream type="checkbox" checked /> Stream data</label>
          <button data-live-reset type="button" class="btn btn-sm">Reset view</button>
          <span class="text-fg-3 empty:hidden" role="status" data-live-action-status></span>
          <details class="disclosure w-full" data-live-advanced>
            <summary class="py-1">Advanced settings and export</summary>
            <div class="flex flex-wrap items-center gap-x-5 gap-y-3 pb-1 pt-3">
              <label class="field">Theme
                <select data-live-theme class="select"><option value="default">default</option><option value="light">light</option></select>
              </label>
              <label class="field">Hover
                <select data-live-hover-mode class="select"><option value="nearest-x">nearest-x</option><option value="nearest-point">nearest-point</option></select>
              </label>
              <label class="field">Group
                <select data-live-hover-group class="select"><option value="x">x</option><option value="none">none</option></select>
              </label>
              <label class="field">Samples/s
                <input data-live-append-rate type="number" min="1" max="1000000" step="1000" value="1000" class="input w-[10ch]" />
              </label>
              <label class="field">Axes
                <select data-live-axes class="select"><option value="outside">outside</option><option value="inside">inside</option><option value="off">off</option></select>
              </label>
              <label class="switch"><input data-live-sync-x type="checkbox" checked /> Sync X, Y-only zoom</label>
              <span class="flex flex-wrap gap-2">
                <button data-live-perf-toggle type="button" class="btn btn-sm">Hide stats</button>
                <button data-live-copy type="button" class="btn btn-sm" aria-label="Copy stats">Copy stats</button>
                <button data-live-screenshot type="button" class="btn btn-sm">Screenshot</button>
              </span>
            </div>
          </details>
        </div>
      </section>
    `;
  }

  private renderSensorStreamPreview(): TemplateResult {
    return html`
      <section class="stage flex h-[560px] flex-col ${STAGE_HEIGHT}" aria-label="Sensor stream demo">
        <div class="stage-bar top">
          <button data-sensor-live type="button" class="btn btn-sm">Resume live</button>
          <span data-sensor-status class="font-mono text-[11px] text-fg-3">booting…</span>
        </div>
        <div class="relative min-h-0 flex-1">
          <div data-preview-chart="sensor" class="h-full w-full"></div>
        </div>
      </section>
    `;
  }

  private renderFeaturePreview(): TemplateResult {
    return html`
      ${this.renderChartOnly("feature-hero")}
      <details class="disclosure mt-4">
        <summary>Interaction log</summary>
        <pre data-feature-log class="mt-3 max-h-48 overflow-auto rounded-lg border border-line bg-raised p-3 font-mono text-[11px] leading-relaxed text-fg-2"></pre>
      </details>
    `;
  }

  private renderLinkedChartsPreview(): TemplateResult {
    return html`
      <section class="stage flex h-[560px] flex-col ${STAGE_HEIGHT}" aria-label="Linked charts demo">
        <div class="stage-bar top">
          <button data-feature-reset type="button" class="btn btn-sm">Reset linked views</button>
          <span class="text-fg-3">Shared X range · lower panel uses a log scale</span>
        </div>
        <div data-preview-chart="feature-linked" class="min-h-0 flex-1"></div>
      </section>
    `;
  }

  private renderServerSampledPreview(): TemplateResult {
    return html`
      <section data-server-sampled-root class="stage grid h-[720px] min-w-0 grid-rows-[auto_minmax(0,0.9fr)_auto_minmax(0,1.25fr)] ${STAGE_HEIGHT}" aria-label="Server-sampled demo">
        <div class="stage-bar top">
          <label class="field">Symbol
            <select data-server-symbol class="select"><option>BTCUSDT</option><option>ETHUSDT</option><option>BNBUSDT</option></select>
          </label>
          <label class="field">Bucket
            <select data-server-interval class="select"><option value="15m">15m</option><option value="1h" selected>1h</option><option value="4h">4h</option><option value="1d">1d</option></select>
          </label>
          <button data-server-reload type="button" class="btn btn-sm">Fetch buckets</button>
          <span data-server-sampled-status class="font-mono text-[11px] text-fg-3">loading…</span>
        </div>
        <div class="relative min-h-0"><div data-server-sampled-chart class="h-full w-full"></div></div>
        <div class="stage-bar top border-t">
          <span class="font-medium text-fg">Live trades</span>
          <span data-server-live-status class="font-mono text-[11px] text-fg-3">connecting 5s live…</span>
        </div>
        <div class="relative min-h-0"><div data-server-live-chart class="h-full w-full"></div></div>
        <div data-preview-chart="server-sampled" class="hidden"></div>
      </section>
    `;
  }

  private renderRenderLoopPreview(): TemplateResult {
    return html`
      <section data-preview-chart="render-loop" class="stage flex h-[640px] flex-col ${STAGE_HEIGHT}" aria-label="Render loop demo">
        <div class="stage-bar top">
          <button data-render-loop-append type="button" class="btn btn-sm">Append sample</button>
          <button data-render-loop-request type="button" class="btn btn-sm">Request render</button>
          <button data-render-loop-pan type="button" class="btn btn-sm">Change viewport</button>
        </div>
        <div class="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-2">
          <div class="grid min-h-[240px] grid-rows-[auto_minmax(0,1fr)] border-line sm:border-r">
            <div class="flex items-baseline justify-between px-3 py-2 text-xs text-fg-2"><span>On demand</span><span class="font-mono text-fg-3"><span data-render-loop-demand-count class="text-fg">0</span> renders</span></div>
            <div data-render-loop-demand class="min-h-0"></div>
          </div>
          <div class="grid min-h-[240px] grid-rows-[auto_minmax(0,1fr)] border-t border-line sm:border-t-0">
            <div class="flex items-baseline justify-between px-3 py-2 text-xs text-fg-2"><span>Continuous</span><span class="font-mono text-fg-3"><span data-render-loop-continuous-count class="text-fg">0</span> renders</span></div>
            <div data-render-loop-continuous class="min-h-0"></div>
          </div>
        </div>
      </section>
    `;
  }

  private readonly togglePreviewNav = (): void => {
    this.previewNavOpen = !this.previewNavOpen;
  };

  private readonly closePreviewNav = (): void => {
    this.previewNavOpen = false;
  };
}

export function defineBlazeplotPreviewsPage(): void {
  defineSiteDrawer();
  if (!customElements.get("blazeplot-previews")) {
    customElements.define("blazeplot-previews", BlazeplotPreviewsPage);
  }
}
