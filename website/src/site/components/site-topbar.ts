import { LitElement, html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import githubSvg from "../../github-mark.svg?raw";
import logoUrl from "../../blazeplot-dark-cropped.png";
import { appHref, REPO_URL, type Section } from "../shared.ts";
import { siteStyles } from "../styles.ts";

declare const __BLAZEPLOT_VERSION__: string;

const NAV: ReadonlyArray<{ section: Section; label: string; href: string }> = [
  { section: "docs", label: "Docs", href: "docs/overview" },
  { section: "previews", label: "Demos", href: "previews" },
];

export class BlazeplotTopbar extends LitElement {
  static override styles = siteStyles;
  static override properties = { section: { attribute: false } };
  declare section: Section;
  constructor() { super(); this.section = "home"; }

  override render(): TemplateResult {
    const hasSectionNav = this.section !== "home";
    return html`
      <header class="border-b border-line bg-bg/85 backdrop-blur-md">
        <div class="mx-auto flex h-[var(--header-h)] max-w-[1440px] items-center gap-3 px-4 sm:px-6">
          ${hasSectionNav ? html`
            <button type="button" class="icon-btn -ml-2 md:hidden" aria-label=${this.section === "docs" ? "Open docs navigation" : "Open demo navigation"} aria-haspopup="dialog" @click=${this.openSectionNavigation}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>` : nothing}
          <a href=${appHref("home")} class="flex shrink-0 items-center" aria-label="BlazePlot home" aria-current=${this.section === "home" ? "page" : "false"}>
            <img src=${logoUrl} alt="BlazePlot" width="104" height="26" class="block h-[22px] w-auto sm:h-[24px]" />
          </a>
          <a href=${`${REPO_URL}/releases`} target="_blank" rel="noreferrer" class="hidden rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-fg-3 hover:border-line-strong hover:text-fg-2 sm:inline-block">v${__BLAZEPLOT_VERSION__}</a>
          <nav aria-label="Main navigation" class="ml-auto flex items-center gap-1 text-sm">
            ${NAV.map((item) => html`
              <a href=${appHref(item.href)} aria-current=${this.section === item.section ? "page" : "false"}
                class="rounded-md px-2.5 py-1.5 font-medium ${this.section === item.section ? "text-fg" : "text-fg-2 hover:text-fg"}">${item.label}</a>
            `)}
            <a href=${appHref("docs/benchmarks")} class="hidden rounded-md px-2.5 py-1.5 font-medium text-fg-2 hover:text-fg sm:block">Benchmarks</a>
            <span class="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true"></span>
            <a href=${REPO_URL} target="_blank" rel="noreferrer" aria-label="BlazePlot on GitHub" class="icon-btn">
              <span aria-hidden="true" class="inline-flex h-[18px] w-[18px] [&_svg]:h-full [&_svg]:w-full">${unsafeHTML(githubSvg)}</span>
            </a>
          </nav>
        </div>
      </header>
    `;
  }

  private readonly openSectionNavigation = (): void => {
    window.dispatchEvent(new CustomEvent(this.section === "previews" ? "blazeplot-previews-nav-toggle" : "blazeplot-docs-nav-toggle"));
  };
}

export function defineBlazeplotTopbar(): void {
  if (!customElements.get("blazeplot-topbar")) customElements.define("blazeplot-topbar", BlazeplotTopbar);
}
