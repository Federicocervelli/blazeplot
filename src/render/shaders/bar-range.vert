attribute float aX;
attribute float aMinY;
attribute float aMaxY;
attribute vec2 aCorner;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform float uBarWidth;

void main() {
  float x = aX + aCorner.x * uBarWidth;
  float y = mix(aMinY, aMaxY, aCorner.y);
  vec2 clipSpace = vec2(x, y) * uScale + uOffset;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
