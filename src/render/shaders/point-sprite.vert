attribute vec2 aPosition;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform float uPointSize;

void main() {
  vec2 clipSpace = aPosition * uScale + uOffset;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
  gl_PointSize = uPointSize;
}
