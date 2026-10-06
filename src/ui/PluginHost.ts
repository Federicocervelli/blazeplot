import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { PanIntent, ZoomIntent } from "../interaction/types.js";
import type { ChartEventMap, ChartEventName, ChartFrameStats, ChartHoverState, ChartInspectionTarget, ChartPickOptions, ChartSeriesState } from "./ChartEvents.js";
import type { ChartFitToDataOptions, ChartFollowXOptions, ChartFollowXState, ChartSetViewportOptions, ChartViewportGestureOptions } from "./ChartViewportTypes.js";
import type { ChartRendererInfo } from "../render/ChartRenderer.js";
import type { ResolvedChartTheme } from "./theme.js";
import type { ChartInternals } from "./ChartInternals.js";
import type { ChartLayoutReservation, ChartMountSlot, ChartPlugin, ChartPluginContext, ChartPluginCoords, ChartPluginDom, ChartPluginEvents, ChartPluginHandle, ChartPluginLayout, ChartPluginState, ChartPluginUnstable, ChartPluginViewport, ChartRect, ChartSurface, ChartSurfaceStyle } from "./PluginTypes.js";

/** @internal Chart capabilities the plugin host needs. */
export interface PluginHostChart {
  readonly theme: ResolvedChartTheme;
  readonly rootElement: HTMLElement;
  readonly rendererInfo: ChartRendererInfo;
  dataToPlot(x: number, y: number, yAxis?: SeriesYAxis): [number, number];
  clientToData(clientX: number, clientY: number, yAxis?: SeriesYAxis): [number, number] | null;
  getViewport(yAxis?: SeriesYAxis): Viewport;
  setViewport(viewport: Partial<Viewport>, yAxis?: SeriesYAxis, options?: ChartSetViewportOptions): void;
  pan(intent: PanIntent, yAxis?: SeriesYAxis, options?: ChartViewportGestureOptions): void;
  zoom(intent: ZoomIntent, yAxis?: SeriesYAxis, options?: ChartViewportGestureOptions): void;
  fitToData(options?: ChartFitToDataOptions): boolean;
  followX(options?: ChartFollowXOptions): void;
  stopFollowX(): void;
  setFollowXPaused(paused: boolean): void;
  getFollowXState(): ChartFollowXState;
  getSeriesState(): readonly ChartSeriesState[];
  getHoverState(): ChartHoverState | null;
  pick(clientX: number, clientY: number, options?: ChartPickOptions): ChartHoverState | null;
  getFrameStats(target?: ChartFrameStats): Readonly<ChartFrameStats>;
  requestRender(): void;
  subscribe<K extends ChartEventName>(event: K, callback: (payload: ChartEventMap[K]) => void): () => void;
}

/** @internal Chart internals the host needs beyond the public chart API. */
export interface PluginHostInternals {
  emit<K extends ChartEventName>(event: K, payload: ChartEventMap[K]): void;
  setLayoutReservation(id: string, reservation: ChartLayoutReservation | null): void;
  inspect(target: ChartInspectionTarget | null): ChartHoverState | null;
  getInspection(): ChartInspectionTarget | null;
  formatValue(value: number, axis: "x" | "y", yAxis?: SeriesYAxis): string;
  formatReadout(value: number, axis: "x" | "y", yAxis?: SeriesYAxis): string | null;
}

interface InstalledPlugin {
  handle: ChartPluginHandle | null;
  disposeFn: (() => void) | null;
  readonly cleanups: Array<() => void>;
  disposed: boolean;
}

type HookName = "onResize" | "onThemeChange" | "onContextLost" | "onContextRestored";

let nextReservationId = 1;

function toRect(rect: DOMRect): ChartRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

const TOUCH_GESTURES = ["pan-x", "pan-y", "pinch-zoom"] as const;

