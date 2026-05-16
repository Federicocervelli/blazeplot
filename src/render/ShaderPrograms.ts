import lineVert from "./shaders/line.vert?raw";
import lineFrag from "./shaders/line.frag?raw";
import segmentVert from "./shaders/segment.vert?raw";
import segmentFrag from "./shaders/segment.frag?raw";

export const ShaderPrograms = {
  line: { vert: lineVert, frag: lineFrag },
  segment: { vert: segmentVert, frag: segmentFrag },
} as const;
