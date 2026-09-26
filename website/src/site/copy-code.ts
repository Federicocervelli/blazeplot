/** Copy rendered code with a legacy fallback for non-secure HTTP preview URLs. */
async function writeClipboardText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through when clipboard permissions or secure-context requirements block the API.
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  Object.assign(field.style, { position: "fixed", inset: "0 auto auto -10000px", opacity: "0" });
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  active?.focus({ preventScroll: true });
  if (!copied) throw new Error("Clipboard copy was blocked.");
}

/** Delegated handler so rendered markdown does not need per-block listeners. */
export async function copyCode(event: Event): Promise<void> {
  const target = event.target;
  const button = target instanceof Element ? target.closest<HTMLButtonElement>("[data-copy-code]") : null;
  if (!button || button.disabled) return;
  const block = button.closest(".code-block");
  const code = block?.querySelector("code");
  const status = block?.querySelector<HTMLElement>("[role=status]");
  if (!code || !status) return;
  button.disabled = true;
  try {
    await writeClipboardText(code.textContent ?? "");
    const item = button.getAttribute("aria-label")?.toLowerCase().includes("install") ? "Install command" : "Code";
    status.textContent = `${item} copied`;
  } catch {
    status.textContent = "Could not copy. Check clipboard permissions.";
  } finally {
    button.disabled = false;
  }
}
