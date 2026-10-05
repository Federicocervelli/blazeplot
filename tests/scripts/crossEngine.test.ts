import { describe, expect, test } from "bun:test";
import { compareEngines, CROSS_ENGINE_THRESHOLDS, IDENTICAL_THRESHOLDS, inkBounds } from "../../scripts/cross-engine.ts";
import { createImage } from "../../scripts/png-image.ts";
import type { RgbaImage } from "../../scripts/png-image.ts";

const ink = [255, 255, 255, 255] as const;

function paint(image: RgbaImage, x: number, y: number, rgba: readonly [number, number, number, number] = ink): void {
  image.data.set(rgba, (y * image.width + x) * 4);
}

function rect(image: RgbaImage, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) paint(image, x, y);
  return image;
}

const blank = (): RgbaImage => createImage(100, 50, [0, 0, 0, 255]);

describe("inkBounds", () => {
  test("is null for a blank image and tight around drawn pixels", () => {
    expect(inkBounds(blank())).toBeNull();
    expect(inkBounds(rect(blank(), 10, 5, 20, 8))).toEqual({ minX: 10, minY: 5, maxX: 19, maxY: 7 });
  });
});

describe("compareEngines", () => {
  test("identical images pass every threshold, including the bit-identical one", () => {
    const a = rect(blank(), 10, 10, 60, 30);
    const b = rect(blank(), 10, 10, 60, 30);
    expect(compareEngines(a, b, IDENTICAL_THRESHOLDS)).toMatchObject({ ok: true, diffPixels: 0, inkRatio: 1 });
    expect(compareEngines(a, b, CROSS_ENGINE_THRESHOLDS.fill).ok).toBe(true);
  });

  test("a single differing pixel fails the bit-identical check but not the fill threshold", () => {
    const a = rect(blank(), 10, 10, 60, 30);
    const b = rect(blank(), 10, 10, 60, 30);
    paint(b, 70, 40);
    const exact = compareEngines(a, b, IDENTICAL_THRESHOLDS);
    expect(exact.ok).toBe(false);
    expect(exact.failures.join(" ")).toContain("differ");
  });

  test("fills that differ by more than the allowed share of pixels fail", () => {
    const a = rect(blank(), 10, 10, 60, 30);
    const b = rect(blank(), 10, 10, 60, 30);
    rect(b, 60, 10, 66, 30);
    const result = compareEngines(a, b, CROSS_ENGINE_THRESHOLDS.fill);
    expect(result.ok).toBe(false);
    expect(result.diffRatio).toBeGreaterThan(CROSS_ENGINE_THRESHOLDS.fill.maxDiffRatio);
  });

  test("antialiased edges match after the blur but not pixel for pixel", () => {
    const a = blank();
    const b = blank();
    // The same line, aliased on one row versus antialiased across two.
    for (let x = 5; x < 95; x++) {
      paint(a, x, 20);
      paint(b, x, 20, [200, 200, 200, 255]);
      paint(b, x, 21, [55, 55, 55, 255]);
    }
    expect(compareEngines(a, b, { ...CROSS_ENGINE_THRESHOLDS.stroke, bboxTolerancePx: 1 }).diffPixels).toBe(0);
    expect(compareEngines(a, b, { ...CROSS_ENGINE_THRESHOLDS.stroke, blur: 0, bboxTolerancePx: 1 }).diffPixels).toBeGreaterThan(0);
  });

  test("reports ink bounds that move even when the pixel diff is small", () => {
    const a = rect(blank(), 10, 10, 60, 30);
    const b = rect(blank(), 10, 10, 60, 30);
    paint(b, 99, 49);
    const result = compareEngines(a, b, { ...CROSS_ENGINE_THRESHOLDS.fill, maxDiffRatio: 1, inkRatio: [0, 2] });
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("ink bounds differ");
  });

  test("flags an engine that drew nothing, and mismatched sizes", () => {
    const a = rect(blank(), 10, 10, 60, 30);
    const empty = compareEngines(a, blank(), CROSS_ENGINE_THRESHOLDS.fill);
    expect(empty.ok).toBe(false);
    expect(empty.failures.join(" ")).toContain("ink ratio");
    expect(compareEngines(a, createImage(10, 10), CROSS_ENGINE_THRESHOLDS.fill).failures[0]).toContain("sizes differ");
  });
});
