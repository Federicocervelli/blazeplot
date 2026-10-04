import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { createImage, decodePng, diffImages, encodePng, measureInk } from "../../scripts/png-image.ts";

function paint(image: ReturnType<typeof createImage>, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  image.data.set(rgba, (y * image.width + x) * 4);
}

describe("png-image", () => {
  test("round-trips RGBA pixels through encode and decode", () => {
    const image = createImage(5, 3, [10, 20, 30, 255]);
    paint(image, 2, 1, [200, 100, 50, 128]);
    const decoded = decodePng(encodePng(image));
    expect(decoded.width).toBe(5);
    expect(decoded.height).toBe(3);
    expect(Array.from(decoded.data)).toEqual(Array.from(image.data));
  });

  test("decodes filtered RGB scanlines (Sub and Up filters)", () => {
    // 2x2 RGB image. Row 0 uses Sub (second pixel stores the delta from the first); row 1 uses Up.
    const raw = Uint8Array.from([1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 2, 2, 2]);
    const decoded = decodePng(rebuildPng(2, 2, 2, deflateSync(raw)));
    expect(Array.from(decoded.data)).toEqual([
      10, 20, 30, 255, 15, 25, 35, 255,
      11, 21, 31, 255, 17, 27, 37, 255,
    ]);
  });

  test("rejects non-PNG input", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow("Not a PNG");
  });

  test("measureInk reports zero for a uniform image of any color", () => {
    expect(measureInk(createImage(20, 10, [0, 0, 0, 255])).ratio).toBe(0);
    expect(measureInk(createImage(20, 10, [200, 30, 90, 255])).ratio).toBe(0);
  });

  test("measureInk counts pixels that differ from the border background", () => {
    const image = createImage(10, 10, [0, 0, 0, 255]);
    for (let x = 3; x < 7; x++) paint(image, x, 5, [255, 255, 255, 255]);
    const stats = measureInk(image);
    expect(stats.inkPixels).toBe(4);
    expect(stats.ratio).toBeCloseTo(0.04, 5);
    expect(Array.from(stats.background)).toEqual([0, 0, 0, 255]);
  });

  test("measureInk ignores differences within the tolerance", () => {
    const image = createImage(10, 10, [0, 0, 0, 255]);
    paint(image, 5, 5, [6, 0, 0, 255]);
    expect(measureInk(image, 8).inkPixels).toBe(0);
    expect(measureInk(image, 4).inkPixels).toBe(1);
  });

  test("diffImages passes within per-pixel threshold and ratio budget", () => {
    const a = createImage(10, 10, [10, 10, 10, 255]);
    const b = createImage(10, 10, [10, 10, 10, 255]);
    paint(b, 1, 1, [20, 10, 10, 255]);
    paint(b, 2, 2, [200, 10, 10, 255]);
    const result = diffImages(a, b, { pixelThreshold: 16, maxDiffRatio: 0.02 });
    expect(result.diffPixels).toBe(1);
    expect(result.maxChannelDelta).toBe(190);
    expect(result.ok).toBe(true);
    expect(result.diffImage).not.toBeNull();
  });

  test("diffImages fails when too many pixels differ", () => {
    const a = createImage(10, 10, [0, 0, 0, 255]);
    const b = createImage(10, 10, [0, 0, 0, 255]);
    for (let x = 0; x < 10; x++) paint(b, x, 0, [255, 0, 0, 255]);
    const result = diffImages(a, b, { pixelThreshold: 16, maxDiffRatio: 0.05 });
    expect(result.diffPixels).toBe(10);
    expect(result.ok).toBe(false);
  });

  test("diffImages fails on size mismatch", () => {
    const result = diffImages(createImage(4, 4), createImage(5, 4), { pixelThreshold: 0, maxDiffRatio: 1 });
    expect(result.ok).toBe(false);
    expect(result.sizeMismatch).toBe(true);
    expect(result.diffImage).toBeNull();
  });
});

/** Wrap a deflated IDAT payload in a minimal PNG with the given color type (2 = RGB, 8-bit). */
function rebuildPng(width: number, height: number, colorType: number, idat: Uint8Array): Uint8Array {
  const encoded = encodePng(createImage(1, 1));
  // Reuse the encoder's signature (8 bytes) and IHDR chunk (25 bytes), patching size and color type.
  const ihdrChunk = Uint8Array.from(encoded.subarray(8, 33));
  const view = new DataView(ihdrChunk.buffer);
  view.setUint32(8, width);
  view.setUint32(12, height);
  ihdrChunk[17] = colorType;
  view.setUint32(21, crc(ihdrChunk.subarray(4, 21)));
  const idatChunk = frame("IDAT", idat);
  const iend = frame("IEND", new Uint8Array(0));
  const out = new Uint8Array(8 + ihdrChunk.length + idatChunk.length + iend.length);
  out.set(encoded.subarray(0, 8), 0);
  out.set(ihdrChunk, 8);
  out.set(idatChunk, 8 + ihdrChunk.length);
  out.set(iend, 8 + ihdrChunk.length + idatChunk.length);
  return out;
}

function frame(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
  return out;
}

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
