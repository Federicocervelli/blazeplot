/**
 * @internal Throw an actionable `TypeError` unless `target` is a DOM element, so `new Chart(null)` (for
 * example `document.getElementById` before the element exists) fails with a clear message instead of a
 * property access error from deep inside the layout.
 */
export function assertChartTarget(caller: string, target: unknown): asserts target is HTMLElement {
  const element = target as { nodeType?: unknown; ownerDocument?: unknown } | null | undefined;
  if (typeof element === "object" && element !== null && element.nodeType === 1 && element.ownerDocument) return;
  const got = target === null ? "null" : typeof target === "string" ? "a string; pass the element, not a selector" : typeof target;
  throw new TypeError(`${caller}: target must be an HTMLElement (got ${got}). Is the element mounted?`);
}
