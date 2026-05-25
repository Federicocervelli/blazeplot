export function showChartFallback(target: HTMLElement): void {
  target.replaceChildren();
  const fallback = document.createElement("div");
  fallback.className = "grid h-full place-items-center text-[#555]";
  fallback.textContent = "WebGL2 unavailable";
  target.append(fallback);
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
