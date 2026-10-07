/**
 * A chart's pending first plot-size read.
 *
 * Reading `clientWidth` forces the browser to lay the page out if anything changed since the last
 * layout. Charts mounted in one task all draw their first frame in the same animation frame, and each
 * first frame writes DOM (tick labels, canvas size), so when every chart reads its own plot size at
 * its turn, chart N's read lays out the DOM chart N-1 just wrote: one layout per chart. Instead the
 * first chart to run in a frame reads the size of every chart that is waiting for its first frame, in
 * one pass with nothing written in between (a single layout), and each chart then uses the size that
 * was read for it.
 */
export interface PlotSizeRead {
  /** The element whose client size is the plot size (the plot canvas). */
  readonly element: HTMLElement;
  /** Receives the size; the chart's own cached plot size. */
  readonly size: { width: number; height: number };
  /** Set when a batch wrote `size`; the chart clears it when it has applied that size to its drawing buffer. */
  read: boolean;
}

const queues = new WeakMap<object, Set<PlotSizeRead>>();

/** Mark `entry` as waiting for its first frame, so the next frame's batch reads its size. */
export function queuePlotRead(view: object, entry: PlotSizeRead): void {
  let queue = queues.get(view);
  if (!queue) queues.set(view, (queue = new Set()));
  queue.add(entry);
}

/** Stop waiting (the chart stopped, was disposed, or measured itself). Harmless when not queued. */
export function unqueuePlotRead(view: object, entry: PlotSizeRead): void {
  queues.get(view)?.delete(entry);
}

/** Read the size of every queued plot back to back, then empty the queue. Call at the start of an animation frame. */
export function readQueuedPlots(view: object): void {
  const queue = queues.get(view);
  if (!queue || queue.size === 0) return;
  for (const entry of queue) {
    entry.size.width = entry.element.clientWidth;
    entry.size.height = entry.element.clientHeight;
    entry.read = true;
  }
  queue.clear();
}
