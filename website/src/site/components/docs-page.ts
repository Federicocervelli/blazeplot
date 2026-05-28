import { LitElement, html, type PropertyValues, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { Chart, ServerSampledDataset, StaticDataset, StaticOhlcDataset, type ChartOptions } from "../../../../src/index.ts";
import { createLinkedCharts } from "../../../../src/linked.ts";
import { annotationsPlugin } from "../../../../src/plugins/annotations.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { legendPlugin } from "../../../../src/plugins/legend.ts";
import { tooltipPlugin } from "../../../../src/plugins/tooltip.ts";
import { DOC_NAV_SECTIONS, DOC_PAGES, type DocPage } from "../../docs.ts";
import { renderMarkdown } from "../../markdown.ts";
import { appHref } from "../shared.ts";
import { darkOutsideAxesOptions } from "../charts/options.ts";
import { demoSignal, lineData } from "../charts/signals.ts";
import { showChartFallback } from "../charts/dom.ts";
import { siteStyles } from "../styles.ts";

export class BlazeplotDocsPage extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    doc: { attribute: false },
  };

  declare doc: DocPage;
  private docCharts: Chart[] = [];

  constructor() {
    super();
    this.doc = DOC_PAGES[0]!;
  }
  private docDisposers: Array<() => void> = [];
  private mountedDocSlug: string | null = null;

  override disconnectedCallback(): void {
    this.disposeDocCharts();
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues): void {
    if (changedProperties.has("doc")) this.disposeDocCharts();
    this.mountDocCharts(this.doc);
  }

  override render(): TemplateResult {
    const doc = this.doc;
    return html`
      <section>
        <div class="mb-4 flex justify-between gap-4 border-b border-[#222] pb-2">
          <a href=${appHref("docs/docs-map")} class="text-[12px] text-[#555] no-underline hover:text-[#fc4a05]">all docs</a>
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
                        href=${appHref(`docs/${page.slug}`)}
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

  private mountDocCharts(doc: DocPage): void {
    if (this.mountedDocSlug === doc.slug && (this.docCharts.length > 0 || this.docDisposers.length > 0)) return;
    this.disposeDocCharts();
    this.mountedDocSlug = doc.slug;

    const targets = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-doc-chart]"));
    for (const target of targets) {
      target.replaceChildren();
      try {
        const kind = target.dataset.docChart;
        if (kind === "basic-line") this.mountBasicLineDocChart(target);
        else if (kind === "object-rows") this.mountObjectRowsDocChart(target);
        else if (kind === "histogram") this.mountHistogramDocChart(target);
        else if (kind === "live-line") this.mountLiveLineDocChart(target);
        else if (kind === "fixed-rate") this.mountFixedRateDocChart(target);
        else if (kind === "server-sampled") this.mountServerSampledDocChart(target);
        else if (kind === "financial") this.mountFinancialDocChart(target);
        else if (kind === "linked") this.mountLinkedDocChart(target);
        else if (kind === "plugins") this.mountPluginsDocChart(target);
        else if (kind === "annotations") this.mountAnnotationsDocChart(target);
      } catch {
        showChartFallback(target);
      }
    }
  }

  private docChartOptions(options: ChartOptions = {}): ChartOptions {
    return darkOutsideAxesOptions(options);
  }

  private createDocChart(target: HTMLElement, options: ChartOptions = {}): Chart {
    const chart = new Chart(target, this.docChartOptions(options));
    this.docCharts.push(chart);
    return chart;
  }

  private mountBasicLineDocChart(target: HTMLElement): void {
    const chart = this.createDocChart(target, { plugins: [interactionsPlugin({ doubleClickReset: true })] });
    chart.addLine({ dataset: new StaticDataset([0, 1, 2], [3, 6, 4]), name: "values" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    chart.setViewport({ xMin: -0.1, xMax: 2.1, yMin: 2.5, yMax: 6.5 });
    chart.start();
  }

  private mountObjectRowsDocChart(target: HTMLElement): void {
    const now = Date.now() - 3_000;
    const rows = [
      { time: now, requests: 120 },
      { time: now + 1_000, requests: 132 },
      { time: now + 2_000, requests: 118 },
      { time: now + 3_000, requests: 145 },
    ];
    const chart = this.createDocChart(target, { axes: { x: { position: "outside", scale: "time" }, y: { position: "outside" } }, plugins: [tooltipPlugin({ mode: "nearest-x" }), crosshairPlugin({ snap: "nearest-x", label: true })] });
    chart.addLine({ dataset: StaticDataset.fromObjects(rows, { x: "time", y: "requests", sort: true }), name: "requests" }, { color: [0.2, 0.7, 1, 1], lineWidth: 2 });
    chart.fitToData({ padding: { x: 0.02, y: 0.15 } });
    chart.start();
  }

  private mountHistogramDocChart(target: HTMLElement): void {
    const values = new Float64Array(360);
    for (let i = 0; i < values.length; i += 1) {
      const group = i % 3;
      const center = group === 0 ? 28 : group === 1 ? 48 : 66;
      values[i] = center + Math.sin(i * 0.71) * 6 + Math.cos(i * 0.17) * 3;
    }
    const chart = this.createDocChart(target, {
      axes: { x: { position: "outside", title: "Latency ms" }, y: { position: "outside", title: "Count" } },
      plugins: [interactionsPlugin({ doubleClickReset: true }), tooltipPlugin({ mode: "nearest-x" })],
    });
    chart.addHistogram({ values, binSize: 5, name: "latency" }, { color: [0.988, 0.29, 0.02, 0.75] });
    chart.fitToData({ includeZero: true, padding: { x: 0.04, y: 0.1 } });
    chart.start();
  }

  private mountLiveLineDocChart(target: HTMLElement): void {
    const chart = this.createDocChart(target, {
      axes: { x: { position: "outside", scale: "time" }, y: { position: "outside" } },
      followX: { window: 60_000, pauseOnInteraction: true, resumeAfterMs: 3000 },
      autoFitY: { padding: { y: 0.18 } },
      plugins: [interactionsPlugin({ doubleClickReset: true }), tooltipPlugin({ mode: "nearest-x" }), crosshairPlugin({ snap: "nearest-x", label: true })],
    });
    const series = chart.addLine({ capacity: 60_000, name: "live" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 1.8 });
    const start = Date.now() - 30_000;
    for (let i = 0; i < 300; i += 1) {
      const x = start + i * 100;
      series.append({ x, y: demoSignal(i, 0) + Math.random() * 0.08 });
    }
    chart.start();
    let tick = 300;
    const timer = window.setInterval(() => {
      series.append({ x: Date.now(), y: demoSignal(tick, 0) + Math.random() * 0.08 });
      tick += 1;
    }, 100);
    this.docDisposers.push(() => { clearInterval(timer); });
  }

  private mountFixedRateDocChart(target: HTMLElement): void {
    const chart = this.createDocChart(target, {
      autoFitY: { padding: { y: 0.15 } },
      plugins: [interactionsPlugin({ doubleClickReset: true }), crosshairPlugin({ snap: "nearest-x", label: true })],
    });
    const series = chart.addLine({ capacity: 1_200, xStart: 0, xStep: 16.6667, name: "signal" }, { color: [0.2, 0.85, 0.45, 1], lineWidth: 1.8 });
    const seed = new Float32Array(240);
    for (let i = 0; i < seed.length; i += 1) seed[i] = demoSignal(i, 1);
    series.append({ y: seed });
    chart.setViewport({ xMin: 0, xMax: 4_000, yMin: -1.4, yMax: 1.4 });
    chart.start();
    let tick = seed.length;
    const timer = window.setInterval(() => {
      const y = new Float32Array(3);
      for (let i = 0; i < y.length; i += 1) y[i] = demoSignal(tick + i, 1);
      tick += y.length;
      series.append({ y });
      chart.setViewport({ xMin: Math.max(0, (tick - 240) * 16.6667), xMax: tick * 16.6667, yMin: -1.4, yMax: 1.4 });
    }, 50);
    this.docDisposers.push(() => { clearInterval(timer); });
  }

  private mountServerSampledDocChart(target: HTMLElement): void {
    const count = 120;
    const xStart = new Float64Array(count);
    const xEnd = new Float64Array(count);
    const minY = new Float32Array(count);
    const maxY = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      xStart[i] = i * 10;
      xEnd[i] = i * 10 + 9;
      const center = demoSignal(i * 4, 0);
      const spread = 0.12 + Math.abs(Math.sin(i * 0.3)) * 0.22;
      minY[i] = center - spread;
      maxY[i] = center + spread;
    }
    const dataset = new ServerSampledDataset({ kind: "minmax", xStart, xEnd, minY, maxY });
    const chart = this.createDocChart(target, { plugins: [interactionsPlugin({ doubleClickReset: true })] });
    chart.addLine({ dataset, name: "server buckets", downsample: "server" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 1.4 });
    chart.fitToData({ padding: { y: 0.12 } });
    chart.start();
  }

  private mountFinancialDocChart(target: HTMLElement): void {
    const count = 48;
    const x = new Float64Array(count);
    const open = new Float32Array(count);
    const high = new Float32Array(count);
    const low = new Float32Array(count);
    const close = new Float32Array(count);
    let price = 100;
    for (let i = 0; i < count; i += 1) {
      const delta = Math.sin(i * 0.37) * 1.6 + Math.cos(i * 0.11) * 0.8;
      x[i] = i;
      open[i] = price;
      close[i] = price + delta;
      high[i] = Math.max(open[i]!, close[i]!) + 0.8 + Math.abs(Math.sin(i)) * 0.8;
      low[i] = Math.min(open[i]!, close[i]!) - 0.8 - Math.abs(Math.cos(i)) * 0.8;
      price = close[i]!;
    }
    const dataset = new StaticOhlcDataset(x, open, high, low, close);
    const chart = this.createDocChart(target, { plugins: [interactionsPlugin({ doubleClickReset: true }), tooltipPlugin({ mode: "nearest-x" })] });
    chart.addCandlestick({ dataset, name: "candles" });
    chart.fitToData({ padding: { x: 0.02, y: 0.12 } });
    chart.start();
  }

  private mountLinkedDocChart(target: HTMLElement): void {
    const linked = createLinkedCharts(target, {
      rows: 2,
      sharedX: true,
      syncCrosshair: true,
      panels: [
        { options: this.docChartOptions({ axes: { x: { position: "outside" }, y: { position: "outside" } }, grid: true }) },
        { options: this.docChartOptions({ axes: { x: { position: "outside" }, y: { position: "outside" } }, grid: true }) },
      ],
    });
    const price = lineData(180, 0);
    const volume = lineData(180, 2);
    linked.charts[0]?.addLine({ dataset: new StaticDataset(price.x, price.y), name: "price" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 1.8 });
    linked.charts[1]?.addBar({ dataset: new StaticDataset(volume.x, volume.y.map((value) => Math.abs(value) * 80 + 20)), name: "volume" }, { color: [0.2, 0.7, 1, 0.7], baseline: 0, lineWidth: 1 });
    for (const chart of linked.charts) chart.start();
    linked.setXRange(40, 140);
    this.docDisposers.push(() => { linked.dispose(); });
  }

  private mountPluginsDocChart(target: HTMLElement): void {
    const chart = this.createDocChart(target, {
      hover: { mode: "nearest-x", group: "x" },
      plugins: [interactionsPlugin({ doubleClickReset: true }), legendPlugin({ position: "top-left" }), tooltipPlugin({ mode: "nearest-x", group: "x" })],
    });
    for (let s = 0; s < 3; s += 1) {
      const data = lineData(220, s);
      const colors = [[0.988, 0.29, 0.02, 1], [0.2, 0.7, 1, 1], [0.2, 0.85, 0.45, 1]] as const;
      chart.addLine({ dataset: new StaticDataset(data.x, data.y), name: `series ${s + 1}` }, { color: colors[s]!, lineWidth: 1.5 });
    }
    chart.fitToData({ padding: { y: 0.12 } });
    chart.start();
  }

  private mountAnnotationsDocChart(target: HTMLElement): void {
    const data = lineData(180, 0);
    const chart = this.createDocChart(target, {
      plugins: [
        interactionsPlugin({ doubleClickReset: true }),
        annotationsPlugin({
          annotations: [
            { type: "x-line", x: 80, label: "event", color: "#fc4a05" },
            { type: "x-range", xMin: 112, xMax: 134, label: "deploy", fillColor: "rgba(252,74,5,0.14)", borderColor: "rgba(252,74,5,0.45)" },
            { type: "point", x: 80, y: data.y[80] ?? 0, radius: 5, color: "#fc4a05" },
          ],
        }),
      ],
    });
    chart.addLine({ dataset: new StaticDataset(data.x, data.y), name: "latency" }, { color: [0.2, 0.7, 1, 1], lineWidth: 1.8 });
    chart.fitToData({ padding: { y: 0.15 } });
    chart.start();
  }

  private disposeDocCharts(): void {
    for (const dispose of this.docDisposers.splice(0)) dispose();
    for (const chart of this.docCharts.splice(0)) chart.dispose();
    this.mountedDocSlug = null;
  }
}

export function defineBlazeplotDocsPage(): void {
  if (!customElements.get("blazeplot-docs")) {
    customElements.define("blazeplot-docs", BlazeplotDocsPage);
  }
}
