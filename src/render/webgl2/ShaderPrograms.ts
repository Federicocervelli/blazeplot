import lineVert from "./shaders/line.vert?raw";
import thickLineVert from "./shaders/thick-line.vert?raw";
import pointVert from "./shaders/point.vert?raw";
import pointFrag from "./shaders/point.frag?raw";
import barVert from "./shaders/bar.vert?raw";
import rectVert from "./shaders/rect.vert?raw";
import rectFrag from "./shaders/rect.frag?raw";
import solidFrag from "./shaders/solid.frag?raw";
import shapeVert from "./shaders/shape.vert?raw";
import shapeFrag from "./shaders/shape.frag?raw";
import segmentVert from "./shaders/segment.vert?raw";
import segmentFrag from "./shaders/segment.frag?raw";
import colorVert from "./shaders/color.vert?raw";

/** GLSL sources for the built-in renderer programs. */
export const ShaderPrograms = {
  line: { vert: lineVert, frag: solidFrag },
  thickLine: { vert: thickLineVert, frag: solidFrag },
  point: { vert: pointVert, frag: pointFrag },
  bar: { vert: barVert, frag: solidFrag },
  rect: { vert: rectVert, frag: rectFrag },
  shape: { vert: shapeVert, frag: shapeFrag },
  segment: { vert: segmentVert, frag: segmentFrag },
  // Per-vertex color, so the rectangle program's fragment shader (which reads vColor) fits.
  color: { vert: colorVert, frag: rectFrag },
} as const;

/** A built-in program: the key into {@link ShaderPrograms}. */
export type ProgramName = keyof typeof ShaderPrograms;
