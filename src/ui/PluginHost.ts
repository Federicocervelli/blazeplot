import type { SeriesYAxis, Viewport } from "../core/types.js";
import type { Camera2D } from "../interaction/Camera2D.js";
import type { PanIntent, ZoomIntent } from "../interaction/types.js";
import type {
  ChartEventMap,
  ChartEventName,
  ChartFitToDataOptions,
  ChartFollowXOptions,
  ChartFrameStats,
  ChartHoverState,
  ChartInspectionTarget,
  ChartPickOptions,
  ChartSelectEvent,
  ChartSeriesState,
  ChartXFollowState,
} from "./Chart.js";
import type { ResolvedChartTheme } from "./theme.js";

/**
 * Where a plugin can attach its own DOM with `ctx.dom.mount(slot, element)`.
 *
 * - `"plot"`: the plot area, above the WebGL canvas. Coordinates match `ctx.coords` plot
 *   coordinates (CSS pixels from the plot's top-left). Overlays here should keep
 *   `pointer-events: none` unless they handle their own input.
 * - `"root"`: the whole chart box, including axis gutters and space reserved with
 *   `ctx.layout.reserve(...)`. Use it for legends, toolbars, and navigators.
 * - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters (bottom, left, right).
 * - `"body"`: the owning document's `<body>`, for `position: fixed` UI such as tooltips that
 *   must escape the chart's `overflow: hidden`.
 */
export type ChartMountSlot = "plot" | "root" | "axis-x" | "axis-y" | "axis-y2" | "body";

/**
 * Chart-owned element a plugin can listen on or decorate with `ctx.dom.listen` and `ctx.dom.decorate`.
 *
 * - `"plot"`: the interactive plot surface (it receives pointer, wheel, and touch input).
 * - `"root"`: the chart root; it is focusable and receives keyboard input when accessibility is enabled.
 * - `"axis-x"`, `"axis-y"`, `"axis-y2"`: the outside axis gutters. They ignore pointer input
 *   until a plugin decorates them with `pointerEvents: "auto"`.
 */
export type ChartSurface = "plot" | "root" | "axis-x" | "axis-y" | "axis-y2";

/** Inline style properties a plugin may set on a chart surface. */
export interface ChartSurfaceStyle {
  readonly cursor?: string;
  readonly touchAction?: string;
  readonly pointerEvents?: string;
  readonly filter?: string;
  readonly outline?: string;
  readonly outlineOffset?: string;
}

/** Styles, classes, and attributes applied to a chart surface by `ctx.dom.decorate`. */
export interface ChartSurfaceDecoration {
  readonly style?: ChartSurfaceStyle;
  readonly classes?: readonly string[];
  readonly attributes?: Readonly<Record<string, string>>;
}

/** A rectangle in CSS pixels. */
export interface ChartRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Plot-area size in CSS pixels, passed to `ChartPluginHandle.onResize`. */
export interface ChartPlotSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Extra CSS-pixel space reserved around the plot by a plugin, e.g. for a navigator or toolbar.
 * Reservations from every plugin add up.
 */
