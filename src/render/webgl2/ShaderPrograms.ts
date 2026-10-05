import lineVert from "./shaders/line.vert?raw";
import thickLineVert from "./shaders/thick-line.vert?raw";
import pointVert from "./shaders/point.vert?raw";
import pointFrag from "./shaders/point.frag?raw";
import barVert from "./shaders/bar.vert?raw";
import solidFrag from "./shaders/solid.frag?raw";

/** GLSL sources for the built-in renderer programs. */
export const ShaderPrograms = {
  line: { vert: lineVert, frag: solidFrag },
  thickLine: { vert: thickLineVert, frag: solidFrag },
  point: { vert: pointVert, frag: pointFrag },
  bar: { vert: barVert, frag: solidFrag },
} as const;
