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
    await navigator.clipboard.writeText(code.textContent ?? "");
    status.textContent = "Copied";
  } catch {
    status.textContent = "Could not copy. Select the code and copy it manually.";
  } finally {
    button.disabled = false;
  }
}