export interface ChartLayoutReservation {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/**
 * Events plugins may emit with `ctx.events.emit(...)`. Chart users receive them through
 * `chart.subscribe(...)`, because `ChartEventMap` extends this map.
 *
 * Third-party plugins add their own events with declaration merging. Prefix names with your
 * plugin name to avoid collisions:
 *
 * ```ts
 * declare module "blazeplot" {
 *   interface ChartPluginEventMap {
 *     "my-plugin:change": { readonly value: number };
 *   }
 * }
 * ```
 */
export interface ChartPluginEventMap {
  /** A selection was committed or cleared. Emitted by `selectionPlugin` and linked layouts. */
  select: ChartSelectEvent;
}

/** Name of an event a plugin may emit. */
export type ChartPluginEventName = keyof ChartPluginEventMap;

/** Coordinate conversions between data, plot, and client (viewport) space. */
export interface ChartPluginCoords {
  /** Data coordinates to plot-local CSS pixels, using the axis scales. */
  dataToPlot(x: number, y: number, yAxis?: SeriesYAxis): [number, number];
  /** Client coordinates (e.g. `event.clientX/Y`) to data coordinates, or `null` outside the plot. */
  clientToData(clientX: number, clientY: number, yAxis?: SeriesYAxis): [number, number] | null;
  /** Client coordinates to plot-local CSS pixels. Points outside the plot are not clamped. */
  clientToPlot(clientX: number, clientY: number): [number, number];
  /** Plot-local CSS pixels to client coordinates. */
  plotToClient(plotX: number, plotY: number): [number, number];
  /**
   * Format a data value the way the axis labels it (tick format, time, categorical, or custom
   * scale formatting). Use it for text that should match the axes, such as announcements.
   */
  format(value: number, axis: "x" | "y", yAxis?: SeriesYAxis): string;
}

/** Viewport reads, changes, and latest-X follow control. Changes go through the chart's `ViewportPolicy`. */
export interface ChartPluginViewport {
  /** Visible data domain for the requested Y axis (defaults to `"left"`). */
  get(yAxis?: SeriesYAxis): Viewport;
  /** Set any viewport edges. X is shared by both Y axes; changing X pauses latest-X following. */
  set(viewport: Partial<Viewport>, yAxis?: SeriesYAxis): void;
  /** Pan in scale space. Omit `yAxis` to pan Y on both axes like a plot gesture. */
  pan(intent: PanIntent, yAxis?: SeriesYAxis): void;
  /** Zoom in scale space around a normalized anchor. Omit `yAxis` to zoom Y on both axes. */
  zoom(intent: ZoomIntent, yAxis?: SeriesYAxis): void;
  /** Fit the viewport to data bounds; returns `false` when nothing changed. */
  fitToData(options?: ChartFitToDataOptions): boolean;
  /** Whether an axis runs right-to-left (`"x"`) or top-to-bottom (`"y"`) on screen. */
  isReversed(axis: "x" | "y", yAxis?: SeriesYAxis): boolean;
  /** Keep the X viewport on the latest data, replacing any previous follow options. */
  follow(options?: ChartFollowXOptions): void;
  /** Disable latest-X following. */
  stopFollow(): void;
  /** Pause or resume latest-X following without changing its options. */
  setFollowPaused(paused: boolean): void;
  getFollowState(): ChartXFollowState;
}

/** Read-only chart state. */
export interface ChartPluginState {
  /** Metadata for every attached series, in draw order. */
  getSeries(): ChartSeriesState[];
  /** The current hover state, or `null` when nothing is hovered. */
  getHover(): ChartHoverState | null;
  /** Hit-test a client point against visible series. */
  pick(clientX: number, clientY: number, options?: ChartPickOptions): ChartHoverState | null;
  /** Copy the latest render metrics into `target` and return it. */
  getFrameStats(target?: ChartFrameStats): ChartFrameStats;
  /**
   * Show one sample as the chart's hover state, as if the pointer were on it, so the tooltip,
   * crosshair, and `hover` subscribers follow a keyboard cursor. The state has
   * `source: "inspection"` and the sample as `items[0]`, and is re-projected every frame.
   * Pass `null` to end inspection; a pointer moving over the plot also ends it. Returns the new
   * hover state, which is `null` while the sample is hidden, a gap, or outside the plot.
   * Throws a `RangeError` for a series that is not on this chart or an index outside it.
   */
  inspect(target: ChartInspectionTarget | null): ChartHoverState | null;
  /** The sample being inspected, or `null` when no inspection is active. */
  getInspection(): ChartInspectionTarget | null;
}

/** Layout geometry and space reservations. */
export interface ChartPluginLayout {
  /** The plot area in client (viewport) coordinates. */
  plotRect(): ChartRect;
  /** The whole chart box (the `"root"` slot) in client coordinates. */
  rootRect(): ChartRect;
  /** Reserve space around the plot. Returns a function that releases the reservation. */
  reserve(reservation: ChartLayoutReservation): () => void;
}

/** DOM attachment and input on chart-owned elements. Everything is released when the plugin is disposed. */
export interface ChartPluginDom {
  /** Append `element` to a mount slot. Returns a function that removes it. */
  mount(slot: ChartMountSlot, element: Element): () => void;
  /** Listen for a DOM event on a chart surface. Returns a function that removes the listener. */
  listen<K extends keyof HTMLElementEventMap>(
    surface: ChartSurface,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
  /**
   * Apply styles, classes, and attributes to a chart surface. Returns a function that restores
   * the previous values; undo decorations in reverse order when several touch the same property.
   */
  decorate(surface: ChartSurface, decoration: ChartSurfaceDecoration): () => void;
  /** Whether `target` is inside the chart (its root element or a descendant). */
  contains(target: EventTarget | null | undefined): boolean;
}

/** Chart event subscription and typed plugin events. */
export interface ChartPluginEvents {
  /** Subscribe to a chart or plugin event. Returns an unsubscribe function. */
  subscribe<K extends ChartEventName>(event: K, callback: (payload: ChartEventMap[K]) => void): () => void;
  /** Emit a plugin event to every subscriber on this chart. */
  emit<K extends ChartPluginEventName>(event: K, payload: ChartPluginEventMap[K]): void;
}

/**
 * Escape hatches outside the stable plugin contract.
 *
 * @experimental May change in a minor release. See docs/stability.md.
 */
export interface ChartPluginUnstable {
  /** The chart's WebGL canvas. Prefer `ctx.dom` and `ctx.layout`. */
  readonly canvas: HTMLCanvasElement;
  /** Raw element behind a mount slot or surface. Prefer `ctx.dom.mount`, `listen`, and `decorate`. */
  element(slot: ChartMountSlot | ChartSurface): HTMLElement;
  /** The chart's WebGL2 context. The chart may recreate GPU state after context loss. */
  getWebGLContext(): WebGL2RenderingContext | null;
  /** The camera for a Y axis. Mutating it bypasses `ViewportPolicy`; prefer `ctx.viewport`. */
  getCamera(yAxis?: SeriesYAxis): Camera2D;
}

/**
 * The API a plugin receives in `install(ctx)`. Each plugin gets its own context; listeners,
 * subscriptions, mounted elements, decorations, and layout reservations created through it are
 * released automatically after the plugin is disposed.
 */
export interface ChartPluginContext {
  /** The resolved theme currently used by the chart. Re-read it in `onThemeChange`. */
  readonly theme: ResolvedChartTheme;
  readonly coords: ChartPluginCoords;
  readonly viewport: ChartPluginViewport;
  readonly state: ChartPluginState;
  readonly layout: ChartPluginLayout;
  readonly dom: ChartPluginDom;
  readonly events: ChartPluginEvents;
  /** Schedule a frame. Chart-owned changes already request one. */
  requestRender(): void;
  /** @experimental Escape hatches; see `ChartPluginUnstable`. */
  readonly unstable: ChartPluginUnstable;
}

/**
 * Object a plugin's `install` may return. Every member is optional.
 *
 * Hooks run in plugin registration order; `dispose` runs in reverse registration order.
 */
export interface ChartPluginHandle {
  /** Release plugin-owned resources. Runs once, from `chart.dispose()` or a failed install. */
  dispose?(): void;
  /** The plot area changed size (including device-pixel-ratio changes). */
  onResize?(size: ChartPlotSize): void;
  /** `chart.setTheme(...)` replaced the theme. Runs before the `themechange` event. */
  onThemeChange?(theme: ResolvedChartTheme): void;
  /** The chart's WebGL context was lost. The chart stops drawing until it is restored. */
  onContextLost?(): void;
  /** The chart's WebGL context was restored and its GPU resources rebuilt. */
  onContextRestored?(): void;
}

/** Plugin installer for extending chart behavior. */
export interface ChartPlugin {
  /**
   * Called once when the chart is constructed, in the order plugins appear in `ChartOptions.plugins`.
   * Return nothing, a cleanup function, or a `ChartPluginHandle`.
   */
  install(ctx: ChartPluginContext): void | (() => void) | ChartPluginHandle;
}

/** @internal Chart capabilities the plugin host needs. */
export interface PluginHostChart {
  readonly theme: ResolvedChartTheme;
  readonly canvas: HTMLCanvasElement;
  readonly rootElement: HTMLElement;
  readonly plotElement: HTMLElement;
  readonly xAxisElement: HTMLElement;
  readonly yAxisElement: HTMLElement;
  readonly y2AxisElement: HTMLElement;
  getWebGLContext(): WebGL2RenderingContext | null;
  getCamera(yAxis?: SeriesYAxis): Camera2D;
  dataToPlot(x: number, y: number, yAxis?: SeriesYAxis): [number, number];
  clientToData(clientX: number, clientY: number, yAxis?: SeriesYAxis): [number, number] | null;
  getViewport(yAxis?: SeriesYAxis): Viewport;
  setViewport(viewport: Partial<Viewport>, yAxis?: SeriesYAxis): void;
  pan(intent: PanIntent, yAxis?: SeriesYAxis): void;
  zoom(intent: ZoomIntent, yAxis?: SeriesYAxis): void;
  fitToData(options?: ChartFitToDataOptions): boolean;
  followLatestX(options?: ChartFollowXOptions): void;
  stopFollowingLatestX(): void;
  setXFollowPaused(paused: boolean): void;
  getXFollowState(): ChartXFollowState;
  getSeriesState(): ChartSeriesState[];
  getHoverState(): ChartHoverState | null;
  pick(clientX: number, clientY: number, options?: ChartPickOptions): ChartHoverState | null;
  getFrameStats(target?: ChartFrameStats): ChartFrameStats;
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

/**
 * @internal Installs plugins, builds their contexts, runs lifecycle hooks in registration order,
 * and disposes in reverse order.
 */
export class PluginHost {
  private readonly installed: InstalledPlugin[] = [];