/** Intersect CSS `touch-action` values: only gestures every value allows stay with the browser. */
function intersectTouchActions(values: readonly string[]): string {
  let allowed: Set<string> = new Set(TOUCH_GESTURES);
  for (const value of values) {
    const own = new Set<string>();
    for (const token of value.trim().split(/\s+/)) {
      if (token === "auto" || token === "manipulation") for (const t of TOUCH_GESTURES) own.add(t);
      else if (token === "pan-left" || token === "pan-right") own.add("pan-x");
      else if (token === "pan-up" || token === "pan-down") own.add("pan-y");
      else if ((TOUCH_GESTURES as readonly string[]).includes(token)) own.add(token);
    }
    allowed = new Set([...allowed].filter((t) => own.has(t)));
  }
  if (allowed.size === 0) return "none";
  if (allowed.size === TOUCH_GESTURES.length) return "auto";
  return TOUCH_GESTURES.filter((t) => allowed.has(t)).join(" ");
}

/**
 * @internal Installs plugins, builds their contexts, runs lifecycle hooks in registration order,
 * and disposes in reverse order.
 */
export class PluginHost {
  private readonly installed: InstalledPlugin[] = [];

  private readonly touchActions = new Map<HTMLElement, { readonly base: string; readonly values: string[] }>();
  private readonly pointerClaims = new Map<number, InstalledPlugin>();
  private claimListening = false;

  constructor(private readonly chart: PluginHostChart, private readonly access: ChartInternals, private readonly internals: PluginHostInternals) {}

  private readonly releaseClaim = (event: Event): void => {
    this.pointerClaims.delete((event as PointerEvent).pointerId);
    this.syncClaimListeners();
  };

  /** Listen for pointer release only while some pointer is claimed. */
  private syncClaimListeners(): void {
    const wanted = this.pointerClaims.size > 0;
    if (wanted === this.claimListening) return;
    this.claimListening = wanted;
    const root = this.chart.rootElement;
    for (const type of ["pointerup", "pointercancel"]) {
      if (wanted) root.addEventListener(type, this.releaseClaim, true);
      else root.removeEventListener(type, this.releaseClaim, true);
    }
  }

  /**
   * `touch-action` decorations combine by intersection, so the most restrictive plugin wins
   * whatever the install order: `none` beats `pan-y`, and `pan-y` beats `auto`.
   */
  private claimTouchAction(target: HTMLElement, value: string): () => void {
    let entry = this.touchActions.get(target);
    if (!entry) {
      entry = { base: target.style.touchAction, values: [] };
      this.touchActions.set(target, entry);
    }
    const state = entry;
    state.values.push(value);
    const apply = (): void => {
      target.style.touchAction = state.values.length === 0 ? state.base : intersectTouchActions(state.values);
    };
    apply();
    return () => {
      const index = state.values.indexOf(value);
      if (index !== -1) state.values.splice(index, 1);
      apply();
      if (state.values.length === 0) this.touchActions.delete(target);
    };
  }

  private claimPointer(entry: InstalledPlugin, event: PointerEvent): boolean {
    const owner = this.pointerClaims.get(event.pointerId);
    if (owner && owner !== entry && !owner.disposed) return false;
    this.pointerClaims.set(event.pointerId, entry);
    this.syncClaimListeners();
    return true;
  }

  /** Install one plugin. Returns a function that disposes just this plugin. */
  install(plugin: ChartPlugin): () => void {
    const entry: InstalledPlugin = { handle: null, disposeFn: null, cleanups: [], disposed: false };
    const ctx = this.createContext(entry);
    let result: ReturnType<ChartPlugin["install"]>;
    try {
      result = plugin.install(ctx);
    } catch (error) {
      this.runCleanups(entry);
      throw error;
    }
    if (typeof result === "function") entry.disposeFn = result;
    else if (result && typeof result === "object") entry.handle = result;
    this.installed.push(entry);
    return () => {
      const index = this.installed.indexOf(entry);
      if (index !== -1) this.installed.splice(index, 1);
      this.disposeEntry(entry);
    };
  }

