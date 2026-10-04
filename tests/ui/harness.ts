import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { FakeBackend, FakeResizeObserver, setupDom, trackListeners } from "./fakes.ts";
import type { FakeRaf, ListenerLedger, TestEnv } from "./fakes.ts";
import type { Chart as ChartType, ChartOptions } from "../../src/ui/Chart.ts";
import type { ChartPlugin, ChartPluginContext } from "../../src/ui/PluginHost.ts";

export interface ChartHarness {
  readonly raf: FakeRaf;
  /** Net listener ledger for the current test. */
  readonly ledger: () => ListenerLedger;
  /** The host element charts are mounted into. */
  readonly target: () => HTMLDivElement;
  readonly backends: () => readonly FakeBackend[];
  /** Create a chart on the FakeBackend with a 400x200 plot at the client origin. */
  make(options?: ChartOptions, plot?: PlotStub): ChartType;
}

export interface PlotStub {
  readonly width?: number;
  readonly height?: number;
  readonly left?: number;
  readonly top?: number;
}

/**
 * Stub the layout metrics that happy-dom leaves at zero so pointer math has a real plot:
 * `getBoundingClientRect`, `clientWidth`, and `clientHeight` on the chart canvas.
 */
export function stubPlot(chart: ChartType, { width = 400, height = 200, left = 0, top = 0 }: PlotStub = {}): void {
  chart.canvas.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
  Object.defineProperty(chart.canvas, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(chart.canvas, "clientHeight", { configurable: true, value: height });
}

/** Give an arbitrary element a fixed layout box. */
export function stubBox(el: Element, box: { left?: number; top?: number; width: number; height: number }): void {
  const { left = 0, top = 0, width, height } = box;
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
}

export interface PointerInit {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly button?: number;
  readonly buttons?: number;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  /** Plot-relative offsets reported as `offsetX`/`offsetY` (happy-dom always reports 0). */
  readonly offsetX?: number;
  readonly offsetY?: number;
}

/** Build a cancelable, bubbling PointerEvent. */
export function pointerEvent(type: string, clientX: number, clientY: number, init: PointerInit = {}): PointerEvent {
  const { offsetX, offsetY, ...rest } = init;
  const event = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    ...rest,
  });
  Object.defineProperty(event, "offsetX", { value: offsetX ?? clientX });
  Object.defineProperty(event, "offsetY", { value: offsetY ?? clientY });
  return event;
}

/** Build a cancelable, bubbling wheel event. */
export function wheelEvent(clientX: number, clientY: number, init: { deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean } = {}): WheelEvent {
  const event = new window.WheelEvent("wheel", { bubbles: true, cancelable: true, clientX, clientY, ...init });
  // happy-dom's WheelEvent drops the MouseEvent fields; define them so plugins see real coordinates.
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey ?? false });
  return event;
}

/** Build a cancelable, bubbling keydown. */
export function keyEvent(key: string, init: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}, type = "keydown"): KeyboardEvent {
  return new window.KeyboardEvent(type, { bubbles: true, cancelable: true, key, ...init });
}

/**
 * Build a touch event whose `touches` list exposes `item()` like a real `TouchList`
 * (happy-dom exposes a plain array).
 */
export function touchEvent(type: string, points: ReadonlyArray<{ clientX: number; clientY: number }>, changed: ReadonlyArray<{ clientX: number; clientY: number }> = points): TouchEvent {
  const list = (items: ReadonlyArray<{ clientX: number; clientY: number }>): TouchList => {
    const copy = [...items] as unknown as TouchList & Array<unknown>;
    (copy as unknown as { item(index: number): unknown }).item = (index: number) => items[index] ?? null;
    return copy;
  };
  const event = new window.Event(type, { bubbles: true, cancelable: true }) as unknown as TouchEvent;
  Object.defineProperty(event, "touches", { value: list(points) });
  Object.defineProperty(event, "changedTouches", { value: list(changed) });
  return event;
}

/**
 * Install `plugin` on a live chart and return a function that disposes just that plugin,
 * normalizing the function, handle, and void return forms.
 */
export function installPlugin(chart: ChartType, plugin: ChartPlugin): () => void {
  return chart.installPlugin(plugin);
}

/** Install a no-op plugin on a live chart and return its context, e.g. to emit plugin events. */
export function pluginContext(chart: ChartType): ChartPluginContext {
  let captured: ChartPluginContext | null = null;
  chart.installPlugin({ install: (ctx) => { captured = ctx; } });
  return captured!;
}

export function fire(el: EventTarget, event: Event): boolean {
  return el.dispatchEvent(event);
}

/**
 * Register happy-dom plus a per-test host element, listener ledger, and chart factory.
 * Call once at the top level of a test file.
 */
export function useChartHarness(): ChartHarness {
  let env: TestEnv;
  let Chart: typeof ChartType;
  let target: HTMLDivElement;
  let backends: FakeBackend[] = [];
  let ledger: ListenerLedger;
  const raf = { current: null as unknown as FakeRaf };

  beforeAll(async () => {
    env = setupDom();
    raf.current = env.raf;
    // Give every canvas a default 400x200 plot so plugins that measure at install time see a real size.
    const canvasProto = window.HTMLCanvasElement.prototype;
    canvasProto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} }) as DOMRect;
    Object.defineProperty(canvasProto, "clientWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(canvasProto, "clientHeight", { configurable: true, get: () => 200 });
    ({ Chart } = await import("../../src/ui/Chart.ts"));
  });
  afterAll(() => {
    // happy-dom classes can outlive the window; do not leak the default plot size into other files.
    const canvasProto = window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
    delete canvasProto.getBoundingClientRect;
    delete canvasProto.clientWidth;
    delete canvasProto.clientHeight;
    env.teardown();
  });
  beforeEach(() => {
    target = document.createElement("div");
    document.body.appendChild(target);
    backends = [];
    raf.current.pending.clear();
    FakeResizeObserver.instances = [];
    ledger = trackListeners();
  });
  afterEach(() => {
    ledger.restore();
    target.remove();
  });

  return {
    get raf() {
      return raf.current;
    },
    ledger: () => ledger,
    target: () => target,
    backends: () => backends,
    make(options: ChartOptions = {}, plot?: PlotStub): ChartType {
      const chart = new Chart(target, {
        ...options,
        backendFactory: (ctx) => {
          const backend = new FakeBackend(ctx.canvas);
          backends.push(backend);
          return backend;
        },
      });
      stubPlot(chart, plot);
      return chart;
    },
  };
}
