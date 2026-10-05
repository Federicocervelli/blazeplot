import { describe, it } from "bun:test";
import type { ChartOptions } from "../../src/ui/Chart.ts";
import { FakeGl } from "../render/fakeGl.ts";
import { recordingRenderer } from "./fakes.ts";
import type { RecordingRenderer } from "./fakes.ts";

/**
 * Which engine the UI suites run against. `fake` (the default) is a recording engine that tests can
 * inspect; the others are the real engines driven over canvas doubles, so the same semantic
 * assertions hold on every engine. `scripts/ui-engines-test.ts` runs the engine-agnostic suites once per engine.
 */
export type UiEngine = "fake" | "canvas2d" | "webgl2" | "shared";

const engines: readonly UiEngine[] = ["fake", "canvas2d", "webgl2", "shared"];
const requested = process.env.BLAZEPLOT_TEST_ENGINE ?? "fake";
if (!engines.includes(requested as UiEngine)) throw new Error(`BLAZEPLOT_TEST_ENGINE must be one of ${engines.join(", ")}; got "${requested}".`);

export const uiEngine = requested as UiEngine;
export const uiEngines = engines;

/** `it` for tests that inspect the recording engine; skipped on the real engines. */
export const itRecorded = uiEngine === "fake" ? it : it.skip;
/** `describe` for suites that inspect the recording engine; skipped on the real engines. */
export const describeRecorded = uiEngine === "fake" ? describe : describe.skip;

/** The `renderer` option for the engine under test; the recording engine reports itself to `sink`. */
export function chartRenderer(sink?: RecordingRenderer[]): ChartOptions["renderer"] {
  return uiEngine === "fake" ? recordingRenderer(sink) : uiEngine;
}

/** Context-tolerant 2D double: records nothing, accepts anything, measures text as 5px wide. */
function context2d(): unknown {
  const base: Record<string, unknown> = { canvas: null, measureText: () => ({ width: 5 }), isContextLost: () => false };
  return new Proxy(base, { get: (target, key) => (key in target ? target[key as string] : () => undefined), set: () => true });
}

/**
 * Make happy-dom canvases hand out context doubles (a fake WebGL2 context per canvas, one 2D double)
 * so the real engines can run. A no-op for the recording engine. Returns a restore function.
 */
export function installEngineDoubles(): () => void {
  if (uiEngine === "fake") return () => {};
  const proto = window.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const originalGetContext = proto.getContext;
  const originalPath2D = (globalThis as { Path2D?: unknown }).Path2D;
  const gls = new WeakMap<object, FakeGl>();
  const ctx2d = context2d();
  proto.getContext = function (this: object, kind: string): unknown {
    if (kind === "2d") return ctx2d;
    if (kind !== "webgl2") return null;
    let gl = gls.get(this);
    if (!gl) gls.set(this, (gl = new FakeGl()));
    return gl;
  };
  (globalThis as { Path2D?: unknown }).Path2D ??= class {
    moveTo(): void {}
    lineTo(): void {}
    closePath(): void {}
  };
  return () => {
    proto.getContext = originalGetContext;
    (globalThis as { Path2D?: unknown }).Path2D = originalPath2D;
  };
}