  /** Call a lifecycle hook on every installed plugin, in registration order. */
  notify<K extends HookName>(hook: K, ...args: Parameters<NonNullable<ChartPluginHandle[K]>>): void {
    // Snapshot: a hook may dispose a plugin.
    for (const entry of this.installed.slice()) {
      const fn = entry.handle?.[hook] as ((...hookArgs: typeof args) => void) | undefined;
      if (entry.disposed || !fn) continue;
      try {
        fn.apply(entry.handle, args);
      } catch (error) {
        console.error(`BlazePlot plugin ${hook} hook failed:`, error);
      }
    }
  }

  /** Dispose every plugin in reverse registration order. Cleanup errors never stop later plugins. */
  disposeAll(): void {
    for (const entry of this.installed.splice(0).reverse()) this.disposeEntry(entry);
  }

  private disposeEntry(entry: InstalledPlugin): void {
    if (entry.disposed) return;
    entry.disposed = true;
    try {
      if (entry.disposeFn) entry.disposeFn();
      else entry.handle?.dispose?.();
    } catch (error) {
      // Plugin cleanup must not prevent other plugins or chart-owned resources from being released.
      console.error("BlazePlot plugin dispose failed:", error);
    }
    this.runCleanups(entry);
    for (const [pointerId, owner] of this.pointerClaims) if (owner === entry) this.pointerClaims.delete(pointerId);
    this.syncClaimListeners();
  }

