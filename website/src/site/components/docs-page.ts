import "./site-drawer.ts";
import { copyCode } from "../copy-code.ts";
import { LitElement, html, type PropertyValues, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import { DOC_NAV_SECTIONS, DOC_PAGES, type DocPage } from "../../docs.ts";
import { renderMarkdown } from "../../markdown.ts";
import { appHref } from "../shared.ts";

import { showChartFallback } from "../charts/dom.ts";
import { siteStyles } from "../styles.ts";

export class BlazeplotDocsPage extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    doc: { attribute: false },
    docsNavOpen: { state: true },
    markdown: { state: true },
    loadError: { state: true },
  };

  declare doc: DocPage;
  declare private docsNavOpen: boolean;
  declare private markdown: string;
  declare private loadError: boolean;
  ready: Promise<void> = Promise.resolve();
  private loadGeneration = 0;
  private disposeCharts: (() => void) | null = null;

  constructor() {
    super();
    this.doc = DOC_PAGES[0]!;
    this.docsNavOpen = false;
    this.markdown = "";
    this.loadError = false;
  }
  private mountedDocSlug: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("blazeplot-docs-nav-toggle", this.toggleDocsNav);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("blazeplot-docs-nav-toggle", this.toggleDocsNav);
    this.loadGeneration++;
    this.disposeDocCharts();
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues): void {
    if (changedProperties.has("doc")) {
      this.docsNavOpen = false;
      this.disposeDocCharts();
      this.ready = this.loadDoc();
    }
    if (this.markdown) this.mountDocCharts(this.doc);
  }

  private async loadDoc(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.markdown = "";
    this.loadError = false;
    try {
      const markdown = await this.doc.loadMarkdown();
      if (generation !== this.loadGeneration) return;
      this.markdown = markdown;
      await this.updateComplete;
    } catch {
      if (generation === this.loadGeneration) this.loadError = true;
    }
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
            ${this.loadError ? html`<p role="alert">Could not load this guide. <button @click=${() => { this.ready = this.loadDoc(); }}>Try again</button></p>` : this.markdown ? unsafeHTML(renderMarkdown(this.markdown, { sourcePath: doc.sourcePath, tableOfContents: true })) : html`<p role="status">Loading guide…</p>`}
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
    if (this.mountedDocSlug === doc.slug) return;
    this.disposeDocCharts();
    this.mountedDocSlug = doc.slug;
    if (!this.renderRoot.querySelector("[data-doc-chart]")) return;
    const generation = this.loadGeneration;
    void import("../charts/doc-charts.ts").then(({ observeDocCharts }) => {
      if (!this.isConnected || generation !== this.loadGeneration || this.mountedDocSlug !== doc.slug) return;
      this.disposeCharts = observeDocCharts(this.renderRoot);
    }).catch((error: unknown) => {
      if (!this.isConnected || generation !== this.loadGeneration) return;
      for (const target of this.renderRoot.querySelectorAll<HTMLElement>("[data-doc-chart]")) showChartFallback(target, error);
    });
  }

  private disposeDocCharts(): void {
    this.disposeCharts?.();
    this.disposeCharts = null;
    this.mountedDocSlug = null;
  }

}

export function defineBlazeplotDocsPage(): void {
  if (!customElements.get("blazeplot-docs")) {
    customElements.define("blazeplot-docs", BlazeplotDocsPage);
  }
}
