import lineVert from "./shaders/line.vert?raw";
import thickLineVert from "./shaders/thick-line.vert?raw";
import pointVert from "./shaders/point.vert?raw";
import pointFrag from "./shaders/point.frag?raw";
import barVert from "./shaders/bar.vert?raw";
import rectVert from "./shaders/rect.vert?raw";
import rectFrag from "./shaders/rect.frag?raw";
import solidFrag from "./shaders/solid.frag?raw";

/** GLSL sources for the built-in renderer programs. */
export const ShaderPrograms = {
  line: { vert: lineVert, frag: solidFrag },
  thickLine: { vert: thickLineVert, frag: solidFrag },
  point: { vert: pointVert, frag: pointFrag },
  bar: { vert: barVert, frag: solidFrag },
  rect: { vert: rectVert, frag: rectFrag },
} as const;

/** A built-in program: the key into {@link ShaderPrograms}. */
export type ProgramName = keyof typeof ShaderPrograms;
