import { LitElement, html, type TemplateResult } from "lit";
import { PreviewChartsController } from "../previews-controller.ts";
import { PREVIEWS, type PreviewId } from "../shared.ts";
import { siteStyles } from "../styles.ts";

export class BlazeplotPreviewsPage extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    previewId: { type: String },
  };

  declare previewId: PreviewId;

  constructor() {
    super();
    this.previewId = "live";
    new PreviewChartsController(this);
  }

  private get previewIndex(): number {
    const index = PREVIEWS.findIndex((preview) => preview.id === this.previewId);
    return index >= 0 ? index : 0;
  }

  override render(): TemplateResult {
    return this.renderPreviews();
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
    if (id === "sensor") return this.renderSensorStreamPreview();
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

  private renderSensorStreamPreview(): TemplateResult {
    return this.renderPreviewPanel(
      "Sensor stream",
      "irregular WebSocket-style timestamps · follow-latest helper",
      html`
        <section class="grid h-full min-h-[560px] w-full grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 text-[12px] text-[#aaa]">
          <div class="flex flex-wrap items-center gap-3 border-b border-[#222] pb-2">
            <span>Dense IoT gateway stream: irregular batched timestamps, jitter, dropouts, and vibration spikes via <code>series.append({ x, y })</code>.</span>
            <button data-sensor-live type="button" class="border border-[#333] bg-[#111] px-2 py-1 text-[#e5e5e5]">resume live</button>
            <span data-sensor-status class="text-[#777]">booting…</span>
          </div>
          <div class="relative min-h-0 border border-[#222]">
            <div data-preview-chart="sensor" class="h-full min-h-0 w-full"></div>
          </div>
        </section>
      `,
    );
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
    const selected = PREVIEWS[index];
    if (!selected || selected.id === this.previewId) return;
    this.dispatchEvent(new CustomEvent<PreviewId>("preview-select", { detail: selected.id, bubbles: true, composed: true }));
  }


}

export function defineBlazeplotPreviewsPage(): void {
  if (!customElements.get("blazeplot-previews")) {
    customElements.define("blazeplot-previews", BlazeplotPreviewsPage);
  }
}
