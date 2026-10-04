import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { BufferSpec, DrawSpec, GpuBackend, GpuBuffer, GpuCapabilities, GpuProgram, GpuResource } from "../../src/render/types.ts";

/** GPU backend that records every resource it hands out so tests can assert on leaks. */
export class FakeBackend implements GpuBackend {
  readonly capabilities: GpuCapabilities = { instancing: true };
  readonly liveBuffers = new Set<GpuBuffer>();
  readonly livePrograms = new Set<GpuProgram>();
  createdBuffers = 0;
  draws: DrawSpec[] = [];
  destroyCount = 0;
  contextLost = false;
  readonly canvas: HTMLCanvasElement | null;
  private readonly gl = { isContextLost: () => this.contextLost } as unknown as WebGL2RenderingContext;

  constructor(canvas: HTMLCanvasElement | null = null) {
    this.canvas = canvas;
  }

  get liveResourceCount(): number {
    return this.liveBuffers.size + this.livePrograms.size;
  }

  createBuffer(spec: BufferSpec): GpuBuffer {
    const buffer: GpuBuffer = { kind: "buffer", length: spec.length, type: spec.type };
    this.createdBuffers++;
    this.liveBuffers.add(buffer);
    return buffer;
  }
  updateBuffer(): void {}
  createProgram(): GpuProgram {
    const program: GpuProgram = { kind: "program" };
    this.livePrograms.add(program);
    return program;
  }
  draw(spec: DrawSpec): void {
    this.draws.push(spec);
  }
  dispose(resource: GpuResource): void {
    this.liveBuffers.delete(resource as GpuBuffer);
    this.livePrograms.delete(resource as GpuProgram);
  }
  clear(): void {}
  viewport(): void {}
  getContext(): WebGL2RenderingContext | null {
    return this.gl;
  }
  destroy(): void {
    this.destroyCount++;
    this.liveBuffers.clear();
    this.livePrograms.clear();
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
