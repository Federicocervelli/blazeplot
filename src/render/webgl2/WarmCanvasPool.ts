import { releaseWebGLContext } from "./releaseWebGLContext.js";
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
/** Canvases created here, which may be parked when their chart is disposed. Caller-supplied canvases never are. */
const recyclable = new WeakSet<HTMLCanvasElement>();
/** The backend of a canvas that was just taken from the pool, for the renderer built on it to adopt. */
const handedOver = new WeakMap<HTMLCanvasElement, GpuBackend>();

function unpark(entry: Parked): void {
  entry.cancel();
  parked.splice(parked.indexOf(entry), 1);
}

function release(entry: Parked): void {
  unpark(entry);
  const gl = entry.backend.getContext?.();
  try {
    entry.backend.destroy();
  } finally {
    releaseWebGLContext(gl);
  }
}

function usable(backend: GpuBackend): boolean {
  return backend.getContext?.()?.isContextLost() === false;
}

/**
 * A canvas for a chart's plot area: a parked one from this document, reset so only its context and
 * backend carry over, or else a new one that may be parked later.
 */
export function acquirePlotCanvas(doc: Document): HTMLCanvasElement {
  for (const entry of [...parked]) {
    if (entry.canvas.ownerDocument !== doc) continue;
    if (!usable(entry.backend)) {
      release(entry);
      continue;
    }
    unpark(entry);
    const { canvas } = entry;
    // Drop what the last chart's layout and plugins put on the element (class, style, ARIA); size is set by the next chart.
    for (const name of canvas.getAttributeNames()) canvas.removeAttribute(name);
    handedOver.set(canvas, entry.backend);
    return canvas;
  }
  const canvas = doc.createElement("canvas");
  recyclable.add(canvas);
  return canvas;
}

/** The warm backend that came with a canvas from {@link acquirePlotCanvas}, once; `undefined` for any other canvas. */
export function adoptWarmBackend(canvas: HTMLCanvasElement): GpuBackend | undefined {
  const backend = handedOver.get(canvas);
  handedOver.delete(canvas);
  return backend;
}

/**
 * Park a disposed chart's canvas and backend for the next chart. Returns false when the canvas is not
 * one this module made or its context is unusable, and the caller must release it as usual.
 */
export function parkPlotCanvas(canvas: HTMLCanvasElement, backend: GpuBackend): boolean {
  if (!recyclable.has(canvas) || !usable(backend)) return false;
  // Leave the old chart's DOM and give the drawing buffer back; the next chart sizes the canvas again.
  canvas.remove();
  canvas.width = 1;
  canvas.height = 1;
  while (parked.length >= MAX_PARKED) release(parked[0]!);
  const entry: Parked = { canvas, backend, cancel: keepWarm(() => release(entry)) };
  parked.push(entry);
  return true;
}
