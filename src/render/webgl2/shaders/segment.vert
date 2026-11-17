attribute vec4 aEnds;
attribute vec4 aStroke;
attribute vec4 aColor;
attribute vec2 aCorner;

uniform vec2 uCanvasSize;

varying vec2 vPos;
varying vec4 vStroke;
varying float vLength;
varying vec4 vColor;

// One instanced quad per segment, in device pixels from the top-left corner. aEnds is x0, y0,
// x1, y1 and aStroke is width, dash, gap, dash offset. aCorner.x picks the start (0) or end (1)
// and aCorner.y the side. The quad is grown by a pixel so both the sides and the butt ends are
// antialiased; vPos is the fragment's distance along the segment and across it.
void main() {
  vec2 a = aEnds.xy;
  vec2 b = aEnds.zw;
  vec2 delta = b - a;
  float len = length(delta);
  vec2 dir = len > 0.0 ? delta / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float halfWidth = max(aStroke.x, 1.0) * 0.5 + 1.0;
  float along = aCorner.x * len + (aCorner.x * 2.0 - 1.0);
  float across = aCorner.y * halfWidth;
  vec2 pixel = a + dir * along + normal * across;
  vPos = vec2(along, across);
  vStroke = aStroke;
  vLength = len;
  vColor = aColor;
  gl_Position = vec4(pixel.x / uCanvasSize.x * 2.0 - 1.0, 1.0 - pixel.y / uCanvasSize.y * 2.0, 0.0, 1.0);
}
