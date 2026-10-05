import type { ChartPlugin, ChartPluginContext } from "./PluginHost.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Create an SVG element in the SVG namespace. */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, tag);
}

/** Narrow an event target to an `Element` without `instanceof`, so nodes from another window (iframe, popup) pass. */
export function asElement(target: EventTarget | null | undefined): Element | null {
  return target && (target as Node).nodeType === 1 ? (target as Element) : null;
}

/** Clamp a number to an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Shared absolute overlay layer options. */
export interface OverlayLayerOptions {
  readonly zIndex?: number | string;
  readonly display?: string;
  readonly inset?: string;
  readonly pointerEvents?: string;
}

/** Create a plot overlay layer with consistent positioning and pointer behavior. */
export function createOverlayLayer(doc: Document, className: string, options: OverlayLayerOptions = {}): HTMLDivElement {
  const layer = doc.createElement("div");
  layer.className = className;
  layer.style.position = "absolute";
  if (options.inset !== undefined) layer.style.inset = options.inset;
  layer.style.display = options.display ?? "none";
  layer.style.pointerEvents = options.pointerEvents ?? "none";
  if (options.zIndex !== undefined) layer.style.zIndex = String(options.zIndex);
  return layer;
}

/** Position a fixed element near a client point while keeping it onscreen. */
export function placeFixedWithinViewport(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  options: { readonly offsetX: number; readonly offsetY: number; readonly margin?: number; readonly size?: { readonly width: number; readonly height: number } },
): void {
  const rect = options.size ?? element.getBoundingClientRect();
  const margin = options.margin ?? 4;
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const viewportWidth = Math.max(1, view?.innerWidth || doc.documentElement.clientWidth);
  const viewportHeight = Math.max(1, view?.innerHeight || doc.documentElement.clientHeight);
  const x = clamp(clientX + options.offsetX, margin, Math.max(margin, viewportWidth - rect.width - margin));
  const y = clamp(clientY + options.offsetY, margin, Math.max(margin, viewportHeight - rect.height - margin));
  element.style.transform = `translate(${x}px, ${y}px)`;
}

interface SharedStyle {
  readonly element: HTMLStyleElement;
  users: number;
}

const sharedStyles = new WeakMap<Node, Map<string, SharedStyle>>();

/**
 * Inject a plugin's stylesheet once per owning document (or shadow root) instead of once per chart,
 * and remove it when the last chart using it is disposed. Returns the release function; call it
 * from the plugin's dispose. `id` names the stylesheet and dedupes across plugins that share rules.
 */
export function installPluginStyle(chart: ChartPluginContext, id: string, css: string): () => void {
  const doc = chart.dom.document;
  // Probe the chart's root node through the stable mount API (a shadow root scopes selectors).
  const probe = chart.dom.create("span");
  const unmountProbe = chart.dom.mount("root", probe);
  const rootNode = probe.getRootNode?.();
  unmountProbe();
  // A chart inside a shadow root needs the sheet inside it.
  const scope: Node = rootNode && rootNode.nodeType === 11 ? rootNode : doc;
  const parent: Node | null = scope === doc ? (doc.head ?? doc.documentElement) : scope;
  if (!parent) return () => {};
  let styles = sharedStyles.get(scope);
  if (!styles) {
    styles = new Map();
    sharedStyles.set(scope, styles);
  }
  let shared = styles.get(id);
  if (!shared) {
    const element = doc.createElement("style");
    element.setAttribute("data-blazeplot-plugin-style", id);
    element.textContent = css;
    parent.appendChild(element);
    shared = { element, users: 0 };
    styles.set(id, shared);
  }
  shared.users++;
  const entry = shared;
  const registry = styles;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.users > 0) return;
    entry.element.remove();
    registry.delete(id);
  };
}

/** Modifier that must be held to start a plot drag gesture. `"none"` means no modifier key at all. */
export type DragModifier = "none" | "shift" | "alt" | "ctrl";

/** Whether a press carries exactly the modifier a drag gesture is configured for. */
export function dragModifierMatches(event: PointerEvent, modifier: DragModifier | undefined): boolean {
  const ctrl = event.ctrlKey || event.metaKey;
  switch (modifier) {
    case "shift": return event.shiftKey && !event.altKey && !ctrl;
    case "alt": return event.altKey && !event.shiftKey && !ctrl;
    case "ctrl": return ctrl && !event.shiftKey && !event.altKey;
    default: return !event.shiftKey && !event.altKey && !ctrl;
  }
}

/**
 * Make a stateful plugin instance installable on one chart at a time. These plugins keep per-chart
 * state in their factory closure, so a second install would silently corrupt the first chart.
 * Installing an instance that is still installed throws; disposing the chart (or the plugin) frees it.
 */
export function singleChartPlugin<P extends ChartPlugin>(name: string, plugin: P): P {
  const install = plugin.install.bind(plugin);
  let installed = false;
  plugin.install = (ctx) => {
    if (installed) {
      throw new Error(`${name} plugin instance is already installed on a chart. Create one plugin instance per chart.`);
    }
    installed = true;
    const release = (): void => {
      installed = false;
    };
    let result: ReturnType<ChartPlugin["install"]>;
    try {
      result = install(ctx);
    } catch (error) {
      release();
      throw error;
    }
    if (typeof result === "function") {
      const dispose = result;
      return () => {
        release();
        dispose();
      };
    }
    if (result && typeof result === "object") {
      const dispose = result.dispose?.bind(result);
      result.dispose = () => {
        release();
        dispose?.();
      };
      return result;
    }
    return release;
  };
  return plugin;
}
