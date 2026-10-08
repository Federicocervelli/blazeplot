import { destroyBackend } from "./releaseWebGLContext.js";
import type { GpuBackend } from "./types.js";
import { keepWarm } from "./warm.js";

/**
 * Warm plot canvases.
 *
 * Creating a WebGL2 context is a synchronous round trip to the GPU process (about 1.5 ms on a warm
 * one, more on a cold one), compiling the chart's programs costs again, and releasing the context
 * (`loseContext`) costs a little more when the chart goes away. A page that mounts and unmounts
 * charts, such as route changes, tabs, or virtualised lists, pays all of it every time.
 *
 * A context belongs to its canvas element, so the thing worth keeping is the canvas: when a chart
 * is disposed its plot canvas, with the context and the backend (programs, vertex arrays, stream
 * buffer) already on it, is parked here instead of being released. The next chart on the same
 * document takes it (`acquirePlotCanvas`) and starts with a live context and compiled programs.
 *
 * Parked canvases are bounded and short-lived (`keepWarm`). At most {@link MAX_PARKED} are kept per
 * page and the oldest is released first. They are also the least recently used contexts on the page,
 * which is the one browsers evict first when they hit their cap (about 16); a parked context that
 * was lost is simply dropped.
 */

/** Most warm canvases kept at once, across the page. */
const MAX_PARKED = 2;

interface Parked {
  readonly canvas: HTMLCanvasElement;
  readonly backend: GpuBackend;
  /** Cancels the pending idle release. */
  cancel(): void;
}

const parked: Parked[] = [];
/**
 * Canvases created here, which may be parked when their chart is disposed (caller-supplied canvases never
 * are). The value is the warm backend of a canvas that was just taken from the pool, for the renderer
 * built on it to adopt, and `null` otherwise.
 */
const owned = new WeakMap<HTMLCanvasElement, GpuBackend | null>();

function unpark(entry: Parked): void {
  entry.cancel();
  parked.splice(parked.indexOf(entry), 1);
}

function release(entry: Parked): void {
  unpark(entry);
  destroyBackend(entry.backend);
}

function usable(backend: GpuBackend): boolean {
  return backend.getContext?.()?.isContextLost() === false;
}

/**
 * A canvas for a chart's plot area: a parked one from this document, reset so only its context and
 * backend carry over, or else a new one that may be parked later.
 */
export function acquirePlotCanvas(doc: Document): HTMLCanvasElement {
  for (const entry of parked.slice()) {
    if (entry.canvas.ownerDocument !== doc) continue;
    if (!usable(entry.backend)) {
      release(entry);
      continue;
    }
    unpark(entry);
    // Listen for context loss again; a loss and restore while parked leaves the backend's objects invalid.
    if (entry.backend.attachCanvasListeners?.() === false) {
      destroyBackend(entry.backend);
      continue;
    }
    const { canvas } = entry;
    // Drop what the last chart's layout and plugins put on the element (class, style, ARIA). The width and
    // height attributes stay: they are the drawing buffer, and removing them resets (reallocates) it. The
    // next chart resizes the canvas only if its plot area differs.
    for (const name of canvas.getAttributeNames()) if (name !== "width" && name !== "height") canvas.removeAttribute(name);
    owned.set(canvas, entry.backend);
    return canvas;
  }
  const canvas = doc.createElement("canvas");
  owned.set(canvas, null);
  return canvas;
}

/**
 * Whether a canvas from {@link acquirePlotCanvas} still carries a warm backend that its renderer
 * has not adopted yet. Its context and drawing buffer already exist, so sizing the canvas first
 * saves nothing. Does not consume the backend.
 */
export function hasWarmBackend(canvas: HTMLCanvasElement): boolean {
  return owned.get(canvas) != null;
}

/** The warm backend that came with a canvas from {@link acquirePlotCanvas}, once; `undefined` for any other canvas. */
export function adoptWarmBackend(canvas: HTMLCanvasElement): GpuBackend | undefined {
  const backend = owned.get(canvas);
  if (backend) owned.set(canvas, null);
  return backend ?? undefined;
}

/**
 * Park a disposed chart's canvas and backend for the next chart. Returns false when the canvas is not
 * one this module made or its context is unusable, and the caller must release it as usual.
 */
export function parkPlotCanvas(canvas: HTMLCanvasElement, backend: GpuBackend): boolean {
  if (!owned.has(canvas) || !usable(backend)) return false;
  // Leave the old chart's DOM. The drawing buffer keeps its size: shrinking it reallocates it twice per
  // mount/destroy cycle, and a parked canvas holds it for at most WARM_IDLE_MS, after which the context
  // (and the buffer with it) is released.
  canvas.remove();
  // A parked backend must not keep a listener on the canvas; `acquirePlotCanvas` re-attaches it.
  backend.detachCanvasListeners?.();
  while (parked.length >= MAX_PARKED) release(parked[0]!);
  const entry: Parked = { canvas, backend, cancel: keepWarm(() => release(entry)) };
  parked.push(entry);
  return true;
}
