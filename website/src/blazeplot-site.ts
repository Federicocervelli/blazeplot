import { LitElement, html, nothing, type TemplateResult } from "lit";
import { DOC_PAGES, getDocPage } from "./docs.ts";
import { defineBlazeplotTopbar } from "./site/components/site-topbar.ts";
import { appHref, appRouteFromHash, appRouteFromPath, PREVIEWS, type PreviewId, type Section } from "./site/shared.ts";
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
      <div class="min-h-screen bg-black text-[#e5e5e5] font-mono text-[13px] leading-relaxed" @click=${this.handleRouteClick} @preview-select=${this.handlePreviewSelect}>
        <blazeplot-topbar class="sticky top-0 z-50 block" .section=${this.section}></blazeplot-topbar>
        <main class="w-full ${this.section === "previews" ? "min-w-0 px-0 pb-0 pt-1.5" : "mx-auto max-w-[1180px] px-3 pb-5 pt-3 sm:px-4 sm:pb-8 sm:pt-4"}">
          ${this.loadedSections.has("home") && this.section === "home" ? html`<blazeplot-home class="block"></blazeplot-home>` : nothing}
          ${this.loadedSections.has("docs") && this.section === "docs" ? html`<blazeplot-docs class="block" .doc=${doc}></blazeplot-docs>` : nothing}
          ${this.loadedSections.has("previews") && this.section === "previews" ? html`<blazeplot-previews class="block" .previewId=${this.previewId}></blazeplot-previews>` : nothing}
          ${!this.loadedSections.has(this.section) ? this.loadError ? html`<p role="alert">Could not load this page. <button @click=${() => { this.loadError = false; void this.restoreAnchor(); }}>Try again</button></p>` : html`<p role="status">Loading page…</p>` : nothing}
        </main>
        <footer class="flex flex-wrap justify-center gap-5 border-t border-[#222] px-3 py-5 text-[12px] text-[#aaa]" aria-label="Project links">
          <a href="https://www.npmjs.com/package/blazeplot" target="_blank" rel="noreferrer">npm</a>
          <a href="https://github.com/Federicocervelli/blazeplot/blob/development/LICENSE" target="_blank" rel="noreferrer">MIT license</a>
          <a href="https://github.com/sponsors/Federicocervelli" target="_blank" rel="noreferrer">Sponsor</a>
          <a href="https://cervelli.dev" target="_blank" rel="noreferrer">Portfolio</a>
        </footer>
      </div>
    `;
  }

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
    heading.style.scrollMarginTop = "72px";
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
