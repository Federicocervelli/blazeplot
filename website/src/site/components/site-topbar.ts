import { LitElement, html, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { DOC_PAGES } from "../../docs.ts";
import githubSvg from "../../github-mark.svg?raw";
import logoUrl from "../../blazeplot-dark-cropped.png";
import { appHref } from "../shared.ts";
import { siteStyles } from "../styles.ts";

export class BlazeplotTopbar extends LitElement {
  static override styles = siteStyles;
  static override properties = {
    githubStars: { state: true },
  };

  declare private githubStars: number | null;

  constructor() {
    super();
    this.githubStars = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadGithubStars();
  }

  override render(): TemplateResult {
    return html`
      <header class="sticky top-0 z-50 flex flex-col gap-2 border-b border-[#222] bg-[#0a0a0a] px-3 py-2 select-none sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <a href=${appHref("home")} class="flex items-center text-[#e5e5e5] no-underline" aria-label="BlazePlot home">
          <img src=${logoUrl} alt="BlazePlot" class="block h-5 w-auto" />
        </a>
        <nav class="flex w-full items-center gap-2 overflow-x-auto pb-0.5 text-[12px] sm:w-auto sm:overflow-visible sm:pb-0">
          <a href=${appHref(`docs/${DOC_PAGES[0]?.slug ?? "examples"}`)} class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span class="inline-flex h-3.5 items-center leading-none" style="position: relative; top: 2px;">Docs</span>
          </a>
          <a href=${appHref("previews")} class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span class="inline-flex h-3.5 items-center leading-none" style="position: relative; top: 2px;">Previews</span>
          </a>
          <a href="https://github.com/Federicocervelli/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot on GitHub, ${this.formatGithubStars()} stars" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center [&_svg]:block [&_svg]:h-full [&_svg]:w-full">${unsafeHTML(githubSvg)}</span>
            <span class="inline-flex h-3.5 items-center leading-none tabular-nums" style="position: relative; top: 2px;">${this.formatGithubStars()}</span>
          </a>
          <a href="https://www.npmjs.com/package/blazeplot" target="_blank" rel="noreferrer" aria-label="BlazePlot on npm" class="flex shrink-0 items-center whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="block h-3.5 w-3.5 shrink-0">
              <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
            </svg>
          </a>
          <a href="https://cervelli.dev" target="_blank" rel="noreferrer" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap leading-none text-[#888] no-underline hover:text-[#fc4a05] px-2 py-1 border border-[#222] hover:border-[#fc4a05] rounded">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>
            <span class="inline-flex h-3.5 items-center leading-none" style="position: relative; top: 2px;">Portfolio</span>
          </a>
        </nav>
      </header>
    `;
  }

  private async loadGithubStars(): Promise<void> {
    try {
      const response = await fetch("https://api.github.com/repos/Federicocervelli/blazeplot", { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) return;
      const data = await response.json() as { stargazers_count?: unknown };
      if (typeof data.stargazers_count === "number") {
        this.githubStars = data.stargazers_count;
      }
    } catch {
      // Keep the top bar usable when the GitHub API is unavailable.
    }
  }

  private formatGithubStars(): string {
    if (this.githubStars === null) return "—";
    if (this.githubStars >= 1000) return `${(this.githubStars / 1000).toFixed(this.githubStars >= 10_000 ? 0 : 1)}k`;
    return String(this.githubStars);
  }
}

export function defineBlazeplotTopbar(): void {
  if (!customElements.get("blazeplot-topbar")) {
    customElements.define("blazeplot-topbar", BlazeplotTopbar);
  }
}
