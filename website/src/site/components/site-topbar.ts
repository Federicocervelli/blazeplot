import { LitElement, html, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import githubSvg from "../../github-mark.svg?raw";
import logoUrl from "../../blazeplot-dark-cropped.png";
import { appHref, type Section } from "../shared.ts";
import { siteStyles } from "../styles.ts";

export class BlazeplotTopbar extends LitElement {
  static override styles = siteStyles;
  static override properties = { section: { attribute: false } };
  declare section: Section;
  constructor() { super(); this.section = "home"; }

  override render(): TemplateResult {
    return html`
      <header class="flex items-center justify-between gap-2 border-b border-[#222] bg-[#0a0a0a] px-2 py-2 sm:px-4">
        <div class="flex min-w-0 items-center gap-2">
          ${this.section !== "home" ? html`
            <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[#333] text-[var(--muted)] md:hidden" aria-label=${this.section === "docs" ? "Open docs navigation" : "Open preview navigation"} aria-haspopup="dialog" @click=${this.openSectionNavigation}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>` : ""}
          <a href=${appHref("home")} aria-label="BlazePlot home" aria-current=${this.section === "home" ? "page" : "false"}>
            <img src=${logoUrl} alt="BlazePlot" class="block w-[88px] sm:w-[112px]" />
          </a>
        </div>
        <nav aria-label="Main navigation" class="flex shrink-0 items-center gap-1 text-[12px] sm:gap-2">
          ${(["docs", "previews"] as const).map((section) => html`
            <a href=${appHref(section === "docs" ? "docs/overview" : "previews")} aria-current=${this.section === section ? "page" : "false"} class="rounded border px-2 py-2 no-underline ${this.section === section ? "border-[#fc4a05] text-[#e5e5e5]" : "border-[#333] text-[var(--muted)]"}">${section === "docs" ? "Docs" : "Previews"}</a>
          `)}
          <a href="https://github.com/Federicocervelli/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot on GitHub" class="inline-flex h-9 w-9 items-center justify-center rounded border border-[#333] text-[var(--muted)]">
            <span aria-hidden="true" class="inline-flex h-4 w-4 [&_svg]:h-full [&_svg]:w-full">${unsafeHTML(githubSvg)}</span>
          </a>
        </nav>
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
