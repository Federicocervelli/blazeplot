attribute vec2 aPosition;
attribute vec2 aCorner;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform float uBarWidth;
uniform float uBaseline;

void main() {
  float x = aPosition.x + aCorner.x * uBarWidth;
  float y = mix(uBaseline, aPosition.y, aCorner.y);
  vec2 clipSpace = vec2(x, y) * uScale + uOffset;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
