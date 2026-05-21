attribute float aX;
attribute float aMinY;
attribute float aMaxY;
attribute vec2 aCorner;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uCanvasSize;
uniform float uLineWidth;

void main() {
  float y = mix(aMinY, aMaxY, aCorner.y);
  vec2 centerClip = vec2(aX, y) * uScale + uOffset;
  float halfWidthClip = max(1.0, uLineWidth) / max(1.0, uCanvasSize.x);
  float clipX = centerClip.x + aCorner.x * halfWidthClip * 2.0;
  gl_Position = vec4(clipX, centerClip.y, 0.0, 1.0);
}
