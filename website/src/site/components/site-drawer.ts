import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { siteStyles } from "../styles.ts";

/** Native modal semantics provide focus containment and inert background content. */
export class SiteDrawer extends LitElement {
  static override styles = [siteStyles, css`:host { display: contents; } dialog::backdrop { background: rgb(0 0 0 / 70%); }`];
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
    return html`<dialog aria-label=${this.label} class="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(86vw,340px)] max-w-none border-0 bg-black p-0 text-[#e5e5e5]" @cancel=${this.onCancel} @click=${this.onBackdrop}>
      <div class="flex h-full flex-col">
        <header class="flex shrink-0 items-center justify-between p-4">
          <h2 class="m-0 text-base font-semibold">${this.label}</h2>
          <button type="button" class="px-2 py-2 text-[var(--muted)] hover:text-[#e5e5e5]" aria-label=${`Close ${this.label.toLowerCase()}`} @click=${this.requestClose}>Close</button>
        </header>
        <nav class="min-h-0 flex-1 overflow-y-auto p-4" aria-label=${this.label}><slot></slot></nav>
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
