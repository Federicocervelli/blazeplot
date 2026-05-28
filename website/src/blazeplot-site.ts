import { LitElement, html, nothing, type TemplateResult } from "lit";
import { DOC_PAGES, getDocPage } from "./docs.ts";
import { defineBlazeplotDocsPage } from "./site/components/docs-page.ts";
import { defineBlazeplotHomePage } from "./site/components/home-page.ts";
import { defineBlazeplotPreviewsPage } from "./site/components/previews-page.ts";
import { defineBlazeplotTopbar } from "./site/components/site-topbar.ts";
import { appHref, appRouteFromHash, appRouteFromPath, PREVIEWS, type PreviewId, type Section } from "./site/shared.ts";
import { siteStyles } from "./site/styles.ts";

export class BlazeplotSite extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    section: { state: true },
    docSlug: { state: true },
    previewId: { state: true },
  };

  declare private section: Section;
  declare private docSlug: string;
  declare private previewId: PreviewId;

  constructor() {
    super();
    this.section = "home";
    this.docSlug = DOC_PAGES[0]?.slug ?? "examples";
    this.previewId = "live";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.syncRoute();
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
        <main class="w-full ${this.section === "previews" ? "overflow-auto px-0 pb-0 pt-1.5" : "mx-auto max-w-[1180px] px-3 pb-5 pt-3 sm:px-4 sm:pb-8 sm:pt-4"}">
          ${this.section === "home" ? html`<blazeplot-home class="block"></blazeplot-home>` : nothing}
          ${this.section === "docs" ? html`<blazeplot-docs class="block" .doc=${doc}></blazeplot-docs>` : nothing}
          ${this.section === "previews" ? html`<blazeplot-previews class="block" .previewId=${this.previewId}></blazeplot-previews>` : nothing}
        </main>
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
  };

  private readonly onPopState = (): void => {
    this.syncRoute();
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
    this.navigateToAppRoute(route);
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
  defineBlazeplotHomePage();
  defineBlazeplotDocsPage();
  defineBlazeplotPreviewsPage();

  if (!customElements.get("blazeplot-site")) {
    customElements.define("blazeplot-site", BlazeplotSite);
  }
}
