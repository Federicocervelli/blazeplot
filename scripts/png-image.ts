/**
 * Tiny dependency-free PNG codec and image comparison helpers for the browser visual tests.
 *
 * Supports the PNGs Chrome emits (non-interlaced, 8-bit grayscale/RGB/RGBA/gray+alpha) and always
 * writes 8-bit RGBA. Used by `scripts/visual-test.ts` and covered by `tests/scripts/png-image.test.ts`.
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  readonly data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function createImage(width: number, height: number, fill?: readonly [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  if (fill) for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const bodyStart = offset + 8;
    const body = bytes.subarray(bodyStart, bodyStart + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = view.getUint32(bodyStart);
      height = view.getUint32(bodyStart + 4);
      const bitDepth = body[8];
      colorType = body[9]!;
      if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
      if (body[12] !== 0) throw new Error("Interlaced PNGs are not supported");
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width <= 0 || height <= 0) throw new Error("PNG is missing IHDR");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("Indexed PNG is missing PLTE");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("PNG pixel data is truncated");
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x]!;
      const left = x >= channels ? pixels[dst + x - channels]! : 0;
      const up = y > 0 ? pixels[dst - stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? pixels[dst - stride + x - channels]! : 0;
      let predictor = 0;
      switch (filter) {
        case 0: predictor = 0; break;
        case 1: predictor = left; break;
        case 2: predictor = up; break;
        case 3: predictor = (left + up) >> 1; break;
        case 4: predictor = paeth(left, up, upLeft); break;
        default: throw new Error(`Unsupported PNG filter ${filter}`);
      }
      pixels[dst + x] = (value + predictor) & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    const o = i * 4;
    if (colorType === 6) data.set(pixels.subarray(p, p + 4), o);
    else if (colorType === 2) data.set([pixels[p]!, pixels[p + 1]!, pixels[p + 2]!, 255], o);
    else if (colorType === 0) data.set([pixels[p]!, pixels[p]!, pixels[p]!, 255], o);
    else if (colorType === 4) data.set([pixels[p]!, pixels[p]!, pixels[p]!, pixels[p + 1]!], o);
    else {
      const index = pixels[p]! * 3;
      data.set([palette![index]!, palette![index + 1]!, palette![index + 2]!, 255], o);
    }
  }
  return { width, height, data };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat([
    Uint8Array.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface InkStats {
  /** Fraction of pixels (0..1) that differ from the background color by more than the tolerance. */
  readonly ratio: number;
  readonly inkPixels: number;
  readonly totalPixels: number;
  /** Background color estimated from the image border, as [r, g, b, a]. */
  readonly background: readonly [number, number, number, number];
}

/**
 * Measure how much of an image is "drawn" rather than background. The background is the most common
 * color on the image border, so a blank or uniform canvas reports a ratio of 0 regardless of its color.
 */
export function measureInk(image: RgbaImage, tolerance = 8): InkStats {
  const { width, height, data } = image;
  const counts = new Map<number, number>();
  const sample = (x: number, y: number): void => {
    const key = packPixel(data, (y * width + x) * 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    sample(0, y);
    sample(width - 1, y);
  }
  let backgroundKey = 0;
  let best = -1;
  for (const [key, count] of counts) {
    if (count > best) {
      best = count;
      backgroundKey = key;
    }
  }
  const background: [number, number, number, number] = [(backgroundKey >>> 24) & 0xff, (backgroundKey >>> 16) & 0xff, (backgroundKey >>> 8) & 0xff, backgroundKey & 0xff];
  let inkPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (maxChannelDelta(data, i, background) > tolerance) inkPixels++;
  }
  const totalPixels = width * height;
  return { ratio: totalPixels === 0 ? 0 : inkPixels / totalPixels, inkPixels, totalPixels, background };
}

function packPixel(data: Uint8Array, offset: number): number {
  return (((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0);
}

function maxChannelDelta(data: Uint8Array, offset: number, color: readonly number[]): number {
  return Math.max(
    Math.abs(data[offset]! - color[0]!),
    Math.abs(data[offset + 1]! - color[1]!),
    Math.abs(data[offset + 2]! - color[2]!),
    Math.abs(data[offset + 3]! - color[3]!),
  );
}

export interface ImageDiffOptions {
  /** A pixel differs when any channel differs by more than this (0..255). */
  readonly pixelThreshold: number;
  /** Maximum allowed fraction (0..1) of differing pixels. */
  readonly maxDiffRatio: number;
}

export interface ImageDiffResult {
  readonly ok: boolean;
  readonly sizeMismatch: boolean;
  readonly diffPixels: number;
  readonly totalPixels: number;
  readonly diffRatio: number;
  readonly maxChannelDelta: number;
  /** Visualization: dimmed expected image with differing pixels in red. Present unless sizes differ. */
  readonly diffImage: RgbaImage | null;
}

export function diffImages(expected: RgbaImage, actual: RgbaImage, options: ImageDiffOptions): ImageDiffResult {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { ok: false, sizeMismatch: true, diffPixels: 0, totalPixels: expected.width * expected.height, diffRatio: 1, maxChannelDelta: 255, diffImage: null };
  }
  const totalPixels = expected.width * expected.height;
  const diffData = new Uint8Array(expected.data.length);
  let diffPixels = 0;
  let maxDelta = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(expected.data[i]! - actual.data[i]!),
      Math.abs(expected.data[i + 1]! - actual.data[i + 1]!),
      Math.abs(expected.data[i + 2]! - actual.data[i + 2]!),
      Math.abs(expected.data[i + 3]! - actual.data[i + 3]!),
    );
    if (delta > maxDelta) maxDelta = delta;
    if (delta > options.pixelThreshold) {
      diffPixels++;
      diffData.set([255, 0, 0, 255], i);
    } else {
      const gray = Math.round((expected.data[i]! + expected.data[i + 1]! + expected.data[i + 2]!) / 3 * 0.35);
      diffData.set([gray, gray, gray, 255], i);
    }
  }
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  return {
    ok: diffRatio <= options.maxDiffRatio,
    sizeMismatch: false,
    diffPixels,
    totalPixels,
    diffRatio,
    maxChannelDelta: maxDelta,
    diffImage: { width: expected.width, height: expected.height, data: diffData },
  };
}
