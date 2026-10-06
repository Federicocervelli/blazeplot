interface SharedSheet {
  readonly element: HTMLStyleElement;
  users: number;
}

/** One sheet per owning node (a document or a shadow root); the chart stylesheet is the only one. */
const sheets = new WeakMap<Node, SharedSheet>();

/**
 * Install the chart stylesheet once per owning document (or shadow root) instead of once per chart,
 * and remove it when the last chart using it releases it. `root` is the chart root element: a chart
 * inside a shadow root gets the sheet inside it, any other chart gets it in the document `head`.
 * Returns the release function; releasing twice is harmless.
 */
export function installSharedStyle(root: HTMLElement, className: string, css: string): () => void {
  const doc = root.ownerDocument;
  const rootNode = root.getRootNode?.();
  const scope: Node = rootNode && rootNode.nodeType === 11 ? rootNode : doc;
  const parent: Node | null = scope === doc ? (doc.head ?? doc.documentElement) : scope;
  if (!parent) return () => {};
  let shared = sheets.get(scope);
  if (!shared) {
    const element = doc.createElement("style");
    element.className = className;
    element.textContent = css;
    parent.appendChild(element);
    shared = { element, users: 0 };
    sheets.set(scope, shared);
  }
  shared.users++;
  const entry = shared;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.users > 0) return;
    entry.element.remove();
    sheets.delete(scope);
  };
}
