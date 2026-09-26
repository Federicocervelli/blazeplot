import "./site-drawer.ts";
import { copyCode } from "../copy-code.ts";
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
    docsNavOpen: { state: true },
  };

  declare doc: DocPage;
  declare private docsNavOpen: boolean;
  private docCharts: Chart[] = [];

  constructor() {
    super();
    this.doc = DOC_PAGES[0]!;
    this.docsNavOpen = false;
  }
  private docDisposers: Array<() => void> = [];
  private mountedDocSlug: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("blazeplot-docs-nav-toggle", this.toggleDocsNav);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("blazeplot-docs-nav-toggle", this.toggleDocsNav);
    this.disposeDocCharts();
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues): void {
    if (changedProperties.has("doc")) {
      this.docsNavOpen = false;
      this.disposeDocCharts();
    }
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
        <p class="mb-5 mt-0 text-sm text-[#888]">${doc.description}</p>
        <site-drawer .open=${this.docsNavOpen} label="Docs navigation" @drawer-close=${this.closeDocsNav}>
          <div class="space-y-4">${this.renderDocsNav(doc, true)}</div>
        </site-drawer>
        <div class="flex flex-col gap-5 md:flex-row md:gap-6">
          <nav class="hidden shrink-0 pt-0 text-sm md:sticky md:top-[72px] md:block md:h-fit md:w-[200px] md:self-start md:space-y-4 md:overflow-visible md:px-0 md:pt-0">
            ${this.renderDocsNav(doc, false)}
          </nav>
          <article class="article flex-1 min-w-0 pt-0 md:pt-0" @click=${copyCode}>
            ${unsafeHTML(renderMarkdown(doc.markdown, { sourcePath: doc.sourcePath, tableOfContents: true }))}
          </article>
        </div>
      </section>
    `;
  }

  private renderDocsNav(doc: DocPage, closeOnSelect: boolean): TemplateResult[] {
    return DOC_NAV_SECTIONS.map((section) => html`
      <div class="block">
        <div class="px-3 pb-1 text-[11px] uppercase tracking-[0.16em] text-[#555]">${section.title}</div>
        <div class="space-y-0.5">
          ${section.slugs.map((slug) => {
            const page = DOC_PAGES.find((candidate) => candidate.slug === slug);
            if (!page) return "";
            return html`
              <a
                href=${appHref(`docs/${page.slug}`)}
                aria-current=${page.slug === doc.slug ? "page" : "false"}
                class="block rounded px-3 py-1.5 no-underline ${page.slug === doc.slug ? "bg-[#111] text-[#e5e5e5]" : "text-[#888] hover:bg-[#0a0a0a] hover:text-[#fc4a05]"}"
                @click=${closeOnSelect ? this.closeDocsNav : undefined}
              >${page.title}</a>
            `;
          })}
        </div>
      </div>
    `);
  }

  private readonly toggleDocsNav = (): void => {
    this.docsNavOpen = !this.docsNavOpen;
  };

  private readonly closeDocsNav = (): void => {
    this.docsNavOpen = false;
  };

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
    const count = 180;
    const barMs = 4 * 60 * 60 * 1000;
    const start = Date.UTC(2026, 0, 5);
    const x = new Float64Array(count);
    const open = new Float32Array(count);
    const high = new Float32Array(count);
    const low = new Float32Array(count);
    const close = new Float32Array(count);
    const volume = new Float32Array(count);
    let price = 184.2;
    for (let i = 0; i < count; i += 1) {
      const drift = Math.sin(i * 0.043) * 0.85 + Math.cos(i * 0.137) * 0.38 + (i > 112 ? 0.18 : 0.03);
      const body = Math.sin(i * 0.61) * 1.25 + Math.sin(i * 0.17) * 0.85 + drift;
      const volatility = 1.8 + Math.abs(Math.sin(i * 0.23)) * 2.8 + (i === 88 || i === 142 ? 6 : 0);
      x[i] = start + i * barMs;
      open[i] = price;
      close[i] = price + body;
      high[i] = Math.max(open[i]!, close[i]!) + volatility * (0.45 + Math.abs(Math.sin(i * 0.61)) * 0.35);
      low[i] = Math.min(open[i]!, close[i]!) - volatility * (0.45 + Math.abs(Math.cos(i * 0.53)) * 0.35);
      volume[i] = 52 + Math.abs(body) * 18 + Math.abs(Math.sin(i * 0.31)) * 35 + (i === 88 || i === 142 ? 90 : 0);
      price = close[i]!;
    }

    const candleDataset = new StaticOhlcDataset(x, open, high, low, close);
    const volumeDataset = new StaticDataset(x, volume);
    const lastClose = close[count - 1] ?? price;
    const highWatermark = Math.max(...Array.from(high));
    const lowWatermark = Math.min(...Array.from(low));
    const priceAnnotations = annotationsPlugin({
      annotations: [
        { type: "y-line", y: lastClose, color: "#f59e0b", width: 1, dash: "4 4", label: { text: `last ${lastClose.toFixed(2)}`, position: "right", color: "#fbbf24" } },
        { type: "y-range", yMin: lowWatermark, yMax: highWatermark, fillColor: "rgba(59,130,246,0.06)", borderColor: "rgba(59,130,246,0.22)", label: "range" },
        { type: "x-range", xMin: x[86]!, xMax: x[92]!, fillColor: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.35)", label: "event" },
        { type: "point", x: x[54]!, y: low[54]!, shape: "diamond", radius: 5, color: "#22c55e", strokeColor: "#052e16", strokeWidth: 1, label: { text: "buy", position: "bottom", color: "#86efac" } },
        { type: "point", x: x[142]!, y: high[142]!, shape: "diamond", radius: 5, color: "#ef4444", strokeColor: "#450a0a", strokeWidth: 1, label: { text: "sell", position: "top", color: "#fca5a5" } },
      ],
    });
    const linked = createLinkedCharts(target, {
      rows: 2,
      sharedX: true,
      spacing: 0,
      panels: [
        {
          options: this.docChartOptions({
            axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } },
            grid: true,
            hover: { mode: "nearest-x", group: "x", maxDistancePx: 48 },
            plugins: [
              interactionsPlugin({ wheelZoom: true, shiftDragPan: true, boxZoom: true, doubleClickReset: true }),
              crosshairPlugin({
                axis: "xy",
                snap: "nearest-x",
                label: true,
                formatX: (value) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value)),
                formatY: (value) => value.toFixed(2),
                formatter: (item) => {
                  const candle = item.series.ohlcAt(item.index);
                  if (!candle) return "";
                  const change = candle.close - candle.open;
                  return `O ${candle.open.toFixed(2)}  H ${candle.high.toFixed(2)}\nL ${candle.low.toFixed(2)}  C ${candle.close.toFixed(2)}\n${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
                },
              }),
              legendPlugin({ position: "top-left" }),
              priceAnnotations,
            ],
          }),
        },
        {
          options: this.docChartOptions({
            axes: { x: { position: "outside", scale: "time", timezone: "utc" }, y: { position: "outside" } },
            grid: true,
            hover: { mode: "nearest-x", group: "x", maxDistancePx: 48 },
            plugins: [interactionsPlugin({ wheelZoom: true, shiftDragPan: true, doubleClickReset: true }), crosshairPlugin({ axis: "xy", snap: "nearest-x", label: true }), legendPlugin({ position: "top-left" })],
          }),
        },
      ],
    });
    linked.root.style.gridTemplateRows = "minmax(0,2.2fr) minmax(0,0.8fr)";
    const priceChart = linked.charts[0];
    const volumeChart = linked.charts[1];
    priceChart?.addCandlestick(
      { dataset: candleDataset, name: "BLAZEUSDT 4h" },
      { barWidth: barMs * 0.7, lineWidth: 1, upColor: [0.13, 0.84, 0.49, 1], downColor: [0.94, 0.27, 0.27, 1], wickColor: [0.73, 0.78, 0.88, 1] },
    );
    volumeChart?.addBar({ dataset: volumeDataset, name: "volume", downsample: "none" }, { baseline: 0, barWidth: barMs * 0.68, color: [0.35, 0.55, 0.95, 0.58] });
    priceChart?.fitToData({ padding: { x: 0.02, y: 0.12 } });
    volumeChart?.fitToData({ includeZero: true, padding: { x: 0.02, y: 0.12 } });
    linked.setXRange(x[30]!, x[count - 1]! + barMs);
    for (const chart of linked.charts) chart.start();
    this.docDisposers.push(() => { linked.dispose(); });
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
