import { defineSiteDrawer } from "./site-drawer.ts";
import { copyCode } from "../copy-code.ts";
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import { DOC_NAV_SECTIONS, DOC_PAGES, type DocPage } from "../../docs.ts";
import { renderMarkdown } from "../../markdown.ts";
import { appHref, REPO_URL } from "../shared.ts";

import { showChartFallback } from "../charts/dom.ts";
import { siteStyles } from "../styles.ts";

interface TocEntry { readonly id: string; readonly text: string; readonly level: 2 | 3 }

/** Pages in sidebar order; prev/next follow the same order readers see. */
const ORDERED_PAGES: readonly DocPage[] = DOC_NAV_SECTIONS.flatMap((section) => section.slugs)
  .map((slug) => DOC_PAGES.find((page) => page.slug === slug))
  .filter((page): page is DocPage => Boolean(page));

export class BlazeplotDocsPage extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    doc: { attribute: false },
    docsNavOpen: { state: true },
    markdown: { state: true },
    loadError: { state: true },
    toc: { state: true },
    activeHeading: { state: true },
  };

  declare doc: DocPage;
  declare private docsNavOpen: boolean;
  /** Rendered HTML for the current page; rendering once keeps scroll-spy updates cheap. */
  declare private markdown: string;
  declare private loadError: boolean;
  declare private toc: readonly TocEntry[];
  declare private activeHeading: string;
  ready: Promise<void> = Promise.resolve();
  private loadGeneration = 0;
  private disposeCharts: (() => void) | null = null;
  private headingObserver: IntersectionObserver | null = null;
  private mountedDocSlug: string | null = null;
  private tocSlug: string | null = null;

  constructor() {
    super();
    this.doc = DOC_PAGES[0]!;
    this.docsNavOpen = false;
    this.markdown = "";
    this.loadError = false;
    this.toc = [];
    this.activeHeading = "";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("blazeplot-docs-nav-toggle", this.toggleDocsNav);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("blazeplot-docs-nav-toggle", this.toggleDocsNav);
    this.loadGeneration++;
    this.disposeDocCharts();
    this.headingObserver?.disconnect();
    this.headingObserver = null;
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues): void {
    if (changedProperties.has("doc")) {
      this.docsNavOpen = false;
      this.disposeDocCharts();
      this.ready = this.loadDoc();
    }
    if (this.markdown) {
      this.mountDocCharts(this.doc);
      this.collectToc();
    }
  }

  private async loadDoc(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.markdown = "";
    this.loadError = false;
    this.toc = [];
    this.tocSlug = null;
    try {
      const markdown = await this.doc.loadMarkdown();
      if (generation !== this.loadGeneration) return;
      this.markdown = renderMarkdown(markdown, { sourcePath: this.doc.sourcePath, tableOfContents: true });
      await this.updateComplete;
    } catch {
      if (generation === this.loadGeneration) this.loadError = true;
    }
  }

  override render(): TemplateResult {
    const doc = this.doc;
    const section = DOC_NAV_SECTIONS.find((candidate) => candidate.slugs.includes(doc.slug));
    const index = ORDERED_PAGES.findIndex((page) => page.slug === doc.slug);
    const previous = index > 0 ? ORDERED_PAGES[index - 1] : undefined;
    const next = index >= 0 ? ORDERED_PAGES[index + 1] : undefined;
    return html`
      <site-drawer .open=${this.docsNavOpen} label="Docs navigation" @drawer-close=${this.closeDocsNav}>
        <div class="space-y-6">${this.renderDocsNav(doc, true)}</div>
      </site-drawer>
      <div class="mx-auto grid max-w-[1440px] md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_240px]">
        <aside class="hidden border-r border-line md:block">
          <nav aria-label="Docs" class="sticky top-[var(--header-h)] max-h-[calc(100dvh-var(--header-h))] space-y-6 overflow-y-auto px-4 py-8">
            ${this.renderDocsNav(doc, false)}
          </nav>
        </aside>
        <div class="min-w-0 px-5 pb-20 pt-8 sm:px-10 md:pt-10">
          <div class="mx-auto max-w-[760px]">
            <nav aria-label="Breadcrumb" class="mb-6 flex items-center gap-2 text-sm text-fg-3">
              <a href=${appHref("docs/overview")} class="hover:text-fg">Docs</a>
              <span aria-hidden="true">/</span>
              <span>${section?.title ?? "Reference"}</span>
            </nav>
            <article class="article" @click=${copyCode}>
              ${this.loadError
                ? html`<p role="alert">Could not load this guide. <button class="link" @click=${() => { this.ready = this.loadDoc(); }}>Try again</button></p>`
                : this.markdown
                  ? unsafeHTML(this.markdown)
                  : html`<p role="status" class="text-fg-3">Loading guide…</p>`}
            </article>
            <footer class="mt-16 border-t border-line pt-6">
              <a class="inline-flex items-center gap-2 text-sm text-fg-3 hover:text-fg" href=${`${REPO_URL}/blob/main/${doc.sourcePath}`} target="_blank" rel="noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                Edit this page on GitHub
              </a>
              <nav aria-label="Pagination" class="mt-8 grid gap-3 sm:grid-cols-2">
                ${previous ? html`<a href=${appHref(`docs/${previous.slug}`)} class="rounded-lg border border-line p-4 hover:border-line-strong hover:bg-raised"><span class="block text-xs text-fg-3">Previous</span><span class="mt-1 block font-medium text-fg">${previous.title}</span></a>` : html`<span></span>`}
                ${next ? html`<a href=${appHref(`docs/${next.slug}`)} class="rounded-lg border border-line p-4 text-right hover:border-line-strong hover:bg-raised"><span class="block text-xs text-fg-3">Next</span><span class="mt-1 block font-medium text-fg">${next.title}</span></a>` : nothing}
              </nav>
            </footer>
          </div>
        </div>
        <aside class="hidden xl:block">
          ${this.toc.length > 1 ? html`
            <nav aria-label="On this page" class="sticky top-[var(--header-h)] max-h-[calc(100dvh-var(--header-h))] overflow-y-auto px-4 py-10">
              <p class="mb-3 text-xs font-semibold text-fg">On this page</p>
              <ul class="space-y-1 border-l border-line text-[13px]">
                ${this.toc.map((entry) => html`
                  <li>
                    <a href=${`#${entry.id}`} data-toc-link
                      class="-ml-px block border-l py-1 leading-snug ${entry.level === 3 ? "pl-6" : "pl-3"} ${this.activeHeading === entry.id ? "border-flame text-fg" : "border-transparent text-fg-3 hover:text-fg"}">${entry.text}</a>
                  </li>
                `)}
              </ul>
            </nav>` : nothing}
        </aside>
      </div>
    `;
  }

  private renderDocsNav(doc: DocPage, closeOnSelect: boolean): TemplateResult[] {
    return DOC_NAV_SECTIONS.map((section) => html`
      <div>
        <h2 class="side-heading">${section.title}</h2>
        <ul>
          ${section.slugs.map((slug) => {
            const page = DOC_PAGES.find((candidate) => candidate.slug === slug);
            if (!page) return nothing;
            return html`
              <li>
                <a href=${appHref(`docs/${page.slug}`)} aria-current=${page.slug === doc.slug ? "page" : "false"} class="side-link" @click=${closeOnSelect ? this.closeDocsNav : undefined}>${page.title}</a>
              </li>
            `;
          })}
        </ul>
      </div>
    `);
  }

  /** Build the right-hand outline from the rendered headings and highlight the one being read. */
  private collectToc(): void {
    if (this.tocSlug === this.doc.slug) return;
    this.tocSlug = this.doc.slug;
    const headings = Array.from(this.renderRoot.querySelectorAll<HTMLElement>(".article h2[id], .article h3[id]"));
    this.toc = headings.map((heading) => ({ id: heading.id, text: heading.textContent ?? "", level: heading.tagName === "H3" ? 3 : 2 }));
    this.activeHeading = headings[0]?.id ?? "";
    this.headingObserver?.disconnect();
    const visible = new Set<string>();
    this.headingObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id);
      }
      const first = headings.find((heading) => visible.has(heading.id));
      if (first) this.activeHeading = first.id;
    }, { rootMargin: "-64px 0px -65% 0px" });
    for (const heading of headings) this.headingObserver.observe(heading);
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
  defineSiteDrawer();
  if (!customElements.get("blazeplot-docs")) {
    customElements.define("blazeplot-docs", BlazeplotDocsPage);
  }
}
