import { afterEach, describe, expect, it, jest } from "bun:test";
import { acquirePlotCanvas, adoptWarmBackend, parkPlotCanvas } from "../../src/render/webgl2/WarmCanvasPool.ts";
import { releaseWarm } from "../../src/render/webgl2/warm.ts";
import type { GpuBackend } from "../../src/render/webgl2/types.ts";

/** A canvas double with just what the pool touches. */
function makeDoc(): Document {
  const doc = {
    createElement: () => {
      const attributes = new Map<string, string>([["class", "blazeplot-canvas"], ["style", "position:absolute"]]);
      return {
        ownerDocument: doc,
        width: 300,
        height: 150,
        removed: 0,
        getAttributeNames: () => [...attributes.keys()],
        removeAttribute: (name: string) => void attributes.delete(name),
        hasAttributes: () => attributes.size > 0,
        remove() {
          this.removed++;
        },
      };
    },
  };
  return doc as unknown as Document;
}

interface FakeBackend extends GpuBackend {
  destroyed: number;
  releases: number;
  lost: boolean;
}

function makeBackend(): FakeBackend {
  const backend: FakeBackend = {
    destroyed: 0,
    releases: 0,
    lost: false,
    viewport() {},
    clear() {},
    submit() {},
    destroy() {
      backend.destroyed++;
    },
    getContext: () =>
      ({
        isContextLost: () => backend.lost,
        getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => void backend.releases++ } : null),
      }) as unknown as WebGL2RenderingContext,
  };
  return backend;
}

afterEach(() => {
  releaseWarm();
  jest.useRealTimers();
});

describe("WarmCanvasPool", () => {
  it("hands a parked canvas, reset and with its warm backend, to the next chart on the same document", () => {
    const doc = makeDoc();
    const first = acquirePlotCanvas(doc);
    const backend = makeBackend();
    expect(parkPlotCanvas(first, backend)).toBe(true);
    expect((first as unknown as { removed: number }).removed).toBe(1);
    expect([first.width, first.height]).toEqual([1, 1]);
    // Parking keeps the context: nothing is destroyed or released while the canvas waits.
    expect([backend.destroyed, backend.releases]).toEqual([0, 0]);

    const second = acquirePlotCanvas(doc);
    expect(second).toBe(first);
    expect((second as unknown as { hasAttributes(): boolean }).hasAttributes()).toBe(false);
    expect(adoptWarmBackend(second)).toBe(backend);
    // The backend is handed over once.
    expect(adoptWarmBackend(second)).toBeUndefined();
  });

  it("does not hand a canvas to a chart in another document", () => {
    const canvas = acquirePlotCanvas(makeDoc());
    parkPlotCanvas(canvas, makeBackend());
    expect(acquirePlotCanvas(makeDoc())).not.toBe(canvas);
  });

  it("only parks canvases it created, and only healthy ones", () => {
    const doc = makeDoc();
    const foreign = doc.createElement("canvas");
    expect(parkPlotCanvas(foreign, makeBackend())).toBe(false);

    const canvas = acquirePlotCanvas(doc);
    const lost = makeBackend();
    lost.lost = true;
    expect(parkPlotCanvas(canvas, lost)).toBe(false);
  });

  it("drops a parked context that was lost while it waited", () => {
    const doc = makeDoc();
    const canvas = acquirePlotCanvas(doc);
    const backend = makeBackend();
    parkPlotCanvas(canvas, backend);
    backend.lost = true;
    expect(acquirePlotCanvas(doc)).not.toBe(canvas);
    expect(backend.destroyed).toBe(1);
  });

  it("keeps at most two warm canvases and releases the oldest first", () => {
    const doc = makeDoc();
    const backends = [makeBackend(), makeBackend(), makeBackend()];
    // Three charts alive at once, then disposed one after another.
    const canvases = backends.map(() => acquirePlotCanvas(doc));
    canvases.forEach((canvas, index) => parkPlotCanvas(canvas, backends[index]!));
    expect(backends.map((backend) => backend.destroyed)).toEqual([1, 0, 0]);
    expect(backends.map((backend) => backend.releases)).toEqual([1, 0, 0]);
  });

  it("releases a warm canvas after it has waited too long, and releaseWarm does it at once", () => {
    jest.useFakeTimers();
    const doc = makeDoc();
    const idle = makeBackend();
    parkPlotCanvas(acquirePlotCanvas(doc), idle);
    jest.advanceTimersByTime(1_000);
    expect(idle.destroyed).toBe(0);
    jest.advanceTimersByTime(1_500);
    expect([idle.destroyed, idle.releases]).toEqual([1, 1]);

    const flushed = makeBackend();
    parkPlotCanvas(acquirePlotCanvas(doc), flushed);
    releaseWarm();
    expect([flushed.destroyed, flushed.releases]).toEqual([1, 1]);
    // Nothing left to expire later.
    jest.advanceTimersByTime(10_000);
    expect(flushed.destroyed).toBe(1);
  });
});
