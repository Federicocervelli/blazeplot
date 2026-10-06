import type { ChartEventMap, ChartEventName } from "./ChartEvents.js";

type Listener<K extends ChartEventName> = (payload: ChartEventMap[K]) => void;

/** Typed event registry for a chart: subscribe, emit with per-listener error isolation, and listener checks. */
export class ChartEmitter {
  /** Listener sets keyed by event; `never` payloads let every typed listener share one map. */
  private readonly listeners = new Map<ChartEventName, Set<(payload: never) => void>>();

  /** Subscribe to an event; returns an unsubscribe function. */
  subscribe<K extends ChartEventName>(event: K, callback: Listener<K>): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  /** Whether anything is subscribed to `event`. */
  has(event: ChartEventName): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  /** Call every listener of `event`; one throwing listener never stops the rest. */
  emit<K extends ChartEventName>(event: K, payload: ChartEventMap[K]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        (listener as Listener<K>)(payload);
      } catch (error) {
        console.error(`BlazePlot ${event} listener failed:`, error);
      }
    }
  }
}