  private runCleanups(entry: InstalledPlugin): void {
    for (const cleanup of entry.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        // Keep releasing the remaining resources.
        console.error("BlazePlot plugin cleanup failed:", error);
      }
    }
  }

  private surfaceElement(slot: ChartMountSlot | ChartSurface): HTMLElement {
    const chart = this.chart;
    switch (slot) {
      case "plot": return this.access.plotElement;
      case "root": return chart.rootElement;
      case "axis-x": return this.access.xAxisElement;
      case "axis-y": return this.access.yAxisElement;
      case "axis-y2": return this.access.y2AxisElement;
      case "body": return chart.rootElement.ownerDocument.body ?? chart.rootElement;
    }
  }

  /** Input target for a surface: the plot surface is the canvas, which sits above the plot element. */
  private surfaceTarget(surface: ChartSurface): HTMLElement {
    return surface === "plot" ? this.access.canvas : this.surfaceElement(surface);
  }

  private createContext(entry: InstalledPlugin): ChartPluginContext {
    const chart = this.chart;
    const access = this.access;
    const internals = this.internals;
    const track = (cleanup: () => void): (() => void) => {
      let done = false;
      const once = (): void => {
        if (done) return;
        done = true;
        const index = entry.cleanups.indexOf(once);
        if (index !== -1) entry.cleanups.splice(index, 1);
        cleanup();
      };
      entry.cleanups.push(once);
      return once;
    };
    const plotClientRect = (): ChartRect => toRect(access.canvas.getBoundingClientRect());

    const coords: ChartPluginCoords = {
      dataToPlot: (x, y, yAxis) => chart.dataToPlot(x, y, yAxis),
      clientToData: (clientX, clientY, yAxis) => chart.clientToData(clientX, clientY, yAxis),
      clientToPlot: (clientX, clientY) => {
        const rect = plotClientRect();
        return [clientX - rect.left, clientY - rect.top];
      },
      plotToClient: (plotX, plotY) => {
        const rect = plotClientRect();
        return [rect.left + plotX, rect.top + plotY];
      },
      format: (value, axis, yAxis) => internals.formatValue(value, axis, yAxis),
      formatReadout: (value, axis, yAxis) => internals.formatReadout(value, axis, yAxis),
    };

    const viewport: ChartPluginViewport = {
      get: (yAxis) => chart.getViewport(yAxis),
      set: (next, yAxis, options) => chart.setViewport(next, yAxis, options),
      pan: (intent, yAxis, options) => chart.pan(intent, yAxis, options),
      zoom: (intent, yAxis, options) => chart.zoom(intent, yAxis, options),
      fitToData: (options) => chart.fitToData(options),
      isReversed: (axis, yAxis) => {
        const camera = access.getCamera(yAxis);
        return axis === "x" ? camera.xReversed : camera.yReversed;
      },
      followX: (options) => chart.followX(options),
      stopFollowX: () => chart.stopFollowX(),
      setFollowXPaused: (paused) => chart.setFollowXPaused(paused),
      getFollowXState: () => chart.getFollowXState(),
    };

    const state: ChartPluginState = {
      getSeries: () => chart.getSeriesState(),
      getHover: () => chart.getHoverState(),
      pick: (clientX, clientY, options) => chart.pick(clientX, clientY, options),
      getFrameStats: (target) => chart.getFrameStats(target),
      inspect: (target) => internals.inspect(target),
      getInspection: () => internals.getInspection(),
    };

    const layout: ChartPluginLayout = {
      plotRect: plotClientRect,
      rootRect: () => toRect(chart.rootElement.getBoundingClientRect()),
      reserve: (reservation) => {
        const id = `plugin-reservation-${nextReservationId++}`;
        internals.setLayoutReservation(id, reservation);
        return track(() => internals.setLayoutReservation(id, null));
      },
    };

    const ownerDocument = chart.rootElement.ownerDocument;
    const dom: ChartPluginDom = {
      document: ownerDocument,
      view: ownerDocument.defaultView ?? (globalThis as Window & typeof globalThis),
      create: (tag) => ownerDocument.createElement(tag),
      createSvg: (tag) => ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag),
      mount: (slot, element) => {
        this.surfaceElement(slot).appendChild(element);
        return track(() => element.remove());
      },
      listen: (surface, type, listener, options) => {
        const target = this.surfaceTarget(surface);
        const handler = listener as EventListener;
        target.addEventListener(type, handler, options);
        return track(() => target.removeEventListener(type, handler, options));
      },
      decorate: (surface, decoration) => {
        const target = this.surfaceTarget(surface);
        const restore: Array<() => void> = [];
        for (const [property, value] of Object.entries(decoration.style ?? {}) as Array<[keyof ChartSurfaceStyle, string | undefined]>) {
          if (value === undefined) continue;
          if (property === "touchAction") {
            restore.push(this.claimTouchAction(target, value));
            continue;
          }
          const previous = target.style[property];
          target.style[property] = value;
          restore.push(() => {
            target.style[property] = previous;
          });
        }
        for (const className of decoration.classes ?? []) {
          if (target.classList.contains(className)) continue;
          target.classList.add(className);
          restore.push(() => target.classList.remove(className));
        }
        for (const [name, value] of Object.entries(decoration.attributes ?? {})) {
          const previous = target.getAttribute(name);
          target.setAttribute(name, value);
          restore.push(() => {
            if (previous === null) target.removeAttribute(name);
            else target.setAttribute(name, previous);
          });
        }
        return track(() => {
          for (const undo of restore.reverse()) undo();
        });
      },
      claimPointer: (event) => this.claimPointer(entry, event),
      contains: (target) => {
        const root = chart.rootElement;
        return target === root || (target !== null && target !== undefined && (target as Node).nodeType !== undefined && root.contains(target as Node));
      },
    };

    const events: ChartPluginEvents = {
      subscribe: (event, callback) => track(chart.subscribe(event, callback)),
      emit: (event, payload) => internals.emit(event, payload as ChartEventMap[typeof event]),
    };

    const unstable: ChartPluginUnstable = {
      get canvas() {
        return access.canvas;
      },
      element: (slot) => this.surfaceElement(slot),
      getWebGLContext: () => access.getWebGLContext(),
      createRenderSurface: (canvas) => {
        const surface = access.createRenderSurface(canvas);
        track(() => surface.dispose());
        return surface;
      },
      getCamera: (yAxis) => access.getCamera(yAxis),
    };

    return {
      get theme() {
        return chart.theme;
      },
      get renderer() {
        return chart.rendererInfo;
      },
      coords,
      viewport,
      state,
      layout,
      dom,
      events,
      requestRender: () => chart.requestRender(),
      unstable,
    };
  }
}
