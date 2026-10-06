/**
 * @internal The deliberate non-public access path to a `Chart`: its WebGL canvas, axis gutter and plot
 * elements, camera, render surfaces, and live plugin installation. The built-in plugin host, linked
 * charts, tests, and browser fixtures use `chartInternals(chart)`; app code and third-party plugins use
 * the public `Chart` API and `ChartPluginContext` (`ctx.dom`, `ctx.layout`, `ctx.unstable`).
 *
 * `Chart` registers its accessor in a `WeakMap` when it is constructed, so none of this is a member
 * of the public class and nothing relies on declaration stripping to stay out of the typings.
 */
import type { SeriesYAxis } from "../core/types.js";
import type { Camera2D } from "../interaction/Camera2D.js";
import type { ChartRenderSurface } from "../render/ChartRenderer.js";
import type { ChartPlugin } from "./PluginTypes.js";

/** @internal Chart members that are not public API. */
export interface ChartInternals {
  /** The WebGL (or Canvas 2D) plot canvas. */
  readonly canvas: HTMLCanvasElement;
  readonly plotElement: HTMLElement;
  readonly xAxisElement: HTMLElement;
  readonly yAxisElement: HTMLElement;
  readonly y2AxisElement: HTMLElement;
  /** The engine's native WebGL2 context, when it owns one. */
  getWebGLContext(): WebGL2RenderingContext | null;
  /** A drawing surface for a plugin-owned canvas, on this chart's engine. */
  createRenderSurface(canvas: HTMLCanvasElement): ChartRenderSurface;
  /** Camera for the requested Y axis (default left). */
  getCamera(yAxis?: SeriesYAxis): Camera2D;
  /** Plot-local CSS pixels to data coordinates through the cached plot size (no layout read), or `null` outside the plot. */
  plotToData(plotX: number, plotY: number, yAxis?: SeriesYAxis): [number, number] | null;
  /** Install a plugin on a live chart. Returns a function that disposes just that plugin. */
  installPlugin(plugin: ChartPlugin): () => void;
}

const registry = new WeakMap<object, ChartInternals>();

/** @internal Called by the `Chart` constructor. */
export function registerChartInternals(chart: object, internals: ChartInternals): void {
  registry.set(chart, internals);
}

/** @internal Internal accessors for a live chart. */
export function chartInternals(chart: object): ChartInternals {
  const internals = registry.get(chart);
  if (!internals) throw new TypeError("chartInternals(...) requires a Chart instance.");
  return internals;
}
