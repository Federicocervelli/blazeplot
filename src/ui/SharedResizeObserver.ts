interface SharedObserver {
  /** The constructor this observer came from, so a replaced `ResizeObserver` gets a fresh one. */
  readonly source: typeof ResizeObserver;
  readonly observer: ResizeObserver;
  readonly callbacks: Map<Element, () => void>;
}

/** One observer per window, shared by its charts: observing N plots costs one observer, not N. */
const observers = new WeakMap<Window, SharedObserver>();

/**
 * Call `callback` whenever `element` changes size, through the window's `ResizeObserver` (the same
 * one every other chart in that window uses). Returns the function that stops observing, which also
 * disconnects the window's observer once nothing is left to observe so it never keeps a disposed
 * chart alive; or `null` when the window has no `ResizeObserver`.
 */
export function observeResize(view: Window & typeof globalThis, element: Element, callback: () => void): (() => void) | null {
  const Ctor = view.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof Ctor === "undefined") return null;
  let shared = observers.get(view);
  if (!shared || shared.source !== Ctor) {
    const callbacks = new Map<Element, () => void>();
    shared = {
      source: Ctor,
      callbacks,
      observer: new Ctor((entries) => {
        // One chart's failing resize must not skip the others; the first error still surfaces.
        let failure: unknown;
        let failed = false;
        for (const entry of entries) {
          try {
            callbacks.get(entry.target)?.();
          } catch (error) {
            if (!failed) failure = error;
            failed = true;
          }
        }
        if (failed) throw failure;
      }),
    };
    observers.set(view, shared);
  }
  const entry = shared;
  entry.callbacks.set(element, callback);
  entry.observer.observe(element);
  return () => {
    if (entry.callbacks.get(element) !== callback) return;
    entry.callbacks.delete(element);
    entry.observer.unobserve(element);
    if (entry.callbacks.size > 0) return;
    entry.observer.disconnect();
    if (observers.get(view) === entry) observers.delete(view);
  };
}
