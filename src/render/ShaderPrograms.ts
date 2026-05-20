import lineVert from "./shaders/line.vert?raw";
import lineFrag from "./shaders/line.frag?raw";
import segmentVert from "./shaders/segment.vert?raw";
import segmentFrag from "./shaders/segment.frag?raw";
import pointVert from "./shaders/point.vert?raw";
import pointFrag from "./shaders/point.frag?raw";
import barVert from "./shaders/bar.vert?raw";
import barFrag from "./shaders/bar.frag?raw";

export const ShaderPrograms = {
  line: { vert: lineVert, frag: lineFrag },
  segment: { vert: segmentVert, frag: segmentFrag },
  point: { vert: pointVert, frag: pointFrag },
  bar: { vert: barVert, frag: barFrag },
} as const;
