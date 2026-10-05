import type { RendererChoice } from "@/index.ts";

const CHOICES: readonly RendererChoice[] = ["webgl2", "canvas2d", "shared", "auto"];

/**
 * The engine a browser suite asked for with `?renderer=` (set by `--renderer` or `BLAZEPLOT_TEST_RENDERER` in
 * the scripts that drive the fixtures), or `fallback`. Fixtures default to `"webgl2"` so a suite never silently
 * measures the Canvas 2D fallback; passing the parameter is how a suite opts into another engine.
 */
export function testRenderer(fallback: RendererChoice = "webgl2"): RendererChoice {
  const value = new URLSearchParams(window.location.search).get("renderer");
  if (value === null) return fallback;
  if (!CHOICES.includes(value as RendererChoice)) throw new Error(`Unknown renderer "${value}"; expected one of ${CHOICES.join(", ")}.`);
  return value as RendererChoice;
}
