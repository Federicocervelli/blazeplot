import { afterEach, describe, expect, it } from "bun:test";
import { createEngine } from "../../src/render/engines.ts";
import { acquirePlotCanvas, hasWarmBackend } from "../../src/render/webgl2/WarmCanvasPool.ts";
import { releaseWarm } from "../../src/render/webgl2/warm.ts";
import { WebGL2Renderer } from "../../src/render/webgl2/WebGL2Renderer.ts";
import { FakeGl } from "./fakeGl.ts";

/** A document whose canvases are event targets handing out one fake WebGL2 context each, counting `getContext` calls. */
function makeDoc() {
  const made: Array<{ canvas: HTMLCanvasElement; gl: FakeGl; contexts: number }> = [];
  const doc = {
    createElement: () => {
      const gl = new FakeGl();
      const record = { canvas: null as unknown as HTMLCanvasElement, gl, contexts: 0 };
      record.canvas = Object.assign(new EventTarget(), {
        ownerDocument: doc,
        width: 300,
        height: 150,
        getContext: () => {
          record.contexts++;
          return gl;
        },
        getAttributeNames: () => [],
        removeAttribute: () => {},
        remove: () => {},
      }) as unknown as HTMLCanvasElement;
      made.push(record);
      return record.canvas;
    },
  } as unknown as Document;
  return { doc, made };
}

afterEach(() => releaseWarm());

describe("WebGL2Renderer and the warm canvas pool", () => {
  it("parks its canvas on dispose and lets the next renderer adopt the warm context and backend", () => {
    const { doc, made } = makeDoc();
    const canvas = acquirePlotCanvas(doc);
    const first = new WebGL2Renderer(canvas);
    first.dispose();
    // Nothing was deleted: the backend (programs, buffers) stays alive on the parked canvas.
    expect(made[0]!.gl.validDeletes).toEqual([]);

    const again = acquirePlotCanvas(doc);
    expect(again).toBe(canvas);
    const second = new WebGL2Renderer(again);
    expect(made).toHaveLength(1);
    // One context for both charts: the second renderer never asked the canvas for another.
    expect(made[0]!.contexts).toBe(1);
    expect(second.info.name).toBe("webgl2");

    second.dispose();
    releaseWarm();
    expect(made[0]!.gl.validDeletes).toContain("buffer");
  });

  it("releases a canvas it does not own straight away, as before", () => {
    const { doc, made } = makeDoc();
    const canvas = doc.createElement("canvas");
    new WebGL2Renderer(canvas).dispose();
    expect(made[0]!.gl.validDeletes).toContain("buffer");
    // And that canvas is not handed to anyone later.
    expect(acquirePlotCanvas(doc)).not.toBe(canvas);
  });

  it("does not park a canvas whose context is lost", () => {
    const { doc, made } = makeDoc();
    const canvas = acquirePlotCanvas(doc);
    const renderer = new WebGL2Renderer(canvas);
    made[0]!.gl.lost = true;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    renderer.dispose();
    expect(acquirePlotCanvas(doc)).not.toBe(canvas);
  });

  it("pre-sizes a new WebGL2 canvas in createEngine but not a warm one", () => {
    const { doc } = makeDoc();
    const fresh = acquirePlotCanvas(doc);
    expect(hasWarmBackend(fresh)).toBe(false);
    let sized = 0;
    const first = createEngine("webgl2", fresh, () => void sized++);
    expect(sized).toBe(1);
    first.dispose();

    const warm = acquirePlotCanvas(doc);
    expect(warm).toBe(fresh);
    expect(hasWarmBackend(warm)).toBe(true);
    // A pre-size would force a layout read for nothing: the context and drawing buffer already exist.
    const second = createEngine("webgl2", warm, () => void sized++);
    expect(sized).toBe(1);
    // The renderer adopted the backend, so the predicate does not stay true.
    expect(hasWarmBackend(warm)).toBe(false);
    second.dispose();
  });

  it("builds its own backend when the backend is injected, never touching the pool", () => {
    const { doc } = makeDoc();
    const canvas = acquirePlotCanvas(doc);
    let built = 0;
    const renderer = new WebGL2Renderer(canvas, { createBackend: () => (built++, { viewport() {}, clear() {}, submit() {}, destroy() {} }) });
    renderer.dispose();
    expect(built).toBe(1);
    expect(acquirePlotCanvas(doc)).not.toBe(canvas);
  });
});
