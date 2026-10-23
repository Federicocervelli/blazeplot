import type { RgbaColor } from "../core/types.js";

/*
 * CSS Color 4 codecs for the color spaces browsers keep when they serialize a computed color:
 * oklab(), oklch(), lab(), lch(), and color(<space> ...). Every color converts to linear sRGB,
 * is gamma-encoded, and is clamped per channel to 0-1. Out-of-gamut colors are clipped, not
 * gamut-mapped as CSS Color 4 section 13 describes, so a vivid display-p3 color can shift hue
 * slightly. Matrices are the CSS Color 4 reference values (https://www.w3.org/TR/css-color-4/#color-conversion-code).
 */

type Vec3 = readonly [number, number, number];
/** Row-major 3x3 matrix. */
type Mat3 = readonly number[];

const XYZ_D65_TO_LINEAR_SRGB: Mat3 = [
  3.2409699419045226, -1.537383177570094, -0.4986107602930034,
  -0.9692436362808796, 1.8759675015077202, 0.04155505740717559,
  0.05563007969699366, -0.20397695888897652, 1.0569715142428786,
];
// Bradford chromatic adaptation from the D50 to the D65 white point.
const D50_TO_D65: Mat3 = [
  0.955473421488075, -0.02309845494876471, 0.06325924320057072,
  -0.0283697093338637, 1.0099953980813041, 0.021041441191917323,
  0.012314014864481998, -0.020507649298898964, 1.330365926242124,
];
const OKLAB_TO_LMS: Mat3 = [
  1, 0.3963377773761749, 0.2158037573099136,
  1, -0.1055613458156586, -0.0638541728258133,
  1, -0.0894841775298119, -1.2914855480194092,
];
const LMS_TO_XYZ_D65: Mat3 = [
  1.2268798758459243, -0.5578149944602171, 0.2813910456659647,
  -0.0405757452148008, 1.112286803280317, -0.0717110580655164,
  -0.0763729366746601, -0.4214933324022432, 1.5869240198367816,
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const LAB_KAPPA = 24389 / 27;
const LAB_EPSILON = 216 / 24389;

const transfer = (fn: (abs: number) => number) => (value: number): number => Math.sign(value) * fn(Math.abs(value));
const srgbToLinear = transfer((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const linearToSrgb = transfer((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
const REC2020_ALPHA = 1.09929682680944;
const REC2020_BETA = 0.018053968510807;

/**
 * A predefined RGB or XYZ space: the linear-RGB-to-XYZ matrix (omitted when the channels already
 * are XYZ or linear sRGB), the encoded-to-linear transfer function (omitted for linear spaces),
 * and whether the matrix produces D50-relative XYZ that still needs Bradford adaptation.
 * `color(srgb ...)` is parsed by the theme resolver directly.
 */
type ColorSpace = readonly [matrix?: Mat3, toLinear?: (value: number) => number, d50?: boolean];

const COLOR_SPACES: Record<string, ColorSpace> = {
  "srgb-linear": [],
  "display-p3": [[
    0.4865709486482162, 0.26566769316909306, 0.1982172852343625,
    0.2289745640697488, 0.6917385218365064, 0.079286914093745,
    0, 0.04511338185890264, 1.043944368900976,
  ], srgbToLinear],
  rec2020: [[
    0.6369580483012914, 0.14461690358620832, 0.1688809751641721,
    0.2627002120112671, 0.6779980715188708, 0.05930171646986196,
    0, 0.028072693049087428, 1.060985057710791,
  ], transfer((v) => (v < REC2020_BETA * 4.5 ? v / 4.5 : ((v + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / 0.45)))],
  "a98-rgb": [[
    0.5766690429101305, 0.1855582379065463, 0.1882286462349947,
    0.29734497525053605, 0.6273635662554661, 0.07529145849399788,
    0.02703136138641234, 0.07068885253582723, 0.9913375368376388,
  ], transfer((v) => v ** (563 / 256))],
  "prophoto-rgb": [[
    0.7977666449006423, 0.13518129740053308, 0.0313477341283922,
    0.2880748288194013, 0.711835234241873, 0.00008993693872564,
    0, 0, 0.8251046025104602,
  ], transfer((v) => (v <= 16 / 512 ? v / 16 : v ** 1.8)), true],
  xyz: [],
  "xyz-d65": [],
  "xyz-d50": [undefined, undefined, true],
};

function multiply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

function xyzD65ToRgba(xyz: Vec3, alpha: number): RgbaColor {
  return linearSrgbToRgba(multiply(XYZ_D65_TO_LINEAR_SRGB, xyz), alpha);
}

function linearSrgbToRgba([r, g, b]: Vec3, alpha: number): RgbaColor {
  return [clampUnit(linearToSrgb(r)), clampUnit(linearToSrgb(g)), clampUnit(linearToSrgb(b)), clampUnit(alpha)];
}

function oklabToRgba(l: number, a: number, b: number, alpha: number): RgbaColor {
  const lms = multiply(OKLAB_TO_LMS, [l, a, b]);
  return xyzD65ToRgba(multiply(LMS_TO_XYZ_D65, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]), alpha);
}

function labToRgba(l: number, a: number, b: number, alpha: number): RgbaColor {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xyz: Vec3 = [
    (fx ** 3 > LAB_EPSILON ? fx ** 3 : (116 * fx - 16) / LAB_KAPPA) * D50_WHITE[0],
    (l > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : l / LAB_KAPPA) * D50_WHITE[1],
    (fz ** 3 > LAB_EPSILON ? fz ** 3 : (116 * fz - 16) / LAB_KAPPA) * D50_WHITE[2],
  ];
  return xyzD65ToRgba(multiply(D50_TO_D65, xyz), alpha);
}

const HUE_UNITS: Record<string, number> = { "": 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

/** Parse a number, percentage (scaled so 100% = `percentScale`), or `none` (0). */
function component(token: string, percentScale: number): number {
  if (token.toLowerCase() === "none") return 0;
  if (token.endsWith("%")) return (strictNumber(token.slice(0, -1)) / 100) * percentScale;
  return strictNumber(token);
}

function hue(token: string): number {
  if (token.toLowerCase() === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i.exec(token);
  const unit = match ? HUE_UNITS[match[2]!.toLowerCase()] : undefined;
  return unit === undefined ? Number.NaN : Number(match![1]) * unit;
}

function strictNumber(token: string): number {
  // `Number("")` is 0, so reject empty tokens explicitly; trailing units make it NaN.
  return token === "" ? Number.NaN : Number(token);
}

/** Polar to rectangular: chroma and hue (degrees) to the a/b axes. */
function polar(chroma: number, hueDegrees: number): [number, number] {
  const radians = (hueDegrees * Math.PI) / 180;
  const c = Math.max(0, chroma);
  return [c * Math.cos(radians), c * Math.sin(radians)];
}

/**
 * Parse `oklab()`, `oklch()`, `lab()`, `lch()`, or `color(<space> ...)` (any predefined space but
 * `srgb`) into a 0-1 sRGB RGBA tuple. Returns null for anything else, including `calc()` values.
 */
export function parseColorSpaceColor(color: string): RgbaColor | null {
  const match = /^(oklab|oklch|lab|lch|color)\(\s*(.*?)\s*\)$/i.exec(color.trim());
  if (!match) return null;
  const fn = match[1]!.toLowerCase();
  const [channelPart, alphaPart, extra] = match[2]!.split("/");
  if (extra !== undefined) return null;
  const tokens = channelPart!.trim().split(/\s+/);
  const space = fn === "color" ? tokens.shift()!.toLowerCase() : fn;
  if (tokens.length !== 3) return null;
  const alpha = alphaPart === undefined ? 1 : component(alphaPart.trim(), 1);
  const [t0, t1, t2] = tokens as [string, string, string];

  let rgba: RgbaColor;
  switch (space) {
    case "oklab":
      rgba = oklabToRgba(clampRange(component(t0, 1), 1), component(t1, 0.4), component(t2, 0.4), alpha);
      break;
    case "oklch":
      rgba = oklabToRgba(clampRange(component(t0, 1), 1), ...polar(component(t1, 0.4), hue(t2)), alpha);
      break;
    case "lab":
      rgba = labToRgba(clampRange(component(t0, 100), 100), component(t1, 125), component(t2, 125), alpha);
      break;
    case "lch":
      rgba = labToRgba(clampRange(component(t0, 100), 100), ...polar(component(t1, 150), hue(t2)), alpha);
      break;
    default: {
      const colorSpace = fn === "color" ? COLOR_SPACES[space] : undefined;
      if (!colorSpace) return null;
      const [matrix, toLinear = (value: number) => value, d50] = colorSpace;
      const linear: Vec3 = [toLinear(component(t0, 1)), toLinear(component(t1, 1)), toLinear(component(t2, 1))];
      if (space === "srgb-linear") {
        rgba = linearSrgbToRgba(linear, alpha);
        break;
      }
      const xyz = matrix ? multiply(matrix, linear) : linear;
      rgba = xyzD65ToRgba(d50 ? multiply(D50_TO_D65, xyz) : xyz, alpha);
    }
  }
  return rgba.every(Number.isFinite) ? rgba : null;
}

function clampRange(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function clampUnit(value: number): number {
  // NaN passes through so the caller can reject the color.
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
