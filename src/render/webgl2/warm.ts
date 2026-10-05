/**
 * Short-lived "warm" GPU resources.
 *
 * A WebGL2 context is expensive to create (a synchronous round trip to the GPU process, then compiling
 * the programs) and a little expensive to release, so an engine that is about to be needed again soon,
 * such as the next chart of a page that mounts and unmounts charts, keeps its context for a moment
 * instead. `keepWarm` is the one place that decides how long: a warm resource is released after
 * {@link WARM_IDLE_MS} unless it is taken back first, so a page that stops creating charts ends up
 * with no contexts, as if nothing had been kept.
 */

/** How long a warm resource waits to be reused before it is released. */
export const WARM_IDLE_MS = 2_000;

const waiting = new Set<() => void>();

/**
 * Release `release` after {@link WARM_IDLE_MS}. Returns a function that cancels it (the resource was
 * reused or released early); `releaseWarm` runs every pending release at once.
 */
export function keepWarm(release: () => void): () => void {
  const run = (): void => {
    cancel();
    release();
  };
  const timer = setTimeout(run, WARM_IDLE_MS);
  const cancel = (): void => {
    clearTimeout(timer);
    waiting.delete(run);
  };
  waiting.add(run);
  return cancel;
}

/** @internal Release everything kept warm now. For tests and for pages that must show no live contexts. */
export function releaseWarm(): void {
  for (const run of waiting) run();
}
