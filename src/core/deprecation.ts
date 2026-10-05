const warned = new Set<string>();

function isProduction(): boolean {
  // Written as a literal `process.env.NODE_ENV` so consumer bundlers can replace and tree-shake it.
  // The try/catch covers unbundled browser use, where `process` does not exist.
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

/**
 * @internal Warn once per page load per `id` that a deprecated API was used. Development only: silent
 * when `process.env.NODE_ENV === "production"`. Call from constructors, option parsing, and one-off
 * calls, never from per-frame or per-append code. `message` should read like
 * `chart.foo() is deprecated since 1.3.0; use chart.bar() instead. It will be removed in 2.0.0.`
 */
export function warnDeprecated(id: string, message: string): void {
  if (isProduction() || warned.has(id)) return;
  warned.add(id);
  console.warn(`BlazePlot: ${message}`);
}

/**
 * @internal Log a development-only warning (silent when `process.env.NODE_ENV === "production"`). The caller
 * owns the once-only logic, for example one warning per chart. Never call from per-frame or per-append code.
 */
export function devWarn(message: string): void {
  if (!isProduction()) console.warn(`BlazePlot: ${message}`);
}

/** @internal Test hook: forget which deprecation ids have already warned. */
export function resetDeprecationWarnings(): void {
  warned.clear();
}
