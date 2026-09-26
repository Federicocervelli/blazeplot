import { appHref } from "../shared.ts";

export function showChartFallback(target: HTMLElement, error: unknown): void {
  target.replaceChildren();
  const fallback = document.createElement("div");
  fallback.className = "flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-[#bbb]";
  fallback.setAttribute("role", "alert");
  const unavailable = error instanceof Error && error.name === "WebGL2UnavailableError";
  const message = document.createElement("p");
  message.textContent = unavailable
    ? "This chart needs WebGL2. Check your browser and graphics settings."
    : "This chart could not start. Reload to try again.";
  const help = document.createElement("a");
  help.href = appHref(unavailable ? "docs/browser-support" : "docs/troubleshooting");
  help.textContent = unavailable ? "Browser support" : "Troubleshooting";
  help.className = "text-[#fc4a05] underline";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Reload";
  retry.addEventListener("click", () => window.location.reload());
  fallback.append(message, help, retry);
  target.append(fallback);
  console.error("BlazePlot chart initialization failed", error);
}

export async function runFeedbackAction(button: HTMLButtonElement, status: HTMLElement, action: () => Promise<unknown>, success: string, failure: string): Promise<void> {
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = "Working…";
  try {
    await action();
    status.textContent = success;
  } catch {
    status.textContent = failure;
  } finally {
    button.disabled = false;
  }
}

export function addDisposableListener<K extends keyof HTMLElementEventMap>(
  disposers: Array<() => void>,
  element: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
): void {
  element.addEventListener(type, listener as EventListener);
  disposers.push(() => element.removeEventListener(type, listener as EventListener));
}