  constructor(private readonly chart: PluginHostChart, private readonly internals: PluginHostInternals) {}

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
    } catch {
      // Plugin cleanup must not prevent other plugins or chart-owned resources from being released.
    }
    this.runCleanups(entry);
  }

  private runCleanups(entry: InstalledPlugin): void {
    for (const cleanup of entry.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
        // Keep releasing the remaining resources.
      }
    }
  }

  private surfaceElement(slot: ChartMountSlot | ChartSurface): HTMLElement {
    const chart = this.chart;
    switch (slot) {
      case "plot": return chart.plotElement;
      case "root": return chart.rootElement;
      case "axis-x": return chart.xAxisElement;
      case "axis-y": return chart.yAxisElement;
      case "axis-y2": return chart.y2AxisElement;
      case "body": return chart.rootElement.ownerDocument.body ?? chart.rootElement;
    }
  }

  /** Input target for a surface: the plot surface is the canvas, which sits above the plot element. */
  private surfaceTarget(surface: ChartSurface): HTMLElement {
    return surface === "plot" ? this.chart.canvas : this.surfaceElement(surface);
  }

  private createContext(entry: InstalledPlugin): ChartPluginContext {
    const chart = this.chart;
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
    const plotClientRect = (): ChartRect => toRect(chart.canvas.getBoundingClientRect());

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
    };

