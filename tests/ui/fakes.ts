import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describeRenderer } from "../../src/render/ChartRenderer.ts";
import type { ChartRenderer, ChartRendererInfo, FrameReport, RendererLossState } from "../../src/render/ChartRenderer.ts";

/** One draw call a chart made on a {@link RecordingRenderer}. */
export interface RecordedDraw {
  readonly method: "drawLines" | "drawClipLines" | "drawPoints" | "drawBarsInstanced" | "drawTriangles";
  readonly count: number;
}

/** Fake engine that records what a chart asks it to draw and lets tests simulate context loss. */
export class RecordingRenderer implements ChartRenderer {
  readonly kind = "webgl2" as const;
  readonly info: ChartRendererInfo = describeRenderer("webgl2", { gpu: true, contextLoss: true, shared: false, maxDrawingBufferPixels: 1 << 24 });
  /** Every draw call since the last reset, in order. */
  draws: RecordedDraw[] = [];
  /** Number of `endFrame` calls, i.e. frames the chart finished. */
  frames = 0;
  disposeCount = 0;
  lost = false;
  private listener: ((state: RendererLossState) => void) | null = null;
  private frameDraws = 0;

  get isLost(): boolean {
    return this.lost;
  }
  setLossListener(listener: ((state: RendererLossState) => void) | null): void {
    this.listener = listener;
  }
  /** Simulate the engine losing its context and telling the chart. */
  lose(): void {
    this.lost = true;
    this.listener?.("lost");
  }
  /** Simulate the engine restoring its context and telling the chart. */
  restore(): void {
    this.lost = false;
    this.listener?.("restored");
  }

  beginFrame(): void {
    this.frameDraws = 0;
  }
  endFrame(): FrameReport {
    this.frames++;
    return { uploadBytes: 0, drawCalls: this.frameDraws };
  }
  drawLines(_data: Float32Array, count: number): void {
    this.record("drawLines", count);
  }
  drawClipLines(_data: Float32Array, count: number): void {
    this.record("drawClipLines", count);
  }
  drawPoints(_data: Float32Array, count: number): void {
    this.record("drawPoints", count);
  }
  drawBarsInstanced(_data: Float32Array, count: number): void {
    this.record("drawBarsInstanced", count);
  }
  drawTriangles(_data: Float32Array, count: number): void {
    this.record("drawTriangles", count);
  }
  dispose(): void {
    this.disposeCount++;
  }
  private record(method: RecordedDraw["method"], count: number): void {
    this.frameDraws++;
    this.draws.push({ method, count });
  }
}

/** Renderer option that builds a {@link RecordingRenderer} and hands it to `sink`. */
export function recordingRenderer(sink?: RecordingRenderer[]): (context: { canvas: HTMLCanvasElement }) => RecordingRenderer {
  return () => {
    const renderer = new RecordingRenderer();
    sink?.push(renderer);
    return renderer;
  };
}

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** Deterministic requestAnimationFrame queue. */
export class FakeRaf {
  private nextId = 1;
  readonly pending = new Map<number, FrameRequestCallback>();
  request = (cb: FrameRequestCallback): number => {
    const id = this.nextId++;
    this.pending.set(id, cb);
    return id;
  };
  cancel = (id: number): void => {
    this.pending.delete(id);
  };
  /** Run every callback queued at call time. */
  flush(): number {
    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [, cb] of batch) cb(performance.now());
    return batch.length;
  }
}

export interface ListenerLedger {
  /** Net registered listeners (adds minus removes). */
  net(): number;
  /**
   * Net listeners that can still fire: on non-Node targets (window, document) or on Nodes still
   * attached to the document. Listeners left on a detached node are garbage-collected with it.
   */
  reachable(): number;
  restore(): void;
}

/** Track add/removeEventListener balance on all EventTargets while installed. */
export function trackListeners(): ListenerLedger {
  // happy-dom's EventTarget is not the global one; find the prototype that owns the methods.
  let proto = Object.getPrototypeOf(document.createElement("div")) as EventTarget;
  while (proto && !Object.hasOwn(proto, "addEventListener")) proto = Object.getPrototypeOf(proto) as EventTarget;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const live = new Map<EventTarget, Map<string, Set<unknown>>>();
  proto.addEventListener = function (this: EventTarget, type: string, listener: unknown, options?: unknown) {
    let byType = live.get(this);
    if (!byType) live.set(this, (byType = new Map()));
    let set = byType.get(type);
    if (!set) byType.set(type, (set = new Set()));
    set.add(listener);
    return (add as (...args: unknown[]) => void).call(this, type, listener, options);
  } as typeof proto.addEventListener;
  proto.removeEventListener = function (this: EventTarget, type: string, listener: unknown, options?: unknown) {
    live.get(this)?.get(type)?.delete(listener);
    return (remove as (...args: unknown[]) => void).call(this, type, listener, options);
  } as typeof proto.removeEventListener;
  return {
    net() {
      let n = 0;
      for (const byType of live.values()) for (const set of byType.values()) n += set.size;
      return n;
    },
    reachable() {
      let n = 0;
      for (const [target, byType] of live) {
        const node = target as Partial<Node>;
        if (node.nodeType !== undefined && !node.isConnected) continue;
        for (const set of byType.values()) n += set.size;
      }
      return n;
    },
    restore() {
      proto.addEventListener = add;
      proto.removeEventListener = remove;
    },
  };
}

export interface TestEnv {
  raf: FakeRaf;
  teardown(): void;
}

/** Register a DOM shim plus fake rAF/ResizeObserver. Call `teardown()` in afterAll. */
export function setupDom(): TestEnv {
  GlobalRegistrator.register({ width: 800, height: 600 });
  const raf = new FakeRaf();
  const g = globalThis as Record<string, unknown>;
  g.requestAnimationFrame = raf.request;
  g.cancelAnimationFrame = raf.cancel;
  g.ResizeObserver = FakeResizeObserver;
  FakeResizeObserver.instances = [];
  return {
    raf,
    teardown() {
      GlobalRegistrator.unregister();
    },
  };
}

/** Count every element under `root`, including `root`. */
export function countNodes(root: Element): number {
  return 1 + root.querySelectorAll("*").length;
}
