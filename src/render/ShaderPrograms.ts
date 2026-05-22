import lineVert from "./shaders/line.vert?raw";
import lineFrag from "./shaders/line.frag?raw";
import segmentVert from "./shaders/segment.vert?raw";
import segmentFrag from "./shaders/segment.frag?raw";
import pointVert from "./shaders/point.vert?raw";
import pointFrag from "./shaders/point.frag?raw";
import pointSpriteVert from "./shaders/point-sprite.vert?raw";
import pointSpriteFrag from "./shaders/point-sprite.frag?raw";
import barVert from "./shaders/bar.vert?raw";
import barRangeVert from "./shaders/bar-range.vert?raw";
import barFrag from "./shaders/bar.frag?raw";

/** GLSL sources for the built-in renderer programs. */
export const ShaderPrograms = {
  line: { vert: lineVert, frag: lineFrag },
  segment: { vert: segmentVert, frag: segmentFrag },
  point: { vert: pointVert, frag: pointFrag },
  pointSprite: { vert: pointSpriteVert, frag: pointSpriteFrag },
  bar: { vert: barVert, frag: barFrag },
  barRange: { vert: barRangeVert, frag: barFrag },
} as const;