    const viewport: ChartPluginViewport = {
      get: (yAxis) => chart.getViewport(yAxis),
      set: (next, yAxis) => chart.setViewport(next, yAxis),
      pan: (intent, yAxis) => chart.pan(intent, yAxis),
      zoom: (intent, yAxis) => chart.zoom(intent, yAxis),
      fitToData: (options) => chart.fitToData(options),
      isReversed: (axis, yAxis) => {
        const camera = chart.getCamera(yAxis);
        return axis === "x" ? camera.xReversed : camera.yReversed;
      },
      follow: (options) => chart.followLatestX(options),
      stopFollow: () => chart.stopFollowingLatestX(),
      setFollowPaused: (paused) => chart.setXFollowPaused(paused),
      getFollowState: () => chart.getXFollowState(),
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

    const dom: ChartPluginDom = {
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
      contains: (target) => {
        const root = chart.rootElement;
        return target === root || (typeof Node !== "undefined" && target instanceof Node && root.contains(target));
      },
    };

    const events: ChartPluginEvents = {
      subscribe: (event, callback) => track(chart.subscribe(event, callback)),
      emit: (event, payload) => internals.emit(event, payload as ChartEventMap[typeof event]),
    };

    const unstable: ChartPluginUnstable = {
      get canvas() {
        return chart.canvas;
      },
      element: (slot) => this.surfaceElement(slot),
      getWebGLContext: () => chart.getWebGLContext(),
      getCamera: (yAxis) => chart.getCamera(yAxis),
    };

    return {
      get theme() {
        return chart.theme;
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
