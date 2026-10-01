attribute vec2 aStart;
attribute vec2 aEnd;
attribute vec2 aCorner;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uCanvasSize;
uniform float uLineWidth;

// Expands one segment into a screen-space quad. aCorner.x selects the start (0)
// or end (1) point and aCorner.y the side (-1/+1). Ends extend by half the line
// width so consecutive segments overlap into closed joins.
void main() {
  vec2 halfCanvas = uCanvasSize * 0.5;
  vec2 a = (aStart * uScale + uOffset) * halfCanvas;
  vec2 b = (aEnd * uScale + uOffset) * halfCanvas;
  vec2 delta = b - a;
  float len = length(delta);
  vec2 dir = len > 0.0 ? delta / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float halfWidth = uLineWidth * 0.5;
  vec2 pixel = mix(a, b, aCorner.x) + dir * (halfWidth * (aCorner.x * 2.0 - 1.0)) + normal * (halfWidth * aCorner.y);
  gl_Position = vec4(pixel / halfCanvas, 0.0, 1.0);
}
