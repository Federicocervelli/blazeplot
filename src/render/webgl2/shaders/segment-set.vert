#version 300 es
// highp: points in a set's own units, scaled to device pixels, need more than mediump's ~11 bits.
precision highp float;
precision highp int;
precision highp sampler2D;

in uvec2 aIndex;
in vec2 aCorner;

// x, y per texel, rows of uPointsWidth points.
uniform sampler2D uPoints;
uniform int uPointsWidth;
uniform uint uPointCount;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uCanvasSize;
// width, dash, gap, unused (device pixels).
uniform vec4 uStroke;

out vec2 vPos;
out float vLength;

vec2 point(uint index) {
  uint width = uint(uPointsWidth);
  return texelFetch(uPoints, ivec2(int(index % width), int(index / width)), 0).xy;
}

// One instanced quad per segment between two points of the set, laid out like segment.vert: aCorner.x picks
// the start (0) or end (1), aCorner.y the side, and the quad is grown by a pixel for antialiasing. A segment
// with an index past the last point or a hole (a stored non-finite coordinate) collapses outside clip space.
void main() {
  vPos = vec2(0.0);
  vLength = 0.0;
  if (aIndex.x >= uPointCount || aIndex.y >= uPointCount) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 pa = point(aIndex.x);
  vec2 pb = point(aIndex.y);
  if (max(max(abs(pa.x), abs(pa.y)), max(abs(pb.x), abs(pb.y))) > 1.0e38) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 a = pa * uScale + uOffset;
  vec2 b = pb * uScale + uOffset;
  vec2 delta = b - a;
  float len = length(delta);
  vec2 dir = len > 0.0 ? delta / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float halfWidth = max(uStroke.x, 1.0) * 0.5 + 1.0;
  float along = aCorner.x * len + (aCorner.x * 2.0 - 1.0);
  float across = aCorner.y * halfWidth;
  vec2 pixel = a + dir * along + normal * across;
  vPos = vec2(along, across);
  vLength = len;
  gl_Position = vec4(pixel.x / uCanvasSize.x * 2.0 - 1.0, 1.0 - pixel.y / uCanvasSize.y * 2.0, 0.0, 1.0);
}
