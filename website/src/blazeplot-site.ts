import { LitElement, html, nothing, type TemplateResult } from "lit";
import { DOC_PAGES, getDocPage } from "./docs.ts";
import { defineBlazeplotTopbar } from "./site/components/site-topbar.ts";
import { appHref, appRouteFromHash, appRouteFromPath, PREVIEWS, REPO_URL, type PreviewId, type Section } from "./site/shared.ts";
import logoUrl from "./blazeplot-dark-cropped.png";
import { siteStyles } from "./site/styles.ts";

export class BlazeplotSite extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    section: { state: true },
    docSlug: { state: true },
    previewId: { state: true },
    loadError: { state: true },
  };

  declare private section: Section;
  declare private docSlug: string;
  declare private previewId: PreviewId;
  declare private loadError: boolean;
  private readonly loadedSections = new Set<Section>();
  private readonly sectionLoads = new Map<Section, Promise<void>>();

  constructor() {
    super();
    this.section = "home";
    this.docSlug = DOC_PAGES[0]?.slug ?? "examples";
    this.previewId = "live";
    this.loadError = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.syncRoute();
    void this.restoreAnchor();
    window.addEventListener("hashchange", this.onHash);
    window.addEventListener("popstate", this.onPopState);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("hashchange", this.onHash);
    window.removeEventListener("popstate", this.onPopState);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const doc = getDocPage(this.docSlug) ?? DOC_PAGES[0]!;
    return html`
      <div class="flex min-h-screen flex-col bg-bg font-sans text-[15px] leading-normal text-fg antialiased" @click=${this.handleRouteClick} @preview-select=${this.handlePreviewSelect}>
        <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2" @click=${this.skipToMain}>Skip to content</a>
        <blazeplot-topbar class="sticky top-0 z-50 block" .section=${this.section}></blazeplot-topbar>
        <main id="main" tabindex="-1" class="w-full flex-1 outline-none">
          ${this.loadedSections.has("home") && this.section === "home" ? html`<blazeplot-home class="block"></blazeplot-home>` : nothing}
          ${this.loadedSections.has("docs") && this.section === "docs" ? html`<blazeplot-docs class="block" .doc=${doc}></blazeplot-docs>` : nothing}
          ${this.loadedSections.has("previews") && this.section === "previews" ? html`<blazeplot-previews class="block" .previewId=${this.previewId}></blazeplot-previews>` : nothing}
          ${!this.loadedSections.has(this.section) ? html`<div class="mx-auto max-w-[1440px] px-6 py-16 text-sm text-fg-3">${this.loadError ? html`<p role="alert">Could not load this page. <button class="link" @click=${() => { this.loadError = false; void this.restoreAnchor(); }}>Try again</button></p>` : html`<p role="status">Loading…</p>`}</div>` : nothing}
        </main>
        ${this.renderFooter()}
      </div>
    `;
  }

  private renderFooter(): TemplateResult {
    const columns: ReadonlyArray<{ title: string; links: ReadonlyArray<{ label: string; href: string; external?: boolean }> }> = [
      { title: "Docs", links: [
        { label: "Overview", href: appHref("docs/overview") },
        { label: "Examples", href: appHref("docs/examples") },
        { label: "Plugins", href: appHref("docs/built-in-plugins") },
        { label: "API reference", href: appHref("docs/api-reference") },
      ] },
      { title: "Project", links: [
        { label: "Demos", href: appHref("previews") },
        { label: "Benchmarks", href: appHref("docs/benchmarks") },
        { label: "Roadmap", href: appHref("docs/roadmap") },
        { label: "Releases", href: `${REPO_URL}/releases`, external: true },
      ] },
      { title: "Community", links: [
        { label: "GitHub", href: REPO_URL, external: true },
        { label: "npm", href: "https://www.npmjs.com/package/blazeplot", external: true },
        { label: "Sponsor", href: "https://github.com/sponsors/Federicocervelli", external: true },
        { label: "Portfolio", href: "https://cervelli.dev", external: true },
      ] },
    ];
    return html`
      <footer class="border-t border-line bg-bg" aria-label="Project links">
        <div class="mx-auto grid max-w-[1440px] gap-10 px-6 py-12 sm:grid-cols-[1fr_auto] sm:px-8">
          <div class="max-w-[280px]">
            <img src=${logoUrl} alt="BlazePlot" width="96" height="24" class="h-[22px] w-auto opacity-90" />
            <p class="mt-3 text-sm text-fg-3">WebGL2 charts for dense and live time series. Released under the <a class="text-fg-2 hover:text-fg" href=${`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT license</a>.</p>
          </div>
          <div class="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3 sm:gap-16">
            ${columns.map((column) => html`
              <div>
                <h2 class="mb-3 text-xs font-semibold text-fg">${column.title}</h2>
                <ul class="space-y-2">
                  ${column.links.map((link) => html`<li><a href=${link.href} class="text-fg-3 hover:text-fg" target=${link.external ? "_blank" : "_self"} rel=${link.external ? "noreferrer" : nothing}>${link.label}</a></li>`)}
                </ul>
              </div>
            `)}
          </div>
        </div>
      </footer>
    `;
  }

  private readonly skipToMain = (event: Event): void => {
    event.preventDefault();
    this.renderRoot.querySelector<HTMLElement>("#main")?.focus();
  };

  private readonly onHash = (): void => {
    const route = appRouteFromHash(window.location.hash);
    if (route) {
      this.navigateToAppRoute(route, { replace: true, scroll: false });
      return;
    }
    this.syncRoute();
    void this.restoreAnchor();
  };

  private readonly onPopState = (): void => {
    this.syncRoute();
    void this.restoreAnchor();
  };

  private readonly handlePreviewSelect = (event: CustomEvent<PreviewId>): void => {
    this.navigateToAppRoute(`previews/${event.detail}`);
  };

  private readonly handleRouteClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.composedPath().find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement);
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (anchor.target && anchor.target !== "_self") return;

    const hashRoute = href.startsWith("#") ? appRouteFromHash(href) : null;
    if (hashRoute) {
      event.preventDefault();
      this.navigateToAppRoute(hashRoute);
      return;
    }

    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin) return;
    const route = appRouteFromPath(url.pathname);
    if (!route) return;

    event.preventDefault();
    this.navigateToAppRoute(`${route}${url.search}${url.hash}`);
  };

  private navigateToAppRoute(route: string, options: { replace?: boolean; scroll?: boolean } = {}): void {
    const targetUrl = appHref(route === "home" ? "" : route);
    const target = new URL(targetUrl, window.location.origin);
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const targetPath = `${target.pathname}${target.search}${target.hash}`;

    if (options.scroll !== false) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (currentPath !== targetPath) {
      window.history[options.replace ? "replaceState" : "pushState"](null, "", targetPath);
    }
    this.syncRoute();
    void this.restoreAnchor();
  }

  private async restoreAnchor(): Promise<void> {
    const href = window.location.href;
    try { await this.loadSection(this.section); } catch { this.loadError = true; return; }
    await this.updateComplete;
    const page = this.renderRoot.querySelector<LitElement & { ready?: Promise<void> }>("blazeplot-docs, blazeplot-home, blazeplot-previews");
    await page?.updateComplete;
    await page?.ready;
    if (href !== window.location.href || !this.isConnected) return;
    const hash = window.location.hash.slice(1);
    if (!hash || !page) return;
    let id: string;
    try { id = decodeURIComponent(hash); } catch { return; }
    const heading = page.renderRoot.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!heading) return;
    heading.style.scrollMarginTop = "80px";
    heading.setAttribute("tabindex", "-1");
    heading.scrollIntoView({ block: "start", behavior: "instant" });
    heading.focus({ preventScroll: true });
  }

  private loadSection(section: Section): Promise<void> {
    if (this.loadedSections.has(section)) return Promise.resolve();
    const pending = this.sectionLoads.get(section);
    if (pending) return pending;
    const loaders = {
      home: async () => (await import("./site/components/home-page.ts")).defineBlazeplotHomePage(),
      docs: async () => (await import("./site/components/docs-page.ts")).defineBlazeplotDocsPage(),
      previews: async () => (await import("./site/components/previews-page.ts")).defineBlazeplotPreviewsPage(),
    };
    const load = loaders[section]().then(() => { this.loadedSections.add(section); this.requestUpdate(); }).finally(() => this.sectionLoads.delete(section));
    this.sectionLoads.set(section, load);
    return load;
  }

  private syncRoute(): void {
    const hashRoute = appRouteFromHash(window.location.hash);
    if (hashRoute) {
      this.navigateToAppRoute(hashRoute, { replace: true, scroll: false });
      return;
    }

    const route = appRouteFromPath(window.location.pathname) ?? "home";
    if (route.startsWith("docs/")) {
      const slug = route.slice(5);
      this.section = "docs";
      const page = getDocPage(slug) ?? DOC_PAGES[0]!;
      this.docSlug = page.slug;
    } else if (route === "previews" || route.startsWith("previews/")) {
      this.section = "previews";
      const id = route.split("/")[1] as PreviewId | undefined;
      const preview = id ? PREVIEWS.find((candidate) => candidate.id === id) : PREVIEWS[0];
      this.previewId = preview?.id ?? PREVIEWS[0]!.id;
    } else {
      this.section = "home";
    }
  }
}

export function defineBlazeplotSite(): void {
  defineBlazeplotTopbar();

  if (!customElements.get("blazeplot-site")) {
    customElements.define("blazeplot-site", BlazeplotSite);
  }
}
