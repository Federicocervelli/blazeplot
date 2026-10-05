import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DrawCommand, GpuBackend } from "../../src/render/webgl2/types.ts";

/** GPU backend that records submitted frames so tests can assert on draw and upload counts. */
export class FakeBackend implements GpuBackend {
  /** Every draw command received, in submission order. */
  draws: DrawCommand[] = [];
  /** Number of `submit` calls, i.e. stream uploads. */
  submits = 0;
  /** Floats uploaded across all submits. */
  uploadedFloats = 0;
  destroyCount = 0;
  contextLost = false;
  /** Times `WEBGL_lose_context.loseContext()` was called on this backend's context. */
  contextReleases = 0;
  readonly canvas: HTMLCanvasElement | null;
  private readonly gl = {
    isContextLost: () => this.contextLost,
    getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => { this.contextReleases++; } } : null),
  } as unknown as WebGL2RenderingContext;

  constructor(canvas: HTMLCanvasElement | null = null) {
    this.canvas = canvas;
  }

  /** 1 while the backend holds its GPU objects, 0 once destroyed. */
  get liveResourceCount(): number {
    return this.destroyCount > 0 ? 0 : 1;
  }

  submit(_stream: Float32Array, floatCount: number, commands: readonly DrawCommand[]): void {
    this.submits++;
    this.uploadedFloats += floatCount;
    this.draws.push(...commands);
  }
  clear(): void {}
  viewport(): void {}
  getContext(): WebGL2RenderingContext | null {
    return this.gl;
  }
  destroy(): void {
    this.destroyCount++;
  }
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
