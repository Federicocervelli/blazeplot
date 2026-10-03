import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { siteStyles } from "../styles.ts";

/** Native modal semantics provide focus containment and inert background content. */
export class SiteDrawer extends LitElement {
  static override styles = [siteStyles, css`:host { display: contents; } dialog::backdrop { background: rgb(0 0 0 / 60%); backdrop-filter: blur(2px); }`];
  static override properties = { open: { type: Boolean }, label: { type: String } };
  declare open: boolean;
  declare label: string;
  private returnFocus: HTMLElement | null = null;
  private previousOverflow: string | null = null;
  private readonly desktop = matchMedia("(min-width: 768px)");

  constructor() { super(); this.open = false; this.label = "Navigation"; }
  override connectedCallback(): void {
    super.connectedCallback();
    this.desktop.addEventListener("change", this.onBreakpoint);
  }
  override disconnectedCallback(): void {
    this.desktop.removeEventListener("change", this.onBreakpoint);
    this.restorePage();
    super.disconnectedCallback();
  }
  override updated(changed: PropertyValues): void {
    if (!changed.has("open")) return;
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>("dialog")!;
    if (this.open && !this.desktop.matches) {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      this.returnFocus = active instanceof HTMLElement ? active : null;
      this.previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.showModal();
    } else {
      dialog.close();
      this.restorePage();
      if (this.open) this.requestClose();
    }
  }
  override render(): TemplateResult {
    return html`<dialog aria-label=${this.label} class="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(86vw,320px)] max-w-none border-0 border-r border-line bg-raised p-0 text-fg" @cancel=${this.onCancel} @click=${this.onBackdrop}>
      <div class="flex h-full flex-col">
        <header class="flex h-[var(--header-h)] shrink-0 items-center justify-between border-b border-line px-4">
          <h2 class="m-0 text-sm font-semibold">${this.label}</h2>
          <button type="button" class="icon-btn -mr-2" aria-label=${`Close ${this.label.toLowerCase()}`} @click=${this.requestClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <nav class="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label=${this.label}><slot></slot></nav>
      </div>
    </dialog>`;
  }
  private readonly requestClose = (): void => { this.dispatchEvent(new CustomEvent("drawer-close", { bubbles: true, composed: true })); };
  private readonly onCancel = (event: Event): void => { event.preventDefault(); this.requestClose(); };
  private readonly onBreakpoint = (): void => { if (this.desktop.matches && this.open) this.requestClose(); };
  private readonly onBackdrop = (event: MouseEvent): void => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.requestClose();
  };
  private restorePage(): void {
    if (this.previousOverflow !== null) document.body.style.overflow = this.previousOverflow;
    this.previousOverflow = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }
}
export function defineSiteDrawer(): void {
  if (!customElements.get("site-drawer")) customElements.define("site-drawer", SiteDrawer);
}
